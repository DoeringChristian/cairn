"""WS-PYAPI deliverables 2+3: `cairn.plot` element builders + the display
protocol (`cairn/sdk/elements.py`).

Covers:
* Each builder emits a schema-VALID `CardSpec` (round-tripped through
  `cairn.sdk.card_spec.CardSpec`/`CardsSpec`) when given a `run[tag]` handle.
* `media_compare`/`*_compare` set `settings.mode` + two series ("compare"
  sugar).
* Raw (non-`DataRef`) data on media builders (`image`/`mesh`/...) raises a
  clear `NotImplementedError` pointing at WS-INLINE.
* `scalar`/`figure`/`table` accept raw data too, falling back to a
  self-contained `HtmlElement` (no server needed).
* `CardElement._repr_html_` returns a live `<iframe .../embed/card?sid=...>`
  when a server is reachable (verified end-to-end against the `sid` really
  resolving), and a text fallback when it is not.
"""

from __future__ import annotations

import json

import numpy as np
import pytest

import cairn
import cairn.plot as cplot
from cairn.sdk.card_spec import CardSpec, CardsSpec, RunsSpec
from cairn.sdk.elements import CardElement, HtmlElement
from cairn.sdk.reader import DataRef, Reader


@pytest.fixture
def two_runs(tmp_path):
    repo = tmp_path / ".cairn"
    run_a = cairn.Run(
        project="pyapi-plot-test", name="run-a", repo=str(repo),
        capture_source=False, capture_stdout=False, capture_env=False,
        capture_system_metrics=False,
    )
    run_a_id = run_a.id
    for i in range(3):
        run_a.track(float(i) * 0.1, name="loss", step=i)
    run_a.finish()

    run_b = cairn.Run(
        project="pyapi-plot-test", name="run-b", repo=str(repo),
        capture_source=False, capture_stdout=False, capture_env=False,
        capture_system_metrics=False,
    )
    run_b_id = run_b.id
    for i in range(3):
        run_b.track(float(i) * 0.2, name="loss", step=i)
    run_b.finish()

    reader = Reader(repo=str(repo))
    try:
        yield reader, reader.run(run_a_id), reader.run(run_b_id)
    finally:
        reader.close()


@pytest.fixture
def two_runs_http_reader(tmp_path):
    """A live server serving a repo that has runs, opened via a
    ``Reader(repo="cairn://127.0.0.1:<port>")`` (server mode) — for testing
    that the reader's connected server is threaded into cards."""
    import socket
    import threading
    import time

    import uvicorn

    from cairn.server.app import create_app

    repo = tmp_path / ".cairn"
    run_a = cairn.Run(
        project="pyapi-plot-test", name="run-a", repo=str(repo),
        capture_source=False, capture_stdout=False, capture_env=False,
        capture_system_metrics=False,
    )
    run_a_id = run_a.id
    for i in range(3):
        run_a.track(float(i) * 0.1, name="loss", step=i)
    run_a.finish()

    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        port = s.getsockname()[1]

    app = create_app(data_dir=repo, auth_enabled=False)
    config = uvicorn.Config(app=app, host="127.0.0.1", port=port, log_level="warning", lifespan="on")
    server = uvicorn.Server(config)
    thread = threading.Thread(target=server.run, daemon=True)
    thread.start()
    deadline = time.time() + 10
    while time.time() < deadline and not server.started:
        time.sleep(0.02)
    if not server.started:
        raise RuntimeError("uvicorn failed to start within 10s")

    reader = Reader(repo=f"cairn://127.0.0.1:{port}")
    try:
        yield reader, reader.run(run_a_id)
    finally:
        reader.close()
        server.should_exit = True
        thread.join(timeout=10)


def _validate_card_spec(spec_dict: dict) -> CardSpec:
    """Round-trip through the WS-SCHEMA pydantic mirror — raises on any
    schema violation (this IS the "validated against card_spec.py" gate)."""
    return CardSpec.model_validate(spec_dict)


def test_scalar_with_dataref_emits_schema_valid_spec(two_runs):
    _reader, run_a, _run_b = two_runs
    el = cplot.scalar(run_a["loss"])
    assert isinstance(el, CardElement)
    spec = _validate_card_spec(el.spec)
    assert spec.type == "scalar"
    assert len(spec.series) == 1
    assert spec.series[0].runId == run_a.id
    assert spec.series[0].name == "loss"
    assert spec.series[0].context_hash == ""


def test_media_compare_sets_two_series_and_mode(two_runs):
    _reader, run_a, run_b = two_runs
    el = cplot.media_compare(run_a["loss"], run_b["loss"], mode="diff")
    spec = _validate_card_spec(el.spec)
    assert spec.type == "image"
    assert [s.runId for s in spec.series] == [run_a.id, run_b.id]
    assert spec.settings is not None
    settings = spec.settings.model_dump(exclude_none=True)
    assert settings.get("mode") == "diff"
    # RC1 (WS-MCFIX): a real reference designated — index 0 (`a`) — or the
    # compositor's diff/split/blend never resolve a pane to diff against and
    # silently render as unmodified "side" output.
    assert settings.get("baselineIndex") == 0


def test_media_compare_rejects_bad_mode(two_runs):
    _reader, run_a, run_b = two_runs
    with pytest.raises(ValueError):
        cplot.media_compare(run_a["loss"], run_b["loss"], mode="not-a-mode")


@pytest.mark.parametrize(
    "fn,card_type",
    [
        (cplot.image, "image"),
        (cplot.mesh, "mesh"),
        (cplot.pointcloud, "pointcloud"),
        (cplot.volume, "volume"),
        (cplot.boxes, "boxes3d"),
        (cplot.table, "table"),
        (cplot.figure, "figure"),
    ],
)
def test_single_view_builders_emit_correct_card_type(two_runs, fn, card_type):
    _reader, run_a, _run_b = two_runs
    el = fn(run_a["thing"])
    spec = _validate_card_spec(el.spec)
    assert spec.type == card_type
    assert spec.series[0].runId == run_a.id
    assert spec.series[0].name == "thing"


@pytest.mark.parametrize(
    "fn,card_type",
    [
        (cplot.image_compare, "image"),
        (cplot.mesh_compare, "mesh"),
        (cplot.pointcloud_compare, "pointcloud"),
        (cplot.volume_compare, "volume"),
        (cplot.boxes_compare, "boxes3d"),
    ],
)
def test_typed_compare_wrappers_delegate_to_media_compare(two_runs, fn, card_type):
    _reader, run_a, run_b = two_runs
    el = fn(run_a["thing"], run_b["thing"], mode="blend")
    spec = _validate_card_spec(el.spec)
    assert spec.type == card_type
    assert spec.settings.model_dump(exclude_none=True).get("mode") == "blend"


def test_dataref_step_becomes_settings_step(two_runs):
    _reader, run_a, _run_b = two_runs
    el = cplot.scalar(run_a["loss"][2])
    spec = _validate_card_spec(el.spec)
    assert spec.settings is not None
    assert spec.settings.model_dump(exclude_none=True).get("step") == 2.0


@pytest.mark.parametrize(
    "fn", [cplot.image, cplot.mesh, cplot.pointcloud, cplot.volume, cplot.boxes]
)
def test_raw_media_data_raises_notimplemented_pointing_at_ws_inline(fn):
    raw = np.zeros((4, 4, 3), dtype=np.uint8)
    with pytest.raises(NotImplementedError, match="WS-INLINE"):
        fn(raw)


def test_media_compare_raw_data_raises_notimplemented():
    raw_a = np.zeros((4, 4, 3), dtype=np.uint8)
    raw_b = np.ones((4, 4, 3), dtype=np.uint8)
    with pytest.raises(NotImplementedError, match="WS-INLINE"):
        cplot.media_compare(raw_a, raw_b)


@pytest.mark.media
def test_scalar_raw_data_falls_back_to_self_contained_html():
    el = cplot.scalar([1.0, 2.0, 3.0, 2.5])
    assert isinstance(el, HtmlElement)
    html = el._repr_html_()
    assert "<div" in html or "plotly" in html.lower()


@pytest.mark.media
def test_figure_raw_plotly_figure_falls_back_to_self_contained_html():
    fig = cplot.roc_curve([0, 1, 1, 0], [0.1, 0.9, 0.8, 0.2])
    el = cplot.figure(fig)
    assert isinstance(el, HtmlElement)
    assert "plotly" in el._repr_html_().lower()


def test_figure_rejects_non_figure_raw_data():
    with pytest.raises(TypeError):
        cplot.figure(object())


def test_table_raw_list_of_dicts_falls_back_to_html_table():
    el = cplot.table([{"a": 1, "b": 2}, {"a": 3, "b": 4}])
    assert isinstance(el, HtmlElement)
    html = el._repr_html_()
    assert "<table" in html and "<th>a</th>" in html and "<td>1</td>" in html


def test_card_element_spec_is_reusable_in_a_cairn_fence_shaped_doc(two_runs):
    """Sanity check that a built spec composes into a `CardsSpec` (the
    ```cairn fence root) without further translation — no card-spec fork."""
    _reader, run_a, _run_b = two_runs
    el = cplot.scalar(run_a["loss"])
    doc = CardsSpec(runs=RunsSpec(ids=[run_a.id]), cards=[CardSpec.model_validate(el.spec)])
    assert doc.cards[0].series[0].runId == run_a.id


# ---------------------------------------------------------------------------
# Display protocol: CardElement._repr_html_ -> live iframe vs fallback
# ---------------------------------------------------------------------------


def test_card_element_repr_html_no_server_falls_back_to_text(monkeypatch):
    import cairn.sdk.elements as elements_mod

    # Force every candidate (advertised servers.json entries, the
    # config-default probe, the `cairn ui` CLI-default-port probe) to read
    # as unreachable — real environments may genuinely have a `cairn ui`
    # running on 4300/4301 (that's the whole point of this feature), so
    # mocking the health probe itself is the only environment-independent
    # way to simulate "nothing reachable".
    monkeypatch.setattr(elements_mod.CardElement, "_probe", staticmethod(lambda url: False))
    el = CardElement({"type": "scalar", "series": [{"runId": "r1", "name": "loss", "context_hash": ""}]})
    html = el._repr_html_()
    assert "<iframe" not in html
    assert "no reachable cairn server" in html
    assert "cairn ui --no-auth" in html
    assert "<details>" in html and "spec (debug)" in html


def test_card_element_repr_html_live_server_returns_iframe_with_resolving_sid(live_server):
    import httpx

    spec = {"type": "scalar", "series": [{"runId": "r1", "name": "loss", "context_hash": ""}]}
    el = CardElement(spec, server=live_server)
    html = el._repr_html_()
    assert "<iframe" in html
    assert f"{live_server}/embed/card?sid=" in html

    sid = html.split("sid=", 1)[1].split('"', 1)[0]
    resp = httpx.get(f"{live_server}/api/embed/specs/{sid}")
    assert resp.status_code == 200
    assert resp.json()["spec"] == spec


def test_resolve_server_prefers_advertised_servers_json_over_default(
    live_server, tmp_path, monkeypatch
):
    """WS-SRVDISC: a `cairn ui` that landed on a non-default port (because
    4300/4301 were taken — the reported bug) is still auto-discovered via
    its repo's `servers.json`, without needing `server=`/`CAIRN_REPO`."""
    from urllib.parse import urlsplit

    from cairn.server.storage.datadir import DataDir

    parts = urlsplit(live_server)
    repo = tmp_path / ".cairn"
    dd = DataDir(repo)
    dd.add_live_server("ui", host=parts.hostname, port=parts.port)

    # Config-default candidate deliberately unreachable — proves the
    # advertised entry is what's actually being used, not a lucky fallback.
    import cairn.sdk.elements as elements_mod

    monkeypatch.setattr(elements_mod._config, "resolve_server", lambda explicit=None: "http://127.0.0.1:1")

    el = CardElement({"type": "scalar", "series": []}, repo_path=str(repo))
    assert el._resolve_server() == f"http://localhost:{parts.port}"


def test_resolve_server_ignores_stale_advertised_entry(tmp_path, monkeypatch):
    """A dead pid's advertisement is PRUNED — its port is never even probed,
    and (with nothing else reachable) discovery returns None."""
    from cairn.server.storage.datadir import DataDir

    repo = tmp_path / ".cairn"
    dd = DataDir(repo)
    dd.servers_path.write_text(
        json.dumps([{"pid": 999999999, "mode": "ui", "host": "127.0.0.1", "port": 65000}])
    )
    import cairn.sdk.elements as elements_mod

    probed: list[str] = []

    def _record(url: str) -> bool:
        probed.append(url)
        return False  # nothing reachable

    monkeypatch.setattr(elements_mod.CardElement, "_probe", staticmethod(_record))
    el = CardElement({"type": "scalar", "series": []}, repo_path=str(repo))
    assert el._resolve_server() is None
    # The dead-pid advertisement (:65000) was pruned by read_live_servers, so
    # it never reached the health probe at all.
    assert not any("65000" in u for u in probed)


def test_plot_builder_threads_repo_path_and_autodiscovers_live_server(two_runs, live_server):
    """End-to-end: `cplot.scalar(run["tag"])` threads the Reader's actual
    repo dir into `CardElement`, and `_repr_html_()` finds the live server
    advertised there — the real notebook-usage path this fix targets."""
    from urllib.parse import urlsplit

    from cairn.server.storage.datadir import DataDir

    _reader, run_a, _run_b = two_runs
    repo_path = run_a._backend.repo_path
    parts = urlsplit(live_server)
    dd = DataDir(repo_path)
    dd.add_live_server("ui", host=parts.hostname, port=parts.port)
    try:
        el = cplot.scalar(run_a["loss"])
        assert el._repo_path == repo_path
        html = el._repr_html_()
        assert f"http://localhost:{parts.port}/embed/card?sid=" in html
        sid = html.split("sid=", 1)[1].split('"', 1)[0]
        import httpx

        resp = httpx.get(f"{live_server}/api/embed/specs/{sid}")
        assert resp.status_code == 200
    finally:
        dd.remove_live_server()


def test_reader_server_threaded_from_http_reader_wins_over_config(monkeypatch):
    """A `Reader(repo="cairn://host:port")` threads its connected server into
    the element, so the card renders against the SAME server the reader
    queried — no `cairn.configure`/`CAIRN_REPO` needed, and it beats the
    (deliberately unreachable) global-config default."""
    import cairn.sdk.elements as elements_mod

    # Global config points somewhere dead — proves reader_server is used.
    monkeypatch.setattr(elements_mod._config, "resolve_server", lambda explicit=None: "http://127.0.0.1:1")
    monkeypatch.setattr(elements_mod._config, "resolve_target", lambda repo=None: elements_mod._config.RunTarget("local", "/tmp/nope/.cairn"))

    el = CardElement({"type": "scalar", "series": []}, reader_server="http://localhost:4302")
    # Trusted without a probe (like an explicit server=), so no network needed.
    assert el._resolve_server() == "http://localhost:4302"


def test_plot_builder_threads_reader_server_end_to_end(two_runs_http_reader):
    """`cplot.scalar(run["tag"])` on a server-mode Reader renders a LIVE
    iframe at that reader's server port with NO config — the reported bug
    (reader on cairn://:PORT, card fell back to dead :4300)."""
    import httpx

    reader, run_a = two_runs_http_reader
    from urllib.parse import urlsplit

    port = urlsplit(reader._backend.server_url).port
    el = cplot.scalar(run_a["loss"])
    html = el._repr_html_()
    assert f":{port}/embed/card?sid=" in html
    sid = html.split("sid=", 1)[1].split('"', 1)[0]
    resp = httpx.get(f"{reader._backend.server_url}/api/embed/specs/{sid}")
    assert resp.status_code == 200


def test_card_element_mimebundle_matches_repr_html():
    el = CardElement({"type": "scalar", "series": []}, server="http://127.0.0.1:1")
    bundle, meta = el._repr_mimebundle_()
    assert bundle["text/html"] == el._repr_html_()
    assert "text/plain" in bundle
    assert meta == {}
