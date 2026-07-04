// ---------------------------------------------------------------------------
// LabelChip — the bottom-left draggable label chip shared by every viewport
// pane (image + all 3D types). Extracted (WS-VC5 review nit from VC4) from
// two byte-identical copies: `renderers/ImagePane.tsx`'s inline `<span>` and
// `viewport/pointcloud-viewport.tsx`'s own `LabelChip` (which had already
// flagged itself as a "good extraction target for VC5" — see that file's
// history). Markup/classes are UNCHANGED from both — this is a pure
// dedup, not a redesign (spec §7 appendix: "bottom-left draggable label...
// card-owned, uniform (3D inherits)").
// ---------------------------------------------------------------------------

export default function LabelChip({
  label,
  isDraggable,
  onDragStart,
}: {
  label: string;
  isDraggable?: boolean;
  onDragStart?: (e: React.DragEvent) => void;
}) {
  return (
    <span
      className={`absolute bottom-1 left-1 z-10 rounded bg-bg/80 px-1 py-0.5 text-[10px] text-fg-muted backdrop-blur-sm flex items-center gap-1${isDraggable ? " cairn-drag-grip" : ""}`}
      draggable={isDraggable}
      onDragStart={onDragStart}
      style={{ cursor: isDraggable ? "grab" : undefined }}
    >
      {isDraggable && (
        <i className="fa-solid fa-grip-vertical text-[8px] opacity-50" aria-hidden="true" />
      )}
      {label}
    </span>
  );
}
