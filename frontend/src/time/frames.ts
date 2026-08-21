export const frameOf = (tMs: number, fps: number): number =>
  Math.round((tMs / 1000) * fps)

/** 目标为帧中点，避免落在帧边界上取到相邻帧 */
export const frameToSeekTime = (frame: number, fps: number): number =>
  (frame + 0.5) / fps

export const stepFrame = (currentS: number, fps: number, dir: 1 | -1, durationS: number): number => {
  const cur = Math.round(currentS * fps - 0.5)
  const next = Math.max(0, cur + dir)
  return Math.min(frameToSeekTime(next, fps), Math.max(0, durationS - 0.5 / fps))
}

/** Rounds a ms position to the nearest frame boundary (multiple of 1000/fps). */
export const frameRound = (ms: number, fps: number): number => {
  const frame = 1000 / fps
  return Math.round(ms / frame) * frame
}

export const clampMs = (ms: number, durationMs: number): number => Math.max(0, Math.min(ms, durationMs))

export const fmtTc = (tMs: number): string => {
  const total = Math.round(tMs)
  const ms = total % 1000
  const s = Math.floor(total / 1000) % 60
  const m = Math.floor(total / 60000)
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(ms).padStart(3, '0')}`
}
