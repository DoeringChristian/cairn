"""Captions are per-point metadata: identical bytes logged twice keep their
own captions, on HTTP, LocalTransport direct and LocalTransport WAL."""

from __future__ import annotations

import json

import numpy as np
import pytest

import cairn
from cairn.sdk.transport import Transport


@pytest.fixture(params=["http", "direct", "wal"])
def backend(request, tmp_path, monkeypatch):
    """Yields ``(run_kwargs, reader_repo)``."""
    if request.param == "http":
        live_server = request.getfixturevalue("live_server")
        monkeypatch.setenv("CAIRN_WAL_DIR", str(tmp_path / "wal"))
        t = Transport(live_server, max_retries=1, backoff_base=0.001, backoff_cap=0.001)
        yield {"transport": t}, live_server.replace("http://", "cairn://")
        t.close()
    else:
        repo = tmp_path / ".cairn"
        yield {"repo": repo, "local_wal": request.param == "wal"}, repo


def _run(kwargs):
    return cairn.Run(project="cap", capture_source=False, capture_stdout=False,
                     capture_env=False, capture_system_metrics=False, **kwargs)


def test_captions_round_trip(backend):
    run_kwargs, repo = backend
    img = np.zeros((4, 4, 3), dtype=np.uint8)
    run = _run(run_kwargs)
    try:
        run.track(cairn.Image(img, caption="first"), name="img", step=0)
        run.track(cairn.Image(img, caption="second"), name="img", step=1)
        run.track(cairn.Image(img), name="img", step=2)
        run.track(cairn.Audio(np.zeros(800, dtype=np.float32), sample_rate=8000, caption="beep"),
                  name="snd", step=0)
        run.track([cairn.Image(img, caption="a"), cairn.Image(img + 1)], name="gal", step=0,
                  caption="the gallery")
    finally:
        run.finish()

    reader = cairn.Reader(repo=repo)
    try:
        r = reader.run(run.id)
        pts = list(r.sequence("img"))
        # Same bytes, one artifact, three different captions.
        assert len({p.artifact_hash for p in pts}) == 1
        assert [p.caption for p in pts] == ["first", "second", None]
        assert pts[2].metadata is None
        assert [p.caption for p in r.sequence("snd")] == ["beep"]

        (gal,) = list(r.sequence("gal"))
        assert gal.caption == "the gallery"
        manifest = json.loads(reader._backend.get_artifact_bytes(gal.artifact_hash))
        assert [i.get("caption") for i in manifest["images"]] == ["a", None]
        # The caption never reaches the handler (it would reject the kwarg) or
        # the artifact metadata.
        assert "caption" not in json.loads(pts[0].artifact_metadata or "{}")
    finally:
        reader.close()
