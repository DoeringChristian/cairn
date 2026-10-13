"""The record frame of a run's log (TFRecord-style), see the 0.6 spec §2.

A segment file starts with an 8-byte header: ``b"CAIRNLG"`` plus one byte
naming the format version and the checksum, ``1`` = crc32c (Castagnoli),
``2`` = zlib's crc32 (written where the ``crc32c`` package is missing). Each
record after it is::

    u64 len | u32 crc(len bytes) | payload[len] | u32 crc(payload)

little endian. The payload is UTF-8 JSON ``{"seq", "op", "t", ...op fields}``.

Decoding stops at the first frame that is truncated or fails a check:
everything before it is valid (a torn tail after a crash).
"""

from __future__ import annotations

import json
import struct
import zlib
from collections.abc import Callable
from typing import Any

MAGIC = b"CAIRNLG"
HEADER_LEN = 8
#: Header byte 7: the checksum of every frame in the segment.
CRC32C = 1
CRC32 = 2
_U64 = struct.Struct("<Q")
_U32 = struct.Struct("<I")
#: len + crc(len)
FRAME_HEAD = 12
#: len + crc(len) + crc(payload)
FRAME_OVERHEAD = 16
#: A length above this is damage, not a record (the writer never makes one).
MAX_RECORD = 1 << 30
#: Keys every record carries next to its op's own fields.
RESERVED = ("seq", "op", "t")


class CorruptRecord(ValueError):
    """A frame or segment header fails its check."""


def _crc32c_table() -> list[int]:
    poly = 0x82F63B78
    table = []
    for i in range(256):
        c = i
        for _ in range(8):
            c = (c >> 1) ^ poly if c & 1 else c >> 1
        table.append(c)
    return table


_TABLE: list[int] | None = None


def crc32c_py(data: bytes) -> int:
    """Pure-Python crc32c: reads a crc32c segment where the package is missing
    (slow, but a run directory copied to such a machine still syncs)."""
    global _TABLE
    if _TABLE is None:
        _TABLE = _crc32c_table()
    t = _TABLE
    c = 0xFFFFFFFF
    for b in data:
        c = t[(c ^ b) & 0xFF] ^ (c >> 8)
    return c ^ 0xFFFFFFFF


try:  # pragma: no cover - which branch runs depends on the environment
    import crc32c as _crc32c_mod

    def _crc32c(data: bytes) -> int:
        return _crc32c_mod.crc32c(data)

    HAVE_CRC32C = True
except ImportError:  # pragma: no cover
    _crc32c = crc32c_py
    HAVE_CRC32C = False


def _zlib_crc(data: bytes) -> int:
    return zlib.crc32(data) & 0xFFFFFFFF


def crc_function(kind: int) -> Callable[[bytes], int]:
    if kind == CRC32C:
        return _crc32c
    if kind == CRC32:
        return _zlib_crc
    raise CorruptRecord(f"unknown log format/checksum byte {kind}")


def default_kind() -> int:
    """What a new segment uses: crc32c when the package is installed."""
    return CRC32C if HAVE_CRC32C else CRC32


def header(kind: int) -> bytes:
    crc_function(kind)
    return MAGIC + bytes([kind])


def parse_header(data: bytes) -> int:
    """The checksum kind of a segment header.

    Raises:
        CorruptRecord: Not a cairn log segment, or an unknown version.
    """
    if len(data) < HEADER_LEN or data[:7] != MAGIC:
        raise CorruptRecord("not a cairn log segment (bad magic)")
    kind = data[7]
    crc_function(kind)
    return kind


def encode_payload(record: dict[str, Any]) -> bytes:
    # Python's JSON dialect (NaN/Infinity allowed): config values may be
    # NaN, and the server parses with Python's json too.
    return json.dumps(record, separators=(",", ":")).encode("utf-8")


def encode_frame(payload: bytes, kind: int) -> bytes:
    crc = crc_function(kind)
    n = _U64.pack(len(payload))
    return b"".join((n, _U32.pack(crc(n)), payload, _U32.pack(crc(payload))))


def make_record(seq: int, op: str, t: float, fields: dict[str, Any]) -> dict[str, Any]:
    clash = [k for k in RESERVED if k in fields]
    if clash:
        raise ValueError(f"record fields may not use the reserved keys {clash}")
    return {"seq": seq, "op": op, "t": t, **fields}


#: ``decode_frames``' problem when it stopped at ``max_bytes``.
LIMIT = "limit"
TRUNCATED = "truncated"


def decode_frames(
    data: bytes | memoryview, kind: int, start: int = 0, *, max_bytes: int | None = None,
) -> tuple[list[tuple[int, bytes]], int, str | None]:
    """Decode the frames in ``data`` from offset ``start``.

    Returns ``(frames, end, problem)``: ``frames`` as ``(end offset,
    payload)``, ``end`` the offset after the last good frame, and
    ``problem`` None at a clean end, ``"truncated"`` when the data ends
    inside a frame, ``"limit"`` when the payloads reached ``max_bytes``, or
    a description of the failed check.
    """
    crc = crc_function(kind)
    mv = memoryview(data)
    size = len(mv)
    out: list[tuple[int, bytes]] = []
    pos = start
    total = 0
    while pos < size:
        if max_bytes is not None and total >= max_bytes:
            return out, pos, LIMIT
        if size - pos < FRAME_HEAD:
            return out, pos, TRUNCATED
        n_bytes = bytes(mv[pos:pos + 8])
        (n,) = _U64.unpack(n_bytes)
        (n_crc,) = _U32.unpack(mv[pos + 8:pos + 12])
        if crc(n_bytes) != n_crc:
            return out, pos, f"length checksum mismatch at offset {pos}"
        if n > MAX_RECORD:
            return out, pos, f"implausible record length {n} at offset {pos}"
        end = pos + FRAME_HEAD + n + 4
        if end > size:
            return out, pos, TRUNCATED
        payload = bytes(mv[pos + FRAME_HEAD:pos + FRAME_HEAD + n])
        (p_crc,) = _U32.unpack(mv[end - 4:end])
        if crc(payload) != p_crc:
            return out, pos, f"payload checksum mismatch at offset {pos}"
        out.append((end, payload))
        total += n
        pos = end
    return out, pos, None


def decode_payload(payload: bytes) -> dict[str, Any]:
    """A frame's JSON record.

    Raises:
        CorruptRecord: Not a JSON object with an int ``seq`` and a str ``op``.
    """
    try:
        rec = json.loads(payload)
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise CorruptRecord(f"record is not JSON: {exc}") from None
    if (
        not isinstance(rec, dict)
        or not isinstance(rec.get("seq"), int)
        or not isinstance(rec.get("op"), str)
    ):
        raise CorruptRecord("record lacks seq/op")
    return rec


#: Ops whose ``hash`` names a blob of the run directory, which the server
#: must hold before it applies the record.
BLOB_OPS = ("artifact_meta", "source")


def record_blobs(record: dict[str, Any]) -> list[str]:
    """The blob hashes a record needs on the server first: a blob op's
    ``hash``, an artifact version's manifest ``digest``, a point's
    ``artifact_hash`` (their bytes were stored by an earlier ``artifact_meta``
    of this run; listing them again is cheap, the uploader remembers what the
    server has)."""
    op = record.get("op")
    if op in BLOB_OPS and isinstance(record.get("hash"), str):
        return [record["hash"]]
    if op == "create_artifact_version" and isinstance(record.get("digest"), str):
        return [record["digest"]]
    if op == "batch":
        out: list[str] = []
        for p in record.get("points") or []:
            h = p.get("artifact_hash") if isinstance(p, dict) else None
            if isinstance(h, str) and h not in out:
                out.append(h)
        return out
    return []
