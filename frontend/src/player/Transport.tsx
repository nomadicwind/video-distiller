import { useEffect, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, Pause, Play, SkipBack, Timer } from 'lucide-react'
import { tallyAtPlayhead } from '../actions'
import { api } from '../api/client'
import type { Skill, Video } from '../api/types'
import { currentTake, useSession } from '../state/store'
import { fmtTc } from '../time/frames'
import { Button } from '../ui/Button'
import { Card } from '../ui/Card'
import { Field } from '../ui/Field'
import { frameStep, seekMs, togglePlay, videoEl } from './Player'

const RATES = [0.25, 0.5, 1, 2] as const
type BackfillField = 'anim_ms' | 'cast_ms' | 'cd_ms'

/**
 * Tally-count Popover content — 1:1 port of the old tally/TallyBar.tsx
 * backfill row (skill select + field select + 回填 button + confirmation),
 * now living in a Card that pops out from the transport's tally count.
 */
function TallyBackfillPopover({ deltaText, lastGap }: { deltaText: string | null; lastGap: number | null }): JSX.Element {
  const s = useSession()
  const tally = s.analysis?.tally ?? []

  const [skills, setSkills] = useState<Skill[]>([])
  const [backfillSkill, setBackfillSkill] = useState('')
  const [backfillField, setBackfillField] = useState<BackfillField>('anim_ms')
  const [backfilled, setBackfilled] = useState('')
  useEffect(() => { void api.listSkills().then(setSkills) }, [])

  const backfill = async () => {
    if (!backfillSkill || lastGap === null) return
    await api.patchSkill(backfillSkill, { [backfillField]: lastGap })
    const name = skills.find(sk => sk.id === backfillSkill)?.name ?? backfillSkill
    setBackfilled(`已把 ${lastGap}ms 写入 ${name}.${backfillField}`)
  }

  return (
    <Card title="回填技能耗时">
      <div className="tally-popover-body">
        <div className="tally-popover-stat mono">
          打表 {tally.length} 个{lastGap !== null ? `（最近间隔 ${lastGap}ms）` : ''}
        </div>
        {deltaText && <div className="tally-popover-stat mono">Δ 上一标记 {deltaText}</div>}
        {lastGap === null ? (
          <div className="tally-popover-hint">至少两次打表后可回填耗时到技能</div>
        ) : (
          <>
            <div className="tally-popover-gap mono">回填 {lastGap}ms →</div>
            <Field label="技能">
              <select value={backfillSkill} onChange={e => setBackfillSkill(e.target.value)}>
                <option value="">选技能</option>
                {skills.map(sk => <option key={sk.id} value={sk.id}>{sk.name}</option>)}
              </select>
            </Field>
            <Field label="字段">
              <select value={backfillField}
                onChange={e => setBackfillField(e.target.value as BackfillField)}>
                <option value="anim_ms">anim_ms</option>
                <option value="cast_ms">cast_ms</option>
                <option value="cd_ms">cd_ms</option>
              </select>
            </Field>
            <div className="tally-popover-actions">
              <Button variant="primary" size="sm" disabled={!backfillSkill} onClick={() => void backfill()}>
                回填
              </Button>
            </div>
            {backfilled && <div className="tally-popover-confirm">{backfilled}</div>}
          </>
        )}
      </div>
    </Card>
  )
}

export function Transport({ video }: { video: Video }): JSX.Element {
  const fps = video.fps ?? 30
  const durationMs = video.duration_ms ?? 0
  const playheadMs = useSession(s => s.playheadMs)
  const s = useSession()
  const take = currentTake(s)
  const tally = s.analysis?.tally ?? []
  const prevMark = take ? [...take.marks].reverse().find(m => m.t_ms <= playheadMs) : undefined
  const deltaText = prevMark ? `${Math.round(playheadMs - prevMark.t_ms)}ms` : null
  const lastGap = tally.length >= 2 ? tally[tally.length - 1].t_ms - tally[tally.length - 2].t_ms : null
  // Controller ruling (T3 review): showing Δ/interval only inside the
  // backfill popover cost an extra click during the tally rhythm — surface
  // the same numbers inline next to the count so they're visible at a glance.
  const tallyInline = [
    deltaText ? `Δ上一标记 ${deltaText}` : null,
    lastGap !== null ? `间隔 ${lastGap}ms` : null,
  ].filter(Boolean).join(' · ') || null

  const [playing, setPlaying] = useState(false)
  const [rate, setRate] = useState(1)
  const [tallyOpen, setTallyOpen] = useState(false)
  const tallyGroupRef = useRef<HTMLDivElement>(null)

  // Track native play/pause state directly off the <video> element — Player
  // owns the element, Transport only ever reaches it through videoEl().
  useEffect(() => {
    const v = videoEl()
    if (!v) return
    const onPlay = () => setPlaying(true)
    const onPause = () => setPlaying(false)
    v.addEventListener('play', onPlay)
    v.addEventListener('pause', onPause)
    setPlaying(!v.paused)
    return () => {
      v.removeEventListener('play', onPlay)
      v.removeEventListener('pause', onPause)
    }
  }, [video.id])

  // Close the backfill popover on outside click / Escape. The whole tally
  // group (T button + count + clear) is considered "inside" so re-clicking
  // the count trigger toggles rather than racing with the outside-click
  // handler (mousedown fires before click).
  useEffect(() => {
    if (!tallyOpen) return
    const onDocMouseDown = (e: MouseEvent) => {
      if (tallyGroupRef.current && !tallyGroupRef.current.contains(e.target as Node)) setTallyOpen(false)
    }
    const onKeyDown = (e: KeyboardEvent) => { if (e.key === 'Escape') setTallyOpen(false) }
    document.addEventListener('mousedown', onDocMouseDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onDocMouseDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [tallyOpen])

  const clearTally = async () => {
    if (!s.analysis) return
    await api.clearTally(s.analysis.id)
    s.clearTallyLocal()
  }

  return (
    <div className="transport">
      <div className="transport-controls">
        <Button variant="icon" tip="跳到开头" icon={<SkipBack />} onClick={() => seekMs(0)} />
        <Button variant="icon" tip="[ 上一帧" icon={<ChevronLeft />}
          onClick={() => frameStep(-1, fps, durationMs)} />
        <span className="transport-play">
          <Button variant="icon" tip="空格 播放/暂停" icon={playing ? <Pause /> : <Play />}
            onClick={togglePlay} />
        </span>
        <Button variant="icon" tip="] 下一帧" icon={<ChevronRight />}
          onClick={() => frameStep(1, fps, durationMs)} />
        <select className="transport-rate mono" aria-label="播放速度" value={rate}
          onChange={e => {
            const r = Number(e.target.value)
            setRate(r)
            const v = videoEl()
            if (v) v.playbackRate = r
          }}>
          {RATES.map(r => <option key={r} value={r}>{r}×</option>)}
        </select>
      </div>

      <div className="transport-timecode">
        <span className="transport-tc-current mono">{fmtTc(playheadMs)}</span>
        <span className="transport-tc-total mono"> / {fmtTc(durationMs)}</span>
      </div>

      <div className="transport-tally" ref={tallyGroupRef}>
        <Button variant="icon" tip="T 打表" icon={<Timer />} onClick={() => void tallyAtPlayhead()} />
        <button type="button"
          className={`transport-tally-count mono${tallyOpen ? ' is-open' : ''}`}
          aria-expanded={tallyOpen}
          onClick={() => setTallyOpen(o => !o)}>
          {tally.length}
        </button>
        <Button variant="ghost" size="sm" onClick={() => void clearTally()}>清空</Button>
        {tallyInline && <span className="transport-tally-delta mono">{tallyInline}</span>}
        {tallyOpen && (
          <div className="transport-tally-popover">
            <TallyBackfillPopover deltaText={deltaText} lastGap={lastGap} />
          </div>
        )}
      </div>
    </div>
  )
}
