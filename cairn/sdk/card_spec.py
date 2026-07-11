"""WS-SCHEMA: pydantic mirror of the card-spec single source of truth.

The authoritative definition lives in TypeScript
(``cairn/ui/src/lib/cards/card-spec.ts``); ``npm run gen:card-schema``
derives ``docs/schemas/cairn-card-spec.schema.json`` from it. THIS module is
a hand-written pydantic v2 mirror of that JSON Schema, kept honest by
``tests/unit/test_card_spec_conformance.py`` (asserts the models match the
committed schema field-for-field, so the Python side can never silently
drift from TS).

Not wired into any runtime path yet — that is WS-PYAPI, where
``cairn.card(...)`` / ``cairn.Report`` builders will return these models and
``.model_dump()`` will yield the exact `````cairn`` YAML/JSON the TS
``parseCairnSpec`` consumes. Python only ever *emits* validated specs; it
never parses markdown and never re-implements ``cardFromSpec``.
"""

from __future__ import annotations

from typing import Any, Literal, Optional, Union

from pydantic import BaseModel, ConfigDict, Field

__all__ = [
    "CARD_TYPES",
    "CardType",
    "SeriesRef",
    "CardSettingsSpec",
    "CardSpec",
    "StaticRunSelector",
    "QueryRunSelector",
    "RunSelector",
    "RunsSpec",
    "CardsSpec",
    "ReportSpec",
    "InlineDataSpec",
    "ImageDataSpec",
    "DataSpec",
    "PlotSpec",
]

# The canonical card-type vocabulary. Mirrors `CARD_TYPES` in
# cairn/ui/src/lib/cards/card-spec.ts — the conformance test asserts this
# tuple equals the committed schema's CardType enum (same members, same
# order), so a card type added on the TS side without updating this fails CI.
CARD_TYPES: tuple[str, ...] = (
    # Per-metric "series" cards.
    "scalar",
    "image",
    "figure",
    "audio",
    "video",
    "histogram",
    "tensor",
    "text",
    "pointcloud",
    "mesh",
    "boxes3d",
    "volume",
    # Workspace-level "multi-run" cards.
    "parallel",
    "scatter",
    "bar",
    "tile",
    # Renderer-only types (CardRenderer.tsx's object_type switch).
    "table",
    "html",
    "markdown",
    "artifact",
    "plugin",
)

CardType = Literal[
    "scalar",
    "image",
    "figure",
    "audio",
    "video",
    "histogram",
    "tensor",
    "text",
    "pointcloud",
    "mesh",
    "boxes3d",
    "volume",
    "parallel",
    "scatter",
    "bar",
    "tile",
    "table",
    "html",
    "markdown",
    "artifact",
    "plugin",
]


class _Strict(BaseModel):
    """Base for objects the schema marks ``additionalProperties: false``."""

    model_config = ConfigDict(extra="forbid")


class SeriesRef(_Strict):
    """= ``ComparisonSeriesRef`` — one (run, metric) binding for a card."""

    runId: str
    name: str
    context_hash: str


class CardSettingsSpec(BaseModel):
    """Permissive per-card settings side-channel (a few well-known keys +
    arbitrary JSON), matching ``additionalProperties`` in the schema."""

    model_config = ConfigDict(extra="allow")

    version: Optional[int] = None
    yScale: Optional[Literal["linear", "log"]] = None
    smoothing: Optional[float] = None
    step: Optional[float] = None


class CardSpec(_Strict):
    """One card entry — id/type/series (= ``ComparisonCard``) + optional
    inline ``settings``."""

    id: str
    type: CardType
    series: list[SeriesRef]
    settings: Optional[CardSettingsSpec] = None


# ---------------------------------------------------------------------------
# WS-PLOT (Phase C): the plot descriptor — the renderer-props-shaped contract
# the standalone cairn-plot bundle mounts. Mirrors the authoritative TS
# `PlotDescriptor`/`DataSpec` in ``cairn/ui/src/plot-descriptor.ts`` (from which
# ``docs/schemas/cairn-plot-spec.schema.json`` is generated); kept honest by
# ``tests/unit/test_plot_spec_conformance.py`` field-for-field against that
# committed schema. Construction == validation, like ``CardSpec``.
# ---------------------------------------------------------------------------


class InlineDataSpec(_Strict):
    """`DataSpec{kind:"inline"}` — the renderer's DATA props carried directly
    as plain JSON (2D contracts: Series[]/points[]/matrix/table/figure)."""

    kind: Literal["inline"]
    props: dict[str, Any]


class ImageDataSpec(_Strict):
    """`DataSpec{kind:"image"}` — a content-addressed image artifact (+
    optional baseline + overlay metadata), resolved through the active
    `DataSource` (LOCAL `data:` URL / ENDPOINT `/api/artifacts/…`).

    ``hash`` is required-but-nullable (matches the TS `string | null`);
    ``referenceHash``/``metadata`` are optional."""

    kind: Literal["image"]
    hash: Optional[str]
    referenceHash: Optional[str] = None
    metadata: Optional[str] = None


# Discriminated on ``kind`` (mirrors the TS `DataSpec` discriminated union).
DataSpec = Union[InlineDataSpec, ImageDataSpec]


class PlotSpec(_Strict):
    """One plot descriptor = `{renderer, props?, data, mode?, endpoint?}`
    (== TS ``PlotDescriptor``). ``mode`` defaults to ``"local"`` (the
    self-contained baked-store mode); ``props`` defaults to ``{}``."""

    renderer: str
    props: dict[str, Any] = Field(default_factory=dict)
    data: DataSpec = Field(discriminator="kind")
    mode: Literal["local", "endpoint"] = "local"
    endpoint: Optional[str] = None


class StaticRunSelector(_Strict):
    kind: Literal["static"]
    runIds: list[str]


class QueryRunSelector(_Strict):
    kind: Literal["query"]
    mode: Literal["latest-n", "newest-per-name"]
    namePattern: Optional[str] = None
    tags: Optional[list[str]] = None
    n: Optional[float] = None


RunSelector = Union[StaticRunSelector, QueryRunSelector]


class RunsSpec(_Strict):
    ids: Optional[list[str]] = None
    selector: Optional[RunSelector] = None


class CardsSpec(_Strict):
    """The `````cairn`` dialect root — a runs binding + a list of cards."""

    id: Optional[str] = None
    runs: Optional[RunsSpec] = None
    title: Optional[str] = None
    cards: Optional[list[CardSpec]] = None


class ReportSpec(_Strict):
    """The ``cairn.Report.publish()`` payload — canonical markdown ``source``
    plus create-route metadata (mirrors ``ReportCreate`` server-side)."""

    name: str
    source: str
    project: Optional[str] = None
