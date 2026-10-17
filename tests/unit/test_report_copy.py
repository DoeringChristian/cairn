"""The explicit CLI copy slug creates a fork, while default copying edits the family."""
from cairn.backend.repository import Repository
from cairn.reports.remote import copy_report
from tests.unit.test_report_workspaces import initial


def test_copy_report_explicit_slug_forks_and_default_preserves_name(tmp_path):
    root = tmp_path / 'repo'
    store = Repository(root)
    try:
        report, version = initial(store._db, store.blobs)
    finally:
        store.close()
    copied = copy_report(report['id'], project=tmp_path / 'fork', repo=root,
                         slug='revised-study', version=version['id'])
    assert copied.name == 'revised-study'
    assert (copied / 'report.qmd').read_text() == 'first'
    same = copy_report(report['id'], project=tmp_path / 'edit', repo=root)
    assert same.name == 'study'
    assert (same / 'report.qmd').read_text() == 'first'
