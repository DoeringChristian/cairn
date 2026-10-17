import hashlib
import json
import pytest
import cairn
from cairn.backend import report_inline,report_workspaces
from cairn.backend.repository import Repository
from cairn.backend.report_publications import publish


def test_inline_exact_included_range_preserves_neighbors_and_versions(tmp_path):
    repo=Repository(tmp_path/'repo')
    try:
        source='---\ntitle: Study\n---\nBefore.\n\n{{< include sections/body.md >}}\nAfter.\n'
        included='First.\n\nTarget.\n\nLast.\n'
        files={'sources/report.qmd':source,'sources/sections/body.md':included,'study/index.html':'old',
               'study/document.json':json.dumps({'blocks':[{'id':'target','type':'markdown','source':{'file':'sections/body.md','line':3,'end_line':4,'hash':hashlib.sha256(included.encode()).hexdigest()}}]})}
        artifact=cairn.Artifact('report-study',type='report')
        for name,text in files.items(): artifact.add(text.encode(),name)
        version=cairn.log_artifact(artifact,project='study',repo=repo.repo_root)
        published=publish(repo._db,'study','study','Study',source,version.id,expected_version=None)
        workspace=report_workspaces.create(repo._db,repo.blobs,report_id=published['id'])
        selected=report_inline.block(repo._db,repo.blobs,workspace['id'],'target')
        assert selected['text']=='Target.\n\n'
        updated=report_inline.update(repo._db,repo.blobs,workspace['id'],'target',expected_revision=1,replacement='Changed.\n\n')
        assert updated['revision']==2
        assert next(f['text'] for f in updated['files'] if f['path']=='sections/body.md')=='First.\n\nChanged.\n\nLast.\n'
        assert repo.blobs.get(hashlib.sha256(included.encode()).hexdigest()).decode()==included
        with pytest.raises(report_workspaces.Conflict):
            report_inline.update(repo._db,repo.blobs,workspace['id'],'target',expected_revision=1,replacement='Lost update')
        with pytest.raises(LookupError): report_inline.block(repo._db,repo.blobs,workspace['id'],'unknown')
    finally: repo.close()


def test_inline_frontmatter_reformatting_does_not_shift_wrong_paragraph(tmp_path):
    repo=Repository(tmp_path/'repo')
    try:
        source='---\ntitle: Study\n---\nTarget.\nNeighbor.\n'
        artifact=cairn.Artifact('report-study',type='report')
        artifact.add(source.encode(),'sources/report.qmd');artifact.add(b'old','study/index.html')
        artifact.add(json.dumps({'blocks':[{'id':'target','type':'markdown','source':{'file':'report.qmd','line':4,'end_line':4,'hash':hashlib.sha256(source.encode()).hexdigest()}}]}).encode(),'study/document.json')
        version=cairn.log_artifact(artifact,project='study',repo=repo.repo_root)
        published=publish(repo._db,'study','study','Study',source,version.id,expected_version=None)
        workspace=report_workspaces.create(repo._db,repo.blobs,report_id=published['id'])
        reformatted=source.replace('title: Study','title: Study\ninputs: {}')
        report_workspaces.update(repo._db,repo.blobs,workspace['id'],files={'report.qmd':reformatted},expected_revision=1)
        selected=report_inline.block(repo._db,repo.blobs,workspace['id'],'target')
        assert selected['line']==5 and selected['text']=='Target.\n'
        updated=report_inline.update(repo._db,repo.blobs,workspace['id'],'target',expected_revision=2,replacement='Replaced.')
        text=next(f['text'] for f in updated['files'] if f['path']=='report.qmd')
        assert text=='---\ntitle: Study\ninputs: {}\n---\nReplaced.\nNeighbor.\n'
    finally: repo.close()
