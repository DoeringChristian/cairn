"""The cairn expression language, in Python.

A MIRROR of cairn-ui ``src/lib/expr/`` (see its ``index.ts`` for the full
language reference); both run cairn-ui ``docs/schemas/expr-vectors.json``
(``tests/unit/test_expr_vectors.py``). Change both sides together.

Summary: Python-like syntax (``or and not``, chained comparisons incl.
``in``/``not in``, ``+ - * / % **``, calls, literals, lists); dotted metric
names with backtick quoting; reserved roots ``config.``, ``summary.``,
``run.{name,id,status,tags,group,job_type,created_at}``, ``step``,
``wall_time``, ``relative_time``. Values are ``scalar | series``; scalars
broadcast; series with different steps are as-of joined, with an
:class:`ExprWarning`. Functions: reducers ``min max mean first last``,
pointwise ``min|max(a, b) log exp abs clip``, series ``cummin cummax diff
ema``, joins ``exact resample``. ``${…}`` templates render scalars.

Usage::

    from cairn.expr import evaluate
    r = evaluate("last(loss) < 0.1 and config.opt == 'adam'", ctx)
    r.value, r.type, r.warnings

``ctx`` is any object with ``series(name)``, ``config(key)``,
``summary(key)``, ``run(field)`` and optionally ``stat(name, reducer)``
(return :data:`MISSING` when unknown). ``series`` returns ``None`` or a
mapping/object with ``steps``, ``values`` and optional ``wall`` (epoch ms).

Offsets in spans are code points (the UI's are UTF-16 units; they differ
only past the Basic Multilingual Plane).
"""
from __future__ import annotations

import bisect
import json
import math
import re
from dataclasses import dataclass, field
from datetime import datetime, timezone
from decimal import ROUND_HALF_UP, Decimal
from typing import Any, Callable

from .server._operators import OPERATORS

__all__ = [
    "AXES", "ExprError", "ExprType", "ExprWarning", "EvalResult", "FUNCTION_NAMES", "MISSING",
    "Node", "REDUCERS", "RUN_FIELDS", "Series", "Template", "check", "deps", "evaluate",
    "format_g", "format_value", "matches", "parse", "parse_template", "parse_time", "plan",
    "render_template",
]

RUN_FIELDS = ("name", "id", "status", "tags", "group", "job_type", "created_at")
AXES = ("step", "wall_time", "relative_time")
REDUCERS = ("min", "max", "mean", "first", "last")
FUNCTION_NAMES = (*REDUCERS, "cummin", "cummax", "diff", "ema", "log", "exp", "abs", "clip",
                  "exact", "resample")

#: What ``ctx.stat`` returns for a stat it does not know.
MISSING: Any = object()

Span = tuple  # (start, end), end exclusive


class ExprError(ValueError):
    """A parse, type or evaluation error located at ``span`` in the source."""

    def __init__(self, message: str, span: tuple[int, int]) -> None:
        super().__init__(message)
        self.message = message
        self.span = span


class ExprWarning(UserWarning):
    """A non-fatal note: ``kind == "asof-join"`` when series with different
    steps were combined by an as-of join."""

    def __init__(self, kind: str, message: str, span: tuple[int, int]) -> None:
        super().__init__(message)
        self.kind = kind
        self.message = message
        self.span = span


def _edit_distance(a: str, b: str) -> int:
    prev = list(range(len(b) + 1))
    for i in range(1, len(a) + 1):
        diag = prev[0]
        prev[0] = i
        for j in range(1, len(b) + 1):
            up = prev[j]
            prev[j] = min(up + 1, prev[j - 1] + 1, diag + (0 if a[i - 1] == b[j - 1] else 1))
            diag = up
    return prev[len(b)]


def _did_you_mean(name: str, candidates: tuple[str, ...]) -> str:
    best, best_d = None, 3
    for c in candidates:
        d = _edit_distance(name, c)
        if d < best_d:
            best, best_d = c, d
    return "" if best is None else f"; did you mean '{best}'?"


# ---------------------------------------------------------------------------
# AST
# ---------------------------------------------------------------------------

@dataclass
class Node:
    """``type`` is one of num str bool null list metric config summary run
    axis unary binary compare call; the other fields depend on it."""
    type: str
    span: tuple[int, int]
    value: Any = None          # num/str/bool literal
    name: str | None = None    # metric name, config/summary key, run field, axis, fn name
    op: str | None = None      # unary/binary operator
    ops: list[str] = field(default_factory=list)       # compare operators
    kids: list[Node] = field(default_factory=list)     # list items, operands, call args
    fn_span: tuple[int, int] | None = None


# ---------------------------------------------------------------------------
# Lexer
# ---------------------------------------------------------------------------

_KEYWORDS = {"and": "and", "or": "or", "not": "not", "in": "in", "true": "true",
             "false": "false", "null": "null", "True": "true", "False": "false", "None": "null"}
_NUM_RE = re.compile(r"(?:[0-9]+\.?[0-9]*|\.[0-9]+)(?:[eE][+-]?[0-9]+)?")


def _is_digit(c: str | None) -> bool:
    return c is not None and "0" <= c <= "9"


def _is_ident_start(c: str | None) -> bool:
    return c is not None and ("a" <= c <= "z" or "A" <= c <= "Z" or c == "_")


def _is_ident_char(c: str | None) -> bool:
    return _is_ident_start(c) or _is_digit(c)


@dataclass
class _Tok:
    kind: str                  # num str name op kw eof
    span: tuple[int, int]
    value: Any = None          # num/str/op/kw value, or name segments [(text, quoted)]


def _tokenize(src: str) -> list[_Tok]:
    out: list[_Tok] = []
    n = len(src)
    at = lambda k: src[k] if k < n else None  # noqa: E731
    i = 0

    def quoted_name(start: int) -> tuple[str, int]:
        j = start + 1
        text = ""
        while True:
            if j >= n:
                raise ExprError("unterminated quoted name", (start, n))
            c = src[j]
            if c == "`":
                if at(j + 1) == "`":
                    text += "`"
                    j += 2
                    continue
                j += 1
                break
            text += c
            j += 1
        if text == "":
            raise ExprError("empty quoted name", (start, j))
        return text, j

    while i < n:
        c = src[i]
        if c in " \t\n\r":
            i += 1
            continue
        start = i
        if _is_digit(c) or (c == "." and _is_digit(at(i + 1))):
            m = _NUM_RE.match(src, i)
            assert m is not None
            i = m.end()
            if _is_ident_char(at(i)) or at(i) == ".":
                j = i
                while _is_ident_char(at(j)) or at(j) == ".":
                    j += 1
                raise ExprError(f"invalid number '{src[start:j]}'", (start, j))
            out.append(_Tok("num", (start, i), float(m.group(0))))
            continue
        if c in "\"'":
            j = i + 1
            text = ""
            while True:
                if j >= n:
                    raise ExprError("unterminated string", (start, n))
                d = src[j]
                if d == c:
                    j += 1
                    break
                if d == "\\" and j + 1 < n:
                    e = src[j + 1]
                    text += {"n": "\n", "t": "\t", "\\": "\\", "'": "'", '"': '"'}.get(e, "\\" + e)
                    j += 2
                    continue
                text += d
                j += 1
            out.append(_Tok("str", (start, j), text))
            i = j
            continue
        if _is_ident_start(c) or c == "`":
            segments: list[tuple[str, bool]] = []
            first = True
            while True:
                d = at(i)
                if d == "`":
                    text, i = quoted_name(i)
                    segments.append((text, True))
                elif _is_ident_start(d) if first else _is_ident_char(d):
                    j = i
                    while _is_ident_char(at(j)):
                        j += 1
                    segments.append((src[i:j], False))
                    i = j
                else:
                    raise ExprError("expected a name after '.'", (i - 1, i))
                first = False
                if at(i) == ".":
                    i += 1
                    continue
                break
            span = (start, i)
            only = segments[0][0] if len(segments) == 1 and not segments[0][1] else None
            if only is not None and only in _KEYWORDS:
                out.append(_Tok("kw", span, _KEYWORDS[only]))
            else:
                out.append(_Tok("name", span, segments))
            continue
        two = src[i:i + 2]
        if two in ("**", "==", "!=", "<=", ">="):
            out.append(_Tok("op", (start, i + 2), two))
            i += 2
            continue
        if c in "()[],+-*/%<>":
            out.append(_Tok("op", (start, i + 1), c))
            i += 1
            continue
        if two == "&&":
            raise ExprError("unexpected '&&'; use 'and'", (start, i + 2))
        if two == "||":
            raise ExprError("unexpected '||'; use 'or'", (start, i + 2))
        if c == "=":
            raise ExprError("unexpected '='; use '==' to compare", (start, i + 1))
        if c == "!":
            raise ExprError("unexpected '!'; use 'not' or '!='", (start, i + 1))
        raise ExprError(f"unexpected character '{c}'", (start, i + 1))
    out.append(_Tok("eof", (n, n)))
    return out


# ---------------------------------------------------------------------------
# Parser (Pratt; binding powers as in parser.ts)
# ---------------------------------------------------------------------------

_CMP_OPS = {"==", "!=", "<", "<=", ">", ">="}
_ARITH_BP = {"+": 50, "-": 50, "*": 60, "/": 60, "%": 60, "**": 80}


class _Parser:
    def __init__(self, src: str, toks: list[_Tok]) -> None:
        self.src = src
        self.toks = toks
        self.pos = 0

    def peek(self, k: int = 0) -> _Tok:
        return self.toks[min(self.pos + k, len(self.toks) - 1)]

    def next(self) -> _Tok:
        t = self.peek()
        if self.pos < len(self.toks) - 1:
            self.pos += 1
        return t

    @staticmethod
    def is_op(t: _Tok, v: str) -> bool:
        return t.kind == "op" and t.value == v

    @staticmethod
    def is_kw(t: _Tok, v: str) -> bool:
        return t.kind == "kw" and t.value == v

    def text(self, t: _Tok) -> str:
        return "end of expression" if t.kind == "eof" else f"'{self.src[t.span[0]:t.span[1]]}'"

    def unexpected(self, t: _Tok) -> ExprError:
        if t.kind == "eof":
            return ExprError("unexpected end of expression", t.span)
        return ExprError(f"unexpected {self.text(t)}", t.span)

    def parse_top(self) -> Node:
        if self.peek().kind == "eof":
            raise ExprError("empty expression", self.peek().span)
        node = self.expr(0)
        if self.peek().kind != "eof":
            raise self.unexpected(self.peek())
        return node

    def lbp(self) -> int:
        t = self.peek()
        if t.kind == "kw":
            if t.value == "or":
                return 10
            if t.value == "and":
                return 20
            if t.value == "in":
                return 40
            if t.value == "not" and self.is_kw(self.peek(1), "in"):
                return 40
            return 0
        if t.kind == "op":
            if t.value in _CMP_OPS:
                return 40
            return _ARITH_BP.get(t.value, 0)
        return 0

    def expr(self, rbp: int) -> Node:
        left = self.nud(rbp)
        while self.lbp() > rbp:
            left = self.led(left)
        return left

    def cmp_op(self) -> str:
        t = self.next()
        if t.kind == "kw" and t.value == "not":
            self.next()
            return "not in"
        return t.value

    def led(self, left: Node) -> Node:
        t = self.peek()
        bp = self.lbp()
        if bp == 40:
            ops: list[str] = []
            operands = [left]
            while self.lbp() == 40:
                ops.append(self.cmp_op())
                operands.append(self.expr(40))
            return Node("compare", (left.span[0], operands[-1].span[1]), ops=ops, kids=operands)
        self.next()
        op = t.value
        right = self.expr(79 if op == "**" else bp)
        return Node("binary", (left.span[0], right.span[1]), op=op, kids=[left, right])

    def nud(self, rbp: int) -> Node:
        t = self.next()
        if t.kind == "num":
            return Node("num", t.span, value=t.value)
        if t.kind == "str":
            return Node("str", t.span, value=t.value)
        if t.kind == "kw":
            if t.value in ("true", "false"):
                return Node("bool", t.span, value=t.value == "true")
            if t.value == "null":
                return Node("null", t.span)
            if t.value == "not":
                if rbp > 30:
                    raise ExprError("'not' needs parentheses here: (not …)", t.span)
                operand = self.expr(30)
                return Node("unary", (t.span[0], operand.span[1]), op="not", kids=[operand])
            raise self.unexpected(t)
        if t.kind == "op":
            if t.value in ("-", "+"):
                operand = self.expr(70)
                return Node("unary", (t.span[0], operand.span[1]), op=t.value, kids=[operand])
            if t.value == "(":
                inner = self.expr(0)
                close = self.peek()
                if not self.is_op(close, ")"):
                    if close.kind == "eof":
                        raise ExprError("unclosed '('", t.span)
                    raise ExprError(f"expected ')' but found {self.text(close)}", close.span)
                self.next()
                return inner
            if t.value == "[":
                items: list[Node] = []
                while not self.is_op(self.peek(), "]"):
                    items.append(self.expr(0))
                    sep = self.peek()
                    if self.is_op(sep, ","):
                        self.next()
                        continue
                    if self.is_op(sep, "]"):
                        break
                    if sep.kind == "eof":
                        raise ExprError("unclosed '['", t.span)
                    raise ExprError(f"expected ',' or ']' but found {self.text(sep)}", sep.span)
                close = self.next()
                return Node("list", (t.span[0], close.span[1]), kids=items)
            raise self.unexpected(t)
        if t.kind == "name":
            if self.is_op(self.peek(), "("):
                return self.call(t)
            return _name_node(t.value, t.span)
        raise self.unexpected(t)

    def call(self, t: _Tok) -> Node:
        text, quoted = t.value[0]
        if len(t.value) != 1 or quoted:
            raise ExprError(f"'{self.src[t.span[0]:t.span[1]]}' is not a function", t.span)
        if text not in FUNCTION_NAMES:
            raise ExprError(f"unknown function '{text}'{_did_you_mean(text, FUNCTION_NAMES)}", t.span)
        open_ = self.next()
        args: list[Node] = []
        if not self.is_op(self.peek(), ")"):
            while True:
                args.append(self.expr(0))
                sep = self.peek()
                if self.is_op(sep, ","):
                    self.next()
                    continue
                if self.is_op(sep, ")"):
                    break
                if sep.kind == "eof":
                    raise ExprError("unclosed '('", open_.span)
                raise ExprError(f"expected ',' or ')' but found {self.text(sep)}", sep.span)
        close = self.next()
        return Node("call", (t.span[0], close.span[1]), name=text, kids=args, fn_span=t.span)


def _name_node(segments: list[tuple[str, bool]], span: tuple[int, int]) -> Node:
    head, quoted = segments[0]
    rest = [s for s, _ in segments[1:]]
    if not quoted:
        if head in ("config", "summary"):
            if not rest:
                raise ExprError(f"'{head}' needs a key, e.g. {head}.lr", span)
            return Node(head, span, name=".".join(rest))
        if head == "run":
            if not rest:
                fields = ", ".join(f"run.{f}" for f in RUN_FIELDS)
                raise ExprError(f"'run' needs a field: {fields}", span)
            f = ".".join(rest)
            if len(rest) != 1 or f not in RUN_FIELDS:
                raise ExprError(f"unknown run field '{f}'{_did_you_mean(f, RUN_FIELDS)}", span)
            return Node("run", span, name=f)
        if head in AXES:
            if rest:
                full = ".".join([head, *rest])
                raise ExprError(
                    f"'{head}' has no fields; quote a metric named like this: `{full}`", span)
            return Node("axis", span, name=head)
    return Node("metric", span, name=".".join(s for s, _ in segments))


def _parse_range(src: str, start: int, end: int) -> Node:
    try:
        toks = _tokenize(src[start:end])
    except ExprError as e:
        raise ExprError(e.message, (e.span[0] + start, e.span[1] + start)) from None
    for t in toks:
        t.span = (t.span[0] + start, t.span[1] + start)
    return _Parser(src, toks).parse_top()


def parse(src: str) -> Node:
    """Parse an expression; raises :class:`ExprError` with the offending span."""
    return _parse_range(src, 0, len(src))


@dataclass
class TemplateHole:
    node: Node
    src: str
    span: tuple[int, int]


@dataclass
class Template:
    parts: list[str | TemplateHole]


def parse_template(src: str) -> Template:
    """Parse ``"loss ${last(loss)}"``; ``$$`` is a literal ``$``."""
    parts: list[str | TemplateHole] = []
    text = ""
    i, n = 0, len(src)
    while i < n:
        c = src[i]
        nxt = src[i + 1] if i + 1 < n else None
        if c == "$" and nxt == "$":
            text += "$"
            i += 2
            continue
        if c == "$" and nxt == "{":
            j = i + 2
            quote = None
            while j < n:
                d = src[j]
                if quote is not None:
                    if d == "\\" and quote != "`":
                        j += 1
                    elif d == quote:
                        quote = None
                elif d in "\"'`":
                    quote = d
                elif d == "}":
                    break
                j += 1
            if j >= n:
                raise ExprError("unclosed '${'", (i, n))
            if src[i + 2:j].strip() == "":
                raise ExprError("empty expression", (i, j + 1))
            if text:
                parts.append(text)
            text = ""
            parts.append(TemplateHole(_parse_range(src, i + 2, j), src[i + 2:j], (i, j + 1)))
            i = j + 1
            continue
        text += c
        i += 1
    if text:
        parts.append(text)
    return Template(parts)


# ---------------------------------------------------------------------------
# Types
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class ExprType:
    shape: str  # scalar | series
    base: str   # number | bool | string | any

    def __str__(self) -> str:
        return f"{self.shape}<{self.base}>"


def _S(base: str) -> ExprType:
    return ExprType("scalar", base)


def _join(*ts: ExprType) -> str:
    return "series" if any(t.shape == "series" for t in ts) else "scalar"


def _describe(t: ExprType) -> str:
    if t.shape == "series":
        return f"a {t.base} series"
    return "a value" if t.base == "any" else f"a {t.base}"


def _not_string(t: ExprType, node: Node, what: str) -> None:
    if t.base == "string":
        raise ExprError(f"{what} needs a number, got a string", node.span)


def _need_series(t: ExprType, node: Node, fn: str) -> None:
    if t.shape != "series":
        raise ExprError(f"{fn}() needs a series, got {_describe(t)}", node.span)


def _arity(node: Node, n: int, sig: str) -> None:
    if len(node.kids) != n:
        raise ExprError(f"{node.name}() takes {n} argument{'' if n == 1 else 's'}: {sig}", node.span)


def check(node: Node) -> ExprType:
    """The expression's type; raises :class:`ExprError` on the first type error."""
    t = node.type
    if t == "num":
        return _S("number")
    if t == "str":
        return _S("string")
    if t == "bool":
        return _S("bool")
    if t == "null":
        return _S("any")
    if t == "list":
        for it in node.kids:
            if check(it).shape == "series":
                raise ExprError("list items must be scalars", it.span)
        return _S("any")
    if t in ("metric", "axis"):
        return ExprType("series", "number")
    if t in ("config", "summary"):
        return _S("any")
    if t == "run":
        return _S("any" if node.name in ("tags", "created_at") else "string")
    if t == "unary":
        ot = check(node.kids[0])
        if node.op == "not":
            return ExprType(ot.shape, "bool")
        _not_string(ot, node.kids[0], f"unary '{node.op}'")
        return ExprType(ot.shape, "number")
    if t == "binary":
        lt, rt = check(node.kids[0]), check(node.kids[1])
        shape = _join(lt, rt)
        if node.op in ("and", "or"):
            return ExprType(shape, "bool")
        ls, rs = lt.base == "string", rt.base == "string"
        if node.op == "+" and (ls or rs):
            if ls and rs:
                return ExprType(shape, "string")
            if lt.base == "any" or rt.base == "any":
                return ExprType(shape, "any")
            raise ExprError(f"cannot add {lt.base} and {rt.base}", node.span)
        if ls or rs:
            raise ExprError(f"'{node.op}' needs numbers, got a string",
                            (node.kids[0] if ls else node.kids[1]).span)
        if node.op == "+" and (lt.base == "any" or rt.base == "any"):
            return ExprType(shape, "any")
        return ExprType(shape, "number")
    if t == "compare":
        ts = [check(k) for k in node.kids]
        for i, op in enumerate(node.ops):
            a, b = ts[i], ts[i + 1]
            if op in ("in", "not in"):
                if b.shape == "series":
                    raise ExprError(f"'{op}' needs a scalar container on the right", node.kids[i + 1].span)
            elif op not in ("==", "!="):
                num = lambda x: x.base in ("number", "bool")  # noqa: E731
                if (a.base == "string" and num(b)) or (num(a) and b.base == "string"):
                    raise ExprError(f"cannot order {a.base} and {b.base} with '{op}'",
                                    (node.kids[i].span[0], node.kids[i + 1].span[1]))
        return ExprType(_join(*ts), "bool")
    # call
    ts = [check(k) for k in node.kids]
    fn = node.name
    args = node.kids
    if fn in ("min", "max") and len(args) == 2:
        for tt, a in zip(ts, args):
            _not_string(tt, a, f"{fn}()")
        return ExprType(_join(*ts), "number")
    if fn in REDUCERS:
        if len(args) != 1:
            extra = f" (reduce) or 2: {fn}(a, b) (pointwise)" if fn in ("min", "max") else ""
            raise ExprError(f"{fn}() takes 1 argument: {fn}(series){extra}", node.span)
        _not_string(ts[0], args[0], f"{fn}()")
        return _S("number") if ts[0].shape == "series" else ts[0]
    if fn in ("cummin", "cummax", "diff"):
        _arity(node, 1, f"{fn}(series)")
        _need_series(ts[0], args[0], fn)
        return ExprType("series", "number")
    if fn == "ema":
        _arity(node, 2, "ema(series, alpha)")
        _need_series(ts[0], args[0], fn)
        if ts[1].shape != "scalar":
            raise ExprError("ema() alpha must be a scalar", args[1].span)
        _not_string(ts[1], args[1], "ema() alpha")
        return ExprType("series", "number")
    if fn in ("log", "exp", "abs"):
        _arity(node, 1, f"{fn}(x)")
        _not_string(ts[0], args[0], f"{fn}()")
        return ExprType(ts[0].shape, "number")
    if fn == "clip":
        _arity(node, 3, "clip(x, lo, hi)")
        for tt, a in zip(ts, args):
            _not_string(tt, a, "clip()")
        return ExprType(_join(*ts), "number")
    if fn in ("exact", "resample"):
        _arity(node, 2, f"{fn}(a, b)")
        _need_series(ts[0], args[0], fn)
        _need_series(ts[1], args[1], fn)
        return ts[0]
    raise ExprError(f"unknown function '{fn}'", node.fn_span or node.span)


# ---------------------------------------------------------------------------
# Deps / plan
# ---------------------------------------------------------------------------

def _reduced_metric(node: Node) -> dict[str, str] | None:
    if node.type != "call" or node.name not in REDUCERS or len(node.kids) != 1:
        return None
    a = node.kids[0]
    return {"metric": a.name, "reducer": node.name} if a.type == "metric" else None


def deps(node: Node) -> dict[str, list]:
    """``{metrics, config, summary, run, axes, reduced}``, unique, source order."""
    out: dict[str, list] = {"metrics": [], "config": [], "summary": [], "run": [], "axes": [],
                            "reduced": []}
    key = {"metric": "metrics", "config": "config", "summary": "summary", "run": "run",
           "axis": "axes"}

    def walk(n: Node) -> None:
        k = key.get(n.type)
        if k is not None and n.name not in out[k]:
            out[k].append(n.name)
        r = _reduced_metric(n)
        if r is not None and r not in out["reduced"]:
            out["reduced"].append(r)
        for kid in n.kids:
            walk(kid)

    walk(node)
    return out


def plan(node: Node) -> str:
    """``"stats"`` when per-metric stats suffice, else ``"series"``."""
    def ok(n: Node) -> bool:
        if _reduced_metric(n) is not None:
            return True
        if n.type in ("metric", "axis"):
            return False
        return all(ok(k) for k in n.kids)
    return "stats" if ok(node) else "series"


# ---------------------------------------------------------------------------
# Evaluation
# ---------------------------------------------------------------------------

@dataclass
class Series:
    steps: list[float]
    values: list[Any]   # float | bool | None


@dataclass
class EvalResult:
    value: Any          # a Series, or the scalar value
    type: ExprType
    warnings: list[ExprWarning]


def _num(v: Any) -> float | None:
    if isinstance(v, bool):
        return 1.0 if v else 0.0
    if isinstance(v, (int, float)):
        try:
            return float(v)
        except OverflowError:
            return None
    return None


def _cell(v: Any) -> Any:
    return v if isinstance(v, (bool, int, float)) else None


def _get(d: Any, k: str) -> Any:
    return d.get(k) if isinstance(d, dict) else getattr(d, k, None)


def _normalize(d: Any) -> Series:
    if d is None:
        return Series([], [])
    steps = list(_get(d, "steps") or [])
    values = list(_get(d, "values") or [])
    idx = sorted(range(len(steps)), key=lambda i: steps[i])
    return Series([steps[i] for i in idx], [_cell(values[i] if i < len(values) else None) for i in idx])


def _div(x: float, y: float) -> float:
    if y == 0:
        if x == 0 or x != x:
            return math.nan
        return math.copysign(math.inf, x) * math.copysign(1.0, y)
    return x / y


def _mod(x: float, y: float) -> float:
    if y == 0 or not math.isfinite(x) or math.isnan(y):
        return math.nan
    r = math.fmod(x, y)
    if r != 0 and (r < 0) != (y < 0):
        r += y
    return r


def _odd_int(y: float) -> bool:
    return math.isfinite(y) and y.is_integer() and abs(y) < 2 ** 53 and int(y) % 2 == 1


def _pow(x: float, y: float) -> float:
    """JS ``Math.pow``."""
    if math.isnan(y):
        return math.nan
    if y == 0:
        return 1.0
    if math.isnan(x):
        return math.nan
    if math.isinf(y) and abs(x) == 1:
        return math.nan
    try:
        return math.pow(x, y)
    except OverflowError:
        return -math.inf if x < 0 and _odd_int(y) else math.inf
    except ValueError:
        if x == 0:  # y < 0
            return -math.inf if math.copysign(1.0, x) < 0 and _odd_int(y) else math.inf
        return math.nan


def _arith(op: str, a: Any, b: Any) -> Any:
    if op == "+" and isinstance(a, str) and isinstance(b, str):
        return a + b
    x, y = _num(a), _num(b)
    if x is None or y is None:
        return None
    if op == "+":
        return x + y
    if op == "-":
        return x - y
    if op == "*":
        return x * y
    if op == "/":
        return _div(x, y)
    if op == "%":
        return _mod(x, y)
    return _pow(x, y)


def _truth(v: Any) -> bool | None:
    return None if v is None else bool(v)


def _and(a: bool | None, b: bool | None) -> bool | None:
    if a is False or b is False:
        return False
    return None if a is None or b is None else True


def _or(a: bool | None, b: bool | None) -> bool | None:
    if a is True or b is True:
        return True
    return None if a is None or b is None else False


_ORDER = {"<": "lt", "<=": "lte", ">": "gt", ">=": "gte"}


def _compare(op: str, a: Any, b: Any) -> bool | None:
    if op == "==":
        return bool(OPERATORS["exact"](a, b))
    if op == "!=":
        return not OPERATORS["exact"](a, b)
    if op in ("in", "not in"):
        try:
            r = bool(OPERATORS["in"](a, b))
        except (TypeError, ValueError):
            return None
        return r if op == "in" else not r
    if a is None or b is None:
        return None
    try:
        return bool(OPERATORS[_ORDER[op]](a, b))
    except (TypeError, ValueError):
        return None


def _point_minmax(fn: str, a: Any, b: Any) -> float | None:
    x, y = _num(a), _num(b)
    if x is None or y is None:
        return None
    if math.isnan(x) or math.isnan(y):
        return math.nan
    return min(x, y) if fn == "min" else max(x, y)


def _unary_math(fn: str, a: Any) -> float | None:
    x = _num(a)
    if x is None:
        return None
    if fn == "abs":
        return abs(x)
    if fn == "exp":
        try:
            return math.exp(x)
        except OverflowError:
            return math.inf
    if math.isnan(x) or x < 0:
        return math.nan
    if x == 0:
        return -math.inf
    return math.log(x)


def _clip(a: Any, lo: Any, hi: Any) -> float | None:
    x, l_, h = _num(a), _num(lo), _num(hi)
    if x is None or l_ is None or h is None:
        return None
    if math.isnan(x) or math.isnan(l_) or math.isnan(h):
        return math.nan
    return min(max(x, l_), h)


_TZ_RE = re.compile(r"(?:Z|[+-]\d\d:?\d\d)$", re.IGNORECASE)
_EPOCH = datetime(1970, 1, 1, tzinfo=timezone.utc)


def parse_time(v: Any) -> float | None:
    """Epoch ms of a ``created_at``: a number is ms, a string is ISO (naive = UTC)."""
    if isinstance(v, (int, float)) and not isinstance(v, bool):
        return float(v) if math.isfinite(v) else None
    if not isinstance(v, str):
        return None
    try:
        dt = datetime.fromisoformat(re.sub(r"[zZ]$", "+00:00", v))
    except ValueError:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    td = dt - _EPOCH
    return float(td.days * 86_400_000 + td.seconds * 1000 + td.microseconds // 1000)


def _reduce(fn: str, s: Series) -> float | None:
    xs = [x for x in (_num(v) for v in s.values) if x is not None and not math.isnan(x)]
    if not xs:
        return None
    if fn == "first":
        return xs[0]
    if fn == "last":
        return xs[-1]
    if fn == "min":
        m = xs[0]
        for x in xs[1:]:
            if x < m:
                m = x
        return m
    if fn == "max":
        m = xs[0]
        for x in xs[1:]:
            if x > m:
                m = x
        return m
    acc = 0.0
    for x in xs:  # sequential, like JS (builtin sum() compensates since 3.12)
        acc += x
    return acc / len(xs)


def _as_of(s: Series) -> Callable[[float], Any]:
    """cairn-ui ``asOfLookup``: last non-null value at a step <= the step."""
    pts = [(st, v) for st, v in sorted(zip(s.steps, s.values), key=lambda p: p[0]) if v is not None]
    steps = [p[0] for p in pts]

    def look(step: float) -> Any:
        i = bisect.bisect_right(steps, step) - 1
        return None if i < 0 else pts[i][1]
    return look


def _join_lookup(s: Series) -> Callable[[float], tuple[Any, bool]]:
    at = dict(zip(s.steps, s.values))
    as_of = _as_of(s)
    return lambda step: (at[step], True) if step in at else (as_of(step), False)


_ASOF_MSG = ("series with different steps were joined as-of (each step takes the other series' "
             "last value at or before it); use exact() or resample() to choose")


class _Evaluator:
    def __init__(self, ctx: Any, first_metric: str | None, domain: Any) -> None:
        self.ctx = ctx
        self.first_metric = first_metric
        self.domain = domain
        self.warnings: list[ExprWarning] = []
        self.cache: dict[str, Series] = {}
        self.domain_cache: tuple[list, list] | None = None

    def metric(self, name: str) -> Series:
        if name not in self.cache:
            self.cache[name] = _normalize(self.ctx.series(name))
        return self.cache[name]

    def axis_domain(self, span: tuple[int, int], axis: str) -> tuple[list, list]:
        if self.domain_cache is not None:
            return self.domain_cache
        if self.domain is None and self.first_metric is None:
            raise ExprError(f"'{axis}' needs a metric in the expression to take its steps from", span)
        d = self.domain if self.domain is not None else self.ctx.series(self.first_metric)
        steps = list(_get(d, "steps") or []) if d is not None else []
        wall = list(_get(d, "wall") or []) if d is not None else []
        idx = sorted(range(len(steps)), key=lambda i: steps[i])
        w = [wall[i] if i < len(wall) and isinstance(wall[i], (int, float))
             and not isinstance(wall[i], bool) else None for i in idx]
        self.domain_cache = ([steps[i] for i in idx], w)
        return self.domain_cache

    def zip(self, args: list[Any], fn: Callable[[list], Any], span: tuple[int, int]) -> Any:
        base = next((a for a in args if isinstance(a, Series)), None)
        if base is None:
            return fn(args)
        inexact = False
        getters: list[Callable[[float, int], Any]] = []
        for a in args:
            if not isinstance(a, Series):
                getters.append(lambda step, i, a=a: a)
            elif a is base:
                getters.append(lambda step, i: base.values[i])
            else:
                look = _join_lookup(a)

                def g(step: float, i: int, look: Any = look) -> Any:
                    nonlocal inexact
                    v, exact = look(step)
                    if not exact and base.values[i] is not None:
                        inexact = True
                    return v
                getters.append(g)
        values = [_cell(fn([g(step, i) for g in getters])) for i, step in enumerate(base.steps)]
        if inexact:
            self.warnings.append(ExprWarning("asof-join", _ASOF_MSG, span))
        return Series(list(base.steps), values)

    @staticmethod
    def map(v: Any, fn: Callable[[Any], Any]) -> Any:
        if isinstance(v, Series):
            return Series(list(v.steps), [_cell(fn(x)) for x in v.values])
        return fn(v)

    def ev(self, node: Node) -> Any:
        t = node.type
        if t in ("num", "str", "bool"):
            return node.value
        if t == "null":
            return None
        if t == "list":
            return [self.ev(k) for k in node.kids]
        if t == "metric":
            return self.metric(node.name)
        if t == "config":
            return self.ctx.config(node.name)
        if t == "summary":
            return self.ctx.summary(node.name)
        if t == "run":
            return self.ctx.run(node.name)
        if t == "axis":
            steps, wall = self.axis_domain(node.span, node.name)
            if node.name == "step":
                return Series(list(steps), list(steps))
            if node.name == "wall_time":
                return Series(list(steps), list(wall))
            created = parse_time(self.ctx.run("created_at"))
            return Series(list(steps), [None if w is None or created is None else (w - created) / 1000
                                        for w in wall])
        if t == "unary":
            v = self.ev(node.kids[0])
            if node.op == "not":
                def neg(x: Any) -> Any:
                    tr = _truth(x)
                    return None if tr is None else not tr
                return self.map(v, neg)

            def sign(x: Any) -> Any:
                n = _num(x)
                return None if n is None else (-n if node.op == "-" else n)
            return self.map(v, sign)
        if t == "binary":
            l_, r = self.ev(node.kids[0]), self.ev(node.kids[1])
            op = node.op
            if op == "and":
                return self.zip([l_, r], lambda xs: _and(_truth(xs[0]), _truth(xs[1])), node.span)
            if op == "or":
                return self.zip([l_, r], lambda xs: _or(_truth(xs[0]), _truth(xs[1])), node.span)
            return self.zip([l_, r], lambda xs: _arith(op, xs[0], xs[1]), node.span)
        if t == "compare":
            vals = [self.ev(k) for k in node.kids]
            ops = node.ops

            def chain(xs: list) -> Any:
                acc: bool | None = True
                for i, o in enumerate(ops):
                    acc = _and(acc, _compare(o, xs[i], xs[i + 1]))
                return acc
            return self.zip(vals, chain, node.span)
        return self.call(node)

    def call(self, node: Node) -> Any:
        fn = node.name
        a0 = node.kids[0] if node.kids else None
        if fn in REDUCERS and len(node.kids) == 1:
            stat = getattr(self.ctx, "stat", None)
            if a0.type == "metric" and stat is not None:
                v = stat(a0.name, fn)
                if v is not MISSING:
                    return v
            v = self.ev(a0)
            return _reduce(fn, v) if isinstance(v, Series) else v
        args = [self.ev(k) for k in node.kids]
        if fn in ("min", "max"):
            return self.zip(args, lambda xs: _point_minmax(fn, xs[0], xs[1]), node.span)
        if fn in ("log", "exp", "abs"):
            return self.map(args[0], lambda x: _unary_math(fn, x))
        if fn == "clip":
            return self.zip(args, lambda xs: _clip(xs[0], xs[1], xs[2]), node.span)
        if fn in ("cummin", "cummax"):
            s = args[0]
            state = None
            out = []
            for v in s.values:
                x = _num(v)
                if x is None:
                    out.append(None)
                elif math.isnan(x):
                    out.append(math.nan)
                else:
                    state = x if state is None else (min(state, x) if fn == "cummin" else max(state, x))
                    out.append(state)
            return Series(list(s.steps), out)
        if fn == "diff":
            s = args[0]
            prev = None
            out = []
            for v in s.values:
                x = _num(v)
                if x is None:
                    out.append(None)
                    continue
                out.append(None if prev is None else x - prev)
                prev = x
            return Series(list(s.steps), out)
        if fn == "ema":
            s = args[0]
            alpha = _num(args[1])
            if alpha is None or math.isnan(alpha):
                return Series(list(s.steps), [None] * len(s.values))
            # cairn-ui smooth.ts emaSmooth: y[i] = a*y[i-1] + (1-a)*raw[i], seeded with raw[0].
            a = min(max(alpha, 0.0), 0.999)
            out = [None] * len(s.values)
            prev = None
            for i, v in enumerate(s.values):
                y = _num(v)
                if y is None:
                    continue
                if prev is None:
                    prev = y
                sm = a * prev + (1 - a) * y
                prev = sm
                out[i] = sm
            return Series(list(s.steps), out)
        if fn == "exact":
            a, b = args
            keep = set(b.steps)
            pairs = [(st, v) for st, v in zip(a.steps, a.values) if st in keep]
            return Series([p[0] for p in pairs], [p[1] for p in pairs])
        if fn == "resample":
            look = _join_lookup(args[0])
            b = args[1]
            return Series(list(b.steps), [look(st)[0] for st in b.steps])
        raise ExprError(f"unknown function '{fn}'", node.fn_span or node.span)


def evaluate(expr: str | Node, ctx: Any, *, domain: Any = None) -> EvalResult:
    """Evaluate ``expr`` for one run. Raises :class:`ExprError` on parse/type
    errors (and an axis root without a domain); data problems yield None."""
    node = parse(expr) if isinstance(expr, str) else expr
    typ = check(node)
    metrics = deps(node)["metrics"]
    ev = _Evaluator(ctx, metrics[0] if metrics else None, domain)
    return EvalResult(ev.ev(node), typ, ev.warnings)


def matches(result: EvalResult) -> bool:
    """A filter's verdict: a scalar that is not None and truthy."""
    v = result.value
    return not isinstance(v, Series) and v is not None and bool(v)


# ---------------------------------------------------------------------------
# Templates
# ---------------------------------------------------------------------------

def _strip(s: str) -> str:
    return s.rstrip("0").rstrip(".") if "." in s else s


def format_g(x: float, p: int = 6) -> str:
    """``"%.{p}g" % x`` with ties rounded away from zero (as JS
    ``toExponential``/``toFixed``, which cairn-ui's ``formatG`` uses)."""
    if math.isnan(x):
        return "nan"
    if math.isinf(x):
        return "inf" if x > 0 else "-inf"
    if x == 0:
        return "-0" if math.copysign(1.0, x) < 0 else "0"
    d = Decimal(x)
    adj = d.adjusted()
    r = d.quantize(Decimal(1).scaleb(adj - p + 1), rounding=ROUND_HALF_UP)
    exp = r.adjusted()
    if -4 <= exp < p:
        decimals = max(0, p - 1 - exp)
        return _strip(format(d.quantize(Decimal(1).scaleb(-decimals), rounding=ROUND_HALF_UP), "f"))
    mant = _strip(format(r.scaleb(-exp), f".{p - 1}f"))
    return f"{mant}e{'-' if exp < 0 else '+'}{abs(exp):02d}"


def format_value(v: Any) -> str:
    """Default template text: None → "", bools true/false, numbers
    :func:`format_g`, lists joined by ", ", dicts compact JSON."""
    if v is None:
        return ""
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, (int, float)):
        return format_g(float(v))
    if isinstance(v, str):
        return v
    if isinstance(v, (list, tuple)):
        return ", ".join(format_value(x) for x in v)
    return json.dumps(v, separators=(",", ":"), ensure_ascii=False)


def check_template(tpl: Template) -> None:
    for part in tpl.parts:
        if isinstance(part, TemplateHole) and check(part.node).shape == "series":
            raise ExprError(
                f"template value is a series; reduce it, e.g. last({part.src.strip()})", part.span)


def render_template(tpl: str | Template, ctx: Any, *, domain: Any = None,
                    format: Callable[[Any], str] | None = None) -> str:  # noqa: A002
    t = parse_template(tpl) if isinstance(tpl, str) else tpl
    check_template(t)
    fmt = format or format_value
    out = []
    for part in t.parts:
        if isinstance(part, str):
            out.append(part)
        else:
            v = evaluate(part.node, ctx, domain=domain).value
            out.append(fmt(None if isinstance(v, Series) else v))
    return "".join(out)
