"""Regression test: kaleido-less figure rasterization must not collapse
``source_hash`` across distinct figures.

Without kaleido, ``FigureHandler.serialize`` used to rasterize every
plotly figure to the exact same placeholder PNG bytes (``_blank_png()``
called with no arguments). Since the artifacts table content-addresses by
hash of those bytes and ``ingest_ops.put_artifact`` does
``ON CONFLICT (hash) DO UPDATE`` on a query that only refreshes
``object_type`` (not ``metadata``), every figure after the first would
silently alias onto the first figure's stored ``metadata.source_hash`` —
so all figure cards in a run without kaleido would render the *same*
interactive source.

This test drives the exact path that broke: ``FigureHandler.serialize``
-> ``LocalTransport.upload_artifact`` (source blob, then primary PNG) for
two distinct figures, then asserts both the primary-artifact hashes and
their stored ``source_hash`` metadata stay distinct.
"""

from __future__ import annotations

import json

import pytest

from cairn.sdk.handlers.figure import FigureHandler
from cairn.sdk.local import LocalTransport


def _log_figure(transport: LocalTransport, handler: FigureHandler, fig) -> dict:
    """Mirror cairn.sdk.run.Run.track's figure dual-storage path."""
    blob, meta = handler.serialize(fig)
    source_blob = meta.pop("_source_blob", None)
    source_mime = meta.pop("_source_mime", None)
    if source_blob is not None and source_mime is not None:
        src_hash = transport.upload_artifact(source_blob, source_mime, {})
        meta["source_hash"] = src_hash
    digest = transport.upload_artifact(
        blob, handler.mime_type, meta, object_type=handler.object_type,
    )
    return {"digest": digest, "meta": meta}


@pytest.mark.media
def test_two_distinct_figures_without_kaleido_stay_distinct(tmp_path):
    go = pytest.importorskip("plotly.graph_objects")
    # This regression targets the *degraded* (kaleido absent) rasterization
    # path — obj.to_image() must fail so FigureHandler falls back to the
    # placeholder PNG. If kaleido is installed in this environment, skip
    # rather than give a false pass (kaleido produces genuinely distinct
    # PNGs per figure, so the collision this test guards against can't
    # reproduce).
    if _kaleido_available():
        pytest.skip("kaleido installed — degraded no-kaleido path not exercised")

    transport = LocalTransport(tmp_path / ".cairn")
    try:
        rid = transport.create_run({"project": "p"})["run_id"]
        handler = FigureHandler()

        fig1 = go.Figure(data=[go.Scatter(x=[1, 2, 3], y=[1, 4, 9])])
        fig2 = go.Figure(data=[go.Bar(x=["a", "b"], y=[5, 7])])

        r1 = _log_figure(transport, handler, fig1)
        r2 = _log_figure(transport, handler, fig2)

        # Sanity: both took the kaleido-less fallback (else this test isn't
        # exercising the bug at all).
        assert r1["digest"] != "", "expected a primary artifact hash"

        # The bug: primary PNG artifacts collapsed onto the same hash.
        assert r1["digest"] != r2["digest"], (
            "distinct figures rasterized to the same placeholder PNG hash — "
            "the ON CONFLICT dedup will alias their source_hash metadata"
        )

        # And each artifacts-table row must keep *its own* source_hash, not
        # silently inherit the first figure's via ON CONFLICT DO UPDATE.
        row1 = transport.db.read_columns(
            "SELECT metadata FROM artifacts WHERE hash = ?", [r1["digest"]]
        )[0]
        row2 = transport.db.read_columns(
            "SELECT metadata FROM artifacts WHERE hash = ?", [r2["digest"]]
        )[0]
        meta1 = json.loads(row1["metadata"])
        meta2 = json.loads(row2["metadata"])
        assert meta1["source_hash"] == r1["meta"]["source_hash"]
        assert meta2["source_hash"] == r2["meta"]["source_hash"]
        assert meta1["source_hash"] != meta2["source_hash"]
    finally:
        transport.close()


def _kaleido_available() -> bool:
    try:
        import kaleido  # noqa: F401
    except ImportError:
        return False
    return True
