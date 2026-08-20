import type { Aggregate, AnalysisTree, DiscoverResult, ExecStatus, InferResult, Keymap, Mark, PatternItem, Playbook, PlaybookVersion, Proposal, Rotation, Section, Skill, Take, Tally, Video } from './types'
import { useErrors } from '../state/errors'

async function j<T>(r: Response): Promise<T> {
  if (!r.ok) {
    const text = await r.text()
    useErrors.getState().pushError(`API ${r.status}: ${text.slice(0, 200)}`)
    throw new Error(`API ${r.status}: ${text}`)
  }
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

  listSkills: () => fetch('/api/skills').then(r => j<Skill[]>(r)),
  createSkill: (s: { name: string; class_?: string; cd_ms?: number; cast_ms?: number; anim_ms?: number; cancelable?: boolean; pattern: PatternItem[] }) =>
    post('/api/skills', s).then(r => j<Skill>(r)),
  patchSkill: (id: string, patch: Partial<{ name: string; class_: string; cd_ms: number; cast_ms: number; anim_ms: number; cancelable: boolean; pattern: PatternItem[] }>) =>
    fetch(`/api/skills/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) }).then(r => j<Skill>(r)),
  deleteSkill: (id: string) => fetch(`/api/skills/${id}`, { method: 'DELETE' }).then(r => j<{ ok: boolean }>(r)),

  listKeymaps: () => fetch('/api/keymaps').then(r => j<Keymap[]>(r)),
  saveKeymap: (k: { keymap_id: string; class_?: string; binds: Record<string, string[]> }) =>
    post('/api/keymaps', k).then(r => j<Keymap>(r)),
  bindKeymap: (analysisId: string, keymapId: string, version: number) =>
    fetch(`/api/analyses/${analysisId}/keymap`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ keymap_id: keymapId, version }) }).then(r => j<AnalysisTree>(r)),

  runInfer: (analysisId: string) =>
    post(`/api/analyses/${analysisId}/infer`).then(r => j<InferResult>(r)),
  runDiscover: (analysisId: string) =>
    post(`/api/analyses/${analysisId}/discover`).then(r => j<DiscoverResult>(r)),
  listProposals: (analysisId: string) =>
    fetch(`/api/analyses/${analysisId}/proposals`).then(r => j<Proposal[]>(r)),
  acceptProposal: (id: string, sections?: Section[]) =>
    post(`/api/proposals/${id}/accept`, sections ? { sections } : undefined)
      .then(r => j<{ proposal: Proposal; rotation?: Rotation; playbook?: Playbook }>(r)),
  rejectProposal: (id: string) =>
    post(`/api/proposals/${id}/reject`).then(r => j<Proposal>(r)),
  listRotations: () => fetch('/api/rotations').then(r => j<Rotation[]>(r)),

  listPlaybooks: () => fetch('/api/playbooks').then(r => j<Playbook[]>(r)),
  getPlaybook: (id: string) => fetch(`/api/playbooks/${id}`).then(r => j<Playbook>(r)),
  putPlaybook: (id: string, body: { name?: string; sections: Section[] }) =>
    fetch(`/api/playbooks/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(r => j<Playbook>(r)),
  playbookVersions: (id: string) =>
    fetch(`/api/playbooks/${id}/versions`).then(r => j<PlaybookVersion[]>(r)),
  rollbackPlaybook: (id: string, version: number) =>
    post(`/api/playbooks/${id}/rollback`, { version }).then(r => j<Playbook>(r)),
  runCompose: (analysisId: string) =>
    post(`/api/analyses/${analysisId}/compose`).then(r => j<{ proposal: Proposal }>(r)),

  startExec: (kind: 'rotation' | 'playbook', id: string, speed = 1.0) =>
    post('/api/exec/start', { kind, id, speed }).then(r => j<ExecStatus>(r)),
  execCmd: (cmd: 'pause' | 'resume' | 'stop' | 'step') =>
    post(`/api/exec/${cmd}`, {}).then(r => j<ExecStatus>(r)),
  execStatus: () => fetch('/api/exec/status').then(r => j<ExecStatus>(r)),
  backfeedExec: (analysisId: string) =>
    post('/api/exec/backfeed', { analysis_id: analysisId }).then(r => j<Take>(r)),
  captureStart: () => post('/api/capture/start', {}).then(r => j<{ path: string }>(r)),
  captureStop: () => post('/api/capture/stop', {}).then(r => j<Video>(r)),

  rotationExportUrl: (id: string, fmt: 'md' | 'ahk' | 'plan' | 'razer') => `/api/rotations/${id}/export.${fmt}`,
  playbookExportUrl: (id: string, fmt: 'md' | 'ahk' | 'plan' | 'razer') => `/api/playbooks/${id}/export.${fmt}`,

  videoFileUrl: (id: string) => `/api/videos/${id}/file`,
  spriteUrl: (id: string) => `/api/videos/${id}/sprite`,
}
