"""WS-PLOT (Phase C) / G1 conformance: the hand-written pydantic mirror in
``cairn.sdk.card_spec`` (``PlotDescriptorSpec`` + the recursive ``PlotNode``
union + ``DataSpec`` variants) must match the canonical JSON Schema
``vendor/cairn-plot/schema/cairn-plot-spec.schema.json`` (shipped by the
standalone cairn-plot repo, consumed here as a git submodule; itself generated
from the authoritative TS ``PlotDescriptor`` in that repo's
``ui/src/plot-descriptor.ts``).

This is the Python half of the plot anti-drift chain: TS -> JSON Schema
(the submodule's ``check:plot-schema`` guards TS<->schema) -> pydantic (this
test guards schema<->Python). If any of the three drift, one of the two gates
fails.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from pydantic import ValidationError

from cairn.sdk import card_spec as cs

_SCHEMA_PATH = (
    Path(__file__).resolve().parents[2]
    / "vendor"
    / "cairn-plot"
    / "schema"
    / "cairn-plot-spec.schema.json"
)


@pytest.fixture(scope="module")
def schema() -> dict:
    return json.loads(_SCHEMA_PATH.read_text())


@pytest.fixture(scope="module")
def defs(schema) -> dict:
    return schema["definitions"]


def test_schema_file_exists_and_parses(schema):
    assert schema["$schema"].startswith("http://json-schema.org/draft-07")
    # G1: the root is now the recursive tree wrapper.
    assert schema["$ref"] == "#/definitions/PlotDescriptor"


# ---------------------------------------------------------------------------
# Root wrapper: PlotDescriptor{root, mode?, endpoint?} <-> PlotDescriptorSpec.
# ---------------------------------------------------------------------------


def test_plot_descriptor_properties_match_schema(defs):
    schema_props = set(defs["PlotDescriptor"].get("properties", {}).keys())
    model_props = set(cs.PlotDescriptorSpec.model_fields.keys())
    assert model_props == schema_props, "PlotDescriptorSpec: field name mismatch"


def test_plot_descriptor_required_matches_schema(defs):
    schema_required = set(defs["PlotDescriptor"].get("required", []))
    model_required = {
        name for name, f in cs.PlotDescriptorSpec.model_fields.items() if f.is_required()
    }
    assert model_required == schema_required, "PlotDescriptorSpec: required-set mismatch"


def test_plot_descriptor_extra_policy_is_forbid(defs):
    assert defs["PlotDescriptor"].get("additionalProperties") is False
    assert cs.PlotDescriptorSpec.model_config.get("extra") == "forbid"


def test_plot_descriptor_root_refs_plot_node(defs):
    # The recursive seam: PlotDescriptor.root -> PlotNode (an anyOf of the three
    # node defs).
    assert defs["PlotDescriptor"]["properties"]["root"]["$ref"] == "#/definitions/PlotNode"
    node_refs = {b["$ref"] for b in defs["PlotNode"]["anyOf"]}
    assert node_refs == {
        "#/definitions/PlotLeafNode",
        "#/definitions/GridNode",
        "#/definitions/CompareNode",
    }
    # And the recursion closes: GridNode.children.items -> PlotNode.
    assert (
        defs["GridNode"]["properties"]["children"]["items"]["$ref"]
        == "#/definitions/PlotNode"
    )


# ---------------------------------------------------------------------------
# Node defs: field-parity / required / additionalProperties per model.
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "model,def_name",
    [
        (cs.PlotLeafSpec, "PlotLeafNode"),
        (cs.GridSpec, "GridNode"),
        (cs.CompareSpec, "CompareNode"),
        (cs.SharedPropsSpec, "SharedProps"),
    ],
    ids=["plot", "grid", "compare", "shared"],
)
def test_node_model_matches_schema(model, def_name, defs):
    d = defs[def_name]
    schema_props = set(d.get("properties", {}).keys())
    model_props = set(model.model_fields.keys())
    assert model_props == schema_props, f"{def_name}: field name mismatch"
    schema_required = set(d.get("required", []))
    model_required = {n for n, f in model.model_fields.items() if f.is_required()}
    assert model_required == schema_required, f"{def_name}: required-set mismatch"
    assert d.get("additionalProperties") is False
    assert model.model_config.get("extra") == "forbid"


# ---------------------------------------------------------------------------
# DataSpec variants (anyOf branches), matched by their `kind` const.
# ---------------------------------------------------------------------------


def _dataspec_branches(defs) -> dict:
    out = {}
    for branch in defs["DataSpec"]["anyOf"]:
        kind = branch["properties"]["kind"]["const"]
        out[kind] = branch
    return out


@pytest.mark.parametrize(
    "model,kind",
    [
        (cs.InlineDataSpec, "inline"),
        (cs.ImageDataSpec, "image"),
        (cs.UrlDataSpec, "url"),
        (cs.NpzDataSpec, "npz"),
        (cs.ImgHdrDataSpec, "imghdr"),
    ],
    ids=["inline", "image", "url", "npz", "imghdr"],
)
def test_dataspec_variant_matches_schema(model, kind, defs):
    branch = _dataspec_branches(defs)[kind]
    schema_props = set(branch.get("properties", {}).keys())
    model_props = set(model.model_fields.keys())
    assert model_props == schema_props, f"{kind}: field mismatch"
    schema_required = set(branch.get("required", []))
    model_required = {n for n, f in model.model_fields.items() if f.is_required()}
    assert model_required == schema_required, f"{kind}: required-set mismatch"
    assert branch.get("additionalProperties") is False
    assert model.model_config.get("extra") == "forbid"


# ---------------------------------------------------------------------------
# Round-trips.
# ---------------------------------------------------------------------------


def test_leaf_descriptor_round_trips(defs):
    spec = cs.PlotDescriptorSpec(
        root=cs.PlotLeafSpec(
            kind="plot",
            renderer="scalar",
            props={"xAxis": "step", "yScale": "log"},
            data=cs.InlineDataSpec(
                kind="inline",
                props={"series": [{"key": "loss", "label": "loss", "color": "#0969da",
                                   "points": [{"x": 0, "y": 1.0}]}]},
            ),
        ),
    )
    dumped = spec.model_dump(exclude_none=True, mode="json")
    assert set(dumped).issubset(set(defs["PlotDescriptor"]["properties"]))
    assert dumped["mode"] == "local"
    assert dumped["root"]["kind"] == "plot"
    assert dumped["root"]["data"]["kind"] == "inline"
    assert cs.PlotDescriptorSpec.model_validate(dumped) == spec


def test_recursive_grid_round_trips():
    # grid -> [grid -> [image leaf, image leaf], url leaf]
    inner = cs.GridSpec(
        kind="grid",
        children=[
            cs.PlotLeafSpec(
                kind="plot",
                renderer="image",
                data=cs.ImageDataSpec(kind="image", hash="sha256:a"),
            ),
            cs.PlotLeafSpec(
                kind="plot",
                renderer="image",
                data=cs.ImageDataSpec(kind="image", hash="sha256:b",
                                      referenceHash="sha256:ref"),
            ),
        ],
        cols=2,
        colWidths=[0.6, 0.4],
    )
    url_leaf = cs.PlotLeafSpec(
        kind="plot",
        renderer="image",
        data=cs.UrlDataSpec(kind="url", src="https://x/y.png", referenceSrc=None),
    )
    spec = cs.PlotDescriptorSpec(
        root=cs.GridSpec(
            kind="grid",
            children=[inner, url_leaf],
            rowHeights=[1, 1],
            gap=8,
            shared=cs.SharedPropsSpec(colormap="viridis", colorbar=True),
        ),
    )
    dumped = spec.model_dump(exclude_none=True, mode="json")
    assert dumped["root"]["kind"] == "grid"
    assert dumped["root"]["children"][0]["kind"] == "grid"
    assert dumped["root"]["children"][0]["children"][0]["data"]["kind"] == "image"
    assert dumped["root"]["children"][1]["data"]["kind"] == "url"
    # model_dump(exclude_none) -> model_validate is stable.
    assert cs.PlotDescriptorSpec.model_validate(dumped) == spec


def test_shared_props_sync_and_reference_round_trip():
    # F3: SharedProps carries a `sync` sub-object (viewport/camera) and a
    # `reference` that is itself a full DataSpec — both must round-trip.
    spec = cs.PlotDescriptorSpec(
        root=cs.GridSpec(
            kind="grid",
            children=[
                cs.PlotLeafSpec(
                    kind="plot",
                    renderer="image",
                    data=cs.ImageDataSpec(kind="image", hash="sha256:a"),
                ),
            ],
            shared=cs.SharedPropsSpec(
                colormap="viridis",
                colorRange=(0.0, 1.0),
                colorbar=True,
                reference=cs.ImageDataSpec(kind="image", hash="sha256:ref"),
                sync=cs._SyncSpec(viewport=True, camera=False),
            ),
        ),
    )
    dumped = spec.model_dump(exclude_none=True, mode="json")
    sh = dumped["root"]["shared"]
    # The sync sub-object round-trips key-for-key.
    assert sh["sync"] == {"viewport": True, "camera": False}
    # `reference` is a nested DataSpec (discriminated on `kind`).
    assert sh["reference"] == {"kind": "image", "hash": "sha256:ref"}
    assert cs.PlotDescriptorSpec.model_validate(dumped) == spec


def test_shared_props_sync_matches_schema(defs):
    # The `sync` object's shape must mirror the schema's SharedProps.sync.
    shared_props = defs["SharedProps"]["properties"]
    assert "sync" in shared_props and "reference" in shared_props
    sync_ref = shared_props["sync"]
    # Resolve either an inline object or a $ref to the sync sub-definition.
    if "$ref" in sync_ref:
        sync_def_name = sync_ref["$ref"].split("/")[-1]
        sync_def = defs[sync_def_name]
    else:
        sync_def = sync_ref
    schema_sync_props = set(sync_def.get("properties", {}).keys())
    model_sync_props = set(cs._SyncSpec.model_fields.keys())
    assert model_sync_props == schema_sync_props, "SharedProps.sync field mismatch"


@pytest.mark.parametrize(
    "renderer,object_type",
    [
        # G3a wired `pointcloud`; G3b adds mesh/volume/boxes3d — all share the
        # one `npz` DataSpec, dispatched by `objectType`.
        ("pointcloud", "pointcloud"),
        ("mesh", "mesh"),
        ("volume", "volume"),
        ("boxes3d", "boxes3d"),
    ],
)
def test_npz_dataspec_round_trips(renderer, object_type):
    # The `npz` DataSpec (3D binary artifact for the three.js renderers).
    spec = cs.PlotDescriptorSpec(
        root=cs.PlotLeafSpec(
            kind="plot",
            renderer=renderer,
            props={"pointSize": 0.02},
            data=cs.NpzDataSpec(
                kind="npz",
                hash="sha256:abc",
                objectType=object_type,
                meta={
                    "n_points": 100,
                    "channels": "xyz",
                    "bounds": {"min": [0, 0, 0], "max": [1, 1, 1]},
                    "original_count": 100,
                },
            ),
        ),
    )
    dumped = spec.model_dump(exclude_none=True, mode="json")
    assert dumped["root"]["data"]["kind"] == "npz"
    assert dumped["root"]["data"]["objectType"] == object_type
    assert dumped["root"]["data"]["meta"]["n_points"] == 100
    assert cs.PlotDescriptorSpec.model_validate(dumped) == spec


def test_imghdr_dataspec_round_trips():
    # HDR-A: the `imghdr` DataSpec (true float-HDR image artifact).
    spec = cs.PlotDescriptorSpec(
        root=cs.PlotLeafSpec(
            kind="plot",
            renderer="imagehdr",
            props={"tonemap": "aces", "exposure": 0, "gamma": 1},
            data=cs.ImgHdrDataSpec(
                kind="imghdr",
                hash="sha256:hdr",
                meta={
                    "shape": [4, 4, 3],
                    "dtype": "<f4",
                    "channels": 3,
                    "vmin": 0.0,
                    "vmax": 8.0,
                },
            ),
        ),
    )
    dumped = spec.model_dump(exclude_none=True, mode="json")
    assert dumped["root"]["data"]["kind"] == "imghdr"
    assert dumped["root"]["data"]["meta"]["shape"] == [4, 4, 3]
    assert dumped["root"]["renderer"] == "imagehdr"
    assert cs.PlotDescriptorSpec.model_validate(dumped) == spec


def test_compare_node_round_trips():
    spec = cs.PlotDescriptorSpec(
        root=cs.CompareSpec(
            kind="compare",
            mode="diff",
            a=cs.ImageDataSpec(kind="image", hash="sha256:a"),
            b=cs.ImageDataSpec(kind="image", hash="sha256:b"),
            baselineIndex=0,
            diffSubmode="heatmap",
        ),
        mode="endpoint",
        endpoint="http://localhost:4301",
    )
    dumped = spec.model_dump(exclude_none=True, mode="json")
    assert dumped["root"]["kind"] == "compare"
    assert dumped["root"]["mode"] == "diff"
    assert cs.PlotDescriptorSpec.model_validate(dumped) == spec


# ---------------------------------------------------------------------------
# Leaf specs round-trip through the tree-root descriptor (the ONE form).
# ---------------------------------------------------------------------------


def test_tree_leaf_descriptor_round_trips():
    spec = cs.PlotDescriptorSpec(
        root=cs.PlotLeafSpec(
            kind="plot",
            renderer="scalar",
            props={"xAxis": "step"},
            data=cs.InlineDataSpec(kind="inline", props={"series": []}),
        ),
        mode="local",
    )
    dumped = spec.model_dump(exclude_none=True, mode="json")
    assert dumped["mode"] == "local"
    assert dumped["root"]["data"]["kind"] == "inline"
    assert cs.PlotDescriptorSpec.model_validate(dumped) == spec


def test_discriminator_rejects_unknown_kind():
    with pytest.raises(ValidationError):
        cs.PlotLeafSpec(kind="plot", renderer="scalar", data={"kind": "bogus", "props": {}})


def test_extra_field_rejected_on_descriptor():
    with pytest.raises(ValidationError):
        cs.PlotDescriptorSpec(
            root=cs.PlotLeafSpec(
                kind="plot",
                renderer="scalar",
                data=cs.InlineDataSpec(kind="inline", props={}),
            ),
            bogus=1,
        )
