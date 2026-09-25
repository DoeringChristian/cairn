# Components and scopes

A component, such as a model, an encoder or a dataset, usually knows best what is worth recording
about itself. cairn lets it log itself: a component implements `__cairn_track__(self, scope)`,
and the training loop logs the whole tree with one call.

```python
import cairn

class Encoder:
    def __cairn_track__(self, scope):
        scope.track(self.weight_norm(), "weight_norm")

class Model:
    def __init__(self):
        self.encoder = Encoder()
        self.decoder = None                      # optional member

    def __cairn_track__(self, scope):
        scope.track(self.loss, "loss", summary="min")
        scope.track(self.encoder, "encoder")     # recurses into Encoder
        scope.track(self.decoder, "decoder")     # None: silently skipped
        scope.track(cairn.Image(self.render()), "pred")

with cairn.Run("scopes-demo") as run:
    for it in range(1000):
        model.step()
        run.track(model, "model", step=it)
# -> model.loss, model.encoder.weight_norm, model.pred
```

The caller never lists another object's internals, and a component logs the same way wherever it
is used.

## How it works

`run.track(value, name, step)` checks whether `value` has a `__cairn_track__` method. If it does,
cairn calls it with a `cairn.Scope`: a logging position that combines the run, a name prefix and
a step. Everything the component tracks through the scope:

- is **prefixed** with the scope's name, joined with `.` (`model` + `loss` → `model.loss`);
- lands on the **same step**, the one you passed at the top.

Because the step is bound once at the root, a member that is `None` on some iterations and skips
logging never shifts the other points onto the wrong step.

A name of `""` adds no segment: `run.track(model, "", step=it)` records `loss` and
`encoder.weight_norm` without a prefix.

## The `Scope` API

| Member | Description |
|---|---|
| `scope.track(value, name="", *, summary=None, x=None, **kwargs)` | Record `value` under the prefixed name, or recurse if it is a component. `None` is skipped. `summary`/`x` set a [metric rule](metric-rules.md) on scalar leaves. |
| `scope.config(...)` | Record the component's inputs, prefixed: `scope.config(n_samples=100)` under `data` sets `data.n_samples`. |
| `scope.summary(...)` | Record the component's results, prefixed, like [`run.summary`](logging.md#summary). |
| `scope.scope(name)` | A child scope one level deeper, with the same step. |
| `scope.run`, `scope.step`, `scope.name` | The run, the bound step, and the prefix (`""` at the root). |

`scope.config` exists because a property is not a metric. Tracking a dataset's size would create
a one-point series that is drawn as a single dot. Recording it as config puts it in the runs
table instead:

```python
class Dataset:
    def __cairn_track__(self, scope):
        scope.config(n_samples=len(self), augment=self.augment)

run.track(train_set, "data", step=0)     # -> config data.n_samples, data.augment
```

Nested values are flattened under the prefix: `scope.config(opt={"lr": 1e-3})` under `model`
records `model.opt.lr`.

## Metric rules inside components

`summary=` applies to the leaf's **full** name. `x=` is always a full name and is never prefixed,
so a component can plot against a top-level series of the run wherever it is mounted:

```python
def __cairn_track__(self, scope):
    scope.track(self.loss, "loss", summary="min", x="epoch")   # rule on model.loss, x = epoch
```

Passing `summary=` or `x=` when the value is itself a component raises `ValueError`. Set rules on
its scalar leaves instead.

## Handing a scope to a plain function

`Run` is already the root scope, so `run.track(component, ...)` needs nothing else. For code that
is not a component, such as an evaluation function, `run.scope(step=...)` returns a bound scope
to pass in:

```python
def evaluate(model, scope):
    scope.track(accuracy(model), "acc")
    scope.scope("per_class").track(per_class_iou(model)[0], "background")

evaluate(model, run.scope(step=it).scope("eval"))   # -> eval.acc, eval.per_class.background
```

Don't construct `cairn.Scope` yourself. Get one from `run.scope(step=...)`, or receive one in
`__cairn_track__`.

## Cycles and depth

A component that points back at an object already on the current path (for example, a child
holding a reference to its parent) is skipped on that path, so the walk terminates. The same
component appearing in two different branches is recorded in both. Trees deeper than 32 levels
raise `RecursionError`, which usually means `__cairn_track__` builds a fresh object at every
level.

## Why a dunder method

A plain method name like `track` could collide with an existing method that means something
else. `__cairn_track__` can't collide, so cairn only needs one `hasattr` check to know that an
object opts in. It follows the same convention as `__array__` or `__rich__`.

With a [disabled run](runs.md#disabled-runs), `run.track` returns immediately without calling
`__cairn_track__`. `run.scope(step=...)` still returns a working scope, but everything it records
is discarded.
