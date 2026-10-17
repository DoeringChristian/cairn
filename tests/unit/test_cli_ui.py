"""Explicit UI/server startup uses one app and one port; no tracking daemon."""
from click.testing import CliRunner
from cairn import cli, config
import pytest


@pytest.fixture
def served(monkeypatch):
    calls = []
    monkeypatch.setattr(cli, '_serve', lambda *args, **kwargs: calls.append((args, kwargs)))
    return calls


def test_local_ui_is_explicit_and_unauthenticated_on_loopback(tmp_path, served):
    result = CliRunner().invoke(cli.main, ['ui', '--repo', str(tmp_path), '--no-open-browser', '--port', '4321'])
    assert result.exit_code == 0, result.output
    args, kwargs = served[0]
    assert args[1:4] == ('127.0.0.1', 4321, False)
    assert args[0].state.auth_enabled is False
    assert kwargs['repo'] == str(tmp_path)


def test_remote_ui_uses_proxy_and_saved_token(tmp_path, monkeypatch, served):
    monkeypatch.setattr(config, 'config_file_path', lambda: tmp_path/'config.toml')
    config.save_token('http://example.test:4300', 'secret')
    seen = []
    monkeypatch.setattr('cairn.server.proxy.create_proxy_app', lambda target, token: seen.append((target, token)) or object())
    result = CliRunner().invoke(cli.main, ['ui', '--repo', 'http://example.test:4300', '--no-open-browser'])
    assert result.exit_code == 0, result.output
    assert seen == [('http://example.test:4300', 'secret')]
    assert served[0][1]['repo'] is None


def test_server_serves_ui_on_the_same_port(tmp_path, monkeypatch, served):
    monkeypatch.setenv('CAIRN_TOKEN', 'secret')
    result = CliRunner().invoke(cli.main, ['server', '--repo', str(tmp_path), '--port', '4322'])
    assert result.exit_code == 0, result.output
    args, kwargs = served[0]
    assert args[1:3] == ('127.0.0.1', 4322)
    assert args[0].state.auth_enabled is True
    assert args[0].state.token == 'secret'
    assert kwargs['repo'] == tmp_path
