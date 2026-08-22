import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { ArrowLeft, Film, Link as LinkIcon, Upload } from 'lucide-react'
import { api } from './api/client'
import type { Video, Aggregate, Keymap } from './api/types'
import { useHotkeys } from './hotkeys'
import { Player } from './player/Player'
import { Transport } from './player/Transport'
import { ThumbStrip } from './strip/ThumbStrip'
import { Timeline } from './timeline/Timeline'
import { useSession } from './state/store'
import { EntryPanel } from './panel/EntryPanel'
import { InferPanel } from './panel/InferPanel'
import { ErrorBar } from './ErrorBar'
import { CatalogPage } from './pages/CatalogPage'
import { KeymapPage } from './pages/KeymapPage'
import { PlaybooksPage } from './pages/PlaybooksPage'
import { PlaybookEditor } from './pages/PlaybookEditor'
import { ExecPage } from './pages/ExecPage'
import { HotkeyOverlay } from './shell/HotkeyOverlay'
import { StatusBar } from './shell/StatusBar'
import { TopBar } from './shell/TopBar'
import type { NavPage } from './shell/TopBar'
import { Button } from './ui/Button'
import { Card } from './ui/Card'
import { Field } from './ui/Field'
import { Badge } from './ui/Badge'
import { EmptyState } from './ui/EmptyState'
import { Tabs } from './ui/Tabs'
import { Tooltip } from './ui/Tooltip'
import { fmtTc } from './time/frames'

type InspectorTab = 'annotate' | 'infer'
const INSPECTOR_TABS: { key: InspectorTab; label: string }[] = [
  { key: 'annotate', label: '标注' },
  { key: 'infer', label: '推断' },
]

/** Inspector 容器（spec §5.2）：标注/推断页签，局部状态，默认标注。 */
function Inspector(): JSX.Element {
  const [tab, setTab] = useState<InspectorTab>('annotate')
  return (
    <>
      <Tabs tabs={INSPECTOR_TABS} active={tab} onChange={k => setTab(k as InspectorTab)} />
      {tab === 'annotate' ? <EntryPanel /> : <InferPanel />}
    </>
  )
}

/**
 * TopBar's context slot while the Workbench is open: ← 返回 + analysis name
 * + keymap selector. `analysis` lives in the global useSession store, so
 * this reads it directly rather than needing Workbench to lift state up —
 * it mounts/unmounts independently of Workbench's own render tree.
 */
function WorkbenchTopContext({ onBack }: { onBack: () => void }): JSX.Element | null {
  const analysis = useSession(s => s.analysis)
  const setAnalysis = useSession(s => s.setAnalysis)
  const [keymaps, setKeymaps] = useState<Keymap[]>([])
  useEffect(() => { void api.listKeymaps().then(setKeymaps) }, [])

  if (!analysis) return null
  const latestByIdEntries = [...new Map(
    keymaps.sort((a, b) => a.version - b.version).map(k => [k.id, k])).entries()]

  return (
    <>
      <Button variant="ghost" size="sm" icon={<ArrowLeft />} onClick={onBack}>返回</Button>
      <span className="topbar-context-name">{analysis.name}</span>
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
    </>
  )
}

function Workbench({ video }: { video: Video }) {
  const analysis = useSession(s => s.analysis)
  const setAnalysis = useSession(s => s.setAnalysis)
  const clearAnalysis = useSession(s => s.clearAnalysis)
  const setFrameMs = useSession(s => s.setFrameMs)
  const entryMode = useSession(s => s.entryMode)
  const [aggregate, setAggregate] = useState<Aggregate | null>(null)
  const showAggregate = useSession(st => st.showAggregate)
  const laneId = useSession(st => st.laneId)
  const hintText = useSession(st => st.hintText)
  const lastEntry = useSession(st => st.lastEntry)
  useHotkeys(video)

  useEffect(() => {
    // M9 task 2: derive this video's frame length for the client-side
    // min-gap precheck (entry/gap.ts via actions.ts), mirroring the
    // server's round(1000/fps) (backend/src/vd/store.py `_take_frame_ms`).
    // Set per mount rather than reset in setAnalysis/clearAnalysis (see
    // store.ts's frameMs comment) so it doesn't race those video-switch
    // resets.
    setFrameMs(Math.round(1000 / (video.fps ?? 30)))
    api.listAnalyses(video.id)
      .then(list => (list.length ? api.getAnalysis(list[0].id) : api.createAnalysis(video.id)))
      .then(setAnalysis)
    // The Zustand store is a global singleton, so the previous video's
    // analysis otherwise lingers (and stays hotkey-writable) until the
    // fetch above resolves. Clear it on unmount/video change so a stale
    // window is never rendered or written into.
    return () => { clearAnalysis() }
  }, [video.id, video.fps, setAnalysis, clearAnalysis, setFrameMs])

  useEffect(() => {
    if (!showAggregate || !laneId) { setAggregate(null); return }
    let ignore = false
    api.laneAggregate(laneId).then(a => { if (!ignore) setAggregate(a) })
    return () => { ignore = true }
  }, [showAggregate, laneId])

  if (!analysis || analysis.video_id !== video.id) return <p>加载中…</p>
  const fps = video.fps ?? 30
  const durationMs = video.duration_ms ?? 0
  return (
    <div className="workbench">
      <div className="workbench-grid">
        <div className="workbench-pane workbench-monitor">
          <Player video={video} />
        </div>
        <div className="workbench-pane workbench-transport">
          <Transport video={video} />
        </div>
        <div className="workbench-pane workbench-strip">
          <ThumbStrip video={video} />
        </div>
        <div className="workbench-pane workbench-inspector">
          <Inspector />
        </div>
        <div className="workbench-pane workbench-timeline">
          <Timeline video={video} aggregate={aggregate} />
        </div>
      </div>
      <StatusBar
        // hintText（M7 任务 2 的一次性提示，如"出点须在入点之后"）复用这个
        // 左侧提示位而不是新开一个组件；有值时临时顶掉常态的模式提示，3s
        // 后 store 自动清空，届时这里会退回常态文案。
        left={hintText ?? (entryMode
          // M7 任务 3：有过至少一次键盘打点后，把常态提示换成"最近打了什
          // 么 · 本 take 第几个"，比一句不变的说明文字更能确认"刚才那下
          // 真的记上了"。lastEntry 在切 take/切视频时被 store 清空，所以
          // 回到常态文案是自动的，不需要在这里另外判断。
          ? (lastEntry ? `录入模式 · 最近 ${lastEntry.label} · 本 take 第 ${lastEntry.count} 个` : '录入模式 · 敲键即打点')
          : '点击时间轴定位 · 键帽或录入模式打点')}
        right={<span>{fps} fps · {fmtTc(durationMs)}</span>}
      />
    </div>
  )
}

const STATUS_BADGE: Record<Video['status'], 'accent' | 'success' | 'warn' | 'danger' | 'neutral'> = {
  ready: 'success',
  transcoding: 'accent',
  ingesting: 'accent',
  failed: 'danger',
}

const STATUS_LABEL: Record<Video['status'], string> = {
  ready: '就绪',
  transcoding: '转码中',
  ingesting: '导入中',
  failed: '失败',
}

/**
 * 库封面（M5 复查修复 #3）：就绪视频用 ThumbStrip 同一份 sprite 当封面
 * （api.spriteUrl），而不是永远显示占位渐变+图标。sprite 是横向单行 tile
 * （见 make_sprite），CSS 用 object-position: left 只裁出大致第一帧。
 * 非就绪视频或 sprite 加载失败（onError）时回退到原来的占位样式。
 */
function VideoCover({ video }: { video: Video }): JSX.Element {
  const [broken, setBroken] = useState(false)
  const showSprite = video.status === 'ready' && !broken
  return (
    <div className="video-cover">
      {showSprite ? (
        <img className="video-cover-img" src={api.spriteUrl(video.id)} alt=""
          onError={() => setBroken(true)} />
      ) : (
        <div className="video-cover-fallback"><Film /></div>
      )}
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
      <Card title="导入视频">
        <div className="import-row">
          <label className="dropzone"
            onDragOver={e => e.preventDefault()}
            onDrop={async e => {
              e.preventDefault()
              const f = e.dataTransfer.files?.[0]
              if (f) { await api.upload(f); refresh() }
            }}>
            <Upload />
            <span>拖入视频文件，或点击选择</span>
            <input type="file" accept="video/*" hidden onChange={async e => {
              const f = e.target.files?.[0]
              if (f) { await api.upload(f); refresh(); e.target.value = '' }
            }} />
          </label>
          <Field label="B 站视频 URL（抖音请手动下载后上传）">
            <div className="import-url-row">
              <input value={url} onChange={e => setUrl(e.target.value)}
                placeholder="https://www.bilibili.com/video/..." />
              <Button variant="primary" icon={<LinkIcon />} disabled={!url} onClick={async () => {
                await api.pull(url); setUrl(''); refresh()
              }}>拉取</Button>
            </div>
          </Field>
        </div>
      </Card>

      {videos.length === 0 ? (
        <EmptyState icon={<Film />} text="还没有视频，拖入文件或粘贴 B 站链接开始分析" />
      ) : (
        <div className="video-grid">
          {videos.map(v => {
            const badge = <Badge kind={STATUS_BADGE[v.status]}>{STATUS_LABEL[v.status]}</Badge>
            return (
              <Card key={v.id} title={`video-${v.seq}`}
                extra={v.status === 'failed' && v.error ? <Tooltip tip={v.error}>{badge}</Tooltip> : badge}>
                <VideoCover video={v} />
                <div className="video-name">{v.name}</div>
                <div className="video-fps mono">{v.fps ?? '—'} fps</div>
                <Button variant="primary" disabled={v.status !== 'ready'} onClick={() => onOpen(v)}>打开</Button>
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}

export default function App() {
  const [video, setVideo] = useState<Video | null>(null)
  const [page, setPage] = useState<NavPage>('library')
  const [editingPlaybook, setEditingPlaybook] = useState<string | null>(null)

  // TopBar's nav strip only recognizes the five top-level pages; passing a
  // sentinel here while the Workbench/PlaybookEditor is open is how it knows
  // to dim and disable itself (see shell/TopBar.tsx).
  const topBarPage: string = video ? 'workbench' : editingPlaybook ? 'editor' : page

  let content: ReactNode
  if (video) {
    content = <Workbench video={video} />
  } else if (editingPlaybook) {
    content = <PlaybookEditor playbookId={editingPlaybook} onBack={() => setEditingPlaybook(null)} />
  } else if (page === 'catalog') {
    content = <CatalogPage onBack={() => setPage('library')} />
  } else if (page === 'keymap') {
    content = <KeymapPage onBack={() => setPage('library')} />
  } else if (page === 'playbooks') {
    content = <PlaybooksPage onBack={() => setPage('library')} onEdit={setEditingPlaybook} />
  } else if (page === 'exec') {
    content = <ExecPage onBack={() => setPage('library')} />
  } else {
    content = <VideoLibrary onOpen={setVideo} />
  }

  return (
    <>
      <TopBar page={topBarPage} onNav={setPage}
        context={video ? <WorkbenchTopContext onBack={() => setVideo(null)} /> : undefined} />
      {content}
      <ErrorBar />
      <HotkeyOverlay />
    </>
  )
}
