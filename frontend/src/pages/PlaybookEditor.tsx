import { useEffect, useState } from 'react'
import { ArrowLeft, ChevronDown, ChevronUp, Download, Plus, RotateCcw, Save, Trash2 } from 'lucide-react'
import { api } from '../api/client'
import { useErrors } from '../state/errors'
import type { Block, Playbook, PlaybookVersion, Rotation, Section, Skill } from '../api/types'
import { Badge } from '../ui/Badge'
import { Button } from '../ui/Button'
import { Card } from '../ui/Card'
import { Tabs } from '../ui/Tabs'

const swap = <T,>(arr: T[], i: number, j: number): T[] => {
  const out = [...arr]; [out[i], out[j]] = [out[j], out[i]]; return out
}

type BlockKind = 'rotation' | 'skill' | 'gap' | 'note'
const blockKind = (b: Block): BlockKind =>
  b.rotation !== undefined ? 'rotation'
    : b.skill !== undefined ? 'skill'
      : b.note !== undefined ? 'note' : 'gap'

/** 块类型 → 轨道色系徽章（spec §7：循环 accent/技能 lane-l1/等待 neutral/注释 warn）。 */
const BLOCK_BADGE_KIND: Record<BlockKind, 'accent' | 'lane-l1' | 'neutral' | 'warn'> = {
  rotation: 'accent', skill: 'lane-l1', gap: 'neutral', note: 'warn',
}
const BLOCK_BADGE_LABEL: Record<BlockKind, string> = {
  rotation: '循环', skill: '技能', gap: '等待', note: '注释',
}

const PREVIEW_TABS = [{ key: 'md', label: '文档' }, { key: 'ahk', label: 'AHK' }]

export function PlaybookEditor({ playbookId, onBack }: {
  playbookId: string; onBack: () => void
}) {
  const [pb, setPb] = useState<Playbook | null>(null)
  const [sections, setSections] = useState<Section[]>([])
  const [versions, setVersions] = useState<PlaybookVersion[]>([])
  const [rollbackTo, setRollbackTo] = useState('')
  const [skills, setSkills] = useState<Skill[]>([])
  const [rotations, setRotations] = useState<Rotation[]>([])
  const [tab, setTab] = useState<'md' | 'ahk'>('md')
  const [preview, setPreview] = useState('')
  const [newKind, setNewKind] = useState<Record<number, string>>({})

  const load = (p: Playbook) => {
    setPb(p)
    setSections(structuredClone(p.sections))
    void api.playbookVersions(p.id).then(setVersions)
  }
  useEffect(() => {
    void api.getPlaybook(playbookId).then(load)
    void api.listSkills().then(setSkills)
    void api.listRotations().then(setRotations)
  }, [playbookId])
  useEffect(() => {
    if (!pb) return
    void fetch(api.playbookExportUrl(pb.id, tab)).then(async r => {
      if (!r.ok) {
        const text = await r.text()
        useErrors.getState().pushError(`Export ${r.status}: ${text.slice(0, 200)}`)
        setPreview('加载失败')
        return
      }
      return r.text().then(setPreview)
    })
  }, [pb?.version, tab])  // eslint-disable-line react-hooks/exhaustive-deps

  if (!pb) return <p className="pb-muted">加载中…</p>

  const setBlock = (si: number, bi: number, patch: Partial<Block>) =>
    setSections(sections.map((s, i) => i !== si ? s : {
      ...s, body: s.body.map((b, j) => j !== bi ? b : { ...b, ...patch }) }))
  const removeBlock = (si: number, bi: number) =>
    setSections(sections.map((s, i) => i !== si ? s : {
      ...s, body: s.body.filter((_, j) => j !== bi) }))
  const moveBlock = (si: number, bi: number, dir: -1 | 1) => {
    const body = sections[si].body
    const j = bi + dir
    if (j < 0 || j >= body.length) return
    setSections(sections.map((s, i) => i !== si ? s : { ...s, body: swap(body, bi, j) }))
  }
  const addBlock = (si: number) => {
    const kind = newKind[si] ?? 'gap'
    const block: Block =
      kind === 'rotation' ? { rotation: rotations[0]?.id ?? '' }
        : kind === 'skill' ? { skill: skills[0]?.id ?? '' }
          : kind === 'note' ? { note: '' } : { gap: 100 }
    setSections(sections.map((s, i) => i !== si ? s : { ...s, body: [...s.body, block] }))
  }

  const blockEditor = (b: Block, si: number, bi: number, total: number) => {
    const kind = blockKind(b)
    return (
      <div key={bi} className="pbe-block-row">
        <Badge kind={BLOCK_BADGE_KIND[kind]}>{BLOCK_BADGE_LABEL[kind]}</Badge>
        <div className="pbe-block-controls">
          {b.rotation !== undefined && (<>
            <select value={b.rotation}
              onChange={e => setBlock(si, bi, { rotation: e.target.value })}>
              {rotations.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
            ×<input type="number" min={1}
              value={b.iterations ?? ''} placeholder="∞"
              onChange={e => setBlock(si, bi, {
                iterations: e.target.value === '' ? undefined : Number(e.target.value) })} />
            <input placeholder="循环条件注释（不可执行）" value={b.repeat_note ?? ''}
              onChange={e => setBlock(si, bi, { repeat_note: e.target.value || undefined })} />
          </>)}
          {b.skill !== undefined && (
            <select value={b.skill} onChange={e => setBlock(si, bi, { skill: e.target.value })}>
              {skills.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          )}
          {b.gap !== undefined && (<>
            等待 <input type="number"
              value={b.gap} onChange={e => setBlock(si, bi, { gap: Number(e.target.value) })} /> ms
          </>)}
          {b.note !== undefined && (
            <input placeholder="备注" value={b.note} onChange={e => setBlock(si, bi, { note: e.target.value })} />
          )}
        </div>
        <label className="pbe-block-pinned">
          <input type="checkbox" checked={b.pinned ?? false}
            onChange={e => setBlock(si, bi, { pinned: e.target.checked || undefined })} />
          pinned
        </label>
        <div className="pbe-block-actions">
          <Button variant="icon" size="sm" icon={<ChevronUp />} tip="上移"
            disabled={bi === 0} onClick={() => moveBlock(si, bi, -1)} />
          <Button variant="icon" size="sm" icon={<ChevronDown />} tip="下移"
            disabled={bi === total - 1} onClick={() => moveBlock(si, bi, 1)} />
          <Button variant="danger" size="sm" icon={<Trash2 />} tip="删块"
            onClick={() => removeBlock(si, bi)} />
        </div>
      </div>
    )
  }

  return (
    <div className="pbe-page">
      <div className="pbe-title-row">
        <Button variant="ghost" size="sm" icon={<ArrowLeft />} onClick={onBack}>返回</Button>
        <h1>{pb.name}</h1>
        <Badge kind="accent">v{pb.version}</Badge>
      </div>

      <div className="pbe-grid">
        <div className="pbe-editor">
          <div className="pbe-sections">
            {sections.map((s, si) => (
              <Card key={si}
                title={
                  <input className="pbe-section-name" value={s.name}
                    onChange={e => setSections(sections.map((x, i) =>
                      i !== si ? x : { ...x, name: e.target.value }))} />
                }
                extra={
                  <Button variant="danger" size="sm" icon={<Trash2 />}
                    onClick={() => setSections(sections.filter((_, i) => i !== si))}>
                    删段落
                  </Button>
                }>
                <div className="pbe-blocks">
                  {s.body.map((b, bi) => blockEditor(b, si, bi, s.body.length))}
                </div>
                <div className="pbe-add-row">
                  <select value={newKind[si] ?? 'gap'}
                    onChange={e => setNewKind({ ...newKind, [si]: e.target.value })}>
                    <option value="rotation">循环块</option>
                    <option value="skill">技能块</option>
                    <option value="gap">等待块</option>
                    <option value="note">注释块</option>
                  </select>
                  <Button variant="ghost" icon={<Plus />} onClick={() => addBlock(si)}>+ 块</Button>
                </div>
              </Card>
            ))}
          </div>

          <div className="pbe-editor-actions">
            <Button variant="ghost" icon={<Plus />}
              onClick={() => setSections([...sections, { name: '新段落', body: [] }])}>
              + 段落
            </Button>
            <Button variant="primary" icon={<Save />}
              onClick={async () => {
                const updated = await api.putPlaybook(pb.id, { sections })
                load(updated)
              }}>
              保存（v{pb.version + 1}）
            </Button>
          </div>

          <Card title="版本" extra={<Badge kind="accent">当前 v{pb.version}</Badge>}>
            <div className="pbe-versions-row">
              <select value={rollbackTo} onChange={e => setRollbackTo(e.target.value)}>
                <option value="">历史版本…</option>
                {versions.map(v => <option key={v.version} value={v.version}>v{v.version}</option>)}
              </select>
              <Button variant="danger" icon={<RotateCcw />} disabled={!rollbackTo}
                onClick={async () => {
                  const restored = await api.rollbackPlaybook(pb.id, Number(rollbackTo))
                  setRollbackTo(''); load(restored)
                }}>
                回滚到此版本
              </Button>
            </div>
          </Card>
        </div>

        <div className="pbe-preview-col">
          <Card>
            <div className="pbe-preview-toolbar">
              <Tabs tabs={PREVIEW_TABS} active={tab} onChange={k => setTab(k as 'md' | 'ahk')} />
              {/* download 需要原生 <a download>；沿用 .btn 类名以保持与 Button 组件一致的视觉 */}
              <a className="btn btn-icon btn-icon-only" href={api.playbookExportUrl(pb.id, tab)}
                download title="下载预览">
                <span className="btn-icon-glyph"><Download /></span>
              </a>
            </div>
            <pre className="preview mono">{preview}</pre>
          </Card>
        </div>
      </div>
    </div>
  )
}
