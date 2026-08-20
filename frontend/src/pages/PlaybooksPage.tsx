import { useEffect, useState } from 'react'
import { api } from '../api/client'
import type { Playbook, Rotation } from '../api/types'

export function PlaybooksPage({ onBack, onEdit }: {
  onBack: () => void; onEdit: (id: string) => void
}) {
  const [rotations, setRotations] = useState<Rotation[]>([])
  const [playbooks, setPlaybooks] = useState<Playbook[]>([])
  useEffect(() => {
    void api.listRotations().then(setRotations)
    void api.listPlaybooks().then(setPlaybooks)
  }, [])

  return (
    <div className="library">
      <p><button onClick={onBack}>← 返回</button></p>
      <h1>循环与方案</h1>
      <h2>循环（L3）</h2>
      <table><tbody>
        {rotations.map(r => (
          <tr key={r.id}>
            <td>{r.name}</td>
            <td style={{ color: '#888' }}>{r.note ?? ''}</td>
            <td>
              <a href={api.rotationExportUrl(r.id, 'md')} target="_blank" rel="noreferrer">md</a>{' · '}
              <a href={api.rotationExportUrl(r.id, 'ahk')} target="_blank" rel="noreferrer">ahk</a>
            </td>
          </tr>
        ))}
      </tbody></table>
      {rotations.length === 0 && <p style={{ color: '#888' }}>还没有循环——去工作台「发现循环」并接受一个。</p>}
      <h2>方案（L4）</h2>
      <table><tbody>
        {playbooks.map(pb => (
          <tr key={pb.id}>
            <td>{pb.name} v{pb.version}</td>
            <td><button onClick={() => onEdit(pb.id)}>编辑</button></td>
            <td>
              <a href={api.playbookExportUrl(pb.id, 'md')} target="_blank" rel="noreferrer">md</a>{' · '}
              <a href={api.playbookExportUrl(pb.id, 'ahk')} target="_blank" rel="noreferrer">ahk</a>
            </td>
          </tr>
        ))}
      </tbody></table>
      {playbooks.length === 0 && <p style={{ color: '#888' }}>还没有方案——工作台「编排方案」或接受一个 playbook 提案。</p>}
    </div>
  )
}
