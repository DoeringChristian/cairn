import {
  configureRuntime,
  createEndpointDataSource,
  getWebGpuComparisonStats,
  resetWebGpuComparisonStats,
} from "@cairn-plot";

import { api } from "../api/client";

/** Iteration scrubbing benefits from retaining the decoded float payloads, not
 * merely the browser's compressed HTTP responses. Cairn dashboards commonly
 * span more than the library's conservative 512 MiB embed default. */
configureRuntime({
  decodedCacheBytes: 2 * 1024 * 1024 * 1024,
  gpu: {
    livePaneLimit: 64,
    sourceTexturesPerPane: 64,
    diffEntries: 8192,
    diffBytes: 2 * 1024 * 1024 * 1024,
  },
});

// Diagnostic seam for real artifact-backed sweeps. It distinguishes a genuine
// hot FLIP presentation from cache eviction/recompute or source re-upload.
Object.assign(window, {
  __cairnPlotComparisonStats: getWebGpuComparisonStats,
  __cairnPlotResetComparisonStats: resetWebGpuComparisonStats,
});

/** Cairn's one adapter from artifact hashes to its HTTP API. */
export const cairnPlotDataSource = createEndpointDataSource(api.artifactUrl);
