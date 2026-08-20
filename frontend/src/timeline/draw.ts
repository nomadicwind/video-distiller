import type { Aggregate, Lane, Tally } from '../api/types'
import { fmtTc } from '../time/frames'
import {
  checkboxRect, intervals, LANE_H, msToPx, TOP_H, type Viewport,
} from './layout'

export interface TimelineData {
  lanes: Lane[]
  currentLaneId: string | null
  currentTakeId: string | null
  selectedMarkId: string | null
  playheadMs: number
  tally: Tally[]
  aggregate: Aggregate | null
  viewport: Viewport
}

export function timelineHeight(laneCount: number): number {
  return TOP_H + laneCount * LANE_H
}

export function draw(ctx: CanvasRenderingContext2D, d: TimelineData): void {
  const v = d.viewport
  ctx.clearRect(0, 0, v.widthPx, timelineHeight(d.lanes.length))
  ctx.font = '11px system-ui'

  // 打表 marker：顶部黄色小三角
  ctx.fillStyle = '#e6b800'
  for (const t of d.tally) {
    const x = msToPx(v, t.t_ms)
    ctx.beginPath(); ctx.moveTo(x - 4, 0); ctx.lineTo(x + 4, 0); ctx.lineTo(x, 8); ctx.fill()
  }

  d.lanes.forEach((lane, i) => {
    const laneY = TOP_H + i * LANE_H
    const midY = laneY + LANE_H / 2
    ctx.strokeStyle = '#333'
    ctx.strokeRect(0, laneY, v.widthPx, LANE_H)
    ctx.fillStyle = lane.id === d.currentLaneId ? '#9cf' : '#777'
    ctx.fillText(lane.layer, 4, laneY + 12)

    const current = lane.takes.find(t => t.id === d.currentTakeId)

    // 其余 Take：幽灵刻度（泳道底部灰色细线）
    ctx.fillStyle = 'rgba(150,150,150,0.35)'
    for (const take of lane.takes) {
      if (take.id === d.currentTakeId) continue
      for (const m of take.marks) ctx.fillRect(msToPx(v, m.t_ms) - 1, laneY + LANE_H - 10, 2, 8)
    }

    if (current) {
      // 区间：Δms 常驻显示 + holding 勾选框（spec §6.3/§6.5）
      for (const iv of intervals(current.marks)) {
        const x1 = msToPx(v, iv.startMs)
        const x2 = msToPx(v, iv.endMs)
        const mx = msToPx(v, iv.midMs)
        if (iv.holding) {
          ctx.fillStyle = 'rgba(80,160,255,0.35)'
          ctx.fillRect(x1, midY - 8, x2 - x1, 16)
        }
        ctx.fillStyle = '#aaa'
        ctx.fillText(`${iv.deltaMs}ms`, mx - 14, midY - 14)
        const r = checkboxRect(iv.midMs, v, laneY)
        ctx.strokeStyle = iv.holding ? '#5af' : '#666'
        ctx.strokeRect(r.x, r.y, r.w, r.h)
        if (iv.holding) { ctx.fillStyle = '#5af'; ctx.fillRect(r.x + 2, r.y + 2, r.w - 4, r.h - 4) }
      }
      // 标记：input 圆点+标签；release（空标记）灰点
      for (const m of current.marks) {
        const x = msToPx(v, m.t_ms)
        const sel = m.id === d.selectedMarkId
        ctx.fillStyle = m.kind === 'release' ? '#888' : sel ? '#ffd54a' : '#6cf'
        ctx.beginPath(); ctx.arc(x, midY, sel ? 6 : 4, 0, Math.PI * 2); ctx.fill()
        if (m.label) { ctx.fillStyle = '#ddd'; ctx.fillText(m.label, x + 6, midY + 4) }
      }
    }

    // 聚合叠加（任务 22 传入 aggregate 后生效）：IQR 带 + 少数派橙标
    if (d.aggregate && lane.id === d.currentLaneId) {
      for (const am of d.aggregate.aggregated) {
        const x1 = msToPx(v, am.t_ms - am.iqr_ms)
        const x2 = msToPx(v, am.t_ms + am.iqr_ms)
        ctx.fillStyle = 'rgba(120,220,120,0.5)'
        ctx.fillRect(x1, laneY + LANE_H - 6, Math.max(2, x2 - x1), 4)
      }
      for (const am of d.aggregate.minority) {
        ctx.fillStyle = 'rgba(255,140,0,0.9)'
        ctx.fillRect(msToPx(v, am.t_ms) - 2, laneY + LANE_H - 8, 4, 8)
      }
    }
  })

  // 播放头
  ctx.strokeStyle = 'red'
  const px = msToPx(v, d.playheadMs)
  ctx.beginPath(); ctx.moveTo(px, 0); ctx.lineTo(px, timelineHeight(d.lanes.length)); ctx.stroke()

  // 视口起止时码
  ctx.fillStyle = '#888'
  ctx.fillText(fmtTc(v.startMs), 2, TOP_H - 4)
  ctx.fillText(fmtTc(v.endMs), v.widthPx - 70, TOP_H - 4)
}
