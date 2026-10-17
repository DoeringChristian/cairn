"""Keep storage/domain operations independent of HTTP and SDK adapters."""
import ast
from pathlib import Path


def _imports(source, package):
    for node in ast.walk(ast.parse(source)):
        if isinstance(node, ast.Import):
            for alias in node.names:
                yield node.lineno, alias.name
        elif isinstance(node, ast.ImportFrom):
            prefix = package[:len(package) - node.level + 1] if node.level else []
            module = '.'.join([*prefix, *([node.module] if node.module else [])])
            yield node.lineno, module
            for alias in node.names:
                yield node.lineno, f'{module}.{alias.name}'


def test_backend_does_not_import_server_or_sdk():
    import cairn
    root = Path(cairn.__file__).parent/'backend'
    violations = []
    for path in root.rglob('*.py'):
        package = ['cairn', 'backend', *path.relative_to(root).parent.parts]
        for lineno, module in _imports(path.read_text(), package):
            if any(module == forbidden or module.startswith(forbidden + '.')
                   for forbidden in ('fastapi', 'cairn.server', 'cairn.sdk', 'cairn.uploader')):
                violations.append(f'{path.relative_to(root)}:{lineno}: {module}')
    assert not violations, '\n'.join(violations)


def test_boundary_check_resolves_relative_imports_and_aliases():
    assert (1, 'cairn.sdk') in set(_imports('from ... import sdk', ['cairn', 'backend', 'storage']))
    assert (1, 'cairn.server.app') in set(_imports('from ..server import app', ['cairn', 'backend']))
    assert (1, 'cairn.backend.storage.db') in set(_imports('from .storage import db', ['cairn', 'backend']))
