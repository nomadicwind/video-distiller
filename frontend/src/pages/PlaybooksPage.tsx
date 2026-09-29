import { useEffect, useRef, useState } from 'react'
import { Download, Pencil, Repeat, Workflow } from 'lucide-react'
import { api } from '../api/client'
import { isDegradedRotation } from '../api/degraded'
import type { Playbook, Rotation } from '../api/types'
import { Badge } from '../ui/Badge'
import { Button } from '../ui/Button'
import { Card } from '../ui/Card'
import { EmptyState } from '../ui/EmptyState'
import { Tooltip } from '../ui/Tooltip'

/** 备注列非降级噪声时的显示上限（M5 复查修复 #2）：整段截断到约 40 字符，
 * 完整原文走 title 原生 tooltip。 */
const NOTE_ELLIPSIS_LEN = 40
const ellipsize = (s: string): string =>
  s.length > NOTE_ELLIPSIS_LEN ? `${s.slice(0, NOTE_ELLIPSIS_LEN)}…` : s

/** 「LLM 降级」徽章 tooltip（M14 任务 4）：raw note 仍是有用的调试信息（M5
 * 复查修复 #2 的初衷），但用户第一眼要看懂的是"这是占位名，点旁边铅笔能
 * 重命名"，所以把两句拼在一起而不是只抛一段原始异常/鉴权拒绝文本。 */
const degradedTip = (note: string | null): string =>
  note
    ? `LLM 命名失败，已使用占位名——点击右侧铅笔可重命名。原始信息：${note}`
    : 'LLM 命名失败，已使用占位名——点击右侧铅笔可重命名。'

type ExportFmt = 'md' | 'ahk' | 'plan' | 'razer'
const EXPORT_FORMATS: { fmt: ExportFmt; label: string }[] = [
  { fmt: 'md', label: 'MD' },
  { fmt: 'ahk', label: 'AHK' },
  { fmt: 'plan', label: 'PLAN' },
  { fmt: 'razer', label: 'RZR' },
]

/** 行内导出按钮组（M14 任务 4：紧凑药丸 + 统一 Download 图标，替换纯文字
 * 链接——四种格式没有各自成熟的图标语汇，硬造一套图标分类比共用一个更容易
 * 认错，"下载"本身才是这组按钮共同的动作语义）。 */
function ExportChips({ urlFor }: { urlFor: (fmt: ExportFmt) => string }): JSX.Element {
  return (
    <div className="export-chips">
      {EXPORT_FORMATS.map(({ fmt, label }) => (
        <a key={fmt} className="export-chip" href={urlFor(fmt)} target="_blank" rel="noreferrer">
          <Download size={11} />{label}
        </a>
      ))}
    </div>
  )
}

export function PlaybooksPage({ onBack, onEdit }: {
  onBack: () => void; onEdit: (id: string) => void
}) {
  // TopBar 导航已常驻，页内不再自带 ← 返回（spec §7）；onBack 只在空态的
  // "去资料库打开视频" 行动按钮里复用（M14 任务 4：空态=说明+行动，不能是
  // 纯灰字死端）。
  const [rotations, setRotations] = useState<Rotation[]>([])
  const [playbooks, setPlaybooks] = useState<Playbook[]>([])
  const [editingId, setEditingId] = useState<string | null>(null)
  const cancelingRef = useRef(false)
  const refreshRotations = () => api.listRotations().then(setRotations)
  useEffect(() => {
    void refreshRotations()
    void api.listPlaybooks().then(setPlaybooks)
  }, [])

  const saveRename = async (id: string, value: string) => {
    const name = value.trim()
    if (!name) return
    await api.patchRotation(id, { name })
    await refreshRotations()
  }

  return (
    <div className="page">
      <div className="page-head">
        <h1>循环与方案</h1>
        <p className="page-sub">循环（L3）由工作台「发现循环」产出；方案（L4）在编辑器中编排段落与块</p>
      </div>

      <Card title="循环（L3）">
        {rotations.length === 0 ? (
          <EmptyState icon={<Repeat />} text="还没有循环——去工作台「发现循环」并接受一个"
            action={<Button variant="primary" size="sm" onClick={onBack}>去资料库打开视频</Button>} />
        ) : (
          <div className="row-card-list">
            {rotations.map(r => (
              <div key={r.id} className="row-card">
                <div className="row-card-main">
                  {editingId === r.id ? (
                    <input
                      autoFocus
                      defaultValue={r.name}
                      onKeyDown={e => {
                        if (e.key === 'Enter') {
                          e.currentTarget.blur()
                        } else if (e.key === 'Escape') {
                          // Route Escape through the same blur() path as Enter/click-away
                          // instead of closing via setEditingId(null) directly: unmounting
                          // the input as a side effect of a state update does NOT reliably
                          // fire a delegated onBlur in React, so a flag set here could get
                          // stuck true and silently swallow the next row's save. Explicitly
                          // blurring first guarantees onBlur runs synchronously and consumes
                          // the flag before anything unmounts.
                          cancelingRef.current = true
                          e.currentTarget.blur()
                        }
                      }}
                      onBlur={e => {
                        // Always close on blur; only the save is conditional. Consuming
                        // the flag here (read + reset in one step) means it can never
                        // leak into a later, unrelated edit session.
                        const canceled = cancelingRef.current
                        cancelingRef.current = false
                        const value = e.currentTarget.value
                        setEditingId(null)
                        if (!canceled) void saveRename(r.id, value)
                      }}
                    />
                  ) : (
                    <span className="pb-name-cell">
                      {r.name}
                      <Button variant="icon" size="sm" tip="重命名" icon={<Pencil />}
                        onClick={() => { cancelingRef.current = false; setEditingId(r.id) }} />
                    </span>
                  )}
                </div>
                <div className="row-card-meta pb-muted">
                  {isDegradedRotation(r) ? (
                    <Tooltip tip={degradedTip(r.note)} wrap>
                      <Badge kind="warn">LLM 降级</Badge>
                    </Tooltip>
                  ) : r.note ? (
                    <span title={r.note}>{ellipsize(r.note)}</span>
                  ) : '—'}
                </div>
                <div className="row-card-actions">
                  <ExportChips urlFor={fmt => api.rotationExportUrl(r.id, fmt)} />
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card title="方案（L4）">
        {playbooks.length === 0 ? (
          <EmptyState icon={<Workflow />} text="还没有方案——工作台「编排方案」或接受一个 playbook 提案"
            action={<Button variant="primary" size="sm" onClick={onBack}>去资料库打开视频</Button>} />
        ) : (
          <div className="row-card-list">
            {playbooks.map(pb => (
              <div key={pb.id} className="row-card">
                <div className="row-card-main">
                  {pb.name} <span className="mono pb-muted">v{pb.version}</span>
                </div>
                <div className="row-card-actions">
                  <ExportChips urlFor={fmt => api.playbookExportUrl(pb.id, fmt)} />
                  <Button variant="primary" size="sm" icon={<Pencil />} onClick={() => onEdit(pb.id)}>
                    编辑
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  )
}
