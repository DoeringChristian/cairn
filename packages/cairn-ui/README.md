# cairn-ui

The browser viewer for [cairn-track](https://github.com/anthropics/cairn), shipped
as prebuilt assets.

```
pip install 'cairn-track[ui]'
```

You do not install this directly and there is nothing to import. It exists so that
`pip install cairn-track` — on a compute node that will only ever log metrics —
downloads no browser application. Tracking, the CLI and the HTTP API all work
without it; only `cairn ui` and `cairn server --ui` need it.

## What is in here

- `cairn_ui/_dist/` — the built bundle (three HTML entries plus hashed assets),
  **committed** so installing never needs Node.
- `src/`, `scripts/`, and the bundler config — the TypeScript sources it is built
  from.

`cairn_ui/__init__.py` exposes exactly one function, `dist_path()`. Everything
about *serving* the bundle — routes, shells, the CPU-renderer override — lives in
cairn-track's `cairn/viewer.py`, so this package holds no logic that could drift
from the server.

## Building

```
npm ci
npm run build          # -> cairn_ui/_dist
```

The build resolves cairn-plot's TypeScript from `vendor/cairn-plot`, so the git
submodule must be checked out. Commit the rebuilt `_dist` with your source change:
it is a released wheel's payload, and CI fails if it is stale.

## Developing against a different bundle

Point cairn-track at any build directory:

```
CAIRN_UI_DIST=/path/to/some/dist cairn ui
```

That override wins outright — if it names something unusable, no viewer is served
rather than silently falling back to the installed one.
