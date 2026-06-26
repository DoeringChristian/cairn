export type ParetoDirection = "min-min" | "min-max" | "max-min" | "max-max";

/**
 * Compute the Pareto-optimal front of a set of 2D points.
 * `direction` specifies the optimization goal for each axis.
 */
export function computeParetoFront<T extends { x: number; y: number }>(
  points: T[],
  direction: ParetoDirection,
): T[] {
  if (points.length === 0) return [];
  const minX = direction.startsWith("min");
  const minY = direction.endsWith("min");

  const sorted = [...points].sort((a, b) => {
    const cmp = minX ? a.x - b.x : b.x - a.x;
    return cmp !== 0 ? cmp : (minY ? a.y - b.y : b.y - a.y);
  });

  const front: T[] = [];
  let bestY = minY ? Infinity : -Infinity;
  for (const pt of sorted) {
    const dominated = minY ? pt.y > bestY : pt.y < bestY;
    if (!dominated) {
      front.push(pt);
      bestY = pt.y;
    }
  }
  return front;
}
