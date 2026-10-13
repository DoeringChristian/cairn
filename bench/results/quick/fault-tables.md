Machine: `{"platform": "macOS-26.6.2-arm64-arm-64bit-Mach-O", "cpu": "Apple M5 Pro", "cpus": 18, "memory_gb": 64.0, "python": "3.13.13", "disk_free_gb": 960.2, "bench_root": "/private/tmp/claude-501/-Users-doeringc-workspace-cairn/a4b710e7-a868-4de6-aeef-f2b898ba3507/scratchpad/bench-f", "cairn_checkout": "/Users/doeringc/workspace/cairn", "cairn_python": "/Users/doeringc/workspace/cairn/.venv/bin/python", "cairn_commit": "335bdc7d", "cairn_branch": "dev/0.6", "cairn_dirty": false, "cairn_version": "0.5.0", "harness_commit": "335bdc7d", "time": "2026-10-13T10:57:20+0200"}`

### fault: client_kill9

| system | expected pts | lost | lost after ack'd | dup | corrupt | reordered | raised (calls) | loop blocked s | recovery s | final status |
|---|---|---|---|---|---|---|---|---|---|---|
| cairn-http | 4885 | 60 | 60 | 0 | 0 | 0 | 0 | – | – | running |
| mlflow | 4600 | 0 | 0 | 0 | 0 | 0 | 0 | – | – | RUNNING |

### fault: server_kill9

| system | expected pts | lost | lost after ack'd | dup | corrupt | reordered | raised (calls) | loop blocked s | recovery s | final status |
|---|---|---|---|---|---|---|---|---|---|---|
| cairn-http | 10000 | 0 | 0 | 0 | 0 | 0 | 0 | 9.0 | 4.6 | completed |
| mlflow | 10000 | 0 | 0 | 0 | 0 | 0 | 0 | 13.0 | 2.3 | FINISHED |

### fault: unreachable_30s

| system | expected pts | lost | lost after ack'd | dup | corrupt | reordered | raised (calls) | loop blocked s | recovery s | final status |
|---|---|---|---|---|---|---|---|---|---|---|
| cairn-http | 10000 | 0 | 0 | 0 | 0 | 0 | 0 | 0.5 | – | completed |
| mlflow | 10000 | 0 | 0 | 0 | 0 | 0 | 0 | 30.9 | 0.2 | FINISHED |

