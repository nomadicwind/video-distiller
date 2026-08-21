import { useEffect, useRef } from 'react'
import { X } from 'lucide-react'
import { Card } from './ui/Card'
import { Button } from './ui/Button'
import { useErrors } from './state/errors'

const AUTO_DISMISS_MS = 8000

export function ErrorBar() {
  const { errors, dismiss } = useErrors()
  // One timer per toast id, scheduled exactly once. Keyed by id so that
  // pushing/dismissing a *different* toast (which re-runs this effect,
  // since `errors` is a new array reference each time) never resets an
  // already-scheduled toast's countdown.
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>())

  useEffect(() => {
    const scheduled = timers.current
    const liveIds = new Set(errors.map(e => e.id))

    // Toasts no longer in the store (dismissed some other way) — drop
    // their bookkeeping and cancel any timer that hasn't fired yet.
    for (const [id, handle] of scheduled) {
      if (!liveIds.has(id)) {
        clearTimeout(handle)
        scheduled.delete(id)
      }
    }

    // Schedule dismissal for any toast that doesn't have a timer yet.
    for (const e of errors) {
      if (scheduled.has(e.id)) continue
      scheduled.set(e.id, setTimeout(() => {
        scheduled.delete(e.id)
        dismiss(e.id)
      }, AUTO_DISMISS_MS))
    }
  }, [errors, dismiss])

  // Unmount-only cleanup: cancel every still-pending timer.
  useEffect(() => () => {
    timers.current.forEach(clearTimeout)
    timers.current.clear()
  }, [])

  if (!errors.length) return null
  return (
    <div className="toast-stack">
      {errors.map(e => (
        <div key={e.id} className="toast">
          <Card accent="var(--danger)">
            <div className="toast-row">
              <span className="toast-msg">{e.msg}</span>
              <Button variant="icon" size="sm" icon={<X />} tip="关闭" onClick={() => {
                const handle = timers.current.get(e.id)
                if (handle) { clearTimeout(handle); timers.current.delete(e.id) }
                dismiss(e.id)
              }} />
            </div>
          </Card>
        </div>
      ))}
    </div>
  )
}
