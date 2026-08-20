export interface Video {
  id: string; seq: number; name: string
  status: 'ingesting' | 'transcoding' | 'ready' | 'failed'
  source_kind: 'upload' | 'bilibili'
  fps: number | null; width: number | null; height: number | null
  duration_ms: number | null
  sprite_interval_s: number | null; sprite_count: number | null
  thumb_w: number | null; thumb_h: number | null
  error: string | null
}

export interface Mark {
  id: string; take_id: string; t_ms: number; end_ms: number | null
  kind: 'input' | 'release'; label: string | null
  provenance: string; confidence: number
}

export interface Take { id: string; idx: number; marks: Mark[] }
export interface Lane { id: string; layer: 'L0' | 'L1' | 'L2'; takes: Take[] }
export interface Tally { id: string; t_ms: number }

export interface AnalysisTree {
  id: string; video_id: string; name: string
  lanes: Lane[]; tally: Tally[]
  keymap_id: string | null; keymap_version: number | null
}

export interface AggMark {
  kind: string; label: string | null; t_ms: number; end_ms: number | null
  iqr_ms: number; support: number; take_idxs: number[]
}
export interface Aggregate { n_takes: number; aggregated: AggMark[]; minority: AggMark[] }

export interface PatternItem {
  op: 'tap' | 'hold' | 'chord' | 'wheel' | 'gap' | 'skill'
  key?: string
  button?: string
  keys?: string[]
  ms?: number
  tol_ms?: number
  ref?: string
}

export interface Skill {
  id: string; name: string; class: string | null
  cd_ms: number | null; cast_ms: number | null; anim_ms: number | null
  cancelable: boolean; pattern: PatternItem[]
}

export interface Keymap {
  id: string; version: number; class: string | null
  binds: Record<string, string[]>
}

export interface Conflict {
  type: 'undefined_skill' | 'no_l0' | 'three_way'
  t_ms: number
  label?: string
  l0_key?: string
  l1_label?: string
  keymap_expected?: string[]
}

export interface InferResult {
  links: { l1_t_ms: number; label: string; l0_key: string; l0_t_ms: number; dt_ms: number }[]
  conflicts: Conflict[]
  keymap_suggestions: { skill_id: string; key: string; support: number; total: number }[]
  span_proposals: { mark_id: string | null; t_ms: number; proposed_end_ms: number; confidence: number }[]
}

export interface Block {
  rotation?: string
  skill?: string
  gap?: number
  tol?: number
  note?: string
  iterations?: number
  repeat_note?: string
  pinned?: boolean
  confidence?: number
}

export interface Section { name: string; body: Block[] }

export interface Playbook {
  id: string; name: string; class: string | null
  keymap_id: string | null; keymap_version: number | null
  sections: Section[]; derived_from: string[]; version: number
}

export interface PlaybookVersion { version: number; created_at: string }

export interface Proposal {
  id: string; analysis_id: string; kind: 'rotation' | 'playbook'
  payload: {
    name: string; note: string
    body?: Record<string, unknown>[]
    occurrences?: [number, number][]
    param_positions?: number[]
    sections?: Section[]
  }
  report: {
    // rotation report fields
    iterations?: number; complete?: number; coverage?: number
    warnings?: string[]; uncovered_before?: number; uncovered_after?: number
    // playbook report fields
    rotations_used?: number; unknown_dropped?: string[]; missing_appended?: number; fallback?: boolean
  }
  status: 'pending' | 'accepted' | 'rejected'
}

export interface Rotation {
  id: string; name: string; note: string | null
  body: Record<string, unknown>[]; params: unknown[]
  derived_from: string[]
}

export interface DiscoverResult {
  proposals: Proposal[]
  unmatched: number
  ambiguities: { t_ms: number; skills: string[] }[]
}

export type ExecState = 'idle' | 'running' | 'paused' | 'stopped' | 'done'

export interface ExecStatus {
  state: ExecState
  cursor?: number
  total?: number
  title?: string
  error?: string | null
  log?: { t_ms: number; action: string; key: string }[]
}
