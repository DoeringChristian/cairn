# Storage architecture and evolution

Cairn has one authoritative destination: a local repository, or a server. A local
SDK opens SQLite and files directly. A remote SDK writes a durable upload journal
and sends batches to the server; that journal is not a second queryable repository.
Starting the browser UI is explicit and does not change the SDK's storage path.

## Boundaries

`cairn/backend` owns domain operations, SQL transactions, revisions and blob
references. It does not import FastAPI, the server, or the SDK. The SDK's local
adapter and the HTTP routes call this domain code. The server owns authentication,
request validation and worker lifetime. `cairn/reports` owns document preparation,
execution and rendering; it publishes through the same backend.

SQLite with filesystem blobs is the default for both local use and a single
remote server. PostgreSQL and S3 are deployment options behind the same storage
contracts. Moving to a server does not require switching database engines.

| Stored concept | Contract |
|---|---|
| Runs and observations | Stable run IDs; append-only observations; optional user step; revisions for editable metadata |
| Artifact versions | Immutable identity, manifest and content; mutable aliases point to versions |
| Reports | Published report versions are artifacts; the report catalog selects the current publication |
| Report workspaces | Editable captured source files, guarded by an expected revision |
| Publication | A build captures one workspace revision and advances the report only if its expected current version still matches |
| Blobs | SHA-256-addressed bytes; validated before records referring to them are acknowledged |
| Delivery | Per-writer sequence numbers and receipts; an identical retry is safe, a conflicting retry fails |

Runs remain runs. Generic internal revision storage does not make every domain
object an artifact. Report drafts and published versions have distinct jobs:
saving changes the draft; publishing adds an immutable version. Switching between
Read and Edit saves the draft without publishing it.

## Stable data, changing code

Treat the current model as the persistence baseline. Refactoring modules, changing
card settings, adding report controls, or adjusting rendering must not require a
storage migration. Keep user measurements and extension metadata in the existing
validated JSON payloads. Add SQL fields when indexing, integrity or transaction
semantics require them, rather than mirroring every UI option in the schema.

These rules apply to future storage changes:

1. Database schema versions advance independently of package versions. Opening a
   current database does not rerun migrations or rewrite its history.
2. Every supported upgrade preserves IDs, immutable version contents, references,
   receipts and retained revisions. Derived indexes can be rebuilt.
3. Migrations are transactional, update the schema marker last and have rollback
   tests. SQLite takes an automatic database backup before upgrading. PostgreSQL
   backups are managed by the deployment operator.
4. Unsupported old or newer schemas are refused before migration. An unsupported
   legacy layout must not be silently emptied to make it look current.
5. SQLite and PostgreSQL exercise the same behavior contracts in CI, including
   upgrades. Sizes, positions and revision counters support 64-bit values on both.
6. Source and bundle paths are relative to their captured root. An original
   authoring path may be recorded as provenance, but cannot be required to reopen
   stored evidence after moving a repository.
7. Retained publications and snapshots keep their evidence reachable. Garbage
   collection follows references rather than inferring liveness from a current
   view alone.

Schema 11 widens PostgreSQL counters and byte sizes to 64-bit values, avoiding the
old 2 GiB limit for model artifacts. SQLite already has 64-bit integer storage.
Schemas 7–10 can upgrade automatically; older experimental schemas require an
explicit conversion outside this upgrade path. This does not promise that a
future schema change will never be necessary. It makes upgrades a tested software
operation rather than recurring manual export/import work.

## Moving a local repository to a server

A complete SQLite/files repository can move without changing its format:

1. Finish or stop all local writers and report workers. Close viewers and database
   connections. Keep the original folder as the rollback copy.
2. Copy the **whole repository directory** to a local disk on the server, including
   `cairn.db`, any SQLite sidecar files, `artifacts/`, and `runs/` journals. If an
   external blob directory was configured, copy that too and configure its new
   location.
3. Start `cairn server --repo /srv/cairn --host 0.0.0.0`. Startup replays pending
   local journals from the moved repository and preserves their run IDs.
4. Point clients at the server URL and give them its token. Their new writes go to
   that server. Keep the old copy closed so it does not become a divergent store.

The copied database preserves run IDs, artifact version IDs, report publication
history, drafts, snapshots and comments. Report source and captured evidence stay
available; the remote machine still needs the execution environment required to
run Python cells. A move does not transfer unuploaded remote-client buffers stored
elsewhere: flush those clients or retain and sync their buffers separately.

Changing `repo=` to a URL does not transfer existing data. The run ZIP export/import
API is a selection-sharing tool, not a complete backup or repository migration:
it omits report workspaces, publication history and revision records, and may merge
or remap identities. There is no complete SQLite-to-PostgreSQL/S3 conversion command
yet. Keep the same SQLite/files backend when moving to one server; choose the
larger deployment backend at creation time when it is already required.

## Backup and recovery

A database-only backup does not contain artifact bytes. A safe offline backup is
the complete quiescent repository, plus any external blob store. SQLite's backup
API produces a consistent online database snapshot, but a complete online backup
must also retain all referenced blobs while copying them. PostgreSQL and S3 need
coordinated database and object retention in the deployment's backup procedure.

Recovery tests cover a copied repository, pending journals, repeated delivery,
publication conflicts and failures during schema upgrades. They establish these
contracts; they are not a throughput benchmark or a guarantee against loss of the
underlying disk and all backups.
