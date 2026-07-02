/**
 * Fields shared by every card's persisted settings interface.
 *
 * Each card type (Scalar, Image, Figure, ...) declares its own settings
 * interface extending this one, adding card-specific fields. See
 * `src/lib/card-settings.ts` for the persistence machinery (useCardSettings,
 * resolveCardHeight) — that module keeps its own structural types to avoid
 * an import cycle (card-kit imports from lib, not vice versa).
 */
export interface BaseCardSettings {
  version: 1;
  title?: string;
  collapsed?: boolean;
  height?: number; // legacy — resolveCardHeight fallback
  height1?: number; // legacy
  height2?: number; // legacy
  heights?: Record<number, number>;
  colSpan?: number;
}
