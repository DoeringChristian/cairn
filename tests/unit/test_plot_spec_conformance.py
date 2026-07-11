"""WS-PLOT (Phase C) conformance: the hand-written pydantic mirror
``cairn.sdk.card_spec.PlotSpec`` (+ its ``DataSpec`` variants) must match the
committed JSON Schema ``docs/schemas/cairn-plot-spec.schema.json`` (itself
generated from the authoritative TS ``PlotDescriptor`` in
``cairn/ui/src/plot-descriptor.ts``).

This is the Python half of the plot anti-drift chain: TS -> JSON Schema
(``npm run check:plot-schema`` guards TS<->schema) -> pydantic (this test
guards schema<->Python). If any of the three drift, one of the two gates
fails.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from pydantic import ValidationError

from cairn.sdk import card_spec as cs

_SCHEMA_PATH = (
    Path(__file__).resolve().parents[2] / "docs" / "schemas" / "cairn-plot-spec.schema.json"
)


@pytest.fixture(scope="module")
def schema() -> dict:
    return json.loads(_SCHEMA_PATH.read_text())


@pytest.fixture(scope="module")
def defs(schema) -> dict:
    return schema["definitions"]


def test_schema_file_exists_and_parses(schema):
    assert schema["$schema"].startswith("http://json-schema.org/draft-07")
    assert schema["$ref"] == "#/definitions/PlotDescriptor"


def test_plot_descriptor_properties_match_schema(defs):
    schema_props = set(defs["PlotDescriptor"].get("properties", {}).keys())
    model_props = set(cs.PlotSpec.model_fields.keys())
    assert model_props == schema_props, "PlotSpec: field name mismatch vs PlotDescriptor"


def test_plot_descriptor_required_matches_schema(defs):
    schema_required = set(defs["PlotDescriptor"].get("required", []))
    model_required = {
        name for name, f in cs.PlotSpec.model_fields.items() if f.is_required()
    }
    assert model_required == schema_required, "PlotSpec: required-set mismatch"


def test_plot_descriptor_extra_policy_is_forbid(defs):
    # PlotDescriptor is additionalProperties:false <-> extra="forbid".
    assert defs["PlotDescriptor"].get("additionalProperties") is False
    assert cs.PlotSpec.model_config.get("extra") == "forbid"


# The two DataSpec variants (anyOf branches), matched by their `kind` const.
def _dataspec_branches(defs) -> dict:
    out = {}
    for branch in defs["DataSpec"]["anyOf"]:
        kind = branch["properties"]["kind"]["const"]
        out[kind] = branch
    return out


@pytest.mark.parametrize(
    "model,kind",
    [(cs.InlineDataSpec, "inline"), (cs.ImageDataSpec, "image")],
    ids=["inline", "image"],
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


def test_inline_sample_round_trips_and_is_schema_shaped(defs):
    spec = cs.PlotSpec(
        renderer="scalar",
        props={"xAxis": "step", "yScale": "log"},
        data=cs.InlineDataSpec(
            kind="inline",
            props={"series": [{"key": "loss", "label": "loss", "color": "#0969da",
                               "points": [{"x": 0, "y": 1.0}]}]},
        ),
    )
    dumped = spec.model_dump(exclude_none=True, mode="json")
    assert set(dumped).issubset(set(defs["PlotDescriptor"]["properties"]))
    assert dumped["mode"] == "local"
    assert dumped["data"]["kind"] == "inline"
    # Re-validate the emitted dict to prove it's model-round-trip stable.
    assert cs.PlotSpec.model_validate(dumped) == spec


def test_image_sample_round_trips(defs):
    spec = cs.PlotSpec(
        renderer="image",
        data=cs.ImageDataSpec(kind="image", hash="sha256:abc", metadata=None),
        mode="endpoint",
        endpoint="http://localhost:4301",
    )
    dumped = spec.model_dump(exclude_none=True, mode="json")
    assert dumped["data"]["kind"] == "image"
    assert dumped["data"]["hash"] == "sha256:abc"
    assert cs.PlotSpec.model_validate(dumped) == spec


def test_discriminator_rejects_unknown_kind():
    with pytest.raises(ValidationError):
        cs.PlotSpec(renderer="scalar", data={"kind": "bogus", "props": {}})


def test_extra_field_rejected_on_plot_spec():
    with pytest.raises(ValidationError):
        cs.PlotSpec(
            renderer="scalar",
            data=cs.InlineDataSpec(kind="inline", props={}),
            bogus=1,
        )
