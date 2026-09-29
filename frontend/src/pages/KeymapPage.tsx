import { Fragment, useEffect, useState } from 'react'
import { AlertTriangle, KeyRound, Plus, Save, Trash2 } from 'lucide-react'
import { api } from '../api/client'
import type { Keymap, Skill } from '../api/types'
import { Button } from '../ui/Button'
import { Card } from '../ui/Card'
import { EmptyState } from '../ui/EmptyState'
import { Field } from '../ui/Field'
import { Keycap } from '../ui/Keycap'
import { findDuplicateBinds } from './keymapDup'

/** 键位绑定值渲染为 Keycap 链：逐个逗号分隔组合，组合内按 '+' 拆帽（spec §7）。 */
function ChordPreview({ value }: { value: string }): JSX.Element {
  const combos = value.split(',').map(s => s.trim()).filter(Boolean)
  if (combos.length === 0) return <span className="op-chain-empty">—</span>
  return (
    <div className="chord-preview">
      {combos.map((combo, i) => (
        <span key={i} className="chord-group">
          {combo.split('+').map((k, ki, arr) => (
            <Fragment key={ki}>
              <Keycap label={k} inert />
              {ki < arr.length - 1 && <span className="chord-sep">+</span>}
            </Fragment>
          ))}
        </span>
      ))}
    </div>
  )
}

type Row = { skill_id: string; keys: string }

export function KeymapPage({ onBack }: { onBack: () => void }) {
  void onBack // TopBar 导航已常驻，页内不再自带 ← 返回（spec §7）
  const [skills, setSkills] = useState<Skill[]>([])
  const [keymaps, setKeymaps] = useState<Keymap[]>([])
  const [kmId, setKmId] = useState<string | null>(null)
  const [newId, setNewId] = useState('')
  const [rows, setRows] = useState<Row[]>([])

  const refresh = () => { void api.listKeymaps().then(setKeymaps) }
  useEffect(() => { void api.listSkills().then(setSkills); refresh() }, [])

  // 按 id 分组只保留最新版本（version 升序排完 Map 去重，后写入的高版本胜出）。
  const latestById = [...new Map(
    keymaps.slice().sort((a, b) => a.version - b.version).map(k => [k.id, k])).values()]
  const skillName = (id: string) => skills.find(s => s.id === id)?.name ?? id

  const loadKeymap = (k: Keymap) => {
    setKmId(k.id)
    setRows(Object.entries(k.binds).map(([skill_id, keys]) => ({ skill_id, keys: keys.join(',') })))
  }

  const createNew = () => {
    const id = newId.trim()
    if (!id) return
    setKmId(id)
    setRows([])
    setNewId('')
  }

  const save = async () => {
    if (!kmId) return
    const binds: Record<string, string[]> = {}
    for (const r of rows) {
      if (r.skill_id && r.keys.trim()) binds[r.skill_id] = r.keys.split(',').map(s => s.trim())
    }
    await api.saveKeymap({ keymap_id: kmId, binds })
    refresh()
  }

  const dup = findDuplicateBinds(rows)

  return (
    <div className="page">
      <div className="page-head">
        <h1>键位（Keymap）</h1>
        <p className="page-sub">保存永远生成新版本——旧 Analysis 钉住旧版本，语义不漂移</p>
      </div>

      <Card title="既有 keymap">
        {latestById.length === 0 ? (
          <EmptyState icon={<KeyRound />} text="还没有 keymap，先在下方新建一个" />
        ) : (
          <div className="km-card-list">
            {latestById.map(k => (
              <button
                key={k.id}
                type="button"
                className={`km-card${k.id === kmId ? ' is-current' : ''}`}
                onClick={() => loadKeymap(k)}
              >
                <span className="km-card-id">{k.id}</span>
                <span className="km-card-meta">v{k.version} · {Object.keys(k.binds).length} 项绑定</span>
              </button>
            ))}
          </div>
        )}
      </Card>

      <Card title="新建 keymap">
        <div className="km-load-row">
          <Field label="新 keymap id">
            <input value={newId} onChange={e => setNewId(e.target.value)} placeholder="如 km-xxx" />
          </Field>
          <Button variant="ghost" icon={<Plus />} disabled={!newId.trim()} onClick={createNew}>
            新建并编辑
          </Button>
        </div>
      </Card>

      <Card title={kmId ? `绑定 · ${kmId}` : '绑定'}>
        {!kmId ? (
          <p className="form-hint">先在上方选择一个既有 keymap，或新建一个开始编辑。</p>
        ) : (
          <div className="km-body">
            {dup.length > 0 && (
              <div className="km-dup-warning">
                <AlertTriangle size={14} />
                <span>重复绑定技能：{dup.map(skillName).join('、')} —— 保存时后一行覆盖前一行</span>
              </div>
            )}
            {rows.length === 0 ? (
              <EmptyState icon={<KeyRound />} text="该 keymap 暂无绑定"
                action={<Button variant="ghost" icon={<Plus />}
                  onClick={() => setRows([...rows, { skill_id: '', keys: '' }])}>加绑定</Button>} />
            ) : (
              <table className="table">
                <thead>
                  <tr><th>技能</th><th>键位</th><th>预览</th><th /></tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={i}>
                      <td>
                        <select value={r.skill_id}
                          onChange={e => setRows(rows.map((x, j) => j === i ? { ...x, skill_id: e.target.value } : x))}>
                          <option value="">选择技能</option>
                          {skills.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                        </select>
                      </td>
                      <td>
                        <input placeholder="逗号分隔（如 2 或 Shift+2）" value={r.keys}
                          onChange={e => setRows(rows.map((x, j) => j === i ? { ...x, keys: e.target.value } : x))} />
                      </td>
                      <td><ChordPreview value={r.keys} /></td>
                      <td>
                        <Button variant="danger" size="sm" icon={<Trash2 />} tip="删行"
                          onClick={() => setRows(rows.filter((_, j) => j !== i))} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <div className="form-actions">
              {rows.length > 0 && (
                <Button variant="ghost" icon={<Plus />} onClick={() => setRows([...rows, { skill_id: '', keys: '' }])}>
                  加绑定
                </Button>
              )}
              <Button variant="primary" icon={<Save />} onClick={() => void save()}>
                保存（生成新版本）
              </Button>
            </div>
            <p className="form-hint">一键可绑多个技能：给多行不同技能填同一个键即可。</p>
          </div>
        )}
      </Card>
    </div>
  )
}
