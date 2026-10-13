"""Render result JSON files as markdown tables.

``python -m bench.report bench/results/*.json faults/results/*.json > tables.md``
(bench results and fault results may be mixed; later files win per scenario).
"""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any


def f(v: Any, nd: int = 0) -> str:
    if v is None:
        return "–"
    if isinstance(v, bool):
        return "yes" if v else "no"
    if isinstance(v, (int, float)):
        if nd == 0 and abs(v) >= 100:
            return f"{v:,.0f}"
        return f"{v:,.{max(nd, 1)}f}" if isinstance(v, float) else f"{v:,}"
    return str(v)


def table(head: list[str], rows: list[list[Any]]) -> str:
    out = ["| " + " | ".join(head) + " |", "|" + "|".join("---" for _ in head) + "|"]
    out += ["| " + " | ".join(str(x) for x in r) + " |" for r in rows]
    return "\n".join(out) + "\n"


def throughput(res: dict) -> str:
    rows = []
    for r in res["rows"]:
        if r.get("error"):
            rows.append([r["variant"], r["backend"], r["n_clients"], f"error: {r['error'][:60]}"] + [""] * 8)
            continue
        shape = f"{r['metrics']}m x {r['steps']}s" + (f", img/{r['media_every']}" if r.get("media_every") else "")
        rows.append([r["variant"], r["backend"], r["n_clients"], shape, f(r.get("points")),
                     f(r.get("client_pts_per_s")), f(r.get("e2e_pts_per_s")),
                     f(r.get("media_mb_per_s"), 1) if r["variant"] == "media" else "",
                     f(r.get("visible_after_finish_s"), 2), f(r.get("blocked_s_max"), 2),
                     f(r.get("client_rss_peak_mb")), f(r.get("server_rss_peak_mb"))])
    return table(["variant", "backend", "clients", "shape/client", "points", "client pts/s", "e2e pts/s",
                  "img MB/s", "visible after finish s", "max loop blocked s", "client RSS MB", "server RSS MB"], rows)


def lag(res: dict) -> str:
    rows = []
    for r in res["rows"]:
        l = r.get("lag_s") or {}
        rows.append([r["backend"], r["variant"], f(l.get("p50"), 3), f(l.get("p95"), 3), f(l.get("max"), 3),
                     f"{r.get('points_seen')}/{r.get('points_logged')}", f(r.get("server_rss_peak_mb")),
                     r.get("error") or ""])
    return table(["backend", "load", "lag p50 s", "lag p95 s", "lag max s", "seen/logged", "server RSS MB", "error"], rows)


def storage(res: dict) -> str:
    rows = []
    for r in res["rows"]:
        if r["variant"] == "scalar":
            rows.append([r["backend"], "scalar", f(r.get("points")),
                         f((r.get("bytes_per_1M_points_total") or 0) / 2**20, 1) + " MB",
                         f((r.get("bytes_per_1M_points_db") or 0) / 2**20, 1) + " MB",
                         f(r.get("bytes_per_point"), 1), r.get("error") or ""])
        else:
            rows.append([r["backend"], f"media ({r.get('images')} imgs)", f((r.get('raw_pixel_bytes') or 0) / 2**20, 1) + " MB raw",
                         f((r.get("stored_bytes_per_GB_pixels") or 0) / 2**30, 3) + " GB per GB", "", "", r.get("error") or ""])
    return table(["backend", "variant", "logged", "stored per 1M pts (total) / per GB", "DB only per 1M", "B/point", "error"], rows)


API_KEYS = ["list_50", "list_1000_params_stats", "sort_metric_50", "filter_metric_and_param_50", "run_detail",
            "batch_runs_200", "batch_series_100x1", "batch_series_200x2", "series_full_read", "series_columnar_read",
            "series_downsampled_1000", "wide_run_detail_1k_metrics", "wide_run_catalogue_1k_metrics"]


def api(res: dict) -> str:
    rows_in = [r for r in res["rows"] if "runs" in r]
    head = ["request"] + [f"{r['backend']} @{r['runs']} p50/p95 ms (KB)" for r in rows_in]
    rows = []
    for k in API_KEYS:
        if not any(k in r for r in rows_in):
            continue
        line = [k]
        for r in rows_in:
            v = r.get(k)
            if v is None:
                line.append("n/a")
            elif "error" in v:
                line.append("err: " + v["error"][:40])
            else:
                line.append(f"{f(v['p50_ms'], 1)} / {f(v['p95_ms'], 1)} ({f(v['bytes'] / 1024)})")
        rows.append(line)
    rows.append(["server RSS peak MB"] + [f(r.get("server_rss_peak_mb")) for r in rows_in])
    rows.append(["populate wall s"] + [f(r.get("populate_s")) for r in rows_in])
    out = table(head, rows)
    errs = [r for r in res["rows"] if "error" in r and "runs" not in r]
    for e in errs:
        out += f"\n{e['backend']}: {e['error'][:300]}\n"
    ui = res.get("ui") or []
    if ui:
        out += "\nUI (headless Chromium, cold context, median of 3):\n\n"
        out += table(["backend", "runs", "page", "first content ms", "settled ms", "requests", "transfer KB",
                      "JS heap MB", "error"],
                     [[u["backend"], u.get("runs"), u["page"], f(u.get("ready_ms")), f(u.get("settled_ms")),
                       u.get("requests"), f((u.get("bytes") or 0) / 1024), f(u.get("js_heap_used_mb"), 1),
                       (u.get("error") or "")[:80]] for u in ui])
    return out


def faults(name: str, rows: list[dict]) -> str:
    out = []
    if name == "torn_writes":
        tr = []
        for r in rows:
            for tgt, s in (r.get("summary") or {}).items():
                tr.append([r["system"], tgt, s["trials"], s["server_failed_to_start"], s["unreadable"],
                           s["quick_check_failed"], s["with_loss"], s["points_lost_total"], s["corrupted_total"],
                           s["duplicated_total"]])
            if r.get("error"):
                tr.append([r["system"], "error: " + r["error"][:80]] + [""] * 8)
        return table(["system", "truncated file", "trials", "server failed to start", "unreadable",
                      "quick_check failed", "trials with loss", "points lost", "corrupted", "duplicated"], tr)
    if name == "concurrent":
        tr = []
        for r in rows:
            e = r.get("eight_runs") or {}
            tr.append([r["system"], "8 clients / 8 runs", e.get("expected"), e.get("lost"), e.get("duplicated"),
                       e.get("corrupted"), e.get("reordered"), e.get("raised"), f(e.get("max_loop_blocked_s"), 2),
                       e.get("error") or ""])
            for k, v in (r.get("same_run_two_processes") or {}).items():
                if k == "error":
                    tr.append([r["system"], "2 processes / 1 run", "", "", "", "", "", "", "", v])
                    continue
                tr.append([r["system"], f"2 processes / 1 run: {k}", v.get("expected"), v.get("lost"),
                           v.get("duplicated"), v.get("corrupted"), v.get("reordered"), v.get("raised"), "",
                           v.get("error") or ""])
        return table(["system", "case", "expected", "lost", "dup", "corrupt", "reordered", "raised",
                      "max blocked s", "error"], tr)
    tr = []
    for r in rows:
        if r.get("na"):
            tr.append([r["system"], "n/a: " + r["na"]] + [""] * 11)
            continue
        bs = r.get("before_sync") or {}
        tr.append([r["system"], r.get("expected"), bs.get("lost", r.get("lost")),
                   bs.get("lost_accepted", r.get("lost_accepted")), r.get("lost"), r.get("lost_accepted"),
                   r.get("duplicated"),
                   r.get("corrupted"), r.get("reordered"),
                   f"{r.get('client_raised')}" + (" + crash" if r.get("client_error") else ""),
                   f(r.get("loop_blocked_s"), 1), f(r.get("recovery_s"), 1),
                   f"{r.get('final_status')}" + (f"; {r['error'][:60]}" if r.get("error") else "")])
    return table(["system", "expected pts", "lost (no sync)", "lost after ack'd (no sync)",
                  "lost (after `cairn sync`)", "lost after ack'd (after sync)", "dup", "corrupt", "reordered",
                  "raised (calls)", "loop blocked s", "recovery s", "final status"], tr)


def main() -> None:
    bench: dict[str, Any] = {}
    fl: dict[str, Any] = {}
    machine = None
    for p in sys.argv[1:]:
        d = json.loads(Path(p).read_text())
        machine = machine or d.get("machine")
        if "systems" in d:
            for k, v in d["scenarios"].items():
                fl.setdefault(k, []).extend(v)
        else:
            for k, v in d["scenarios"].items():
                bench[f"{k} ({d.get('scale')})"] = v
    render = {"throughput": throughput, "lag": lag, "storage": storage, "api": api}
    print(f"Machine: `{json.dumps(machine)}`\n")
    for key, res in bench.items():
        base = key.split(" ")[0]
        if base in render:
            print(f"### {key}\n")
            print(render[base](res))
    for name, rows in fl.items():
        print(f"### fault: {name}\n")
        print(faults(name, rows))


if __name__ == "__main__":
    main()
