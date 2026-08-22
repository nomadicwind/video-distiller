/**
 * ThumbStrip 像素 → 毫秒换算。stripW<=0（尚未布局/宽度为 0）直接返回 0，
 * 避免除零；px/stripW 的比例 clamp 到 [0,1] 后再乘以 durationMs——命中带外
 * 侧（拖出缩略图带左右边界）时贴边到 0 / durationMs，而不是外推出界。
 * 上游（ThumbStrip 挂载时 video.duration_ms）保证 durationMs >= 0，故不在此
 * 处处理负值。
 */
export function stripPxToMs(px: number, stripW: number, durationMs: number): number {
  if (stripW <= 0) return 0
  const ratio = Math.min(1, Math.max(0, px / stripW))
  return Math.round(ratio * durationMs)
}
