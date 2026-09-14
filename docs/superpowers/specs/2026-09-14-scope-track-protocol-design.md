# `cairn.Scope` and the `__cairn_track__` protocol

**Status:** approved design, not yet implemented.
**Date:** 2026-09-14

## Why

A component (a model, an encoding, a renderer) knows best what is worth
recording about itself. Today the caller has to know instead, so every training
loop re-lists its own internals, and the `research-project` skill ships a private
`track.py` that decides whether an object can log itself by **inspecting method
signatures / trusting a parameter name**.

That sniffing exists for one reason: the obvious verb, `log`, is also the
logarithm. Cairn's verb is already `track`, so naming it `track` makes the
collision *disappear* rather than get detected.

## The three names

| Surface | Name |
| --- | --- |
| The object | `cairn.Scope` |
| The call inside a component | `scope.track(value, name)` |
| The protocol a component implements | `__cairn_track__(self, scope)` |

`Scope` — not `Context` (`context=` is already a `run.track` keyword meaning
something else), and not `Logger` (drags in stdlib associations it does not
have). `scope`, `Tracker` and `Namespace` are all currently free names in cairn.

A `Scope` is precisely **`run.track` with `step`/`context` pre-bound, plus a name
prefix**. Nothing more.

## Entry points

`Run` *is* the root scope (empty prefix, `step` from the kwarg), so the common
case adds **no new API**: `run.track` checks for the protocol and recurses.

```python
# common case — unchanged call, new behaviour
for it in range(n):
    run.track(model, "model", step=it)

# the protocol side
class Model:
    def __cairn_track__(self, scope):
        scope.track(self.rms(), "rms")
        scope.track(self.encoding, "encoding")   # recurses
        scope.track(self.render(), "pred")

# escape hatch: a pre-bound logger for code that is not a component
s = run.scope(step=it)
evaluate(model, s)          # s.track(...) inside
```

`run.scope(step=..., context=...) -> Scope` exists for the case recursion cannot
cover — handing a bound logger to a plain function. It is deliberately the
secondary path.

**Accepted cost:** `run.track` becomes polymorphic — one call either records a
leaf or walks a tree. This is the trade for one verb everywhere, and it is
resolved by a single `hasattr` with no ambiguity (see below).

## Why a dunder, not a plain method

A plain `def track(self, scope)` would force cairn to guess whether a given
`track` means *this* protocol — straight back to signature inspection. A
namespaced dunder cannot collide:

```python
if hasattr(value, "__cairn_track__"):   # walk it
```

Same shape as `__array__`, `__rich__`, and cairn's own `_repr_html_`: an object
describes itself to a renderer without the renderer knowing its type. The cost is
that it reads as ceremony in user code — the usual protocol-method trade.

*Rejected fallback:* `def track(self, scope)` + a `runtime_checkable` Protocol.
`runtime_checkable` only checks that the **name** exists, never the signature, so
it buys typing support and **not** collision safety — the exact property we are
here for.

## Resolution

`Scope.track(value, name, **kwargs)`:

1. `value is None` → **silent skip**, return. (So optional members need no guard
   at the call site — this is the point.)
2. `hasattr(value, "__cairn_track__")` → build a child scope with the joined
   prefix and the **same** `step`/`context`, call `value.__cairn_track__(child)`,
   ignore its return value.
3. Otherwise → a leaf: `run.track(value, joined_name, step=..., context=...,
   **kwargs)` exactly as today.

`Run.track` applies the same three rules, with the run itself as the root scope.

## Name composition

Join with `.`, matching cairn's existing convention (`system.cpu.load_1m`):

```
run.track(model, "model")  →  model.encoding.rms
```

An empty segment is dropped, so `run.track(model, "")` yields un-prefixed leaf
names and `scope.track(x, "")` records at the parent's own name.

## `step` becomes required (breaking)

**Ruling:** `step` is always supplied explicitly, *except* inside a scope, where
it is baked in. `run.track(model, "model", step=it)` is the only place the
iteration is named; every `__cairn_track__` below it receives the right name and
the right step automatically.

Today `step` defaults to `None` and `_next_step` (`cairn/sdk/run.py:723`)
auto-increments a counter **per `(name, context)`** — one counter per sequence
name. That is coherent for a single sequence and incoherent across a tree.
Demonstrated, tracking `rms` every iteration and `encoding.rms` only on even
ones:

```
rms            steps=[0, 1, 2, 3, 4, 5]  values=[0, 1, 2, 3, 4, 5]
encoding.rms   steps=[0, 1, 2]           values=[0, 2, 4]
```

At "step 1", `rms` is iteration 1 while `encoding.rms` is iteration 2. Nothing
errors; the step numbers simply lie, and every downstream x-axis, comparison and
diff inherits that. The `scope.track(None, …)` silent-skip rule actively
*encourages* this shape, since an optional member that is `None` on some
iterations lands on a subset of them and drifts from its siblings.

So the default is not merely unhelpful for a tree — it produces wrong data that
looks right. It goes away:

- `Run.track(value, name, step, ...)` — `step` is **required**. It is already the
  third positional parameter, so call sites that pass it positionally are
  unaffected.
- Omitting it raises a `TypeError` naming the sequence and pointing at
  `run.scope(step=...)`, rather than inventing a number.
- **Blast radius (measured by AST over `cairn/`, `examples/`, `tests/`): 109
  call sites already pass `step`; 4 do not.** Three are tests. The fourth is the
  genuine exception below.

**The one legitimate stepless caller** is `SystemMetricsCollector`
(`cairn/sdk/run.py:284`, `track=lambda n, v: self.track(v, name=n)`). System
metrics are sampled on a timer, not per iteration: there is no step to supply and
a per-name counter is exactly right. It moves to an internal
`Run._track_sample(name, value)` that keeps `_next_step`, so the counter survives
for the one case it suits and leaves the public API.

## Rules

- **Inheritance.** A child scope inherits `step` and `context` from its parent.
  Set once at the root; leaves need nothing threaded — that is the whole point of
  the scope, and with `step` now required it is also the only way a tree gets one.
- **Cycles.** The walk carries a set of `id()`s of objects already visited *on
  the current path*; re-entering one is skipped rather than recursed. A component
  graph with a back-reference (child holding a parent) must not hang.
- **Depth.** A depth cap (proposed: 32) raises a clear error naming the path,
  rather than exhausting the Python stack.
- **Collisions.** Two children recorded under the same joined name are a
  programming error. Proposed: raise, naming both paths — silently letting the
  last win makes a typo invisible. **Open** (see below).
- **Pass-through.** `scope.track` forwards `**kwargs` to `run.track` unchanged,
  so per-leaf options keep working inside a component.

## Scope surface

```python
class Scope:
    def track(self, value: Any, name: str = "", **kwargs: Any) -> None: ...
    def scope(self, name: str) -> "Scope": ...   # child with a joined prefix
    @property
    def step(self) -> int | None: ...
    @property
    def run(self) -> Run: ...
```

`name` defaults to `""` so a root-level whole-tree call reads
`scope.track(model)`.

## Open questions

1. **Deprecation window.** The `step` break above is stated as an immediate
   `TypeError`. cairn is 0.1.0 and only 4 internal call sites omit `step`, so a
   hard break is defensible — but external users may rely on the auto-increment.
   The alternative is one release of `DeprecationWarning` + auto-increment before
   the raise.
2. **`final=True`.** The original sketch has `run.scope(step=it, final=True)`,
   but `final` has **no meaning in cairn today** — it is absent from the whole
   track path. It needs a definition before it ships (candidate: mark each
   sequence touched by this scope as complete, so a viewer can stop expecting
   more steps). Until then, leave it out rather than invent the semantics.
3. **Collision policy** — raise, or last-write-wins? Raising is safer but turns a
   typo into a crashed training run, which is a real cost mid-experiment.
4. **Should `Scope` be a context manager too?** `Run` already is. A `with` form
   would give a natural flush point (batching a step's writes into one commit).
   Not required by this design; worth revisiting if per-step write volume shows
   up in profiling.

## Downstream

Once this lands, the `research-project` skill drops its own `track.py` and
imports from cairn, which also removes its `sub` helper and its parameter-name
rule. The skill can be rewritten against these names ahead of implementation so
the two match on landing.
