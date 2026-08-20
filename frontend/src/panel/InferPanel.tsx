import { useCallback, useEffect, useState } from 'react'
import { api } from '../api/client'
import type { Conflict, DiscoverResult, InferResult, Proposal, Rotation, Section, Skill } from '../api/types'
import { seekMs } from '../player/Player'
import { useSession } from '../state/store'
import { fmtTc } from '../time/frames'

const conflictText = (c: Conflict): string => {
  if (c.type === 'undefined_skill') return `目录缺定义：「${c.label}」`
  if (c.type === 'no_l0') return `「${c.label}」附近 500ms 内没有 L0 操作`
  return `三方冲突：L0 按键「${c.l0_key}」· L1「${c.l1_label}」· 键位期望 ${c.keymap_expected?.join('/')}`
}

export function InferPanel() {
  const analysis = useSession(s => s.analysis)
  const [infer, setInfer] = useState<InferResult | null>(null)
  const [discover, setDiscover] = useState<DiscoverResult | null>(null)
  const [proposals, setProposals] = useState<Proposal[]>([])
  const [skills, setSkills] = useState<Skill[]>([])
  const [rotations, setRotations] = useState<Rotation[]>([])
  const [blockChecks, setBlockChecks] = useState<Record<string, boolean>>({})

  useEffect(() => { void api.listSkills().then(setSkills) }, [])
  useEffect(() => { void api.listRotations().then(setRotations) }, [proposals.length])

  const refreshProposals = useCallback(() => {
    if (analysis) void api.listProposals(analysis.id).then(setProposals)
  }, [analysis])

  useEffect(() => { refreshProposals() }, [analysis?.id, refreshProposals])  // eslint-disable-line react-hooks/exhaustive-deps

  if (!analysis) return null
  const names = new Map(skills.map(s => [s.id, s.name]))

  const bodyText = (p: Proposal) =>
    (p.payload.body ?? []).map(item =>
      'skill' in item ? (names.get(item.skill as string) ?? item.skill)
        : 'gap' in item ? `等待${item.gap}ms`
          : `${item.op} ${item.key ?? ''}`).join(' → ')

  const rotName = (id: string) => rotations.find(r => r.id === id)?.name ?? id
  const blockKey = (pid: string, si: number, bi: number) => `${pid}:${si}:${bi}`
  const isChecked = (k: string) => blockChecks[k] !== false

  const adjudicated = (p: Proposal): Section[] =>
    (p.payload.sections ?? [])
      .map((s, si) => ({
        name: s.name,
        body: s.body.filter((_, bi) => isChecked(blockKey(p.id, si, bi))),
      }))
      .filter(s => s.body.length > 0)

  return (
    <div className="entry-panel">
      <h3>推断</h3>
      <p>
        <button onClick={() => void api.runInfer(analysis.id).then(setInfer)}>运行对齐</button>
        <button onClick={async () => {
          const d = await api.runDiscover(analysis.id)
          setDiscover(d); refreshProposals()
        }}>发现循环</button>
        <button onClick={async () => { await api.runCompose(analysis.id); refreshProposals() }}>编排方案</button>
      </p>
      {infer && (
        <div>
          <p>对齐 {infer.links.length} 条 · 补区间提议 {infer.span_proposals.length} 个</p>
          {infer.conflicts.map((c, i) => (
            <p key={i} style={{ color: '#f80', cursor: 'pointer' }}
              onClick={() => seekMs(c.t_ms)}>
              ⚠ [{fmtTc(c.t_ms)}] {conflictText(c)}
            </p>
          ))}
          {infer.keymap_suggestions.map((s, i) => (
            <p key={i} style={{ color: '#8cf' }}>
              💡 反推：{names.get(s.skill_id) ?? s.skill_id} → 键「{s.key}」（{s.support}/{s.total} 次共现）
            </p>
          ))}
        </div>
      )}
      {discover && (
        <p style={{ color: '#888' }}>
          未匹配操作 {discover.unmatched} 个
          {discover.ambiguities.length > 0 && ` · 歧义 ${discover.ambiguities.length} 处（需人工裁决）`}
        </p>
      )}
      {proposals.map(p => (
        <div key={p.id} style={{ border: '1px solid #345', margin: '6px 0', padding: 6 }}>
          <strong>{p.payload.name}</strong>
          <span style={{ float: 'right' }}>
            {p.status === 'pending' ? '待裁决' : p.status === 'accepted' ? '✅ 已接受' : '❌ 已拒绝'}
          </span>
          <p>{p.payload.note}</p>
          {p.kind === 'rotation' ? (
            <>
              <p style={{ color: '#9c9' }}>
                覆盖率 {(p.report.coverage! * 100).toFixed(0)}% ·
                完整 {p.report.complete}/{p.report.iterations} 次迭代
              </p>
              <p style={{ color: '#aaa' }}>{bodyText(p)}</p>
              {p.report.warnings?.map((w, i) => <p key={i} style={{ color: '#f80' }}>⚠ {w}</p>)}
              {p.status === 'pending' && (
                <p>
                  <button onClick={async () => { await api.acceptProposal(p.id); refreshProposals() }}>接受</button>
                  <button onClick={async () => { await api.rejectProposal(p.id); refreshProposals() }}>拒绝</button>
                </p>
              )}
            </>
          ) : (
            <>
              {(p.payload.sections ?? []).map((s, si) => (
                <div key={si}>
                  <strong>§ {s.name}</strong>
                  {s.body.map((b, bi) => (
                    <p key={bi}>
                      <label>
                        <input type="checkbox"
                          checked={isChecked(blockKey(p.id, si, bi))}
                          disabled={p.status !== 'pending'}
                          onChange={e => setBlockChecks({
                            ...blockChecks, [blockKey(p.id, si, bi)]: e.target.checked })} />
                        {b.rotation ? `【循环】${rotName(b.rotation)}` : JSON.stringify(b)}
                      </label>
                    </p>
                  ))}
                </div>
              ))}
              {p.status === 'pending' && (
                <p>
                  <button
                    disabled={adjudicated(p).length === 0}
                    onClick={async () => { await api.acceptProposal(p.id, adjudicated(p)); refreshProposals() }}>
                    接受勾选块
                  </button>
                  <button onClick={async () => { await api.rejectProposal(p.id); refreshProposals() }}>拒绝</button>
                </p>
              )}
            </>
          )}
        </div>
      ))}
    </div>
  )
}
