# Storage and delivery

A destination is a local repo or an HTTP server. Local operations use SQLite and files
in-process. Remote operations send records and blobs to the server; their local buffer
is not a tracking database.

Local journals: `<repo>/runs/<id>/`. Remote buffers: `$CAIRN_DIR/runs/<id>/`, defaulting
to `./.cairn/runs/<id>/`. Both use checksummed, segmented records and per-log sequence
numbers. Local fsync commits apply through the same batch dispatcher used by the HTTP
server. A Reader or explicitly started server replays unapplied local records after
a process crash, including after the complete repository is moved to a new path.

The remote uploader batches records, sends referenced blobs first, and records the
server's sequence acknowledgment after its transaction commits. It retries outages
and duplicate deliveries safely. `cairn sync [PATHS]` explicitly retries buffered
records; `--clean` removes only finished, fully acknowledged journals.

Back up a local repo's entire folder, including journals and content-addressed files.
Use SQLite's backup API for a consistent online database copy. A plain file copy of an
active SQLite database alone is not a consistent backup. A server's repo must be on a
local disk; jobs on network filesystems should log to its HTTP endpoint.

For a local-to-remote move, copy the complete stopped repository and serve it on
the new machine. [Storage architecture and migration](storage-architecture.md)
describes the procedure and its distinction from a partial run archive.
