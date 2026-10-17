"""Exact source-range editing for blocks in a published report.

Source maps are evidence, not fuzzy search hints. A changed draft must be edited
in the full source editor; we never guess which repeated paragraph to replace.
"""
import hashlib
import json
from . import reports, report_workspaces


def _body_start(lines):
    if lines and lines[0].strip()=='---':
        for i,line in enumerate(lines[1:],1):
            if line.strip()=='---': return i+1
    return 0


def block(db, blobs, ident, block_id):
    workspace=report_workspaces._row(db,ident)
    origin=json.loads(workspace['origin']) if workspace.get('origin') else None
    if not origin: raise ValueError('Inline editing requires a workspace from a published report')
    report=reports.read(db,origin['report_id'])
    slug=report['payload']['compiled']['slug']
    def published(path):
        entry=reports.file_entry(db,origin['report_id'],path,version_id=origin['version_id'])
        return blobs.get(entry['digest'])
    document=json.loads(published(f'{slug}/document.json'))
    matches=[item for item in document['blocks'] if item['id']==block_id]
    if len(matches)!=1: raise LookupError('Published source block not found or ambiguous')
    source=matches[0].get('source',{})
    name=source.get('file')
    if not name or name not in workspace['files']: raise LookupError('Block source file not present in workspace')
    original=published('sources/'+name)
    if hashlib.sha256(original).hexdigest()!=source.get('hash'):
        raise report_workspaces.Conflict('Published source map hash does not match its source file')
    current=blobs.get(workspace['files'][name]['hash'])
    old_lines=original.decode('utf-8').splitlines(keepends=True)
    new_lines=current.decode('utf-8').splitlines(keepends=True)
    old_start,new_start=_body_start(old_lines),_body_start(new_lines)
    # Copying pins frontmatter inputs and can change YAML line count.
    if old_lines[old_start:]!=new_lines[new_start:]:
        raise report_workspaces.Conflict('Draft source has changed; use the full source editor or reopen the block from its published version')
    start,end=source.get('line'),source.get('end_line',source.get('line'))
    if type(start) is not int or type(end) is not int or not old_start<start<=end<=len(old_lines):
        raise ValueError('Invalid published source range')
    start+=new_start-old_start;end+=new_start-old_start
    return {'workspace_id':ident,'revision':workspace['revision'],'block_id':block_id,
            'file':name,'line':start,'end_line':end,'hash':workspace['files'][name]['hash'],
            'text':''.join(new_lines[start-1:end]),'type':matches[0]['type']}


def update(db, blobs, ident, block_id, *, expected_revision, replacement):
    if not isinstance(replacement,str) or len(replacement.encode())>report_workspaces.MAX_BYTES:
        raise ValueError('Replacement must be UTF-8 source up to 32 MiB')
    with db.transaction(immediate=True):
        db.lock_resource('report-workspace',ident)
        selected=block(db,blobs,ident,block_id)
        if selected['revision']!=expected_revision:
            raise report_workspaces.Conflict('Draft changed; reopen the block before saving')
        row=report_workspaces._row(db,ident)
        lines=blobs.get(row['files'][selected['file']]['hash']).decode().splitlines(keepends=True)
        # Keep following source on its own line when the editor omits EOF newline.
        if replacement and not replacement.endswith('\n') and selected['end_line']<len(lines): replacement+='\n'
        text=''.join(lines[:selected['line']-1])+replacement+''.join(lines[selected['end_line']:])
        return report_workspaces.update(db,blobs,ident,files={selected['file']:text},expected_revision=expected_revision)
