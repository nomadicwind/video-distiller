import { useEffect, useState } from 'react'
import { insertAtPlayhead } from '../actions'
import { api } from '../api/client'
import type { Lane } from '../api/types'
import { useSession } from '../state/store'
import { LANE_SUBTITLE } from '../timeline/draw'
import { Badge } from '../ui/Badge'
import { Button } from '../ui/Button'
import { Field } from '../ui/Field'
import { Keycap } from '../ui/Keycap'
import { Switch } from '../ui/Switch'

const L0_KEYS = ['1', '2', '3', '4', '5', 'Q', 'W', 'E', 'R', 'F', 'G', 'Tab', 'LMB', 'RMB', 'Wheel']

/** var() reference per layer — kept alongside LANE_SUBTITLE's Lane['layer'] keying so a new layer can't add one without the other. */
const LANE_COLOR_VAR: Record<Lane['layer'], string> = {
  L0: 'var(--lane-l0)', L1: 'var(--lane-l1)', L2: 'var(--lane-l2)',
}

export function EntryPanel() {
  const s = useSession()
  const [skillName, setSkillName] = useState('')
  const lane = s.analysis?.lanes.find(l => l.id === s.laneId)

  // 键帽 120ms 按压态（M7 任务 3）：由 store 的 lastEntry 驱动 —— 只在录入
  // 模式下物理键盘打点时更新（见 hotkeys.ts），给这类"鼠标没碰这枚键帽"的
  // 输入方式补一个看得见的反馈。effect 依赖 lastEntry 这个对象本身（每次
  // recordEntry 都会产生一个新引用，哪怕 label 相同），所以即使连续两次
  // 打同一个键，也会重新触发一轮 120ms 按压，而不是被 React 认为"没变化"
  // 而跳过。
  const [pressedLabel, setPressedLabel] = useState<string | null>(null)
  useEffect(() => {
    if (!s.lastEntry) return
    setPressedLabel(s.lastEntry.label)
    const t = setTimeout(() => setPressedLabel(null), 120)
    return () => clearTimeout(t)
  }, [s.lastEntry])

  if (!s.analysis || !lane) return null

  const usedLabels = [...new Set(
    lane.takes.flatMap(t => t.marks.map(m => m.label)).filter((x): x is string => !!x))]

  return (
    <div className="entry-panel">
      {/* 轨道卡：与时间轴同一状态（s.laneId），点击任一侧都双向同步。 */}
      <div className="lane-cards">
        {s.analysis.lanes.map(l => (
          <button
            key={l.id}
            type="button"
            className={`lane-card${l.id === s.laneId ? ' is-selected' : ''}`}
            style={{ '--lane-color': LANE_COLOR_VAR[l.layer] } as React.CSSProperties}
            onClick={() => s.selectLane(l.id)}
          >
            <span className="lane-card-info">
              <span className="lane-card-name">{l.layer}</span>
              <span className="lane-card-sub">{LANE_SUBTITLE[l.layer]}</span>
            </span>
            <Badge kind={l.id === s.laneId ? 'accent' : 'neutral'}>{l.takes.length}</Badge>
          </button>
        ))}
      </div>

      {/* Take 段：chip 行 + 新 Take ghost + 聚合叠加 Switch（A 热键提示）。 */}
      <div className="take-row">
        <div className="take-chips">
          {lane.takes.map(t => (
            <button
              key={t.id}
              type="button"
              className={`take-chip${t.id === s.takeId ? ' is-current' : ''}`}
              onClick={() => s.selectTake(t.id)}
            >
              #{t.idx}
            </button>
          ))}
          <Button variant="ghost" size="sm" onClick={async () => {
            const take = await api.newTake(lane.id)
            s.addTakeLocal(lane.id, take)
          }}>+ 新 Take</Button>
        </div>
        <Switch
          checked={s.showAggregate}
          onChange={s.toggleAggregate}
          label={<>聚合叠加<span className="hotkey-hint">A</span></>}
        />
      </div>

      {lane.layer === 'L0' ? (
        <div className="entry-l0">
          <div className="entry-section-title">在播放头处打点</div>
          <div className="keycap-grid">
            {L0_KEYS.map(k => (
              <Keycap key={k} label={k} pressed={pressedLabel === k}
                onClick={() => void insertAtPlayhead('input', k)} />
            ))}
          </div>
          <Keycap label="空标记" wide onClick={() => void insertAtPlayhead('release', null)} />
          <Switch
            checked={s.entryMode}
            onChange={s.toggleEntryMode}
            label="录入模式"
            hint="敲键盘直接打点"
          />
        </div>
      ) : (
        <Field label="技能名">
          <div className="skill-input-row">
            <input list="used-labels" value={skillName}
              onChange={e => setSkillName(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && skillName) void insertAtPlayhead('input', skillName)
              }} />
            <datalist id="used-labels">
              {usedLabels.map(l => <option key={l} value={l} />)}
            </datalist>
            <Button variant="primary" disabled={!skillName}
              onClick={() => void insertAtPlayhead('input', skillName)}>插入</Button>
          </div>
        </Field>
      )}
    </div>
  )
}
