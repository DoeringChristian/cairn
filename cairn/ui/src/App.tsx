import { useState } from "react";
import { Link, Outlet, useNavigate } from "react-router-dom";
import { useHealth, useSession } from "./api/hooks";
import { api } from "./api/client";
import ServerStatus from "./components/ServerStatus";
import { getRenderMode, setRenderMode, type RenderMode } from "./lib/cairn-plot";
import { getStreamMode, setStreamMode, type StreamMode } from "./lib/stream-mode";

export default function App() {
  const health = useHealth();
  const session = useSession();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);

  async function handleLogout() {
    try {
      await api.logout();
    } finally {
      navigate("/login", { replace: true });
    }
  }
  return (
    <div className="min-h-full flex flex-col">
      <header className="sticky top-0 z-10 border-b border-border bg-bg/80 backdrop-blur">
        <div className="mx-auto flex w-full items-center gap-4 px-4 py-2">
          <Link
            to="/"
            className="flex items-center gap-2"
            onClick={() => setMenuOpen(false)}
          >
            <Logo />
            <span className="font-semibold tracking-tight">Cairn</span>
          </Link>
          <nav className="hidden flex-1 md:block">
            <Link
              to="/"
              className="text-sm text-fg-muted transition-colors hover:text-fg"
            >
              Projects
            </Link>
          </nav>
          <div className="hidden md:flex items-center gap-2">
            <ServerStatus health={health.data} loading={health.isLoading} />
            <select
              value={getRenderMode()}
              onChange={(e) => { setRenderMode(e.target.value as RenderMode); window.location.reload(); }}
              className="rounded border border-border bg-bg px-1.5 py-0.5 text-[10px] text-fg-muted"
              title="Image diff render mode"
            >
              <option value="auto">Auto</option>
              <option value="gpu">GPU</option>
              <option value="cpu">CPU</option>
            </select>
            <select
              value={getStreamMode()}
              onChange={(e) => { setStreamMode(e.target.value as StreamMode); window.location.reload(); }}
              className="rounded border border-border bg-bg px-1.5 py-0.5 text-[10px] text-fg-muted"
              title="Server plugin streaming mode"
            >
              <option value="auto">Stream: Auto</option>
              <option value="webrtc">Stream: WebRTC</option>
              <option value="jpeg">Stream: JPEG</option>
            </select>
          </div>
          <button
            type="button"
            aria-label={menuOpen ? "close menu" : "open menu"}
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((v) => !v)}
            className="ml-auto inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded border border-border text-fg-muted hover:text-fg md:hidden"
          >
            <HamburgerIcon />
          </button>
        </div>
        {menuOpen && (
          <div className="border-t border-border bg-bg md:hidden">
            <div className="mx-auto flex w-full flex-col gap-2 px-4 py-3">
              <Link
                to="/"
                onClick={() => setMenuOpen(false)}
                className="flex min-h-[44px] items-center text-sm text-fg-muted transition-colors hover:text-fg"
              >
                Projects
              </Link>
              <ServerStatus health={health.data} loading={health.isLoading} />
            </div>
          </div>
        )}
      </header>
      <main className="mx-auto w-full w-full flex-1 px-4 py-6">
        <Outlet />
      </main>
      <footer className="flex items-center justify-center gap-2 border-t border-border px-4 py-3 text-center text-xs text-fg-subtle">
        <span>
          {health.data
            ? `Cairn ${health.data.version} · ${Math.round(health.data.uptime_sec)}s uptime`
            : "Cairn"}
        </span>
        {session.data?.auth_enabled && session.data.authenticated && (
          <>
            <span aria-hidden>·</span>
            <span>
              {session.data.name} ({session.data.role})
            </span>
            <button
              type="button"
              onClick={handleLogout}
              className="text-fg-subtle underline decoration-dotted hover:text-fg-muted"
            >
              Log out
            </button>
          </>
        )}
      </footer>
    </div>
  );
}

function Logo() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect width="24" height="24" rx="5" fill="#539bf5" />
      <path
        d="M6 17h12M7.5 13h9M9 9h6M10.5 5.5h3"
        stroke="#ffffff"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

function HamburgerIcon() {
  return (
    <svg
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden
    >
      <line x1="4" y1="7" x2="20" y2="7" />
      <line x1="4" y1="12" x2="20" y2="12" />
      <line x1="4" y1="17" x2="20" y2="17" />
    </svg>
  );
}
