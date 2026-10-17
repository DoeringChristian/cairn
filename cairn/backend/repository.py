"""Direct local storage. SQLite serializes writers; no HTTP or server discovery."""
from __future__ import annotations
from pathlib import Path
from typing import Any
from cairn.backend import ingest_ops
from cairn.backend.storage.blobs import BlobStore
from cairn.backend.storage.datadir import DataDir
from cairn.backend.startup import open_repo_database
from cairn.backend.storage.db import Database

class Repository:
    def __init__(self, repo: str | Path, *, timeout: float = 10.0) -> None:
        from .storage.context import StorageConfig
        if isinstance(repo, StorageConfig):
            self._db, self.blobs, self.data_dir = repo.open()
            self.repo_root = self.data_dir.root
            self.server_url = self.repo_root.as_uri()
            self.token = None
            return
        self.data_dir = DataDir(Path(repo))
        self.repo_root = self.data_dir.root
        self.blobs = BlobStore(self.data_dir.artifacts_dir)
        self.server_url = self.repo_root.as_uri()
        self.token = None
        self._db = open_repo_database(self.data_dir, self.blobs)

    def close(self):
        self._db.close()

    def read_run_edit(self, run_id):
        from .run_edits import read
        return read(self._db, run_id)

    def edit_run(self, run_id, *, expected_revision, changes, delete=None):
        from .run_edits import edit
        return edit(self._db, run_id, expected_revision=expected_revision, changes=changes, delete=delete)

    def list_viewers(self, project, all_versions=False):
        from cairn.backend.common import slugify
        from cairn.backend.custom_viewers import builtin_viewers, published_viewers
        return [v.entry() for v in builtin_viewers().values()] + published_viewers(self._db, slugify(project), all_versions=all_versions)

    def current_publication(self, project_id, slug):
        from cairn.backend.report_publications import current_version
        from cairn.backend.common import slugify
        return current_version(self._db, slugify(project_id), slug)

    def publish_report(self, body):
        from cairn.backend.report_publications import publish
        from cairn.backend.common import slugify
        return publish(self._db, **{**body, 'project_id': slugify(body['project_id'])})

    def remove_report(self, report_id, *, expected_version):
        from cairn.backend.report_publications import remove
        return remove(self._db, report_id, expected_version=expected_version)

    def sequence_steps(self, run_id):
        return self._db.read_columns(
            "SELECT name, MAX(step) AS max_step, MAX(summary) AS summary FROM sequences WHERE run_id = ? GROUP BY name", [run_id])

    def should_stop(self, run_id):
        row = self._db.read_one("SELECT stop_requested FROM runs WHERE id = ?", [run_id])
        return bool(row and row[0])

    def read_run(self, run_id):
        from cairn.backend.run_reads import run_details
        return run_details(self._db, [run_id]).get(run_id)

    # ---- runs --------------------------------------------------------------

    def create_run(self, body: dict[str, Any]) -> dict[str, Any]:
        fields = {k: body.get(k) for k in ingest_ops.CREATE_RUN_FIELDS}
        return ingest_ops.create_run(self._db, project=body['project'], **fields)

    def post_batch(self, run_id: str, points: list[dict[str, Any]]) -> bool:
        def local(db: Database) -> bool:
            ingest_ops.insert_batch(db, run_id, points)
            return True
        return local(self._db)

    def post_params(self, run_id: str, params: dict[str, Any]) -> None:
        ingest_ops.set_params(self._db, run_id, params)

    def post_summary(self, run_id: str, summary: dict[str, Any]) -> None:
        ingest_ops.set_summary(self._db, run_id, summary)

    def post_logs(self, run_id: str, lines: list[dict[str, Any]]) -> bool:
        def local(db: Database) -> bool:
            ingest_ops.insert_logs(db, self.data_dir, run_id, lines)
            return True
        return local(self._db)

    def finish_run(
        self, run_id: str, status: str, exit_code: int | None = None,
        ended_at: str | None = None,
    ) -> None:
        ingest_ops.finish_run(self._db, run_id, status, exit_code, ended_at)

    def set_tags(self, run_id: str, tags: list[str]) -> None:
        ingest_ops.set_tags(self._db, run_id, tags)

    def set_notes(self, run_id: str, notes: str) -> None:
        ingest_ops.set_notes(self._db, run_id, notes)

    def rename_run(self, run_id: str, name: str) -> dict[str, Any]:
        """-> ``{"display_name", "version"}`` (the run's number in its new series)."""
        return ingest_ops.rename_run(self._db, run_id, name)

    def delete_keys(self, run_id: str, table: str, keys: list[str]) -> None:
        ingest_ops.delete_keys(self._db, run_id, table, keys)

    def set_metric_rule(
        self, run_id: str, name: str, x: str | None, summary: str | None,
    ) -> None:
        ingest_ops.set_metric_rule(self._db, run_id, name, x, summary)

    def upload_source(self, run_id: str, archive: bytes, manifest: dict[str, Any]) -> None:
        ingest_ops.save_source(self._db, self.blobs, run_id, archive, manifest)

    def upload_artifact(
        self, data: bytes, mime_type: str, metadata: dict[str, Any] | None = None,
        object_type: str | None = None,
    ) -> str:
        return ingest_ops.put_artifact(self._db, self.blobs, data, mime_type, metadata, object_type=object_type)['hash']

    def download_artifact_bytes(self, digest: str) -> bytes:
        return self.blobs.get(digest)

    def drain_spill(self, run_id: str | None = None) -> int:
        return 0

    # ---- versioned artifact registry ------------------------------------------

    def create_artifact_version(self, project_id: str, body: dict[str, Any]) -> dict[str, Any]:
        from cairn.backend import artifact_registry_ops as ops

        return ops.create_version(self._db, self.blobs, project_id=project_id, **body)

    def resolve_artifact(self, project_id: str, ref: str) -> dict[str, Any]:
        """``[project/]name[:alias|:vN]`` -> the version dict."""
        from cairn.backend import artifact_registry_ops as ops

        return ops.resolve_ref(self._db, project_id, ref)

    def record_artifact_input(self, run_id: str, artifact_version_id: str, role: str) -> None:
        from cairn.backend import artifact_registry_ops as ops

        ops.record_input(self._db, run_id=run_id, artifact_version_id=artifact_version_id, role=role)

    def record_run_use(self, run_id: str, used_run_id: str, role: str | None) -> None:
        from cairn.backend import artifact_registry_ops as ops

        ops.record_run_use(self._db, run_id=run_id, used_run_id=used_run_id, role=role)

    def add_artifact_alias(self, version_id: str, alias: str) -> dict[str, Any]:
        from cairn.backend import artifact_registry_ops as ops
        return ops.add_alias(self._db, version_id, alias)

    def remove_artifact_alias(self, version_id: str, alias: str) -> dict[str, Any]:
        from cairn.backend import artifact_registry_ops as ops
        return ops.remove_alias(self._db, version_id, alias)

    def add_artifact_tag(self, version_id: str, tag: str) -> dict[str, Any]:
        from cairn.backend import artifact_registry_ops as ops
        return ops.add_tag(self._db, version_id, tag)

    def remove_artifact_tag(self, version_id: str, tag: str) -> dict[str, Any]:
        from cairn.backend import artifact_registry_ops as ops
        return ops.remove_tag(self._db, version_id, tag)

    def update_artifact_version(self, version_id: str, body: dict[str, Any]) -> dict[str, Any]:
        from cairn.backend import artifact_registry_ops as ops
        return ops.update_version(self._db, version_id, **body)

    def delete_artifact_version(self, version_id: str, force: bool) -> None:
        from cairn.backend import artifact_registry_ops as ops
        ops.delete_version(self._db, version_id, force=force)

    def delete_artifact_family(self, project_id: str, name: str) -> None:
        from cairn.backend import artifact_registry_ops as ops

        def local(db: Database) -> None:
            fam = ops.get_family_by_name(db, project_id, name)
            if fam is None:
                raise LookupError(f"no artifact {name!r} in project {project_id!r}")
            ops.delete_family(db, fam["id"])
        local(self._db)

    # ---- sweeps ----------------------------------------------------------------

    def create_sweep(self, body: dict[str, Any]) -> dict[str, Any]:
        from cairn.backend import sweep_ops

        def local(db: Database) -> dict[str, Any]:
            b = dict(body)
            sweep_ops.check_keys(b, (*sweep_ops.CONFIG_KEYS, "sweep_id"))
            return sweep_ops.create_sweep(db, space=b.pop("parameters"), **b)
        return local(self._db)

    def list_sweeps(self, project: str | None = None) -> list[dict[str, Any]]:
        from cairn.backend import sweep_ops
        from cairn.backend.common import slugify
        return sweep_ops.list_sweeps(self._db, slugify(project) if project else None)

    def get_sweep(self, sweep_id: str) -> dict[str, Any]:
        from cairn.backend import sweep_ops
        return sweep_ops.get_sweep(self._db, sweep_id)

    def sweep_action(self, sweep_id: str, action: str) -> dict[str, Any]:
        from cairn.backend import sweep_ops
        return sweep_ops.set_status(self._db, sweep_id, action)

    def next_trial(self, sweep_id: str) -> dict[str, Any]:
        from cairn.backend import sweep_ops
        return sweep_ops.next_trial(self._db, sweep_id)

    def report_trial(self, sweep_id: str, trial_id: str, **body: Any) -> dict[str, Any]:
        from cairn.backend import sweep_ops
        return sweep_ops.report_trial(self._db, sweep_id, trial_id, **body)
