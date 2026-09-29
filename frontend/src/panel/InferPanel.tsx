import type { ReactNode } from 'react'
import { useCallback, useEffect, useState } from 'react'
import {
  AlignHorizontalDistributeCenter, CheckCircle2, ListOrdered, ListTree, Repeat, XCircle,
} from 'lucide-react'
import { api } from '../api/client'
import { isDegradedProposal } from '../api/degraded'
import type { Conflict, DiscoverResult, InferResult, Keymap, Proposal, Rotation, Section, Skill } from '../api/types'
import { coverageOf } from '../infer/readiness'
import { seekMs } from '../player/Player'
import { useSession } from '../state/store'
import { fmtTc } from '../time/frames'
import { Badge } from '../ui/Badge'
import { Button } from '../ui/Button'
import { Card } from '../ui/Card'
import { EmptyState } from '../ui/EmptyState'
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

/** 就绪检查单行——红=硬阻塞（图标+文字，不单靠颜色）、黄=仅提示不阻塞按钮。 */
function ReadinessRow({ ok, warnOnly, icon, text, action }: {
  ok: boolean
  warnOnly?: boolean
  icon: ReactNode
  text: ReactNode
  action?: ReactNode
}): JSX.Element {
  const cls = ok ? 'readiness-row-ok' : warnOnly ? 'readiness-row-warn' : 'readiness-row-bad'
  return (
    <div className={`readiness-row ${cls}`}>
      <span className="readiness-row-icon">{icon}</span>
      <span className="readiness-row-text">{text}</span>
      {action && <span className="readiness-row-action">{action}</span>}
    </div>
  )
}

/** onGotoAnnotate：切到标注页签这件事只有 Inspector（App.tsx）知道怎么做
 * ——见那边的调用点注释。 */
export function InferPanel({ onGotoAnnotate }: { onGotoAnnotate: () => void }) {
  const analysis = useSession(s => s.analysis)
  const selectLane = useSession(s => s.selectLane)
  const [infer, setInfer] = useState<InferResult | null>(null)
  const [discover, setDiscover] = useState<DiscoverResult | null>(null)
  const [proposals, setProposals] = useState<Proposal[]>([])
  const [skills, setSkills] = useState<Skill[]>([])
  const [rotations, setRotations] = useState<Rotation[]>([])
  const [keymaps, setKeymaps] = useState<Keymap[]>([])
  const [blockChecks, setBlockChecks] = useState<Record<string, boolean>>({})
  const [busy, setBusy] = useState<null | 'align' | 'discover' | 'compose'>(null)

  useEffect(() => { void api.listSkills().then(setSkills) }, [])
  useEffect(() => { void api.listRotations().then(setRotations) }, [proposals.length])
  useEffect(() => { void api.listKeymaps().then(setKeymaps) }, [])

  const refreshProposals = useCallback(() => {
    if (analysis) void api.listProposals(analysis.id).then(setProposals)
  }, [analysis])

  useEffect(() => { refreshProposals() }, [analysis?.id, refreshProposals])  // eslint-disable-line react-hooks/exhaustive-deps

  if (!analysis) return null
  const names = new Map(skills.map(s => [s.id, s.name]))

  // 就绪引导卡（M14 任务 3 brief §要点）：数据全部来自既有 GET 接口/store，
  // 这里不产生任何写操作。「L0 当前 take」= L0 泳道最后一个 take（与
  // selectLane 的"换泳道即取最后一个 take"是同一语义，见 state/store.ts），
  // 与用户此刻实际选中哪条泳道无关——就绪与否不该因为用户正看着 L1/L2 而
  // 显示错误的答案。
  const l0Lane = analysis.lanes.find(l => l.layer === 'L0')
  const l0Take = l0Lane && l0Lane.takes.length > 0 ? l0Lane.takes[l0Lane.takes.length - 1] : null
  const l0Marks = l0Take?.marks ?? []
  const l0Labels = [...new Set(
    l0Marks.filter((m): m is typeof m & { label: string } => m.kind === 'input' && !!m.label).map(m => m.label))]

  const boundKeymap = analysis.keymap_id != null
    ? keymaps.find(k => k.id === analysis.keymap_id && k.version === analysis.keymap_version)
    : undefined
  const coverage = coverageOf(l0Labels, boundKeymap?.binds ?? {})

  const keymapReady = analysis.keymap_id != null
  const marksReady = l0Marks.length > 0
  const ready = keymapReady && marksReady
  const notReadyReason = !keymapReady && !marksReady
    ? '键位未绑定且 L0 无标注——先完成上方就绪检查'
    : !keymapReady ? '键位未绑定——先在顶栏选择键位'
      : !marksReady ? 'L0 当前 take 无标注——先去标注页录入操作序列'
        : undefined

  const focusKeymapSelect = () => {
    const el = document.getElementById('workbench-keymap-select')
    el?.scrollIntoView({ block: 'center' })
    el?.focus()
  }
  const gotoAnnotate = () => {
    if (l0Lane) selectLane(l0Lane.id)
    onGotoAnnotate()
  }

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
      <Card title="推断就绪检查">
        <div className="readiness-card">
          <ReadinessRow ok={keymapReady}
            icon={keymapReady ? <CheckCircle2 size={14} /> : <XCircle size={14} />}
            text={keymapReady
              ? `键位已绑定：${analysis.keymap_id} v${analysis.keymap_version}`
              : '键位未绑定——对齐/发现循环都需要键位表才能把 L0 按键对应到技能'}
            action={!keymapReady && (
              <Button variant="ghost" size="sm" onClick={focusKeymapSelect}>去绑定键位</Button>
            )} />
          <ReadinessRow ok={marksReady}
            icon={marksReady ? <CheckCircle2 size={14} /> : <XCircle size={14} />}
            text={marksReady
              ? `L0 当前 take 已有 ${l0Marks.length} 条标注`
              : 'L0 当前 take 还没有任何标注——请先录入操作序列'}
            action={!marksReady && (
              <Button variant="ghost" size="sm" onClick={gotoAnnotate}>去标注</Button>
            )} />
          <ReadinessRow ok={l0Labels.length > 0 && coverage.uncovered.length === 0} warnOnly
            icon={<ListTree size={14} />}
            text={l0Labels.length === 0
              ? '键位表覆盖：暂无 L0 标签可供比对'
              : `键位表覆盖：${coverage.covered.length}/${l0Labels.length} 个 L0 标签有对应绑定`} />
          {coverage.uncovered.length > 0 && (
            <div className="readiness-uncovered">
              {coverage.uncovered.map(label => <Badge key={label} kind="warn">{label}</Badge>)}
            </div>
          )}
        </div>
      </Card>

      <div className="infer-toolbar">
        <Button variant="ghost" icon={<AlignHorizontalDistributeCenter />} disabled={busy !== null || !ready}
          tip={!ready ? notReadyReason : undefined}
          onClick={async () => {
            if (busy) return
            setBusy('align')
            try { await api.runInfer(analysis.id).then(setInfer) } finally { setBusy(null) }
          }}>{busy === 'align' ? '运行中…' : '运行对齐'}</Button>
        <Button variant="ghost" icon={<Repeat />} disabled={busy !== null || !ready}
          tip={!ready ? notReadyReason : undefined}
          onClick={async () => {
            if (busy) return
            setBusy('discover')
            try {
              const d = await api.runDiscover(analysis.id)
              setDiscover(d); refreshProposals()
            } finally { setBusy(null) }
          }}>{busy === 'discover' ? '发现中…' : '发现循环'}</Button>
        <Button variant="ghost" icon={<ListOrdered />} disabled={busy !== null || !ready}
          tip={!ready ? notReadyReason : undefined}
          onClick={async () => {
            if (busy) return
            setBusy('compose')
            try { await api.runCompose(analysis.id); refreshProposals() } finally { setBusy(null) }
          }}>{busy === 'compose' ? '编排中…' : '编排方案'}</Button>
      </div>

      {!infer && !discover && proposals.length === 0 && (
        <Card title="推断结果">
          <EmptyState icon={<AlignHorizontalDistributeCenter />}
            text="尚无推断结果——点击上方按钮开始运行对齐、发现循环或编排方案" />
        </Card>
      )}

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
