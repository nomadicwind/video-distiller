import { useErrors } from './state/errors'

export function ErrorBar() {
  const { errors, dismiss } = useErrors()
  if (!errors.length) return null
  return (
    <div style={{ position: 'fixed', top: 0, left: 0, right: 0, zIndex: 99, background: '#7f1d1d', padding: '4px 8px' }}>
      {errors.map(e => (
        <div key={e.id}>
          ⚠ {e.msg} <button onClick={() => dismiss(e.id)}>×</button>
        </div>
      ))}
    </div>
  )
}
