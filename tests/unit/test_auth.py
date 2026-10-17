"""One configured server token; browser and SDK carry the same credential."""
import pytest
from fastapi.testclient import TestClient
from cairn.server.app import create_app

@pytest.mark.parametrize('header,expected', [(None,200),('Bearer invalid',401),('Basic invalid',401),('Bearer secret',200)])
def test_header_takes_precedence_over_browser_cookie(tmp_path, header, expected):
    with TestClient(create_app(data_dir=tmp_path, auth_enabled=True, token='secret')) as client:
        assert client.post('/api/auth/login', json={'token':'secret'}).status_code == 200
        headers={} if header is None else {'Authorization':header}
        assert client.get('/api/projects',headers=headers).status_code == expected

def test_default_server_auth_creates_private_persistent_token(tmp_path, monkeypatch):
    import stat
    monkeypatch.delenv('CAIRN_TOKEN', raising=False)
    monkeypatch.delenv('CAIRN_TOKEN_FILE', raising=False)
    app = create_app(data_dir=tmp_path)
    token = (tmp_path/'token').read_text().strip()
    assert len(token) >= 32
    assert stat.S_IMODE((tmp_path/'token').stat().st_mode) == 0o600
    assert create_app(data_dir=tmp_path).state.token == token
    with TestClient(app) as client:
        assert client.get('/api/health').status_code == 200
        assert client.get('/api/projects').status_code == 401
        assert client.get('/api/projects', headers={'Authorization': 'Bearer '+token}).status_code == 200


def test_token_creation_is_atomic_under_concurrent_startup(tmp_path):
    from concurrent.futures import ThreadPoolExecutor
    from cairn.server.auth import ensure_token_file
    with ThreadPoolExecutor(max_workers=12) as pool:
        tokens = list(pool.map(lambda _: ensure_token_file(tmp_path/'token'), range(40)))
    assert len(set(tokens)) == 1
    assert list(tmp_path.iterdir()) == [tmp_path/'token']


def test_auth_disabled_never_creates_token(tmp_path, monkeypatch):
    monkeypatch.setenv('CAIRN_TOKEN', '')
    with TestClient(create_app(data_dir=tmp_path, auth_enabled=False)) as client:
        assert client.get('/api/projects').status_code == 200
    assert not (tmp_path/'token').exists()


def test_credential_precedence(tmp_path, monkeypatch):
    monkeypatch.setenv('CAIRN_TOKEN', 'environment')
    assert create_app(data_dir=tmp_path, token='explicit').state.token == 'explicit'
    assert create_app(data_dir=tmp_path).state.token == 'environment'
    assert not (tmp_path/'token').exists()
    monkeypatch.delenv('CAIRN_TOKEN')
    file = tmp_path/'custom-token'
    file.write_text('from-file\n')
    monkeypatch.setenv('CAIRN_TOKEN_FILE', str(file))
    assert create_app(data_dir=tmp_path).state.token == 'from-file'


@pytest.mark.parametrize('token', ['', 'two words', 'with\nnewline', 'x'*4097])
def test_invalid_token_is_rejected(tmp_path, token):
    with pytest.raises(ValueError, match='token must'):
        create_app(data_dir=tmp_path, token=token)


def test_token_file_rejects_symlink_and_oversize(tmp_path):
    from cairn.server.auth import ensure_token_file
    target = tmp_path/'target'
    target.write_text('secret')
    link = tmp_path/'link'
    link.symlink_to(target)
    with pytest.raises(OSError):
        ensure_token_file(link)
    target.write_text('x'*4097)
    with pytest.raises(ValueError, match='at most 4096'):
        ensure_token_file(target)


def test_logout_clears_browser_credential_but_keeps_sdk_token(tmp_path):
    with TestClient(create_app(data_dir=tmp_path,auth_enabled=True,token='secret')) as client:
        response=client.post('/api/auth/login',json={'token':'secret'})
        assert 'HttpOnly' in response.headers['set-cookie']
        assert 'SameSite=strict' in response.headers['set-cookie']
        assert client.post('/api/auth/logout').status_code == 200
        assert client.get('/api/projects').status_code == 401
        assert client.get('/api/projects',headers={'Authorization':'Bearer secret'}).status_code == 200

def test_cookie_is_scoped_to_the_repo(tmp_path):
    with TestClient(create_app(data_dir=tmp_path/'one',auth_enabled=True,token='one')) as first:
        first.post('/api/auth/login',json={'token':'one'})
        with TestClient(create_app(data_dir=tmp_path/'two',auth_enabled=True,token='two')) as second:
            second.cookies.update(first.cookies)
            response=second.get('/api/projects')
            assert response.status_code == 401
