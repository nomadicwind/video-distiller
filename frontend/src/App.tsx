import { useEffect, useState } from 'react'
import { api } from './api/client'
import type { Video, Aggregate } from './api/types'
import { useHotkeys } from './hotkeys'
import { Player } from './player/Player'
import { TallyBar } from './tally/TallyBar'
import { ThumbStrip } from './strip/ThumbStrip'
import { Timeline } from './timeline/Timeline'
import { useSession } from './state/store'
import { EntryPanel } from './panel/EntryPanel'
import { ErrorBar } from './ErrorBar'

function Workbench({ video, onBack }: { video: Video; onBack: () => void }) {
  const analysis = useSession(s => s.analysis)
  const setAnalysis = useSession(s => s.setAnalysis)
  const clearAnalysis = useSession(s => s.clearAnalysis)
  const [aggregate, setAggregate] = useState<Aggregate | null>(null)
  const showAggregate = useSession(st => st.showAggregate)
  const laneId = useSession(st => st.laneId)
  useHotkeys(video)

  useEffect(() => {
    api.listAnalyses(video.id)
      .then(list => (list.length ? api.getAnalysis(list[0].id) : api.createAnalysis(video.id)))
      .then(setAnalysis)
    // The Zustand store is a global singleton, so the previous video's
    // analysis otherwise lingers (and stays hotkey-writable) until the
    // fetch above resolves. Clear it on unmount/video change so a stale
    // window is never rendered or written into.
    return () => { clearAnalysis() }
  }, [video.id, setAnalysis, clearAnalysis])

  useEffect(() => {
    if (!showAggregate || !laneId) { setAggregate(null); return }
    let ignore = false
    api.laneAggregate(laneId).then(a => { if (!ignore) setAggregate(a) })
    return () => { ignore = true }
  }, [showAggregate, laneId])

  if (!analysis || analysis.video_id !== video.id) return <p>加载中…</p>
  return (
    <div className="workbench">
      <div className="main">
        <p><button onClick={onBack}>← 返回</button> {analysis.name}</p>
        <Player videoId={video.id} fps={video.fps ?? 30} durationMs={video.duration_ms ?? 0} />
        <TallyBar />
        <ThumbStrip video={video} />
        <Timeline video={video} aggregate={aggregate} />
      </div>
      <EntryPanel />
    </div>
  )
}

function VideoLibrary({ onOpen }: { onOpen: (v: Video) => void }) {
  const [videos, setVideos] = useState<Video[]>([])
  const [url, setUrl] = useState('')
  const refresh = () => { void api.listVideos().then(setVideos) }

  useEffect(() => {
    refresh()
    const timer = setInterval(refresh, 2000)   // 轮询转码状态
    return () => clearInterval(timer)
  }, [])

  return (
    <div className="library">
      <h1>Video Distiller</h1>
      <p>
        上传视频：
        <input type="file" accept="video/*" onChange={async e => {
          const f = e.target.files?.[0]
          if (f) { await api.upload(f); refresh(); e.target.value = '' }
        }} />
      </p>
      <p>
        <input style={{ width: 320 }} placeholder="B 站视频 URL（抖音请手动下载后上传）"
          value={url} onChange={e => setUrl(e.target.value)} />
        <button disabled={!url} onClick={async () => {
          await api.pull(url); setUrl(''); refresh()
        }}>拉取</button>
      </p>
      <table>
        <tbody>
          {videos.map(v => (
            <tr key={v.id}>
              <td>video-{v.seq}</td>
              <td>{v.name}</td>
              <td>{v.status}{v.error ? `：${v.error}` : ''}</td>
              <td>{v.fps ?? '—'} fps</td>
              <td>
                <button disabled={v.status !== 'ready'} onClick={() => onOpen(v)}>打开</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export default function App() {
  const [video, setVideo] = useState<Video | null>(null)
  return (
    <>
      <ErrorBar />
      {video
        ? <Workbench video={video} onBack={() => setVideo(null)} />
        : <VideoLibrary onOpen={setVideo} />
      }
    </>
  )
}
