import { useEffect, useState } from 'react'
import { Save, Sparkles, Trash2, X } from 'lucide-react'
import { api } from '../api/client'
import type { PatternItem, Skill } from '../api/types'
import { useErrors } from '../state/errors'
import { Badge } from '../ui/Badge'
import { Button } from '../ui/Button'
import { Card } from '../ui/Card'
import { EmptyState } from '../ui/EmptyState'
import { Field } from '../ui/Field'

const EMPTY = { name: '', class_: '', cd_ms: '', cast_ms: '', anim_ms: '', pattern: '[]' }

const layerOf = (pattern: PatternItem[]) =>
  pattern.some(i => i.op === 'skill') ? 'L2' : 'L1'

type BadgeKind = 'accent' | 'success' | 'warn' | 'danger' | 'neutral'

/** op → 徽章色系（spec §7：pattern 展示为 op 类型徽章链）。 */
const OP_BADGE_KIND: Record<PatternItem['op'], BadgeKind> = {
  tap: 'accent', hold: 'accent', chord: 'accent', wheel: 'accent', gap: 'neutral', skill: 'warn',
}

function opLabel(item: PatternItem): string {
  switch (item.op) {
    case 'tap': return `tap ${item.key ?? ''}`
    case 'hold': return `hold ${item.key ?? ''}${item.ms != null ? ` ${item.ms}ms` : ''}`
    case 'chord': return `chord ${(item.keys ?? []).join('+')}`
    case 'wheel': return `wheel ${item.button ?? ''}`
    case 'gap': return `gap ${item.ms ?? '—'}ms`
    case 'skill': return `skill ${item.ref ?? ''}`
    default: return item.op
  }
}

function PatternChain({ pattern }: { pattern: PatternItem[] }): JSX.Element {
  if (pattern.length === 0) return <span className="op-chain-empty">—</span>
  return (
    <div className="op-chain">
      {pattern.map((item, i) => (
        <Badge key={i} kind={OP_BADGE_KIND[item.op]}>{opLabel(item)}</Badge>
      ))}
    </div>
  )
}

export function CatalogPage({ onBack }: { onBack: () => void }) {
  void onBack // TopBar 导航已常驻，页内不再自带 ← 返回（spec §7）
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
    <div className="page">
      <div className="page-head">
        <h1>技能目录</h1>
        <p className="page-sub">定义技能与连招 pattern；点击一行即可编辑，pattern 含 skill 引用即为 L2 连招</p>
      </div>

      <Card title="技能列表">
        {skills.length === 0 ? (
          <EmptyState icon={<Sparkles />} text="还没有技能，先在下方新建一个" />
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>名称</th><th>职业</th><th>CD (ms)</th><th>前摇 (ms)</th>
                <th>动作锁 (ms)</th><th>层级</th><th>Pattern</th><th />
              </tr>
            </thead>
            <tbody>
              {skills.map(s => (
                <tr key={s.id} className="is-clickable" onClick={() => edit(s)}>
                  <td>{s.name}</td>
                  <td>{s.class ?? '—'}</td>
                  <td className="mono">{s.cd_ms ?? '—'}</td>
                  <td className="mono">{s.cast_ms ?? '—'}</td>
                  <td className="mono">{s.anim_ms ?? '—'}</td>
                  <td><Badge kind={layerOf(s.pattern) === 'L2' ? 'warn' : 'accent'}>{layerOf(s.pattern)}</Badge></td>
                  <td><PatternChain pattern={s.pattern} /></td>
                  <td onClick={e => e.stopPropagation()}>
                    <Button variant="danger" size="sm" icon={<Trash2 />} tip="删除技能"
                      onClick={async () => { await api.deleteSkill(s.id); refresh() }} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <Card title={editing ? '编辑技能' : '新建技能'}>
        <div className="form-grid">
          <Field label="技能名">
            <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
          </Field>
          <Field label="职业">
            <input value={form.class_} onChange={e => setForm({ ...form, class_: e.target.value })} />
          </Field>
          <Field label="cd_ms">
            <input value={form.cd_ms} onChange={e => setForm({ ...form, cd_ms: e.target.value })} />
          </Field>
          <Field label="cast_ms（前摇）">
            <input value={form.cast_ms} onChange={e => setForm({ ...form, cast_ms: e.target.value })} />
          </Field>
          <Field label="anim_ms（动作锁）">
            <input value={form.anim_ms} onChange={e => setForm({ ...form, anim_ms: e.target.value })} />
          </Field>
          <div className="form-grid-full">
            <Field label="pattern（JSON 数组）">
              <textarea rows={5} value={form.pattern}
                onChange={e => setForm({ ...form, pattern: e.target.value })} />
            </Field>
          </div>
          <div className="form-grid-full form-actions">
            <Button variant="primary" icon={<Save />} onClick={() => void submit()}>
              {editing ? '保存' : '创建'}
            </Button>
            {editing && (
              <Button variant="ghost" icon={<X />}
                onClick={() => { setEditing(null); setForm({ ...EMPTY }) }}>取消编辑</Button>
            )}
          </div>
          <p className="form-grid-full form-hint">
            pattern 示例：<code>{'[{"op":"tap","key":"2"}]'}</code> · gap 项 <code>{'{"op":"gap","ms":300,"tol_ms":80}'}</code> ·
            连招引用 <code>{'{"op":"skill","ref":"sk_xxx"}'}</code>（含 skill 引用即 L2）
          </p>
        </div>
      </Card>
    </div>
  )
}
