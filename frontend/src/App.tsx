import { useEffect, useState } from 'react'
import { api } from './api/client'
import type { Video, Aggregate, Keymap } from './api/types'
import { useHotkeys } from './hotkeys'
import { Player } from './player/Player'
import { TallyBar } from './tally/TallyBar'
import { ThumbStrip } from './strip/ThumbStrip'
import { Timeline } from './timeline/Timeline'
import { useSession } from './state/store'
import { EntryPanel } from './panel/EntryPanel'
import { InferPanel } from './panel/InferPanel'
import { ErrorBar } from './ErrorBar'
import { CatalogPage } from './pages/CatalogPage'
import { KeymapPage } from './pages/KeymapPage'

function Workbench({ video, onBack }: { video: Video; onBack: () => void }) {
  const analysis = useSession(s => s.analysis)
  const setAnalysis = useSession(s => s.setAnalysis)
  const clearAnalysis = useSession(s => s.clearAnalysis)
  const [aggregate, setAggregate] = useState<Aggregate | null>(null)
  const showAggregate = useSession(st => st.showAggregate)
  const laneId = useSession(st => st.laneId)
  const [keymaps, setKeymaps] = useState<Keymap[]>([])
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

  useEffect(() => { void api.listKeymaps().then(setKeymaps) }, [])

  if (!analysis || analysis.video_id !== video.id) return <p>加载中…</p>
  const latestByIdEntries = [...new Map(
    keymaps.sort((a, b) => a.version - b.version).map(k => [k.id, k])).entries()]
  return (
    <div className="workbench">
      <div className="main">
        <p>
          <button onClick={onBack}>← 返回</button> {analysis.name}
          <select
            value={analysis.keymap_id ? `${analysis.keymap_id}@${analysis.keymap_version}` : ''}
            onChange={async e => {
              const [kid, ver] = e.target.value.split('@')
              if (!kid) return
              await api.bindKeymap(analysis.id, kid, Number(ver))
              void api.getAnalysis(analysis.id).then(setAnalysis)
            }}>
            <option value="">未绑定键位</option>
            {latestByIdEntries.map(([id, k]) => (
              <option key={id} value={`${id}@${k.version}`}>{id} v{k.version}</option>
            ))}
            {analysis.keymap_id && !latestByIdEntries.some(([id, k]) =>
              id === analysis.keymap_id && k.version === analysis.keymap_version) && (
              <option value={`${analysis.keymap_id}@${analysis.keymap_version}`}>
                {analysis.keymap_id} v{analysis.keymap_version}（钉住的旧版）
              </option>
            )}
          </select>
        </p>
        <Player videoId={video.id} fps={video.fps ?? 30} durationMs={video.duration_ms ?? 0} />
        <TallyBar />
        <ThumbStrip video={video} />
        <Timeline video={video} aggregate={aggregate} />
      </div>
      <div>
        <EntryPanel />
        <InferPanel />
      </div>
    </div>
  )
}

function VideoLibrary({ onOpen, onCatalog, onKeymap }: { onOpen: (v: Video) => void; onCatalog: () => void; onKeymap: () => void }) {
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
        <button onClick={onCatalog}>技能目录</button>
        <button onClick={onKeymap}>键位设置</button>
      </p>
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
  const [page, setPage] = useState<'library' | 'catalog' | 'keymap'>('library')
  if (video) return <><ErrorBar /><Workbench video={video} onBack={() => setVideo(null)} /></>
  if (page === 'catalog') return <><ErrorBar /><CatalogPage onBack={() => setPage('library')} /></>
  if (page === 'keymap') return <><ErrorBar /><KeymapPage onBack={() => setPage('library')} /></>
  return <><ErrorBar /><VideoLibrary onOpen={setVideo}
    onCatalog={() => setPage('catalog')} onKeymap={() => setPage('keymap')} /></>
}
