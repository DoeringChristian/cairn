import json
from cairn.reports.build import build_all
from cairn.reports.config import load_config


def test_cache_verifies_bytes_and_force_uses_fresh_kernel(tmp_path):
    folder=tmp_path/'reports'/'cached'
    folder.mkdir(parents=True)
    counter=tmp_path/'counter'
    folder.joinpath('report.qmd').write_text(f'''---
title: Cached report
execute:
  cache: true
---
```{{python}}
from pathlib import Path
counter=Path({str(counter)!r})
value=int(counter.read_text())+1 if counter.exists() else 1
counter.write_text(str(value))
print(value)
```
''')
    config=load_config(tmp_path)
    first=build_all(config,'cached')[0]
    document=json.loads((first.generated/'document.json').read_text())
    assert document['title_source']['file']=='report.qmd'
    assert document['title_source']['line']==2
    second=build_all(config,'cached')[0]
    assert counter.read_text()=='1'
    assert json.loads((second.generated.parent/'status.json').read_text())['cache_hit']
    assert first.generated != second.generated
    build_all(config,'cached',force=True)
    assert counter.read_text()=='2'
    cached_output=next((config.cairn_dir/'report-cache').glob('*/outputs/index.html'))
    cached_output.write_text('corrupted')
    build_all(config,'cached')
    assert counter.read_text()=='3'
