import { useState } from "react";
import { Link, Outlet } from "react-router-dom";
import { useHealth } from "./api/hooks";
import ServerStatus from "./components/ServerStatus";

export default function App() {
  const health = useHealth();
  const [menuOpen, setMenuOpen] = useState(false);
  return (
    <div className="min-h-full flex flex-col">
      <header className="sticky top-0 z-10 border-b border-border bg-bg/80 backdrop-blur">
        <div className="mx-auto flex max-w-[1400px] items-center gap-4 px-4 py-2">
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
          <div className="hidden md:block">
            <ServerStatus health={health.data} loading={health.isLoading} />
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
            <div className="mx-auto flex max-w-[1400px] flex-col gap-2 px-4 py-3">
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
      <main className="mx-auto w-full max-w-[1400px] flex-1 px-4 py-6">
        <Outlet />
      </main>
      <footer className="border-t border-border px-4 py-3 text-center text-xs text-fg-subtle">
        {health.data
          ? `Cairn ${health.data.version} · ${Math.round(health.data.uptime_sec)}s uptime`
          : "Cairn"}
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
