"""Live query URLs — a report that shows the freshest run every time it opens.

Where ``report_cairn_plot.py`` *bakes* its image bytes inline (fully offline),
THIS example references images by a **live query URL**: a stable
``/api/query?...`` link that the cairn server re-resolves on every fetch to
"the ``<tag>`` artifact of the latest matching run". Open the report tomorrow,
after another training run has landed, and the panes show the NEW render — the
HTML never changed, only what the URL resolves to did.

The URL is produced by ``cairn.query_url(...)`` (or, equivalently,
``reader.runs(...).latest_url(tag)`` / ``run[tag].url``). It needs a *server*
target — a live query URL is only meaningful against a running cairn server
(``cairn ui`` / ``cairn server``); baked/offline reports use the inline path in
``report_cairn_plot.py`` instead.

Run (builds the HTML; no server needed just to emit it)::

    uv run --extra media python examples/report_query_url.py --server cairn://localhost:4300
    # → writes /tmp/cairn-query-url-report.html and prints the live URLs it embeds

Then serve it same-origin from the cairn server so the browser attaches the
session cookie to both the query and the redirected digest fetch.
"""

from __future__ import annotations

import argparse
import pathlib

import cairn
import cairn.plot as cp


def build_report(server: str, project: str) -> "cp.Report":
    # "latest run in <project>, its train/render image" — re-resolves on open.
    latest = cairn.query_url("train/render", project=project, server=server)
    # "latest run tagged best, its eval/render image".
    best = cairn.query_url(
        "eval/render", project=project, server=server, tags__contains="best"
    )
    # A pinned baseline: pick the current newest now and freeze it (live=False
    # bakes the immutable /api/artifacts/<digest> URL — needs the server up).
    # Left as a live URL here so the example emits without a running server:
    baseline = cairn.query_url("train/render", run="latest:2", project=project, server=server)

    return (
        cp.Report(title=f"{project} — live dashboard")
        .md(
            "# Always-fresh render dashboard\n"
            "Every image below is referenced by a **live query URL**. The cairn "
            "server re-resolves it to the freshest matching run on every open, so "
            "this page tracks training without being regenerated.\n"
        )
        .md("## Latest run — `train/render`")
        .add(cp.Image(url=latest))
        .md("## Latest run tagged `best` — `eval/render`")
        .add(cp.Image(url=best))
        .md("## Second-newest run — `train/render` (`run=latest:2`)")
        .add(cp.Image(url=baseline))
    ), {"latest": latest, "best": best, "baseline": baseline}


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--server", default="cairn://localhost:4300",
                    help="cairn server the query URLs resolve against")
    ap.add_argument("--project", default="demo")
    ap.add_argument("-o", "--out", default="/tmp/cairn-query-url-report.html")
    args = ap.parse_args()

    report, urls = build_report(args.server, args.project)
    out = pathlib.Path(args.out)
    report.save(out)
    print(f"wrote {out}")
    print("embedded live query URLs:")
    for label, url in urls.items():
        print(f"  {label}: {url}")


if __name__ == "__main__":
    main()
