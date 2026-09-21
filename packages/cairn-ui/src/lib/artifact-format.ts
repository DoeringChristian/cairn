/** Map an artifact mime type to cairn-plot's raw-buffer `format` hint. */
const FORMAT_BY_MIME: Record<string, "exr" | "npy"> = {
  "image/x-exr": "exr",
  "image/aces": "exr",
  "application/x-npy": "npy",
};

export function artifactFormat(mime: string | null | undefined): "exr" | "npy" | undefined {
  const value = mime?.toLowerCase() ?? "";
  const exact = FORMAT_BY_MIME[value];
  if (exact) return exact;
  if (value.includes("openexr") || value.endsWith("/exr")) return "exr";
  if (value.includes("numpy") || value.includes("npy")) return "npy";
  return undefined;
}
