"""``cairn viewer add``: vendor an npm package into a viewer folder.

Viewers run with no network, so every library they import must be a file in
the viewer folder, mapped with the manifest's ``imports``. This downloads a
self-contained ES-module build of an npm package (``esm.sh``'s ``?bundle``),
follows its imports (esm.sh serves a stub that imports the real bundle by an
absolute path, and some bundles import shared chunks), mirrors every module
under ``<viewer>/vendor/<host>/<path>`` with absolute imports rewritten to
relative ones, writes an entry module ``vendor/<name>.js`` and records
``imports[name] = "./vendor/<name>.js"``.

Bare imports a bundle leaves in place (``--external three``) must be mapped by
the viewer itself (another ``imports`` entry, or the host's ``cairn:three``).
"""

from __future__ import annotations

import json
import os
import posixpath
import re
from dataclasses import dataclass, field
from pathlib import Path, PurePosixPath
from typing import Callable
from urllib.parse import urljoin, urlsplit

from ..server.viewer_manifest import MANIFEST_FILE, MAX_FOLDER_BYTES

#: Where builds come from.
ESM_CDN = "https://esm.sh"
#: The modules one ``add`` may fetch (a guard against runaway graphs).
MAX_MODULES = 500

Fetcher = Callable[[str], bytes]

_SPEC_RE = re.compile(r"^(@[a-z0-9][\w.-]*/)?([a-z0-9][\w.-]*)(@[^/\s]+)?(/[^\s?#]*)?$", re.I)
# A module specifier in an import/export: `from "x"`, `import "x"`, `import("x")`.
_IMPORT_RE = re.compile(
    r"""(?P<head>\bfrom\s*|\bimport\s*\(\s*|\bimport\s*)(?P<q>["'])(?P<spec>[^"'\s]+)(?P=q)"""
)


@dataclass
class VendorResult:
    """What ``add_package`` did."""

    name: str
    entry: str  # "./vendor/<name>.js"
    files: list[str] = field(default_factory=list)  # paths written, relative to the viewer
    bare_imports: list[str] = field(default_factory=list)  # left for the viewer to map


def default_fetcher(url: str) -> bytes:
    import httpx

    resp = httpx.get(url, follow_redirects=True, timeout=60.0,
                     headers={"User-Agent": "cairn-viewer-add"})
    resp.raise_for_status()
    return resp.content


def import_name(spec: str) -> str:
    """The import specifier an npm spec is mapped to: the spec without its
    version (``d3@7`` -> ``d3``, ``three@0.170/examples/jsm/x.js`` ->
    ``three/examples/jsm/x.js``)."""
    m = _SPEC_RE.match(spec)
    if not m:
        raise ValueError(f"not an npm package spec: {spec!r} (e.g. 'd3@7' or '@scope/pkg@1/sub')")
    return (m.group(1) or "") + m.group(2) + (m.group(4) or "")


def _local_path(url: str) -> str:
    """``vendor``-relative path mirroring ``url`` (host + path; a query folds
    into the file name)."""
    parts = urlsplit(url)
    path = parts.path or "/index"
    if parts.query:
        path += "_" + re.sub(r"[^A-Za-z0-9._-]", "_", parts.query)
    if not path.endswith((".js", ".mjs")):
        path += ".mjs"
    clean = PurePosixPath(parts.netloc, *[p for p in PurePosixPath(path).parts if p not in ("/", "..", ".")])
    return clean.as_posix()


def _is_url_like(spec: str) -> bool:
    return spec.startswith(("/", "./", "../", "http://", "https://"))


def add_package(
    viewer_dir: str | Path,
    spec: str,
    *,
    name: str | None = None,
    externals: list[str] | None = None,
    fetch: Fetcher = default_fetcher,
    cdn: str = ESM_CDN,
) -> VendorResult:
    """Download ``spec`` into ``viewer_dir/vendor`` and map it in the manifest.

    Raises:
        FileNotFoundError: ``viewer_dir`` has no ``cairn-viewer.json``.
        ValueError: A bad spec or name, a module outside http(s), too many
            modules, or a vendor tree that pushes the folder over its cap.
    """
    root = Path(viewer_dir)
    mpath = root / MANIFEST_FILE
    if not mpath.is_file():
        raise FileNotFoundError(f"{root} has no {MANIFEST_FILE}")
    manifest = json.loads(mpath.read_text(encoding="utf-8"))
    key = name or import_name(spec)
    if not key or key.startswith((".", "/")) or key.startswith("cairn:") or ".." in key.split("/"):
        raise ValueError(f"invalid import name {key!r}")
    entry_rel = "vendor/" + (key if key.endswith((".js", ".mjs")) else key + ".js")

    query = "bundle&target=es2022"
    if externals:
        query += "&external=" + ",".join(externals)
    start = f"{cdn.rstrip('/')}/{spec}?{query}"

    modules: dict[str, bytes] = {}  # local path (vendor-relative) -> rewritten source
    bare: set[str] = set()
    pending = [start]
    seen: set[str] = set()
    total = 0
    while pending:
        url = pending.pop()
        if url in seen:
            continue
        seen.add(url)
        if len(seen) > MAX_MODULES:
            raise ValueError(f"{spec} pulls in more than {MAX_MODULES} modules")
        if urlsplit(url).scheme not in ("http", "https"):
            raise ValueError(f"cannot vendor {url!r}: only http(s) modules")
        src = fetch(url).decode("utf-8")

        def rewrite(m: re.Match[str], url: str = url) -> str:
            s = m.group("spec")
            if not _is_url_like(s):
                bare.add(s)
                return m.group(0)
            target = urljoin(url, s)
            if s.startswith(("./", "../")) and url != start:
                pending.append(target)  # mirrored layout: relative stays valid
                return m.group(0)
            pending.append(target)
            return m.group("head") + m.group("q") + "@@" + target + m.group("q")

        src = _IMPORT_RE.sub(rewrite, src)
        modules[url] = src.encode("utf-8")
        total += len(modules[url])
        if total > MAX_FOLDER_BYTES:
            raise ValueError(f"{spec} is larger than the viewer folder cap")

    # Second pass: "@@<url>" markers -> paths relative to each file.
    def file_of(url: str) -> str:
        return entry_rel if url == start else "vendor/" + _local_path(url)

    written: list[str] = []
    for url, data in modules.items():
        rel = file_of(url)
        src = data.decode("utf-8")
        src = re.sub(
            r"""(["'])@@([^"']+)\1""",
            lambda m: m.group(1) + _relative(rel, file_of(m.group(2))) + m.group(1),
            src,
        )
        out = root / rel
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(src, encoding="utf-8")
        written.append(rel)

    imports = manifest.get("imports") if isinstance(manifest.get("imports"), dict) else {}
    imports[key] = "./" + entry_rel
    manifest["imports"] = imports
    mpath.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    return VendorResult(name=key, entry="./" + entry_rel, files=sorted(written), bare_imports=sorted(bare))


def _relative(from_file: str, to_file: str) -> str:
    rel = os.path.relpath(to_file, posixpath.dirname(from_file) or ".").replace(os.sep, "/")
    return rel if rel.startswith("../") else "./" + rel
