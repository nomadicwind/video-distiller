import { Magnet, Maximize2, ZoomIn, ZoomOut } from 'lucide-react'
import { Button } from '../ui/Button'
import type { Viewport } from './layout'

/** 缩放跨度下限（ms）— 与 layout.ts `zoomed()` 的夹取下限保持一致。 */
const MIN_SPAN_MS = 500
/** 缩放滑杆的离散步数（越大越平滑）。 */
const SLIDER_MAX = 1000

/**
 * 跨度(ms) → 滑杆刻度，对数映射（spec §6.1："缩放 −/滑杆/+…span 对数映射"）。
 * 滑杆值越大 = 跨度越窄 = 缩得越入（贴近 ZoomIn 一侧的语义方向）。
 */
function spanToSlider(spanMs: number, durationMs: number): number {
  const maxSpan = Math.max(durationMs, MIN_SPAN_MS + 1)
  const clamped = Math.min(Math.max(spanMs, MIN_SPAN_MS), maxSpan)
  const lo = Math.log(MIN_SPAN_MS)
  const hi = Math.log(maxSpan)
  const t = (Math.log(clamped) - lo) / (hi - lo)
  return Math.round((1 - t) * SLIDER_MAX)
}

function sliderToSpan(value: number, durationMs: number): number {
  const maxSpan = Math.max(durationMs, MIN_SPAN_MS + 1)
  const lo = Math.log(MIN_SPAN_MS)
  const hi = Math.log(maxSpan)
  const t = 1 - value / SLIDER_MAX
  return Math.exp(lo + t * (hi - lo))
}

/** 以 viewport 中点为焦点，把当前跨度替换为 newSpan（夹取到 [0, durationMs]）。 */
function withSpan(v: Viewport, newSpanMs: number, durationMs: number): Viewport {
  const center = (v.startMs + v.endMs) / 2
  const maxSpan = Math.max(durationMs, MIN_SPAN_MS)
  const span = Math.min(Math.max(newSpanMs, MIN_SPAN_MS), maxSpan)
  let start = center - span / 2
  start = Math.max(0, Math.min(start, durationMs - span))
  return { ...v, startMs: Math.round(start), endMs: Math.round(start + span) }
}

export function Toolbar({
  snapOn, onSnap, viewport, durationMs, onViewport,
}: {
  snapOn: boolean
  onSnap: () => void
  viewport: Viewport
  durationMs: number
  onViewport: (v: Viewport) => void
}): JSX.Element {
  const span = viewport.endMs - viewport.startMs
  const sliderValue = spanToSlider(span, durationMs)

  const zoomBy = (factor: number) => onViewport(withSpan(viewport, span * factor, durationMs))
  const fitAll = () => onViewport({ ...viewport, startMs: 0, endMs: Math.max(durationMs, MIN_SPAN_MS) })

  return (
    <div className="tl-toolbar">
      <div className="tl-toolbar-left">
        <Button variant="icon" size="sm" active={snapOn} tip="吸附 (S)" icon={<Magnet />} onClick={onSnap} />
        <span className="tl-toolbar-hint">点击/拖动标尺定位 · 拖动标记吸附对齐 · 点击 Δ 药丸切换 holding</span>
      </div>
      <div className="tl-toolbar-right">
        <Button variant="icon" size="sm" tip="缩小" icon={<ZoomOut />} onClick={() => zoomBy(1.25)} />
        <input
          type="range"
          className="tl-zoom-slider"
          min={0}
          max={SLIDER_MAX}
          value={sliderValue}
          aria-label="缩放"
          onChange={e => onViewport(withSpan(viewport, sliderToSpan(Number(e.target.value), durationMs), durationMs))}
        />
        <Button variant="icon" size="sm" tip="放大" icon={<ZoomIn />} onClick={() => zoomBy(0.8)} />
        <Button variant="icon" size="sm" tip="适配全长" icon={<Maximize2 />} onClick={fitAll} />
      </div>
    </div>
  )
}
