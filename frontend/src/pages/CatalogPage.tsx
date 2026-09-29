import { useEffect, useState } from 'react'
import { Save, Sparkles, Trash2, X } from 'lucide-react'
import { api } from '../api/client'
import type { PatternItem, Skill } from '../api/types'
import { useErrors } from '../state/errors'
import { Badge } from '../ui/Badge'
import { Button } from '../ui/Button'
import { Card } from '../ui/Card'
import { ConfirmDialog } from '../ui/ConfirmDialog'
import { EmptyState } from '../ui/EmptyState'
import { Field } from '../ui/Field'
import { PatternBuilder } from './PatternBuilder'
import { PatternChain } from './PatternChain'

const EMPTY = { name: '', class_: '', cd_ms: '', cast_ms: '', anim_ms: '', pattern: [] as PatternItem[] }

const layerOf = (pattern: PatternItem[]) =>
  pattern.some(i => i.op === 'skill') ? 'L2' : 'L1'

export function CatalogPage({ onBack }: { onBack: () => void }) {
  void onBack // TopBar 导航已常驻，页内不再自带 ← 返回（spec §7）
  const [skills, setSkills] = useState<Skill[]>([])
  const [form, setForm] = useState({ ...EMPTY })
  const [editing, setEditing] = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Skill | null>(null)
  // 新建→创建成功后 editing 前后都是 null，PatternBuilder 的 key（见下方）
  // 恒为 '_new'，构建器不会重挂载去清空内部块列表——第二次创建会静默存入
  // form.pattern 已重置的空 pattern，而构建器仍显示上一个技能的块（复查发现
  // 1）。修复：创建成功后自增这个 nonce，拼进 key 里强制重挂载。
  const [newPatternNonce, setNewPatternNonce] = useState(0)

  const refresh = () => { void api.listSkills().then(setSkills) }
  useEffect(refresh, [])

  const submit = async () => {
    if (!form.name) {
      useErrors.getState().pushError('技能名必填')
      return
    }
    const num = (v: string) => (v === '' ? undefined : Number(v))
    const payload = { name: form.name, class_: form.class_ || undefined,
      cd_ms: num(form.cd_ms), cast_ms: num(form.cast_ms), anim_ms: num(form.anim_ms), pattern: form.pattern }
    const wasCreating = !editing
    if (editing) await api.patchSkill(editing, payload)
    else await api.createSkill(payload)
    setForm({ ...EMPTY }); setEditing(null)
    if (wasCreating) setNewPatternNonce(n => n + 1)
    refresh()
  }

  const edit = (s: Skill) => {
    setEditing(s.id)
    setForm({ name: s.name, class_: s.class ?? '',
      cd_ms: s.cd_ms?.toString() ?? '', cast_ms: s.cast_ms?.toString() ?? '',
      anim_ms: s.anim_ms?.toString() ?? '',
      pattern: s.pattern })
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
                      onClick={() => setDeleteTarget(s)} />
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
            <Field label="Pattern">
              {/* key 换成"正在编辑的技能 id"（新建时固定为一个占位值）：切换编辑
                  目标时强制重新挂载，构建器内部块列表/JSON 草稿状态整体重置，
                  而不是被一个持续盯着 form.pattern 的 effect 半途接管——见
                  PatternBuilder 顶部注释。 */}
              <PatternBuilder key={editing ?? `_new${newPatternNonce}`} value={form.pattern}
                onChange={pattern => setForm(f => ({ ...f, pattern }))} />
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
        </div>
      </Card>

      {deleteTarget && (
        <ConfirmDialog
          title="删除技能"
          body={`确认删除技能「${deleteTarget.name}」？键位绑定、循环与连招 pattern 中对它的引用都将悬挂（指向一个不存在的技能），此操作不可撤销。`}
          confirmLabel="删除"
          onCancel={() => setDeleteTarget(null)}
          onConfirm={async () => {
            const target = deleteTarget
            setDeleteTarget(null)
            await api.deleteSkill(target.id)
            refresh()
          }}
        />
      )}
    </div>
  )
}
