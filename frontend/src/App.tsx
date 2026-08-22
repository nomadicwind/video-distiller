import { useEffect, useRef, useState } from 'react'
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
import { clampTlHeight } from './shell/splitMath'
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

/**
 * localStorage 里存的时间轴面板高度（key `vd.tl-h`）。缺失/非数字一律读作
 * null（回退到 auto 内容自适应高度），不在这里 clamp——clamp 发生在渲染时
 * （见 Workbench 的 gridTemplateRows），这样 viewportH 变化后仍按当前视口
 * 重新收敛，而不是把某次挂载时的 clamp 结果焊死存起来。
 */
function readStoredTlH(): number | null {
  const raw = localStorage.getItem('vd.tl-h')
  if (raw == null) return null
  const n = Number(raw)
  return Number.isFinite(n) ? n : null
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

  // M11 任务 3：分割条状态。gridRef 供拖动时读取容器 bottom；tlH 为 null
  // 时行模板走 auto（内容自适应）；dragHRef 只在一次拖动手势内暂存最新
  // clamp 后的高度，供 pointerup 时一次性写 localStorage（而不是每次
  // pointermove 都写）。三者都是 hook，必须留在早退回之前。
  const gridRef = useRef<HTMLDivElement>(null)
  const [tlH, setTlH] = useState<number | null>(() => readStoredTlH())
  const dragHRef = useRef<number | null>(null)

  // 复查修复：clampTlHeight 的 max 依赖 window.innerHeight，只在渲染时求值
  // ——单纯的窗口 resize 不会让 Workbench 重渲染，于是缩窗口后 tlH 存的旧
  // px 高度不再重新收敛，时间轴面板不缩小、监视器反而被挤到几乎不可见（复
  // 查复现：缩小视口 → .workbench-monitor 被压到约 20px，直到别的状态变化
  // 顺带触发一次重渲染）。这里只订阅 resize 来"敲"一次重渲染（同 Timeline.tsx
  // 的 ResizeObserver rAF 节流写法——一个从不被读取的计数器 tick，state 本
  // 身不携带尺寸值），渲染时 gridTemplateRows 那行会用最新 window.innerHeight
  // 重新 clamp；不直接改 tlH 本身，因为 tlH 是"用户拖到的高度"这份意图，
  // resize 只改变它被 clamp 到多少，不改变意图本身。
  const [, setResizeTick] = useState(0)
  useEffect(() => {
    let raf: number | null = null
    const onResize = () => {
      if (raf != null) return
      raf = requestAnimationFrame(() => {
        raf = null
        setResizeTick(t => t + 1)
      })
    }
    window.addEventListener('resize', onResize)
    return () => {
      window.removeEventListener('resize', onResize)
      if (raf != null) cancelAnimationFrame(raf)
    }
  }, [])

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

  // 分割条拖动：以 grid 容器的 bottom 与指针 clientY 之差算出新的时间轴面
  // 板高度，clamp 后 setTlH（每次 move 都 set，直接驱动 gridTemplateRows）。
  // localStorage 只在 pointerup 写一次——dragHRef 记住这次拖动最后 clamp
  // 过的值，避免每次 move 都读写 storage。
  const onSplitterPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  const onSplitterPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return
    const grid = gridRef.current
    if (!grid) return
    const h = clampTlHeight(grid.getBoundingClientRect().bottom - e.clientY, window.innerHeight)
    dragHRef.current = h
    setTlH(h)
  }
  // 与本里程碑其它拖动手势（ThumbStrip.tsx endDrag、Timeline.tsx
  // onPointerCancel）同一惯例：pointerup 与 pointercancel 都要释放捕获；
  // pointerup 额外提交（写 localStorage），pointercancel 只清理、不提交
  // ——高度在 move 时已经是活的 state 变化，cancel 无需回滚，只是不落盘。
  const onSplitterPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId)
    if (dragHRef.current != null) {
      localStorage.setItem('vd.tl-h', String(dragHRef.current))
      // 复查修复：写完立即清空，否则一次无位移的空点击（无 move，dragHRef
      // 还留着上一次拖动的旧值）会在这里被当成"这次也拖动过"重复写入同一
      // 个值——虽然值不变，但仍是一次多余的 localStorage 写。
      dragHRef.current = null
    }
  }
  const onSplitterPointerCancel = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId)
  }
  const onSplitterDoubleClick = () => {
    dragHRef.current = null
    setTlH(null)
    localStorage.removeItem('vd.tl-h')
  }

  return (
    <div className="workbench">
      <div className="workbench-grid" ref={gridRef} style={{
        gridTemplateRows: `minmax(0, 1fr) auto auto 6px ${tlH != null ? `${clampTlHeight(tlH, window.innerHeight)}px` : 'auto'}`,
      }}>
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
        <div className="workbench-splitter"
          onPointerDown={onSplitterPointerDown}
          onPointerMove={onSplitterPointerMove}
          onPointerUp={onSplitterPointerUp}
          onPointerCancel={onSplitterPointerCancel}
          onDoubleClick={onSplitterDoubleClick} />
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
          : '拖动时间轴或缩略图带定位 · 键帽或录入模式打点')}
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
