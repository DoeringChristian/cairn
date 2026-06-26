import type { ReactNode, RefObject } from "react";
import { resolveCardHeight } from "../lib/card-settings";
import CardHeader from "./CardHeader";
import CardResizeHandle from "./CardResizeHandle";

interface Props {
  cardRef: RefObject<HTMLDivElement | null>;
  settings: {
    title?: string;
    collapsed?: boolean;
    height?: number;
    height1?: number;
    height2?: number;
    heights?: Record<number, number>;
    colSpan?: number;
  };
  updateSettings: (patch: Record<string, unknown>) => void;
  title: string;
  subtitle?: ReactNode;
  defaultHeight?: number;
  onRemove?: () => void;
  onSettings?: () => void;
  onDownload?: () => void;
  onScreenshot?: () => void;
  addToComparisonSlot?: ReactNode;
  headerActions?: ReactNode;
  dropHighlight?: boolean;
  dropProps?: Record<string, unknown>;
  children: ReactNode;
}

export default function CardShell({
  cardRef,
  settings,
  updateSettings,
  title,
  subtitle,
  defaultHeight,
  onRemove,
  onSettings,
  onDownload,
  onScreenshot,
  addToComparisonSlot,
  headerActions,
  dropHighlight,
  dropProps,
  children,
}: Props) {
  return (
    <div
      ref={cardRef}
      className={`card p-4 flex flex-col${dropHighlight ? " outline outline-2 outline-accent -outline-offset-2" : ""}`}
      style={{
        height: resolveCardHeight(settings, defaultHeight),
        position: "relative",
        gridColumn: `span ${settings.colSpan ?? 3}`,
      }}
      {...dropProps}
    >
      <CardHeader
        title={settings.title ?? title}
        onTitleChange={(t) => updateSettings({ title: t || undefined })}
        subtitle={subtitle}
        collapsed={settings.collapsed}
        onToggleCollapse={() => updateSettings({ collapsed: !settings.collapsed })}
        onSettings={onSettings}
        onRemove={onRemove}
        onDownload={onDownload}
        onScreenshot={onScreenshot}
        addToComparisonSlot={addToComparisonSlot}
        cardActions={headerActions}
      />
      {!settings.collapsed && children}
      <CardResizeHandle
        height={settings.height}
        onHeightChange={(h) => updateSettings({ height: h })}
        colSpan={settings.colSpan ?? 3}
        onColSpanChange={(s) => updateSettings({ colSpan: s })}
        onPerColHeightChange={(p) => updateSettings(p)}
      />
    </div>
  );
}
