# Direction

The revived cairn-track centers research reports while retaining the experiment
tracker's run, metric, media, query, and artifact APIs.

Implemented architecture: one selected destination; direct SQLite/files locally;
durable batched HTTP delivery remotely; one server token; executable Markdown reports
with captured evidence and immutable publication; Prism2 theme tokens.

Further work should build on those boundaries. Avoid introducing local replicas,
automatic tracking servers, multiple credential classes, or an independent report
artifact store. Server-side report execution, object storage, and report editing in
the browser are separate future features rather than implied current capabilities.
