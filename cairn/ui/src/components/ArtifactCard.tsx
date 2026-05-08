/**
 * Artifact card — displays generic tracked artifacts with download links.
 * Shows file metadata (name, size, MIME type) and a step slider.
 */

import { useMemo, useRef, useState } from "react";
import { useSequence, useArtifacts } from "../api/hooks";
import { api } from "../api/client";
import { safeJsonParse } from "../lib/format";
import { downloadArtifact, artifactFilename } from "../lib/download";
import { useCardSettings, resolveCardHeight, toggleColSpanPatch, type CardSettingsKey } from "../lib/card-settings";
import type { SequenceMeta } from "../api/types";
import CardHeader from "./CardHeader";
import CardResizeHandle from "./CardResizeHandle";
import StepSlider, { type XAxisMode } from "./StepSlider";

interface Props {
  runId: string;
  metric: SequenceMeta;
  settingsKeyOverride?: CardSettingsKey;
  onRemove?: () => void;
}

interface ArtifactMeta {
  filename?: string;
  size_bytes?: number;
  mime_type?: string;
  python_type?: string;
  python_module?: string;
  [key: string]: unknown;
}

interface ArtifactSettings {
  version: 1;
  title?: string;
  collapsed?: boolean;
  sliderStep?: number;
  height?: number;
  height1?: number;
  height2?: number;
  colSpan?: number;
  xAxis?: "step" | "relative_time" | "wall_time";
}

const DEFAULT_SETTINGS: ArtifactSettings = { version: 1 };

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export default function ArtifactCard({ runId, metric, settingsKeyOverride, onRemove }: Props) {
  const q = useSequence(runId, metric.name, {
    context: metric.context_hash || undefined,
    maxPoints: 200,
  });
  // Also fetch named artifacts (from log_artifact) as fallback.
  const artifactsQ = useArtifacts(runId);
  const points = useMemo(() => {
    const seqPoints = (q.data?.points ?? []).filter((p) => p.artifact_hash);
    if (seqPoints.length > 0) return seqPoints;
    // Fall back to named artifacts matching this metric name.
    // Sort by step ascending so the slider goes 0 → max left-to-right.
    const named = (artifactsQ.data?.named ?? [])
      .filter((a: any) => a.name === metric.name)
      .slice()
      .sort((a: any, b: any) => (a.step ?? 0) - (b.step ?? 0));
    return named.map((a: any) => ({
      step: a.step ?? 0,
      wall_time: a.created_at,
      artifact_hash: a.hash,
      artifact_mime: a.mime_type,
      artifact_size: a.size_bytes,
      artifact_metadata: a.metadata,
      object_type: "artifact",
    }));
  }, [q.data, artifactsQ.data, metric.name]);

  const [settings, updateSettings] = useCardSettings(
    settingsKeyOverride ?? { runId, metricName: metric.name, contextHash: metric.context_hash },
    DEFAULT_SETTINGS,
  );

  const [idx, setIdx] = useState(settings.sliderStep ?? 0);
  const safeIdx = Math.min(Math.max(0, idx), Math.max(0, points.length - 1));
  const current = points[safeIdx];
  const meta = useMemo(
    () => safeJsonParse<ArtifactMeta>(current?.artifact_metadata ?? null) ?? {},
    [current],
  );

  const subtitle = points.length > 0
    ? `step ${current?.step ?? 0} (${safeIdx + 1}/${points.length})`
    : `${metric.count} pts`;

  const cardRef = useRef<HTMLDivElement>(null);

  return (
    <div
      ref={cardRef}
      className="card p-4 flex flex-col"
      style={{
        position: "relative",
        height: resolveCardHeight(settings, undefined),
        gridColumn: (settings.colSpan ?? 1) > 1 ? `span ${settings.colSpan}` : undefined,
      }}
    >
      <CardHeader
        title={settings.title ?? metric.name}
        onTitleChange={(t) => updateSettings({ title: t || undefined })}
        subtitle={subtitle}
        collapsed={settings.collapsed}
        onToggleCollapse={() => updateSettings({ collapsed: !settings.collapsed })}
        onToggleFullWidth={() => updateSettings(toggleColSpanPatch(settings, cardRef.current) as Partial<ArtifactSettings>)}
        isFullWidth={(settings.colSpan ?? 1) > 1}
        onRemove={onRemove}
        onDownload={current?.artifact_hash ? () => downloadArtifact(api.artifactUrl(current.artifact_hash!), artifactFilename(metric.name, current.step, "application/python-pickle")) : undefined}
      >
        <span className="inline-flex items-center rounded bg-bg-hover px-1.5 py-0.5 text-[10px] text-fg-muted">
          artifact
        </span>
      </CardHeader>

      {!settings.collapsed && (
        <>
          {current?.artifact_hash ? (
            <div className="flex-1 min-h-0 flex flex-col gap-2 overflow-auto">
              <div className="rounded border border-border bg-bg p-3 text-xs">
                <div className="flex flex-col gap-1">
                  {meta.python_type && (
                    <div className="flex items-baseline gap-2">
                      <span className="text-fg-subtle">Python type:</span>
                      <span className="mono text-fg">
                        {meta.python_module && meta.python_module !== "builtins" ? `${meta.python_module}.` : ""}{meta.python_type}
                      </span>
                    </div>
                  )}
                  {meta.size_bytes != null && (
                    <div className="flex items-baseline gap-2">
                      <span className="text-fg-subtle">Size:</span>
                      <span className="mono num text-fg">{formatBytes(meta.size_bytes)}</span>
                    </div>
                  )}
                  <div className="flex items-baseline gap-2">
                    <span className="text-fg-subtle">Format:</span>
                    <span className="mono text-fg">pickle (.pkl)</span>
                  </div>
                  <div className="flex items-baseline gap-2">
                    <span className="text-fg-subtle">Hash:</span>
                    <span className="mono text-fg-muted">{current.artifact_hash.slice(0, 16)}...</span>
                  </div>
                  {/* Show any extra metadata keys */}
                  {Object.entries(meta).filter(([k]) => !["filename", "size_bytes", "mime_type", "python_type", "python_module"].includes(k)).map(([k, v]) => (
                    <div key={k} className="flex items-baseline gap-2">
                      <span className="text-fg-subtle">{k}:</span>
                      <span className="mono text-fg">{String(v)}</span>
                    </div>
                  ))}
                </div>
                <a
                  href={api.artifactUrl(current.artifact_hash)}
                  download={`${metric.name.replace(/[^a-zA-Z0-9._-]/g, "_")}_step${current.step}.pkl`}
                  className="inline-flex items-center gap-1 mt-2 text-accent hover:underline"
                >
                  Download .pkl
                </a>
              </div>
            </div>
          ) : (
            <div className="flex-1 flex items-center justify-center text-sm text-fg-muted">
              No artifact at this step
            </div>
          )}

          <StepSlider
            points={points}
            currentIndex={safeIdx}
            onChange={(v) => {
              setIdx(v);
              updateSettings({ sliderStep: v });
            }}
            xAxis={settings.xAxis}
            onXAxisChange={(m) => updateSettings({ xAxis: m })}
            className="mt-3"
          />
        </>
      )}

      <CardResizeHandle
        height={settings.height}
        onHeightChange={(h) => updateSettings({ height: h })}
        colSpan={settings.colSpan ?? 1}
        onColSpanChange={(s) => updateSettings({ colSpan: s })}
        onPerColHeightChange={(p) => updateSettings(p as Partial<ArtifactSettings>)}
      />
    </div>
  );
}
