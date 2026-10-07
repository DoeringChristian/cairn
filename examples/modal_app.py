"""Cairn + Modal: training functions in Modal containers, logged over HTTP.

A Modal app whose ``train`` function runs in a container image with
cairn-track installed from git. Each call is one cairn run; the local
entrypoint starts one call per learning rate in parallel with ``.map``.

Modal containers share no filesystem with your machine, so the runs go over
HTTP to a ``cairn server``: the Modal Secret ``cairn`` holds ``CAIRN_REPO``
(the server's ingest URL) and ``CAIRN_TOKEN``, and ``cairn.Run`` reads both
from the environment. The server must be reachable from Modal's cloud: a VM
with a public address, or behind a TLS proxy
(``CAIRN_REPO=https://cairn.example.com``); see docs/guides/server.md.
Writes the server does not take at once are kept in a log inside the
container and retried until the function returns.

Requirements::

    pip install modal
    modal setup

Usage::

    cairn server --ui                       # on a machine Modal can reach
    modal secret create cairn CAIRN_REPO=cairn://<your-server>:4300 CAIRN_TOKEN=<token>
    modal run examples/modal_app.py

Several processes in one run (a multi-container job): give every process the
same ``CAIRN_RUN_ID`` and a label: ``label="auto"`` under torchrun (which sets
``RANK``, as in ``torchrun_ddp.py``), else ``label=f"rank{rank}"`` with
``primary=(rank == 0)``.
"""

from __future__ import annotations

import modal

image = (
    modal.Image.debian_slim(python_version="3.12")
    .apt_install("git")
    .pip_install("cairn-track @ git+https://github.com/DoeringChristian/cairn")
)
app = modal.App("cairn-example", image=image)


@app.function(secrets=[modal.Secret.from_name("cairn")], timeout=600)
def train(lr: float, steps: int = 200) -> str:
    """One training run, logged to the server in CAIRN_REPO; returns its id."""
    import math

    import cairn

    with cairn.Run("modal", name=f"lr={lr:g}", total_steps=steps) as run:
        run.config(lr=lr, steps=steps)
        for step in range(steps):
            run.track(math.exp(-lr * step) + 0.01, "train.loss", step=step)
        print(f"lr={lr:g}: done")
        return run.id


@app.local_entrypoint()
def main() -> None:
    for run_id in train.map([0.1, 0.03, 0.01]):
        print(f"logged run {run_id}")
