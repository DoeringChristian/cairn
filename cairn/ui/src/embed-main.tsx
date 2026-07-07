/**
 * WS-EMBED entry — renders ONE viewer card standalone in an iframe.
 *
 * This is a SECOND vite entry (alongside main.tsx / index.html), wired into
 * vite.config.ts as a rollup input so `vite build` emits `embed.html`
 * beside `index.html`. It is intentionally minimal: a `QueryClientProvider`
 * plus a single `CardRenderer` — NO App chrome, nav, or router.
 *
 * The card is described by a spec fetched from `/api/embed/specs/:sid`
 * (`?sid=` in the URL). A spec is a viewer `ComparisonCard`
 * (`{type, series:[{runId, name, context_hash}]}`); we render it exactly the
 * way `ReportCardsBlock`'s `ReportCardRenderer` does — by synthesizing a
 * seed `SequenceMeta` from the spec and letting `CardRenderer` fetch the real
 * data. Reusing that precedent means NO fork of the card dispatch and `three`
 * stays lazy.
 *
 * Auto-height: cards take a fixed px height from `CardShell`, so a host that
 * wants to size its iframe to the content needs a signal. We emit the same
 * `{type:"cairn:resize", height, protocolVersion:1}` postMessage the HTML /
 * plugin cards use (see `card-kit/use-iframe-auto-height.ts` for the host
 * side), measuring the rendered card via a `ResizeObserver`.
 *
 * TODO(remote-embed): cross-origin hosts will need a per-sid capability token
 * in the URL + a server `--embed-origins` CORS allowlist, and this file's
 * `postMessage("*")` target should be narrowed to the allowed host origin.
 * Deferred to a later security-reviewed follow-up — LOCAL / SAME-ORIGIN only.
 */

import React, { Component, useEffect, useMemo, useRef, type ReactNode } from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import CardRenderer from "./components/CardRenderer";
import type { SequenceMeta } from "./api/types";
import {
  isMultiRunCardType,
  cardSettingsKeyForScope,
} from "./lib/comparisons";
import type { CardSpec } from "./lib/cards/card-spec";
import { saveCardSettings } from "./lib/card-settings";
import "./index.css";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 2_000,
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

// Synthetic scope id for the embed's per-card settings key (mirrors the
// report scope's use of the report id — see cardSettingsKeyForScope).
const EMBED_SCOPE = "embed";

interface EmbedSpecResponse {
  sid: string;
  spec: CardSpec;
}

/**
 * Error boundary so a card render failure surfaces a readable message inside
 * the iframe instead of a blank page (and still lets the host size to it).
 */
class EmbedErrorBoundary extends Component<
  { children: ReactNode },
  { error: Error | null }
> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    if (this.state.error) {
      return (
        <div data-cairn-card className="card p-4 text-sm text-red-400">
          Embed render error: {this.state.error.message}
        </div>
      );
    }
    return this.props.children;
  }
}

/** Post the current content height to the host so it can size the iframe. */
function useEmitAutoHeight(ref: React.RefObject<HTMLElement | null>) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const post = () => {
      const height = Math.ceil(el.getBoundingClientRect().height);
      if (height > 0) {
        // TODO(remote-embed): narrow "*" to the allowed host origin.
        window.parent.postMessage(
          { type: "cairn:resize", height, protocolVersion: 1 },
          "*",
        );
      }
    };
    const ro = new ResizeObserver(post);
    ro.observe(el);
    post();
    return () => ro.disconnect();
  }, [ref]);
}

/** Render one card from its spec, reusing the ReportCardRenderer precedent. */
function EmbeddedCard({ card }: { card: CardSpec }) {
  // Ensure a stable id for the settings key even if the stored spec omits it.
  //
  // RC2 (WS-MCFIX): seed the card's persisted settings from `spec.settings`
  // HERE — synchronously, inside this useMemo — rather than in a `useEffect`.
  // A card reads its persisted settings synchronously on first render (see
  // `useCardSettings`'s `useRef` initializer in lib/card-settings.ts, which
  // calls `loadCardSettings` before any effect runs), so seeding via an
  // effect would always be one render too late: the child `CardRenderer`
  // below would already have mounted with default settings (mode="normal")
  // by the time the effect fired. A synchronous `useMemo` in the PARENT's
  // render body runs strictly before React renders the child, so the write
  // lands before `CardRenderer`/`useCardSettings` ever reads it — mirrors
  // `restoreReportCardSettings` (lib/reports/payload.ts), which relies on
  // the same before-first-render ordering (there, gated behind `blocks`
  // starting empty until the settings write already happened).
  //
  // Keyed by `cardSettingsKeyForScope(EMBED_SCOPE, ...)` — this embed's OWN
  // scope/localStorage key, never the real app's comparison/report scopes,
  // so this can't leak into or clobber a user's saved comparisons/reports.
  const cardWithId = useMemo<CardSpec>(() => {
    const withId: CardSpec = card.id ? card : { ...card, id: `${EMBED_SCOPE}-card` };
    if (card.settings) {
      saveCardSettings(cardSettingsKeyForScope(EMBED_SCOPE, withId), {
        version: 1,
        ...card.settings,
      });
    }
    return withId;
  }, [card]);

  if (isMultiRunCardType(cardWithId.type)) {
    const runIds = Array.from(new Set(cardWithId.series.map((s) => s.runId)));
    return (
      <CardRenderer
        kind="multi-run"
        cardType={cardWithId.type}
        runIds={runIds}
        settingsKey={cardSettingsKeyForScope(EMBED_SCOPE, cardWithId)}
      />
    );
  }

  const primary = cardWithId.series[0];
  if (!primary) {
    return (
      <div data-cairn-card className="card p-4 text-sm text-fg-muted">
        Empty card spec.
      </div>
    );
  }

  // The synthetic-seed SequenceMeta precedent (ReportCardRenderer): metadata
  // fields are placeholders; CardRenderer fetches the real sequence by
  // (runId, name, context_hash).
  const seedMetric: SequenceMeta = {
    name: primary.name,
    object_type: cardWithId.type,
    context: null,
    context_hash: primary.context_hash,
    min_step: 0,
    max_step: 0,
    count: 0,
  };

  return (
    <CardRenderer
      runId={primary.runId}
      metric={seedMetric}
      extraSeries={cardWithId.series.slice(1)}
      controlledSeries
      settingsKeyOverride={cardSettingsKeyForScope(EMBED_SCOPE, cardWithId)}
    />
  );
}

function EmbedApp() {
  const containerRef = useRef<HTMLDivElement>(null);
  useEmitAutoHeight(containerRef);

  const sid = useMemo(
    () => new URLSearchParams(window.location.search).get("sid"),
    [],
  );

  const query = useQuery({
    queryKey: ["embed-spec", sid],
    enabled: !!sid,
    queryFn: async (): Promise<EmbedSpecResponse> => {
      const res = await fetch(`/api/embed/specs/${sid}`);
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      return (await res.json()) as EmbedSpecResponse;
    },
  });

  let body: React.ReactNode;
  if (!sid) {
    body = <div className="card p-4 text-sm text-fg-muted">Missing ?sid= parameter.</div>;
  } else if (query.isLoading) {
    body = <div className="card p-4 text-sm text-fg-muted">Loading…</div>;
  } else if (query.isError || !query.data) {
    body = <div className="card p-4 text-sm text-red-400">Failed to load embed spec.</div>;
  } else {
    body = (
      <EmbedErrorBoundary>
        <EmbeddedCard card={query.data.spec} />
      </EmbedErrorBoundary>
    );
  }

  // Single-column CSS grid: a card's `gridColumn: span N` (from CardShell)
  // is clamped to the available track count, so one column makes the card
  // full-width regardless of its persisted colSpan.
  return (
    <div
      ref={containerRef}
      className="p-2"
      style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr)" }}
    >
      {body}
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("embed-root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      {/*
       * MemoryRouter (not BrowserRouter): cards reuse viewer components that
       * call react-router hooks deep in the tree (e.g. RunSelectionPanel's
       * useNavigate), which throw without a Router context. The embed shows
       * NO nav/routing — this just satisfies that context in memory so the
       * card renders. In the SPA these hooks get their context from the
       * app's RouterProvider; the embed provides an equivalent here.
       */}
      <MemoryRouter>
        <EmbedApp />
      </MemoryRouter>
    </QueryClientProvider>
  </React.StrictMode>,
);
