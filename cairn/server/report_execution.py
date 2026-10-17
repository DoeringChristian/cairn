"""Optional report execution belongs to the server, not the read API."""
from fastapi import HTTPException, Request

UNAVAILABLE = "Report execution is unavailable; install cairn-track[reports] on the server."


def execution_services():
    """Load execution only when its optional dependencies are installed."""
    try:
        from cairn.reports.notebook import NotebookManager
        from cairn.reports.worker import Worker
    except ModuleNotFoundError as exc:
        # Missing third-party dependencies disable execution. A missing Cairn
        # module is a broken installation and must retain its real exception.
        if not exc.name or exc.name.split('.', 1)[0] == 'cairn':
            raise
        return None
    return NotebookManager, Worker


def require_notebooks(request: Request):
    manager = getattr(request.app.state, 'notebooks', None)
    if manager is None:
        raise HTTPException(503, UNAVAILABLE)
    return manager
