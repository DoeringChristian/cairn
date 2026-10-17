"""CLI coverage for the intentionally simplified report-centered command surface."""
import json
from click.testing import CliRunner
from cairn.cli import main
from cairn import config
import cairn

QUIET=dict(capture_source=False,capture_stdout=False,capture_env=False,capture_system_metrics=False)

def test_init_and_runs_without_network(tmp_path,monkeypatch):
    monkeypatch.chdir(tmp_path)
    repo=tmp_path/'.cairn'
    result=CliRunner().invoke(main,['init'])
    assert result.exit_code == 0,result.output
    with cairn.Run('demo',name='fit',repo=repo,**QUIET) as run:
        run.track(0.2,'loss',0)
    result=CliRunner().invoke(main,['runs','--repo',str(repo)])
    assert result.exit_code == 0,result.output
    assert json.loads(result.output)[0]['id'] == run.id
    result=CliRunner().invoke(main,['show',run.id,'--repo',str(repo)])
    assert json.loads(result.output)['metrics']['loss'] == 0.2
    assert not (repo/'server.json').exists()

def test_new_build_publish_list_and_remove_report(tmp_path):
    runner=CliRunner()
    args=['--project-dir',str(tmp_path)]
    result=runner.invoke(main,['report','new','study',*args])
    assert result.exit_code == 0,result.output
    assert runner.invoke(main,['report','new','study',*args]).exit_code != 0
    repo=tmp_path/'repo'
    result=runner.invoke(main,['report','publish','study',*args,'--project','demo','--repo',str(repo)])
    assert result.exit_code == 0,result.output
    result=runner.invoke(main,['report','ls','--repo',str(repo)])
    rows=json.loads(result.output)
    assert rows[0]['name'] == 'Study'
    result=runner.invoke(main,['report','rm',rows[0]['id'],'--repo',str(repo)])
    assert result.exit_code == 0,result.output
    assert json.loads(runner.invoke(main,['report','ls','--repo',str(repo)]).output) == []

def test_server_creates_private_token_and_explicit_no_auth(monkeypatch,tmp_path):
    import cairn.cli as cli
    monkeypatch.delenv('CAIRN_TOKEN',raising=False)
    monkeypatch.delenv('CAIRN_TOKEN_FILE',raising=False)
    apps=[]
    monkeypatch.setattr(cli, '_serve', lambda app, *args, **kwargs: apps.append(app))
    result=CliRunner().invoke(main,['server','--repo',str(tmp_path)])
    assert result.exit_code == 0, result.output
    assert 'Access token file:' in result.output
    assert apps[-1].state.auth_enabled
    assert apps[-1].state.token == (tmp_path/'token').read_text().strip()
    result=CliRunner().invoke(main,['server','--repo',str(tmp_path/'open'),'--no-auth'])
    assert result.exit_code == 0, result.output
    assert not apps[-1].state.auth_enabled
    assert not (tmp_path/'open'/'token').exists()

def test_remote_proxy_cannot_expose_saved_token_on_nonloopback():
    result=CliRunner().invoke(main,['ui','--repo','http://example.invalid','--host','0.0.0.0'])
    assert result.exit_code != 0 and 'cairn server' in result.output
