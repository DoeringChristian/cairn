import type { Highlighter } from "shiki";

export const SHIKI_LANGS = [
  "python",
  "typescript",
  "javascript",
  "json",
  "yaml",
  "toml",
  "markdown",
  "ini",
  "bash",
] as const;

let highlighterPromise: Promise<Highlighter> | null = null;

export function getHighlighter(): Promise<Highlighter> {
  if (!highlighterPromise) {
    highlighterPromise = import("shiki").then((mod) =>
      mod.createHighlighter({
        themes: ["github-dark"],
        langs: [...SHIKI_LANGS],
      }),
    );
  }
  return highlighterPromise;
}

export function langFromPath(path: string): string | null {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  const map: Record<string, string> = {
    py: "python",
    ts: "typescript",
    tsx: "typescript",
    mjs: "javascript",
    cjs: "javascript",
    js: "javascript",
    jsx: "javascript",
    json: "json",
    yaml: "yaml",
    yml: "yaml",
    toml: "toml",
    md: "markdown",
    ini: "ini",
    cfg: "ini",
    sh: "bash",
    bash: "bash",
  };
  return map[ext] ?? null;
}
