"""Startup links consume the same server token through a URL fragment."""
from urllib.parse import parse_qs, urlsplit

from click.testing import CliRunner
import pytest

from cairn import cli


@pytest.fixture
def served(monkeypatch):
    calls = []
    monkeypatch.setattr(cli, '_serve', lambda *args, **kwargs: calls.append((args, kwargs)))
    monkeypatch.delenv('CAIRN_TOKEN_FILE', raising=False)
    return calls


@pytest.mark.parametrize('host,expected', [
    ('127.0.0.1', '127.0.0.1'), ('0.0.0.0', '127.0.0.1'),
    ('::', '[::1]'), ('::1', '[::1]'), ('[::1]', '[::1]'),
    ('2001:db8::12', '[2001:db8::12]'), ('lab.example', 'lab.example'),
])
def test_startup_login_link_encodes_token_and_formats_host(tmp_path, monkeypatch, served, host, expected):
    token = 'a+b&c/d#e'
    monkeypatch.setenv('CAIRN_TOKEN', token)
    result = CliRunner().invoke(cli.main, ['server', '--repo', str(tmp_path/'repo'), '--host', host, '--port', '4322'])
    assert result.exit_code == 0, result.output
    line = next(line for line in result.output.splitlines() if line.startswith('Browser login: '))
    url = line.removeprefix('Browser login: ')
    parsed = urlsplit(url)
    assert parsed.netloc == expected+':4322'
    assert parsed.path == '/login'
    assert parsed.query == ''
    assert parse_qs(parsed.fragment) == {'token': [token]}
    assert token not in result.output  # special characters are URL encoded
    assert served[0][0][1:3] == (host, 4322)


def test_server_token_file_link_uses_the_persistent_token(tmp_path, monkeypatch, served):
    monkeypatch.delenv('CAIRN_TOKEN', raising=False)
    token_file = tmp_path/'private'/'server-token'
    args = ['server', '--repo', str(tmp_path/'repo'), '--token-file', str(token_file)]
    first = CliRunner().invoke(cli.main, args)
    assert first.exit_code == 0, first.output
    token = token_file.read_text().strip()
    assert 'Access token file: '+str(token_file) in first.output
    assert 'Browser login: http://127.0.0.1:4300/login#token='+token in first.output
    second = CliRunner().invoke(cli.main, args)
    assert second.exit_code == 0, second.output
    assert second.output == first.output


@pytest.mark.parametrize('options', [['--no-auth'], ['--no-ui'], ['--no-auth', '--no-ui']])
def test_no_login_link_for_api_only_or_unauthenticated_server(tmp_path, monkeypatch, served, options):
    monkeypatch.setenv('CAIRN_TOKEN', 'private-server-token')
    result = CliRunner().invoke(cli.main, ['server', '--repo', str(tmp_path/'repo'), *options])
    assert result.exit_code == 0, result.output
    assert 'Browser login' not in result.output
    assert 'private-server-token' not in result.output


def test_serve_prints_valid_ipv6_url(monkeypatch, capsys):
    monkeypatch.setattr('uvicorn.run', lambda *args, **kwargs: None)
    cli._serve(object(), '::', 4300)
    assert capsys.readouterr().out == 'Cairn: http://[::1]:4300\n'
