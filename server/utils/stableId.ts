/**
 * DJB2-based stable integer ID — maps an arbitrary text string to a positive
 * 32-bit integer in the range [1, 2_147_483_647].
 *
 * Used to convert text primary keys (e.g. container IDs, jockey IDs) into
 * stable numeric IDs for the planning engine protocol.
 *
 * Single source of truth: import from here instead of duplicating.
 */
export function stableId(text: string): number {
  if (!text) return 0
  let h = 5381
  for (let i = 0; i < text.length; i++) {
    h = (((h << 5) + h) ^ text.charCodeAt(i)) >>> 0
  }
  return (h % 2_147_483_647) + 1
}
