import {
  configureRuntime,
  createEndpointDataSource,
  getMemoryDiagnosticSnapshot,
  getWebGpuComparisonStats,
  resetMemoryDiagnosticStats,
  resetWebGpuComparisonStats,
} from "@cairn-plot";

import { api } from "../api/client";

/** Explicit conservative policy for long-lived artifact dashboards. Byte
 * budgets are primary; count limits remain secondary fragmentation guards. */
const GiB = 1024 * 1024 * 1024;
const MiB = 1024 * 1024;
configureRuntime({
  decodedCacheBytes: GiB,
  expandedUploadCacheBytes: 768 * MiB,
  offscreenCpuReleaseMs: 30_000,
  gpu: {
    livePaneLimit: 16,
    sourceTexturesPerPane: 8,
    activeSourceBytes: GiB,
    sharedSourceBytes: Math.floor(1.25 * GiB),
    zeroRefSourceBytes: 128 * MiB,
    diffEntries: 256,
    diffBytes: GiB,
  },
});

// Diagnostic seam for real artifact-backed sweeps. It distinguishes a genuine
// hot FLIP presentation from cache eviction/recompute or source re-upload.
Object.assign(window, {
  __cairnPlotComparisonStats: getWebGpuComparisonStats,
  __cairnPlotResetComparisonStats: resetWebGpuComparisonStats,
  __cairnPlotMemorySnapshot: getMemoryDiagnosticSnapshot,
  __cairnPlotResetMemoryStats: resetMemoryDiagnosticStats,
});

/** Cairn's one adapter from artifact hashes to its HTTP API. */
export const cairnPlotDataSource = createEndpointDataSource(api.artifactUrl);
