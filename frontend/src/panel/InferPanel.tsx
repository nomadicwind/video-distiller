import { useCallback, useEffect, useState } from 'react'
import { AlignHorizontalDistributeCenter, ListOrdered, Repeat } from 'lucide-react'
import { api } from '../api/client'
import { isDegradedProposal } from '../api/degraded'
import type { Conflict, DiscoverResult, InferResult, Proposal, Rotation, Section, Skill } from '../api/types'
import { seekMs } from '../player/Player'
import { useSession } from '../state/store'
import { fmtTc } from '../time/frames'
import { Badge } from '../ui/Badge'
import { Button } from '../ui/Button'
import { Card } from '../ui/Card'
import { Tooltip } from '../ui/Tooltip'

const conflictText = (c: Conflict): string => {
  if (c.type === 'undefined_skill') return `目录缺定义：「${c.label}」`
  if (c.type === 'no_l0') return `「${c.label}」附近 500ms 内没有 L0 操作`
  return `三方冲突：L0 按键「${c.l0_key}」· L1「${c.l1_label}」· 键位期望 ${c.keymap_expected?.join('/')}`
}

const STATUS_BADGE: Record<Proposal['status'], 'accent' | 'success' | 'danger'> = {
  pending: 'accent', accepted: 'success', rejected: 'danger',
}
const STATUS_LABEL: Record<Proposal['status'], string> = {
  pending: '待裁决', accepted: '已接受', rejected: '已拒绝',
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
      <div className="infer-toolbar">
        <Button variant="ghost" icon={<AlignHorizontalDistributeCenter />}
          onClick={() => void api.runInfer(analysis.id).then(setInfer)}>运行对齐</Button>
        <Button variant="ghost" icon={<Repeat />}
          onClick={async () => {
            const d = await api.runDiscover(analysis.id)
            setDiscover(d); refreshProposals()
          }}>发现循环</Button>
        <Button variant="ghost" icon={<ListOrdered />}
          onClick={async () => { await api.runCompose(analysis.id); refreshProposals() }}>编排方案</Button>
      </div>

      {infer && (
        <Card title="对齐结果">
          <div className="align-card">
            <p className="align-summary">对齐 {infer.links.length} 条 · 补区间提议 {infer.span_proposals.length} 个</p>
            {infer.conflicts.map((c, i) => (
              <div key={i} className="align-conflict" onClick={() => seekMs(c.t_ms)}>
                <span className="mono">{fmtTc(c.t_ms)}</span>
                <span>{conflictText(c)}</span>
              </div>
            ))}
            {infer.keymap_suggestions.map((s, i) => (
              <p key={i} className="align-suggestion">
                反推：{names.get(s.skill_id) ?? s.skill_id} → 键「{s.key}」（{s.support}/{s.total} 次共现）
              </p>
            ))}
          </div>
        </Card>
      )}

      {discover && (
        <p className="align-unmatched">
          未匹配操作 {discover.unmatched} 个
          {discover.ambiguities.length > 0 && ` · 歧义 ${discover.ambiguities.length} 处（需人工裁决）`}
        </p>
      )}

      <div className="proposal-list">
        {proposals.map(p => {
          const degraded = isDegradedProposal(p)
          return (
            <Card key={p.id} title={p.payload.name}
              extra={<Badge kind={STATUS_BADGE[p.status]}>{STATUS_LABEL[p.status]}</Badge>}>
              {degraded ? (
                <div className="proposal-degraded">
                  <Tooltip tip={p.payload.note} wrap>
                    <Badge kind="warn">LLM 降级</Badge>
                  </Tooltip>
                </div>
              ) : p.payload.note ? (
                <p className="proposal-note">{p.payload.note}</p>
              ) : null}

              {p.kind === 'rotation' ? (
                <>
                  <div className="proposal-coverage">
                    <div className="progress-bar">
                      <div className="progress-bar-fill"
                        style={{ width: `${Math.round((p.report.coverage ?? 0) * 100)}%` }} />
                    </div>
                    <span className="mono proposal-coverage-label">
                      完整 {p.report.complete}/{p.report.iterations} 次迭代
                    </span>
                  </div>
                  <p className="proposal-body-chain">{bodyText(p)}</p>
                  {p.report.warnings?.map((w, i) => <p key={i} className="proposal-warning">⚠ {w}</p>)}
                  {p.status === 'pending' && (
                    <div className="proposal-actions">
                      <Button variant="primary"
                        onClick={async () => { await api.acceptProposal(p.id); refreshProposals() }}>接受</Button>
                      <Button variant="danger"
                        onClick={async () => { await api.rejectProposal(p.id); refreshProposals() }}>拒绝</Button>
                    </div>
                  )}
                </>
              ) : (
                <>
                  {(p.payload.sections ?? []).map((s, si) => (
                    <div key={si} className="proposal-section">
                      <div className="proposal-section-title">§ {s.name}</div>
                      {s.body.map((b, bi) => (
                        <label key={bi} className="proposal-block-row">
                          <input type="checkbox"
                            checked={isChecked(blockKey(p.id, si, bi))}
                            disabled={p.status !== 'pending'}
                            onChange={e => setBlockChecks({
                              ...blockChecks, [blockKey(p.id, si, bi)]: e.target.checked })} />
                          <span>{b.rotation ? `【循环】${rotName(b.rotation)}` : JSON.stringify(b)}</span>
                        </label>
                      ))}
                    </div>
                  ))}
                  {p.status === 'pending' && (
                    <div className="proposal-actions">
                      <Button variant="primary"
                        disabled={adjudicated(p).length === 0}
                        onClick={async () => { await api.acceptProposal(p.id, adjudicated(p)); refreshProposals() }}>
                        接受勾选块
                      </Button>
                      <Button variant="danger"
                        onClick={async () => { await api.rejectProposal(p.id); refreshProposals() }}>拒绝</Button>
                    </div>
                  )}
                </>
              )}
            </Card>
          )
        })}
      </div>
    </div>
  )
}
