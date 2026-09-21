import Select from "../settings/Select";

export interface PropertySelectorProps {
  /** Names of every property present on the CURRENT data (from
   *  `lib/cairn-plot/three/properties.ts`'s `propertyNames`/`extractProperties`). */
  properties: string[];
  value: string | null;
  onChange: (name: string) => void;
  label?: string;
}

/**
 * ONE shared "Property" selector for all four 3D card types (mesh/
 * pointcloud/boxes3d/volume) — spec-3dx-superseded.md §B: "cards gain a
 * Property selector (shown when >1 property)". Renders nothing when there's
 * zero or one property, matching every card's existing "only show controls
 * that matter" convention.
 */
export function PropertySelector({ properties, value, onChange, label = "Property" }: PropertySelectorProps) {
  if (properties.length <= 1) return null;
  const current = value && properties.includes(value) ? value : properties[0]!;
  return (
    <Select
      label={label}
      value={current}
      onChange={onChange}
      options={properties.map((p) => ({ value: p, label: p }))}
      description="Drives value coloring + the Colorbar's range"
    />
  );
}

export default PropertySelector;
