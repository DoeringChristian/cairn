"""Explicit, isolated report builds from immutable source and evidence captures.

Each build uses a fresh Jupyter kernel. Only successful builds replace the local
preview; failed builds retain their notebook and diagnostics.
"""
from __future__ import annotations

import json
import os
import shutil
import tempfile
import uuid
from dataclasses import dataclass
from pathlib import Path

import nbformat
from nbclient import NotebookClient
from jupyter_client import KernelManager
from jupyter_client.kernelspec import KernelSpecManager

from .config import Config, load_config
from .engine import (
    ENGINE_VERSION, ReportError, _json, _hash, _file_hash, _read_source, _frontmatter_sources,
    _document_notebook, render_notebook, document_record,
)
from .environment import _resolve_environment, _provision_environment
from .inputs import materialize, verify_snapshot


@dataclass
class Build:
    key: str
    generated: Path
    markdown: Path
    content_root: Path
    inputs: dict
    sources: dict
    meta: dict
    source_ref: str


def discover_reports(config: Config):
    folders = {p.parent for pattern in ('*/report.qmd', '*/report.md')
               for p in config.reports_dir.glob(pattern)}
    return {p.name: p for p in sorted(folders)}


def source_entry(folder):
    entries = [name for name in ('report.qmd', 'report.md') if (folder / name).is_file()]
    if len(entries) != 1:
        raise ReportError('a report must have exactly one entry: report.qmd (or report.md)')
    return entries[0]


def _capture_tree(source, destination):
    destination.mkdir(parents=True)
    hashes = {}
    for path in sorted(source.rglob('*')):
        relative = path.relative_to(source)
        if any(part.startswith('.') or part == '__pycache__' for part in relative.parts):
            continue
        if path.is_symlink():
            raise ReportError(f'report sources cannot contain symlinks: {relative}')
        if not path.is_file():
            continue
        target = destination / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(path, target)
        hashes[relative.as_posix()] = _file_hash(target)
    return hashes


def _execute(notebook, root, environment, lock, options):
    unsupported = set(options) - {'enabled', 'timeout', 'cache'}
    if unsupported:
        raise ReportError(f'Unsupported execute options: {sorted(unsupported)}')
    if options.get('enabled', True) is False:
        return
    executable = _provision_environment(environment, lock)
    # Separate kernelspec and IPC directory for every build; no global registration.
    kernel_root = root / '.cairn-kernels'
    kernel = kernel_root / 'cairn'
    kernel.mkdir(parents=True)
    (kernel / 'kernel.json').write_text(_json({
        'argv': [str(executable), '-m', 'ipykernel_launcher', '-f', '{connection_file}'],
        'display_name': 'Cairn report', 'language': 'python',
    }))
    # Unix socket names must remain short even under a deeply nested project.
    with tempfile.TemporaryDirectory(prefix='ck-', dir='/tmp') as sockets:
        manager = KernelManager(kernel_name='cairn', transport='ipc', ip=sockets+'/kernel',
                                connection_file=sockets+'/connection.json',
                                kernel_spec_manager=KernelSpecManager(kernel_dirs=[str(kernel_root)]))
        client = NotebookClient(notebook, km=manager, timeout=int(options.get('timeout', 120)),
                                resources={'metadata': {'path': str(root)}}, record_timing=False)
        client.execute(cleanup_kc=True)


def _preview(config, key, outputs):
    config.output_dir.mkdir(parents=True, exist_ok=True)
    latest = config.output_dir/key
    link = config.output_dir/('.'+key+'-'+uuid.uuid4().hex)
    link.symlink_to(outputs, target_is_directory=True)
    if latest.is_dir() and not latest.is_symlink():
        latest.rename(outputs.parent/'previous-preview')
    os.replace(link,latest)


def build_report(config: Config, key: str, folder: Path, *, prepared=None, force=False) -> Build:
    from cairn.backend.report_publications import SLUG
    if not SLUG.fullmatch(key):
        raise ReportError(f'invalid report slug: {key}')
    build_root = config.cairn_dir / 'report-builds' / uuid.uuid4().hex
    source = build_root / 'sources'
    outputs = build_root / key
    workspace = build_root / 'work'
    build_root.mkdir(parents=True)
    notebook = None
    inputs = {}
    try:
        source_hashes = _capture_tree(folder, source)
        entry = source_entry(source)
        meta, mapped = _read_source(source, entry)
        environment, lock = ((prepared['environment'], prepared['lock']) if prepared is not None
                             else _resolve_environment(meta.get('environment')))
        environment_hash = _hash(_json(environment) + lock.decode())
        (build_root / 'environment.json').write_text(_json(environment))
        (build_root / 'requirements.lock').write_bytes(lock)
        declarations = meta.get('inputs', {})
        if not isinstance(declarations, dict):
            raise ReportError('inputs must map names to run/artifact references')
        input_paths, input_info = {}, {}
        for role, ref in declarations.items():
            if not isinstance(role, str) or not SLUG.fullmatch(role):
                raise ReportError(f'invalid input role: {role!r}')
            item = prepared['inputs'][role] if prepared is not None else materialize(str(ref), config)
            captured = build_root / 'evidence' / role
            captured.parent.mkdir(parents=True, exist_ok=True)
            shutil.copytree(item['path'], captured)
            item = {**item, 'path': captured}
            inputs[role] = item
            metadata = {}
            for name in ('config', 'summary'):
                path = captured / f'{name}.json'
                if path.is_file():
                    metadata[name] = json.loads(path.read_text())
            input_info[role] = {'ref': item['resolved'], 'metadata': metadata}
            input_paths[role] = str(captured)
        pins = {role: {k: v for k, v in item.items() if k != 'path'} for role, item in inputs.items()}
        from . import cache
        engine_hash = cache.implementation_hash()
        cache_key = _hash(_json({'files': source_hashes, 'inputs': pins, 'environment': environment_hash, 'engine':engine_hash}))
        source_ref = 'report:' + cache_key
        shutil.copytree(source, workspace)
        notebook, source_map = _document_notebook(mapped, meta, input_paths, input_info)
        notebook.metadata['cairn'] = _frontmatter_sources(source, entry)
        provenance = {'engine': ENGINE_VERSION, 'engine_hash':engine_hash, 'source_ref': source_ref,
                      'entry': entry,
                      'environment_hash': environment_hash, 'environment': environment,
                      'sources': source_hashes, 'inputs': pins, 'parameters': meta.get('parameters', {}),
                      'execution': 'fresh-kernel' if meta.get('execute', {}).get('enabled', True) else 'disabled', 'hermetic': False,
                      'undeclared_external_reads': 'not tracked'}
        (build_root / 'prepared.json').write_text(_json(provenance))
        if meta.get('execute', {}).get('cache', False) and not force and cache.restore(config,cache_key,outputs):
            (build_root/'status.json').write_text(_json({'status':'completed','cache_hit':True,'source_ref':source_ref}))
            _preview(config,key,outputs)
            return Build(key,outputs,source/entry,source,inputs,source_hashes,meta,source_ref)
        _execute(notebook, workspace, environment, lock, meta.get('execute', {}))
        for item in inputs.values():
            verify_snapshot(item['path'], item['snapshot'])
        # Preserve the immutable source and expose generated media alongside output.
        outputs.mkdir()
        for path in workspace.rglob('*'):
            rel = path.relative_to(workspace)
            if any(part.startswith('.') or part == '__pycache__' for part in rel.parts):
                continue
            if path.is_symlink():
                raise ReportError(f'generated report file is a symlink: {rel}')
            if path.is_file():
                target = outputs / rel
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(path, target)
        document, warnings = render_notebook(notebook, meta, source_map, workspace, provenance)
        record = document_record(notebook, meta, outputs, provenance)
        record['inputs'] = pins
        provenance['warnings'] = warnings
        (outputs / 'index.html').write_text(document)
        (outputs / 'document.json').write_text(_json(record))
        (outputs / 'source-map.json').write_text(_json(source_map))
        (outputs / 'manifest.json').write_text(_json(provenance))
        nbformat.write(notebook, outputs / 'notebook.ipynb')
        (build_root / 'status.json').write_text(_json({'status': 'completed'}))
        if meta.get('execute', {}).get('cache', False):
            cache.save(config,cache_key,outputs)
        _preview(config,key,outputs)
        print(f'built {key}: {config.output_dir/key/"index.html"}')
        return Build(key, outputs, source / entry, source, inputs, source_hashes, meta, source_ref)
    except BaseException as exc:
        if notebook is not None:
            nbformat.write(notebook, build_root / 'failed.ipynb')
        (build_root / 'status.json').write_text(_json({'status': 'failed', 'error': str(exc)}))
        raise
    finally:
        shutil.rmtree(workspace, ignore_errors=True)


def build_all(config: Config | None = None, report: str | None = None, *, prepared=None, force=False) -> list[Build]:
    config = config or load_config()
    reports = discover_reports(config)
    if report is not None:
        if report not in reports:
            raise ReportError(f'unknown report: {report}')
        reports = {report: reports[report]}
    return [build_report(config, key, folder, prepared=prepared, force=force) for key, folder in reports.items()]
