import { useEffect, useRef } from 'react'
import { api } from '../api/client'
import type { Video } from '../api/types'
import { useSession } from '../state/store'
import { stepFrame } from '../time/frames'

export function videoEl(): HTMLVideoElement | null {
  return document.getElementById('vd-video') as HTMLVideoElement | null
}

/** How far (ms) auditionMark seeks before/after its target, per the M7 T2 brief. */
const AUDITION_PAD_MS = 400

/**
 * Pending one-shot auto-pause set by auditionMark(), consumed by the
 * playhead-update flow below (Player()'s onPlayheadUpdate). Module-level
 * (not component state) so seekMs/frameStep/togglePlay — called from
 * anywhere, not just this component — can cancel it synchronously without
 * threading a setter through every call site.
 */
let pendingAudition: { endMs: number } | null = null

function cancelAudition(): void {
  pendingAudition = null
}

/** Shape Player() reads off useSession().abLoop — kept minimal (just the
 * fields decidePlayheadAction needs) so this stays a pure function testable
 * without the store. */
export type AbLoopSnapshot = { on: boolean; aMs: number | null; bMs: number | null }

/**
 * Pure per-tick decision for onPlayheadUpdate below (M7 final review fix):
 * while an audition is pending, it — a one-shot explicit "play this bit"
 * intent — WINS over the ambient AB loop for the whole audition window, even
 * when that window (tMs ± 400ms) crosses past B. Loop enforcement is only
 * even considered once there is no pending audition; when the audition ends
 * (auto-pause here, or a manual cancel via seekMs/frameStep/togglePlay), the
 * loop resumes enforcing on the next tick as normal.
 *
 * Previously the loop check ran first and its seekMs() call cancelled the
 * pending audition as a side effect whenever the window crossed B, so the
 * promised auto-pause silently never happened — see final review report.
 */
export function decidePlayheadAction(
  ms: number,
  abLoop: AbLoopSnapshot,
  pendingAuditionEndMs: number | null,
): 'loop-seek' | 'audition-pause' | null {
  if (pendingAuditionEndMs != null) {
    return ms >= pendingAuditionEndMs ? 'audition-pause' : null
  }
  if (abLoop.on && abLoop.aMs != null && abLoop.bMs != null && ms > abLoop.bMs) {
    return 'loop-seek'
  }
  return null
}

export function frameStep(dir: 1 | -1, fps: number, durationMs: number): void {
  cancelAudition()
  const v = videoEl()
  if (!v) return
  v.pause()
  v.currentTime = stepFrame(v.currentTime, fps, dir, durationMs / 1000)
}

export function seekMs(tMs: number): void {
  cancelAudition()
  const v = videoEl()
  if (v) v.currentTime = tMs / 1000
}

/** Space-bar / Transport play-pause button funnel through here (rather than
 * poking the <video> element directly) so a manual transport action always
 * cancels any pending audition auto-pause — see auditionMark below. */
export function togglePlay(): void {
  cancelAudition()
  const v = videoEl()
  if (!v) return
  v.paused ? void v.play() : v.pause()
}

/**
 * Auditions a mark (M7 任务 2, hotkey P): seeks to tMs-400ms (clamped ≥0),
 * plays, and auto-pauses once the playhead crosses tMs+400ms (clamped to
 * durationMs). The auto-pause is a one-shot check performed inside the
 * shared playhead-update flow in Player() below — not a separate timer —
 * so it stays correct across pause/seek/rate changes during playback.
 *
 * Seeks/plays the <video> element directly rather than through
 * seekMs()/togglePlay() above: those cancel any pending audition, which
 * would immediately wipe out the state this function is about to set.
 * Any OTHER manual transport action (seekMs, frameStep, togglePlay) does
 * still cancel it, per the brief.
 */
export function auditionMark(tMs: number, durationMs: number): void {
  const v = videoEl()
  if (!v) return
  const start = Math.max(0, tMs - AUDITION_PAD_MS)
  const end = Math.min(durationMs, tMs + AUDITION_PAD_MS)
  v.currentTime = start / 1000
  pendingAudition = { endMs: end }
  void v.play()
}

/**
 * Renders just the <video> element inside the monitor frame (black inset,
 * object-fit: contain). Playback controls live in sibling Transport, which
 * drives this element through the exported videoEl()/frameStep()/seekMs()/
 * togglePlay()/auditionMark() functions above — their signatures are
 * load-bearing for hotkeys.ts, Timeline, ThumbStrip and InferPanel, and
 * stay unchanged here.
 */
export function Player({ video }: { video: Video }): JSX.Element {
  const ref = useRef<HTMLVideoElement>(null)
  const setPlayhead = useSession(s => s.setPlayhead)

  useEffect(() => {
    const v = ref.current
    if (!v) return
    let handle = 0
    // Single funnel for every playhead update (rVFC + the seeked/timeupdate
    // fallback below) — M7 T2 folds A-B loop enforcement and the audition
    // one-shot auto-pause in here rather than duplicating either check in
    // both callbacks. Reads abLoop fresh via getState() (not a closed-over
    // prop) so this effect doesn't need to re-run every time the loop is
    // edited.
    const onPlayheadUpdate = (ms: number) => {
      setPlayhead(ms)
      const { abLoop } = useSession.getState()
      const action = decidePlayheadAction(ms, abLoop, pendingAudition?.endMs ?? null)
      if (action === 'audition-pause') {
        v.pause()
        pendingAudition = null
      } else if (action === 'loop-seek' && abLoop.aMs != null) {
        seekMs(abLoop.aMs)
      }
    }
    const loop = (_now: number, meta: VideoFrameCallbackMetadata) => {
      onPlayheadUpdate(meta.mediaTime * 1000)
      handle = v.requestVideoFrameCallback(loop)
    }
    handle = v.requestVideoFrameCallback(loop)
    // rVFC 在部分内嵌 WebView/无合成器环境不产帧回调；seeked/timeupdate
    // 兜底保证暂停态 seek 后播放头仍跟手（rVFC 可用时二者幂等）。
    const sync = () => onPlayheadUpdate(v.currentTime * 1000)
    v.addEventListener('seeked', sync)
    v.addEventListener('timeupdate', sync)
    return () => {
      v.cancelVideoFrameCallback(handle)
      v.removeEventListener('seeked', sync)
      v.removeEventListener('timeupdate', sync)
      cancelAudition()
    }
  }, [setPlayhead, video.id])

  const ratio = video.width && video.height ? `${video.width} / ${video.height}` : '16 / 9'

  return (
    <div className="monitor" style={{ aspectRatio: ratio }}>
      <video ref={ref} id="vd-video" src={api.videoFileUrl(video.id)} />
    </div>
  )
}
