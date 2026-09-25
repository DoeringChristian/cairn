# Expression language

cairn has one small, Python-like expression language for values derived from a run. The same language drives:

- run filters, computed columns, group-by and colour-by in the [runs table](../ui/runs-table.md)
- the x-axis, derived series and legend/tooltip templates of scalar cards, and the per-run values of scatter, parallel-coordinates, bar, tile and importance cards (see [Cards](../ui/cards.md))
- derived columns and the row query of table cards
- `where()` and `Run.eval()` in Python (see [Reading data back](../guides/reading.md))

The web UI (`src/lib/expr/` in cairn-ui) and Python (`cairn.expr`) implement it twice. Both run the same test vectors (`docs/schemas/expr-vectors.json` in cairn-ui), so an expression gives the same result in both. Every example on this page comes from those vectors.

```text
last(val.acc) > 0.9 and config.optimizer in ["adam", "sgd"]
min(val.loss)
ema(loss, 0.9)
loss / step
${run.name} lr=${config.lr}
```

## Literals

| Literal | Examples |
|---|---|
| Number | `1`, `.5`, `1.`, `1e3`, `2.5e-3` |
| String | `'it\'s'`, `"a\nb"`. Use single or double quotes. The escapes are `\n`, `\t`, `\\`, `\'` and `\"`. |
| Boolean | `true`, `false` (also `True`, `False`) |
| Null | `null` (also `None`) |
| List | `[1, 2, 3]`, `[1, [2, 'x']]`, `[]`. A trailing comma is allowed. Items must be scalars. |

Whitespace, including newlines, is ignored between tokens.

## Operators and precedence

The table lists operators from lowest to highest precedence.

| Precedence | Operators | Notes |
|---|---|---|
| 1 | `or` | |
| 2 | `and` | |
| 3 | `not` | |
| 4 | `==` `!=` `<` `<=` `>` `>=` `in` `not in` | Comparisons chain as in Python: `0 < x <= 1`. |
| 5 | `+` `-` | |
| 6 | `*` `/` `%` | |
| 7 | unary `-` `+` | |
| 8 | `**` | Right-associative, and binds tighter than unary minus. |
| 9 | calls, names, literals, `( )` | |

| Expression | Result |
|---|---|
| `1 + 2 * 3` | `7` |
| `2 ** 3 ** 2` | `512` |
| `-2 ** 2` | `-4` |
| `2 ** -1 * 4` | `2` |
| `1 < 2 < 3` | `true` |
| `1 < 2 == true` | `false` (chained: `1 < 2 and 2 == true`) |
| `not 1 == 2` | `true` |
| `true or false and false` | `true` |

`not` cannot appear directly as an operand: write `1 == (not 2)`, not `1 == not 2`.

The parser rejects operators from other languages with a hint. For example, `a && b` gives *unexpected '&&'; use 'and'*, and `a = 1` gives *unexpected '='; use '==' to compare*.

## Names

A bare name is a **metric** of the run. Dots belong to the name, so `train.loss` and `layer.0.w` are single metric names. Any other character needs backticks around the segment that contains it. Inside backticks, write a literal backtick as two backticks:

| Expression | Reads |
|---|---|
| `loss` | metric `loss` |
| `layer.0.w` | metric `layer.0.w` |
| `` `train/lr` `` | metric `train/lr` |
| `` `layer`.`0`.w `` | metric `layer.0.w` |
| ``` `a``b` ``` | metric ``` a`b ``` |
| `` config.`my key` `` | config key `my key` |

A quoted segment is never a keyword or a reserved root. `` `step` `` is a metric named `step`, `` `not` `` is a metric named `not`, and `` `config.lr` `` is a metric named `config.lr`. A bare function name that is not called, such as `min`, is also a metric.

### Reserved roots

When the first segment of a name is unquoted, these roots have special meanings:

| Root | Type | Meaning |
|---|---|---|
| `config.<key>` | scalar | A config value, by flattened dotted key. `config.model.width` reads the key `model.width`. |
| `summary.<key>` | scalar | A summary value, by flattened dotted key |
| `run.name`, `run.id`, `run.status`, `run.tags`, `run.group`, `run.job_type`, `run.created_at` | scalar | Run fields. `run.tags` is a list, so `"best" in run.tags` works. |
| `step` | series | The step of each point |
| `wall_time` | series | The wall-clock time of each point, in epoch milliseconds |
| `relative_time` | series | Seconds since `run.created_at` |

`config` and `summary` on their own are errors. So is an unknown run field, which gets a suggestion: `run.nme` gives *unknown run field 'nme'; did you mean 'name'?*.

`step`, `wall_time` and `relative_time` are evaluated over a **domain**: the steps of the first metric in the expression, or the line being drawn when the expression is a scalar card's x-axis. With neither, they are an error:

| Expression | Result |
|---|---|
| `step` (no domain) | error: *'step' needs a metric in the expression to take its steps from* |
| `loss + step` | `loss` shifted by its own steps |
| `relative_time + 0 * loss` | the seconds since the run started, at each `loss` step |

A missing metric is an empty series. A missing config or summary key is `null`.

!!! note "Where `summary.` reads from"
    In the runs table, `summary.<key>` reads the table's metric value column: the last point, a `summary=` rule, or an explicit summary key. In cards and in Python, it reads only values you recorded with `run.summary(...)`.

## Types

Every expression has a static type, `scalar` or `series`, over `number`, `bool`, `string` or `any`. Type errors are reported before evaluation, with the source position:

| Expression | Type |
|---|---|
| `config.lr * 1000` | `scalar<number>` |
| `run.name` | `scalar<string>` |
| `config.sched` | `scalar<any>` |
| `loss` | `series<number>` |
| `loss > 1` | `series<bool>` |
| `last(loss)` | `scalar<number>` |

| Error | Message |
|---|---|
| `"x" * 2` | *'\*' needs numbers, got a string* |
| `1 + "a"` | *cannot add number and string* |
| `"a" < 1` | *cannot order string and number with '<'* |
| `[loss]` | *list items must be scalars* |
| `1 in loss` | *'in' needs a scalar container on the right* |

### Broadcasting and the as-of join

A scalar combined with a series applies to every point: `loss * 2` and `loss + config.lr` are series over `loss`'s steps.

Two series with the **same steps** combine pointwise. Two series with **different steps** are combined by an **as-of join** onto the steps of the *left* series: at each of those steps, the right series contributes its last non-null value at a step less than or equal to that step. Because the result depends on operand order and may not be what you meant, it carries an **as-of join warning**. The UI shows the warning as a badge, and Python emits a `cairn.expr.ExprWarning`.

With `loss` logged at steps 0–4 and `acc` at steps 0, 2 and 4:

| Expression | Steps | Warning |
|---|---|---|
| `loss - acc` | 0, 1, 2, 3, 4 | yes |
| `acc - loss` | 0, 2, 4 | no |
| `exact(loss, acc)` | 0, 2, 4 | no |
| `resample(acc, loss)` | 0, 1, 2, 3, 4 | no |

Use `exact` or `resample` to state which join you want; neither one warns.

## Values and nulls

- Arithmetic follows IEEE rules: `1 / 0` is `inf`, `0 / 0` is `nan`, and `10 ** 400` is `inf`.
- `%` works as in Python, and the result takes the sign of the divisor: `-7 % 3` is `2`, `7 % -3` is `-2`. `x % 0` is `nan`.
- Booleans count as 0 and 1: `true + true` is `2`.
- `+` concatenates two strings: `"a" + "b"` is `"ab"`.
- Any other operand that is not a number (null, a list, a string whose type is only known at runtime) gives `null`: `config.missing + 1` is `null`, `config.betas + 1` is `null`.
- Comparisons follow Python: `true == 1`, `1 == 1.0`, `"1" == 1` is false, lists compare lexicographically, and `in` on a string tests for a substring (`"b" in "abc"`). `in` on a mapping tests its keys (`"kind" in config.sched`).
- An ordering comparison with `null`, or one Python would raise on (`config.optimizer < 1`), gives `null`. Any comparison with `nan` other than `!=` is false.
- `and`, `or` and `not` use three-valued logic over Python truthiness, with `null` meaning unknown: `null and false` is `false`, `null or true` is `true`, `null and true` is `null`, `not null` is `null`, and `"" or 1` is `true`.

A **filter** matches a run when its expression evaluates to a scalar that is not `null` and is truthy. A series never matches, so reduce it first: `last(loss) < 0.1`.

## Functions

Unknown function names get a suggestion: `mian(loss)` gives *unknown function 'mian'; did you mean 'min'?*.

### Reducers: series to scalar

| Function | Result |
|---|---|
| `min(s)` | smallest value |
| `max(s)` | largest value |
| `mean(s)` | arithmetic mean |
| `first(s)` | value at the lowest step |
| `last(s)` | value at the highest step |

Reducers skip `null` and `nan` points and return `null` for an empty series. On a scalar they return it unchanged (`mean(3)` is `3`). A reducer works on any numeric or boolean series, so `mean(loss > 1)` is the fraction of points above 1.

When the UI evaluates a reducer over a bare metric (`min(val.loss)`, but not `min(val.loss + 0)`), it uses the server's precomputed per-metric statistics and does not fetch the series. In the runs table this is the only way to use a metric: there are no series there, so an expression that needs a whole series (`last(loss * 2)`) evaluates to `null`.

### Pointwise

These work on scalars and series alike. The result is a series if any argument is one.

| Function | Result |
|---|---|
| `min(a, b)`, `max(a, b)` | smaller or larger of the two (`min(loss, 1)` caps `loss` at 1) |
| `log(x)` | natural logarithm (`log(0)` is `-inf`, `log(-1)` is `nan`) |
| `exp(x)` | eˣ |
| `abs(x)` | absolute value |
| `clip(x, lo, hi)` | `x` limited to `[lo, hi]` |

With one argument, `min` and `max` reduce. With two, they work pointwise. Any other number of arguments is an error.

### Series transforms

These take a series and return a series over the same steps.

| Function | Result |
|---|---|
| `cummin(s)` | running minimum |
| `cummax(s)` | running maximum |
| `diff(s)` | difference to the previous non-null point. The first point is `null`. |
| `ema(s, alpha)` | exponential moving average over the non-null points. This is the same EMA as the charts' smoothing. `alpha` must be a scalar and is clamped to `[0, 0.999]`; `0` means no smoothing. |

| Expression | Values (`loss` = 2, 1.5, null, 0.8, 0.5) |
|---|---|
| `cummax(loss)` | 2, 2, null, 2, 2 |
| `diff(loss)` | null, -0.5, null, -0.7, -0.3 |
| `ema(loss, 0.5)` | 2, 1.75, null, 1.275, 0.8875 |

### Explicit joins

| Function | Result |
|---|---|
| `exact(a, b)` | `a` at the steps where `b` has a value (and `a` has that step) |
| `resample(a, b)` | `a`'s as-of value at every step of `b` |

Both arguments must be series.

## Templates

Text settings such as the scalar card's legend and tooltip templates and the scatter card's point label are **templates**: literal text with `${expression}` holes. Write `$$` for a literal `$`.

| Template | Renders |
|---|---|
| `lr=${config.lr}` | `lr=0.001` |
| `${run.name} (${run.status})` | `run-1 (completed)` |
| `best ${max(acc)}` | `best 0.9` |
| `cost $$5 ${1+1}` | `cost $5 2` |
| `${run.tags}` | `best, baseline` |
| `[${config.missing}]` | `[]` |

Every hole must be a scalar. `${loss}` gives the error *template value is a series; reduce it, e.g. last(loss)*.

Values are formatted as follows:

- `null` renders as nothing.
- Booleans render as `true` or `false`.
- Lists are joined with `, `.
- Mappings render as compact JSON.
- Numbers use `%.6g`: `${1/3}` gives `0.333333`, `${123456789}` gives `1.23457e+08`, `${1e-5}` gives `1e-05`, and `${0/0}` gives `nan`.

## In Python

```python
import cairn

reader = cairn.Reader()

# Filter runs: the expression must be a scalar.
good = reader.runs("mnist").where("last(val.acc) > 0.9 and config.opt == 'adam'").list()

# Evaluate on one run: a scalar, or a cairn.expr.Series(steps, values).
run = good[0]
run.eval("last(val.loss) - min(val.loss)")
run.eval("ema(loss, 0.9)")
```

`where()` parses and type-checks the expression immediately. It raises `cairn.expr.ExprError` on a syntax error, and also when the expression is a series. `Run.eval()` raises `ExprError` on parse and type errors. Neither raises for missing data, which evaluates to `None`. An as-of join emits `cairn.expr.ExprWarning` through `warnings.warn`.

For your own data, the module `cairn.expr` exposes `parse`, `check`, `evaluate(expr, ctx, *, domain=None)`, `matches`, `parse_template` and `render_template`. `ctx` is any object with the methods `series(name)`, `config(key)`, `summary(key)` and `run(field)`. `series` returns `None` or something with `steps`, `values` and an optional `wall` (epoch ms).

!!! note "Error positions"
    Error spans count code points in Python and UTF-16 units in the UI. They differ only for characters outside the Basic Multilingual Plane.
