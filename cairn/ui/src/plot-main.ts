import {
  createEndpointDataSource,
  mountPlot,
  type PlotDescriptor,
} from "@cairn-plot";
import "@cairn-plot/public/styles.css";

const DESCRIPTOR_SCRIPT_ID = "__cairn_plot_descriptor__";
const DESCRIPTOR_MIME = "application/cairn-plot+json";

async function readDescriptor(): Promise<PlotDescriptor> {
  const inline =
    document.getElementById(DESCRIPTOR_SCRIPT_ID) ??
    document.querySelector(`script[type="${DESCRIPTOR_MIME}"]`);
  if (inline?.textContent) return JSON.parse(inline.textContent) as PlotDescriptor;

  const src = new URLSearchParams(window.location.search).get("src");
  if (!src) {
    throw new Error(`No plot descriptor found (expected ${DESCRIPTOR_MIME} or ?src=...)`);
  }
  const response = await fetch(src);
  if (!response.ok) throw new Error(`failed to fetch descriptor (${response.status})`);
  return response.json() as Promise<PlotDescriptor>;
}

async function main(): Promise<void> {
  const root = document.getElementById("cairn-plot-root");
  if (!root) throw new Error("missing #cairn-plot-root");

  try {
    const descriptor = await readDescriptor();
    const base = (descriptor.endpoint ?? window.location.origin).replace(/\/$/, "");
    mountPlot(root, {
      descriptor,
      dataSource: createEndpointDataSource((hash) => `${base}/api/artifacts/${hash}`),
      className: "p-2",
    });
  } catch (error) {
    root.textContent = `Plot error: ${error instanceof Error ? error.message : String(error)}`;
    root.className = "p-4 text-sm text-red-400";
  }
}

void main();
