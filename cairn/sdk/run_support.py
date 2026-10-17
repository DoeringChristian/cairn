"""Small shared run identity and destination helpers."""
from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from .. import config
from .run_ids import auto_label, check_label, check_run_id, env_run_id


def _resolve_process(
    label: str | None, primary: bool | None, run_id: str | None, resume: str | None,
) -> tuple[str | None, bool, str | None]:
    """``cairn.Run``'s process arguments -> ``(label, primary, run id)``: the
    label (``"auto"`` resolved), the role (an explicit ``primary`` wins over
    the detected one) and the id given by ``run_id`` or ``CAIRN_RUN_ID``."""
    detected = True
    if label == "auto":
        label, detected = auto_label()
    if label is not None:
        check_label(label)
    primary = detected if primary is None else bool(primary)
    if run_id is not None and resume is not None:
        raise ValueError("pass resume or run_id, not both: resume names the run")
    given = check_run_id(run_id) if run_id is not None else None
    env = env_run_id()
    if given is None and env is not None:
        given = check_run_id(env)
        if resume is not None and resume != given:
            raise ValueError(
                f"resume={resume!r} is not the run CAIRN_RUN_ID names ({given!r})"
            )
    if not primary:
        if given is None:
            raise ValueError(
                "a worker (primary=False) needs the run's id: run_id= or CAIRN_RUN_ID"
            )
        if label is None:
            raise ValueError("a worker (primary=False) needs a label")
    return label, primary, None if resume is not None else given


def _repo_ref(repo: str | None) -> Any:
    """What ``run_page_url`` reads a local repo's root from."""
    from types import SimpleNamespace

    return SimpleNamespace(repo_root=Path(repo)) if repo else None


def _resolve_endpoint_target(
    repo: str | Path | None, server: str | None,
) -> tuple[str | None, str | None]:
    """``(server URL, None)`` or ``(None, absolute local repo path)``."""
    if server is not None:
        if repo is not None:
            raise ValueError("choose a local repo or a remote server, not both")
        return config._as_server_url(server).rstrip("/"), None
    target = config.resolve_target(repo=repo)
    if not target.is_local:
        return target.location.rstrip("/"), None
    return None, str(Path(target.location).expanduser().resolve())


def _sdk_version() -> str | None:
    try:
        from importlib.metadata import version

        return version("cairn-track")
    except Exception:  # noqa: BLE001
        return None


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _used_run_id(run: Any) -> str:
    """A ``use_run`` / ``uses=`` entry -> the run id it names."""
    rid = getattr(run, "id", run)
    if not isinstance(rid, str) or not rid.strip():
        raise ValueError(f"expected a run id or a run, not {run!r}")
    return rid
