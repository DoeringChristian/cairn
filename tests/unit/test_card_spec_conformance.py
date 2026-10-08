"""Card-spec schema conformance: the hand-written pydantic mirror in
``vendor/cairn-ui/cairn_ui/cards/spec.py`` must match the committed JSON Schema
``vendor/cairn-ui/docs/schemas/cairn-card-spec.schema.json`` (which is itself generated from
the authoritative TS in ``vendor/cairn-ui/src/lib/cards/card-spec.ts``).

This is the Python half of the anti-drift chain: TS -> JSON Schema
(``npm run check:card-schema`` guards TS<->schema) -> pydantic (this test
guards schema<->Python). If any of the three drift, one of the two gates
fails.

Asserts field-for-field: the card-type vocabulary, and each model's property
names / required set / extra-field policy against the corresponding schema
definition. Also round-trips a sample spec through the models to prove they
*emit* schema-shaped dicts.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from pydantic import ValidationError

from cairn_ui.cards import spec as cs

# Resolved through the installed (editable) cairn_ui package, so the test
# follows whichever cairn-ui checkout the environment points at.
_SCHEMA_PATH = (
    Path(cs.__file__).resolve().parents[2]
    / "docs" / "schemas" / "cairn-card-spec.schema.json"
)


@pytest.fixture(scope="module")
def schema() -> dict:
    return json.loads(_SCHEMA_PATH.read_text())


@pytest.fixture(scope="module")
def defs(schema) -> dict:
    return schema["definitions"]


def _literal_values(literal_type) -> tuple:
    # typing.Literal[...] -> its args, as a tuple in declaration order.
    return literal_type.__args__


def test_schema_file_exists_and_parses(schema):
    assert schema["$schema"].startswith("http://json-schema.org/draft-07")
    assert schema["$ref"] == "#/definitions/CardSpecSchema"


def test_card_type_vocabulary_matches_schema(defs):
    schema_enum = defs["CardType"]["enum"]
    # Same members AND same order — CARD_TYPES is the ordered canonical list.
    assert list(cs.CARD_TYPES) == schema_enum
    assert list(_literal_values(cs.CardType)) == schema_enum


# (pydantic model, schema-definition name) pairs whose object shapes must line
# up. SeriesRef aliases ComparisonSeriesRef in the schema.
_MODEL_DEFS = [
    (cs.CardSpec, "CardSpec"),
    (cs.SeriesRef, "ComparisonSeriesRef"),
    (cs.CardSettingsSpec, "CardSettingsSpec"),
    (cs.FilterChipSpec, "FilterChipSpec"),
    (cs.FilterExprSpec, "FilterExprSpec"),
    (cs.FilterGroupSpec, "FilterGroupSpec"),
    (cs.SortKeySpec, "SortKeySpec"),
    (cs.RunSetSpec, "RunSetSpec"),
    (cs.RunViewSpec, "RunViewSpec"),
    (cs.CardsSpec, "CardsSpec"),
    (cs.ReportSpec, "ReportSpec"),
]


@pytest.mark.parametrize("model,def_name", _MODEL_DEFS, ids=[d for _, d in _MODEL_DEFS])
def test_model_properties_match_schema(model, def_name, defs):
    schema_def = defs[def_name]
    schema_props = set(schema_def.get("properties", {}).keys())
    model_props = set(model.model_fields.keys())
    assert model_props == schema_props, f"{def_name}: field name mismatch"


@pytest.mark.parametrize("model,def_name", _MODEL_DEFS, ids=[d for _, d in _MODEL_DEFS])
def test_model_required_matches_schema(model, def_name, defs):
    schema_required = set(defs[def_name].get("required", []))
    model_required = {
        name for name, f in model.model_fields.items() if f.is_required()
    }
    assert model_required == schema_required, f"{def_name}: required-set mismatch"


@pytest.mark.parametrize("model,def_name", _MODEL_DEFS, ids=[d for _, d in _MODEL_DEFS])
def test_model_extra_policy_matches_schema(model, def_name, defs):
    # Schema `additionalProperties: false` <-> pydantic extra="forbid".
    # CardSettingsSpec's additionalProperties is an object (permissive) <->
    # extra="allow".
    addl = defs[def_name].get("additionalProperties", True)
    extra = model.model_config.get("extra")
    if addl is False:
        assert extra == "forbid", f"{def_name}: expected extra='forbid'"
    else:
        assert extra == "allow", f"{def_name}: expected extra='allow'"


def test_filter_operators_match_schema(defs):
    assert list(_literal_values(cs.FilterOperator)) == defs["FilterOperator"]["enum"]


def test_group_by_variants_match_schema(defs):
    variants = defs["GroupBySpec"]["anyOf"]
    models = [cs.GroupBySourceSpec, cs.GroupByParamSpec, cs.GroupByExprSpec]
    assert [set(v["properties"]) for v in variants] == [set(m.model_fields) for m in models]
    assert list(_literal_values(cs.GroupBySourceSpec.model_fields["source"].annotation)) == (
        variants[0]["properties"]["source"]["enum"]
    )


def test_x_is_an_expression_string(defs):
    prop = defs["CardSettingsSpec"]["properties"]["x"]
    assert prop["type"] == "string"
    settings = cs.CardSettingsSpec(x="step * 32")
    assert settings.model_dump(exclude_none=True) == {"x": "step * 32"}


def test_sample_spec_round_trips_and_is_schema_shaped(defs):
    spec = cs.CardsSpec(
        id="block_1",
        runSets=[cs.RunSetSpec(
            name="Ablations",
            filter=cs.FilterGroupSpec(kind="group", op="and", children=[
                cs.FilterChipSpec(kind="chip", field="display_name", op="startswith", arg="ablate-"),
                cs.FilterGroupSpec(kind="group", op="or", children=[
                    cs.FilterExprSpec(kind="expr", expr="min(val.loss) < 0.5"),
                ]),
            ]),
            groupBy=[cs.GroupBySourceSpec(source="group"), cs.GroupByParamSpec(source="param", key="lr")],
            latestOnly=True,
            sort=[cs.SortKeySpec(column="created_at", direction="desc")],
            eyes={"r:run_a": False},
        )],
        view=cs.RunViewSpec(pinned=["run_a"]),
        title="Ablation study",
        cards=[
            cs.CardSpec(
                id="card_1",
                type="scalar",
                series=[cs.SeriesRef(runId="run_a", name="val.loss")],
                settings=cs.CardSettingsSpec(version=1, yScale="log", smoothing=0.6),
            )
        ],
    )
    dumped = spec.model_dump(exclude_none=True)
    # Only keys the schema knows about appear.
    assert set(dumped).issubset(set(defs["CardsSpec"]["properties"]))
    card = dumped["cards"][0]
    assert set(card).issubset(set(defs["CardSpec"]["properties"]))
    assert card["type"] == "scalar"
    # Re-validate the emitted dict to prove it's model-round-trip stable.
    assert cs.CardsSpec.model_validate(dumped) == spec


def test_invalid_card_type_rejected():
    with pytest.raises(ValidationError):
        cs.CardSpec(id="c", type="not-a-real-type", series=[])


def test_extra_field_rejected_on_strict_model():
    with pytest.raises(ValidationError):
        cs.CardSpec(id="c", type="scalar", series=[], bogus=1)


@pytest.mark.parametrize("card_type", ["run-compare", "code-diff"])
def test_multi_run_comparison_cards_are_card_types(card_type, defs):
    assert card_type in defs["CardType"]["enum"]
    assert card_type in cs.CARD_TYPES
    # A multi-run card spans the block's runs: no series, settings pass through.
    card = cs.CardSpec(
        id="c",
        type=card_type,
        series=[],
        settings=cs.CardSettingsSpec(version=1, onlyDiffs=True, layout="split"),
    )
    dumped = card.model_dump(exclude_none=True)
    assert dumped["type"] == card_type
    assert cs.CardSpec.model_validate(dumped) == card
