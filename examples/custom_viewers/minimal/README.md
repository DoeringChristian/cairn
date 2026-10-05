# Minimal custom viewer

The smallest complete custom viewer: `hist/` draws a logged 1-D array as bars
on a 2D canvas, with one setting on the gear's **Display** tab (bar colour)
and one on its **Values** tab (normalize). It uses only `cairn:sdk` — no
three.js, nothing vendored. `cairn viewer init hist --kind demo/hist` writes
exactly this folder.

```
cd examples/custom_viewers/minimal
cairn init /tmp/cairn-viewers                     # any scratch repo
export CAIRN_REPO=/tmp/cairn-viewers/.cairn
python log_hist.py                                # 2 runs, publishes ./hist
cairn ui --repo $CAIRN_REPO                       # project "viewers-minimal"
```

Open a run of project `viewers-minimal`: the `hist` card is drawn by the viewer.
Edit `hist/index.js` live while `cairn ui` runs (it finds the `cairn ui`
serving `$CAIRN_REPO`; every save reloads the open cards):

```
cairn viewer dev hist --project viewers-minimal
```
