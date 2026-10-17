"""Revision-bound annotations on immutable report publications.

Rendered-text offsets are browser coordinates. The server validates the selected
blocks and stores exact/context text; it never silently moves an annotation to a
new publication or guesses a Markdown-to-DOM offset conversion.
"""
from __future__ import annotations
import json
import secrets
from . import reports
from .common import utc_now
from .report_publications import PublicationConflict


def _publication(db, report_id, revision_id, project):
    report=reports.read(db,report_id,project=project)
    if not isinstance(revision_id,str) or not db.read_one('SELECT 1 FROM report_publications WHERE report_id=? AND version_id=?',[report_id,revision_id]):
        raise LookupError('report publication not found')
    return report


def _out(row):
    return {**row,'selection':json.loads(row['selection']) if row.get('selection') else None,'can_edit':True}


def _get(db, report_id, comment_id):
    rows=db.read_columns('SELECT * FROM comments WHERE report_id=? AND id=?',[report_id,comment_id])
    if not rows: raise LookupError('comment not found')
    return rows[0]


def _body(body):
    if not isinstance(body,str) or not body.strip() or len(body.encode())>65536:
        raise ValueError('Comment body must contain 1–65536 UTF-8 bytes')
    return body


def _anchor(db, blobs, report, revision_id, kind, anchor_id, quote, selection):
    if kind=='report':
        if selection is not None: raise ValueError('Report anchors cannot contain a passage selection')
        return None,None,None
    if kind not in {'block','card','quote'} or not isinstance(anchor_id,str):
        raise ValueError('Anchor requires a report, block, card or quote kind and block id')
    slug=report['payload']['compiled']['slug']
    entry=reports.file_entry(db,report['id'],f'{slug}/document.json',version_id=revision_id)
    document=json.loads(blobs.path_for(entry['digest']).read_text())
    blocks={block['id']:block for block in document['blocks']}
    if anchor_id not in blocks: raise ValueError('Anchor block does not exist in this publication')
    if kind=='card' and blocks[anchor_id]['type']!='card': raise ValueError('Card anchor must reference a card')
    if kind!='quote':
        if selection is not None: raise ValueError('Only quote anchors accept a passage selection')
        return anchor_id,None,None
    if not isinstance(selection,dict) or set(selection)!={'schema','exact','prefix','suffix','start','end'} or selection['schema']!='cairn.text-selection/v1':
        raise ValueError('Quote anchor requires a cairn.text-selection/v1 selection')
    for key,limit in [('exact',16384),('prefix',256),('suffix',256)]:
        if not isinstance(selection[key],str) or len(selection[key].encode())>limit:
            raise ValueError(f'Invalid selection {key}')
    if not selection['exact'].strip() or quote!=selection['exact']: raise ValueError('Quote must equal the selected exact text')
    ids=list(blocks)
    for endpoint in ('start','end'):
        item=selection[endpoint]
        if not isinstance(item,dict) or set(item)!={'block_id','offset'} or not isinstance(item['block_id'],str) or item['block_id'] not in blocks or type(item['offset']) is not int or not 0<=item['offset']<=10000000:
            raise ValueError('Selection endpoints require existing block ids and nonnegative offsets')
    start,end=selection['start'],selection['end']
    if start['block_id']!=anchor_id or ids.index(end['block_id'])<ids.index(start['block_id']) or (start['block_id']==end['block_id'] and end['offset']<=start['offset']):
        raise ValueError('Selection endpoints are out of order')
    return anchor_id,quote,json.dumps(selection,ensure_ascii=False)


def list_comments(db, report_id, revision_id, *, project):
    _publication(db,report_id,revision_id,project)
    return {'comments':[_out(row) for row in db.read_columns('SELECT * FROM comments WHERE report_id=? AND revision_id=? ORDER BY created_at,id',[report_id,revision_id])]}


def create(db, blobs, report_id, *, project, revision_id, body, author, parent_id=None, anchor_kind=None, anchor_id=None, quote=None, selection=None):
    with db.transaction(immediate=True):
        db.lock_resource('report',report_id)
        report=_publication(db,report_id,revision_id,project)
        if parent_id is not None:
            parent=_get(db,report_id,parent_id)
            if parent['parent_id'] is not None or parent['revision_id']!=revision_id:
                raise ValueError('Replies must reference a thread root in the same publication')
            anchor_kind,anchor_id,quote,stored_selection=(parent[key] for key in ('anchor_kind','anchor_id','quote','selection'))
        else:
            anchor_id,quote,stored_selection=_anchor(db,blobs,report,revision_id,anchor_kind,anchor_id,quote,selection)
        now=utc_now().isoformat();cid=secrets.token_hex(12)
        db.write('''INSERT INTO comments(id,report_id,parent_id,anchor_kind,anchor_id,quote,body,author_id,author,created_at,updated_at,revision_id,selection,revision)
                    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,1)''',[cid,report_id,parent_id,anchor_kind,anchor_id,quote,_body(body),author,author,now,now,revision_id,stored_selection])
        return _out(_get(db,report_id,cid))


def mutate(db, report_id, comment_id, *, project, expected_revision, operation, body=None, resolved=None, author):
    with db.transaction(immediate=True):
        db.lock_resource('report',report_id)
        reports.read(db,report_id,project=project)
        row=_get(db,report_id,comment_id)
        if type(expected_revision) is not int or expected_revision!=row['revision']:
            raise PublicationConflict('Comment changed since it was read; reload before editing')
        now=utc_now().isoformat()
        if operation=='delete':
            deleted=[comment_id,*[r[0] for r in db.read('SELECT id FROM comments WHERE report_id=? AND parent_id=?',[report_id,comment_id])]]
            db.write('DELETE FROM comments WHERE report_id=? AND (id=? OR parent_id=?)',[report_id,comment_id,comment_id])
            return {'deleted':deleted}
        if operation=='edit':
            db.write('UPDATE comments SET body=?,updated_at=?,revision=revision+1 WHERE id=?',[_body(body),now,comment_id])
        elif operation=='resolve':
            if row['parent_id'] is not None: raise ValueError('Resolve the thread root')
            if type(resolved) is not bool: raise ValueError('resolved must be true or false')
            db.write('UPDATE comments SET resolved_at=?,resolved_by=?,updated_at=?,revision=revision+1 WHERE id=?',[now if resolved else None,author if resolved else None,now,comment_id])
        else: raise ValueError('Unknown comment operation')
        return _out(_get(db,report_id,comment_id))
