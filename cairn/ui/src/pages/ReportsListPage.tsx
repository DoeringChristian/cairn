/**
 * Reports list page — /p/:projectId/reports
 *
 * Create/rename/delete reports; click through to the editor/viewer; apply a
 * saved report template to a picked run set (mirrors ComparePage's
 * TemplateSidebar "New from template" picker).
 */

import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  RUN_SELECTOR_FETCH_LIMIT,
  useCreateReport,
  useDeleteReport,
  useReports,
  useRuns,
  useUpdateReport,
} from "../api/hooks";
import { formatRelative } from "../lib/format";
import { disambiguateRunLabels, useRunMetadataVersion } from "../lib/run-label";
import {
  applyReportTemplateToRuns,
  deleteReportTemplate,
  useReportTemplates,
  type ApplyReportTemplateResult,
  type ReportTemplate,
} from "../lib/reports";

const PAGE_SIZE = 50;

export default function ReportsListPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const [offset, setOffset] = useState(0);
  const [applyBanner, setApplyBanner] = useState<string | null>(null);
  // B9 fix: surface create/delete failures (previously silent) and track
  // which row is mid-delete so its button can show pending state.
  const [actionError, setActionError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const q = useReports(projectId ?? "", { limit: PAGE_SIZE, offset });
  const createMut = useCreateReport(projectId ?? "");
  const deleteMut = useDeleteReport(projectId ?? "");
  // B10 fix: match RUN_SELECTOR_FETCH_LIMIT — see ReportEditorPage's same fix
  // for why this must match the pool a `RunSelector` query resolves against.
  const runsQ = useRuns({ project: projectId, limit: RUN_SELECTOR_FETCH_LIMIT });
  const allRuns = runsQ.data?.runs ?? [];

  if (!projectId) return null;

  const reports = q.data?.reports ?? [];
  const total = q.data?.total ?? 0;

  const handleCreate = () => {
    const name = prompt("Report name:", "Untitled report");
    if (name == null) return;
    const trimmed = name.trim() || "Untitled report";
    setActionError(null);
    createMut.mutate(
      { name: trimmed, payload: { blocks: [] } },
      {
        onSuccess: (res) => navigate(`/p/${projectId}/reports/${res.id}`),
        onError: () => setActionError(`Failed to create "${trimmed}". Please try again.`),
      },
    );
  };

  const handleDelete = (id: string, name: string) => {
    if (!confirm(`Delete "${name}"? This cannot be undone.`)) return;
    setActionError(null);
    setDeletingId(id);
    // B9 fix (pagination strand): deleting the last remaining report on a
    // page beyond the first would otherwise leave `offset` pointing past
    // the new end of the list — nothing renders, and the Prev/Next controls
    // can vanish too (once total <= PAGE_SIZE), stranding the user with no
    // way back to page 1. Step back a page when this delete empties the
    // current one.
    const isLastOnPage = reports.length === 1 && offset > 0;
    deleteMut.mutate(id, {
      onSuccess: () => {
        setDeletingId(null);
        if (isLastOnPage) setOffset((o) => Math.max(0, o - PAGE_SIZE));
      },
      onError: () => {
        setDeletingId(null);
        setActionError(`Failed to delete "${name}". Please try again.`);
      },
    });
  };

  const handleApplied = (result: ApplyReportTemplateResult, templateName: string) => {
    if (!result.reportId) {
      setApplyBanner(`"${templateName}" has no cards matching the selected run(s) — no report created.`);
      return;
    }
    const feedback =
      result.matchedCount === result.totalCount
        ? `Applied "${templateName}" — all ${result.totalCount} card(s) restored.`
        : `Applied "${templateName}" — restored ${result.matchedCount} of ${result.totalCount} card(s).`;
    navigate(`/p/${projectId}/reports/${result.reportId}`, { state: { templateApplyFeedback: feedback } });
  };

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-baseline justify-between gap-4">
        <h1 className="mono text-xl font-semibold">{projectId} / reports</h1>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleCreate}
            disabled={createMut.isPending}
            className="btn text-xs disabled:opacity-60"
          >
            {createMut.isPending ? "Creating…" : "+ New report"}
          </button>
        </div>
      </div>

      {applyBanner && (
        <div className="mb-4 flex items-center justify-between gap-2 rounded border border-accent/40 bg-accent/10 px-3 py-2 text-xs text-fg">
          <span>{applyBanner}</span>
          <button
            type="button"
            onClick={() => setApplyBanner(null)}
            className="shrink-0 text-fg-subtle hover:text-fg"
            aria-label="Dismiss"
          >
            {"×"}
          </button>
        </div>
      )}

      {actionError && (
        <div className="mb-4 flex items-center justify-between gap-2 rounded border border-status-failed/40 bg-status-failed/10 px-3 py-2 text-xs text-status-failed">
          <span>{actionError}</span>
          <button
            type="button"
            onClick={() => setActionError(null)}
            className="shrink-0 text-status-failed/70 hover:text-status-failed"
            aria-label="Dismiss"
          >
            {"×"}
          </button>
        </div>
      )}

      <TemplatePanel projectId={projectId} allRuns={allRuns} onApplied={handleApplied} />

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
              deleting={deletingId === r.id}
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
  deleting,
  onDelete,
}: {
  projectId: string;
  report: ReportSummary;
  deleting: boolean;
  onDelete: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(report.name);
  const [renameError, setRenameError] = useState<string | null>(null);
  const updateMut = useUpdateReport(projectId, report.id);

  useEffect(() => {
    if (!editing) setDraft(report.name);
  }, [report.name, editing]);

  // B9 fix: don't optimistically exit edit mode before the rename actually
  // lands — stay in edit mode (with pending/error feedback) until it does,
  // instead of silently reverting to the pre-edit name on failure with no
  // indication anything went wrong.
  const commit = () => {
    const trimmed = draft.trim();
    if (!trimmed || trimmed === report.name) {
      setEditing(false);
      return;
    }
    setRenameError(null);
    updateMut.mutate(
      { name: trimmed },
      {
        onSuccess: () => setEditing(false),
        onError: () => setRenameError("Rename failed — try again or press Esc to cancel."),
      },
    );
  };

  return (
    <div className="group flex items-center gap-2 px-3 py-2.5 text-sm">
      {editing ? (
        <div className="min-w-0 flex-1">
          <input
            autoFocus
            type="text"
            value={draft}
            disabled={updateMut.isPending}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                commit();
              } else if (e.key === "Escape") {
                e.preventDefault();
                setEditing(false);
                setRenameError(null);
                setDraft(report.name);
              }
            }}
            className="input w-full text-sm disabled:opacity-60"
          />
          {renameError && <p className="mt-0.5 text-xs text-status-failed">{renameError}</p>}
        </div>
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
      {/* Always visible (not hover-only) — RC follow-up fix: a hover-only
          affordance is undiscoverable on touch devices. */}
      <button
        type="button"
        onClick={() => setEditing(true)}
        disabled={deleting}
        className="shrink-0 text-xs text-fg-subtle hover:text-fg disabled:opacity-40"
        title="Rename"
      >
        rename
      </button>
      <button
        type="button"
        onClick={onDelete}
        disabled={deleting}
        className="shrink-0 text-xs text-fg-subtle hover:text-status-failed disabled:opacity-40"
        title="Delete"
      >
        {deleting ? "deleting…" : "delete"}
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Template panel — list saved report templates; apply one to a picked run set.
// ---------------------------------------------------------------------------

interface TemplatePanelProps {
  projectId: string;
  allRuns: Array<{ id: string; display_name: string | null }>;
  onApplied: (result: ApplyReportTemplateResult, templateName: string) => void;
}

function TemplatePanel({ projectId, allRuns, onApplied }: TemplatePanelProps) {
  const { templates, refresh } = useReportTemplates(projectId);
  const [pendingTemplate, setPendingTemplate] = useState<ReportTemplate | null>(null);
  const [pickedRunIds, setPickedRunIds] = useState<Set<string>>(new Set());
  const [applyingId, setApplyingId] = useState<string | null>(null);
  const metaVersion = useRunMetadataVersion();
  const runIds = useMemo(() => allRuns.map((r) => r.id), [allRuns]);
  const runLabels = useMemo(() => disambiguateRunLabels(runIds), [runIds, metaVersion]);

  if (templates.length === 0) return null;

  const applyWithRuns = async (t: ReportTemplate, runIds: string[]) => {
    if (runIds.length === 0) return;
    setApplyingId(t.id);
    try {
      const result = await applyReportTemplateToRuns(projectId, t, runIds);
      onApplied(result, t.name);
      setPendingTemplate(null);
      setPickedRunIds(new Set());
    } finally {
      setApplyingId(null);
    }
  };

  return (
    <div className="mb-6 card p-3">
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-fg-muted">
        Report templates
      </h2>
      <ul className="flex flex-col gap-1">
        {templates.map((t) => (
          <li
            key={t.id}
            className="flex items-center justify-between rounded px-2 py-1.5 text-xs text-fg-muted hover:bg-bg-hover"
          >
            <div className="min-w-0">
              <div className="truncate">{t.name}</div>
              <div className="text-[10px] text-fg-subtle">{t.cards.length} card(s)</div>
            </div>
            <div className="ml-2 flex shrink-0 items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  setPendingTemplate(t);
                  setPickedRunIds(new Set());
                }}
                disabled={applyingId === t.id}
                className="text-[10px] text-accent hover:underline disabled:opacity-50"
                title="New report from template — pick runs"
              >
                {applyingId === t.id ? "Applying…" : "New from template"}
              </button>
              <button
                type="button"
                onClick={() => {
                  deleteReportTemplate(projectId, t.id);
                  refresh();
                }}
                className="text-[10px] text-fg-subtle hover:text-status-failed"
                title="Delete template"
              >
                {"×"}
              </button>
            </div>
          </li>
        ))}
      </ul>

      {pendingTemplate && (
        <div className="mt-2 rounded border border-border p-2">
          <div className="mb-1 flex items-center justify-between gap-2">
            <span className="truncate text-[10px] font-medium text-fg-muted">
              Pick runs for "{pendingTemplate.name}"
            </span>
            <button
              type="button"
              onClick={() => setPendingTemplate(null)}
              className="shrink-0 text-[10px] text-fg-subtle hover:text-fg"
            >
              Cancel
            </button>
          </div>
          {allRuns.length === 0 ? (
            <p className="text-[10px] text-fg-subtle">No runs in this project yet.</p>
          ) : (
            <ul className="flex max-h-40 flex-col gap-0.5 overflow-y-auto">
              {allRuns.map((r) => {
                const label = runLabels[r.id] ?? r.id;
                return (
                  <li key={r.id}>
                    <label className="flex cursor-pointer items-center gap-1.5 text-[10px] text-fg-muted hover:text-fg">
                      <input
                        type="checkbox"
                        checked={pickedRunIds.has(r.id)}
                        onChange={() => {
                          setPickedRunIds((prev) => {
                            const next = new Set(prev);
                            if (next.has(r.id)) next.delete(r.id);
                            else next.add(r.id);
                            return next;
                          });
                        }}
                      />
                      <span className="truncate">{label}</span>
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
          <button
            type="button"
            onClick={() => void applyWithRuns(pendingTemplate, Array.from(pickedRunIds))}
            disabled={pickedRunIds.size === 0 || applyingId === pendingTemplate.id}
            className="btn mt-2 w-full text-[10px] disabled:opacity-50"
          >
            {applyingId === pendingTemplate.id
              ? "Applying…"
              : `Apply to ${pickedRunIds.size} run${pickedRunIds.size === 1 ? "" : "s"}`}
          </button>
        </div>
      )}
    </div>
  );
}
