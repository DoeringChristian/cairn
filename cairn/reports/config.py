"""Report build paths are independent of the selected tracking backend."""
from dataclasses import dataclass
from pathlib import Path
import warnings
@dataclass(frozen=True)
class Config:
    project: Path
    reports_dir: Path
    output_dir: Path
    cairn_dir: Path
    tracking_uri: str | None = None
    namespace: str = 'default'
    extra_css: tuple[Path, ...] = ()
    template_dir: Path | None = None

def load_config(project=None, *, repo=None, namespace='default'):
    from cairn.backend.storage.context import StorageConfig
    root = Path(project or Path.cwd()).resolve()
    return Config(root, root/'reports', root/'.cairn'/'build', root/'.cairn',
                  repo if isinstance(repo, StorageConfig) else str(repo) if repo is not None else None, namespace)

def protect(base, *paths):
    for path in paths:
        if Path(base).resolve() not in Path(path).resolve().parents:
            raise ValueError(f'report output must be inside {base}')

def short_path(path):
    return str(path)

def warn(message):
    warnings.warn(message, stacklevel=2)
