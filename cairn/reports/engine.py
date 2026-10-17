from __future__ import annotations
import base64, hashlib, html, json, mimetypes, re
from urllib.parse import urlsplit
import posixpath
from pathlib import Path, PurePosixPath
import nbformat
import yaml
from markdown_it import MarkdownIt
from mdit_py_plugins.dollarmath import dollarmath_plugin
from mdit_py_plugins.footnote import footnote_plugin

class ReportError(ValueError):
    def __init__(self, message, code='invalid'):
        super().__init__(message)
        self.code = code

ENGINE_VERSION = 'cairn-document/1'
_ASSETS = Path(__file__).with_name('template')
_ALLOWED_FRONTMATTER = {'title','description','environment','inputs','parameters','execute','references'}


def _json(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), allow_nan=False)

def _hash(value):
    return hashlib.sha256(value if isinstance(value, bytes) else value.encode()).hexdigest()

def _file_hash(path):
    digest = hashlib.sha256()
    with Path(path).open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(chunk)
    return digest.hexdigest()

def _safe_path(root: Path, path: str) -> Path:
    rel = PurePosixPath(path)
    if rel.is_absolute() or ".." in rel.parts or not path or "\\" in path:
        raise ReportError(f"Unsafe document path: {path}")
    result = root.joinpath(*rel.parts)
    if not result.resolve().is_relative_to(root.resolve()):
        raise ReportError(f"Document path escapes its source: {path}")
    return result

def _frontmatter(text):
    lines = text.splitlines(keepends=True)
    if lines and lines[0].strip() == "---":
        end = next((i for i in range(1, len(lines)) if lines[i].strip() == "---"), None)
        if end is None:
            raise ReportError("Unclosed document frontmatter")
        try:
            config = yaml.safe_load("".join(lines[1:end]))
        except yaml.YAMLError as exc:
            raise ReportError(f"Invalid document frontmatter: {exc}") from exc
        if config is None:
            config = {}
        if not isinstance(config, dict):
            raise ReportError("Document frontmatter must be a mapping")
        if any(not isinstance(key, str) for key in config):
            raise ReportError("Document option names must be text")
        unknown = set(config) - _ALLOWED_FRONTMATTER
        if unknown:
            raise ReportError(f"Unsupported document options: {', '.join(sorted(unknown))}")
        for key in ("environment", "inputs", "parameters", "execute", "references"):
            if key in config and not isinstance(config[key], dict):
                raise ReportError(f"{key} must be a mapping")
        for key in ("title", "description"):
            if key in config and not isinstance(config[key], str):
                raise ReportError(f"{key} must be text")
        for role, ref in config.get("inputs", {}).items():
            if not isinstance(role, str) or not isinstance(ref, str) or not ref.strip():
                raise ReportError("inputs must map text names to nonempty reference strings")
            if not re.fullmatch(r"[a-z0-9][a-z0-9_-]{0,62}", role):
                raise ReportError(f"invalid input role: {role!r}")
        execution = config.get("execute", {})
        if set(execution)-{"enabled","timeout","cache"}:
            raise ReportError("Unsupported execute options")
        if "cache" in execution and not isinstance(execution["cache"],bool):
            raise ReportError("execute.cache must be true or false")
        if "enabled" in execution and not isinstance(execution["enabled"], bool):
            raise ReportError("execute.enabled must be true or false")
        if "timeout" in execution and (type(execution["timeout"]) is not int or execution["timeout"] <= 0):
            raise ReportError("execute.timeout must be a positive integer")
        try:
            _json(config.get("parameters", {}))
        except (TypeError, ValueError) as exc:
            raise ReportError("parameters must contain finite JSON-compatible values") from exc
        for key, reference in config.get("references", {}).items():
            if not isinstance(key, str) or not re.fullmatch(r"[\w-]+", key):
                raise ReportError("reference keys must contain letters, digits, underscores or hyphens")
            if not isinstance(reference, dict) or not isinstance(reference.get("title"), str) or not reference["title"].strip():
                raise ReportError(f"Reference {key} requires a title")
            if set(reference) - {"title", "author", "year", "url"}:
                raise ReportError(f"Unsupported reference fields for {key}")
            if "author" in reference and not isinstance(reference["author"], str):
                raise ReportError(f"Reference {key} author must be text")
            if "year" in reference and type(reference["year"]) not in (str, int):
                raise ReportError(f"Reference {key} year must be text or an integer")
            if "url" in reference:
                url = reference["url"]
                if not isinstance(url, str) or urlsplit(url).scheme not in ("http", "https") or not urlsplit(url).netloc:
                    raise ReportError("Reference URLs must use HTTP(S) and name a host")
        return config, end + 1
    return {}, 0

def _rebase_media(line, source):
    """Resolve included prose media from its own source directory."""
    parent = PurePosixPath(source).parent
    if str(parent) == ".":
        return line
    def rebase(value):
        if urlsplit(value).scheme or value.startswith(("/", "#")):
            return value
        return posixpath.normpath((parent / value).as_posix())
    line = re.sub(r'(!\[[^\]]*\]\()([^\s)]+)', lambda m: m[1] + rebase(m[2]), line)
    line = re.sub(r"(src=[\"'])([^\"']+)", lambda m: m[1] + rebase(m[2]), line)
    line = re.sub(r'^( {0,3}\[[^\]]+\]:\s*)(\S+)', lambda m: m[1] + rebase(m[2]), line)
    return line

def _frontmatter_sources(root, entry):
    """Locate displayed metadata in the captured entry, including YAML block scalars."""
    raw = _safe_path(root, entry).read_bytes()
    text = raw.decode('utf-8')
    _, skip = _frontmatter(text)
    if not skip:
        return {}
    node = yaml.compose(''.join(text.splitlines(keepends=True)[1:skip-1]))
    if not isinstance(node, yaml.MappingNode):
        return {}
    sources = {}
    for key, value in node.value:
        if key.value not in {'title', 'description'}:
            continue
        start = key.start_mark.line + 2
        # YAML marks are zero-based; an end at column zero belongs to the
        # next line and must not absorb the following metadata field.
        end = value.end_mark.line + (2 if value.end_mark.column else 1)
        sources[key.value + '_source'] = {
            'file': entry, 'line': start, 'end_line': max(start, end),
            'hash': _hash(raw),
        }
    return sources

def _read_source(root, entry):
    """Expand explicit include directives, retaining original source coordinates."""
    config, _ = _frontmatter(_safe_path(root, entry).read_text())
    mapped = []
    include_counter = 0

    def expand(name, ancestry):
        nonlocal include_counter
        include_counter += 1
        occurrence = include_counter
        if name in ancestry:
            raise ReportError("Cyclic document include: " + " -> ".join([*ancestry, name]))
        if len(ancestry) >= 32:
            raise ReportError("Document include depth exceeds 32")
        path = _safe_path(root, name)
        if not path.is_file():
            raise ReportError(f"Missing document include: {name}")
        raw = path.read_bytes()
        text = raw.decode("utf-8")
        _, skip = _frontmatter(text)
        fence_character, fence_length = None, 0
        for number, line in enumerate(text.splitlines(keepends=True), 1):
            if number <= skip:
                continue
            fence = re.match(r"^ {0,3}(`{3,}|~{3,})(.*)$", line)
            was_inside_fence = fence_character is not None
            if fence:
                marker = fence.group(1)
                if fence_character is None:
                    fence_character, fence_length = marker[0], len(marker)
                elif (
                    marker[0] == fence_character
                    and len(marker) >= fence_length
                    and not fence.group(2).strip()
                ):
                    fence_character, fence_length = None, 0
            match = (
                None
                if (was_inside_fence or fence_character)
                else re.fullmatch(r"\s*\{\{<\s*include\s+([^>]+?)\s*>\}\}\s*", line)
            )
            if match:
                target = str(PurePosixPath(name).parent / match.group(1).strip("\"'"))
                expand(target, [*ancestry, name])
            else:
                if not was_inside_fence and not fence_character:
                    line = _rebase_media(line, name)
                mapped.append(
                    {
                        "text": line,
                        "file": name,
                        "line": number,
                        "hash": _hash(raw),
                        "ancestry": ancestry,
                        "include_occurrence": occurrence,
                    }
                )

    expand(entry, [])
    return config, mapped

def _source_attributes(origin):
    return " ".join(
        f'{name}="{html.escape(str(value), quote=True)}"'
        for name, value in {
            "data-source-file": origin["file"],
            "data-source-line": origin["line"],
            "data-source-end-line": origin.get("end_line", origin["line"]),
            "data-source-hash": origin["hash"],
        }.items()
    )

def _document_notebook(mapped, config, input_paths, input_info=None, *, capture_cards=True):
    text = "".join(item["text"] for item in mapped)
    parser = MarkdownIt("commonmark").enable("table")
    tokens = parser.parse(text)
    executable = [token for token in tokens if token.type == "fence" and token.info.startswith("{")]
    if sum(token.info.strip() == '{card}' for token in executable) > 32:
        raise ReportError('Reports support at most 32 embedded cards')
    cells = []
    cells.append(
        nbformat.v4.new_code_cell(
            "import json\nfrom pathlib import Path\n"
            f"parameters = json.loads({_json(config.get('parameters', {}))!r})\n"
            "class ReportInput:\n"
            "    def __init__(self, path, info):\n"
            "        self.path = Path(path)\n"
            "        self.ref = info.get('ref')\n"
            "        self.metadata = info.get('metadata', {})\n"
            "        self.summary = self.metadata.get('summary', {})\n"
            "        self.config = self.metadata.get('config', {})\n"
            "    def __truediv__(self, path): return self.path / path\n"
            "    def __fspath__(self): return str(self.path)\n"
            "    def __getattr__(self, name): return getattr(self.path, name)\n"
            f"_cairn_input_info = json.loads({_json(input_info or {})!r})\n"
            f"inputs = {{key: ReportInput(value, _cairn_input_info.get(key, {{}})) "
            f"for key,value in json.loads({_json(input_paths)!r}).items()}}\n",
            metadata={"cairn": {"bootstrap": True}},
            id="cairn-bootstrap",
        )
    )
    origins = []

    def append_markdown(start, end):
        while start < end:
            stop = start + 1
            while (stop < end and mapped[stop]["file"] == mapped[start]["file"]
                   and mapped[stop]["line"] == mapped[stop-1]["line"] + 1
                   and mapped[stop].get("include_occurrence") == mapped[start].get("include_occurrence")):
                stop += 1
            origin = {**mapped[start], "end_line": mapped[stop - 1]["line"], "kind": "prose"}
            origin.pop("text", None)
            cell_id = "prose-" + _hash(_json(origin))[:20]
            origin["cell_id"] = cell_id
            cells.append(
                nbformat.v4.new_markdown_cell(
                    "".join(x["text"] for x in mapped[start:stop]),
                    id=cell_id,
                    metadata={"cairn": origin},
                )
            )
            origins.append(origin)
            start = stop

    cursor = 0
    for index, token in enumerate(executable):
        start, end = token.map
        if start > cursor:
            append_markdown(cursor, start)
        language = token.info.strip()
        if language == "{card}":
            from .cards import capture_card
            try:
                declaration = yaml.safe_load(token.content)
            except yaml.YAMLError as exc:
                raise ReportError(f'Invalid card declaration: {exc}') from exc
            from .cards import validate_card
            spec = capture_card(declaration, input_paths) if capture_cards else validate_card(declaration)
            origin = {**mapped[start], 'end_line': mapped[end - 1]['line'], 'index': index,
                      'kind': 'card', 'card_spec': spec,
                      'options': {'label': declaration.get('label', f'card-{index}')}}
            origin.pop('text', None)
            origin['cell_id'] = 'card-' + _hash(_json({k:v for k,v in origin.items() if k != 'card_spec'}))[:20]
            cells.append(nbformat.v4.new_raw_cell(token.content, id=origin['cell_id'], metadata={'cairn': origin}))
            origins.append({k:v for k,v in origin.items() if k != 'card_spec'})
            cursor = end
            continue
        if language != "{python}":
            raise ReportError(f"Unsupported executable fence: {language}; use {{python}} or {{card}}")
        option_lines, code = [], []
        options_done = False
        for line in token.content.splitlines(keepends=True):
            if not line.strip() and not options_done:
                code.append(line)
            elif line.startswith("#|") and not options_done:
                option_lines.append(line[2:])
                code.append("\n")
            else:
                options_done = True
                code.append(line)
        try:
            options = yaml.safe_load("".join(option_lines))
            if options is None:
                options = {}
        except yaml.YAMLError as exc:
            raise ReportError(f"Invalid cell options: {exc}") from exc
        if not isinstance(options, dict):
            raise ReportError("Cell options must be a mapping")
        unknown = set(options) - {"echo", "eval", "include", "label", "fig-cap"}
        if unknown:
            raise ReportError(f"Unsupported cell options: {sorted(unknown, key=str)}")
        for name in ("echo", "eval", "include"):
            if name in options and not isinstance(options[name], bool):
                raise ReportError(f"Cell option {name} must be true or false")
        for name in ("label", "fig-cap"):
            if name in options and not isinstance(options[name], str):
                raise ReportError(f"Cell option {name} must be text")
        origin = {
            **mapped[start],
            "end_line": mapped[end - 1]["line"],
            "index": index,
            "kind": "code",
            "options": options,
        }
        origin.pop("text", None)
        cell_id = "cell-" + _hash(_json(origin))[:20]
        origin["cell_id"] = cell_id
        cell = nbformat.v4.new_code_cell("".join(code), id=cell_id, metadata={"cairn": origin})
        if options.get("eval") is False:
            cell.metadata["tags"] = ["skip-execution"]
        cells.append(cell)
        origins.append(origin)
        cursor = end
    if cursor < len(mapped):
        append_markdown(cursor, len(mapped))
    notebook = nbformat.v4.new_notebook(cells=cells)
    return notebook, origins

def _md_renderer():
    from latex2mathml.converter import convert

    parser = MarkdownIt("commonmark", {"html": True}).enable("table").use(footnote_plugin)
    parser.use(
        dollarmath_plugin,
        renderer=lambda value, options: convert(
            value, display="block" if options.get("display_mode") else "inline"
        ),
    )
    return parser

def _render_output(output, parser, warnings):
    kind = output.output_type
    if kind == "stream":
        return f'<pre class="out {html.escape(output.name)}">{html.escape(output.text)}</pre>'
    if kind == "error":
        return f'<pre class="out error">{html.escape(output.ename + ": " + output.evalue)}</pre>'
    data = output.get("data", {})
    if "application/vnd.plotly.v1+json" in data:
        import plotly.io as pio
        return pio.to_html(data["application/vnd.plotly.v1+json"], include_plotlyjs=True,
                           full_html=False, config={"responsive": True, "displayModeBar": True})
    if "text/html" in data:
        return '<div class="raw-html">' + data["text/html"] + "</div>"
    if "image/svg+xml" in data:
        return '<div class="figure-card">' + data["image/svg+xml"] + "</div>"
    for mime in ("image/png", "image/jpeg"):
        if mime in data:
            return f'<img alt="Cell output" src="data:{mime};base64,{data[mime]}"/>'
    if "text/markdown" in data:
        return parser.render(data["text/markdown"])
    if "text/latex" in data:
        from latex2mathml.converter import convert

        return convert(data["text/latex"].strip("$"), display="block")
    if "application/json" in data:
        return (
            f'<pre class="out">{html.escape(json.dumps(data["application/json"], indent=2))}</pre>'
        )
    rich = [mime for mime in data if mime != "text/plain"]
    if rich:
        warnings.append("Unsupported output MIME types preserved in notebook: " + ", ".join(rich))
    return f'<pre class="out">{html.escape(data.get("text/plain", ""))}</pre>'

def _render_markdown(source, parser):
    # Explicit ::: blocks support Folio callouts; nested blocks intentionally rejected.
    pattern = re.compile(
        r"^:::\s*\{?\.?(note|warning|finding|decision|callout|gallery)\}?\s*\n(.*?)^:::\s*$",
        re.MULTILINE | re.DOTALL,
    )

    def callout(match):
        if match[1] == "gallery":
            return f'<div class="gallery" style="display:grid;grid-template-columns:1fr 1fr;gap:16px">{parser.render(match[2])}</div>\n'
        return f'<aside class="admonition {match[1]}"><p class="admonition-title">{match[1].title()}</p>{parser.render(match[2])}</aside>\n'

    source = pattern.sub(callout, source)
    if re.search(r"^:::", source, re.MULTILINE):
        raise ReportError(
            "Unsupported or nested fenced div; supported: note, warning, finding, decision, callout, gallery"
        )
    return parser.render(source)

def _reference_parser(notebook, config):
    """Resolve references in Markdown text tokens, never executable/code text."""
    from markdown_it.token import Token
    parser=_md_renderer();labels={};citations=[]
    for cell in notebook.cells:
        origin=cell.metadata.get('cairn',{})
        if origin.get('bootstrap') or origin.get('options',{}).get('include') is False: continue
        if cell.cell_type=='code' or origin.get('kind')=='card':
            options=origin.get('options',{});label=options.get('label',cell.id)
            if label in labels: raise ReportError(f'Duplicate cell label: {label}')
            labels[label]=options.get('fig-cap',label)
    references=config.get('references',{})
    pattern=re.compile(r'\[@[\w-]+(?:\s*;\s*@[\w-]+)*\]|(?<![\w/])@(?:fig|tbl|cell)-[\w-]+')
    def transform(state):
        for token in state.tokens:
            if token.type!='inline' or not token.children: continue
            children=[];depth=0
            for child in token.children:
                if child.type=='link_open': depth+=1
                if child.type=='link_close': depth-=1
                if child.type!='text' or depth:
                    children.append(child);continue
                cursor=0
                for match in pattern.finditer(child.content):
                    before=Token('text','',0);before.content=child.content[cursor:match.start()];children.append(before)
                    names=[part.strip()[1:] for part in match[0][1:-1].split(';')] if match[0].startswith('[') else [match[0][1:]]
                    for index,key in enumerate(names):
                        if index:
                            sep=Token('text','',0);sep.content='; ';children.append(sep)
                        if match[0].startswith('['):
                            if key not in references: raise ReportError(f'Unresolved citation: @{key}')
                            if key not in citations: citations.append(key)
                            href='#ref-'+key;label=f'[{citations.index(key)+1}]'
                        else:
                            if key not in labels: raise ReportError(f'Unresolved cross-reference: @{key}')
                            href='#'+key;label=str(labels[key])
                        link=Token('link_open','a',1);link.attrSet('href',href)
                        text=Token('text','',0);text.content=label
                        children.extend([link,text,Token('link_close','a',-1)])
                    cursor=match.end()
                remaining=Token('text','',0);remaining.content=child.content[cursor:];children.append(remaining)
            token.children=children
    parser.core.ruler.after('inline','cairn_references',transform)
    # Canonical numbering is independent of reader rendering order.
    for cell in notebook.cells:
        if cell.cell_type=='markdown': parser.parse(cell.source)
    return parser,citations


def _source_button():
    return ('<button class="source-copy" type="button" aria-label="Copy source location" '
            'title="Copy source location"><svg width="15" height="15" viewBox="0 0 24 24" '
            'fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true">'
            '<path d="m8 7-5 5 5 5m8-10 5 5-5 5m-3-14-2 18"/></svg></button>')


def render_notebook(notebook, config, source_map, root, provenance):
    parser,citations = _reference_parser(notebook,config)
    warnings, parts = [], []
    references = config.get('references',{})

    for cell in notebook.cells:
        origin = cell.metadata.get("cairn", {})
        if origin.get("bootstrap"):
            continue
        if origin.get('kind') == 'card':
            from .cards import export_card
            parts.append(f'<div class="report-block" {_source_attributes(origin)}>' + export_card(origin['card_spec']) + '</div>')
            continue
        if cell.cell_type == "markdown":
            rendered = _render_markdown(cell.source, parser)
            if origin:
                parts.append(f'<div class="report-block" {_source_attributes(origin)}>')
                parts.append(
                    _source_button()
                )
                parts.append(rendered)
                parts.append("</div>")
            else:
                parts.append(rendered)
            continue
        options = origin.get("options", {})
        if options.get("include") is False:
            continue
        label = options.get("label", cell.id)
        parts.append(
            f'<div class="exec-block" id="{html.escape(label)}" {_source_attributes(origin)}>'
        )
        parts.append(_source_button())
        if options.get("echo", True):
            parts.append(f"<pre><code>{html.escape(cell.source)}</code></pre>")
        parts.extend(_render_output(output, parser, warnings) for output in cell.get("outputs", []))
        if options.get("fig-cap"):
            parts.append(f'<p class="caption">{html.escape(options["fig-cap"])}</p>')
        parts.append("</div>")
    if citations:
        parts.append('<section class="references"><h2>References</h2><ol>')
        for key in citations:
            reference = references[key]
            if not isinstance(reference, dict) or not reference.get("title"):
                raise ReportError(f"Reference {key} requires a title")
            if set(reference) - {"title", "author", "year", "url"}:
                raise ReportError(
                    f"Unsupported reference fields for {key}; supported: title, author, year, url"
                )
            title = html.escape(str(reference["title"]))
            url = reference.get("url")
            if url:
                if not str(url).startswith(("https://", "http://")):
                    raise ReportError("Reference URLs must use HTTP(S)")
                title = f'<a href="{html.escape(url, quote=True)}">{title}</a>'
            details = html.escape(
                " · ".join(str(reference[x]) for x in ("author", "year") if x in reference)
            )
            parts.append(f'<li id="ref-{html.escape(key)}">{title}. {details}</li>')
        parts.append("</ol></section>")
    body = "\n".join(parts)

    # Local media become embedded resources; output is independently readable.
    def asset(match):
        attr, value = match.groups()
        value = html.unescape(value)
        if value.startswith(("data:", "https:", "http:", "#", "mailto:")):
            if value.startswith(("http:", "https:")) and attr == "src":
                warnings.append("External media URL is not captured: " + value)
            return match[0]
        file = _safe_path(root, value)
        if not file.is_file():
            raise ReportError(f"Missing report resource: {value}")
        mime = mimetypes.guess_type(file.name)[0] or "application/octet-stream"
        encoded = base64.b64encode(file.read_bytes()).decode()
        return f'{attr}="data:{mime};base64,{encoded}"'

    # JavaScript runtimes contain literal HTML strings; these are not document
    # resources. Transform only actual start tags, preserving script bodies.
    from html.parser import HTMLParser
    class ResourceEmbedder(HTMLParser):
        def __init__(self):
            super().__init__(convert_charrefs=False)
            self.parts = []
        def handle_starttag(self, tag, attrs):
            self.parts.append(re.sub(r'''(src)=["']([^"'<>]+)["']''', asset, self.get_starttag_text()))
        def handle_startendtag(self, tag, attrs):
            self.handle_starttag(tag, attrs)
        def handle_endtag(self, tag): self.parts.append(f"</{tag}>")
        def handle_data(self, data): self.parts.append(data)
        def handle_entityref(self, name): self.parts.append(f"&{name};")
        def handle_charref(self, name): self.parts.append(f"&#{name};")
        def handle_comment(self, data): self.parts.append(f"<!--{data}-->")
        def handle_decl(self, decl): self.parts.append(f"<!{decl}>")
    embedder = ResourceEmbedder()
    embedder.feed(body)
    body = "".join(embedder.parts)
    css = (_ASSETS / "report.css").read_text() + (_ASSETS / "report-extra.css").read_text()
    title = html.escape(str(config.get("title", "Cairn report")))
    script = """document.querySelectorAll('.source-copy').forEach(button=>button.onclick=async()=>{
const p=button.parentElement; const location={schema:1,source:p.dataset.sourceFile,
line:Number(p.dataset.sourceLine),end_line:Number(p.dataset.sourceEndLine),hash:p.dataset.sourceHash};
const reference=location.revision+'#'+location.source+':L'+location.line+
(location.end_line>location.line?'-L'+location.end_line:'');
try {if(!navigator.clipboard?.writeText)throw new Error('Clipboard unavailable');
await navigator.clipboard.writeText(reference);button.title='Reference copied';}
catch {const field=document.createElement('textarea');field.value=reference;field.readOnly=true;
field.setAttribute('aria-label','Reference to copy');p.appendChild(field);field.focus();field.select();
if(document.execCommand?.('copy')){field.remove();button.title='Reference copied';}
else button.title='Select and copy the reference below';}
window.parent.postMessage({type:'cairn:source',version:1,location},'*');});"""
    script = script.replace(
        "{schema:1,source:", "{schema:1,revision:" + _json(provenance["source_ref"]) + ",source:"
    )
    document = f'''<!doctype html><html lang="en" data-cairn-report="1"><head><meta charset="utf-8">
<meta name="generator" content="{ENGINE_VERSION}">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>{title}</title>
<style>{css}\n.exec-block{{display:flow-root}} .error{{border-left:4px solid #b56231}} .rail small{{overflow-wrap:anywhere}}</style></head>
<body><aside class="rail"><a class="brand" href="#top"><span style="background:#176b5b">C</span> Cairn</a><p>Executable report</p><small>{html.escape(provenance["source_ref"])}</small></aside>
<main id="top"><header class="hero"><h1>{title}</h1></header><article id="report-prose" class="report-prose">{body}</article>
<footer>Built with {ENGINE_VERSION}</footer></main><script type="application/json" id="cairn-provenance">{_json(provenance).replace('<', chr(92) + 'u003c')}</script><script>{script}</script></body></html>'''
    return document, warnings

def document_record(notebook, config, root, provenance):
    """Portable structured output; the browser owns presentation, never execution."""
    blocks = []
    for cell in notebook.cells:
        origin = cell.metadata.get("cairn", {})
        if origin.get("bootstrap"):
            continue
        block = {
            "id": cell.id,
            "source": {
                k: v for k, v in origin.items() if k not in {"options", "kind", "index", "cell_id", "card_spec"}
            },
        }
        if origin.get('kind') == 'card':
            block.update(type='card', spec=origin['card_spec'], label=origin['options']['label'])
        elif cell.cell_type == "markdown":
            block.update(type="markdown", markdown=cell.source)
        else:
            options = origin.get("options", {})
            if options.get("include") is False:
                continue
            outputs = []
            for output in cell.get("outputs", []):
                kind = output.get("output_type")
                if kind == "stream":
                    outputs.append(
                        {
                            "type": "stream",
                            "name": output.get("name", "stdout"),
                            "text": output.get("text", ""),
                        }
                    )
                elif kind == "error":
                    outputs.append(
                        {
                            "type": "error",
                            "name": output.get("ename", "Error"),
                            "message": output.get("evalue", ""),
                        }
                    )
                else:
                    outputs.append({"type": "display", "data": dict(output.get("data", {}))})
            block.update(
                type="code",
                language="python",
                code=cell.source,
                echo=options.get("echo", True),
                label=options.get("label", cell.id),
                caption=options.get("fig-cap"),
                outputs=outputs,
            )
        blocks.append(block)
    assets = {}
    for path in root.rglob("*"):
        relative = path.relative_to(root)
        if (
            not path.is_file()
            or path.is_symlink()
            or any(part.startswith(".cairn-") for part in relative.parts)
        ):
            continue
        mime = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
        if mime.startswith(("image/", "audio/", "video/")):
            assets[relative.as_posix()] = {"hash": _file_hash(path), "size": path.stat().st_size, "mime": mime, "path": relative.as_posix()}
    return {
        "schema": "cairn.document/v1",
        "title": config.get("title", "Cairn report"),
        "description": config.get("description", ""),
        **{key: value for key, value in notebook.metadata.get('cairn', {}).items()
           if key in {'title_source', 'description_source'}},
        "source_ref": provenance["source_ref"],
        "environment_hash": provenance["environment_hash"],
        **({"environment_ref": provenance["environment_ref"]} if provenance.get("environment_ref") else {}),
        "blocks": blocks,
        "references": config.get("references", {}),
        "citations": _reference_parser(notebook,config)[1],
        "assets": assets,
    }
