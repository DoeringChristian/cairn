import { useCallback, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import { qk } from "../api/query-keys";

interface Props {
  open: boolean;
  onClose: () => void;
}

export default function ImportRunsDialog({ open, onClose }: Props) {
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Array<{ original_id: string; new_id: string; name: string }> | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reset = useCallback(() => {
    setFile(null);
    setResult(null);
    setError(null);
    if (fileRef.current) fileRef.current.value = "";
  }, []);

  const handleClose = useCallback(() => {
    reset();
    onClose();
  }, [reset, onClose]);

  const handleImport = useCallback(async () => {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.importRuns(file);
      setResult(res.imported);
      qc.invalidateQueries({ queryKey: qk.runs() });
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  }, [file, qc]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={handleClose}>
      <div
        className="rounded-lg border border-border bg-bg-elevated p-6 shadow-lg w-full max-w-md"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-sm font-semibold mb-4">Import Runs</h2>

        {result ? (
          <div className="flex flex-col gap-2">
            <p className="text-xs text-accent">
              Imported {result.length} run{result.length === 1 ? "" : "s"}:
            </p>
            <div className="flex flex-col gap-1 max-h-48 overflow-y-auto">
              {result.map((r) => (
                <div key={r.new_id} className="text-xs text-fg-muted rounded border border-border-subtle px-2 py-1">
                  <span className="mono">{r.name}</span>
                  <span className="text-fg-subtle ml-2">{r.original_id} → {r.new_id}</span>
                </div>
              ))}
            </div>
            <button type="button" className="btn mt-2 text-xs" onClick={handleClose}>
              Done
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <div
              className="border-2 border-dashed border-border rounded-lg p-6 text-center cursor-pointer hover:border-accent/50 transition-colors"
              onClick={() => fileRef.current?.click()}
              onDragOver={(e) => { e.preventDefault(); e.currentTarget.classList.add("border-accent"); }}
              onDragLeave={(e) => e.currentTarget.classList.remove("border-accent")}
              onDrop={(e) => {
                e.preventDefault();
                e.currentTarget.classList.remove("border-accent");
                const f = e.dataTransfer.files[0];
                if (f) setFile(f);
              }}
            >
              <input
                ref={fileRef}
                type="file"
                accept=".zip"
                className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) setFile(f); }}
              />
              {file ? (
                <p className="text-xs text-fg">{file.name} ({(file.size / 1024).toFixed(0)} KB)</p>
              ) : (
                <p className="text-xs text-fg-muted">Drop a .zip export here, or click to browse</p>
              )}
            </div>

            {error && <p className="text-xs text-status-failed">{error}</p>}

            <div className="flex justify-end gap-2">
              <button type="button" className="btn text-xs" onClick={handleClose} disabled={busy}>
                Cancel
              </button>
              <button
                type="button"
                className="btn text-xs"
                onClick={handleImport}
                disabled={!file || busy}
              >
                {busy ? "Importing..." : "Import"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
