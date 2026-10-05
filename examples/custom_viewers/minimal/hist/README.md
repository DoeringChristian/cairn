# Hist

A cairn custom viewer, made by `cairn viewer init`. It shows data logged as

```python
counts, _ = np.histogram(samples, bins=24)
run.track(cairn.Data({"values": counts.astype(np.float32)}, kind="demo/hist"), "hist", step)
```

Develop it live against a running `cairn ui` (every save reloads open cards):

```
cairn viewer dev hist --project <project>
```

Publish it, or let the training script publish it when it changed:

```
cairn viewer publish hist --project <project>
```

```python
run.use_viewer("hist")
```

Then pick it in a card's gear editor (type list) or let cards of the data use
it: a card shows the most specific viewer that accepts its data. Files:
`cairn-viewer.json` (manifest: what it accepts, its settings), `index.js`
(the code). Docs: guides/custom-viewers.md.
