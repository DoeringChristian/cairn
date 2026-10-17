# Backend regression suite

The suite targets the current, deliberately breaking architecture:

- Local writers/readers access the repository directly. Server discovery only finds explicitly started viewers.
- Remote writers keep durable journals and upload batches. Offline record tests explicitly select an unavailable HTTP endpoint; transport retry timing is tested separately in `test_uploader.py`.
- One server token grants access. Unauthenticated and incorrect-token requests fail; there are no read/write/admin roles, one-time login tokens, or scoped report-share grants.
- Reports execute in fresh kernels and publish immutable evidence and sources. Publication uses compare-and-swap, and retained publication history protects older builds.
- CLI coverage follows `init`, `runs`, `show`, explicit `ui`/`server`, reports, artifacts, viewers, and sync.

Removed tests exercised deliberately removed contracts: automatic local HTTP daemons, the 0.5 upgrade importer, scoped share links and role delegation, dual-port UI startup, and removed CLI commands (`list`, `ping`, `open`, `diff`, run exports/imports, sweep/agent administration, token administration). Domain and Python coverage for retained storage, archives, queries, sweep operations, artifact operations, viewers, and run history remains. Report source and publication tests exercise the current executable document workflow.

`test_backend_contract.py` reproduces the rejected-write acknowledgement, conflicting retry, partial-batch rollback, stale report publication, and historical retention bugs. `test_backend_boundaries.py` prevents the domain/storage layer from importing HTTP or SDK adapters.

The mutable report CRUD, report-image upload, and card-template endpoint suites
were retired with those endpoints. Reports now publish compiled QMD bundles;
`test_report_domain.py` covers immutable reads, history, and conditional deletion,
`test_report_workspaces.py` covers revisioned source edits, and
`test_server_report_builds.py` executes and copies real QMD reports. Comment tests
are retained for the revision-bound publication contract.

`CAIRN_TEST_DATABASE_URL=postgresql://... pytest tests/integration/test_postgres.py`
runs the shared ingestion, query, artifact and workspace contracts against a real
PostgreSQL server, in temporary schemas. `test_s3_blobs.py` exercises the actual
boto3 SDK against moto, including cache corruption and concurrent writes.
