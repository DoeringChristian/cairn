"""Build a cairn 0.5.0 repo for the 0.6 upgrade test (``test_upgrade_v050.py``).

Run with the RELEASED 0.5.0 code, never with this checkout's::

    git archive v0.5.0 | tar -x -C /tmp/v050
    uv venv /tmp/venv050 && VIRTUAL_ENV=/tmp/venv050 uv pip install -e /tmp/v050 numpy pillow
    cd <empty dir> && /tmp/venv050/bin/python tests/fixtures/make_v050_repo.py
    tar -czf tests/fixtures/repo-v0.5.0.tar.gz .cairn

What it leaves in ``./.cairn``:

* runs ingested into ``cairn.db`` (by a 0.5 Reader catching up), with
  scalars, images, config, summary, tags, notes, an artifact family with two
  versions and an alias, a consumer run, a fork, and a report;
* runs whose logs are still PENDING in ``wals/`` (logged, never ingested):
  the 0.6 server must import them on its first start;
* ``expected.json`` next to ``.cairn``: what 0.5 itself reads back once every
  log is ingested (made from a copy of the repo, so the repo keeps its
  pending logs).
"""

from __future__ import annotations

import json
import shutil
import sys
import tempfile
from pathlib import Path

import numpy as np

import cairn

assert cairn.__version__ == "0.5.0", f"run this with cairn 0.5.0, not {cairn.__version__}"

REPO = Path.cwd() / ".cairn"
QUIET = dict(capture_source=False, capture_stdout=False, capture_env=False,
             capture_system_metrics=False)


def image(seed: int) -> "cairn.Image":
    rng = np.random.default_rng(seed)
    return cairn.Image(rng.integers(0, 255, size=(8, 8, 3), dtype=np.uint8))


def phase_ingested() -> dict[str, str]:
    ids: dict[str, str] = {}
    with cairn.Run("vision", name="train/base", repo=REPO, tags=["base"], notes="first", **QUIET) as run:
        run.config(lr=0.1, model={"depth": 4, "act": "relu"})
        for step in range(50):
            run.track(1.0 / (step + 1), "loss", step=step)
            run.track(step / 50, "acc", step=step)
        for step in (0, 10, 20):
            run.track(image(step), "samples", step=step)
        run.summary(best_acc=0.98, note="ok")
        run.set_tag("keep")
        run.add_note("a second note")
        run.log_artifact({"weights": [1, 2, 3]}, name="ckpt", type="model", aliases=["best"])
        run.log_artifact({"weights": [4, 5, 6]}, name="ckpt", type="model")
        ids["base"] = run.id
    with cairn.Run("vision", name="eval/base", repo=REPO, **QUIET) as run:
        run.use_artifact("ckpt:best")
        run.track(0.9, "eval/acc", step=0)
        ids["eval"] = run.id
    with cairn.Run("vision", fork_from=(ids["base"], 25), name="train/fork", repo=REPO, **QUIET) as run:
        for step in range(26, 40):
            run.track(0.5 / step, "loss", step=step)
        ids["fork"] = run.id
    with cairn.Run("vision", name="train/failed", repo=REPO, **QUIET) as run:
        run.track(float("nan"), "loss", step=0)
        run.track(2.0, "loss", step=1)
        run.finish(status="failed", exit_code=3)
        ids["failed"] = run.id
    # A 0.5 Reader catches the repo up on these runs' logs.
    with cairn.Reader(repo=REPO) as r:
        assert len(r.runs("vision").list()) == 4
    from cairn.cli_target import open_api

    with open_api(str(REPO), None) as api:
        api.post("/api/projects/vision/reports", json={
            "name": "Weekly", "payload": {"source": "# Weekly\n\nLoss went down.\n"},
        })
    return ids


def phase_pending() -> dict[str, str]:
    """Runs logged after the last catch-up: their logs stay in wals/."""
    ids: dict[str, str] = {}
    # Half ingested: a Reader catches up while it runs (wal_progress keeps
    # the offset), the rest of its log stays pending.
    with cairn.Run("vision", name="train/partial", repo=REPO, **QUIET) as run:
        for step in range(20):
            run.track(float(step), "loss", step=step)
        run._transport.flush() if hasattr(run._transport, "flush") else None
        with cairn.Reader(repo=REPO) as r:
            assert r.run(run.id).name == "train/partial"
        for step in range(20, 40):
            run.track(float(step), "loss", step=step)
        run.summary(done=True)
        ids["partial"] = run.id
    with cairn.Run("vision", name="train/late", repo=REPO, tags=["late"], **QUIET) as run:
        run.config(lr=0.01)
        for step in range(30):
            run.track(3.0 - step * 0.1, "loss", step=step)
        run.track(image(99), "samples", step=0)
        run.summary(best_acc=0.5)
        run.log_artifact({"weights": [7, 8, 9]}, name="ckpt", type="model", aliases=["late"])
        ids["late"] = run.id
    with cairn.Run("audio", name="probe", repo=REPO, **QUIET) as run:
        run.track(12.5, "snr", step=0)
        ids["probe"] = run.id
    return ids


def inventory(repo: Path) -> dict:
    """What 0.5 reads back from ``repo`` (it ingests pending logs first)."""
    out: dict = {"runs": {}, "artifacts": {}, "reports": []}
    with cairn.Reader(repo=repo) as r:
        for project in sorted(p.name for p in r.projects()):
            for run in r.runs(project).list():
                out["runs"][run.id] = {
                    "project": project,
                    "name": run.name,
                    "status": run.status,
                    "tags": sorted(run.tags),
                }
    import sqlite3

    # Every row of every table, as 0.5 stored it: the 0.6 upgrade must keep
    # each one (``test_upgrade_v050.py`` compares column by column).
    db = sqlite3.connect(repo / "cairn.db")
    tables = [r[0] for r in db.execute(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'"
    )]
    out["tables"] = {}
    for t in tables:
        cur = db.execute(f'SELECT * FROM "{t}"')
        cols = [d[0] for d in cur.description]
        out["tables"][t] = {"columns": cols, "rows": [list(r) for r in cur]}
    out["blob_files"] = sorted(
        str(p.relative_to(repo)) for p in (repo / "artifacts").rglob("*") if p.is_file()
    )
    db.close()
    return out


def main() -> None:
    if REPO.exists():
        sys.exit(f"{REPO} exists: run this in an empty directory")
    ids = phase_ingested()
    ids.update(phase_pending())
    pending = sorted(p.name for p in (REPO / "wals").glob("*.wal.jsonl"))
    assert pending, "the late runs' logs should still be pending"
    with tempfile.TemporaryDirectory() as tmp:
        copy = Path(tmp) / ".cairn"
        shutil.copytree(REPO, copy, ignore=shutil.ignore_patterns("lease*", "*.lock"))
        expected = inventory(copy)
    expected["ids"] = ids
    expected["pending_logs"] = pending
    (REPO.parent / "expected.json").write_text(json.dumps(expected, indent=1, sort_keys=True))
    print(json.dumps({"ids": ids, "pending": pending}, indent=1))


if __name__ == "__main__":
    main()
