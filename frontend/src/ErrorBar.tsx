import { useEffect } from 'react'
import { X } from 'lucide-react'
import { Card } from './ui/Card'
import { Button } from './ui/Button'
import { useErrors } from './state/errors'

const AUTO_DISMISS_MS = 8000

export function ErrorBar() {
  const { errors, dismiss } = useErrors()

  useEffect(() => {
    if (!errors.length) return
    const timers = errors.map(e => setTimeout(() => dismiss(e.id), AUTO_DISMISS_MS))
    return () => { timers.forEach(clearTimeout) }
  }, [errors, dismiss])

  if (!errors.length) return null
  return (
    <div className="toast-stack">
      {errors.map(e => (
        <div key={e.id} className="toast">
          <Card accent="var(--danger)">
            <div className="toast-row">
              <span className="toast-msg">{e.msg}</span>
              <Button variant="icon" size="sm" icon={<X />} tip="关闭" onClick={() => dismiss(e.id)} />
            </div>
          </Card>
        </div>
      ))}
    </div>
  )
}
