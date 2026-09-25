# Examples

The `examples/` directory of the [cairn repository](https://github.com/DoeringChristian/cairn/tree/main/examples)
holds runnable scripts. Most of them log synthetic data, so they run in seconds
on any machine and need no GPU or dataset.

## Running an example

Most examples log to whatever repo is configured. Give each one a scratch repo:

```bash
cairn init /tmp/cairn-demo
CAIRN_REPO=/tmp/cairn-demo/.cairn python examples/demo_training.py
cairn ui --repo /tmp/cairn-demo/.cairn
```

In a development checkout, prefix each command with `uv run`. The
[distributed examples](#distributed-and-parallel-training) create their own
temporary repo instead and print its path; open it with
`cairn ui --repo <printed path>`.

Some examples need extras or third-party packages. The **Needs** column lists
them:

- `[media]`: `pip install 'cairn-track[media]'` (matplotlib, plotly, …)
- `[plot]`: `pip install 'cairn-track[plot]'` (`cairn.plot`)
- `[ui]`: `pip install 'cairn-track[ui]'` (the viewer; `cairn ui` always needs it)

## Metrics and the runs table

| Script | What it logs | Needs | What to look at |
|---|---|---|---|
| `demo_training.py` | One run, `full-demo` in project `demo`: nested config, `train.*`/`val.*` losses and accuracy, `grad_norm`, sample images, a matplotlib figure, a histogram, audio, a tensor, text, stdout, three run artifacts (`final_weights`, `summary_plot`, `run_config`) and a note. Sleeps 0.1 s per step, so you can watch it live. | `[media]` | Every tab of the run page: overview, metrics and media, logs, source, environment |
| `demo_metric_rules.py` | Three runs using `summary="min"/"max"` rules and `x="epoch"`, including a component that logs itself through `__cairn_track__`, plus a `best_epoch` summary key | — | The runs table's metric columns; the **From** column of a run's metrics; the comparison table's best-value colouring; `val.*` charts plotted against `epoch`. See [Final values and metric rules](guides/metric-rules.md). |
| `demo_summary_cards.py` | Four runs with different hyperparameters that converge to different `final.accuracy` and `final.loss`, plus `grad_norm` | — | Compare the four runs; add bar-chart and scalar-tile cards on `final.accuracy` |
| `rd_curve.py` | One run per codec and quality level (project `rd-curve`), with `codec`/`quality` as config and `bpp`, `psnr_db`, `bpp.positions`, `bpp.normals` as summary values. No series. | — | A scatter-plot card of `bpp` against `psnr_db`, coloured by `codec` |
| `demo_run_selector.py` | One short run named `training-run` in project `run-selector-demo`, with a fresh random config each time. Run it several times. Override project, name and tag with `CAIRN_RUN_SELECTOR_PROJECT`, `CAIRN_RUN_SELECTOR_NAME`, `CAIRN_RUN_SELECTOR_TAG`. | — | A report or comparison whose runs are chosen by a query (newest per name, latest N): each new invocation shows up |
| `stress_1k.py` | 1000 small runs in project `stress-test` (random config, tags, `loss` and `accuracy`), started as up to 64 parallel subprocesses | — | How the runs table, filters and grouping behave with many runs |

## Media and rich types

| Script | What it logs | Needs | What to look at |
|---|---|---|---|
| `demo_image_gallery.py` | Two runs. Per step: `samples`, a gallery of 8 captioned images, and `pairs.sample<i>`, input and prediction pairs; plus `val.mse` with a `min` rule | — | The gallery card with its step slider; both runs compared side by side |
| `demo_image_overlays.py` | Two runs. `detections` images with bounding boxes (two classes, with scores) and a segmentation mask, a plain `reference` image, and a `plain` sequence without overlays | — | The overlay settings of the `detections` card: toggles, score threshold, mask opacity, per-class visibility |
| `demo_image_comparison.py` | A `baseline` run and nine variant runs with controlled distortions (brightness, gaussian noise, blur, a pixel shift, colour tints). Each logs `output`, `output_linear` (a float EXR image), `reference`, and `quality.mae` / `quality.psnr`. | — | Compare the runs' `output` images, and each run's `output` against its `reference` |
| `demo_table.py` | Two runs. `predictions`: a 1000-row table with int, string, float and bool columns, per step. `summary`: a small table at the last step. Plus `accuracy`. | — | The table card: sorting, filtering, paging, CSV download, the step slider |
| `demo_histogram_tensor.py` | Two runs. Histograms (`weights/layer1`, `activations`) that change over steps; 1-D, 2-D and 3-D tensors (`grad_norms`, `attention`, `attention_heads`); `loss` | — | The histogram card over steps; the tensor card's heatmap and slice selectors |
| `demo_html_markdown.py` | Two runs. A `cairn.Html` report per step (`reports.summary`) whose height changes, `cairn.Markdown` notes (`notes.training`), and one HTML page with a script that tries to escape its sandbox (`reports.sandbox_probe`) | — | The HTML and Markdown cards. The sandbox probe must report that it was blocked. |
| `demo_plot_helpers.py` | Two runs of a fake 3-class classifier. Per step: accuracy and losses, and Plotly figures from `cairn.plot`: `eval.confusion_matrix` (raw and normalized), `eval.roc_curve`, `eval.pr_curve`, `eval.per_class_accuracy`; at the end `eval.loss_curves` | `[plot]`, `[media]` | The figure cards, stepped and compared across runs |
| `demo_pointcloud.py` | Three runs of rotating point clouds: RGB (`sphere_rgb`), per-point categories (`torus_category`), plain xyz (`helix_height`), a named per-point property (`grid_scan`); one cloud of over 300,000 points (`big_scan`) | — | The point-cloud card's colour modes and property selector |
| `demo_mesh.py` | Three runs of meshes: a deforming sphere with two per-vertex properties (`blob_sphere`), a torus with vertex colours and normals (`rainbow_torus`), a cube with explicit normals (`faceted_cube`), and a sphere with half its faces flipped (`mixed_winding_sphere`, which must still render solid) | — | The mesh card: property colouring, vertex colours, shading |
| `demo_boxes3d.py` | Two runs of box hierarchies: an adaptive `cairn.Octree`, a `cairn.BVH` with per-node values, and a fixed `cairn.Boxes3D` grid with per-box values | — | The boxes card: depth range filter, colour by depth or value |
| `demo_volume.py` | Two runs of `cairn.Volume` grids: an animated gaussian blob, and a static shell with anisotropic `spacing` | — | The volume card. Volumes are not rendered in the browser: the card shows the shape and value range, with the step's `.npz` to download. |

## Artifacts

| Script | What it logs | Needs | What to look at |
|---|---|---|---|
| `artifact_registry.py` | A pipeline in project `artifact-demo`, run twice (v0 and v1): data-prep runs log a `training-data` artifact, training runs use it and log a `linear-model` (v1 with the aliases `latest` and `best`), and an evaluation run uses both and logs an `eval-report`. Uses `log_artifact` and `use_artifact`. | — | The project's **Artifacts** and **Lineage** pages. See [Artifacts and lineage](guides/artifacts.md). |

## Reports and notebooks

| Script | What it does | Needs | How to run |
|---|---|---|---|
| `report_query_url.py` | Builds a standalone HTML report (`cairn.plot.Report`) whose images are [live query URLs](guides/reading.md#live-query-urls): the latest run's `train/render`, the latest run tagged `best`'s `eval/render`, and the second-newest run's `train/render`. It prints the URLs. | `[plot]` | `python examples/report_query_url.py --server cairn://localhost:4300 --project demo -o report.html`. The URLs resolve only when fetched from that server. |
| `marimo_cairn_demo.py` | A [marimo](https://marimo.io) notebook: `cairn.Reader` queries, `cairn.plot` figures, `run[tag]` handles, `cairn.ui` comparison cards and a `cairn.plot.Report`. Falls back to synthetic data when there are no runs. | `[examples]`, `[media]`, `[plot]`, `[ui]` | Populate a repo with `demo_plot_helpers.py` (and optionally `demo_image_comparison.py`), then `marimo edit examples/marimo_cairn_demo.py`. Running it with `python` executes every cell as a test. |

## Distributed and parallel training

These examples show how to use cairn from a job launcher. Each creates a
temporary repo, starts several training runs that all log to it (a `loss`
series and an `hparams` config each), then reads the runs back with
`cairn.Reader` and prints their final loss. None of them uses
[cairn sweeps](guides/sweeps.md): the launcher chooses the parameters.

| Script | Launcher | Needs | Notes |
|---|---|---|---|
| `multi_process.py` | `concurrent.futures.ProcessPoolExecutor`, 4 workers | — | One run per process |
| `multiprocessing_pool.py` | `multiprocessing.Pool.starmap`, 4 workers | — | One run per process |
| `multi_thread.py` | `threading.Thread`, 3 threads | — | A process can hold only one active run, so the threads run one after another |
| `submitit_sweep.py` | submitit, with `cluster="local"` | `pip install submitit` | Change to `cluster="slurm"` and a shared repo path on a cluster |
| `ray_tune.py` | Ray Tune `grid_search` over learning rates | `pip install "ray[tune]"` | — |
| `dask_sweep.py` | Dask `LocalCluster`; `--ssh host1 host2 …` for an `SSHCluster` | `pip install "dask[distributed]"` | SSH mode needs the repo on a filesystem shared by all hosts |
| `fabric_remote.py` | Fabric over SSH; simulated locally by default, `--hosts gpu1 gpu2 …` for real hosts | `pip install fabric` | Real hosts need a shared filesystem, or a `cairn://` server |
| `kubernetes_jobs.py` | Prints a worker `train.py` and a `jobs.yaml` with one Kubernetes Job per configuration, then simulates the jobs locally | — | The generated jobs read the repo from `CAIRN_REPO` on a shared volume |

Across machines, point every job at one repo: a shared directory (with
`cairn.Run(..., local_wal=True)`, so concurrent writers never contend for the
database) or a `cairn://host:4300` server. See [Server, auth and
deployment](guides/server.md#where-runs-are-written).

## Internals

| Script | What it does |
|---|---|
| `test_wal.py` | An end-to-end check of WAL mode: three simulated runs write WAL files concurrently, the files are ingested into the database, the data is read back and verified, and ingesting an active WAL incrementally is tested. It uses a temporary repo. |
