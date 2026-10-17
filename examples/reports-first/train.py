"""A complete local experiment and its report input."""
from pathlib import Path
import cairn

with cairn.init('descent', name='quadratic', capture_source=False) as run:
    run.config.update({'lr': 0.1, 'initial_x': 4.0})
    x = 4.0
    for step in range(30):
        run.log({'loss': x*x})
        x -= 0.1*2*x
    run.summary['final_x'] = x
source = Path('reports/descent/report.md')
text = source.read_text()
import re
text = re.sub(r'fit: "run:[^"]+"', f'fit: "run:{run.id}"', text)
source.write_text(text)
print(f'Report input: run:{run.id}')
