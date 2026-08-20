import { useEffect, useState } from 'react'
import { api } from '../api/client'
import type { Keymap, Skill } from '../api/types'

export function KeymapPage({ onBack }: { onBack: () => void }) {
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
    <div className="library">
      <p><button onClick={onBack}>← 返回</button></p>
      <h1>键位（Keymap）</h1>
      <p>
        <input value={kmId} onChange={e => setKmId(e.target.value)} placeholder="keymap id" />
        <button onClick={load}>载入最新版{latest ? `（v${latest.version}）` : '（暂无）'}</button>
      </p>
      {rows.map((r, i) => (
        <p key={i}>
          <select value={r.skill_id}
            onChange={e => setRows(rows.map((x, j) => j === i ? { ...x, skill_id: e.target.value } : x))}>
            <option value="">选择技能</option>
            {skills.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <input placeholder="键，逗号分隔（如 2 或 Shift+2）" value={r.keys}
            onChange={e => setRows(rows.map((x, j) => j === i ? { ...x, keys: e.target.value } : x))} />
          <button onClick={() => setRows(rows.filter((_, j) => j !== i))}>删行</button>
        </p>
      ))}
      <p>
        <button onClick={() => setRows([...rows, { skill_id: '', keys: '' }])}>+ 加绑定</button>
        <button onClick={() => void save()}>保存（生成新版本）</button>
      </p>
      <p style={{ color: '#888' }}>保存永远生成新版本——旧 Analysis 钉住旧版本，语义不漂移（spec §5.6）。一键可绑多个技能：给多行不同技能填同一个键即可。</p>
    </div>
  )
}
