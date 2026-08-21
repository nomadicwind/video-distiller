import { useEffect, useState } from 'react'
import { Pencil, Repeat, Workflow } from 'lucide-react'
import { api } from '../api/client'
import type { Playbook, Rotation } from '../api/types'
import { Button } from '../ui/Button'
import { Card } from '../ui/Card'
import { EmptyState } from '../ui/EmptyState'

type ExportFmt = 'md' | 'ahk' | 'plan' | 'razer'
const EXPORT_FORMATS: { fmt: ExportFmt; label: string }[] = [
  { fmt: 'md', label: 'MD' },
  { fmt: 'ahk', label: 'AHK' },
  { fmt: 'plan', label: 'PLAN' },
  { fmt: 'razer', label: 'RZR' },
]

/** 行内导出徽章链（spec §7）：MD/AHK/PLAN/RZR 四个 mono 药丸链接，hover 提亮为 accent。 */
function ExportChips({ urlFor }: { urlFor: (fmt: ExportFmt) => string }): JSX.Element {
  return (
    <div className="export-chips">
      {EXPORT_FORMATS.map(({ fmt, label }) => (
        <a key={fmt} className="export-chip" href={urlFor(fmt)} target="_blank" rel="noreferrer">
          {label}
        </a>
      ))}
    </div>
  )
}

export function PlaybooksPage({ onBack, onEdit }: {
  onBack: () => void; onEdit: (id: string) => void
}) {
  void onBack // TopBar 导航已常驻，页内不再自带 ← 返回（spec §7）
  const [rotations, setRotations] = useState<Rotation[]>([])
  const [playbooks, setPlaybooks] = useState<Playbook[]>([])
  useEffect(() => {
    void api.listRotations().then(setRotations)
    void api.listPlaybooks().then(setPlaybooks)
  }, [])

  return (
    <div className="page">
      <div className="page-head">
        <h1>循环与方案</h1>
        <p className="page-sub">循环（L3）由工作台「发现循环」产出；方案（L4）在编辑器中编排段落与块</p>
      </div>

      <Card title="循环（L3）">
        {rotations.length === 0 ? (
          <EmptyState icon={<Repeat />} text="还没有循环——去工作台「发现循环」并接受一个" />
        ) : (
          <table className="table">
            <thead>
              <tr><th>名称</th><th>备注</th><th>导出</th></tr>
            </thead>
            <tbody>
              {rotations.map(r => (
                <tr key={r.id}>
                  <td>{r.name}</td>
                  <td className="pb-muted">{r.note ?? '—'}</td>
                  <td><ExportChips urlFor={fmt => api.rotationExportUrl(r.id, fmt)} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <Card title="方案（L4）">
        {playbooks.length === 0 ? (
          <EmptyState icon={<Workflow />} text="还没有方案——工作台「编排方案」或接受一个 playbook 提案" />
        ) : (
          <table className="table">
            <thead>
              <tr><th>名称</th><th>导出</th><th /></tr>
            </thead>
            <tbody>
              {playbooks.map(pb => (
                <tr key={pb.id}>
                  <td>{pb.name} <span className="mono pb-muted">v{pb.version}</span></td>
                  <td><ExportChips urlFor={fmt => api.playbookExportUrl(pb.id, fmt)} /></td>
                  <td>
                    <Button variant="primary" size="sm" icon={<Pencil />} onClick={() => onEdit(pb.id)}>
                      编辑
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  )
}
