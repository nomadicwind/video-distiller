import { useState } from 'react'
import { insertAtPlayhead } from '../actions'
import { api } from '../api/client'
import { useSession } from '../state/store'

const L0_KEYS = ['1', '2', '3', '4', '5', 'Q', 'W', 'E', 'R', 'F', 'G', 'Tab', 'LMB', 'RMB', 'Wheel']

export function EntryPanel() {
  const s = useSession()
  const [skillName, setSkillName] = useState('')
  const lane = s.analysis?.lanes.find(l => l.id === s.laneId)
  if (!s.analysis || !lane) return null

  const usedLabels = [...new Set(
    lane.takes.flatMap(t => t.marks.map(m => m.label)).filter((x): x is string => !!x))]

  return (
    <div className="entry-panel">
      <div>
        {s.analysis.lanes.map(l => (
          <label key={l.id} style={{ marginRight: 8 }}>
            <input type="radio" checked={l.id === s.laneId} onChange={() => s.selectLane(l.id)} />
            {l.layer}
          </label>
        ))}
      </div>
      <div>
        Take：
        {lane.takes.map(t => (
          <button key={t.id} className={t.id === s.takeId ? 'active' : ''}
            onClick={() => s.selectTake(t.id)}>#{t.idx}</button>
        ))}
        <button onClick={async () => {
          const take = await api.newTake(lane.id)
          s.addTakeLocal(lane.id, take)
        }}>+ 新 Take</button>
      </div>
      {lane.layer === 'L0' ? (
        <div className="keys">
          {L0_KEYS.map(k => (
            <button key={k} onClick={() => void insertAtPlayhead('input', k)}>{k}</button>
          ))}
          <button onClick={() => void insertAtPlayhead('release', null)}>空标记</button>
          <p>
            <label>
              <input type="checkbox" checked={s.entryMode} onChange={s.toggleEntryMode} />
              录入模式（直接敲键盘打点；退出请取消本勾选）
            </label>
          </p>
        </div>
      ) : (
        <div>
          <input list="used-labels" placeholder="技能名" value={skillName}
            onChange={e => setSkillName(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && skillName) void insertAtPlayhead('input', skillName)
            }} />
          <datalist id="used-labels">
            {usedLabels.map(l => <option key={l} value={l} />)}
          </datalist>
          <button disabled={!skillName}
            onClick={() => void insertAtPlayhead('input', skillName)}>插入</button>
        </div>
      )}
    </div>
  )
}
