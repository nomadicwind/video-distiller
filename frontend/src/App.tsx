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

function Workbench({ video, onBack }: { video: Video; onBack: () => void }) {
  const analysis = useSession(s => s.analysis)
  const setAnalysis = useSession(s => s.setAnalysis)
  const [aggregate, setAggregate] = useState<Aggregate | null>(null)
  const showAggregate = useSession(st => st.showAggregate)
  const laneId = useSession(st => st.laneId)
  useHotkeys(video)

  useEffect(() => {
    api.listAnalyses(video.id)
      .then(list => (list.length ? api.getAnalysis(list[0].id) : api.createAnalysis(video.id)))
      .then(setAnalysis)
  }, [video.id, setAnalysis])

  useEffect(() => {
    if (!showAggregate || !laneId) { setAggregate(null); return }
    let ignore = false
    api.laneAggregate(laneId).then(a => { if (!ignore) setAggregate(a) })
    return () => { ignore = true }
  }, [showAggregate, laneId])

  if (!analysis) return <p>加载中…</p>
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

export default function App() {
  const [video, setVideo] = useState<Video | null>(null)
  const [videos, setVideos] = useState<Video[]>([])
  useEffect(() => { api.listVideos().then(setVideos) }, [])

  if (video) return <Workbench video={video} onBack={() => setVideo(null)} />
  return (
    <div className="library">
      <h1>Video Distiller</h1>
      <ul>
        {videos.map(v => (
          <li key={v.id}>
            video-{v.seq} {v.name}（{v.status}）
            <button disabled={v.status !== 'ready'} onClick={() => setVideo(v)}>打开</button>
          </li>
        ))}
      </ul>
    </div>
  )
}
