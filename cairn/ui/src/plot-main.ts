import {
  createEndpointDataSource,
  mountPlot,
  type PlotSpec,
} from "@cairn-plot";
import "@cairn-plot/styles.css";

const DESCRIPTOR_SCRIPT_ID = "__cairn_plot_descriptor__";
const DESCRIPTOR_MIME = "application/cairn-plot+json";

async function readDescriptor(): Promise<PlotSpec & { endpoint?: string }> {
  const inline =
    document.getElementById(DESCRIPTOR_SCRIPT_ID) ??
    document.querySelector(`script[type="${DESCRIPTOR_MIME}"]`);
  if (inline?.textContent) return JSON.parse(inline.textContent) as PlotSpec & { endpoint?: string };

  const src = new URLSearchParams(window.location.search).get("src");
  if (!src) {
    throw new Error(`No plot descriptor found (expected ${DESCRIPTOR_MIME} or ?src=...)`);
  }
  const response = await fetch(src);
  if (!response.ok) throw new Error(`failed to fetch descriptor (${response.status})`);
  return response.json() as Promise<PlotSpec & { endpoint?: string }>;
}

async function main(): Promise<void> {
  const root = document.getElementById("cairn-plot-root");
  if (!root) throw new Error("missing #cairn-plot-root");

  try {
    const descriptor = await readDescriptor();
    const base = (descriptor.endpoint ?? window.location.origin).replace(/\/$/, "");
    mountPlot(root, {
      spec: descriptor,
      dataSource: createEndpointDataSource((hash) => `${base}/api/artifacts/${hash}`),
      className: "p-2",
    });
  } catch (error) {
    root.textContent = `Plot error: ${error instanceof Error ? error.message : String(error)}`;
    root.className = "p-4 text-sm text-red-400";
  }
}

void main();
