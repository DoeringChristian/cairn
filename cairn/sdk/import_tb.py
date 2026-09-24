"""Import TensorBoard event files into a Cairn repo (``cairn import-tb``).

Every directory under ``logdir`` that holds ``*tfevents*`` files becomes one
run. Scalars, images and histograms are imported with their TensorBoard step
and wall time — both the legacy summary protos (``torch.utils.tensorboard``,
TF1) and the TF2 tensor summaries. The run's ``created_at``/``ended_at`` are
the first and last event times, so imported runs sort where they happened.
"""

from __future__ import annotations

import io
import secrets
from collections.abc import Iterator
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import numpy as np
from PIL import Image as PILImage

from .connect import open_transport
from .handlers.histogram import HistogramHandler
from .handlers.registry import default_registry, resolve_mime_type

_BATCH = 1000


def import_tensorboard(
    logdir: str | Path,
    *,
    project: str | None = None,
    repo: str | Path | None = None,
) -> list[str]:
    """Import every event directory under ``logdir``; return the new run ids.

    ``project`` defaults to ``logdir``'s name; each run is named after its
    event directory relative to ``logdir`` (the logdir's own name when the
    events sit directly in it).
    """
    try:
        from tensorboard.backend.event_processing import event_accumulator as ea
    except ImportError as exc:
        raise ImportError("cairn import-tb needs tensorboard: pip install 'cairn-track[tb]'") from exc

    root = Path(logdir).resolve()
    if not root.is_dir():
        raise FileNotFoundError(f"no such log directory: {root}")
    project = project or root.name
    event_dirs = sorted({p.parent for p in root.rglob("*tfevents*") if p.is_file()})

    transport, _ = open_transport(repo)
    run_ids: list[str] = []
    try:
        for d in event_dirs:
            acc = ea.EventAccumulator(str(d), size_guidance=ea.STORE_EVERYTHING_SIZE_GUIDANCE)
            acc.Reload()
            name = str(d.relative_to(root)) if d != root else root.name
            run_id = _import_run(transport, acc, project, name)
            if run_id is not None:
                run_ids.append(run_id)
    finally:
        transport.close()
    return run_ids


def _import_run(transport: Any, acc: Any, project: str, name: str) -> str | None:
    points: list[dict[str, Any]] = []
    times: list[float] = []

    def add(tag: str, step: int, wall: float, **fields: Any) -> None:
        times.append(wall)
        points.append({"name": tag, "step": int(step), "wall_time": _iso(wall), "context": None, **fields})

    def blob(object_type: str, obj: Any, **kw: Any) -> str:
        handler = default_registry.find_by_type(object_type)
        assert handler is not None
        data, meta = handler.serialize(obj, **kw)
        return transport.upload_artifact(data, resolve_mime_type(handler, obj, kw), meta, object_type=object_type)

    def image(tag: str, step: int, wall: float, png: bytes) -> None:
        img = PILImage.open(io.BytesIO(png))
        img.load()
        add(tag, step, wall, object_type="image", artifact_hash=blob("image", img))

    def histogram(tag: str, step: int, wall: float, counts: np.ndarray, edges: np.ndarray) -> None:
        data, meta = HistogramHandler().serialize(None, counts=counts, edges=edges)
        digest = transport.upload_artifact(data, "application/octet-stream", meta, object_type="histogram")
        add(tag, step, wall, object_type="histogram", artifact_hash=digest)

    tags = acc.Tags()
    for tag in tags.get("scalars", []):
        for e in acc.Scalars(tag):
            add(tag, e.step, e.wall_time, object_type="scalar", scalar_value=float(e.value))
    for tag in tags.get("images", []):
        for e in acc.Images(tag):
            image(tag, e.step, e.wall_time, e.encoded_image_string)
    for tag in tags.get("histograms", []):
        for e in acc.Histograms(tag):
            counts, edges = _legacy_bins(e.histogram_value)
            if counts.size:
                histogram(tag, e.step, e.wall_time, counts, edges)
    for tag in tags.get("tensors", []):
        plugin = acc.SummaryMetadata(tag).plugin_data.plugin_name
        for e in acc.Tensors(tag):
            for kind, value in _tensor_values(plugin, e.tensor_proto):
                if kind == "scalar":
                    add(tag, e.step, e.wall_time, object_type="scalar", scalar_value=value)
                elif kind == "image":
                    image(tag, e.step, e.wall_time, value)
                elif kind == "histogram":
                    histogram(tag, e.step, e.wall_time, *value)

    if not points:
        return None
    run_id = secrets.token_hex(16)
    transport.create_run({
        "project": project,
        "run_id": run_id,
        "name": name,
        "created_at": _iso(min(times)),
    })
    for i in range(0, len(points), _BATCH):
        transport.post_batch(run_id, points[i:i + _BATCH])
    transport.finish_run(run_id, "completed", None, ended_at=_iso(max(times)))
    return run_id


def _iso(wall_time: float) -> str:
    return datetime.fromtimestamp(wall_time, tz=timezone.utc).isoformat()


def _legacy_bins(h: Any) -> tuple[np.ndarray, np.ndarray]:
    """``HistogramProto`` → (counts, edges). Bucket ``i`` spans
    ``(limit[i-1], limit[i]]``; the outer edges are clamped to the recorded
    min/max, since TensorBoard's last limit is often ``DBL_MAX``."""
    counts = np.asarray(h.bucket, dtype=np.float64)
    limits = np.asarray(h.bucket_limit, dtype=np.float64)
    if counts.size == 0:
        return counts, limits
    edges = np.concatenate([[min(h.min, limits[0])], limits])
    edges[-1] = max(min(edges[-1], h.max), edges[-2])
    return counts, np.maximum.accumulate(edges)


def _tensor_values(plugin: str, proto: Any) -> Iterator[tuple[str, Any]]:
    """TF2 tensor summaries by plugin: scalars are 0-d, images a
    ``[width, height, png...]`` string vector, histograms ``k×3``
    ``[left, right, count]`` rows."""
    from tensorboard.util import tensor_util

    arr = tensor_util.make_ndarray(proto)
    if plugin == "scalars":
        yield "scalar", float(arr.reshape(()))
    elif plugin == "images":
        for png in arr.reshape(-1)[2:]:
            yield "image", bytes(png)
    elif plugin == "histograms" and arr.ndim == 2 and arr.shape[0] and arr.shape[1] == 3:
        edges = np.concatenate([arr[:, 0], arr[-1:, 1]]).astype(np.float64)
        yield "histogram", (arr[:, 2].astype(np.float64), edges)
