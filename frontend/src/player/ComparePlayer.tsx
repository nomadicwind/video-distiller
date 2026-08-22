import { useEffect, useRef, useState } from 'react'
import { api } from '../api/client'
import { useSession } from '../state/store'
import { clampMs, fmtTc } from '../time/frames'
import { Button } from '../ui/Button'
import { decideResync, followTarget } from './compare'
import { videoEl } from './Player'

export function videoElB(): HTMLVideoElement | null {
  return document.getElementById('vd-video-b') as HTMLVideoElement | null
}

/**
 * Polls `getEl()`'s `currentTime` while `active`, for a live mono timecode
 * readout — shared by the compare bar's "B 时码" field (App.tsx) and the
 * calibration overlay's own readout below, so the same rVFC-with-fallback
 * funnel (mirroring Player.tsx's onPlayheadUpdate) isn't duplicated twice.
 * `getEl` is expected to be a stable top-level function reference (e.g.
 * `videoElB` itself), not a fresh closure per render, or this re-subscribes
 * every render.
 */
export function useLiveMs(getEl: () => HTMLVideoElement | null, active: boolean): number {
  const [ms, setMs] = useState(0)
  useEffect(() => {
    if (!active) return
    const v = getEl()
    if (!v) return
    let handle = 0
    const update = () => setMs(v.currentTime * 1000)
    if (typeof v.requestVideoFrameCallback === 'function') {
      const loop = () => { update(); handle = v.requestVideoFrameCallback(loop) }
      handle = v.requestVideoFrameCallback(loop)
    }
    v.addEventListener('seeked', update)
    v.addEventListener('timeupdate', update)
    update()
    return () => {
      if (handle) v.cancelVideoFrameCallback(handle)
      v.removeEventListener('seeked', update)
      v.removeEventListener('timeupdate', update)
    }
  }, [getEl, active])
  return ms
}

/**
 * 校准态下沿的独立定位条（global-constraints §校准流）：点击/拖动直接 seek
 * B（与 ThumbStrip 同一套指针捕获 + pointercancel 清理 + e.button 守卫惯
 * 例），[−1帧][+1帧] 按 B 自身 fps 步进——与对比条（App.tsx）里那对按 A fps
 * 步进的偏移微调按钮是两件不同的事，不要混用。
 */
function CalibrationBar({ durationMs, fps }: { durationMs: number; fps: number }): JSX.Element {
  const bMs = useLiveMs(videoElB, true)
  const dragging = useRef(false)

  const seekFromEvent = (e: React.PointerEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const ratio = rect.width > 0 ? (e.clientX - rect.left) / rect.width : 0
    const b = videoElB()
    if (b) b.currentTime = clampMs(ratio * durationMs, durationMs) / 1000
  }

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    // M11 惯例：右键/中键不启动拖动。
    if (e.button !== 0) return
    e.currentTarget.setPointerCapture(e.pointerId)
    dragging.current = true
    seekFromEvent(e)
  }
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging.current) return
    seekFromEvent(e)
  }
  const endDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId)
    dragging.current = false
  }

  const frameStepB = (dir: 1 | -1) => {
    const b = videoElB()
    if (!b) return
    const stepMs = 1000 / fps
    b.currentTime = clampMs(b.currentTime * 1000 + dir * stepMs, durationMs) / 1000
  }

  const progress = durationMs > 0 ? Math.min(100, Math.max(0, (bMs / durationMs) * 100)) : 0

  return (
    <div className="compare-calib-bar" onDoubleClick={e => e.stopPropagation()}>
      <div
        className="compare-calib-track"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        <div className="compare-calib-progress" style={{ width: `${progress}%` }} />
      </div>
      <Button variant="ghost" size="sm" onClick={() => frameStepB(-1)}>−1帧</Button>
      <Button variant="ghost" size="sm" onClick={() => frameStepB(1)}>+1帧</Button>
      <span className="compare-calib-tc mono">{fmtTc(bMs)}</span>
    </div>
  )
}

/**
 * 对比视频（B）监视器格（M12 任务 3）：由 Player 在 compareOn && compareVideoId
 * 时渲染进右格。跟随架构选择：ComparePlayer 直接订阅 store 的 playheadMs
 * （每次主播放头 rVFC tick 都更新，见 Player.tsx onPlayheadUpdate）而不是让
 * Player 显式调用一个 syncCompare(tAMs, playing) 导出函数——playheadMs 已经
 * 是现成的订阅入口，避免在 Player 的播放头漏斗里再插入一个专门的 compare
 * 分支。A 的暂停/倍速状态 store 没有镜像字段（Task 2 的 store 只镜像
 * playheadMs），最小侵入的做法是直接监听主 <video> 元素的原生 play/pause/
 * ratechange 事件（与 Transport.tsx 用 videoEl() 读 A 播放态的既有写法同一
 * 惯例），而不是为此新增 store 字段。
 */
export function ComparePlayer({ videoId, durationMs, fps }: {
  videoId: string
  durationMs: number
  fps: number
}): JSX.Element {
  const ref = useRef<HTMLVideoElement>(null)
  const playheadMs = useSession(s => s.playheadMs)
  const offsetMs = useSession(s => s.compareOffsetMs)
  const calibrating = useSession(s => s.calibrating)

  const target = followTarget(playheadMs, offsetMs, durationMs)

  // 跟随主播放头：校准态下整条短路（B 暂时脱离跟随，global-constraints §B
  // 永远从动 的唯一例外）。出界（!inRange）一律 pause，不 clamp-seek 冒充已
  // 同步——遮罩由下方渲染。暂停态 seek 精确同步；播放态按 decideResync 的
  // 80ms 阈值纠漂移。
  useEffect(() => {
    if (calibrating) return
    const b = ref.current
    if (!b) return
    if (!target.inRange) { b.pause(); return }
    const a = videoEl()
    const playing = a ? !a.paused : false
    if (!playing) {
      if (Math.abs(b.currentTime * 1000 - target.tBMs) > 0.5) b.currentTime = target.tBMs / 1000
      return
    }
    if (b.paused) void b.play()
    if (decideResync(target.tBMs, b.currentTime * 1000, true) === 'resync') {
      b.currentTime = target.tBMs / 1000
    }
  }, [playheadMs, offsetMs, durationMs, calibrating, target.inRange, target.tBMs])

  // 播放/暂停/倍速跟随 A：同样在校准态或出界时短路（不播放）。applyPlayState
  // 在挂载时也跑一遍——覆盖"打开对比时 A 已经在播放"这个初始状态（此时不会
  // 有新的原生 play 事件触发）。
  useEffect(() => {
    const a = videoEl()
    const b = ref.current
    if (!a || !b) return
    const syncRate = () => { b.playbackRate = a.playbackRate }
    const applyPlayState = () => {
      if (calibrating || !target.inRange) { b.pause(); return }
      if (a.paused) b.pause()
      else if (b.paused) void b.play()
    }
    a.addEventListener('play', applyPlayState)
    a.addEventListener('pause', applyPlayState)
    a.addEventListener('ratechange', syncRate)
    syncRate()
    applyPlayState()
    return () => {
      a.removeEventListener('play', applyPlayState)
      a.removeEventListener('pause', applyPlayState)
      a.removeEventListener('ratechange', syncRate)
    }
  }, [calibrating, target.inRange])

  return (
    <>
      <video ref={ref} id="vd-video-b" muted playsInline src={api.videoFileUrl(videoId)} />
      {!calibrating && !target.inRange && (
        <div className="compare-mask"><span>超出对比视频范围</span></div>
      )}
      {calibrating && <CalibrationBar durationMs={durationMs} fps={fps} />}
    </>
  )
}
