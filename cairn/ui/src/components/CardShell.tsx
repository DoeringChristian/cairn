import { useEffect, type ReactNode, type RefObject } from "react";
import { resolveCardHeight } from "../lib/card-settings";
import type { BaseCardSettings } from "./card-kit";
import CardHeader from "./CardHeader";
import CardResizeHandle from "./CardResizeHandle";
import CardDetailModal from "./CardDetailModal";

interface Props {
  cardRef: RefObject<HTMLDivElement>;
  settings: BaseCardSettings;
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
  /**
   * Run-selection panel rendered below the card body — and, when a modal is
   * configured, again below the modal content. The *same* node is rendered in
   * both places (cards pass one element; may be a falsy value to render nothing).
   */
  selectionPanel?: ReactNode;
  /** Settings form rendered in the detail modal's side panel. */
  settingsPanel?: ReactNode;
  /** Main content of the detail modal (the card at full size). */
  modalContent?: ReactNode;
  /** Whether the detail modal is open. */
  modalOpen?: boolean;
  /** Close handler for the detail modal. */
  onModalClose?: () => void;
  /** When true on mount, scroll the card into view once (e.g. just-added card). */
  scrollIntoViewOnMount?: boolean;
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
  selectionPanel,
  settingsPanel,
  modalContent,
  modalOpen,
  onModalClose,
  scrollIntoViewOnMount,
  children,
}: Props) {
  // Scroll a just-added card into view once, on mount. Deliberately runs
  // only on the initial mount (not when the flag later flips false) so a
  // parent can clear its transient "just added" state without re-triggering.
  useEffect(() => {
    if (scrollIntoViewOnMount) {
      cardRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
      {!settings.collapsed && (
        <>
          {children}
          {selectionPanel}
          {modalContent !== undefined && (
            <CardDetailModal
              open={!!modalOpen}
              onClose={onModalClose ?? (() => {})}
              title={settings.title ?? title}
              settingsContent={settingsPanel}
            >
              {modalContent}
              {selectionPanel}
            </CardDetailModal>
          )}
        </>
      )}
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
