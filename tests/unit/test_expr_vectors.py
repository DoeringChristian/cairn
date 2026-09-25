"""cairn.expr mirrors cairn-ui ``src/lib/expr/``. Both run the vectors
committed in cairn-ui at ``docs/schemas/expr-vectors.json``."""
import json
import math
from pathlib import Path

import pytest

from cairn import expr as E
from cairn_ui.cards import spec as _cs

_VECTORS = Path(_cs.__file__).resolve().parents[2] / "docs" / "schemas" / "expr-vectors.json"
_DOC = json.loads(_VECTORS.read_text())
_CASES = _DOC["cases"]


def _decode(v):
    if isinstance(v, list):
        return [_decode(x) for x in v]
    if isinstance(v, dict):
        if isinstance(v.get("$f"), str):
            return {"nan": math.nan, "inf": math.inf, "-inf": -math.inf}[v["$f"]]
        return {k: _decode(x) for k, x in v.items()}
    return v


class _Ctx:
    def __init__(self, raw):
        c = _decode(raw)
        self._c = c
        if "stats" in c:
            self.stat = lambda n, r: c["stats"].get(n, {}).get(r, E.MISSING)

    def series(self, name):
        return self._c["series"].get(name)

    def config(self, key):
        return self._c["config"].get(key)

    def summary(self, key):
        return self._c["summary"].get(key)

    def run(self, field):
        return self._c["run"].get(field)


def _close(a, b):
    if isinstance(a, bool) or isinstance(b, bool):
        return isinstance(a, bool) and isinstance(b, bool) and a == b
    if isinstance(a, (int, float)) and isinstance(b, (int, float)):
        if math.isnan(a) or math.isnan(b):
            return math.isnan(a) and math.isnan(b)
        return a == b or abs(a - b) <= 1e-12 * max(abs(a), abs(b))
    if isinstance(a, list) and isinstance(b, list):
        return len(a) == len(b) and all(_close(x, y) for x, y in zip(a, b))
    if isinstance(a, dict) and isinstance(b, dict):
        return a.keys() == b.keys() and all(_close(a[k], b[k]) for k in a)
    return a == b


def test_vectors_have_150_plus_cases():
    assert len(_CASES) >= 150


def test_vectors_cover_every_function():
    called = set()

    def walk(n):
        if n.type == "call":
            called.add(n.name)
        for k in n.kids:
            walk(k)
    for c in _CASES:
        if "expr" in c and "error" not in c:
            walk(E.parse(c["expr"]))
    assert called == set(E.FUNCTION_NAMES)


def _id(c):
    return f"{'expr' if 'expr' in c else 'tpl'}:{c.get('expr', c.get('template'))!r}@{c['ctx']}"


@pytest.mark.parametrize("case", _CASES, ids=_id)
def test_vector(case):
    ctx = _Ctx(_DOC["contexts"][case["ctx"]])
    try:
        if "template" in case:
            got = E.render_template(case["template"], ctx)
            assert "error" not in case, got
            assert got == case["expected"]
            return
        node = E.parse(case["expr"])
        domain = _decode(case["domain"]) if "domain" in case else None
        r = E.evaluate(node, ctx, domain=domain)
    except E.ExprError as e:
        assert "error" in case, f"unexpected error {e.message}"
        assert e.message == case["error"]["message"]
        assert list(e.span) == case["error"]["span"]
        return
    assert "error" not in case
    v = r.value
    got = {"steps": v.steps, "values": v.values} if isinstance(v, E.Series) else {"scalar": v}
    assert _close(got, _decode(case["expected"])), got
    assert str(r.type) == case["type"]
    assert [{"kind": w.kind, "span": list(w.span)} for w in r.warnings] == case["warnings"]
    assert E.plan(node) == case["plan"]
    assert E.deps(node) == case["deps"]


def test_matches():
    ctx = _Ctx(_DOC["contexts"]["base"])
    assert E.matches(E.evaluate('config.optimizer == "adam"', ctx))
    assert not E.matches(E.evaluate("config.missing", ctx))
    assert not E.matches(E.evaluate("null < 1", ctx))
    assert not E.matches(E.evaluate("loss > 0", ctx))
