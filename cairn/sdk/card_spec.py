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

from typing import Annotated, Any, Literal, Optional, Union

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
    "UrlDataSpec",
    "NpzDataSpec",
    "ImgHdrDataSpec",
    "DataSpec",
    "PlotSpec",
    "PlotLeafSpec",
    "GridSpec",
    "CompareSpec",
    "SharedPropsSpec",
    "PlotNode",
    "PlotDescriptorSpec",
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


class UrlDataSpec(_Strict):
    """`DataSpec{kind:"url"}` — a raw URL passed through verbatim (the 3rd
    data-provenance mode beside inline/image). ``src`` is the foreground image
    URL, ``referenceSrc`` an optional baseline, ``metadata`` optional overlay
    JSON. No `DataSource` hash lookup — the URL is used as-is."""

    kind: Literal["url"]
    src: str
    referenceSrc: Optional[str] = None
    metadata: Optional[str] = None


class NpzDataSpec(_Strict):
    """`DataSpec{kind:"npz"}` — a content-addressed 3D binary artifact
    (``.npy``/``.npz``) for the three.js renderers (G3). ``objectType`` selects
    the 3D type (``pointcloud`` wired in G3a; ``mesh``/``volume``/``boxes3d`` in
    G3b). ``hash`` keys the LOCAL store / ENDPOINT artifact (required-but-
    nullable, matching the TS `string | null`); ``meta`` is the Python-baked
    artifact metadata (channels/bounds/n_points/…) carried inline so the
    renderer needs a single bytes fetch, not a second metadata round trip."""

    kind: Literal["npz"]
    hash: Optional[str]
    objectType: str
    meta: dict[str, Any]


class ImgHdrDataSpec(_Strict):
    """`DataSpec{kind:"imghdr"}` — a true float-HDR image artifact (HDR-A).

    The bytes are a float ``.npy`` (float32/float64) with shape ``[H,W]``
    (grayscale) or ``[H,W,C]`` (``C∈{1,3,4}``), tone-mapped client-side by the
    ``"imagehdr"`` renderer — NOT min-max-normalized to 8-bit at ingest like the
    ``image`` path. ``hash`` keys the LOCAL store / ENDPOINT artifact (required-
    but-nullable, matching the TS `string | null`); ``meta`` is informational
    provenance (``{shape,dtype,channels,vmin,vmax}``) carried inline for tooling
    parity with ``npz`` (the renderer reads shape from the npy header itself)."""

    kind: Literal["imghdr"]
    hash: Optional[str]
    meta: dict[str, Any]


# Discriminated on ``kind`` (mirrors the TS `DataSpec` discriminated union).
DataSpec = Annotated[
    Union[InlineDataSpec, ImageDataSpec, UrlDataSpec, NpzDataSpec, ImgHdrDataSpec],
    Field(discriminator="kind"),
]


class PlotSpec(_Strict):
    """One (flat) plot descriptor = `{renderer, props?, data, mode?, endpoint?}`.

    The pre-G1 flat form, kept as a leaf-builder for the lowercase
    (``cp.scalar``/``cp.image``/…) path. The recursive tree descriptor is
    ``PlotDescriptorSpec`` below. ``mode`` defaults to ``"local"`` (the
    self-contained baked-store mode); ``props`` defaults to ``{}``."""

    renderer: str
    props: dict[str, Any] = Field(default_factory=dict)
    data: DataSpec
    mode: Literal["local", "endpoint"] = "local"
    endpoint: Optional[str] = None


# ---------------------------------------------------------------------------
# G1: the recursive TREE descriptor. A `PlotNode` is a leaf (`plot`), a `grid`
# (children in CSS grid), or a `compare` (two frames composited). Mirrors the TS
# `PlotNode`/`PlotDescriptor` in ``cairn/ui/src/plot-descriptor.ts`` (from which
# ``docs/schemas/cairn-plot-spec.schema.json`` is generated). Discriminated on
# ``kind``; `GridSpec.children` is a forward ref resolved by `model_rebuild()`.
# ---------------------------------------------------------------------------


class PlotLeafSpec(_Strict):
    """`PlotNode{kind:"plot"}` — one renderer + its data (the former flat body)."""

    kind: Literal["plot"]
    renderer: str
    props: Optional[dict[str, Any]] = None
    data: DataSpec


class SharedPropsSpec(_Strict):
    """`SharedProps` — properties shared across a grid's cells."""

    colormap: Optional[str] = None
    colorRange: Optional[tuple[float, float]] = None
    colorbar: Optional[bool] = None
    reference: Optional[DataSpec] = None
    sync: Optional["_SyncSpec"] = None


class _SyncSpec(_Strict):
    viewport: Optional[bool] = None
    camera: Optional[bool] = None


class GridSpec(_Strict):
    """`PlotNode{kind:"grid"}` — children laid out in a CSS grid. ``colWidths``/
    ``rowHeights`` entries: number → ``Nfr``, string → verbatim CSS."""

    kind: Literal["grid"]
    children: list["PlotNode"]
    cols: Optional[int] = None
    colWidths: Optional[list[Union[float, str]]] = None
    rowHeights: Optional[list[Union[float, str]]] = None
    gap: Optional[Union[float, str]] = None
    shared: Optional[SharedPropsSpec] = None


class CompareSpec(_Strict):
    """`PlotNode{kind:"compare"}` — two DataSpec frames composited into one pane."""

    kind: Literal["compare"]
    mode: Literal["split", "blend", "diff"]
    a: DataSpec
    b: DataSpec
    baselineIndex: Optional[Literal[0, 1]] = None
    diffSubmode: Optional[str] = None
    props: Optional[dict[str, Any]] = None


# Discriminated on ``kind`` (mirrors the TS `PlotNode` discriminated union).
PlotNode = Annotated[
    Union[PlotLeafSpec, GridSpec, CompareSpec],
    Field(discriminator="kind"),
]


class PlotDescriptorSpec(_Strict):
    """The recursive tree descriptor = `{root, mode?, endpoint?}`
    (== TS ``PlotDescriptor``). ``mode``/``endpoint`` bind the whole tree to one
    `DataSource`; ``mode`` defaults to ``"local"``."""

    root: PlotNode
    mode: Literal["local", "endpoint"] = "local"
    endpoint: Optional[str] = None


# Resolve the `GridSpec.children -> PlotNode` / `SharedPropsSpec.sync` forward
# refs now that every referenced model is defined.
GridSpec.model_rebuild()
SharedPropsSpec.model_rebuild()


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
