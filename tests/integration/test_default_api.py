"""Record vectors checked against the local Prism2 SDK, including missing step."""
import pytest
import cairn

QUIET = dict(capture_source=False, capture_stdout=False, capture_env=False, capture_system_metrics=False)

@pytest.fixture(autouse=True)
def cleanup_default():
    cairn.finish()
    yield
    cairn.finish()


def test_default_run_workflow(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv('CAIRN_PROJECT', 'demo')
    assert cairn.run is None
    with pytest.raises(RuntimeError, match='init'):
        cairn.log({'loss': 1})
    run = cairn.init(repo=tmp_path/'repo', config={'lr': .1}, **QUIET)
    assert cairn.run is run
    cairn.define_metric('loss', summary='min')
    cairn.log({'loss': 2., 'accuracy': .3})
    cairn.log({'loss': 1.})
    run.config.update({'epochs': 2})
    run.summary['score'] = .9
    run.summary(conclusion='done')
    assert run.config['lr'] == .1
    assert dict(run.summary) == {'score': .9, 'conclusion': 'done'}
    cairn.finish()
    assert cairn.run is None
    with cairn.Reader(tmp_path/'repo') as reader:
        stored = reader.run(run.id)
        assert stored.status == 'completed'
        assert list(stored.sequence('loss').values) == [2., 1.]
        assert stored.config == {'lr': .1, 'epochs': 2}
        assert stored.summary['score'] == .9
        assert stored.final['loss'] == 1.


def test_records_match_prism_reference(tmp_path):
    entries = [{'loss': .5, 'step': 10, 'meta': {'split': 'train'}, 'ok': True},
               {'loss': .4, 'step': 10}, {'loss': .3, 'step': 2}, {'loss': .2},
               {'name': 'hello', 'items': [1, None, False]}]
    with cairn.init('demo', repo=tmp_path/'repo', **QUIET) as run:
        for entry in entries:
            cairn.log(entry)
        assert run.step == len(entries)
    with cairn.Reader(tmp_path/'repo') as reader:
        stored = reader.run(run.id)
        assert [row['values'] for row in stored.records()['items']] == entries
        # Actual Prism2 output: repeated/decreasing x retained; absent step uses index.
        points = stored.record_series('loss')['points']
        assert [(point['x'], point['y']) for point in points] == [(10, .5), (10, .4), (2, .3), (3, .2)]



def test_explicit_runs_do_not_change_default(tmp_path):
    with cairn.init('demo', repo=tmp_path/'repo', **QUIET) as default:
        with pytest.raises(RuntimeError, match='active'):
            cairn.init('demo',repo=tmp_path/'repo',**QUIET)
        with cairn.Run('demo',repo=tmp_path/'repo',**QUIET) as other:
            other.log({'loss': 7})
            cairn.log({'loss': 2})
            assert cairn.run is default
    assert cairn.run is None
    with cairn.Reader(tmp_path/'repo') as reader:
        assert reader.run(default.id).final['loss'] == 2
        assert reader.run(other.id).final['loss'] == 7
    with cairn.init('demo',repo=tmp_path/'repo',**QUIET):
        cairn.log({'loss': 1})


def test_disabled_and_validation(tmp_path):
    with cairn.init('demo', mode='disabled',config={'lr':.1}) as run:
        assert run.config['lr'] == .1
        cairn.log({'loss': 1})
        with pytest.raises(TypeError):
            cairn.log([1,2])
        with pytest.raises(ValueError):
            cairn.log({'loss': float('nan')})
    assert cairn.run is None


def test_failure_marks_run_failed(tmp_path):
    with pytest.raises(ValueError):
        with cairn.init('demo',repo=tmp_path/'repo',**QUIET) as run:
            cairn.log({'loss':2},commit=False)
            raise ValueError('training failed')
    assert cairn.run is None
    with cairn.Reader(tmp_path/'repo') as reader:
        assert reader.run(run.id).status == 'failed'
        assert reader.run(run.id).final['loss'] == 2


def test_default_api_remote_and_artifacts(tmp_path, live_server, monkeypatch):
    from cairn.sdk.runlog.rundir import RunDir
    from cairn.uploader.sync import sync_paths
    monkeypatch.setenv('CAIRN_DIR', str(tmp_path/'buffer'))
    monkeypatch.setenv('CAIRN_UPLOADER', 'off')
    with cairn.init('demo', repo=live_server, config={'lr': .2}, **QUIET) as run:
        cairn.log({'loss': .2, 'description': cairn.Text('done')})
        artifact = cairn.log_artifact(b'model bytes', 'model')
        run.summary['score'] = .8
    rd = RunDir.for_run(run.id)
    assert sync_paths([rd])[rd.path] is None
    with cairn.Reader(live_server) as reader:
        stored = reader.run(run.id)
        assert stored.final['loss'] == .2
        assert stored.config['lr'] == .2
        assert stored.summary['score'] == .8
        assert reader.artifact('demo/model:v1').id == artifact.id
    assert not list((tmp_path/'buffer').rglob('*.db'))
