import { useEffect, useState } from 'react'
import { insertAtPlayhead } from '../actions'
import { api } from '../api/client'
import { currentTake, useSession } from '../state/store'
import { Button } from '../ui/Button'
import { Field } from '../ui/Field'
import { Keycap } from '../ui/Keycap'
import { Switch } from '../ui/Switch'
import { MarkList } from './MarkList'

const L0_KEYS = ['1', '2', '3', '4', '5', 'Q', 'W', 'E', 'R', 'F', 'G', 'Tab', 'LMB', 'RMB', 'Wheel']

/** M8 任务 2：面板鼠标粘滞修饰键的固定顺序——与 entry/chord.ts 的
 * composeEntryLabel 使用的 canonical Ctrl,Alt,Shift 顺序保持一致，这样鼠标
 * 点击组合出的 label（如 'Ctrl+Shift+Q'）与键盘 chord 打点产生的 label
 * 格式完全一致，下游（timeline pill、去重 usedLabels 等）不需要关心 label
 * 是哪条路径产生的。 */
const MODIFIERS = ['Ctrl', 'Alt', 'Shift'] as const
type Modifier = (typeof MODIFIERS)[number]

export function EntryPanel() {
  const s = useSession()
  const [skillName, setSkillName] = useState('')
  const lane = s.analysis?.lanes.find(l => l.id === s.laneId)
  const take = currentTake(s)

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

  // M8 任务 2：面板鼠标粘滞修饰键——点亮 Ctrl/Alt/Shift chip 后再点基键，
  // 组合出 'Shift+2' 这样的 label（顺序见上面 MODIFIERS 的注释）；基键消费
  // 后清空。纯本地 UI 状态，不进 store：这条鼠标点击路径本来就不调用
  // recordEntry（见下方 onClick 与 store.ts 的注释），armed 也一样不需要
  // 跨组件共享或持久化。空标记按钮不消费/不清空它。
  const [armed, setArmed] = useState<Set<Modifier>>(new Set())

  if (!s.analysis || !lane) return null

  // 键盘录入（entryMode 下敲键盘）驱动的 chord 视觉反馈：pressedLabel 只由
  // recordEntry 产生（面板点击键帽不走这条路径），形如 'Shift+2'。拆出其
  // 修饰前缀，让对应的 Ctrl/Alt/Shift chip 跟着基键一起短暂高亮
  // （.keycap-pressed），与鼠标点击 chip 产生的粘滞 armed 高亮
  // （.keycap-armed）互不冲突，可以同时出现在同一枚 chip 上。
  const pressedMods: string[] = pressedLabel?.includes('+')
    ? pressedLabel.split('+').slice(0, -1) : []
  // carry item（controller ruling）：基键键帽的按压反馈原先只比较
  // `pressedLabel === k`，对着未加前缀的 L0_KEYS 数组，chord 打点的组合
  // label（如 'Shift+2'）永远不等于任何一个纯键位，导致键盘 chord 打点在
  // 面板里点不亮任何键帽（时间轴上的 flash 不受影响，那边是按 markId 键的
  // 独立机制）。这里只需额外接受"以 '+k' 结尾"的组合 label。
  const isBasePressed = (k: string) =>
    pressedLabel === k || (pressedLabel?.endsWith(`+${k}`) ?? false)

  const usedLabels = [...new Set(
    lane.takes.flatMap(t => t.marks.map(m => m.label)).filter((x): x is string => !!x))]

  return (
    <div className="entry-panel">
      {/* M9 任务 3：泳道卡整块移除——时间轴沟槽（Timeline 的轨道点击区）已经
          承担了泳道选择与状态显示，这里再画一遍是纯重复。s.laneId 仍是双向
          同步的单一状态源，只是选择的入口收敛到时间轴一侧。 */}

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
            const created = await api.newTake(lane.id)
            s.addTakeLocal(lane.id, created)
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
          <div className="entry-section-title">
            在播放头处打点
            <span className="entry-section-hint">（点亮修饰键可组合）</span>
          </div>
          <div className="keycap-modifier-row">
            {MODIFIERS.map(m => (
              <Keycap key={m} label={m} armed={armed.has(m)} pressed={pressedMods.includes(m)}
                onClick={() => setArmed(prev => {
                  const next = new Set(prev)
                  if (next.has(m)) next.delete(m)
                  else next.add(m)
                  return next
                })} />
            ))}
          </div>
          <div className="keycap-grid">
            {L0_KEYS.map(k => (
              <Keycap key={k} label={k} pressed={isBasePressed(k)}
                onClick={() => {
                  const label = [...MODIFIERS.filter(m => armed.has(m)), k].join('+')
                  void insertAtPlayhead('input', label)
                  setArmed(new Set())
                }} />
            ))}
          </div>
          {/* 空标记不消费/不清空 armed —— 只有上面的基键键帽点击才会 setArmed(new Set())。 */}
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

      {/* M9 任务 3：面板主体——当前泳道当前 take 的标记列表，占满剩余高度
          自行滚动（.mark-list 的 flex:1/overflow-y:auto，见 styles.css）。 */}
      <MarkList lane={lane} take={take} />
    </div>
  )
}
