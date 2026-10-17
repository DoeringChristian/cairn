"""Copied server credentials work without configuring an environment variable."""
from pathlib import Path
import shutil

import pytest

from cairn import config
from cairn.server.app import create_app
from cairn.sdk.transport import Transport


@pytest.fixture(autouse=True)
def isolated_credentials(tmp_path, monkeypatch):
    for name in ('CAIRN_TOKEN', 'CAIRN_TOKEN_FILE', 'CAIRN_DIR'):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setenv('XDG_CONFIG_HOME', str(tmp_path/'user-config'))
    monkeypatch.setattr(config, 'config_file_path', lambda: tmp_path/'saved'/'config.toml')
    monkeypatch.chdir(tmp_path)


def write_token(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(value+'\n')
    return path


def test_client_credential_precedence(tmp_path, monkeypatch):
    server = 'http://example.test:4300'
    global_file = write_token(config.user_token_file(), 'global')
    config.save_token(server, 'saved')
    project_file = write_token(tmp_path/'.cairn'/'token', 'project')
    explicit_file = write_token(tmp_path/'custom-token', 'file')
    monkeypatch.setenv('CAIRN_TOKEN_FILE', str(explicit_file))
    monkeypatch.setenv('CAIRN_TOKEN', 'environment')
    assert config.resolve_token(server, 'explicit') == 'explicit'
    assert config.resolve_token(server) == 'environment'
    monkeypatch.delenv('CAIRN_TOKEN')
    assert config.resolve_token(server) == 'file'
    monkeypatch.delenv('CAIRN_TOKEN_FILE')
    assert config.resolve_token(server) == 'project'
    project_file.unlink()
    assert config.resolve_token(server) == 'saved'
    assert config.resolve_token('http://another.test:4300') == 'global'
    config.save_token(server, None)
    assert config.resolve_token(server) == 'global'
    global_file.unlink()
    assert config.resolve_token(server) is None


def test_nearest_project_boundary_does_not_inherit_parent_credentials(tmp_path, monkeypatch):
    write_token(tmp_path/'.cairn'/'token', 'parent')
    nested = tmp_path/'nested'
    nested_token = write_token(nested/'.cairn'/'token', 'nested')
    working = nested/'scripts'/'analysis'
    working.mkdir(parents=True)
    monkeypatch.chdir(working)
    assert config.resolve_token('http://server.test') == 'nested'
    nested_token.unlink()
    assert config.resolve_token('http://server.test') is None
    config.save_token('http://server.test', 'saved')
    assert config.resolve_token('http://server.test') == 'saved'


def test_cairn_dir_overrides_project_discovery(tmp_path, monkeypatch):
    write_token(tmp_path/'.cairn'/'token', 'project')
    override = write_token(tmp_path/'override'/'token', 'override')
    monkeypatch.setenv('CAIRN_DIR', str(override.parent))
    assert config.resolve_token('http://server.test') == 'override'
    override.unlink()
    assert config.resolve_token('http://server.test') is None


def test_default_global_token_uses_dot_config_on_every_platform(tmp_path, monkeypatch):
    monkeypatch.delenv('XDG_CONFIG_HOME')
    monkeypatch.setattr(Path, 'home', lambda: tmp_path)
    file = write_token(tmp_path/'.config'/'cairn'/'token', 'global')
    assert config.user_token_file() == file
    assert config.resolve_token('http://server.test') == 'global'
    assert not (tmp_path/'.cairn').exists()


def test_missing_explicit_token_file_is_an_error(tmp_path, monkeypatch):
    write_token(config.user_token_file(), 'global')
    monkeypatch.setenv('CAIRN_TOKEN_FILE', str(tmp_path/'missing'))
    with pytest.raises(FileNotFoundError):
        config.resolve_token('http://server.test')


@pytest.mark.parametrize('content', [b'secret value', b'private\xff', b'x'*4097, b''])
def test_malformed_discovered_credential_never_leaks_contents(tmp_path, content):
    file = config.user_token_file()
    file.parent.mkdir(parents=True)
    file.write_bytes(content)
    with pytest.raises(ValueError) as exc:
        config.resolve_token('http://server.test')
    assert str(exc.value) in {
        'token must be nonempty, at most 4096 characters, without whitespace',
        'token file must be a regular file of at most 4096 bytes',
        'token file must contain a UTF-8 token',
    }
    assert 'secret' not in str(exc.value)
    assert 'private' not in str(exc.value)


def test_invalid_explicit_and_environment_tokens_do_not_leak(monkeypatch):
    credential = 'secret credential'
    with pytest.raises(ValueError) as explicit_error:
        config.resolve_token('http://server.test', credential)
    monkeypatch.setenv('CAIRN_TOKEN', credential)
    with pytest.raises(ValueError) as environment_error:
        config.resolve_token('http://server.test')
    assert credential not in str(explicit_error.value)
    assert credential not in str(environment_error.value)


def test_server_does_not_adopt_client_discovery_tokens(tmp_path):
    write_token(config.user_token_file(), 'global')
    write_token(tmp_path/'.cairn'/'token', 'project')
    app = create_app(data_dir=tmp_path/'server-repo', mount_ui=False)
    assert app.state.token not in ('project', 'global')
    assert (tmp_path/'server-repo'/'token').read_text().strip() == app.state.token


@pytest.fixture
def app(tmp_path, isolated_credentials):
    return create_app(data_dir=tmp_path/'server-repo', mount_ui=False)


@pytest.mark.parametrize('destination', ['project', 'global'])
def test_sdk_authenticates_with_copied_server_token_without_env(app, live_server, tmp_path, destination):
    # The server's credential file can be copied unchanged to either client
    # discovery location; SDK calls carry it without cairn.login or env setup.
    target = tmp_path/'.cairn'/'token' if destination == 'project' else config.user_token_file()
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(app.state.token_file, target)
    transport = Transport(live_server, max_retries=1)
    try:
        assert transport.get('/api/auth/session').json()['authenticated'] is True
        assert transport.get('/api/projects').status_code == 200
    finally:
        transport.close()
