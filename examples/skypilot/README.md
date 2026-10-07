# cairn on SkyPilot

Logging [SkyPilot](https://docs.skypilot.co) tasks to cairn: one node, several
nodes in one run, and a managed spot job whose recoveries continue the same run.

| File | What it shows |
|---|---|
| `train.py` | The script every task runs: `cairn.Run(..., label="auto")`, the run id from `CAIRN_RUN_ID`, and resuming the run after a spot recovery |
| `task.yaml` | One node, one run |
| `task_multinode.yaml` | `num_nodes: 2`, one `CAIRN_RUN_ID` for the task: node 0 creates the run, node 1 joins it |
| `task_spot.yaml` | A managed job on spot instances: a stable `CAIRN_RUN_ID`, checkpoints in a bucket, every recovery continues the run |

## Log over HTTP

Cloud VMs share no POSIX filesystem with each other or with your machine, so a
local repo (`CAIRN_REPO=/some/dir/.cairn`) does not work here: every node would
write its own repo. The tasks log over HTTP to a `cairn server` instead:

```bash
cairn server --ui                 # ingest on :4300, UI on :4301; prints a token
```

- **The server must be reachable from the VMs.** Run it on a cloud VM with a
  public address (or in the same VPC), and open port 4300 to the cluster; or
  run it on your machine and forward the port to each node with an SSH
  tunnel (`ssh -R 4300:localhost:4300 <node>`, then
  `CAIRN_REPO=cairn://localhost:4300` on the node). For access over the
  internet, put it behind a TLS proxy and use `CAIRN_REPO=https://...`; see
  [Server, auth and deployment](../../docs/guides/server.md).
- **Set `CAIRN_REPO` and `CAIRN_TOKEN`.** Replace `<your-server>` in the YAMLs.
  The token is the one the server printed (or `cairn token create --name
  skypilot`); the YAMLs take it as a SkyPilot secret, so it is not shown in
  logs: `export CAIRN_TOKEN=...` and launch with `--secret CAIRN_TOKEN`.
- **Connection loss is fine.** The SDK appends every write to a local log first
  and replays it when the server answers again; training never waits.

**Object-store bucket mounts (`file_mounts` with `mode: MOUNT`, gcsfuse,
s3fs, ...) are not suitable for run logs.** A local repo appends to its run
logs line by line, syncs them and coordinates through a lease file; an object
store rewrites a whole object for every change, and its FUSE mounts make
appends slow or unsupported and give no atomic file creation, so neither
works reliably there. Use buckets for checkpoints and datasets (as
`task_spot.yaml` does), and HTTP for the run.

## Launch

From this folder (each YAML syncs it to the VMs with `workdir: .`):

```bash
cd examples/skypilot
export CAIRN_TOKEN=<token>

# one node
sky launch -c cairn-train task.yaml --secret CAIRN_TOKEN

# two nodes, one run
sky launch -c cairn-multi task_multinode.yaml --secret CAIRN_TOKEN \
  --env CAIRN_RUN_ID=$(python -c "import cairn; print(cairn.new_run_id())")

# managed spot job
sky jobs launch -n cairn-spot task_spot.yaml --secret CAIRN_TOKEN \
  --env CAIRN_RUN_ID=$(python -c "import cairn; print(cairn.new_run_id())")
```

## How ranks map to the run

SkyPilot sets `SKYPILOT_NODE_RANK` on every node; `label="auto"` reads it.
Node 0 becomes the primary labelled `rank0`: it creates the run and alone sets
its status. Node N is the worker `rankN`: everything it logs lands in the run,
its system metrics are `system.rankN.*`, and its console lines carry its
label. Node 0 logs the run-wide `train.loss`; every node logs its own
`rankN.samples_per_sec`. All nodes need the same run id, so
`task_multinode.yaml` requires `CAIRN_RUN_ID` at launch.

If you run `torchrun` on each node instead of one process per node, `RANK`
(set by torchrun) is read before `SKYPILOT_NODE_RANK`, so every process of
every node gets its own label (`rank0` ... `rankN`).

## Spot recovery

A managed job relaunches the `run:` section on a new VM after a preemption,
with the same environment. With a fixed `CAIRN_RUN_ID`:

- **First start:** `cairn.Run(..., label="auto")` creates the run with that id.
- **Recovery:** creating it again raises `ValueError` (the id is taken), so
  `train.py` continues it with `cairn.Run(..., resume=run_id,
  rewind_to=step)`, where `step` is the step of the last checkpoint (`-1`
  without one, which drops everything). The run is `running` again, and the
  steps the preempted attempt logged after its checkpoint are dropped before
  training repeats them, so every chart has each step once.

The preempted attempt never finished its run; until the recovery resumes it,
the server marks it `killed` after two minutes without a heartbeat. That is
expected, and the resume sets it `running` again. Checkpoints go to
`/checkpoints/$CAIRN_RUN_ID`, in the bucket that `task_spot.yaml` mounts
there.
