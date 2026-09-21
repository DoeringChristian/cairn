import { useEffect, useMemo, useRef, useState } from "react";

interface Props {
  value: string;
  onChange: (value: string) => void;
  onCommit: (tag: string) => void;
  onCancel: () => void;
  suggestions: string[];
  exclude?: string[];
  placeholder?: string;
  className?: string;
  autoFocus?: boolean;
  disabled?: boolean;
}

const MAX_SUGGESTIONS = 8;

export default function TagInput({
  value,
  onChange,
  onCommit,
  onCancel,
  suggestions,
  exclude,
  placeholder = "tag",
  className = "",
  autoFocus = false,
  disabled = false,
}: Props) {
  const [activeIdx, setActiveIdx] = useState(-1);
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  const filtered = useMemo(() => {
    const lower = value.trim().toLowerCase();
    const excSet = new Set(exclude ?? []);
    return suggestions
      .filter((s) => !excSet.has(s) && (lower === "" || s.toLowerCase().includes(lower)))
      .slice(0, MAX_SUGGESTIONS);
  }, [value, suggestions, exclude]);

  // Only show dropdown when there's input text and matching suggestions
  const showDropdown = open && value.trim() !== "" && filtered.length > 0;

  useEffect(() => {
    setActiveIdx(-1);
  }, [value]);

  const commit = (tag: string) => {
    const trimmed = tag.trim();
    if (trimmed) onCommit(trimmed);
    setOpen(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown" && showDropdown) {
      e.preventDefault();
      setActiveIdx((i) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp" && showDropdown) {
      e.preventDefault();
      setActiveIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (activeIdx >= 0 && activeIdx < filtered.length) {
        commit(filtered[activeIdx]!);
      } else {
        commit(value);
      }
    } else if (e.key === "Escape") {
      e.preventDefault();
      onCancel();
    }
  };

  return (
    <div ref={wrapperRef} className="relative">
      <input
        autoFocus={autoFocus}
        className={`input py-0.5 text-xs ${className}`}
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => {
          // Delay to allow click on dropdown item
          setTimeout(() => setOpen(false), 150);
        }}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        disabled={disabled}
      />
      {showDropdown && (
        <ul className="absolute left-0 top-full z-10 mt-0.5 max-h-48 w-full overflow-y-auto rounded border border-border bg-bg-surface shadow-md">
          {filtered.map((tag, i) => (
            <li key={tag}>
              <button
                type="button"
                className={`block w-full px-2 py-1 text-left text-xs mono ${
                  i === activeIdx
                    ? "bg-accent/10 text-fg"
                    : "text-fg-muted hover:bg-bg-hover"
                }`}
                onMouseDown={(e) => {
                  e.preventDefault(); // prevent blur
                  commit(tag);
                }}
                onMouseEnter={() => setActiveIdx(i)}
              >
                {tag}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
