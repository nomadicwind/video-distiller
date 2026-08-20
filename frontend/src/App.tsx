import { useEffect, useState } from 'react'
import { api } from './api/client'
import type { Video } from './api/types'
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
  useHotkeys(video)

  useEffect(() => {
    api.listAnalyses(video.id)
      .then(list => (list.length ? api.getAnalysis(list[0].id) : api.createAnalysis(video.id)))
      .then(setAnalysis)
  }, [video.id, setAnalysis])

  if (!analysis) return <p>加载中…</p>
  return (
    <div className="workbench">
      <div className="main">
        <p><button onClick={onBack}>← 返回</button> {analysis.name}</p>
        <Player videoId={video.id} fps={video.fps ?? 30} durationMs={video.duration_ms ?? 0} />
        <TallyBar />
        <ThumbStrip video={video} />
        <Timeline video={video} aggregate={null} />
        {/* 后续任务在此依次挂载：A（任务 22）*/}
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
