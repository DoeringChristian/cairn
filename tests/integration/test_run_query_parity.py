"""Run selection: one spec, one evaluator, identical answers on a local repo
and a server. Every test runs against both backends on the same seeded runs
(same ids, so even the id tie-break is comparable) and asserts the exact id
sequence."""

from __future__ import annotations

import pytest

import cairn
from cairn.sdk.local import RepoTransport
from cairn.sdk.transport import Transport
from cairn.server import ingest_ops
from cairn.server.query_resolver import parse_query_params, resolve
from cairn.server.storage.db import Database

R1, R2, R3, R4, R5 = (c * 32 for c in "12345")
NAMES = {R1: "r1", R2: "r2", R3: "r3", R4: "r4", R5: "r5"}

#: run id -> (name, created_at, status, ended_at, config, summary, val.loss points)
SEED = {
    R1: ("a", "2026-01-01T00:00:00+00:00", "completed", "2026-01-01T03:00:00+00:00",
         {"model": {"depth": 8, "width": 64}, "optim": {"lr": 3e-4}, "layers": [64, 128]},
         {"test": {"psnr": 31.0}}, [0.9, 0.3]),
    R2: ("b", "2026-01-02T00:00:00+00:00", "completed", "2026-01-02T01:00:00+00:00",
         {"model": {"depth": 4}, "optim": {"lr": 1e-3}}, {"test": {"psnr": 29.0}}, [0.5, 0.2]),
    # Created at the same instant as R2: the tie breaks by id.
    R3: ("a", "2026-01-02T00:00:00+00:00", "failed", "2026-01-02T00:30:00+00:00",
         {"model": {"depth": 8}, "optim": {"lr": 1e-2}}, {}, []),
    # Running (no ended_at); a string depth is not comparable with the numbers.
    R4: ("c", "2026-01-03T00:00:00+00:00", "running", None,
         {"model": {"depth": "deep"}}, {}, [0.7, 0.5]),
    # Archived: hidden unless asked for.
    R5: ("a", "2026-01-04T00:00:00+00:00", "completed", "2026-01-04T01:00:00+00:00",
         {"model": {"depth": 8}}, {}, [0.1]),
}


def _seed(t, archive):
    for rid, (name, created, status, ended, config, summary, losses) in SEED.items():
        t.create_run({"project": "Par", "run_id": rid, "name": name, "created_at": created})
        t.post_params(rid, config)
        if summary:
            t.post_summary(rid, summary)
        points = [{"name": "val.loss", "step": i, "wall_time": created, "object_type": "scalar",
                   "scalar_value": v} for i, v in enumerate(losses)]
        digest = t.upload_artifact(rid.encode(), "image/png", {}, object_type="image")
        points.append({"name": "render", "step": 0, "wall_time": created,
                       "object_type": "image", "artifact_hash": digest})
        assert t.post_batch(rid, points)
        if ended:
            t.finish_run(rid, status, ended_at=ended)
    archive(R5)


@pytest.fixture(scope="module", params=["local", "http"])
def backend(request, tmp_path_factory):
    """``(reader, resolve_latest(params) -> run id)`` over the seeded runs."""
    tmp = tmp_path_factory.mktemp(request.param)
    if request.param == "local":
        repo = tmp / ".cairn"
        t = RepoTransport(repo)
        _seed(t, lambda rid: ingest_ops.set_archived(t.database(), rid, True))
        t.close()
        db = Database.open(repo / "cairn.db")
        reader = cairn.Reader(repo)

        def latest(params):
            return resolve(db, parse_query_params({**params, "tag": "render"})).run_id

        yield reader, latest
        reader.close()
        db.close()
        return

    import threading
    import time

    import httpx
    import uvicorn

    from cairn.server.app import create_app
    from tests.conftest import _find_free_port

    app = create_app(data_dir=tmp / "cairn", mount_ui=False)
    port = _find_free_port()
    server = uvicorn.Server(uvicorn.Config(app, host="127.0.0.1", port=port, log_level="warning"))
    thread = threading.Thread(target=server.run, daemon=True)
    thread.start()
    deadline = time.time() + 10
    while time.time() < deadline and not server.started:
        time.sleep(0.02)
    url = f"http://127.0.0.1:{port}"
    t = Transport(url, max_retries=1, backoff_base=0.001, backoff_cap=0.001,
                  spill_dir=tmp / "spill")
    _seed(t, lambda rid: httpx.post(f"{url}/api/runs/{rid}/archive").raise_for_status())
    t.close()
    reader = cairn.Reader(url.replace("http://", "cairn://"), cache=False)

    def latest(params):
        r = httpx.get(f"{url}/api/query", params={**params, "tag": "render", "format": "json"})
        r.raise_for_status()
        return r.json()["run_id"]

    yield reader, latest
    reader.close()
    server.should_exit = True
    thread.join(timeout=10)


def ids(runs):
    return [NAMES[r.id] for r in runs]


@pytest.fixture
def q(backend):
    return backend[0].runs("Par")  # a project NAME, normalised like cairn.Run's


def test_default_order_is_chronological_with_id_tie_break(q):
    assert ids(q) == ["r1", "r2", "r3", "r4"]
    assert ids(q.sort("created_at", desc=True)) == ["r4", "r3", "r2", "r1"]
    assert len(q) == 4


def test_archived_modes(backend):
    reader = backend[0]
    assert ids(reader.runs("par", archived=True)) == ["r5"]
    assert ids(reader.runs("par", archived=None)) == ["r1", "r2", "r3", "r4", "r5"]
    archived = reader.run(R5)
    assert archived.archived and archived.status == "completed"  # status untouched
    assert not reader.run(R1).archived


def test_sort_by_config_missing_last_both_directions(q):
    # depth: r1 8, r2 4, r3 8, r4 "deep" (not a number: missing).
    assert ids(q.sort("config.model.depth")) == ["r2", "r1", "r3", "r4"]
    assert ids(q.sort("config.model.depth", desc=True)) == ["r3", "r1", "r2", "r4"]
    # A key nobody has: everyone is missing, in created_at/id order.
    assert ids(q.sort("config.nope")) == ["r1", "r2", "r3", "r4"]


def test_sort_by_metric_summary_and_columns(q):
    # val.loss final: r1 .3, r2 .2, r3 none, r4 .5
    assert ids(q.sort("metrics.val.loss")) == ["r2", "r1", "r4", "r3"]
    assert ids(q.sort("metrics.val.loss", desc=True)) == ["r4", "r1", "r2", "r3"]
    assert ids(q.sort("summary.test.psnr", desc=True)) == ["r1", "r2", "r4", "r3"]
    assert ids(q.sort("ended_at")) == ["r1", "r3", "r2", "r4"]
    assert ids(q.sort("ended_at", desc=True)) == ["r2", "r3", "r1", "r4"]
    assert ids(q.sort("duration")) == ["r3", "r2", "r1", "r4"]
    assert ids(q.sort("name")) == ["r1", "r3", "r2", "r4"]
    assert ids(q.sort("status")) == ["r1", "r2", "r3", "r4"]
    with pytest.raises(ValueError):
        q.sort("bogus")


def test_first_last_get(q):
    assert NAMES[q.first().id] == "r1"
    assert NAMES[q.last().id] == "r4"
    assert NAMES[q.filter(name="a").last().id] == "r3"
    assert NAMES[q.filter(name="a", status="completed").get().id] == "r1"
    assert NAMES[q.sort("metrics.val.loss", desc=True).first().id] == "r4"
    assert NAMES[q.sort("metrics.val.loss").first().id] == "r2"
    assert NAMES[q.limit(2).last().id] == "r2"
    assert ids(q.limit(2)) == ["r1", "r2"]
    with pytest.raises(LookupError, match="2 runs match"):
        q.filter(name="a").get()
    with pytest.raises(LookupError, match="no run matches"):
        q.filter(name="zzz").get()
    assert q.filter(name="zzz").first() is None
    assert q.filter(name="zzz").last() is None


def test_nested_config_filters(q):
    assert ids(q.filter(model__depth=8)) == ["r1", "r3"]
    assert ids(q.filter(optim__lr__lte=1e-3)) == ["r1", "r2"]
    assert ids(q.filter(config__optim__lr__lt=1e-2)) == ["r1", "r2"]
    assert ids(q.filter(**{"config.optim.lr__lt": 1e-2})) == ["r1", "r2"]
    assert ids(q.filter(config__model={"depth": 4})) == ["r2"]  # a sub-document
    assert ids(q.filter(layers__contains=64)) == ["r1"]
    assert ids(q.filter(metrics__val__loss__lt=0.35)) == ["r1", "r2"]
    assert ids(q.filter(summary__test__psnr__gt=30)) == ["r1"]
    assert ids(q.filter(status__in=["failed", "running"])) == ["r3", "r4"]
    assert ids(q.filter(model__depth__gt=5)) == ["r1", "r3"]  # "deep" > 5 does not match


def test_where(q):
    assert ids(q.where("config.model.depth >= 8")) == ["r1", "r3"]
    assert ids(q.where("last(val.loss) < 0.4")) == ["r1", "r2"]
    assert ids(q.where("last(val.loss) < 0.4").sort("metrics.val.loss")) == ["r2", "r1"]


def test_config_reads_back_nested(backend):
    run = backend[0].run(R1)
    assert run.config == SEED[R1][4]
    assert run.summary == {"test": {"psnr": 31.0}}


def test_query_url_latest_agrees_with_last(backend, q):
    reader, latest = backend
    assert latest({"project": "par"}) == q.last().id
    assert latest({"project": "par", "name": "a"}) == q.filter(name="a").last().id
    assert latest({"project": "par", "model.depth": "8"}) == q.filter(model__depth=8).last().id
