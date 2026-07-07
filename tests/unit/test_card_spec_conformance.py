"""WS-SCHEMA conformance: the hand-written pydantic mirror in
``cairn/sdk/card_spec.py`` must match the committed JSON Schema
``docs/schemas/cairn-card-spec.schema.json`` (which is itself generated from
the authoritative TS in ``cairn/ui/src/lib/cards/card-spec.ts``).

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

from cairn.sdk import card_spec as cs

_SCHEMA_PATH = (
    Path(__file__).resolve().parents[2] / "docs" / "schemas" / "cairn-card-spec.schema.json"
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
    (cs.StaticRunSelector, "StaticRunSelector"),
    (cs.QueryRunSelector, "QueryRunSelector"),
    (cs.RunsSpec, "RunsSpec"),
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


def test_query_run_selector_mode_matches_schema(defs):
    schema_modes = defs["QueryRunSelector"]["properties"]["mode"]["enum"]
    field = cs.QueryRunSelector.model_fields["mode"]
    assert list(_literal_values(field.annotation)) == schema_modes


def test_sample_spec_round_trips_and_is_schema_shaped(defs):
    spec = cs.CardsSpec(
        id="block_1",
        runs=cs.RunsSpec(
            selector=cs.QueryRunSelector(
                kind="query", mode="newest-per-name", namePattern="ablate-*", n=5
            )
        ),
        title="Ablation study",
        cards=[
            cs.CardSpec(
                id="card_1",
                type="scalar",
                series=[cs.SeriesRef(runId="run_a", name="val/loss", context_hash="")],
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
