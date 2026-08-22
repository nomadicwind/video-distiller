/**
 * Compare-mode follow engine (M12 任务 2) — pure functions only, no DOM/store
 * access. B (对比视频) is always driven off A's playhead via a single offset;
 * Task 3's Player/monitor code calls these on every A playhead update to
 * compute where B should be and whether it needs a hard resync.
 *
 * 偏移语义唯一（global-constraints §偏移语义唯一）: `tB = tA + offset_ms`.
 * All three functions here mirror that one contract.
 */

/**
 * Derives `offset_ms` from two frames the user has aligned by eye during
 * calibration: `offset = round(tB - tA)`. This is the one place that turns
 * "A is here, B is here" into the persisted offset — saveCompare (actions.ts)
 * calls it right before PATCHing `/api/analyses/{id}/compare`.
 */
export function computeOffset(tAMs: number, tBMs: number): number {
  return Math.round(tBMs - tAMs)
}

export interface FollowTarget {
  /** Where B's `currentTime` should be. Clamped into `[0, durBMs]` even when
   * `inRange` is false — callers use this to park B at the boundary frame
   * while the "超出对比视频范围" mask is shown, never to make it look synced. */
  tBMs: number
  /** Whether the unclamped `tA + offsetMs` actually falls inside B's
   * duration. False means B is out of range and should show the mask
   * instead of playing/seeking to `tBMs`. */
  inRange: boolean
}

/**
 * `tB = tA + offset`; `inRange` is `0 <= tB <= durB`. Out-of-range results
 * still carry a clamped `tBMs` (see FollowTarget) — global-constraints
 * §偏移语义唯一 requires B to pause under a mask when out of range, not to be
 * clamp-seeked and displayed as if it were synced, so callers must gate any
 * seek/mask decision on `inRange`, not merely use `tBMs` directly.
 */
export function followTarget(tAMs: number, offsetMs: number, durBMs: number): FollowTarget {
  const tB = tAMs + offsetMs
  const inRange = tB >= 0 && tB <= durBMs
  const tBMs = Math.min(Math.max(tB, 0), durBMs)
  return { tBMs, inRange }
}

export type ResyncDecision = 'resync' | 'none'

/** Drift beyond which a playing B is hard-seeked back onto A's expected
 * position (global-constraints §漂移纠正). Exactly at the threshold is still
 * `'none'` — only a *strict* excess resyncs. */
const DRIFT_THRESHOLD_MS = 80

/**
 * Drift-correction judgment, evaluated on every main-playhead update while
 * playing: `expectedMs` is `tA + offset` (see followTarget), `actualMs` is
 * B's current `currentTime`. Only a playing B resyncs here — a paused B is
 * seeked directly and exactly by the caller, which is why `playing=false`
 * always returns `'none'` regardless of how large the drift is.
 */
export function decideResync(expectedMs: number, actualMs: number, playing: boolean): ResyncDecision {
  if (!playing) return 'none'
  return Math.abs(expectedMs - actualMs) > DRIFT_THRESHOLD_MS ? 'resync' : 'none'
}
