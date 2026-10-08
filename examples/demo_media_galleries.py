"""Demo: galleries of every media kind (several items per step).

Tracking a LIST of media of one kind under one name at one step records a
gallery: one point whose items the kind's card shows side by side, with the
step slider moving through steps as usual. This works for every media kind;
here each run logs, per step:

* ``figures`` — 3 Plotly figures (interactive, zoom synced across the grid).
* ``mpl`` — 2 matplotlib figures (tracked raw: each is detected as a figure).
* ``clips`` — 3 short videos, played together on one transport bar.
* ``sounds`` — 3 tones.
* ``reports`` — 2 HTML snippets; ``notes`` — 2 markdown notes.
* ``logs`` — 3 plain-text logs (``cairn.Text``: a list of raw strings is not
  a gallery).
* ``clouds`` — 3 point clouds, shown in one 3D viewer with a tab per item.

Every item has its own caption (``cairn.X(..., caption=...)``) and every
gallery a point caption (``run.track(..., caption=...)``). Two runs make the
compare view useful: each run's gallery sits in its own pane.

Usage::

    uv run cairn init /tmp/cairn-galleries
    CAIRN_REPO=/tmp/cairn-galleries/.cairn uv run python examples/demo_media_galleries.py
    uv run cairn ui --repo /tmp/cairn-galleries/.cairn --port 4317

    # browse http://localhost:4317/
    #   - A run → Workspace: each card shows its items per step; drag
    #     the step slider to watch them change together.
    #   - Select both runs → Compare: one gallery per run.

Needs the ``media`` extra (Plotly, matplotlib, imageio-ffmpeg).
"""

from __future__ import annotations

import matplotlib

matplotlib.use("Agg")

import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402
import plotly.graph_objects as go  # noqa: E402

import cairn  # noqa: E402

PROJECT = "media-galleries"
STEPS = [0, 1, 2, 3]
SR = 16000
N = 3


def plotly_figure(i: int, step: int, lr: float) -> go.Figure:
    x = np.linspace(0, 4 * np.pi, 200)
    y = np.sin(x * (i + 1) + step * lr * 10) * np.exp(-x * lr * step)
    fig = go.Figure(go.Scatter(x=x, y=y, mode="lines", name=f"wave {i}"))
    fig.update_layout(title=f"wave {i} @ step {step}", margin=dict(l=30, r=10, t=40, b=30))
    return fig


def mpl_figure(i: int, step: int) -> plt.Figure:
    fig, ax = plt.subplots(figsize=(3, 2))
    ax.bar(range(5), np.arange(1, 6) ** (i + 1) * (step + 1))
    ax.set_title(f"bars {i} @ step {step}")
    return fig


def video(i: int, step: int) -> np.ndarray:
    """A 16-frame clip: a square sliding across, its colour set by step."""
    frames = np.zeros((16, 48, 48, 3), dtype=np.float32)
    colour = np.array([(step + 1) / len(STEPS), i / N, 1 - i / N], dtype=np.float32)
    for t in range(16):
        x = 2 + t * 2
        y = 8 + i * 12
        frames[t, y:y + 10, x:x + 10] = colour
    return frames


def tone(i: int, step: int) -> np.ndarray:
    t = np.linspace(0, 0.5, SR // 2, endpoint=False)
    return (0.3 * np.sin(2 * np.pi * (220 * (i + 1) + 40 * step) * t)).astype(np.float32)


def cloud(i: int, step: int, rng: np.random.Generator) -> np.ndarray:
    """A noisy sphere shell shrinking to a point as the steps go on."""
    pts = rng.normal(size=(400, 3))
    pts /= np.linalg.norm(pts, axis=1, keepdims=True)
    radius = (i + 1) * (1.0 - 0.2 * step)
    return (pts * radius + rng.normal(scale=0.05, size=pts.shape)).astype(np.float32)


def main() -> None:
    for name, lr in [("lr-small", 0.02), ("lr-large", 0.08)]:
        rng = np.random.default_rng(0)
        run = cairn.Run(project=PROJECT, name=name)
        run.config(lr=lr)
        for step in STEPS:
            run.track(float(np.exp(-lr * step)), "loss", step, summary="min")
            run.track(
                [cairn.Figure(plotly_figure(i, step, lr), caption=f"wave {i}") for i in range(N)],
                "figures", step, caption=f"{name}: step {step}",
            )
            mpl = [mpl_figure(i, step) for i in range(2)]
            run.track(mpl, "mpl", step, caption=f"{name}: step {step}")
            for fig in mpl:
                plt.close(fig)
            run.track(
                [cairn.Video(video(i, step), fps=8, caption=f"clip {i}") for i in range(N)],
                "clips", step, caption=f"{name}: step {step}",
            )
            run.track(
                [cairn.Audio(tone(i, step), sample_rate=SR, caption=f"tone {i}") for i in range(N)],
                "sounds", step, caption=f"{name}: step {step}",
            )
            run.track(
                [cairn.Html(f"<h3>report {i}</h3><p>{name}, step <b>{step}</b>, lr {lr}</p>", caption=f"report {i}")
                 for i in range(2)],
                "reports", step, caption=f"{name}: step {step}",
            )
            run.track(
                [cairn.Markdown(f"### note {i}\n\n- run `{name}`\n- step **{step}**", caption=f"note {i}")
                 for i in range(2)],
                "notes", step, caption=f"{name}: step {step}",
            )
            run.track(
                [cairn.Text(f"[{name}] worker {i}: step {step} loss={np.exp(-lr * step):.4f}", caption=f"worker {i}")
                 for i in range(N)],
                "logs", step, caption=f"{name}: step {step}",
            )
            run.track(
                [cairn.PointCloud(cloud(i, step, rng), caption=f"shell {i}") for i in range(N)],
                "clouds", step, caption=f"{name}: step {step}",
            )
        run.finish()
        print(f"{name}: logged {len(STEPS)} steps")


if __name__ == "__main__":
    main()
