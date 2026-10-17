# A report with experiment evidence

From this directory, with `cairn-track[reports]` installed:

```bash
python train.py
cairn report publish descent --project descent
cairn ui
```

Open the `descent` project. Its default page lists the published report.
`train.py` replaces the report's input placeholder with the finished run's full ID.

For a static preview without the tracker UI, run `cairn serve`.
For remote tracking, set `CAIRN_REPO=https://your-server` and `CAIRN_TOKEN` before
running the same commands. The server is the sole repo; local files are the upload
buffer and report build products.
