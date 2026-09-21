import { useNavigate } from "react-router-dom";
import { createComparison } from "../lib/comparisons";
import { useProjectId } from "../lib/project-context";
import { shortRunLabel, useRunMetadataVersion } from "../lib/run-label";

interface RunInfo {
  displayName?: string;
  projectId?: string;
}

interface Props {
  selectedRunIds: string[];
  allRunIds: string[];
  onClear: () => void;
  runInfo: Map<string, RunInfo>;
  renderExtra?: (runId: string) => React.ReactNode;
  label?: string;
}

export default function RunSelectionPanel({
  selectedRunIds,
  allRunIds,
  onClear,
  runInfo,
  renderExtra,
  label = "Selection",
}: Props) {
  const projectId = useProjectId();
  const navigate = useNavigate();
  // Re-render when the run metadata cache is seeded — labels are computed
  // inline below and some parents (e.g. ComparePage) don't subscribe.
  useRunMetadataVersion();

  if (selectedRunIds.length === 0) return null;

  return (
    <div className="mt-2 rounded border border-border p-2 text-xs">
      <div className="flex items-center justify-between mb-1">
        <span className="text-fg-muted">
          {selectedRunIds.length} run{selectedRunIds.length !== 1 ? "s" : ""} selected
        </span>
        <div className="flex items-center gap-1">
          {projectId && selectedRunIds.length >= 2 && (
            <button
              type="button"
              className="btn text-xs px-2 py-0.5"
              onClick={() => {
                const cmp = createComparison(
                  projectId,
                  `${label} (${selectedRunIds.length} runs)`,
                  selectedRunIds,
                );
                navigate(`/p/${projectId}/compare?id=${cmp.id}`);
              }}
            >
              <i className="fa-solid fa-code-compare mr-1" />
              Compare
            </button>
          )}
          <button
            type="button"
            className="text-fg-muted hover:text-fg px-1"
            onClick={onClear}
            title="Clear selection"
          >
            <i className="fa-solid fa-xmark" />
          </button>
        </div>
      </div>
      <div className="flex flex-col gap-0.5 max-h-32 overflow-y-auto">
        {selectedRunIds.map((rid) => {
          const info = runInfo.get(rid);
          return (
            <div key={rid} className="flex items-center justify-between gap-2">
              <div className="truncate">
                <span className="font-semibold">
                  {info?.displayName || shortRunLabel(rid, allRunIds)}
                </span>
                <span className="ml-1 text-fg-muted mono">{rid.slice(0, 8)}</span>
                {renderExtra?.(rid)}
              </div>
              {info?.projectId && (
                <a
                  href={`/p/${info.projectId}/r/${rid}`}
                  className="text-fg-muted hover:text-fg shrink-0"
                  title="Open run"
                >
                  <i className="fa-solid fa-arrow-up-right-from-square" />
                </a>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
