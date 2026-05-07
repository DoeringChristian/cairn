/**
 * Layout wrapper for project-level pages. Renders:
 * - Left vertical icon+label nav bar (W&B-style) with Cairn logo at top
 * - Main content (Outlet) filling the rest
 * - Breadcrumb above the content
 */

import { Link, NavLink, Outlet, useParams } from "react-router-dom";
import { ProjectProvider } from "../lib/project-context";
import { shortRunLabel, useRunMetadataVersion } from "../lib/run-label";
import CopyId from "../components/CopyId";


const NAV_ITEMS = [
  {
    path: "",
    end: true,
    label: "Runs",
    icon: (
      <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
        <line x1="3" y1="4" x2="15" y2="4" />
        <line x1="3" y1="9" x2="15" y2="9" />
        <line x1="3" y1="14" x2="15" y2="14" />
      </svg>
    ),
  },
  {
    path: "compare",
    end: false,
    label: "Compare",
    icon: (
      <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="2,14 6,6 10,10 14,3" />
        <polyline points="2,14 6,9 10,12 14,5" />
      </svg>
    ),
  },
];

export default function ProjectLayout() {
  const { projectId, runId } = useParams<{ projectId: string; runId?: string }>();
  useRunMetadataVersion();
  if (!projectId) return null;

  return (
    <ProjectProvider value={projectId}>
      <div className="flex min-h-0">
        {/* Left icon+label nav — desktop */}
        <nav className="hidden md:flex flex-col items-center gap-2 w-16 shrink-0 border-r border-border py-3 fixed top-[41px] left-0 h-[calc(100vh-41px)] overflow-y-auto z-10">
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.path}
              to={`/p/${projectId}${item.path ? `/${item.path}` : ""}`}
              end={item.end}
              className={({ isActive }) =>
                [
                  "flex flex-col items-center gap-0.5 w-14 py-1.5 rounded transition-colors text-center",
                  isActive
                    ? "bg-bg-elevated text-accent"
                    : "text-fg-muted hover:bg-bg-hover hover:text-fg",
                ].join(" ")
              }
            >
              {item.icon}
              <span className="text-[9px] leading-tight">{item.label}</span>
            </NavLink>
          ))}
        </nav>

        {/* Main content */}
        <div className="flex-1 min-w-0 px-4 md:ml-16">
          <nav className="mb-3 flex flex-wrap items-center gap-x-1 text-sm text-fg-muted">
            <Link to="/" className="hover:text-fg">
              Projects
            </Link>
            <span>›</span>
            <Link to={`/p/${projectId}`} className="mono hover:text-fg">
              {projectId}
            </Link>
            {runId && (
              <>
                <span>›</span>
                <span className="mono text-fg">{shortRunLabel(runId)}</span>
                <CopyId id={runId} className="text-[10px]" />
              </>
            )}
          </nav>
          <Outlet />
        </div>
      </div>

      {/* Mobile nav — bottom bar */}
      <nav className="fixed bottom-0 inset-x-0 flex justify-around border-t border-border bg-bg py-2 md:hidden z-10">
        {NAV_ITEMS.map((item) => (
          <NavLink
            key={item.path}
            to={`/p/${projectId}${item.path ? `/${item.path}` : ""}`}
            end={item.end}
            className={({ isActive }) =>
              [
                "flex flex-col items-center gap-0.5 text-[10px] min-w-[44px] min-h-[44px] justify-center",
                isActive ? "text-accent" : "text-fg-muted",
              ].join(" ")
            }
          >
            {item.icon}
            <span>{item.label}</span>
          </NavLink>
        ))}
      </nav>
    </ProjectProvider>
  );
}
