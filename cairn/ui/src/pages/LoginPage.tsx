import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { api } from "../api/client";

/**
 * Full-page login screen (deliberately outside <App>'s Outlet — it must
 * render usefully even when every /api/* route except /api/auth/* and
 * /api/health 401s).
 *
 * Two paths in:
 *   1. `/login?otp=...` — the one-time bootstrap link `cairn ui`/`cairn
 *      server` prints on first auth-enabled start. Exchanged immediately
 *      for a session cookie; the otp itself is never written to
 *      localStorage/sessionStorage and the query param is stripped from
 *      the URL bar the moment we're done with it (single-use server-side
 *      too, so a stale bookmark or shoulder-surfed URL doesn't work twice).
 *   2. Manual token paste — the normal path after the bootstrap token (or
 *      a `cairn token create` token) has been copied down.
 *
 * `?return=/some/path` is preserved through both paths so central 401
 * handling (client.ts) can send you back where you were.
 */
export default function LoginPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const otp = params.get("otp");
  const returnTo = params.get("return") || "/";

  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [otpState, setOtpState] = useState<"pending" | "failed" | null>(otp ? "pending" : null);

  useEffect(() => {
    if (!otp) return;
    let cancelled = false;
    // Strip the otp from the URL bar immediately — it's single-use and must
    // never linger in browser history even if the exchange is still async.
    window.history.replaceState(null, "", "/login");
    api
      .loginWithOtp(otp)
      .then(() => {
        if (!cancelled) navigate(returnTo, { replace: true });
      })
      .catch(() => {
        if (!cancelled) setOtpState("failed");
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [otp]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!token.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      await api.login(token.trim());
      navigate(returnTo, { replace: true });
    } catch {
      setError("Invalid or expired token.");
    } finally {
      setBusy(false);
    }
  }

  if (otpState === "pending") {
    return (
      <LoginShell>
        <p className="text-sm text-fg-muted">Signing you in…</p>
      </LoginShell>
    );
  }

  return (
    <LoginShell>
      {otpState === "failed" && (
        <p className="mb-4 rounded border border-status-failed/40 bg-status-failed/10 px-3 py-2 text-sm text-status-failed">
          That login link is invalid or has expired (it's single-use and lasts 15
          minutes). Paste a token below instead.
        </p>
      )}
      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        <label className="text-sm text-fg-muted" htmlFor="cairn-token">
          Auth token
        </label>
        <input
          id="cairn-token"
          className="input"
          type="password"
          autoFocus
          autoComplete="off"
          spellCheck={false}
          placeholder="paste your token here"
          value={token}
          onChange={(e) => setToken(e.target.value)}
        />
        {error && <p className="text-sm text-status-failed">{error}</p>}
        <button type="submit" className="btn justify-center" disabled={busy || !token.trim()}>
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </form>
      <p className="mt-4 text-xs text-fg-subtle">
        No token? Run <code className="kbd">cairn token create --name you --role write</code>{" "}
        on the server host, or <code className="kbd">cairn login --ssh</code> from the CLI.
      </p>
    </LoginShell>
  );
}

function LoginShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-full items-center justify-center px-4">
      <div className="card w-full max-w-sm p-6">
        <div className="mb-6 flex items-center gap-2">
          <Logo />
          <span className="text-lg font-semibold tracking-tight">Cairn</span>
        </div>
        {children}
      </div>
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
