import type { Aggregate, AnalysisTree, Mark, Take, Tally, Video } from './types'

async function j<T>(r: Response): Promise<T> {
  if (!r.ok) throw new Error(`API ${r.status}: ${await r.text()}`)
  return r.json() as Promise<T>
}

const post = (url: string, body?: unknown) =>
  fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })

export const api = {
  listVideos: () => fetch('/api/videos').then(r => j<Video[]>(r)),
  getVideo: (id: string) => fetch(`/api/videos/${id}`).then(r => j<Video>(r)),
  upload: (file: File) => {
    const fd = new FormData()
    fd.append('file', file)
    return fetch('/api/videos/upload', { method: 'POST', body: fd }).then(r => j<Video>(r))
  },
  pull: (url: string) => post('/api/videos/pull', { url }).then(r => j<Video>(r)),

  listAnalyses: (videoId: string) =>
    fetch(`/api/analyses?video_id=${videoId}`).then(r => j<{ id: string }[]>(r)),
  createAnalysis: (videoId: string) =>
    post('/api/analyses', { video_id: videoId }).then(r => j<AnalysisTree>(r)),
  getAnalysis: (id: string) => fetch(`/api/analyses/${id}`).then(r => j<AnalysisTree>(r)),

  newTake: (laneId: string) => post(`/api/lanes/${laneId}/takes`).then(r => j<Take>(r)),
  newMark: (takeId: string, m: { t_ms: number; kind: 'input' | 'release'; label?: string | null; end_ms?: number | null }) =>
    post(`/api/takes/${takeId}/marks`, m).then(r => j<Mark>(r)),
  patchMark: (id: string, patch: { t_ms?: number; end_ms?: number; label?: string; clear_end?: boolean }) =>
    fetch(`/api/marks/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    }).then(r => j<Mark>(r)),
  deleteMark: (id: string) =>
    fetch(`/api/marks/${id}`, { method: 'DELETE' }).then(r => j<{ ok: boolean }>(r)),

  addTally: (analysisId: string, t_ms: number) =>
    post(`/api/analyses/${analysisId}/tally`, { t_ms }).then(r => j<Tally>(r)),
  clearTally: (analysisId: string) =>
    fetch(`/api/analyses/${analysisId}/tally`, { method: 'DELETE' }).then(r => j<{ ok: boolean }>(r)),

  laneAggregate: (laneId: string, windowMs = 300) =>
    fetch(`/api/lanes/${laneId}/aggregate?window_ms=${windowMs}`).then(r => j<Aggregate>(r)),

  videoFileUrl: (id: string) => `/api/videos/${id}/file`,
  spriteUrl: (id: string) => `/api/videos/${id}/sprite`,
}
