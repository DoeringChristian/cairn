// Guiding distribution viewer: a von Mises-Fisher (vMF) mixture on the unit
// sphere, logged as
//
//   cairn.Data({"mu": (K, 3) unit vectors, "kappa": (K,), "weight": (K,)}, kind="guiding/vmf")
//
// The sphere is coloured by the mixture's density; each lobe is a point at its
// mean direction. It is a "compare" viewer (cairn-viewer.json): when the card
// pairs the series with a reference (gear > Compare), it gets both values as
// inputs [A, B] and draws them side by side, with one camera.
//
// three.js is the app's own (`cairn:three`); OrbitControls is vendored into
// ./vendor with
//   cairn viewer add . three@0.185.1/examples/jsm/controls/OrbitControls.js --external three \
//     --as three/addons/controls/OrbitControls.js
// (--external three: its `import "three"` resolves to the host's three).
import * as THREE from "cairn:three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { onRender, onResize, onView, setView, snapshot } from "cairn:sdk";
import { colormap } from "./colormaps.js";

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setScissorTest(true); // one viewport per pane
document.body.append(renderer.domElement);

const HOME = { position: [0, 0.8, 3.4], target: [0, 0, 0] };
const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
camera.position.fromArray(HOME.position);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enablePan = false;
controls.minDistance = 1.6;
controls.maxDistance = 10;

// One pane per input: its own scene with a density-coloured sphere, a
// wireframe overlay and the lobe markers. Both panes share the camera.
function makePane() {
  const scene = new THREE.Scene();
  const geometry = new THREE.SphereGeometry(1, 128, 64);
  geometry.setAttribute("color", new THREE.BufferAttribute(new Float32Array(geometry.attributes.position.count * 3), 3));
  const sphere = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ vertexColors: true }));
  const wire = new THREE.LineSegments(
    new THREE.WireframeGeometry(new THREE.SphereGeometry(1.001, 24, 12)),
    new THREE.LineBasicMaterial({ transparent: true, opacity: 0.35 }),
  );
  const lobes = new THREE.Points(new THREE.BufferGeometry(), new THREE.PointsMaterial({ sizeAttenuation: false }));
  scene.add(sphere, wire, lobes);
  const label = document.createElement("div");
  // Named only when two panes share the frame (A | B); the card labels a single pane itself.
  label.style.cssText = "position:absolute;bottom:4px;font:11px var(--cairn-font);color:var(--cairn-muted);pointer-events:none";
  document.body.append(label);
  return { scene, sphere, wire, lobes, label };
}
const panes = [makePane(), makePane()];

// The mixture's density at unit vector (x, y, z):
//   sum_k w_k * kappa_k / (2 pi (1 - exp(-2 kappa_k))) * exp(kappa_k (mu_k . x - 1))
// (the numerically stable form of the vMF normalization).
function densityFn(lobes) {
  const norm = lobes.map((l) => (l.w * l.kappa) / (2 * Math.PI * -Math.expm1(-2 * l.kappa)));
  return (x, y, z) => {
    let f = 0;
    for (let k = 0; k < lobes.length; k++) {
      const l = lobes[k];
      f += norm[k] * Math.exp(l.kappa * (l.mu[0] * x + l.mu[1] * y + l.mu[2] * z - 1));
    }
    return f;
  };
}

// The heaviest `max` lobes of a logged value (arrays arrive as {data, shape, dtype}).
function lobesOf(value, max) {
  const { mu, kappa, weight } = value;
  const all = Array.from({ length: mu.shape[0] }, (_, k) => ({
    mu: [mu.data[3 * k], mu.data[3 * k + 1], mu.data[3 * k + 2]],
    kappa: Math.max(1e-3, kappa.data[k]),
    w: weight.data[k],
  }));
  return all.sort((a, b) => b.w - a.w).slice(0, max);
}

const tmp = new THREE.Color();

function fillPane(pane, input, settings, theme) {
  const lobes = lobesOf(input.data, settings.maxLobes);
  const density = densityFn(lobes);
  const pos = pane.sphere.geometry.attributes.position;
  const col = pane.sphere.geometry.attributes.color;
  // Exposure maps density to [0, 1) the same way for every pane, so a learned
  // and a reference distribution compare by colour.
  // Colormaps are sRGB; three.js wants vertex colours in linear space.
  for (let i = 0; i < pos.count; i++) {
    const f = density(pos.getX(i), pos.getY(i), pos.getZ(i));
    const [r, g, b] = colormap(settings.colormap, 1 - Math.exp(-settings.exposure * f));
    tmp.setRGB(r, g, b, THREE.SRGBColorSpace);
    col.setXYZ(i, tmp.r, tmp.g, tmp.b);
  }
  col.needsUpdate = true;

  pane.lobes.geometry.dispose();
  pane.lobes.geometry = new THREE.BufferGeometry().setAttribute(
    "position", new THREE.Float32BufferAttribute(lobes.flatMap((l) => l.mu.map((c) => c * 1.02)), 3),
  );
  pane.lobes.material.size = settings.pointSize;
  pane.lobes.material.color.set(theme.fg);
  pane.lobes.visible = settings.pointSize > 0;
  pane.wire.visible = settings.wireframe;
  pane.wire.material.color.set(theme.fg);
  pane.scene.background = new THREE.Color(theme.bg);
  pane.label.textContent = `${input.label} · ${lobes.length} lobes`;
}

let size = { width: 1, height: 1, dpr: 1 };
let count = 1; // panes shown: 1, or 2 with a reference

function draw() {
  const w = size.width / count;
  camera.aspect = w / Math.max(1, size.height);
  camera.updateProjectionMatrix();
  for (let i = 0; i < count; i++) {
    renderer.setViewport(i * w, 0, w, size.height);
    renderer.setScissor(i * w, 0, w, size.height);
    renderer.render(panes[i].scene, camera);
    panes[i].label.style.left = `${i * w + 6}px`;
  }
  panes.forEach((p, i) => (p.label.hidden = count < 2 || i >= count));
}

function resize(s) {
  size = s;
  renderer.setPixelRatio(s.dpr);
  renderer.setSize(s.width, s.height);
  draw();
}
onResize(resize);

// Called for every step, settings change and theme change.
onRender(({ inputs, settings, size: s, theme }) => {
  count = Math.min(inputs.length, panes.length);
  inputs.slice(0, count).forEach((input, i) => fillPane(panes[i], input, settings, theme));
  resize(s);
});

// View sync: the camera is the card's view. Moving it here moves it in the
// card's other panes (other runs, gallery items); their moves arrive in onView.
let applying = false;
controls.addEventListener("change", () => {
  draw();
  if (!applying) setView({ position: camera.position.toArray(), target: controls.target.toArray() });
});
onView((v) => {
  applying = true;
  const view = v ?? HOME; // null: the card's "reset view"
  camera.position.fromArray(view.position);
  controls.target.fromArray(view.target);
  controls.update();
  applying = false;
  draw();
});

// The picture used while the frame is paused (WebGL budget) and in report
// exports: draw and read back in one go (no preserveDrawingBuffer needed).
snapshot(() => {
  draw();
  return renderer.domElement.toDataURL("image/png");
});
