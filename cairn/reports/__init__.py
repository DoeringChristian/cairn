"""Executable Markdown reports backed by tracker runs and artifact versions."""
def build_all(report=None, *, project=None, repo=None, namespace='default'):
    from .build import build_all as build
    from .config import load_config
    return build(load_config(project, repo=repo, namespace=namespace), report)
