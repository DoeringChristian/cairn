import { createEndpointDataSource } from "@cairn-plot";

import { api } from "../api/client";

/** Cairn's one adapter from artifact hashes to its HTTP API. */
export const cairnPlotDataSource = createEndpointDataSource(api.artifactUrl);
