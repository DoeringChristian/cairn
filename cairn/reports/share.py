"""Export one report as the standalone HTML produced by the report engine."""
from pathlib import Path
from .build import build_all


def share(config, report=None, build=True, out=None):
    if report is None:
        raise ValueError('export requires one report slug')
    source = build_all(config, report=report)[0].generated/'index.html' if build else config.output_dir/report/'index.html'
    target = Path(out or config.cairn_dir/'share'/f'{report}.html').resolve()
    if target.is_relative_to(config.reports_dir.resolve()):
        raise ValueError('export output must be outside report sources')
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(source.read_bytes())
    return target
