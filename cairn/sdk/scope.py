"""`cairn.Scope` — a run with a name prefix, a step and a context bound to it.

A component knows best what is worth recording about itself, so it implements
``__cairn_track__(self, scope)`` and calls ``scope.track(value, name)``. The
caller never re-lists another object's internals:

.. code-block:: python

    class Model:
        def __cairn_track__(self, scope):
            scope.track(self.rms(), "rms")
            scope.track(self.encoding, "encoding")   # recurses
            scope.track(self.render(), "pred")

    class Dataset:
        def __cairn_track__(self, scope):
            scope.config(n_samples=len(self))        # a property, not a metric

    run.track(model, "model", step=it)               # walks the whole tree

A ``Scope`` is precisely :meth:`Run.track` with ``step``/``context`` pre-bound
plus a name prefix — nothing more. ``Run`` itself is the root scope, which is why
``run.track`` can walk a component with no extra API; :meth:`Run.scope` exists for
the case recursion cannot reach, namely handing a bound logger to a plain
function that is not a component.

Why a dunder rather than a plain ``track`` method: a plain name would force cairn
to guess whether a given ``track`` means *this* protocol, which is the signature
sniffing this design exists to delete. ``__cairn_track__`` cannot collide, so the
test is one ``hasattr``. Same shape as ``__array__``, ``__rich__`` and cairn's own
``_repr_html_``.

Full design: docs/superpowers/specs/2026-09-14-scope-track-protocol-design.md
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:  # pragma: no cover - typing only
    from .run import Run

#: How deep a component tree may nest before the walk refuses to continue. The
#: cycle guard below catches a graph that points BACK at an object already on the
#: path, but not one that mints a fresh object per level; this bound turns that
#: into a clear error instead of a blown Python stack.
MAX_DEPTH = 32


def join_names(prefix: str, name: str) -> str:
    """Join two name segments with ``.``, dropping empty ones.

    ``.`` matches cairn's existing convention for hierarchical sequence names
    (``system.cpu.load_1m``). An empty segment is dropped rather than producing a
    leading/doubled dot, so ``run.track(model, "")`` yields un-prefixed leaf names
    and ``scope.track(x, "")`` records at the parent's own name.
    """
    if not prefix:
        return name
    if not name:
        return prefix
    return f"{prefix}.{name}"


class Scope:
    """A bound logging position: run + name prefix + step + context.

    Never constructed directly — obtain one from :meth:`Run.scope`, or receive one
    in ``__cairn_track__``.
    """

    __slots__ = ("_run", "_prefix", "_step", "_context", "_seen", "_depth")

    def __init__(
        self,
        run: "Run",
        prefix: str = "",
        *,
        step: int,
        context: Any | None = None,
        seen: frozenset[int] = frozenset(),
        depth: int = 0,
    ) -> None:
        self._run = run
        self._prefix = prefix
        self._step = step
        self._context = context
        self._seen = seen
        self._depth = depth

    # -- accessors ---------------------------------------------------------

    @property
    def run(self) -> "Run":
        """The run this scope writes to."""
        return self._run

    @property
    def step(self) -> int:
        """The bound step. Always set — a scope cannot exist without one."""
        return self._step

    @property
    def context(self) -> Any | None:
        """The bound context, inherited by every child."""
        return self._context

    @property
    def name(self) -> str:
        """This scope's name prefix (``""`` at the root)."""
        return self._prefix

    # -- the one operation -------------------------------------------------

    def scope(self, name: str) -> "Scope":
        """A child scope one level deeper, with ``name`` joined onto the prefix.

        Step and context are inherited: set once at the root, and every leaf
        beneath it lands on the same iteration.
        """
        return Scope(
            self._run,
            join_names(self._prefix, name),
            step=self._step,
            context=self._context,
            seen=self._seen,
            depth=self._depth,
        )

    def track(self, value: Any, name: str = "", **kwargs: Any) -> None:
        """Record ``value`` under ``name``, walking it if it is a component.

        ``None`` is a silent skip, so an optional member needs no guard at the
        call site. Because the step is bound, skipping does NOT slide the
        surviving points onto the wrong iterations.
        """
        if value is None:
            return

        full = join_names(self._prefix, name)

        tracker = getattr(value, "__cairn_track__", None)
        if tracker is not None:
            ident = id(value)
            # A back-reference (a child holding its parent) would otherwise
            # recurse forever. Only objects on the CURRENT path are skipped, so
            # the same component appearing twice in different branches is still
            # recorded in both.
            if ident in self._seen:
                return
            if self._depth >= MAX_DEPTH:
                raise RecursionError(
                    f"cairn: component tree deeper than {MAX_DEPTH} at "
                    f"{full!r}; __cairn_track__ is most likely recursing into a "
                    "freshly built object each level."
                )
            child = Scope(
                self._run,
                full,
                step=self._step,
                context=self._context,
                seen=self._seen | {ident},
                depth=self._depth + 1,
            )
            tracker(child)
            return

        self._run._track_leaf(
            value, full, step=self._step, context=self._context, **kwargs
        )

    def config(self, *args: Any, **kwargs: Any) -> None:
        """Record INPUTS of this component, under the scope's name.

            class Dataset:
                def __cairn_track__(self, scope):
                    scope.config(n_samples=len(self), augment=self.augment)

        With the scope named ``data`` that is ``data.n_samples`` /
        ``data.augment`` on the run, beside every other component's.

        This exists because a property is not a metric. Routed through
        :meth:`track` it would become a one-point sequence, get a step it never
        had, and render as a plot of a single dot — which is how a dataset ends
        up looking like a training curve.
        """
        self._run.config(self._prefixed("scope.config", args, kwargs))

    def summary(self, *args: Any, **kwargs: Any) -> None:
        """Record RESULTS of this component, under the scope's name.

        The counterpart to :meth:`config`, with :meth:`Run.summary`'s meaning:
        a number the component is claiming, not a series it is emitting.
        """
        self._run.summary(self._prefixed("scope.summary", args, kwargs))

    def _prefixed(self, who: str, args: tuple, kwargs: dict) -> dict[str, Any]:
        """Merge the mapping and put this scope's name in front of every key.

        Nested values are left alone — the server flattens them onto the
        prefixed key, so ``scope.config(opt={"lr": 1e-3})`` under ``model``
        lands as ``model.opt.lr``.
        """
        merged = self._run._merge_mapping(who, args, kwargs)
        return {join_names(self._prefix, k): v for k, v in merged.items()}

    def __repr__(self) -> str:  # pragma: no cover - debugging aid
        return f"Scope(name={self._prefix!r}, step={self._step!r})"
