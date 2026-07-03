/**
 * Reports list page — /p/:projectId/reports
 *
 * Create/rename/delete reports; click through to the editor/viewer.
 */

import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useCreateReport, useDeleteReport, useReports, useUpdateReport } from "../api/hooks";
import { formatRelative } from "../lib/format";

const PAGE_SIZE = 50;

export default function ReportsListPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const [offset, setOffset] = useState(0);

  const q = useReports(projectId ?? "", { limit: PAGE_SIZE, offset });
  const createMut = useCreateReport(projectId ?? "");
  const deleteMut = useDeleteReport(projectId ?? "");

  if (!projectId) return null;

  const reports = q.data?.reports ?? [];
  const total = q.data?.total ?? 0;

  const handleCreate = () => {
    const name = prompt("Report name:", "Untitled report");
    if (name == null) return;
    const trimmed = name.trim() || "Untitled report";
    createMut.mutate(
      { name: trimmed, payload: { blocks: [] } },
      { onSuccess: (res) => navigate(`/p/${projectId}/reports/${res.id}`) },
    );
  };

  const handleDelete = (id: string, name: string) => {
    if (!confirm(`Delete "${name}"? This cannot be undone.`)) return;
    deleteMut.mutate(id);
  };

  return (
    <div>
      <div className="mb-6 flex items-baseline justify-between gap-4">
        <h1 className="mono text-xl font-semibold">{projectId} / reports</h1>
        <button
          type="button"
          onClick={handleCreate}
          disabled={createMut.isPending}
          className="btn text-xs"
        >
          + New report
        </button>
      </div>

      {q.isLoading ? (
        <p className="text-fg-muted">Loading...</p>
      ) : q.isError ? (
        <p className="text-status-failed">Error: {String(q.error)}</p>
      ) : reports.length === 0 ? (
        <div className="card p-6 text-sm text-fg-muted">
          <p className="mb-2 text-fg">No reports yet.</p>
          <p>
            <button type="button" className="text-accent hover:underline" onClick={handleCreate}>
              Create one
            </button>{" "}
            to start writing up findings alongside live cards.
          </p>
        </div>
      ) : (
        <div className="card divide-y divide-border-subtle">
          {reports.map((r) => (
            <ReportRow
              key={r.id}
              projectId={projectId}
              report={r}
              onDelete={() => handleDelete(r.id, r.name)}
            />
          ))}
        </div>
      )}

      {total > PAGE_SIZE && (
        <div className="mt-3 flex items-center justify-between text-xs text-fg-muted">
          <button
            type="button"
            disabled={offset === 0}
            onClick={() => setOffset((o) => Math.max(0, o - PAGE_SIZE))}
            className="btn text-xs disabled:opacity-40"
          >
            Prev
          </button>
          <span>
            {offset + 1}–{Math.min(offset + PAGE_SIZE, total)} of {total}
          </span>
          <button
            type="button"
            disabled={offset + PAGE_SIZE >= total}
            onClick={() => setOffset((o) => o + PAGE_SIZE)}
            className="btn text-xs disabled:opacity-40"
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}

interface ReportSummary {
  id: string;
  name: string;
  updated_at: string;
  block_count: number;
}

function ReportRow({
  projectId,
  report,
  onDelete,
}: {
  projectId: string;
  report: ReportSummary;
  onDelete: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(report.name);
  const updateMut = useUpdateReport(projectId, report.id);

  useEffect(() => {
    if (!editing) setDraft(report.name);
  }, [report.name, editing]);

  const commit = () => {
    const trimmed = draft.trim();
    if (trimmed && trimmed !== report.name) updateMut.mutate({ name: trimmed });
    setEditing(false);
  };

  return (
    <div className="group flex items-center gap-2 px-3 py-2.5 text-sm">
      {editing ? (
        <input
          autoFocus
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commit();
            } else if (e.key === "Escape") {
              e.preventDefault();
              setEditing(false);
              setDraft(report.name);
            }
          }}
          className="input flex-1 text-sm"
        />
      ) : (
        <Link
          to={`/p/${projectId}/reports/${report.id}`}
          className="min-w-0 flex-1 hover:bg-bg-hover -mx-1 px-1 rounded"
        >
          <div className="truncate font-medium text-fg">{report.name}</div>
          <div className="text-xs text-fg-subtle">
            {report.block_count} block{report.block_count === 1 ? "" : "s"} · updated{" "}
            {formatRelative(report.updated_at)}
          </div>
        </Link>
      )}
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="shrink-0 text-xs text-fg-subtle opacity-0 group-hover:opacity-100 hover:text-fg transition-opacity"
        title="Rename"
      >
        rename
      </button>
      <button
        type="button"
        onClick={onDelete}
        className="shrink-0 text-xs text-fg-subtle opacity-0 group-hover:opacity-100 hover:text-status-failed transition-opacity"
        title="Delete"
      >
        delete
      </button>
    </div>
  );
}
