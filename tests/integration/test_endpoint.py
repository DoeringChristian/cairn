"""Local tracking never starts a server; viewers must be explicitly started."""
import pytest
import cairn
from cairn.endpoint import EndpointUnavailable, live_server as registered_server, local_endpoint
from cairn.backend.storage.datadir import DataDir


def test_local_run_and_reader_do_not_start_server(tmp_path, monkeypatch):
    def forbidden(*args, **kwargs):
        raise AssertionError("local access must not spawn a server")
    monkeypatch.setattr('subprocess.Popen', forbidden)
    repo = tmp_path / 'repo'
    with cairn.Run('p', repo=repo, capture_source=False, capture_stdout=False,
                   capture_env=False, capture_system_metrics=False) as run:
        run.log({'loss': 0.2})
    with cairn.Reader(repo) as reader:
        assert reader.run(run.id).sequence('loss').values == [0.2]
    assert registered_server(repo) is None
    with pytest.raises(EndpointUnavailable, match='cairn ui'):
        local_endpoint(repo)


def test_explicit_viewer_registration_is_discovered(tmp_path, live_server):
    from urllib.parse import urlsplit
    repo = tmp_path / 'repo'
    parts = urlsplit(live_server)
    dd = DataDir(repo)
    dd.add_live_server('ui', host=parts.hostname, port=parts.port)
    endpoint = local_endpoint(repo)
    assert str(parts.port) in endpoint.url
    dd.remove_live_server()
    assert registered_server(repo) is None
