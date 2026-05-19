import { useMemo } from "react";
import { useParams } from "react-router-dom";
import { useLineage } from "../api/hooks";
import type { LineageGraph, LineageNode, LineageEdge } from "../api/types";

/** Simple layered layout: assign each node a layer (column) via longest-path from roots. */
function layoutGraph(graph: LineageGraph) {
  const { nodes, edges } = graph;
  if (nodes.length === 0) return { positioned: [], layoutEdges: [] };

  // Build adjacency
  const outgoing = new Map<string, string[]>();
  const incoming = new Map<string, string[]>();
  for (const n of nodes) {
    outgoing.set(n.id, []);
    incoming.set(n.id, []);
  }
  for (const e of edges) {
    outgoing.get(e.source)?.push(e.target);
    incoming.get(e.target)?.push(e.source);
  }

  // Topological layers via longest path from roots
  const layer = new Map<string, number>();
  const visited = new Set<string>();

  function dfs(id: string): number {
    if (layer.has(id)) return layer.get(id)!;
    if (visited.has(id)) return 0; // cycle guard
    visited.add(id);
    const parents = incoming.get(id) ?? [];
    const maxParent = parents.length === 0 ? -1 : Math.max(...parents.map(dfs));
    const l = maxParent + 1;
    layer.set(id, l);
    return l;
  }

  for (const n of nodes) dfs(n.id);

  // Group by layer
  const layers = new Map<number, LineageNode[]>();
  for (const n of nodes) {
    const l = layer.get(n.id) ?? 0;
    if (!layers.has(l)) layers.set(l, []);
    layers.get(l)!.push(n);
  }

  const NODE_W = 160;
  const NODE_H = 48;
  const H_GAP = 80;
  const V_GAP = 24;

  const positioned: Array<{
    node: LineageNode;
    x: number;
    y: number;
    w: number;
    h: number;
  }> = [];
  const posMap = new Map<string, { x: number; y: number; w: number; h: number }>();

  const sortedLayers = [...layers.keys()].sort((a, b) => a - b);
  for (const l of sortedLayers) {
    const group = layers.get(l)!;
    const x = l * (NODE_W + H_GAP) + 20;
    for (let i = 0; i < group.length; i++) {
      const y = i * (NODE_H + V_GAP) + 20;
      const pos = { x, y, w: NODE_W, h: NODE_H };
      posMap.set(group[i]!.id, pos);
      positioned.push({ node: group[i]!, ...pos });
    }
  }

  const layoutEdges: Array<{
    edge: LineageEdge;
    x1: number;
    y1: number;
    x2: number;
    y2: number;
  }> = [];
  for (const e of edges) {
    const src = posMap.get(e.source);
    const tgt = posMap.get(e.target);
    if (src && tgt) {
      layoutEdges.push({
        edge: e,
        x1: src.x + src.w,
        y1: src.y + src.h / 2,
        x2: tgt.x,
        y2: tgt.y + tgt.h / 2,
      });
    }
  }

  return { positioned, layoutEdges };
}

function nodeColor(node: LineageNode): { fill: string; stroke: string } {
  if (node.type === "run") {
    const status = node.metadata?.status as string | undefined;
    switch (status) {
      case "completed":
        return { fill: "rgba(34,197,94,0.12)", stroke: "rgba(34,197,94,0.5)" };
      case "failed":
        return { fill: "rgba(239,68,68,0.12)", stroke: "rgba(239,68,68,0.5)" };
      case "running":
        return { fill: "rgba(59,130,246,0.12)", stroke: "rgba(59,130,246,0.5)" };
      default:
        return { fill: "rgba(156,163,175,0.12)", stroke: "rgba(156,163,175,0.5)" };
    }
  }
  // artifact_version
  const atype = (node.metadata?.artifact_type ?? node.metadata?.type) as string | undefined;
  switch (atype) {
    case "dataset":
      return { fill: "rgba(59,130,246,0.12)", stroke: "rgba(59,130,246,0.5)" };
    case "model":
      return { fill: "rgba(34,197,94,0.12)", stroke: "rgba(34,197,94,0.5)" };
    default:
      return { fill: "rgba(156,163,175,0.12)", stroke: "rgba(156,163,175,0.5)" };
  }
}

function edgeColor(type: string): string {
  return type === "produced"
    ? "rgba(34,197,94,0.5)"
    : "rgba(59,130,246,0.5)";
}

export default function LineagePage() {
  const { projectId } = useParams<{ projectId: string }>();
  const q = useLineage(projectId!);

  const layout = useMemo(() => {
    if (!q.data) return null;
    return layoutGraph(q.data);
  }, [q.data]);

  if (!projectId) return null;
  if (q.isLoading) return <p className="text-fg-muted">Loading...</p>;
  if (q.isError)
    return <p className="text-status-failed">Error: {String(q.error)}</p>;

  if (!layout || layout.positioned.length === 0) {
    return (
      <div>
        <h1 className="mono text-xl font-semibold mb-6">
          {projectId} / lineage
        </h1>
        <p className="text-fg-muted">
          No lineage data yet. Artifact lineage will appear here once runs
          produce or consume versioned artifacts.
        </p>
      </div>
    );
  }

  const maxX = Math.max(...layout.positioned.map((p) => p.x + p.w)) + 40;
  const maxY = Math.max(...layout.positioned.map((p) => p.y + p.h)) + 40;

  return (
    <div>
      <h1 className="mono text-xl font-semibold mb-6">
        {projectId} / lineage
      </h1>
      <div className="overflow-auto rounded-lg border border-border bg-bg-elevated">
        <svg
          width={maxX}
          height={maxY}
          viewBox={`0 0 ${maxX} ${maxY}`}
          className="min-w-full"
        >
          <defs>
            <marker
              id="arrowhead"
              markerWidth="8"
              markerHeight="6"
              refX="7"
              refY="3"
              orient="auto"
            >
              <polygon
                points="0 0, 8 3, 0 6"
                fill="rgba(156,163,175,0.6)"
              />
            </marker>
          </defs>

          {/* Edges */}
          {layout.layoutEdges.map((le, i) => (
            <line
              key={i}
              x1={le.x1}
              y1={le.y1}
              x2={le.x2}
              y2={le.y2}
              stroke={edgeColor(le.edge.type)}
              strokeWidth={1.5}
              markerEnd="url(#arrowhead)"
            />
          ))}

          {/* Nodes */}
          {layout.positioned.map((p) => {
            const colors = nodeColor(p.node);
            const isRun = p.node.type === "run";
            return (
              <g key={p.node.id}>
                <rect
                  x={p.x}
                  y={p.y}
                  width={p.w}
                  height={p.h}
                  rx={isRun ? 12 : 4}
                  ry={isRun ? 12 : 4}
                  fill={colors.fill}
                  stroke={colors.stroke}
                  strokeWidth={1.5}
                />
                <text
                  x={p.x + p.w / 2}
                  y={p.y + p.h / 2 - 6}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  className="fill-fg text-[10px]"
                  fontFamily="monospace"
                >
                  {(() => {
                    const lbl = p.node.type === "artifact_version"
                      ? `${p.node.family_name ?? "?"} v${p.node.version ?? "?"}`
                      : p.node.label ?? p.node.id.slice(0, 8);
                    return lbl.length > 20 ? lbl.slice(0, 18) + "..." : lbl;
                  })()}
                </text>
                <text
                  x={p.x + p.w / 2}
                  y={p.y + p.h / 2 + 8}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  className="fill-fg-muted text-[9px]"
                  fontFamily="monospace"
                >
                  {isRun ? "run" : "artifact"}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}
