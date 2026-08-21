import { Fragment, useEffect, useState } from 'react'
import { Plus, RotateCcw, Save, Trash2 } from 'lucide-react'
import { api } from '../api/client'
import type { Keymap, Skill } from '../api/types'
import { Button } from '../ui/Button'
import { Card } from '../ui/Card'
import { Field } from '../ui/Field'
import { Keycap } from '../ui/Keycap'

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
              <Keycap label={k} />
              {ki < arr.length - 1 && <span className="chord-sep">+</span>}
            </Fragment>
          ))}
        </span>
      ))}
    </div>
  )
}

export function KeymapPage({ onBack }: { onBack: () => void }) {
  void onBack // TopBar 导航已常驻，页内不再自带 ← 返回（spec §7）
  const [skills, setSkills] = useState<Skill[]>([])
  const [keymaps, setKeymaps] = useState<Keymap[]>([])
  const [kmId, setKmId] = useState('km-default')
  const [rows, setRows] = useState<{ skill_id: string; keys: string }[]>([])

  const refresh = () => { void api.listKeymaps().then(setKeymaps) }
  useEffect(() => { void api.listSkills().then(setSkills); refresh() }, [])

  const latest = keymaps.filter(k => k.id === kmId).sort((a, b) => b.version - a.version)[0]

  const load = () => {
    if (!latest) { setRows([]); return }
    setRows(Object.entries(latest.binds).map(([skill_id, keys]) =>
      ({ skill_id, keys: keys.join(',') })))
  }

  const save = async () => {
    const binds: Record<string, string[]> = {}
    for (const r of rows) {
      if (r.skill_id && r.keys.trim()) binds[r.skill_id] = r.keys.split(',').map(s => s.trim())
    }
    await api.saveKeymap({ keymap_id: kmId, binds })
    refresh()
  }

  return (
    <div className="page">
      <div className="page-head">
        <h1>键位（Keymap）</h1>
        <p className="page-sub">保存永远生成新版本——旧 Analysis 钉住旧版本，语义不漂移</p>
      </div>

      <Card title="选择 keymap">
        <div className="km-load-row">
          <Field label="keymap id">
            <input value={kmId} onChange={e => setKmId(e.target.value)} placeholder="keymap id" />
          </Field>
          <Button variant="ghost" icon={<RotateCcw />} onClick={load}>
            载入最新版{latest ? `（v${latest.version}）` : '（暂无）'}
          </Button>
        </div>
      </Card>

      <Card title="绑定">
        <div className="km-body">
          {rows.length === 0 ? (
            <p className="form-hint">暂无绑定行，点击下方"加绑定"开始。</p>
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
            <Button variant="ghost" icon={<Plus />} onClick={() => setRows([...rows, { skill_id: '', keys: '' }])}>
              加绑定
            </Button>
            <Button variant="primary" icon={<Save />} onClick={() => void save()}>
              保存（生成新版本）
            </Button>
          </div>
          <p className="form-hint">一键可绑多个技能：给多行不同技能填同一个键即可。</p>
        </div>
      </Card>
    </div>
  )
}
