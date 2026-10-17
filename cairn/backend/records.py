"""Append-only structured observations, shared by local and HTTP readers.

The record is authoritative. Scalar/media sequences are a rendering index, not
the storage model: repeated, missing and nonmonotonic coordinates remain intact.
"""
from __future__ import annotations

import json
import math
import re
import time
from datetime import datetime

MAX_RECORD_BYTES = 256 * 1024
MAX_SCAN = 100_000
MAX_SCAN_BYTES = 32 * 1024 * 1024
_MISSING = object()


def _number(value):
    try:
        return type(value) in (int, float) and math.isfinite(value)
    except OverflowError:
        return False


def media_reference(value):
    """Only an explicit media envelope reserves the marker; ordinary JSON stays JSON."""
    if not isinstance(value, dict) or set(value) != {"$media"}:
        return None
    media = value["$media"]
    if isinstance(media, dict) and ("hash" in media or "object_type" in media):
        return media
    return None


def encode(values):
    if not isinstance(values, dict):
        raise TypeError("log expects a mapping")
    def validate(value, depth=0):
        if depth > 32:
            raise ValueError("record nesting exceeds 32 levels")
        if isinstance(value, dict):
            for key, item in value.items():
                if not isinstance(key, str):
                    raise ValueError("record keys must be strings")
                validate(item, depth + 1)
            media = media_reference(value)
            if media is not None:
                if not isinstance(media, dict) or not re.fullmatch(r"[a-f0-9]{64}", str(media.get("hash", ""))):
                    raise ValueError("invalid media reference")
                if not isinstance(media.get("object_type"), str) or not media["object_type"]:
                    raise ValueError("media reference requires an object_type")
        elif isinstance(value, list):
            for item in value:
                validate(item, depth + 1)
        elif value is not None and type(value) not in (str, int, float, bool):
            raise TypeError(f"record contains unsupported {type(value).__name__}")
    validate(values)
    raw = json.dumps(values, ensure_ascii=False, allow_nan=False, separators=(",", ":"), sort_keys=True)
    if len(raw.encode()) > MAX_RECORD_BYTES:
        raise ValueError("record exceeds 256 KiB; store large data as media or artifacts")
    return raw


def media_hashes(value):
    if isinstance(value, dict):
        media = media_reference(value)
        if isinstance(media, dict) and isinstance(media.get("hash"), str):
            yield media["hash"]
        for item in value.values():
            yield from media_hashes(item)
    elif isinstance(value, list):
        for item in value:
            yield from media_hashes(item)


def leaves(values, prefix=""):
    """JSON Pointer paths are unambiguous even when keys contain dots/slashes."""
    for key, value in values.items():
        path = prefix + "/" + key.replace("~", "~0").replace("/", "~1")
        yield path, value
        if isinstance(value, dict) and media_reference(value) is None:
            yield from leaves(value, path)


def lookup(values, path):
    if not path.startswith("/") and path in values:  # literal dotted names precede dot paths
        return values[path]
    keys = [part.replace("~1", "/").replace("~0", "~") for part in path[1:].split("/")] if path.startswith("/") else path.split(".")
    current = values
    for key in keys:
        if isinstance(current, dict) and key in current:
            current = current[key]
        elif isinstance(current, list) and key.isdigit() and int(key) < len(current):
            current = current[int(key)]
        else:
            return _MISSING
    return current


def append(db, run_id, values, *, writer_id, sequence, timestamp):
    raw = encode(values)
    if not isinstance(timestamp, str):
        raise ValueError('timestamp must be an ISO datetime string')
    try:
        datetime.fromisoformat(timestamp)
    except ValueError as exc:
        raise ValueError('timestamp must be an ISO datetime string') from exc
    with db.transaction(immediate=True):
        db.lock_resource("run", run_id)
        row = db.read_one("SELECT status FROM runs WHERE id=?", [run_id])
        if row is None:
            raise ValueError("run not found")
        if row[0] not in ("running", "crashed"):
            raise ValueError("cannot log to a finished run")
        event_id = int(db.read_one("SELECT COALESCE(MAX(event_id),0)+1 FROM run_records WHERE run_id=?", [run_id])[0])
        db.write("INSERT INTO run_records (run_id,event_id,writer_id,sequence,timestamp,values_json) VALUES (?,?,?,?,?,?)",
                 [run_id, event_id, writer_id, sequence, timestamp, raw])
        # Keep the existing card renderers as projections of the complete entry.
        # The observation index is unique; user-provided step is a normal field.
        from .ingest_ops import insert_batch
        points = []
        for path, value in leaves(values):
            name = path[1:].replace("~1", "/").replace("~0", "~") if path.count("/") == 1 and not path.startswith("/~1") and path != "/" else path
            point = {"name": name, "step": event_id - 1, "wall_time": timestamp}
            if _number(value):
                point.update(object_type="scalar", scalar_value=float(value))
                if name != "step" and type(values.get("step")) in (int, float):
                    db.write("INSERT INTO metric_defs (run_id,name,x,summary) VALUES (?,?,?,?) "
                             "ON CONFLICT (run_id,name) DO NOTHING", [run_id,name,"step",None])
            elif media_reference(value) is not None:
                media = media_reference(value)
                point.update(object_type=media["object_type"], artifact_hash=media["hash"], metadata=media.get("metadata", {}))
            else:
                continue
            points.append(point)
        if points:
            insert_batch(db, run_id, points)
    return event_id


def _require_run(db, run_id):
    if db.read_one("SELECT 1 FROM runs WHERE id=?", [run_id]) is None:
        raise LookupError("run not found")


def _filter(predicate):
    if predicate is None:
        return lambda values: True
    if not isinstance(predicate, dict) or len(predicate) > 32:
        raise ValueError("where must be an object with at most 32 field predicates")
    if len(json.dumps(predicate, allow_nan=False).encode()) > 64 * 1024:
        raise ValueError("record filter exceeds 64 KiB")
    operations = {"eq", "ne", "gt", "gte", "lt", "lte", "in", "contains", "exists"}
    for path, rule in predicate.items():
        if not isinstance(path, str) or not path:
            raise ValueError("filter fields must be nonempty strings")
        if isinstance(rule, dict) and (not rule or set(rule) - operations):
            raise ValueError("unknown record filter operator")
        if isinstance(rule, dict) and "in" in rule and not isinstance(rule["in"], list):
            raise ValueError("in requires an array")
        if isinstance(rule, dict) and "exists" in rule and type(rule["exists"]) is not bool:
            raise ValueError("exists requires true or false")
    def matches(values):
        for path, rule in predicate.items():
            value = lookup(values, path)
            for op, expected in (rule.items() if isinstance(rule, dict) else [("eq", rule)]):
                if op == "exists":
                    ok = (value is not _MISSING) == expected
                elif value is _MISSING:
                    ok = False
                else:
                    try:
                        if op == "eq": ok = value == expected
                        elif op == "ne": ok = value != expected
                        elif op == "gt": ok = value > expected
                        elif op == "gte": ok = value >= expected
                        elif op == "lt": ok = value < expected
                        elif op == "lte": ok = value <= expected
                        elif op == "in": ok = value in expected
                        else: ok = expected in value
                    except TypeError:
                        ok = False
                if not ok:
                    return False
        return True
    return matches


def page(db, run_id, *, limit=100, cursor=0, where=None, _budget=None):
    _require_run(db, run_id)
    if type(limit) is not int or not 1 <= limit <= 1000 or type(cursor) is not int or cursor < 0:
        raise ValueError("limit must be 1–1000 and cursor a nonnegative integer")
    matches = _filter(where)
    items = []
    scanned = size = 0
    budget = _budget if _budget is not None else {"rows": 0, "bytes": 0, "deadline": time.monotonic() + 5}
    def available():
        return budget["rows"] < MAX_SCAN and budget["bytes"] < MAX_SCAN_BYTES and time.monotonic() < budget["deadline"]
    while available():
        rows = db.read_columns("SELECT event_id,writer_id,sequence,timestamp,values_json FROM run_records WHERE run_id=? AND event_id>? ORDER BY event_id LIMIT 128", [run_id, cursor])
        if not rows:
            return {"items": items, "next_cursor": None, "scanned": scanned}
        for row in rows:
            cursor = row["event_id"]
            raw = row.pop("values_json")
            size += len(raw.encode())
            scanned += 1
            budget["rows"] += 1
            budget["bytes"] += len(raw.encode())
            values = json.loads(raw)
            if matches(values):
                items.append({**row, "values": values})
            if len(items) == limit or not available():
                break
        if len(items) == limit:
            break
    more = db.read_one("SELECT 1 FROM run_records WHERE run_id=? AND event_id>? LIMIT 1", [run_id, cursor])
    return {"items": items, "next_cursor": cursor if more else None, "scanned": scanned}


def fields(db, run_id):
    result = page(db, run_id, limit=1000)
    found = {}
    for row in result["items"]:
        for path, value in leaves(row["values"]):
            kind = "media" if media_reference(value) is not None else "number" if type(value) in (int, float) else "boolean" if isinstance(value, bool) else "string" if isinstance(value, str) else "null" if value is None else "array" if isinstance(value, list) else "object"
            info = found.setdefault(path, {"path": path, "types": set(), "count": 0})
            info["types"].add(kind)
            info["count"] += 1
    return {"fields": [{**found[k], "types": sorted(found[k]["types"])} for k in sorted(found)], "sampled": len(result["items"]), "truncated": result["next_cursor"] is not None}


def series(db, run_id, key, *, x="step", where=None, max_points=1200):
    if not isinstance(key, str) or type(max_points) is not int or not 2 <= max_points <= 10000:
        raise ValueError("key is required; max_points must be 2–10000")
    if x is not None and not isinstance(x, str):
        raise ValueError("x must be a field path")
    points, scanned, cursor = [], 0, 0
    budget = {"rows": 0, "bytes": 0, "deadline": time.monotonic() + 5}
    while budget["rows"] < MAX_SCAN and budget["bytes"] < MAX_SCAN_BYTES and time.monotonic() < budget["deadline"]:
        result = page(db, run_id, limit=1000, cursor=cursor, where=where, _budget=budget)
        scanned += result["scanned"]
        for row in result["items"]:
            y = lookup(row["values"], key)
            coordinate = lookup(row["values"], x) if x else row["event_id"] - 1
            if coordinate is _MISSING and x in ('step', '/step'):
                coordinate = row['event_id'] - 1
            if _number(y) and _number(coordinate):
                points.append({"x": coordinate, "y": y, "event_id": row["event_id"]})
        cursor = result["next_cursor"]
        if cursor is None:
            break
    downsampled = len(points) > max_points
    if downsampled:
        points = [points[round(i * (len(points)-1)/(max_points-1))] for i in range(max_points)]
    return {"points": points, "scanned": scanned, "downsampled": downsampled, "truncated": cursor is not None}
