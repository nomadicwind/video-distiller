/**
 * Client-side mirror of the server's min-gap check (backend/src/vd/store.py
 * `_check_min_gap`, M9 task 1): two marks in the same take within one frame
 * length of each other (`ABS(diff) < frameMs`) are treated as a conflict —
 * `diff === frameMs` is legal, matching the server's `<` (not `<=`).
 *
 * Pure and DOM/store-free so it's usable both as a precheck before POST/PATCH
 * (actions.ts) and in isolation here. `excludeId` lets a moved mark ignore
 * its own prior position (or, on the server side, the mark being updated)
 * when checking neighbors — same shape as the server's `exclude_id`.
 */
export function violatesMinGap(
  tMs: number,
  marks: { id: string; t_ms: number }[],
  frameMs: number,
  excludeId?: string,
): boolean {
  return marks.some(m => m.id !== excludeId && Math.abs(m.t_ms - tMs) < frameMs)
}
