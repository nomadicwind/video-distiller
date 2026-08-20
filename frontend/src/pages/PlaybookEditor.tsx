import { useEffect, useState } from 'react'
import { api } from '../api/client'
import { useErrors } from '../state/errors'
import type { Block, Playbook, PlaybookVersion, Rotation, Section, Skill } from '../api/types'

const swap = <T,>(arr: T[], i: number, j: number): T[] => {
  const out = [...arr]; [out[i], out[j]] = [out[j], out[i]]; return out
}

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

  if (!pb) return <p>加载中…</p>

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

  const blockEditor = (b: Block, si: number, bi: number) => (
    <p key={bi} style={{ border: '1px solid #2a2f3a', padding: 4 }}>
      {b.rotation !== undefined && (<>
        【循环】
        <select value={b.rotation}
          onChange={e => setBlock(si, bi, { rotation: e.target.value })}>
          {rotations.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
        </select>
        ×<input style={{ width: 50 }} type="number" min={1}
          value={b.iterations ?? ''} placeholder="∞"
          onChange={e => setBlock(si, bi, {
            iterations: e.target.value === '' ? undefined : Number(e.target.value) })} />
        <input placeholder="循环条件注释（不可执行）" value={b.repeat_note ?? ''}
          onChange={e => setBlock(si, bi, { repeat_note: e.target.value || undefined })} />
      </>)}
      {b.skill !== undefined && (<>
        【技能】
        <select value={b.skill} onChange={e => setBlock(si, bi, { skill: e.target.value })}>
          {skills.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </>)}
      {b.gap !== undefined && (<>
        等待 <input style={{ width: 70 }} type="number"
          value={b.gap} onChange={e => setBlock(si, bi, { gap: Number(e.target.value) })} /> ms
      </>)}
      {b.note !== undefined && (<>
        备注 <input value={b.note} onChange={e => setBlock(si, bi, { note: e.target.value })} />
      </>)}
      <label> <input type="checkbox" checked={b.pinned ?? false}
        onChange={e => setBlock(si, bi, { pinned: e.target.checked || undefined })} />pinned</label>
      <button onClick={() => moveBlock(si, bi, -1)}>↑</button>
      <button onClick={() => moveBlock(si, bi, 1)}>↓</button>
      <button onClick={() => removeBlock(si, bi)}>删</button>
    </p>
  )

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, padding: 12 }}>
      <div>
        <p><button onClick={onBack}>← 返回</button> <strong>{pb.name}</strong> v{pb.version}</p>
        {sections.map((s, si) => (
          <div key={si} style={{ border: '1px solid #345', margin: '8px 0', padding: 6 }}>
            <p>
              § <input value={s.name}
                onChange={e => setSections(sections.map((x, i) =>
                  i !== si ? x : { ...x, name: e.target.value }))} />
              <button onClick={() => setSections(sections.filter((_, i) => i !== si))}>删段落</button>
            </p>
            {s.body.map((b, bi) => blockEditor(b, si, bi))}
            <p>
              <select value={newKind[si] ?? 'gap'}
                onChange={e => setNewKind({ ...newKind, [si]: e.target.value })}>
                <option value="rotation">循环块</option>
                <option value="skill">技能块</option>
                <option value="gap">等待块</option>
                <option value="note">注释块</option>
              </select>
              <button onClick={() => addBlock(si)}>+ 块</button>
            </p>
          </div>
        ))}
        <p>
          <button onClick={() => setSections([...sections, { name: '新段落', body: [] }])}>+ 段落</button>
          <button onClick={async () => {
            const updated = await api.putPlaybook(pb.id, { sections })
            load(updated)
          }}>保存（v{pb.version + 1}）</button>
        </p>
        <p>
          <select value={rollbackTo} onChange={e => setRollbackTo(e.target.value)}>
            <option value="">历史版本…</option>
            {versions.map(v => <option key={v.version} value={v.version}>v{v.version}</option>)}
          </select>
          <button disabled={!rollbackTo} onClick={async () => {
            const restored = await api.rollbackPlaybook(pb.id, Number(rollbackTo))
            setRollbackTo(''); load(restored)
          }}>回滚到此版本</button>
        </p>
      </div>
      <div>
        <p>
          <button className={tab === 'md' ? 'active' : ''} onClick={() => setTab('md')}>文档预览</button>
          <button className={tab === 'ahk' ? 'active' : ''} onClick={() => setTab('ahk')}>AHK 预览</button>
          <a href={api.playbookExportUrl(pb.id, tab)} download>下载</a>
        </p>
        <pre style={{ whiteSpace: 'pre-wrap', background: '#0e1015', padding: 8,
          maxHeight: '85vh', overflow: 'auto' }}>{preview}</pre>
      </div>
    </div>
  )
}
