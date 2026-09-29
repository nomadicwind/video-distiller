import type { PatternItem } from '../api/types'
import { Badge } from '../ui/Badge'

type BadgeKind = 'accent' | 'success' | 'warn' | 'danger' | 'neutral'

/** op → 徽章色系（spec §7：pattern 展示为 op 类型徽章链）。 */
export const OP_BADGE_KIND: Record<PatternItem['op'], BadgeKind> = {
  tap: 'accent', hold: 'accent', chord: 'accent', wheel: 'accent', gap: 'neutral', skill: 'warn',
}

export function opLabel(item: PatternItem): string {
  switch (item.op) {
    case 'tap': return `tap ${item.key ?? ''}`
    case 'hold': return `hold ${item.key ?? item.button ?? ''}${item.ms != null ? ` ${item.ms}ms` : ''}`
    case 'chord': return `chord ${(item.keys ?? []).join('+')}`
    case 'wheel': return `wheel ${item.button ?? ''}`
    case 'gap': return `gap ${item.ms ?? '—'}ms`
    case 'skill': return `skill ${item.ref ?? ''}`
    default: return item.op
  }
}

/** op 徽章链渲染——技能目录列表与 PatternBuilder 实时预览共用（M14 任务 3）。 */
export function PatternChain({ pattern }: { pattern: PatternItem[] }): JSX.Element {
  if (pattern.length === 0) return <span className="op-chain-empty">—</span>
  return (
    <div className="op-chain">
      {pattern.map((item, i) => (
        <Badge key={i} kind={OP_BADGE_KIND[item.op]}>{opLabel(item)}</Badge>
      ))}
    </div>
  )
}
