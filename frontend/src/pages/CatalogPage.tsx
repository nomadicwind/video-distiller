import { useEffect, useState } from 'react'
import { api } from '../api/client'
import type { PatternItem, Skill } from '../api/types'
import { useErrors } from '../state/errors'

const EMPTY = { name: '', class_: '', cd_ms: '', cast_ms: '', anim_ms: '', pattern: '[]' }

const layerOf = (pattern: PatternItem[]) =>
  pattern.some(i => i.op === 'skill') ? 'L2' : 'L1'

export function CatalogPage({ onBack }: { onBack: () => void }) {
  const [skills, setSkills] = useState<Skill[]>([])
  const [form, setForm] = useState({ ...EMPTY })
  const [editing, setEditing] = useState<string | null>(null)

  const refresh = () => { void api.listSkills().then(setSkills) }
  useEffect(refresh, [])

  const parsePattern = (): PatternItem[] | null => {
    try {
      const p = JSON.parse(form.pattern)
      return Array.isArray(p) ? p : null
    } catch { return null }
  }

  const submit = async () => {
    const pattern = parsePattern()
    if (!form.name || pattern === null) {
      useErrors.getState().pushError('技能名必填，pattern 必须是合法 JSON 数组')
      return
    }
    const num = (v: string) => (v === '' ? undefined : Number(v))
    const payload = { name: form.name, class_: form.class_ || undefined,
      cd_ms: num(form.cd_ms), cast_ms: num(form.cast_ms), anim_ms: num(form.anim_ms), pattern }
    if (editing) await api.patchSkill(editing, payload)
    else await api.createSkill(payload)
    setForm({ ...EMPTY }); setEditing(null); refresh()
  }

  const edit = (s: Skill) => {
    setEditing(s.id)
    setForm({ name: s.name, class_: s.class ?? '',
      cd_ms: s.cd_ms?.toString() ?? '', cast_ms: s.cast_ms?.toString() ?? '',
      anim_ms: s.anim_ms?.toString() ?? '',
      pattern: JSON.stringify(s.pattern, null, 1) })
  }

  return (
    <div className="library">
      <p><button onClick={onBack}>← 返回</button></p>
      <h1>技能目录</h1>
      <table>
        <tbody>
          {skills.map(s => (
            <tr key={s.id} onClick={() => edit(s)} style={{ cursor: 'pointer' }}>
              <td>{s.name}</td><td>{s.class ?? '—'}</td>
              <td>cd {s.cd_ms ?? '—'}</td><td>前摇 {s.cast_ms ?? '—'}</td>
              <td>动作锁 {s.anim_ms ?? '—'}</td><td>{layerOf(s.pattern)}</td>
              <td><button onClick={async e => {
                e.stopPropagation(); await api.deleteSkill(s.id); refresh()
              }}>删除</button></td>
            </tr>
          ))}
        </tbody>
      </table>
      <h2>{editing ? '编辑技能' : '新建技能'}</h2>
      <p>
        <input placeholder="技能名" value={form.name}
          onChange={e => setForm({ ...form, name: e.target.value })} />
        <input placeholder="职业" value={form.class_}
          onChange={e => setForm({ ...form, class_: e.target.value })} />
      </p>
      <p>
        <input placeholder="cd_ms" value={form.cd_ms}
          onChange={e => setForm({ ...form, cd_ms: e.target.value })} />
        <input placeholder="cast_ms（前摇）" value={form.cast_ms}
          onChange={e => setForm({ ...form, cast_ms: e.target.value })} />
        <input placeholder="anim_ms（动作锁）" value={form.anim_ms}
          onChange={e => setForm({ ...form, anim_ms: e.target.value })} />
      </p>
      <p>
        <textarea rows={5} style={{ width: '100%' }} value={form.pattern}
          onChange={e => setForm({ ...form, pattern: e.target.value })} />
      </p>
      <p>
        <button onClick={() => void submit()}>{editing ? '保存' : '创建'}</button>
        {editing && <button onClick={() => { setEditing(null); setForm({ ...EMPTY }) }}>取消编辑</button>}
      </p>
      <p style={{ color: '#888' }}>
        pattern 示例：[{'{'}"op":"tap","key":"2"{'}'}] · gap 项 {'{'}"op":"gap","ms":300,"tol_ms":80{'}'} ·
        连招引用 {'{'}"op":"skill","ref":"sk_xxx"{'}'}（含 skill 引用即 L2）
      </p>
    </div>
  )
}
