/**
 * Which of a cairn-plot session's cells still need the card's persisted
 * settings seeded into them.
 *
 * A card cannot author session ids — cairn-plot derives them from node identity
 * and prunes anything else — so persisted settings are applied with
 * `plot.patchSettings`, which fans out over the cells that exist *at that
 * moment*. Cells appear over time: the first spec may have no children at all,
 * panes are added when a comparison binding lands, and a run's pane appears when
 * its first artifact arrives. Each of those cells registers with the plot's
 * defaults, so each needs the patch once — and only once, or a later seed would
 * undo settings the user changed in between.
 *
 * Pure and DOM-free so it unit-tests under `node --experimental-strip-types`.
 */
export function nextSeedBatch(
  sessionCellIds: Iterable<string>,
  seeded: ReadonlySet<string>,
): string[] {
  const batch: string[] = [];
  for (const id of sessionCellIds) {
    if (!seeded.has(id)) batch.push(id);
  }
  return batch;
}

/**
 * Forget seeded ids that are no longer in the session. A pruned cell that comes
 * back (its pane reappears) re-registers with the plot's defaults, so it has to
 * be seeded again. Mutates `seeded` and returns it.
 */
export function forgetDepartedCells(
  seeded: Set<string>,
  sessionCellIds: Iterable<string>,
): Set<string> {
  const live = new Set(sessionCellIds);
  for (const id of seeded) {
    if (!live.has(id)) seeded.delete(id);
  }
  return seeded;
}
