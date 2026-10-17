"""Prism's bounded AST expression evaluator over captured JSON data.

Field access only reads dictionary/list values; it never accesses Python objects.
"""
import ast
import math
import operator
from .engine import ReportError

_BINARY = {
    ast.Add: operator.add,
    ast.Sub: operator.sub,
    ast.Mult: operator.mul,
    ast.Div: operator.truediv,
    ast.FloorDiv: operator.floordiv,
    ast.Mod: operator.mod,
}
_COMPARE = {
    ast.Eq: operator.eq,
    ast.NotEq: operator.ne,
    ast.Lt: operator.lt,
    ast.LtE: operator.le,
    ast.Gt: operator.gt,
    ast.GtE: operator.ge,
}
_FUNCTIONS = {
    "abs",
    "min",
    "max",
    "sum",
    "mean",
    "len",
    "sqrt",
    "log",
    "log10",
    "exp",
    "floor",
    "ceil",
    "round",
    "clip",
    "coalesce",
    "contains",
}


def invalid(message):
    raise ReportError(message)


def _numeric(value):
    try:
        return (
            isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)
        )
    except OverflowError:
        return False


class Expression:
    def __init__(self, source):
        if not isinstance(source, str) or not 1 <= len(source) <= 1024:
            invalid("Expression must contain 1–1024 characters")
        try:
            self.tree = ast.parse(source, mode="eval").body
        except (SyntaxError, RecursionError) as error:
            invalid(f"Invalid expression: {str(error).splitlines()[0]}")
        nodes = list(ast.walk(self.tree))
        if len(nodes) > 100:
            invalid("Expression is too complex (maximum 100 syntax nodes)")
        allowed = (
            ast.Constant,
            ast.Name,
            ast.Attribute,
            ast.Subscript,
            ast.Load,
            ast.BinOp,
            ast.UnaryOp,
            ast.BoolOp,
            ast.Compare,
            ast.IfExp,
            ast.Call,
            ast.USub,
            ast.UAdd,
            ast.Not,
            ast.And,
            ast.Or,
            ast.Pow,
            *tuple(_BINARY),
            *tuple(_COMPARE),
        )
        for node in nodes:
            if not isinstance(node, allowed):
                invalid(f"Unsupported expression syntax: {type(node).__name__}")
            if isinstance(node, ast.Name) and node.id.startswith("_"):
                invalid("Private names are not allowed")
            if isinstance(node, ast.Attribute) and node.attr.startswith("_"):
                invalid("Private fields are not allowed")
            if isinstance(node, ast.Subscript) and (
                not isinstance(node.slice, ast.Constant)
                or not isinstance(node.slice.value, (str, int))
                or isinstance(node.slice.value, bool)
            ):
                invalid("Field indexes must be literal strings or integers")
            if isinstance(node, ast.Constant) and (
                not isinstance(node.value, (str, int, float, bool, type(None)))
                or isinstance(node.value, (int, float))
                and abs(node.value) > 1e100
            ):
                invalid("Unsupported literal")
            if isinstance(node, ast.Call) and (
                not isinstance(node.func, ast.Name)
                or node.func.id not in _FUNCTIONS
                or node.keywords
                or len(node.args) > 8
            ):
                invalid(
                    "Only documented numeric/data functions with positional arguments are allowed"
                )

    def __call__(self, context):
        try:
            value = self._read(self.tree, context)
            if isinstance(value, float) and not math.isfinite(value):
                return None
            return value
        except (ValueError, TypeError, ZeroDivisionError, OverflowError, IndexError, KeyError):
            return None

    def _read(self, node, context):
        def read(child):
            return self._read(child, context)

        if isinstance(node, ast.Constant):
            return node.value
        if isinstance(node, ast.Name):
            return context.get(node.id, context.get("record", {}).get(node.id))
        if isinstance(node, (ast.Attribute, ast.Subscript)):
            parent = read(node.value)
            key = node.attr if isinstance(node, ast.Attribute) else node.slice.value
            if isinstance(parent, dict):
                return parent.get(str(key))
            if isinstance(parent, list) and isinstance(key, int):
                return parent[key]
            return None
        if isinstance(node, ast.BinOp):
            left, right = read(node.left), read(node.right)
            if not _numeric(left) or not _numeric(right):
                return None
            if isinstance(node.op, ast.Pow):
                return math.pow(left, right) if abs(right) <= 16 else None
            return _BINARY[type(node.op)](left, right)
        if isinstance(node, ast.UnaryOp):
            value = read(node.operand)
            if isinstance(node.op, ast.Not):
                return not value
            if not _numeric(value):
                return None
            return -value if isinstance(node.op, ast.USub) else value
        if isinstance(node, ast.IfExp):
            return read(node.body if read(node.test) else node.orelse)
        if isinstance(node, ast.BoolOp):
            if isinstance(node.op, ast.And):
                return all(bool(read(child)) for child in node.values)
            return any(bool(read(child)) for child in node.values)
        if isinstance(node, ast.Compare):
            left = read(node.left)
            for op, other in zip(node.ops, node.comparators, strict=True):
                right = read(other)
                if not _COMPARE[type(op)](left, right):
                    return False
                left = right
            return True
        if isinstance(node, ast.Call):
            args = [read(arg) for arg in node.args]
            name = node.func.id
            if name == "coalesce":
                return next((value for value in args if value is not None), None)
            if name == "len":
                return (
                    len(args[0])
                    if len(args) == 1 and isinstance(args[0], (list, dict, str))
                    else None
                )
            if name == "contains":
                return (
                    args[1] in args[0]
                    if len(args) == 2 and isinstance(args[0], (list, str, dict))
                    else None
                )
            if name in {"sum", "mean", "min", "max"}:
                values = args[0] if len(args) == 1 and isinstance(args[0], list) else args
                if (
                    not values
                    or len(values) > 10_000
                    or not all(_numeric(value) for value in values)
                ):
                    return None
                return {"sum": sum, "mean": lambda v: sum(v) / len(v), "min": min, "max": max}[
                    name
                ](values)
            if not all(_numeric(value) for value in args):
                return None
            if name == "clip":
                return min(max(args[0], args[1]), args[2]) if len(args) == 3 else None
            if name == "round":
                return (
                    round(*args)
                    if 1 <= len(args) <= 2
                    and (len(args) == 1 or isinstance(args[1], int) and abs(args[1]) <= 15)
                    else None
                )
            return {
                "abs": abs,
                "sqrt": math.sqrt,
                "log": math.log,
                "log10": math.log10,
                "exp": math.exp,
                "floor": math.floor,
                "ceil": math.ceil,
            }[name](*args)
        invalid("Unsupported expression")

