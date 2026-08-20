import { tallyAtPlayhead } from '../actions'
import { api } from '../api/client'
import { currentTake, useSession } from '../state/store'
import { fmtTc } from '../time/frames'

export function TallyBar() {
  const s = useSession()
  const take = currentTake(s)
  const prev = take ? [...take.marks].reverse().find(m => m.t_ms <= s.playheadMs) : undefined
  const tally = s.analysis?.tally ?? []
  const lastGap = tally.length >= 2
    ? tally[tally.length - 1].t_ms - tally[tally.length - 2].t_ms
    : null

  return (
    <div className="tally-bar">
      <span>当前 {fmtTc(s.playheadMs)}</span>
      <span>Δ 上一标记 {prev ? `${Math.round(s.playheadMs - prev.t_ms)}ms` : '—'}</span>
      <span>打表 {tally.length} 个{lastGap !== null ? `（最近间隔 ${lastGap}ms）` : ''}</span>
      <button onClick={() => void tallyAtPlayhead()}>T 打点</button>
      <button onClick={async () => {
        if (!s.analysis) return
        await api.clearTally(s.analysis.id)
        s.clearTallyLocal()
      }}>清空打表</button>
    </div>
  )
}
