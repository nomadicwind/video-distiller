import type { Aggregate, Lane, Mark, Tally } from '../api/types'
import { fmtTc } from '../time/frames'
import { tlTheme, withAlpha, type TlTheme } from './theme'
import {
  GUTTER_W, intervals, LANE_H, msToPx, niceTickInterval, pillRect, RULER_H,
  type Viewport,
} from './layout'

export interface DragPreview { markId: string; tMs: number }

export interface TimelineData {
  lanes: Lane[]
  currentLaneId: string | null
  currentTakeId: string | null
  selectedMarkId: string | null
  playheadMs: number
  tally: Tally[]
  aggregate: Aggregate | null
  viewport: Viewport
  /** 悬停光标时码（幽灵竖线 + 标尺气泡），无悬停时为 null */
  hoverMs: number | null
  /** 标记拖动实时预览：目标标记在其原位置以外的 ms 位置 */
  dragPreview: DragPreview | null
  /** 吸附开关（预留：影响未来吸附相关的视觉提示） */
  snapOn: boolean
}

export function timelineHeight(laneCount: number): number {
  return RULER_H + laneCount * LANE_H
}

const LANE_SUBTITLE: Record<Lane['layer'], string> = { L0: '操作', L1: '技能', L2: '连招' }

/** Half-pixel snap so a 1px stroke lands on a physical pixel, not a blurred straddle. */
const hair = (n: number): number => Math.round(n) + 0.5

function roundRectPath(
  ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number,
): void {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2))
  ctx.beginPath()
  ctx.moveTo(x + rr, y)
  ctx.arcTo(x + w, y, x + w, y + h, rr)
  ctx.arcTo(x + w, y + h, x, y + h, rr)
  ctx.arcTo(x, y + h, x, y, rr)
  ctx.arcTo(x, y, x + w, y, rr)
  ctx.closePath()
}

/** Small vector padlock glyph — prefixes the Δ 药丸 label when an interval is holding. */
function drawLock(ctx: CanvasRenderingContext2D, cx: number, cy: number, size: number, color: string): void {
  ctx.save()
  ctx.strokeStyle = color
  ctx.fillStyle = color
  ctx.lineWidth = 1.2
  ctx.beginPath()
  ctx.arc(cx, cy - size * 0.32, size * 0.32, Math.PI, 0)
  ctx.stroke()
  roundRectPath(ctx, cx - size / 2, cy - size * 0.1, size, size * 0.62, 1.5)
  ctx.fill()
  ctx.restore()
}

function drawBubble(
  ctx: CanvasRenderingContext2D, x: number, y: number, text: string, theme: TlTheme,
): void {
  ctx.save()
  ctx.font = `10px ${theme.fontMono}`
  ctx.textBaseline = 'middle'
  const tw = ctx.measureText(text).width
  const padX = 6, h = 16
  const w = tw + padX * 2
  // spec §6.1: 黑底白字 — an explicit literal color, not a token omission.
  ctx.fillStyle = '#000000'
  roundRectPath(ctx, x, y, w, h, h / 2)
  ctx.fill()
  ctx.fillStyle = '#ffffff'
  ctx.textAlign = 'center'
  ctx.fillText(text, x + w / 2, y + h / 2 + 0.5)
  ctx.restore()
}

function findMark(lanes: Lane[], markId: string): { laneIdx: number; mark: Mark } | null {
  for (let i = 0; i < lanes.length; i++) {
    for (const take of lanes[i].takes) {
      const mark = take.marks.find(m => m.id === markId)
      if (mark) return { laneIdx: i, mark }
    }
  }
  return null
}

export function draw(ctx: CanvasRenderingContext2D, d: TimelineData): void {
  const v = d.viewport
  const theme = tlTheme()
  const height = timelineHeight(d.lanes.length)
  const totalW = GUTTER_W + v.widthPx
  ctx.clearRect(0, 0, totalW, height)

  // ---- 1. 沟槽底：整幅底色（内容区 --bg-inset，沟槽列 --bg-panel） ----
  ctx.fillStyle = theme.bgInset
  ctx.fillRect(0, 0, totalW, height)
  ctx.fillStyle = theme.bgPanel
  ctx.fillRect(0, 0, GUTTER_W, height)

  // ---- 2. 行底：每轨沟槽格内容 + 内容区选中底色 + 行分隔线 ----
  d.lanes.forEach((lane, i) => {
    const laneY = RULER_H + i * LANE_H
    const selected = lane.id === d.currentLaneId
    const color = theme.laneColors[lane.layer]

    if (selected) {
      ctx.fillStyle = withAlpha(theme.accent, 0.06)
      ctx.fillRect(GUTTER_W, laneY, v.widthPx, LANE_H)
      ctx.fillStyle = theme.accentSoft
      ctx.fillRect(0, laneY, GUTTER_W, LANE_H)
      ctx.fillStyle = color
      ctx.fillRect(0, laneY, 3, LANE_H)
    }

    const dotX = 17, dotY = laneY + 24
    ctx.beginPath()
    ctx.fillStyle = color
    ctx.arc(dotX, dotY, 4, 0, Math.PI * 2)
    ctx.fill()

    ctx.textBaseline = 'middle'
    ctx.textAlign = 'left'
    ctx.font = `600 12px ${theme.fontUi}`
    ctx.fillStyle = selected ? theme.text1 : theme.text3
    ctx.fillText(lane.layer, dotX + 11, dotY)

    ctx.font = `10px ${theme.fontUi}`
    ctx.fillStyle = theme.text3
    ctx.fillText(LANE_SUBTITLE[lane.layer], dotX + 11, dotY + 16)

    const badgeText = `×${lane.takes.length}`
    ctx.font = `10px ${theme.fontMono}`
    const badgeTextW = ctx.measureText(badgeText).width
    const badgeH = 16, badgeW = Math.max(22, badgeTextW + 12)
    const badgeX = GUTTER_W - 10 - badgeW, badgeY = laneY + 10
    ctx.fillStyle = theme.bgControl
    roundRectPath(ctx, badgeX, badgeY, badgeW, badgeH, badgeH / 2)
    ctx.fill()
    ctx.fillStyle = theme.text2
    ctx.textAlign = 'center'
    ctx.fillText(badgeText, badgeX + badgeW / 2, badgeY + badgeH / 2 + 0.5)
    ctx.textAlign = 'left'

    ctx.strokeStyle = theme.borderSubtle
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(0, hair(laneY + LANE_H))
    ctx.lineTo(totalW, hair(laneY + LANE_H))
    ctx.stroke()
  })

  // ---- 3/4/5/6. 聚合 → 幽灵 take → 区间 → 标记 (clipped to the content area so
  // labels/pills never bleed into the gutter or past the right edge — spec
  // §6.2 "超出视口裁剪"). ----
  ctx.save()
  ctx.beginPath()
  ctx.rect(GUTTER_W, 0, v.widthPx, height)
  ctx.clip()

  d.lanes.forEach((lane, i) => {
    const laneY = RULER_H + i * LANE_H
    const midY = laneY + LANE_H / 2
    const color = theme.laneColors[lane.layer]
    const current = lane.takes.find(t => t.id === d.currentTakeId)

    // 聚合叠加：IQR 带 + 少数派竖条
    if (d.aggregate && lane.id === d.currentLaneId) {
      for (const am of d.aggregate.aggregated) {
        const x1 = GUTTER_W + msToPx(v, am.t_ms - am.iqr_ms)
        const x2 = GUTTER_W + msToPx(v, am.t_ms + am.iqr_ms)
        ctx.fillStyle = withAlpha(theme.success, 0.32)
        roundRectPath(ctx, x1, laneY + 3, Math.max(2, x2 - x1), 4, 2)
        ctx.fill()
      }
      for (const am of d.aggregate.minority) {
        const x = GUTTER_W + msToPx(v, am.t_ms)
        ctx.fillStyle = theme.warn
        ctx.fillRect(x - 2, laneY + 2, 4, 8)
      }
    }

    // 幽灵 take：非当前 take 的标记，轨底 6px 半透明刻度（轨道色 25%）
    ctx.fillStyle = withAlpha(color, 0.25)
    for (const take of lane.takes) {
      if (take.id === d.currentTakeId) continue
      for (const m of take.marks) {
        const x = GUTTER_W + msToPx(v, m.t_ms)
        ctx.fillRect(x - 1, laneY + LANE_H - 6, 2, 6)
      }
    }

    if (current) {
      // 区间：Δ 药丸（holding 时轨道色调 + 锁前缀）+ holding 圆角横条
      for (const iv of intervals(current.marks)) {
        const holding = iv.holding
        if (holding) {
          const x1 = GUTTER_W + msToPx(v, iv.startMs)
          const x2 = GUTTER_W + msToPx(v, iv.endMs)
          ctx.fillStyle = withAlpha(color, 0.32)
          roundRectPath(ctx, x1, midY - 7, Math.max(2, x2 - x1), 14, 6)
          ctx.fill()
        }

        const rect = pillRect(iv.midMs, v, laneY)
        const px0 = GUTTER_W + rect.x
        ctx.fillStyle = holding ? withAlpha(color, 0.28) : theme.bgElevated
        roundRectPath(ctx, px0, rect.y, rect.w, rect.h, rect.h / 2)
        ctx.fill()
        if (holding) {
          ctx.strokeStyle = color
          ctx.lineWidth = 1
          roundRectPath(ctx, px0, rect.y, rect.w, rect.h, rect.h / 2)
          ctx.stroke()
        }

        const text = `Δ${iv.deltaMs}ms`
        ctx.font = `10px ${theme.fontMono}`
        ctx.fillStyle = holding ? theme.text1 : theme.text2
        ctx.textBaseline = 'middle'
        const cy = rect.y + rect.h / 2 + 0.5
        if (holding) {
          drawLock(ctx, px0 + 11, cy, 7, theme.text1)
          ctx.textAlign = 'left'
          ctx.fillText(text, px0 + 19, cy)
        } else {
          ctx.textAlign = 'center'
          ctx.fillText(text, px0 + rect.w / 2, cy)
        }
        ctx.textAlign = 'left'
      }

      // 标记：input 实心圆 / release 空心圆；选中态外圈光晕；标签深色小药丸
      for (const m of current.marks) {
        const x = GUTTER_W + msToPx(v, m.t_ms)
        const sel = m.id === d.selectedMarkId
        const strokeOrFill = sel ? theme.selection : color
        ctx.beginPath()
        ctx.arc(x, midY, 5, 0, Math.PI * 2)
        if (m.kind === 'release') {
          ctx.lineWidth = 1.5
          ctx.strokeStyle = strokeOrFill
          ctx.stroke()
        } else {
          ctx.fillStyle = strokeOrFill
          ctx.fill()
        }
        if (sel) {
          ctx.save()
          ctx.shadowColor = theme.selection
          ctx.shadowBlur = 8
          ctx.beginPath()
          ctx.arc(x, midY, 7, 0, Math.PI * 2)
          ctx.lineWidth = 2
          ctx.strokeStyle = withAlpha(theme.selection, 0.6)
          ctx.stroke()
          ctx.restore()
        }
        if (m.label) {
          // spec §6.2: 标签...置于圆点上方 8px 的深色小药丸 — 8px gap between
          // the dot's TOP edge (midY-5) and the pill's BOTTOM edge, so the
          // pill's center sits a further half-height above that.
          const ph = 16
          const labelY = midY - 5 - 8 - ph / 2
          ctx.font = `10px ${theme.fontUi}`
          const tw = ctx.measureText(m.label).width
          const padX = 6
          const pw = tw + padX * 2
          const px0 = x - pw / 2
          ctx.fillStyle = theme.bgElevated
          roundRectPath(ctx, px0, labelY - ph / 2, pw, ph, ph / 2)
          ctx.fill()
          ctx.fillStyle = theme.text1
          ctx.textAlign = 'center'
          ctx.textBaseline = 'middle'
          ctx.fillText(m.label, x, labelY + 0.5)
          ctx.textAlign = 'left'
        }
      }
    }
  })

  // 拖动预览：目标标记在 dragPreview.tMs 处的实时幽灵位置 + Δ 提示
  if (d.dragPreview) {
    const found = findMark(d.lanes, d.dragPreview.markId)
    if (found) {
      const { laneIdx, mark } = found
      const laneY = RULER_H + laneIdx * LANE_H
      const midY = laneY + LANE_H / 2
      const color = theme.laneColors[d.lanes[laneIdx].layer]
      const origX = GUTTER_W + msToPx(v, mark.t_ms)
      const previewX = GUTTER_W + msToPx(v, d.dragPreview.tMs)

      ctx.save()
      ctx.strokeStyle = withAlpha(color, 0.5)
      ctx.setLineDash([3, 3])
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(origX, midY)
      ctx.lineTo(previewX, midY)
      ctx.stroke()
      ctx.restore()

      ctx.beginPath()
      ctx.fillStyle = withAlpha(theme.accent, 0.55)
      ctx.arc(previewX, midY, 6, 0, Math.PI * 2)
      ctx.fill()

      const delta = d.dragPreview.tMs - mark.t_ms
      const text = `Δ${delta >= 0 ? '+' : ''}${delta}ms`
      ctx.font = `10px ${theme.fontMono}`
      const tw = ctx.measureText(text).width
      const padX = 6, ph = 16
      const pw = tw + padX * 2
      const px0 = previewX - pw / 2, py0 = midY - 22 - ph / 2
      ctx.fillStyle = theme.bgElevated
      roundRectPath(ctx, px0, py0, pw, ph, ph / 2)
      ctx.fill()
      ctx.fillStyle = theme.text1
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(text, previewX, py0 + ph / 2 + 0.5)
      ctx.textAlign = 'left'
    }
  }

  ctx.restore()

  // ---- 7. 打表 marker：标尺内琥珀色小旗 ----
  ctx.save()
  ctx.beginPath()
  ctx.rect(GUTTER_W, 0, v.widthPx, RULER_H)
  ctx.clip()
  ctx.fillStyle = theme.warn
  for (const t of d.tally) {
    const x = GUTTER_W + msToPx(v, t.t_ms)
    ctx.fillRect(x - 0.75, 3, 1.5, RULER_H - 6)
    ctx.beginPath()
    ctx.moveTo(x, 3)
    ctx.lineTo(x + 7, 6.5)
    ctx.lineTo(x, 10)
    ctx.closePath()
    ctx.fill()
  }
  ctx.restore()

  // ---- 8. 标尺：主/次刻度 + 时码 + 底部 border ----
  const { majorMs, minorMs } = niceTickInterval(v.endMs - v.startMs, v.widthPx)
  ctx.strokeStyle = theme.borderSubtle
  ctx.lineWidth = 1
  for (let t = Math.ceil(v.startMs / minorMs) * minorMs; t <= v.endMs; t += minorMs) {
    const x = GUTTER_W + msToPx(v, t)
    ctx.beginPath()
    ctx.moveTo(hair(x), RULER_H)
    ctx.lineTo(hair(x), RULER_H - 4)
    ctx.stroke()
  }
  ctx.strokeStyle = theme.border
  ctx.fillStyle = theme.text3
  ctx.font = `10px ${theme.fontMono}`
  ctx.textAlign = 'left'
  ctx.textBaseline = 'alphabetic'
  for (let t = Math.ceil(v.startMs / majorMs) * majorMs; t <= v.endMs; t += majorMs) {
    const x = GUTTER_W + msToPx(v, t)
    ctx.beginPath()
    ctx.moveTo(hair(x), RULER_H)
    ctx.lineTo(hair(x), RULER_H - 8)
    ctx.stroke()
    ctx.fillText(fmtTc(t), x + 3, RULER_H - 9)
  }
  ctx.strokeStyle = theme.border
  ctx.beginPath()
  ctx.moveTo(0, hair(RULER_H))
  ctx.lineTo(totalW, hair(RULER_H))
  ctx.stroke()

  // ---- 9. 播放头：全高白线 + 标尺内三角手柄 + 时码气泡（悬停/拖动时） ----
  const phX = GUTTER_W + msToPx(v, d.playheadMs)
  ctx.strokeStyle = theme.text1
  ctx.lineWidth = 1.5
  ctx.beginPath()
  ctx.moveTo(phX, 0)
  ctx.lineTo(phX, height)
  ctx.stroke()

  ctx.fillStyle = theme.accent
  ctx.beginPath()
  ctx.moveTo(phX - 6, 0)
  ctx.lineTo(phX + 6, 0)
  ctx.lineTo(phX, 9)
  ctx.closePath()
  ctx.fill()

  if (d.hoverMs !== null || d.dragPreview !== null) {
    drawBubble(ctx, phX + 9, 5, fmtTc(d.playheadMs), theme)
  }

  // ---- 10. hoverMs 幽灵竖线 + 标尺气泡 ----
  if (d.hoverMs !== null) {
    const hx = GUTTER_W + msToPx(v, d.hoverMs)
    ctx.save()
    ctx.strokeStyle = withAlpha(theme.text3, 0.4)
    ctx.setLineDash([4, 4])
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(hair(hx), RULER_H)
    ctx.lineTo(hair(hx), height)
    ctx.stroke()
    ctx.restore()
    drawBubble(ctx, hx + 9, 5, fmtTc(d.hoverMs), theme)
  }
}
