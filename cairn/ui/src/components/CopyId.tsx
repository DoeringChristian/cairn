/**
 * Inline run ID display with copy-to-clipboard.
 * Shows first 6 chars (git-style short hash) with a copy icon on hover.
 */

import { useState } from "react";

interface Props {
  id: string;
  className?: string;
}

export default function CopyId({ id, className }: Props) {
  const [copied, setCopied] = useState(false);

  const copy = () => {
    navigator.clipboard.writeText(id).catch(() => {
      // Fallback for non-HTTPS contexts
      const ta = document.createElement("textarea");
      ta.value = id;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
    });
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <button
      type="button"
      onClick={copy}
      className={`group/copy mono inline-flex items-center gap-0.5 text-fg-subtle hover:text-fg ${className ?? "text-xs"}`}
      title={`${id}\nClick to copy`}
    >
      {id.slice(0, 6)}
      <span className="text-[9px] opacity-0 group-hover/copy:opacity-60 transition-opacity">
        {copied ? "ok" : "\u2398"}
      </span>
    </button>
  );
}
