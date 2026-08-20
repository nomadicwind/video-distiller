import { useEffect, useState } from 'react'
import { tallyAtPlayhead } from '../actions'
import { api } from '../api/client'
import type { Skill } from '../api/types'
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

  const [skills, setSkills] = useState<Skill[]>([])
  const [backfillSkill, setBackfillSkill] = useState('')
  const [backfillField, setBackfillField] = useState<'anim_ms' | 'cast_ms' | 'cd_ms'>('anim_ms')
  const [backfilled, setBackfilled] = useState('')
  useEffect(() => { void api.listSkills().then(setSkills) }, [])

  const backfill = async () => {
    if (!backfillSkill || lastGap === null) return
    await api.patchSkill(backfillSkill, { [backfillField]: lastGap })
    const name = skills.find(s => s.id === backfillSkill)?.name ?? backfillSkill
    setBackfilled(`已把 ${lastGap}ms 写入 ${name}.${backfillField}`)
  }

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
      {lastGap !== null && (
        <span>
          回填 {lastGap}ms →
          <select value={backfillSkill} onChange={e => setBackfillSkill(e.target.value)}>
            <option value="">选技能</option>
            {skills.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <select value={backfillField}
            onChange={e => setBackfillField(e.target.value as 'anim_ms' | 'cast_ms' | 'cd_ms')}>
            <option value="anim_ms">anim_ms</option>
            <option value="cast_ms">cast_ms</option>
            <option value="cd_ms">cd_ms</option>
          </select>
          <button onClick={() => void backfill()}>回填</button>
          {backfilled && <em style={{ color: '#8c8' }}> {backfilled}</em>}
        </span>
      )}
    </div>
  )
}
