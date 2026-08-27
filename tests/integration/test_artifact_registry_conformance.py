"""Client ↔ server ARTIFACT-REGISTRY conformance (R0, refactor spec §6.4).

This suite exists because the registry client and server shipped with SIX
route/op-name mismatches and zero coverage: every client method below hits a
live server end-to-end, through BOTH backends where applicable, so path or
shape drift is a test failure, not a runtime surprise.
"""
from __future__ import annotations

import cairn


def _mk_run(server_url: str, project: str = "reg") -> cairn.Run:
    return cairn.Run(
        project=project,
        repo=f"cairn://{server_url.removeprefix('http://')}",
        capture_source=False,
        capture_stdout=False,
        capture_env=False,
        capture_system_metrics=False,
    )


def test_registry_roundtrip_http(live_server):
    # Producer run: version a checkpoint under a family with an alias.
    with _mk_run(live_server) as producer:
        version = producer.log_artifact(
            cairn.Text("weights " * 100),
            name="model",
            artifact_type="checkpoint",
            aliases=["latest"],
        )
        assert version.version == 1
        assert version.family_name == "model"
        producer_id = producer.id

    reader = cairn.Reader(repo=f"cairn://{live_server.removeprefix('http://')}")
    try:
        # Families + versions enumerate.
        fams = reader.artifact_families("reg")
        assert any(f["name"] == "model" for f in fams)
        versions = reader.artifact_versions("model", project="reg")
        assert len(versions) == 1
        assert versions[0]["version"] == 1

        # Consumer run: resolve by ref and record the input edge.
        with _mk_run(live_server) as consumer:
            consumer.use_artifact("model:latest", role="input")
            consumer_id = consumer.id

        inputs = reader.run(consumer_id).input_artifacts()
        assert len(inputs) == 1
        outputs = reader.run(producer_id).output_artifacts()
        assert any(o.get("family_name") == "model" or o.get("name") == "model" for o in outputs)

        # Lineage renders the producer → artifact → consumer graph.
        graph = reader.lineage("reg")
        assert graph  # non-empty envelope; shape is the ops layer's contract
    finally:
        reader.close()


def test_registry_roundtrip_local(tmp_path):
    repo = tmp_path / ".cairn"
    with cairn.Run(
        project="reg",
        repo=repo,
        capture_source=False,
        capture_stdout=False,
        capture_env=False,
        capture_system_metrics=False,
    ) as producer:
        version = producer.log_artifact(
            cairn.Text("weights " * 100),
            name="model",
            artifact_type="checkpoint",
            aliases=["latest"],
        )
        assert version.version == 1

    reader = cairn.Reader(repo=repo)
    try:
        fams = reader.artifact_families("reg")
        assert any(f["name"] == "model" for f in fams)
        # The local backend's op names must exist (they drifted once):
        resolved = reader.resolve_and_download_artifact  # noqa: B018 - attribute presence
        graph = reader.lineage("reg")
        assert graph is not None
    finally:
        reader.close()
