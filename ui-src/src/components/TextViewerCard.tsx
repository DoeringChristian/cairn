import { useState, useMemo, useRef } from "react";
import { useSequence } from "../api/hooks";
import { useCardSettings } from "../lib/card-settings";
import type { SequenceMeta } from "../api/types";
import CardHeader from "./CardHeader";
import SettingsPopover from "./SettingsPopover";
import Select from "./settings/Select";
import Toggle from "./settings/Toggle";

interface Props {
  runId: string;
  metric: SequenceMeta;
}

interface TextSettings {
  version: 1;
  fontSize: "xs" | "sm" | "base";
  wordWrap: boolean;
}

const DEFAULT_TEXT_SETTINGS: TextSettings = {
  version: 1,
  fontSize: "xs",
  wordWrap: true,
};

const FONT_SIZE_CLASS: Record<TextSettings["fontSize"], string> = {
  xs: "text-xs",
  sm: "text-sm",
  base: "text-base",
};

export default function TextViewerCard({ runId, metric }: Props) {
  const q = useSequence(runId, metric.name, {
    context: metric.context_hash || undefined,
    maxPoints: 200,
  });
  const points = useMemo(() => q.data?.points ?? [], [q.data]);
  const [idx, setIdx] = useState(0);
  const safeIdx = Math.min(Math.max(0, idx), Math.max(0, points.length - 1));
  const current = points[safeIdx];
  const [content, setContent] = useState<string>("");

  // Fetch the artifact's bytes lazily when the index changes.
  useMemo(() => {
    if (!current?.artifact_hash) {
      setContent("");
      return;
    }
    fetch(`/api/artifacts/${current.artifact_hash}`)
      .then((r) => r.text())
      .then(setContent)
      .catch((e) => setContent(`<fetch error: ${e.message}>`));
  }, [current?.artifact_hash]);

  const settingsKey = useMemo(
    () => ({
      runId,
      metricName: metric.name,
      contextHash: metric.context_hash,
    }),
    [runId, metric.name, metric.context_hash],
  );
  const [settings, updateSettings, resetSettings] = useCardSettings(
    settingsKey,
    DEFAULT_TEXT_SETTINGS,
  );

  const settingsBtnRef = useRef<HTMLButtonElement | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const subtitle =
    points.length > 0
      ? `step ${current?.step ?? "\u2014"}`
      : `${metric.count} pts`;

  const wrapClass = settings.wordWrap
    ? "whitespace-pre-wrap"
    : "whitespace-pre overflow-x-auto";

  return (
    <div className="card p-4">
      <CardHeader title={metric.name} subtitle={subtitle}>
        <button
          ref={settingsBtnRef}
          type="button"
          onClick={() => setSettingsOpen((v) => !v)}
          className="h-5 w-5 inline-flex items-center justify-center rounded hover:bg-bg-hover text-fg-muted hover:text-fg"
          aria-label="Text settings"
          aria-haspopup="dialog"
          aria-expanded={settingsOpen}
          title="Text settings"
        >
          {"\u2699"}
        </button>
      </CardHeader>
      <pre
        className={`mono max-h-48 overflow-auto ${wrapClass} rounded bg-bg p-3 ${FONT_SIZE_CLASS[settings.fontSize]} text-fg-muted`}
      >
        {content}
      </pre>
      {points.length > 1 && (
        <input
          type="range"
          min={0}
          max={points.length - 1}
          value={safeIdx}
          onChange={(e) => setIdx(Number(e.target.value))}
          className="mt-3 w-full accent-accent"
        />
      )}

      <SettingsPopover
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        anchorRef={settingsBtnRef}
        title="Text"
      >
        <Select
          label="Font size"
          value={settings.fontSize}
          onChange={(v) => updateSettings({ fontSize: v })}
          options={[
            { value: "xs", label: "Extra small" },
            { value: "sm", label: "Small" },
            { value: "base", label: "Base" },
          ]}
        />
        <Toggle
          label="Word wrap"
          checked={settings.wordWrap}
          onChange={(v) => updateSettings({ wordWrap: v })}
          description="Wrap long lines to card width. Off = horizontal scroll."
        />
        <button
          type="button"
          className="btn w-full mt-2"
          onClick={() => {
            resetSettings();
            setSettingsOpen(false);
          }}
        >
          Reset to defaults
        </button>
      </SettingsPopover>
    </div>
  );
}
