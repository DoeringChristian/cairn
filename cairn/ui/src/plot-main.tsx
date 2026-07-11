/**
 * The standalone `cairn-plot` entry — the code-split `plot.html` build served
 * at the server `/plot` route (the ENDPOINT / `link` companion to Phase C's
 * offline inline bundle).
 *
 * All mount logic now lives in the shared `./plot-bootstrap` module (so this
 * entry and the single-file `vite.plot-inline.config.ts` IIFE build behave
 * identically): install `window.__cairnPlotBootstrap` for per-div notebook
 * mounts, drain the mount queue, and auto-mount the page-level
 * `#cairn-plot-root` when present (the `/plot` route).
 */
import { installCairnPlotBootstrap } from "./plot-bootstrap";
import "./index.css";

installCairnPlotBootstrap();
