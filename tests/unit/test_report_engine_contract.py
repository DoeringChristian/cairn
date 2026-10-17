"""Behavioral contracts shared by standalone and native report readers."""
import base64
import json
from pathlib import Path
import re

import nbformat
import pytest

from cairn.reports.engine import ReportError, _frontmatter, _frontmatter_sources, _read_source, _document_notebook, render_notebook, document_record
from cairn.reports.cards import capture_card


def build_source(tmp_path, source, inputs=None):
    (tmp_path/'report.qmd').write_text(source)
    config, mapped = _read_source(tmp_path,'report.qmd')
    notebook, origins = _document_notebook(mapped, config, inputs or {})
    return config, notebook, origins


def test_title_and_description_references_point_to_frontmatter(tmp_path):
    source = '''---
'title': Height criteria
description: >-
  Which cost finds the surface
  height best?
execute: {enabled: false}
---
# Findings
'''
    config, notebook, _ = build_source(tmp_path, source)
    notebook.metadata['cairn'] = _frontmatter_sources(tmp_path, 'report.qmd')
    record = document_record(notebook, config, tmp_path, {'source_ref': 'report:test', 'environment_hash': 'env'})
    assert record['title_source'] == {
        'file': 'report.qmd', 'line': 2, 'end_line': 2,
        'hash': __import__('hashlib').sha256(source.encode()).hexdigest(),
    }
    assert record['description_source']['line'] == 3
    assert record['description_source']['end_line'] == 5
    assert record['description'] == 'Which cost finds the surface height best?'


def test_default_title_has_no_invented_source_location(tmp_path):
    (tmp_path / 'report.md').write_text('# A heading\n')
    assert _frontmatter_sources(tmp_path, 'report.md') == {}


@pytest.mark.parametrize('body', [
    'title: [bad]', 'inputs: {data: 42}', 'parameters: {x: .nan}',
    'inputs: {"../escape": "run:example"}', 'inputs: {"/tmp/escape": "run:example"}',
    'execute: {enabled: never}', 'execute: {timeout: true}',
    'references: {paper: {title: Good, url: [bad]}}',
    'references: {paper: {title: Good, author: [bad]}}',
    'references: {paper: {title: Good, year: true}}',
    'references: {paper: {title: Good, url: "https:///missing-host"}}',
    'false', '1: bad', 'title: [unclosed',
])
def test_frontmatter_errors_are_diagnostics(body):
    with pytest.raises(ReportError):
        _frontmatter('---\n'+body+'\n---\n')


def test_multiline_cell_options_preserve_yaml_and_lines(tmp_path):
    config, notebook, origins = build_source(tmp_path, '''```{python}

#| echo: false
#| fig-cap: >-
#|   First line
#|   second line
print('output')
```
''')
    cell=notebook.cells[1]
    assert cell.metadata.cairn.options == {'echo':False,'fig-cap':'First line second line'}
    assert cell.source.splitlines()[5] == "print('output')"


def test_included_media_rebases_without_rewriting_code(tmp_path):
    (tmp_path/'includes').mkdir();(tmp_path/'assets').mkdir()
    (tmp_path/'assets'/'pixel.png').write_bytes(b'png')
    (tmp_path/'includes'/'part.md').write_text('![Image](../assets/pixel.png)\n```python\nvalue="src=\\"unrelated\\""\n```\n')
    config, notebook, origins=build_source(tmp_path,'{{< include includes/part.md >}}\n')
    assert 'assets/pixel.png' in notebook.cells[1].source
    assert 'value="src=\\"unrelated\\""' in notebook.cells[1].source
    assert origins[0]['file']=='includes/part.md'


def test_plotly_and_provenance_are_portable(tmp_path):
    config, notebook, origins=build_source(tmp_path,'```{python}\npass\n```\n')
    notebook.cells[1].outputs=[nbformat.v4.new_output('display_data',data={'application/vnd.plotly.v1+json':{'data':[{'x':[1,2],'y':[2,3],'type':'scatter'}],'layout':{}}})]
    provenance={'source_ref':'report:test','environment_hash':'env','inputs':{},'special':'</script>'}
    rendered,warnings=render_notebook(notebook,config,origins,tmp_path,provenance)
    assert 'Plotly.newPlot' in rendered
    assert not warnings  # runtime JS strings are not mistaken for external assets
    embedded=re.search(r'id="cairn-provenance">(.*?)</script>',rendered,re.S)[1]
    assert json.loads(embedded)==provenance
    assert '</script>' not in embedded


def test_numeric_card_captures_data_and_shared_html(tmp_path):
    evidence=tmp_path/'evidence';evidence.mkdir()
    (evidence/'run.json').write_text('{"name":"Captured run"}')
    (evidence/'metrics.jsonl').write_text('\n'.join(json.dumps({'name':'loss','step':i,'value':v}) for i,v in enumerate([4,2,1])))
    config,notebook,origins=build_source(tmp_path,'```{card}\ntype: line\ninputs: [fit]\nmetric: loss\n```\n',{'fit':str(evidence)})
    spec=notebook.cells[1].metadata.cairn.card_spec
    (evidence/'metrics.jsonl').write_text('')
    assert [p['y'] for p in spec['data'][0]['points']]==[4,2,1]
    assert 'Plotly.newPlot' in spec['html']
    assert 'cairn:card-screenshot' in spec['html']
    provenance={'source_ref':'report:test','environment_hash':'env'}
    record=document_record(notebook,config,tmp_path,provenance)
    assert record['blocks'][0]['type']=='card'
    assert record['blocks'][0]['spec']['html']==spec['html']
    rendered,warnings=render_notebook(notebook,config,origins,tmp_path,provenance)
    assert 'sandbox="allow-scripts"' in rendered
    assert not warnings


def test_custom_card_captures_viewer_dependencies_and_data(tmp_path):
    viewer=tmp_path/'viewer';viewer.mkdir();data=tmp_path/'data';data.mkdir()
    (viewer/'cairn-viewer.json').write_text(json.dumps({'name':'test','title':'Test','description':'Test','accepts':['custom:test/data']}))
    (viewer/'index.js').write_text('import {onRender} from "cairn:sdk"; import {x} from "./dep.js"; onRender(()=>{});')
    (viewer/'dep.js').write_text('export const x=1;')
    (data/'values.json').write_text('[1,2,3]')
    declaration={'type':'custom','viewer':'viewer','inputs':[{'input':'data','path':'values.json','kind':'test/data','format':'json'}]}
    captured=capture_card(declaration,{'viewer':viewer,'data':data})
    assert captured['custom']['inputs'][0]['data']==[1,2,3]
    files={f['path']:f for f in captured['custom']['bundle']['files']}
    assert 'cairn-viewer:/dep.js' in base64.b64decode(files['index.js']['base64']).decode()
    assert '__cairn/sdk.js' in files
    assert 'connect-src &#x27;none&#x27;' in captured['html']
    (viewer/'dep.js').unlink()
    with pytest.raises((ReportError,ValueError),match='missing file'):
        capture_card(declaration,{'viewer':viewer,'data':data})


def test_report_custom_runtime_matches_workspace_runtime():
    root=Path(__file__).resolve().parents[2]
    source=(root/'vendor/cairn-ui/src/lib/custom/sdk-runtime.ts').read_text()
    for constant,filename in [('SDK_SOURCE','custom-sdk.js'),('BOOT','custom-boot.js')]:
        actual=re.search(r'(?:export )?const '+constant+r' = `([\s\S]*?)`;\n',source)[1]
        actual=actual.replace('${SDK_VERSION}','1').replace('\\\\','\\')+'\n'
        assert (root/'cairn/reports/template'/filename).read_text()==actual


def test_card_expressions_grouping_smoothing_and_limits(tmp_path, monkeypatch):
    from cairn.reports import cards
    folders={}
    for role,ys in [('a',[2,4,8]),('b',[4,8,16])]:
        folder=tmp_path/role;folder.mkdir();folders[role]=folder
        (folder/'run.json').write_text('{}')
        (folder/'config.json').write_text('{"batch":2,"family":"same"}')
        (folder/'metrics.jsonl').write_text('\n'.join(json.dumps({'name':'loss','step':i,'value':y}) for i,y in enumerate(ys)))
    spec=cards.capture_card({'type':'line','inputs':['a','b'],'expression':'metrics.loss / config.batch','xExpression':'step * 2','groupBy':'config.family','smoothing':.5},folders)
    assert spec['data'][0]['name']=='same'
    points=spec['data'][0]['points']
    assert [p['x'] for p in points]==[0,2,4]
    assert [p['y'] for p in points]==[1.5,2.25,4.125]
    assert points[0]['low']==1 and points[0]['high']==2
    monkeypatch.setattr(cards,'MAX_POINTS',2)
    short=cards.capture_card({'type':'line','inputs':['a'],'metric':'loss'},folders)
    assert short['data'][0]['points']==[{'x':0,'y':2},{'x':2,'y':8}]
    assert short['data'][0]['downsampled']
    monkeypatch.setattr(cards,'MAX_SCAN_RECORDS',2)
    with pytest.raises(ReportError,match='scan limit'):
        cards.capture_card({'type':'line','inputs':['a'],'metric':'loss'},folders)


@pytest.mark.parametrize('source',["__import__('os')","record.__class__","[x for x in record]","record[step]","'x' * 100000000"])
def test_card_expressions_are_bounded_data_only(source):
    from cairn.reports.expressions import Expression
    try: expression=Expression(source)
    except ReportError: return
    assert expression({'record':{},'step':1}) is None


def test_nested_repeated_includes_have_exact_original_spans(tmp_path):
    import hashlib
    (tmp_path/'parts').mkdir();(tmp_path/'parts/deep').mkdir()
    raw=b'Nested paragraph.\n\n```{python}\nprint("nested")\n```\n'
    (tmp_path/'parts/deep/body.md').write_bytes(raw)
    (tmp_path/'parts/outer.md').write_text('Outer text.\n\n{{< include deep/body.md >}}\n\nTrailing text.\n')
    config,notebook,origins=build_source(tmp_path,'{{< include parts/outer.md >}}\n{{< include parts/outer.md >}}\n')
    nested=[o for o in origins if o['file']=='parts/deep/body.md']
    assert [(o['line'],o['end_line']) for o in nested]==[(1,2),(3,5),(1,2),(3,5)]
    assert all(o['hash']==hashlib.sha256(raw).hexdigest() for o in nested)
    assert all(o['ancestry']==['report.qmd','parts/outer.md'] for o in nested)
    # Repeated includes of one file must not produce reversed source spans.
    config,notebook,origins=build_source(tmp_path,'{{< include parts/deep/body.md >}}\n{{< include parts/deep/body.md >}}\n')
    assert all(o['end_line']>=o['line'] for o in origins)
    assert all(o['file']=='parts/deep/body.md' for o in origins)

    assert len({cell.id for cell in notebook.cells})==len(notebook.cells)


def test_canonical_citations_skip_code_math_and_links(tmp_path):
    source='''---
references:
  unused: {title: Never cited}
  first: {title: First defined}
  second: {title: Second defined}
---
Read [@second; @first]. `[@missing] @fig-nope`.

```text
[@missing] @fig-nope
```

[Literal @fig-missing](https://example.com/@fig-missing)

```{python}
#| label: fig-result
#| fig-cap: A result
pass
```

See @fig-result and [@second].
'''
    config,notebook,origins=build_source(tmp_path,source)
    provenance={'source_ref':'fixed','environment_hash':'env'}
    record=document_record(notebook,config,tmp_path,provenance)
    assert record['citations']==['second','first']
    rendered,_=render_notebook(notebook,config,origins,tmp_path,provenance)
    assert 'href="#ref-second">[1]</a>' in rendered
    assert 'href="#ref-first">[2]</a>' in rendered
    assert 'id="ref-unused"' not in rendered
    assert '<code>[@missing] @fig-nope</code>' in rendered
    assert 'href="#fig-result">A result</a>' in rendered
