import { useEffect, type ReactNode, type RefObject } from "react";
import { resolveCardHeight } from "../lib/card-settings";
import { cardMinSize } from "./card-kit/card-min-sizes";
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
  /** Card type key for per-type minimum sizes (see card-kit/card-min-sizes). */
  cardKind?: string;
  onRemove?: () => void;
  onSettings?: () => void;
  /** Reset the card's interactive view to default. Renders a home button left of download, only when `viewModified`. */
  onResetView?: () => void;
  viewModified?: boolean;
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
  cardKind,
  onRemove,
  onSettings,
  onResetView,
  viewModified,
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

  const minSize = cardMinSize(cardKind);
  // Own-min read-time clamp lives inside resolveCardHeight (single source);
  // pass the same minHeight anywhere inner content re-reads this height so
  // the outer box and inner content never disagree.
  const clampedHeight = resolveCardHeight(settings, defaultHeight, minSize.minHeight);

  return (
    <div
      ref={cardRef}
      data-cairn-card
      data-cairn-min-h={minSize.minHeight}
      data-cairn-min-span={minSize.minSpan}
      className={`card p-4 flex flex-col${dropHighlight ? " outline outline-2 outline-accent -outline-offset-2" : ""}`}
      style={{
        height: clampedHeight,
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
        onResetView={onResetView}
        viewModified={viewModified}
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
        minHeight={minSize.minHeight}
        onPerColHeightChange={(p) => updateSettings(p)}
      />
    </div>
  );
}
