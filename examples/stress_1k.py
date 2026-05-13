"""Spawn 1000 minimal runs in parallel to stress-test the UI.

Uses subprocess parallelism to avoid the global stdout-capture lock.
"""
from __future__ import annotations

import concurrent.futures
import subprocess
import sys
import textwrap


WORKER_SCRIPT = textwrap.dedent("""\
import math, random, cairn, sys
i = int(sys.argv[1])
r = random.Random(i)
lr = 10 ** r.uniform(-5, -2)
bs = r.choice([16, 32, 64, 128, 256])
optimizer = r.choice(["adam", "adamw", "sgd", "rmsprop"])
tags = r.sample(["baseline", "ablation", "sweep", "nightly", "debug", "prod", "v2", "finetune"], k=r.randint(0, 3))
run = cairn.Run(
    project="stress-test",
    name=f"run-{i:04d}",
    tags=tags,
    capture_source=False,
    capture_stdout=False,
    capture_env=False,
    capture_system_metrics=False,
)
run["lr"] = lr
run["batch_size"] = bs
run["optimizer"] = optimizer
run["seed"] = i
for step in range(10):
    loss = 2.0 * math.exp(-step / (3 + lr * 1000)) + r.gauss(0, 0.05)
    acc = min(0.99, 0.5 + step * 0.05 + r.gauss(0, 0.02))
    run.track(loss, name="loss", step=step)
    run.track(acc, name="accuracy", step=step)
run.finish()
""")


def spawn(i: int) -> None:
    subprocess.run(
        [sys.executable, "-c", WORKER_SCRIPT, str(i)],
        check=True,
        capture_output=True,
    )


def main() -> None:
    n = 1000
    print(f"Spawning {n} runs as subprocesses (max 64 parallel)...")
    with concurrent.futures.ProcessPoolExecutor(max_workers=64) as pool:
        futures = [pool.submit(spawn, i) for i in range(n)]
        done = 0
        for f in concurrent.futures.as_completed(futures):
            f.result()
            done += 1
            if done % 100 == 0:
                print(f"  {done}/{n}")
    print(f"Done — {n} runs created in project 'stress-test'.")


if __name__ == "__main__":
    main()
