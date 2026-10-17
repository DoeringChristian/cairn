"""Reproducible end-to-end Cairn showcase; no external datasets or services needed."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import wave

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import plotly.graph_objects as go
from PIL import Image

import cairn

SOURCE = Path(__file__).resolve().parent
PROJECT = "cairn-showcase"
CAPTURE = dict(capture_stdout=False, capture_source=False, capture_env=False,
               capture_system_metrics=False)


def sweep_trial(config, run):
    loss = float((config["lr"] - 0.12) ** 2 + 0.01)
    run.log({"loss": loss})
    return loss


def media(run, assets):
    """Every built-in media family, with tiny deterministic examples."""
    grid = np.linspace(-1, 1, 64)
    xx, yy = np.meshgrid(grid, grid)
    field = np.exp(-5 * (xx**2 + yy**2))
    rgb = np.stack([field, 0.3 + 0.5 * field, 0.2 + 0.4 * field], -1)
    Image.fromarray((rgb * 255).astype("uint8")).save(assets / "field.png")
    mask = (field > 0.4).astype("uint8")
    samples = np.sin(np.linspace(0, 440 * 2 * np.pi, 8000)) * 0.15
    with wave.open(str(assets / "tone.wav"), "wb") as f:
        f.setnchannels(1); f.setsampwidth(2); f.setframerate(8000)
        f.writeframes((samples * 32767).astype("<i2").tobytes())
    import imageio.v2 as imageio
    frames = [(np.roll(rgb, shift, axis=1) * 255).astype("uint8") for shift in range(0, 32, 2)]
    imageio.mimwrite(assets / "motion.mp4", frames, fps=8, codec="libx264")
    fig, ax = plt.subplots(figsize=(5, 3))
    ax.hist(field.ravel(), bins=24, color="#176b5b")
    ax.set(xlabel="Intensity", ylabel="Pixels", title="A synthetic field")
    fig.tight_layout()
    fig.savefig(assets / "histogram.svg")
    interactive = go.Figure(go.Surface(z=field[::4, ::4], colorscale="Viridis"))
    interactive.update_layout(title="Interactive synthetic surface", margin=dict(l=0,r=0,t=40,b=0))
    interactive.write_json(assets / "surface.plotly.json")
    vertices = np.array([[0,0,1],[-1,-1,0],[1,-1,0],[0,1,0]], dtype=float)
    faces = np.array([[0,1,2],[0,2,3],[0,3,1],[1,3,2]])
    truth = np.array([0,0,0,1,1,1,1,0])
    scores = np.array([.05,.2,.7,.9,.8,.4,.95,.1])
    run.log({
        "image": cairn.Image(rgb, masks={"foreground": mask},
            boxes=[{"position":{"minX":.25,"minY":.25,"maxX":.75,"maxY":.75},
                    "domain":"fraction", "class_id":1, "label":"peak", "score":.99}],
            class_labels={0:"background",1:"peak"}),
        "image_gallery": [cairn.Image(rgb, caption="Original"),
                          cairn.Image(rgb[:, ::-1], caption="Reflection")],
        "audio": cairn.Audio(samples, sample_rate=8000),
        "video": cairn.Video(assets / "motion.mp4"),
        "matplotlib": cairn.Figure(fig), "plotly": cairn.Figure(interactive),
        "histogram": cairn.Histogram(field.ravel(), bins=24),
        "tensor": cairn.Tensor(field[:8, :8]),
        "text": cairn.Text("All evidence in this showcase is synthetic and deterministic."),
        "markdown": cairn.Markdown("## Evidence\nA **deterministic** synthetic field."),
        "html": cairn.Html("<article><h3>Quality check</h3><p>All samples are finite.</p></article>"),
        "table": cairn.Table(columns=["id","label","score","correct"],
                            data=[[i,int(y),float(s),bool((s>.5)==y)] for i,(y,s) in enumerate(zip(truth,scores))]),
        "confusion": cairn.ConfusionMatrix(truth, scores>.5, class_names=["background","signal"]),
        "precision_recall": cairn.PRCurve(truth, scores),
        "roc": cairn.ROCCurve(truth, scores),
        "pointcloud": cairn.PointCloud(np.column_stack([xx.ravel(), yy.ravel(), field.ravel()]), values=field.ravel()),
        "mesh": cairn.Mesh(vertices, faces, values=vertices[:,2]),
        "boxes": cairn.Boxes3D([[0,0,0],[.1,.1,.1]], [[1,1,1],[.4,.4,.4]], depth=[0,1]),
        "octree": cairn.Octree([[0,0,0],[0,0,0]], [[1,1,1],[.5,.5,.5]], depth=[0,1]),
        "bvh": cairn.BVH([[0,0,0],[.2,.2,.2]], [[1,1,1],[.8,.8,.8]], depth=[0,1]),
        "volume": cairn.Volume(np.stack([field * v for v in np.linspace(.1,1,8)])),
        "custom": cairn.Data({"values":np.array([2,5,8,3,6], dtype="float32")}, kind="demo/hist"),
    })
    plt.close(fig)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=Path("/tmp/cairn-showcase"))
    parser.add_argument("--repo", help="Local repository path OR remote server URL. Defaults to OUTPUT/repo.")
    parser.add_argument("--project", default=PROJECT)
    parser.add_argument("--prepare-only", action="store_true", help="Generate runs and report sources without publishing")
    parser.add_argument("--publish-only", action="store_true", help="Build and publish a previously prepared output directory")
    args = parser.parse_args()
    out = args.output.resolve()
    if args.publish_only:
        prepared = json.loads((out / "prepared.json").read_text())
        publish(out, **prepared)
        return
    # Refuse to overwrite previous sources or reports; append runs explicitly with a new output folder.
    out.mkdir(parents=True, exist_ok=True)
    if (out / "reports").exists():
        parser.error(f"{out}/reports already exists; choose a new --output to preserve the previous showcase")
    repo = args.repo or str(out / "repo")
    if not repo.startswith(("http://", "https://")):
        repo = str(Path(repo).resolve())
    project = args.project
    # Remote journals are a delivery buffer; the selected server remains the sole repository.
    os.environ["CAIRN_DIR"] = str(out / "buffer")
    shutil.copytree(SOURCE / "reports", out / "reports")
    assets = out / "reports" / "media" / "assets"
    assets.mkdir()
    ids = {}
    with cairn.init(project=project, name="prepare-data", repo=repo, **CAPTURE) as run:
        cairn.log({"samples":128})
        run.config.update({"seed":17, "description":"Deterministic linear regression"})
        x = np.linspace(-1,1,128)
        y = 2*x + 0.1*np.sin(11*x)
        data = cairn.Artifact("training-data", type="dataset", metadata={"seed":17})
        with data.new_file("samples.csv") as f:
            f.write("x,y\n")
            for a,b in zip(x,y): f.write(f"{a},{b}\n")
        dataset = cairn.log_artifact(data).wait()
        ids["prepare"] = run.id
    rows = []
    for name, lr in [("baseline",.025),("balanced",.12),("fast",.3)]:
        with cairn.init(project=project, name=name, repo=repo, tags=["comparison",name],
                        config={"lr":lr,"steps":40,"seed":17}, **CAPTURE) as run:
            run.use_artifact(dataset.qualified_ref, role="training-data")
            cairn.define_metric("loss", step_metric="epoch", summary="min")
            run.define_metric("accuracy", summary="max")
            w = 0.
            for epoch in range(40):
                residual = w*x-y
                loss = float(np.mean(residual**2))
                cairn.log({"epoch":epoch,"loss":loss}, commit=False)
                cairn.log({"accuracy":float(np.exp(-loss)),"weight":w})
                w -= lr * float(2*np.mean(residual*x))
            run.summary.update({"final_weight":w,"conclusion":"converged" if loss<.02 else "needs more steps"})
            checkpoint = cairn.Artifact("linear-model", type="model", metadata={"lr":lr,"loss":loss})
            with checkpoint.new_file("weights.json") as f: json.dump({"weight":w},f)
            model = run.log_artifact(checkpoint, aliases=[name] + (["best"] if name=="fast" else [])).wait()
            ids[name] = run.id
            rows.append({"name":name,"lr":lr,"loss":loss,"weight":w,"run":run.id})
    # Explicit run methods use the same storage contract as the default module-level API.
    with cairn.Run(project=project, name="evaluation-and-media", repo=repo, **CAPTURE) as run:
        run.use_artifact(model.qualified_ref, role="model")
        run.use_artifact(dataset.qualified_ref, role="test-data")
        run.log({"test_loss":rows[-1]["loss"]})
        media(run, assets)
        run.summary["media_families"] = 23
        ids["evaluation"] = run.id
    viewer = SOURCE.parent / "custom_viewers" / "minimal" / "hist"
    viewer_version = cairn.publish_viewer(viewer, project=project, repo=repo, default_for=["demo/hist"])
    sweep = cairn.sweep({"lr":{"values":[.025,.12,.3]}}, project=project,
                        name="learning-rate-grid", metric="loss", goal="minimize", method="grid", repo=repo)
    trials = sweep.run(sweep_trial, count=3, **CAPTURE)
    if len(trials) != 3:
        raise AssertionError("Expected all three grid trials")
    with cairn.Reader(repo) as reader:
        for name in ("baseline","balanced","fast"):
            saved = reader.run(ids[name])
            assert len(saved.sequence("loss").values) == 40
        best = reader.artifact("linear-model:best", project=project)
        assert best.logged_by().id == ids["fast"]
        assert ids["evaluation"] in [r.id for r in best.used_by()]
        run_count = len(list(reader.runs(project)))
        assert run_count == 8, f"Expected 8 runs, found {run_count}"
    replacements = {"@PROJECT@":project, "@DATASET@":dataset.qualified_ref,
                    "@MODEL@":model.qualified_ref, "@VIEWER@":viewer_version.qualified_ref, **{f"@{k.upper()}@":v for k,v in ids.items()}}
    for slug in ("overview", "media", "methods"):
        rid = hashlib.sha256(f"{project}/{slug}".encode()).hexdigest()[:32]
        replacements[f"@{slug.upper()}_URL@"] = f"/p/{project}/reports/{rid}"
    for source in (out / "reports").glob("*/report.qmd"):
        text = source.read_text()
        for old,new in replacements.items(): text = text.replace(old,new)
        source.write_text(text)
    (out / "reports" / "overview" / "comparison.json").write_text(json.dumps(rows,indent=2))
    (out / "reports" / "methods" / "sweep.json").write_text(json.dumps({"id":sweep.id,"trials":trials,"best":sweep.best},indent=2))
    prepared = {"repo":repo,"project":project,"ids":ids,"sweep_id":sweep.id,"run_count":run_count}
    (out / "prepared.json").write_text(json.dumps(prepared,indent=2))
    if not args.prepare_only:
        publish(out, **prepared)
    else:
        print(f"Prepared runs and report sources in {out}")


def publish(out, repo, project, ids, sweep_id, run_count):
    from cairn.reports.publishing import publish_report
    from cairn.reports.config import load_config
    from cairn.reports.share import share
    published = {}
    first = publish_report("overview", project=out, repo=repo, namespace=project)
    # A deliberate second publication makes retained history visible without mutating evidence.
    overview = out / "reports" / "overview" / "report.qmd"
    if "## Publication history" not in overview.read_text():
        overview.write_text(overview.read_text() + "\n## Publication history\n\nThis second edition adds a reading guide. The first edition remains a pinned build; its original URL is recorded in `showcase.json`.\n")
    for slug in ("overview","media","methods"):
        published[slug] = publish_report(slug, project=out, repo=repo, namespace=project)
    exported = share(load_config(out, repo=repo, namespace=project), report="overview", build=False, out=out / "showcase.html")
    for slug in ("media", "methods"):
        share(load_config(out, repo=repo, namespace=project), report=slug, build=False, out=out / f"{slug}.html")
    result = {"project":project,"repo":repo,"runs":ids,"sweep":sweep_id,"first_publication":first,
              "publications":published,"export":str(exported),"validation":{"runs":run_count,"trials":3,"metric_points_per_training_run":40,"lineage":"verified"}}
    (out / "showcase.json").write_text(json.dumps(result,indent=2))
    print(json.dumps(result,indent=2))
    print(f"\nOpen with: cairn ui --repo {repo} --port 4382")
    print(f"Project: http://127.0.0.1:4382/p/{project}")


if __name__ == "__main__":
    main()
