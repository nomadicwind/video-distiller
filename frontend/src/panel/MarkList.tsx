import { useEffect, useRef, useState } from 'react'
import { ListChecks, Lock, Trash2 } from 'lucide-react'
import { deleteSelected, moveMark, relabelMark, toggleHolding } from '../actions'
import type { Lane, Mark, Take } from '../api/types'
import { seekMs } from '../player/Player'
import { useSession } from '../state/store'
import { fmtTc } from '../time/frames'
import { Badge } from '../ui/Badge'
import { Button } from '../ui/Button'
import { EmptyState } from '../ui/EmptyState'
import { Field } from '../ui/Field'

const KIND_LABEL: Record<Mark['kind'], string> = { input: '打点', release: '空标记' }
const KIND_BADGE: Record<Mark['kind'], 'accent' | 'neutral'> = { input: 'accent', release: 'neutral' }

/**
 * M9 任务 3：面板重构的主体——取代原先与时间轴重复的泳道卡，改为当前泳道
 * 当前 take 的标记列表（按 t_ms 排序，与 store 里 marks 数组的既有排序一致，
 * 见 state/store.ts 的 byT）。点击行 = selectMark + seekMs，与时间轴选中态
 * 共享同一个 selectedMarkId，双向同步天然免费；选中行额外展开内联编辑器
 * （见下方 MarkEditor）。
 */
export function MarkList({ lane, take }: { lane: Lane; take: Take | null }): JSX.Element {
  const s = useSession()
  const rowRefs = useRef<Record<string, HTMLDivElement | null>>({})

  // 时间轴 -> 列表同步：selectedMarkId 无论从哪一侧改变，都把对应行滚动进
  // 视野（block:'nearest'，不把整个列表跳到顶部/居中，只做刚好够看见的最小
  // 滚动）。列表侧点击本来就是用户主动点开的行，天然可见；这个 effect 真正
  // 补上的是"在时间轴上点了一个不在当前可视区域内的标记"这条路径。
  useEffect(() => {
    if (!s.selectedMarkId) return
    rowRefs.current[s.selectedMarkId]?.scrollIntoView({ block: 'nearest' })
  }, [s.selectedMarkId])

  const marks = take?.marks ?? []

  return (
    <div className="mark-list">
      {marks.length === 0 ? (
        <EmptyState icon={<ListChecks />} text="该 take 还没有标记" />
      ) : (
        marks.map(m => {
          const selected = m.id === s.selectedMarkId
          return (
            <div
              key={m.id}
              className={`mark-row${selected ? ' is-selected' : ''}`}
              ref={el => { rowRefs.current[m.id] = el }}
            >
              <button
                type="button"
                className="mark-row-main"
                onClick={() => { s.selectMark(m.id); seekMs(m.t_ms) }}
              >
                <span className="mono mark-row-time">{fmtTc(m.t_ms)}</span>
                <Badge kind={KIND_BADGE[m.kind]}>{KIND_LABEL[m.kind]}</Badge>
                <span className="mark-row-label">{m.label ?? '—'}</span>
                {m.end_ms != null && <Lock className="mark-row-lock" size={12} />}
              </button>
              {selected && <MarkEditor mark={m} lane={lane} />}
            </div>
          )
        })
      )}
    </div>
  )
}

/**
 * 仅选中行展开的内联编辑器。标签/时刻各自维护一份本地输入态，用
 * mark.id/对应字段做依赖的 effect 同步——既让"选中另一行"时天然重新初始化
 * （不同 mark.id，effect 重跑），也让"这一行仍选中、但底层 mark 被外部改了"
 * （undo/redo 落到同一个 mark 上、[±1帧] 按钮改了 t_ms）时输入框跟着更新，
 * 而不会在用户正敲字符的中途被打断——只要用户没提交，mark.label/t_ms 在
 * store 里就不会变，effect 不会重跑。
 */
function MarkEditor({ mark, lane }: { mark: Mark; lane: Lane }): JSX.Element {
  const frameMs = useSession(st => st.frameMs)
  const [labelInput, setLabelInput] = useState(mark.label ?? '')
  const [timeInput, setTimeInput] = useState(String(mark.t_ms))

  useEffect(() => { setLabelInput(mark.label ?? '') }, [mark.id, mark.label])
  useEffect(() => { setTimeInput(String(mark.t_ms)) }, [mark.id, mark.t_ms])

  const commitLabel = () => { void relabelMark(mark.id, labelInput) }
  const commitTime = () => {
    // Number('') is 0 (finite!), so an emptied field must be caught before
    // Number() runs — otherwise clearing the input and blurring would read
    // as "move to t_ms=0" instead of "no-op", same "空值不提交" guard as the
    // label field (which trim()s a genuine empty string; here the field
    // itself is what's checked, since '0' is a legitimate typed value).
    if (timeInput.trim() === '') { setTimeInput(String(mark.t_ms)); return }
    const parsed = Number(timeInput)
    if (!Number.isFinite(parsed)) { setTimeInput(String(mark.t_ms)); return }
    const rounded = Math.round(parsed)
    if (rounded !== mark.t_ms) void moveMark(mark.id, rounded)
  }

  // L1/L2 复用 EntryStrip 技能名输入同一套"本泳道已用过的标签"集合，给
  // 重命名一个候选列表；L0 的 label 是键位/修饰键组合出的 chord 字符串，
  // 没有对应的固定候选集，不挂 datalist。
  const usedLabels = lane.layer !== 'L0'
    ? [...new Set(
        lane.takes.flatMap(t => t.marks.map(x => x.label)).filter((x): x is string => !!x))]
    : []

  return (
    <div className="mark-editor">
      {/* release（空标记）在后端语义上永远不带 label —— store._validate_mark
          对 update_mark 的合并结果同样校验"release mark must not carry
          label"，给它一个可编辑的标签框必然以 400 收场。只对 input 渲染这
          个字段，而不是渲染出来再让服务端拒绝。 */}
      {mark.kind === 'input' && (
        <Field label="标签">
          <div className="mark-editor-row">
            <input
              value={labelInput}
              list={lane.layer !== 'L0' ? 'mark-editor-labels' : undefined}
              onChange={e => setLabelInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') commitLabel() }}
              onBlur={commitLabel}
            />
          </div>
        </Field>
      )}
      {mark.kind === 'input' && lane.layer !== 'L0' && (
        <datalist id="mark-editor-labels">
          {usedLabels.map(l => <option key={l} value={l} />)}
        </datalist>
      )}

      <Field label="时刻 (ms)">
        <div className="mark-editor-row">
          <input
            type="number"
            className="mono"
            value={timeInput}
            onChange={e => setTimeInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') commitTime() }}
            onBlur={commitTime}
          />
          <Button variant="ghost" size="sm" onClick={() => void moveMark(mark.id, mark.t_ms - frameMs)}>
            −1帧
          </Button>
          <Button variant="ghost" size="sm" onClick={() => void moveMark(mark.id, mark.t_ms + frameMs)}>
            +1帧
          </Button>
        </div>
      </Field>

      {mark.end_ms != null && (
        <div className="mark-editor-row mark-editor-holding">
          <span className="mark-editor-holding-text">
            按住至 <span className="mono">{fmtTc(mark.end_ms)}</span>
          </span>
          <Button variant="ghost" size="sm" onClick={() => void toggleHolding(mark.id, { clear_end: true })}>
            解除按住
          </Button>
        </div>
      )}

      <div className="mark-editor-actions">
        {/* deleteSelected()（而非按 markId 的独立入口）在这里是安全的：这个
            编辑器只在 mark.id === selectedMarkId 时才会渲染（见 MarkList
            的 `selected && <MarkEditor .../>`），所以此刻"全局选中的标记"
            与"这一行的标记"必然是同一个——复用既有 deleteSelected 语义，
            不需要另外抽一个按 markId 删除的入口。 */}
        <Button variant="danger" size="sm" icon={<Trash2 size={14} />} onClick={() => void deleteSelected()}>
          删除
        </Button>
      </div>
    </div>
  )
}
