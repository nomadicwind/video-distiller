/**
 * 时间轴面板高度 clamp（M11 分割条）：min 固定 180px；max = viewportH - 320
 * （给监视器/传送带/缩略图带留至少 320px），当 viewportH 极小导致
 * viewportH-320 < min 时取 min（而不是让 max < min 产生反直觉的空区间）。
 * px 先取整再 clamp，保证返回值总是整数像素。
 */
export function clampTlHeight(px: number, viewportH: number): number {
  const min = 180
  const max = Math.max(min, viewportH - 320)
  return Math.min(max, Math.max(min, Math.round(px)))
}
