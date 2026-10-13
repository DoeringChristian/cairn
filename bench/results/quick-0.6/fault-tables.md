Machine: `{"platform": "macOS-26.6.2-arm64-arm-64bit-Mach-O", "cpu": "Apple M5 Pro", "cpus": 18, "memory_gb": 64.0, "python": "3.13.13", "disk_free_gb": 959.5, "bench_root": "/private/tmp/claude-501/-Users-doeringc-workspace-cairn/a4b710e7-a868-4de6-aeef-f2b898ba3507/scratchpad/bench06", "cairn_checkout": "/Users/doeringc/workspace/cairn", "cairn_python": "/Users/doeringc/workspace/cairn/.venv/bin/python", "cairn_commit": "5e4fb6be", "cairn_branch": "dev/0.6", "cairn_dirty": false, "cairn_version": "0.5.0", "harness_commit": "5e4fb6be", "time": "2026-10-13T11:32:13+0200"}`

### fault: server_kill9

| system | expected pts | lost (no sync) | lost after ack'd (no sync) | lost (after `cairn sync`) | lost after ack'd (after sync) | dup | corrupt | reordered | raised (calls) | loop blocked s | recovery s | final status |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| cairn-http | 10000 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0.5 | 2.7 | completed |
| cairn-local | 10000 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0.6 | 0.6 | completed |

### fault: unreachable_30s

| system | expected pts | lost (no sync) | lost after ack'd (no sync) | lost (after `cairn sync`) | lost after ack'd (after sync) | dup | corrupt | reordered | raised (calls) | loop blocked s | recovery s | final status |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| cairn-http | 10000 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0.6 | 0.6 | completed |
| cairn-local | n/a: no network between the run and its repo |  |  |  |  |  |  |  |  |  |  |  |

### fault: partition_30s

| system | expected pts | lost (no sync) | lost after ack'd (no sync) | lost (after `cairn sync`) | lost after ack'd (after sync) | dup | corrupt | reordered | raised (calls) | loop blocked s | recovery s | final status |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| cairn-http | 10000 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0.6 | 2.2 | completed |
| cairn-local | n/a: no network between the run and its repo |  |  |  |  |  |  |  |  |  |  |  |
| mlflow | 10000 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 34.8 | 0.1 | FINISHED |

### fault: slow_server

| system | expected pts | lost (no sync) | lost after ack'd (no sync) | lost (after `cairn sync`) | lost after ack'd (after sync) | dup | corrupt | reordered | raised (calls) | loop blocked s | recovery s | final status |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| cairn-http | 10000 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0.7 | – | completed |
| cairn-local | n/a: no network between the run and its repo |  |  |  |  |  |  |  |  |  |  |  |
| mlflow | 135 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 20.6 | – | FINISHED |

### fault: client_kill9

| system | expected pts | lost (no sync) | lost after ack'd (no sync) | lost (after `cairn sync`) | lost after ack'd (after sync) | dup | corrupt | reordered | raised (calls) | loop blocked s | recovery s | final status |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| cairn-http | 4890 | 30 | 30 | 30 | 30 | 0 | 0 | 0 | 0 | – | – | running |
| cairn-local | 4890 | 30 | 30 | 30 | 30 | 0 | 0 | 0 | 0 | – | – | running |

### fault: disk_full

| system | expected pts | lost (no sync) | lost after ack'd (no sync) | lost (after `cairn sync`) | lost after ack'd (after sync) | dup | corrupt | reordered | raised (calls) | loop blocked s | recovery s | final status |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| cairn-http | 10000 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0.9 | 8.9 | completed |
| cairn-local | 10000 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0.6 | 8.7 | completed |
| mlflow | 10000 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 31.8 | 0.0 | FINISHED |

### fault: torn_writes

| system | truncated file | trials | server failed to start | unreadable | quick_check failed | trials with loss | points lost | corrupted | duplicated |
|---|---|---|---|---|---|---|---|---|---|
| cairn-http | run_log | 8 | 0 | 0 | 0 | 8 | 52305 | 0 | 0 |
| cairn-http | run_log_untruncated_control | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| cairn-http | database | 8 | 8 | 0 | 8 | 0 | 0 | 0 | 0 |
| mlflow | database | 8 | 8 | 0 | 8 | 0 | 0 | 0 | 0 |

### fault: concurrent

| system | case | expected | lost | dup | corrupt | reordered | raised | max blocked s | error |
|---|---|---|---|---|---|---|---|---|---|
| cairn-http | 8 clients / 8 runs | 80000 | 0 | 0 | 0 | 0 | 0 | 0.89 |  |
| cairn-http | 2 processes / 1 run: a | 10000 | 0 | 0 | 0 | 0 | 0 |  |  |
| cairn-http | 2 processes / 1 run: b | 10000 | 0 | 0 | 0 | 0 | 0 |  |  |
| cairn-local | 8 clients / 8 runs | 80000 | 0 | 0 | 0 | 0 | 0 | 0.86 |  |
| cairn-local | 2 processes / 1 run: a | 10000 | 0 | 0 | 0 | 0 | 0 |  |  |
| cairn-local | 2 processes / 1 run: b | 10000 | 0 | 0 | 0 | 0 | 0 |  |  |
| mlflow | 8 clients / 8 runs | 80000 | 0 | 0 | 0 | 0 | 0 | 20.32 |  |
| mlflow | 2 processes / 1 run: a | 10000 | 0 | 0 | 0 | 0 | 0 |  |  |
| mlflow | 2 processes / 1 run: b | 10000 | 0 | 0 | 0 | 0 | 0 |  |  |

