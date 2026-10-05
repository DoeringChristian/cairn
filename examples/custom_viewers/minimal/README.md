# Minimal custom viewer

The smallest complete custom viewer: `hist/` draws a logged 1-D array as bars
on a 2D canvas, with one setting on the gear's **Display** tab (bar colour)
and one on its **Data** tab (normalize). It uses only `cairn:sdk` — no
three.js, nothing vendored. `cairn viewer init hist --kind demo/hist` writes
exactly this folder.

```
cd examples/custom_viewers/minimal
export CAIRN_REPO=/tmp/cairn-viewers/.cairn       # any scratch repo
cairn init /tmp/cairn-viewers
python log_hist.py                                # 2 runs, publishes ./hist
cairn ui                                          # project "custom-viewers"
```

Open a run of project `custom-viewers`: the `hist` card is drawn by the viewer.
Edit `hist/index.js` live while `cairn ui` runs:

```
cairn viewer dev hist --project custom-viewers
```
