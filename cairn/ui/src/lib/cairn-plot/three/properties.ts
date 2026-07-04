/**
 * Shared named per-element property extraction/resolution for the 3D cards
 * (mesh/pointcloud/boxes3d/volume) — spec-3dx-superseded.md §B. ONE
 * extraction routine + ONE active-property resolver, not four per-card
 * copies (spec-visual-compare.md quality bar #3).
 *
 * SDK layout (see `cairn/sdk/handlers/_properties.py`): an npz member named
 * `values_<name>` per property; OLD artifacts (logged before named
 * properties existed) instead carry a bare `values` member, which is
 * canonicalized here to a single property named "value".
 */

import type { NpyArray } from "../transforms/parse-npy";

export interface PropertyMeta {
  name: string;
  min: number;
  max: number;
  mean: number;
}

export type PropertyMap = Record<string, Float32Array>;

/**
 * Extracts every named property from a parsed npz record: any `values_<name>`
 * member becomes property `<name>`; a legacy bare `values` member becomes
 * property `"value"` (only when no `values_*` members are present — new
 * artifacts never carry both).
 */
export function extractProperties(npz: Record<string, NpyArray>): PropertyMap {
  const out: PropertyMap = {};
  for (const key of Object.keys(npz)) {
    if (key.startsWith("values_")) {
      out[key.slice("values_".length)] = Float32Array.from(npz[key]!.data);
    }
  }
  if (Object.keys(out).length === 0 && npz.values) {
    out.value = Float32Array.from(npz.values.data);
  }
  return out;
}

export function propertyNames(properties: PropertyMap | null | undefined): string[] {
  return properties ? Object.keys(properties) : [];
}

function dataRange(values: Float32Array): [number, number] {
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < values.length; i++) {
    const v = values[i]!;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [0, 1];
  return [min, max];
}

export interface ActiveProperty {
  name: string | null;
  values: Float32Array | null;
  range: [number, number] | null;
}

/**
 * Resolves which property is "active" (the Property selector's current
 * value, falling back to the first available property when unset or when
 * the persisted name no longer exists in this data) plus its render-ready
 * `[min, max]` domain (from metadata's `properties` list when available,
 * else the array's own min/max).
 */
export function resolveActiveProperty(
  properties: PropertyMap | null | undefined,
  active: string | null | undefined,
  propertyMeta: PropertyMeta[] | null | undefined,
): ActiveProperty {
  const names = propertyNames(properties);
  if (names.length === 0) return { name: null, values: null, range: null };
  const name = active && names.includes(active) ? active : names[0]!;
  const values = properties![name]!;
  const meta = propertyMeta?.find((p) => p.name === name);
  const range: [number, number] = meta ? [meta.min, meta.max] : dataRange(values);
  return { name, values, range };
}
