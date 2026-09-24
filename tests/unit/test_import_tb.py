"""`cairn import-tb`: TensorBoard event dirs → runs, read back via the Reader."""

from __future__ import annotations

import io
from datetime import datetime, timezone

import numpy as np
import pytest
from click.testing import CliRunner

import cairn
from cairn import cli

pytest.importorskip("tensorboard")

T0 = 1_700_000_000.0


def _write_legacy(logdir):
    """torch.utils.tensorboard (legacy summary protos) in two event dirs."""
    torch = pytest.importorskip("torch")
    from torch.utils.tensorboard import SummaryWriter

    for i, sub in enumerate(["run_a", "run_b"]):
        w = SummaryWriter(str(logdir / sub))
        for step in range(3):
            w.add_scalar("loss", 1.0 / (step + 1) + i, step, walltime=T0 + step)
        w.add_image("sample", np.full((3, 4, 5), 0.5, dtype=np.float32), 2, walltime=T0 + 2)
        w.add_histogram("weights", torch.arange(100, dtype=torch.float32), 1, walltime=T0 + 1)
        w.close()


def _write_tf2(logdir):
    """TF2-style tensor summaries, written without TensorFlow."""
    from PIL import Image as PILImage
    from tensorboard.compat.proto import event_pb2, summary_pb2
    from tensorboard.plugins.histogram import summary_v2 as hist
    from tensorboard.plugins.image import metadata as image_meta
    from tensorboard.plugins.scalar import summary_v2 as scalar
    from tensorboard.summary.writer.event_file_writer import EventFileWriter
    from tensorboard.util import tensor_util

    buf = io.BytesIO()
    PILImage.new("RGB", (6, 2), (0, 255, 0)).save(buf, format="PNG")
    image = summary_pb2.Summary(value=[summary_pb2.Summary.Value(
        tag="pic",
        metadata=image_meta.create_summary_metadata("pic", ""),
        tensor=tensor_util.make_tensor_proto(np.array([b"6", b"2", buf.getvalue()], dtype=object)),
    )])
    w = EventFileWriter(str(logdir))
    w.add_event(event_pb2.Event(wall_time=T0, step=5, summary=scalar.scalar_pb("acc", 0.75)))
    w.add_event(event_pb2.Event(wall_time=T0 + 10, step=6, summary=hist.histogram_pb("h", np.arange(10.0), buckets=5)))
    w.add_event(event_pb2.Event(wall_time=T0 + 20, step=7, summary=image))
    w.close()


def _runs(repo, project):
    reader = cairn.Reader(repo)
    return reader, {r.name: r for r in reader.runs(project).list()}


def test_import_legacy_event_dirs_local(tmp_path):
    logdir = tmp_path / "tb"
    _write_legacy(logdir)
    repo = tmp_path / ".cairn"
    result = CliRunner().invoke(cli.main, ["import-tb", str(logdir), "--repo", str(repo)])
    assert result.exit_code == 0, result.output

    reader, runs = _runs(repo, "tb")
    try:
        assert set(runs) == {"run_a", "run_b"}
        run = runs["run_b"]
        assert run.status == "completed"
        assert run.created_at == datetime.fromtimestamp(T0, tz=timezone.utc)
        assert run.ended_at == datetime.fromtimestamp(T0 + 2, tz=timezone.utc)

        loss = run.sequence("loss")
        assert loss.steps == [0, 1, 2]
        assert loss.values == pytest.approx([2.0, 1.5, 1 / 3 + 1])
        assert loss.timestamps[1] == datetime.fromtimestamp(T0 + 1, tz=timezone.utc)

        img = run.sequence("sample").points[0]
        assert img.step == 2 and img.object_type == "image"
        pil = run["sample"][2].resolve()
        assert pil.size == (5, 4)

        hist = run.sequence("weights").points[0]
        assert hist.object_type == "histogram"
        counts, edges = run["weights"][1].resolve()
        assert counts.sum() == 100
        assert len(edges) == len(counts) + 1
        assert edges[0] == 0.0 and edges[-1] == 99.0
    finally:
        reader.close()


def test_import_tf2_tensor_summaries_over_http(tmp_path, live_server):
    from cairn.sdk.import_tb import import_tensorboard

    logdir = tmp_path / "exp"
    _write_tf2(logdir)
    repo = "cairn://" + live_server.removeprefix("http://")
    (run_id,) = import_tensorboard(logdir, project="tf2", repo=repo)

    reader = cairn.Reader(repo)
    try:
        run = reader.run(run_id)
        assert run.name == "exp"
        assert run.ended_at == datetime.fromtimestamp(T0 + 20, tz=timezone.utc)
        assert run.sequence("acc").values == [0.75]
        counts, edges = run["h"][6].resolve()
        assert counts.sum() == 10 and len(edges) == 6
        assert run["pic"][7].resolve().size == (6, 2)
    finally:
        reader.close()


def test_import_tb_empty_dir(tmp_path):
    from cairn.sdk.import_tb import import_tensorboard

    (tmp_path / "empty").mkdir()
    assert import_tensorboard(tmp_path / "empty", repo=tmp_path / ".cairn") == []
