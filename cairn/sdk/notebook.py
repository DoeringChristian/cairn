"""A run's page inline in a notebook (Jupyter, marimo).

``cairn.Run`` and a ``Reader`` run implement the notebook display protocol
through here: the last expression of a cell renders the run page (its
Workspace tab, live) in an iframe, ``run.display(tab=..., height=...)`` picks
the tab. The element comes from the viewer's Python surface (``cairn.ui``,
the ``ui`` extra), imported only when a notebook asks; without the extra the
run displays as its plain repr.
"""

from __future__ import annotations

from typing import Any

DEFAULT_TAB = "workspace"
DEFAULT_HEIGHT = 720


def run_element(
    run_id: str,
    *,
    server: str | None,
    repo_path: str | None,
    tab: str = DEFAULT_TAB,
    height: int = DEFAULT_HEIGHT,
) -> Any:
    """The run page element (``cairn.ui.PageElement``). Raises ImportError
    without the ``ui`` extra."""
    try:
        from cairn_ui.cards.pages import run_page
    except ImportError as exc:
        raise ImportError(
            "Showing a run in a notebook needs the Cairn viewer: "
            "pip install 'cairn-track[ui]'"
        ) from exc
    return run_page(run_id, tab=tab, height=height, server=server, repo_path=repo_path)


def run_html(run_id: str, *, server: str | None, repo_path: str | None) -> str | None:
    """The default display's HTML, or None (plain repr) without the extra."""
    try:
        element = run_element(run_id, server=server, repo_path=repo_path)
    except ImportError:
        return None
    return element._repr_html_()
