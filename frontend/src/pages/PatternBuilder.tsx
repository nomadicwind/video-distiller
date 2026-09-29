import { useState } from 'react'
import { ChevronDown, ChevronUp, Plus, Trash2 } from 'lucide-react'
import type { PatternItem } from '../api/types'
import { Badge } from '../ui/Badge'
import { Button } from '../ui/Button'
import { blocksToPattern, patternToBlocks, type Block } from './patternBlocks'
import { PatternChain } from './PatternChain'

const swap = <T,>(arr: T[], i: number, j: number): T[] => {
  const out = [...arr]; [out[i], out[j]] = [out[j], out[i]]; return out
}

const BLOCK_BADGE_LABEL: Record<Block['op'], string> = { tap: '按键', gap: '间隔', hold: '按住' }

/**
 * 技能 pattern 的块编辑器（M14 任务 3）：tap/gap/hold 三种块，可增删排序；
 * 「高级：JSON」折叠区与块视图双向同步。骨架取舍：块列表是这个组件自己的
 * 本地 state（不是每次渲染从 props.value 用 patternToBlocks 重新派生）——
 * 否则块字段里刚清空还没填完的输入（比如改 tap 的 key 中途退格成空串）会
 * 让 patternToBlocks 判定"当前 pattern 不受块视图支持"，界面在打字过程中
 * 突然跳变成 JSON 模式。只有「外部把 value 换成另一条 pattern」（即父组件
 * 用不同的 key 重新挂载这个组件，见 CatalogPage 的 `key={editing ?? '_new'}`）
 * 或「用户自己在 JSON 框里粘贴/编辑」两种情况需要重新派生块列表，都已经在
 * 对应入口显式处理，不需要一个持续盯着 value 的 effect。
 */
export function PatternBuilder({ value, onChange }: {
  value: PatternItem[]
  onChange: (pattern: PatternItem[]) => void
}): JSX.Element {
  const initial = patternToBlocks(value)
  const [blocks, setBlocksState] = useState<Block[]>(() => (initial.supported ? initial.blocks : []))
  const [blockMode, setBlockMode] = useState(initial.supported)
  const [jsonOpen, setJsonOpen] = useState(!initial.supported)
  const [jsonText, setJsonText] = useState(() => JSON.stringify(value, null, 1))
  const [jsonError, setJsonError] = useState<string | null>(null)

  const setBlocks = (next: Block[]) => {
    setBlocksState(next)
    const pattern = blocksToPattern(next)
    setJsonText(JSON.stringify(pattern, null, 1))
    setJsonError(null)
    onChange(pattern)
  }

  const commitJson = (text: string) => {
    setJsonText(text)
    let next: unknown
    try {
      next = JSON.parse(text)
    } catch {
      setJsonError('不是合法 JSON')
      return
    }
    if (!Array.isArray(next)) { setJsonError('必须是 JSON 数组'); return }
    setJsonError(null)
    onChange(next as PatternItem[])
    const asBlocks = patternToBlocks(next as PatternItem[])
    if (asBlocks.supported) { setBlocksState(asBlocks.blocks); setBlockMode(true) } else { setBlockMode(false) }
  }

  const addBlock = (op: Block['op']) => {
    const block: Block = op === 'tap' ? { op: 'tap', key: '' } : op === 'gap' ? { op: 'gap', ms: 300 } : { op: 'hold', ms: 300 }
    setBlocks([...blocks, block])
  }
  const removeBlock = (i: number) => setBlocks(blocks.filter((_, j) => j !== i))
  const moveBlock = (i: number, dir: -1 | 1) => {
    const j = i + dir
    if (j < 0 || j >= blocks.length) return
    setBlocks(swap(blocks, i, j))
  }
  const patchTap = (i: number, key: string) =>
    setBlocks(blocks.map((b, j) => (j !== i ? b : { op: 'tap', key })))
  const patchGap = (i: number, patch: { ms?: number; tol_ms?: number }) =>
    setBlocks(blocks.map((b, j) => (j !== i || b.op !== 'gap' ? b : { ...b, ...patch })))
  const patchHold = (i: number, patch: { key?: string; button?: string; ms?: number; tol_ms?: number }) =>
    setBlocks(blocks.map((b, j) => (j !== i || b.op !== 'hold' ? b : { ...b, ...patch })))

  return (
    <div className="pattern-builder">
      {blockMode ? (
        <>
          <div className="pbe-blocks">
            {blocks.map((b, i) => (
              <div key={i} className="pbe-block-row">
                <Badge kind="accent">{BLOCK_BADGE_LABEL[b.op]}</Badge>
                <div className="pbe-block-controls">
                  {b.op === 'tap' && (
                    <input placeholder="键（如 Q）" value={b.key}
                      onChange={e => patchTap(i, e.target.value.toUpperCase())} />
                  )}
                  {b.op === 'gap' && (<>
                    <input type="number" value={b.ms}
                      onChange={e => patchGap(i, { ms: Number(e.target.value) })} /> ms
                    <input type="number" placeholder="容差 tol_ms" value={b.tol_ms ?? ''}
                      onChange={e => patchGap(i, { tol_ms: e.target.value === '' ? undefined : Number(e.target.value) })} />
                  </>)}
                  {b.op === 'hold' && (<>
                    <input placeholder="键" value={b.key ?? ''}
                      onChange={e => patchHold(i, { key: e.target.value ? e.target.value.toUpperCase() : undefined })} />
                    <input placeholder="按钮（如 LMB）" value={b.button ?? ''}
                      onChange={e => patchHold(i, { button: e.target.value || undefined })} />
                    <input type="number" placeholder="ms" value={b.ms ?? ''}
                      onChange={e => patchHold(i, { ms: e.target.value === '' ? undefined : Number(e.target.value) })} />
                    <input type="number" placeholder="容差 tol_ms" value={b.tol_ms ?? ''}
                      onChange={e => patchHold(i, { tol_ms: e.target.value === '' ? undefined : Number(e.target.value) })} />
                  </>)}
                </div>
                <div className="pbe-block-actions">
                  <Button variant="icon" size="sm" icon={<ChevronUp />} tip="上移"
                    disabled={i === 0} onClick={() => moveBlock(i, -1)} />
                  <Button variant="icon" size="sm" icon={<ChevronDown />} tip="下移"
                    disabled={i === blocks.length - 1} onClick={() => moveBlock(i, 1)} />
                  <Button variant="danger" size="sm" icon={<Trash2 />} tip="删块"
                    onClick={() => removeBlock(i)} />
                </div>
              </div>
            ))}
          </div>
          <div className="pbe-add-row">
            <Button variant="ghost" icon={<Plus />} onClick={() => addBlock('tap')}>+按键</Button>
            <Button variant="ghost" icon={<Plus />} onClick={() => addBlock('gap')}>+间隔</Button>
            <Button variant="ghost" icon={<Plus />} onClick={() => addBlock('hold')}>+按住</Button>
          </div>
        </>
      ) : (
        <p className="form-hint">
          当前 pattern 含技能引用（skill ref）或 chord/wheel op，块视图不支持，仅可用下方 JSON 编辑。
        </p>
      )}

      <p className="pattern-preview-label">预览</p>
      <PatternChain pattern={value} />

      <details className="pattern-json" open={jsonOpen} onToggle={e => setJsonOpen(e.currentTarget.open)}>
        <summary>高级：JSON</summary>
        <textarea rows={5} className="mono" value={jsonText} onChange={e => commitJson(e.target.value)} />
        {jsonError && <p className="pattern-json-error">{jsonError}</p>}
      </details>
    </div>
  )
}
