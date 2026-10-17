"""Run artifact production and consumption."""
from __future__ import annotations

import secrets
import time
from pathlib import Path
from typing import Any
from ..sdk.handlers.registry import HandlerRegistry
from cairn.backend import artifact_registry_ops as _registry_rules
from cairn.backend import config_doc
from .artifacts import Artifact, ArtifactVersion, draft_from_shorthand
from .runlog.rundir import RunDir
from .runlog.server import ServerReads, ServerUnavailable
from .runlog.writer import RunWriter
from .run_support import _used_run_id


class RunArtifacts:
    """Publish and consume artifacts, run dependencies and custom viewers.

    Uses the lifecycle-owned writer and target; artifact caches are owned here."""

    def _init_artifact_state(self):
        self._logged_names: set[str] = set()
        self._backend_cache: Any = None

    def log_artifact(
        self,
        artifact: Artifact | str | Path | Any,
        name: str | None = None,
        *,
        type: str = "artifact",
        aliases: list[str] | None = None,
        tags: list[str] | None = None,
        step: int | None = None,
        metadata: dict | None = None,
        description: str | None = None,
    ) -> ArtifactVersion:
        """Log a new version of an artifact, produced by this run.

        ``artifact`` is a ``cairn.Artifact`` draft (its name, type, metadata
        and description are used; passing ``name``/``type``/``metadata``/
        ``description`` too is a ``TypeError``), or a shorthand needing
        ``name``: a directory path (every file under it), a file path (stored
        at its basename), or any other value (stored at ``"<name>.<ext>"``:
        wrappers with their handler, bytes as is, anything else pickled).

            run.log_artifact(model.state_dict(), "ckpt", type="model", step=epoch,
                             aliases=["best"] if improved else None)

        Every call creates a new version, even for identical content.
        ``latest`` always moves to it; ``aliases`` (user aliases) move to it
        too. ``tags`` are added to the version (beside a draft's own).
        ``step`` places it on the run's timeline.

        Returns:
            The new ``ArtifactVersion``. On a local repo the version number
            is assigned when the log is ingested: until then it is pending
            (``version`` None); ``.wait()`` blocks until it is assigned.

        Raises:
            TypeError: A draft together with name/type/metadata/description,
                or a shorthand without a name.
            FileNotFoundError: A shorthand path that does not exist.
            ValueError: A reserved alias (``latest``, ``vN``), a bad name, or
                a type differing from the artifact's existing type.
        """
        if self._finished:
            raise RuntimeError("Run has already been finished")
        draft = self._draft(artifact, name, type, metadata, description)
        self._logged_names.add(draft.name)
        return self._log_draft(draft, aliases, step, created_by_run=self._run_id, tags=tags)


    def _draft(
        self, artifact: Any, name: str | None, type: str, metadata: dict | None,
        description: str | None,
    ) -> Artifact:
        if isinstance(artifact, Artifact):
            extra = [k for k, v in (("name", name), ("metadata", metadata),
                                    ("description", description)) if v is not None]
            if type != "artifact":
                extra.append("type")
            if extra:
                raise TypeError(
                    f"log_artifact got a cairn.Artifact and {', '.join(extra)}; set those on "
                    "the Artifact instead"
                )
            return artifact
        draft = draft_from_shorthand(artifact, name, type, self._registry)
        draft.metadata = dict(metadata or {})
        draft.description = description
        return draft


    def _log_draft(
        self, draft: Artifact, aliases: list[str] | None, step: int | None,
        *, created_by_run: str | None, tags: list[str] | None = None,
    ) -> ArtifactVersion:
        return log_draft(
            self._writer, self._registry, self._project_id, draft, aliases, step,
            created_by_run=created_by_run, backend=self._reader_backend, tags=tags,
        )


    def _reader_backend(self) -> Any:
        """The Reader backend over this run's target (ArtifactVersion reads)."""
        if getattr(self, "_backend_cache", None) is None:
            from .reader import Reader

            self._backend_cache = Reader(repo=self._ep_server or self._ep_repo)._backend
        return self._backend_cache


    def log_model(
        self, path: str | Path, name: str | None = None, aliases: list[str] | None = None,
    ) -> ArtifactVersion:
        """Log a file or directory as a new version of a ``model`` artifact
        (wandb's ``run.log_model``): ``log_artifact(path, name, type="model")``.

        ``name`` defaults to ``run-<run id>-<basename of path>``, so logging
        the same path again makes a new version of the same artifact.
        ``aliases`` move to the new version beside ``latest``.
        """
        p = Path(path)
        if name is None:
            name = f"run-{self.id}-{p.resolve().name}"
        return self.log_artifact(p, name, type="model", aliases=aliases)


    def use_model(self, ref: str) -> str:
        """Use a model artifact and download it (wandb's ``run.use_model``):
        records it as this run's input (role ``model``) and returns the local
        path of its files (see ``ArtifactVersion.download``)."""
        return str(self.use_artifact(ref, role="model").download())


    def use_artifact(self, ref: str | ArtifactVersion, *, role: str = "input") -> ArtifactVersion:
        """Consume an artifact version: resolve it now and record it as an
        input of this run (re-using the same version is a no-op).

        ``ref`` is ``"name"`` (= ``name:latest``), ``"name:alias"``,
        ``"name:vN"``, ``"project/name:..."`` for another project, or an
        ``ArtifactVersion``. The resolved immutable version is recorded, not
        the alias.

            ckpt = run.use_artifact("base-ckpt:best")
            model.load_state_dict(ckpt.get())

        Returns:
            The ``ArtifactVersion`` (``.get()`` for a logged object,
            ``.download()`` for files).

        The ref is resolved on the server. A version this run logged itself
        is waited for (up to 10 s) while its upload is on the way; one logged
        by another run is found once that run's directory has uploaded it.

        Raises:
            LookupError: No such artifact, alias or version.
        """
        if self._finished:
            raise RuntimeError("Run has already been finished")
        if isinstance(ref, ArtifactVersion):
            # An immutable version, pending or not: recorded by its id, no
            # server needed.
            self._writer.record_artifact_input(self._run_id, ref.id, role)
            return ref
        # A version this run logged may still be on its way to the server:
        # commit now and give the upload a moment before calling it missing.
        self._writer.flush()
        deadline = time.monotonic() + 10.0
        try:
            while True:
                try:
                    info = self._reads._call("use_artifact", lambda api: api.resolve_artifact(self._project_id, ref))
                    break
                except LookupError:
                    if time.monotonic() > deadline or not self._logged_artifact(ref):
                        raise
                    time.sleep(0.1)
        except ServerUnavailable as exc:
            raise ServerUnavailable(
                f"use_artifact({ref!r}) resolves the ref on the server, which cannot be "
                f"reached: {exc}. Pass an ArtifactVersion to use one without the server."
            ) from None
        self._writer.record_artifact_input(self._run_id, info["id"], role)
        return ArtifactVersion(info, self._reader_backend)


    def _logged_artifact(self, ref: str) -> bool:
        """Whether this run logged (in this process) the family ``ref`` names."""
        name = ref.split("/")[-1].split(":")[0]
        return name in self._logged_names


    def use_run(self, run: Any, *, role: str | None = None) -> None:
        """Record that this run used another run directly ("v used u"),
        without an artifact between them: e.g. an evaluation that reads a
        training run's metrics. Lineage graphs show it as a ``used`` edge
        from that run to this one. Re-recording a link is a no-op (the first
        ``role`` stays).

        ``run`` is a run id, or anything with an ``.id`` (a ``cairn.Run``, a
        Reader run).

        Raises:
            ValueError: An empty id, or this run itself.
            LookupError: No such run.
        """
        if self._finished:
            raise RuntimeError("Run has already been finished")
        used = _used_run_id(run)
        if used == self._run_id:
            raise ValueError("a run cannot use itself")
        if not RunDir.for_run(used, Path(self._ep_repo) if self._ep_repo else None).exists():
            try:
                known = self._reads.run(used) is not None
            except ServerUnavailable:
                known = True  # offline: the server checks it when it applies the record
            if not known:
                raise LookupError(f"run {used} not found")
        self._writer.record_run_use(self._run_id, used, role)


    def use_viewer(
        self, path: str | Path, *, aliases: list[str] | None = None, default_for: list[str] | None = None,
    ) -> ArtifactVersion:
        """Publish a custom viewer folder to this run's project if it changed,
        so a training script keeps its viewer in sync with its data.

        The folder (``cairn-viewer.json`` + ES modules) becomes a new version
        of the artifact ``<manifest name>`` (type ``cairn-viewer``) only when
        its content differs from ``latest``; the run is recorded as its
        producer. See ``cairn.publish_viewer``.

            run.use_viewer("viewers/vmf")
            run.track(cairn.Data(lobes, kind="guiding/vmf"), "guide", step)

        ``default_for`` makes it the default viewer of those kinds (built-in
        types like ``"volume"``, or custom kinds); without it, it becomes the
        default only of the custom kinds it accepts that have none yet.

        Returns:
            The viewer's ``ArtifactVersion`` (new, or the unchanged ``latest``).

        Raises:
            ManifestError: The folder is not a valid viewer.
        """
        from .custom_viewers import publish_folder

        if self._finished:
            raise RuntimeError("Run has already been finished")
        return publish_folder(
            _ViewerTarget(self._writer, self._reads), self._registry, self._project_id, path,
            aliases=aliases,
            created_by_run=self._run_id, backend=self._reader_backend, default_for=default_for,
        )



class _ViewerTarget:
    """``publish_folder``'s transport for a run: writes go to the run's log,
    the ``latest`` lookup and alias moves to the server."""

    def __init__(self, writer: RunWriter, reads: ServerReads) -> None:
        self._writer = writer
        self._reads = reads

    def upload_artifact(self, *args: Any, **kwargs: Any) -> str:
        return self._writer.upload_artifact(*args, **kwargs)

    def create_artifact_version(self, project_id: str, body: dict[str, Any]) -> None:
        return self._writer.create_artifact_version(project_id, body)

    def resolve_artifact(self, project_id: str, ref: str) -> dict[str, Any]:
        return self._reads.api().resolve_artifact(project_id, ref)

    def add_artifact_alias(self, version_id: str, alias: str) -> dict[str, Any]:
        return self._reads.api().add_artifact_alias(version_id, alias)


def backend_for_transport(transport: Any) -> Any:
    """A Reader backend over the same target as a writer transport."""
    from .reader import _HttpBackend, _LocalBackend
    if getattr(transport, 'repo_root', None) is not None:
        return _LocalBackend(transport.repo_root)
    return _HttpBackend(transport.server_url, token=getattr(transport, "token", None))


def log_draft(
    transport: Any, registry: HandlerRegistry, project_id: str, draft: Artifact,
    aliases: list[str] | None, step: int | None, *, created_by_run: str | None,
    backend: Any, tags: list[str] | None = None,
) -> ArtifactVersion:
    """Upload a draft's entries and manifest, then register the version
    (shared by ``Run.log_artifact`` and ``cairn.log_artifact``)."""
    for alias in aliases or []:
        _registry_rules.validate_user_alias(alias)
    all_tags = _registry_rules.validate_tags([*draft.tags, *(tags or [])])
    if step is not None and (isinstance(step, bool) or not isinstance(step, int)):
        raise TypeError(f"step must be an int, got {step!r}")
    digest, _files = draft._build_manifest(transport, registry)
    body = {
        "name": draft.name,
        "type": draft.type,
        "digest": digest,
        "description": draft.description,
        "metadata": config_doc.normalize(draft.metadata),
        "step": step,
        "created_by_run": created_by_run,
        "aliases": list(dict.fromkeys(aliases or [])),
        "tags": all_tags,
        # Client-generated: a local run logs it and the version is known by it.
        "version_id": secrets.token_hex(8),
    }
    info = transport.create_artifact_version(project_id, body)
    if info is None:  # a local run: registered when the repo ingests its log
        info = {
            "id": body["version_id"], "name": draft.name, "type": draft.type,
            "project_id": project_id, "version": None, "aliases": [], "tags": all_tags,
            "metadata": body["metadata"], "description": draft.description,
            "digest": digest, "step": step, "created_by_run": created_by_run,
        }
    return ArtifactVersion(info, backend)
