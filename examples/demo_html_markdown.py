"""Demo script for the HTML + Markdown cards (workstream D).

Logs, for two runs:
- an HTML mini-report every step: inline SVG sparkline of the running loss +
  a styled table of per-step stats — via ``cairn.Html``. Exercises the
  sandboxed-iframe renderer and its auto-height "cairn:resize" shim (the
  report grows a little every step so the height keeps changing).
- markdown training notes every few steps: headings, a GFM table, a GFM
  task-list (checkboxes), bold/italic/strikethrough, a fenced code block,
  and a link — via ``cairn.Markdown``. Exercises react-markdown + remark-gfm.
- one HTML report containing a raw ``<script>`` that tries to reach outside
  the iframe (read ``parent.location``, poke ``window.top``) — this MUST
  fail silently inside the sandbox; open it in the UI and confirm no error
  reaches the host page and the sandbox note it writes to its own DOM says
  "blocked".

**Local mode**::

    uv run cairn init /tmp/cairn-html-markdown
    CAIRN_REPO=/tmp/cairn-html-markdown/.cairn uv run python examples/demo_html_markdown.py
    uv run cairn ui --repo /tmp/cairn-html-markdown/.cairn --port 4314

    # browse http://localhost:4314/
"""

from __future__ import annotations

import math
import random

import cairn


def make_sparkline_svg(losses: list[float], width: int = 260, height: int = 48) -> str:
    """Inline SVG sparkline polyline for the loss history so far."""
    if len(losses) < 2:
        return f'<svg width="{width}" height="{height}"></svg>'
    lo, hi = min(losses), max(losses)
    span = (hi - lo) or 1.0
    n = len(losses)
    pts = []
    for i, v in enumerate(losses):
        x = (i / (n - 1)) * (width - 4) + 2
        y = height - 2 - ((v - lo) / span) * (height - 4)
        pts.append(f"{x:.1f},{y:.1f}")
    points = " ".join(pts)
    return (
        f'<svg width="{width}" height="{height}" viewBox="0 0 {width} {height}">'
        f'<polyline points="{points}" fill="none" stroke="#0969da" stroke-width="2" />'
        f"</svg>"
    )


def make_html_report(step: int, run_name: str, losses: list[float]) -> str:
    """Small self-contained HTML report: sparkline + a styled stats table.

    Grows slightly each step (more table rows) so the iframe's content
    height keeps changing — a good exercise for the auto-height shim.
    """
    spark = make_sparkline_svg(losses)
    rows = "".join(
        f"<tr><td>{i}</td><td>{v:.4f}</td></tr>"
        for i, v in enumerate(losses[-(5 + step % 6) :])
    )
    return f"""<!DOCTYPE html>
<html>
<head>
<style>
  body {{ font-family: ui-monospace, SFMono-Regular, Menlo, monospace; margin: 8px; color: #c9d1d9; background: transparent; }}
  h2 {{ font-size: 13px; margin: 0 0 6px; }}
  table {{ border-collapse: collapse; font-size: 11px; margin-top: 6px; }}
  td, th {{ border: 1px solid #444; padding: 2px 6px; text-align: right; }}
  th {{ background: #222; }}
</style>
</head>
<body>
<h2>{run_name} — step {step} mini-report</h2>
{spark}
<table>
<tr><th>recent step</th><th>loss</th></tr>
{rows}
</table>
</body>
</html>"""


def make_sandbox_probe_html() -> str:
    """HTML that tries to escape the sandbox — must fail silently.

    No `allow-same-origin`, so `parent.location` access throws a
    cross-origin SecurityError (caught below) rather than leaking the host
    URL, and `window.top === window.self` inside a sandboxed-without-
    allow-same-origin iframe (confirming it can't identify/reach the host).
    """
    return """<!DOCTYPE html>
<html><body style="font-family:monospace;background:transparent;color:#c9d1d9;margin:8px">
<h3>Sandbox escape probe</h3>
<pre id="out">running...</pre>
<script>
  const out = document.getElementById("out");
  const results = [];
  try {
    void parent.location.href;
    results.push("parent.location: READABLE (sandbox broken!)");
  } catch (e) {
    results.push("parent.location: blocked (" + e.name + ")");
  }
  try {
    results.push("window.top === window.self: " + (window.top === window.self));
  } catch (e) {
    results.push("window.top: blocked (" + e.name + ")");
  }
  try {
    localStorage.setItem("probe", "1");
    results.push("localStorage: accessible (opaque origin, isolated from host)");
  } catch (e) {
    results.push("localStorage: blocked (" + e.name + ")");
  }
  out.textContent = results.join("\\n");
</script>
</body></html>"""


NOTES = [
    """# Training notes

Kickoff run for the **html + markdown** card demo.

## Setup

- optimizer: `adamw`
- lr: `3e-4`
- ~~sgd~~ (swapped out after step 0, too slow to converge)

## Checklist

- [x] wire up SDK handlers
- [x] sandbox the HTML iframe
- [ ] tune LR schedule
- [ ] write eval report

See the [project board](https://example.com/board) for details.
""",
    """## Midpoint check-in

Loss is trending down nicely. Comparison so far:

| step | train loss | val loss | notes |
|---|---:|---:|---|
| 0  | 2.50 | 2.61 | baseline |
| 10 | 1.44 | 1.58 | *stable* |
| 20 | 0.83 | 1.02 | **improving** |

```python
# quick sanity check
assert val_loss > train_loss  # expected gap
print("looks healthy")
```

- [x] confirmed no NaNs
- [x] gradients within range
- [ ] run ablation on batch size
""",
    """### Wrap-up

Final numbers look reasonable. Next steps:

1. Sweep learning rate `[1e-4, 3e-4, 1e-3]`
2. Try a cosine schedule
3. Re-run with `capture_system_metrics=True`

> Nothing blocking — ready for the next experiment.

---

*Generated automatically by `examples/demo_html_markdown.py`.*
""",
]


def run_one(run_name: str, seed: int) -> None:
    run = cairn.Run(
        project="demo",
        name=run_name,
        tags=["demo", "html-markdown"],
        notes="Workstream D demo: HTML report + Markdown notes cards.",
    )
    run["hparams"] = {"lr": 3e-4, "optimizer": "adamw", "seed": seed}

    rng = random.Random(seed)
    losses: list[float] = []
    num_steps = 24

    for step in range(num_steps):
        loss = 2.5 * math.exp(-step / 10.0) + rng.uniform(0, 0.05)
        losses.append(loss)
        run.track(loss, name="train.loss", step=step)

        # HTML mini-report every step — exercises auto-height (content grows).
        run.track(
            cairn.Html(make_html_report(step, run_name, losses)),
            name="reports.summary",
            step=step,
        )

        # Markdown notes every 8 steps.
        if step % 8 == 0:
            idx = min(step // 8, len(NOTES) - 1)
            run.track(cairn.Markdown(NOTES[idx]), name="notes.training", step=step)

        print(f"[{run_name}] step={step:02d} loss={loss:.4f}")

    # One-off sandbox-escape probe artifact, easy to find via the card list.
    run.track(cairn.Html(make_sandbox_probe_html()), name="reports.sandbox_probe", step=0)

    run.add_note(
        "Open the 'reports.summary' HTML card and watch it resize as you "
        "scrub the step slider; open 'reports.sandbox_probe' and confirm "
        "all three probe lines say blocked/isolated; open 'notes.training' "
        "and confirm the GFM table + checklist render."
    )
    print(f"[{run_name}] done. Run ID: {run.id}  URL: {run.url}")
    run.finish()


def main() -> None:
    from cairn.config import resolve_target

    target = resolve_target()
    print(f"Logging to {target.kind} at {target.location}")

    run_one("html-markdown-a", seed=0)
    run_one("html-markdown-b", seed=1)


if __name__ == "__main__":
    main()
