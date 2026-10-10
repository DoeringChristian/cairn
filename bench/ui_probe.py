"""Headless Chromium page timings (run with the Playwright venv).

``python -m bench.ui_probe '<json>'`` with ``{"pages": [{page, url, selector}],
"reps": N, "shots": dir}``. Each rep is a fresh browser context (cold cache).
Per page: ``ready_ms`` (navigation start -> ``selector`` visible: first
meaningful content), ``settled_ms`` (-> no request in flight for 500 ms, the
quiet period excluded: a time-to-interactive proxy), requests, transferred
bytes, the JS heap after settling (``client`` memory) and a screenshot.
"""

from __future__ import annotations

import json
import sys
import time
from pathlib import Path

from playwright.sync_api import sync_playwright


def probe(browser, page_cfg: dict, shots: Path, rep: int) -> dict:
    ctx = browser.new_context(viewport={"width": 1600, "height": 1000})
    page = ctx.new_page()
    cdp = ctx.new_cdp_session(page)
    cdp.send("Performance.enable")
    cdp.send("Network.enable")
    inflight: dict = {}
    last_activity = [time.perf_counter()]
    nbytes = [0]
    nreq = [0]
    failed = [0]

    def on_req(r):
        inflight[r] = time.perf_counter()
        nreq[0] += 1
        last_activity[0] = time.perf_counter()

    def on_done(r):
        inflight.pop(r, None)
        last_activity[0] = time.perf_counter()

    def on_failed(r):
        failed[0] += 1
        on_done(r)

    page.on("request", on_req)
    page.on("requestfinished", on_done)
    page.on("requestfailed", on_failed)
    cdp.on("Network.loadingFinished", lambda e: nbytes.__setitem__(0, nbytes[0] + int(e.get("encodedDataLength", 0))))
    out = {"page": page_cfg["page"], "rep": rep, "url": page_cfg["url"]}
    t0 = time.perf_counter()
    try:
        page.goto(page_cfg["url"], wait_until="commit", timeout=120_000)
        page.locator(page_cfg["selector"]).first.wait_for(state="visible", timeout=120_000)
        out["ready_ms"] = (time.perf_counter() - t0) * 1e3
        out["ready_count"] = page.locator(page_cfg["selector"]).count()
    except Exception as exc:  # noqa: BLE001
        out["error"] = f"{type(exc).__name__}: {str(exc)[:300]}"
    # settled: no request started or finished for 500 ms, ignoring requests
    # open for > 5 s (long polls / streams); capped at 60 s (a page that
    # polls faster than every 500 ms never settles: settled = None)
    deadline = time.perf_counter() + 60
    settled = None
    while time.perf_counter() < deadline:
        now = time.perf_counter()
        busy = any(now - t < 5 for t in inflight.values())
        if not busy and now - last_activity[0] > 0.5:
            settled = last_activity[0]
            break
        page.wait_for_timeout(50)
    out["settled_ms"] = max((settled - t0) * 1e3, out.get("ready_ms", 0)) if settled else None
    out["long_requests_open"] = len(inflight)
    out["requests"], out["bytes"], out["failed_requests"] = nreq[0], nbytes[0], failed[0]
    m = {x["name"]: x["value"] for x in cdp.send("Performance.getMetrics")["metrics"]}
    out["js_heap_used_mb"] = m.get("JSHeapUsedSize", 0) / 2**20
    out["dom_nodes"] = m.get("Nodes")
    if rep == 0:
        shots.mkdir(parents=True, exist_ok=True)
        try:
            page.screenshot(path=str(shots / f"{page_cfg['page']}.png"))
        except Exception:  # noqa: BLE001
            pass
    ctx.close()
    return out


def main() -> None:
    a = json.loads(sys.argv[1])
    rows = []
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        for cfg in a["pages"]:
            for rep in range(a.get("reps", 3)):
                rows.append(probe(browser, cfg, Path(a["shots"]), rep))
        browser.close()
    # one row per page: medians of the reps
    out = []
    for cfg in a["pages"]:
        rs = [r for r in rows if r["page"] == cfg["page"]]
        ok = [r for r in rs if "ready_ms" in r]
        med = lambda k, xs=ok: sorted(x[k] for x in xs)[len(xs) // 2] if xs else None  # noqa: E731
        out.append({"page": cfg["page"], "url": cfg["url"], "reps": len(rs), "ok_reps": len(ok),
                    "ready_ms": med("ready_ms"), "settled_ms": med("settled_ms", [r for r in rs if r.get("settled_ms") is not None]),
                    "requests": med("requests", rs), "bytes": med("bytes", rs),
                    "js_heap_used_mb": med("js_heap_used_mb", rs), "ready_count": med("ready_count"),
                    "error": next((r["error"] for r in rs if "error" in r), None), "all": rs})
    print(json.dumps(out))


if __name__ == "__main__":
    main()
