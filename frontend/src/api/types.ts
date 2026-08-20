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
}

export interface AggMark {
  kind: string; label: string | null; t_ms: number; end_ms: number | null
  iqr_ms: number; support: number; take_idxs: number[]
}
export interface Aggregate { n_takes: number; aggregated: AggMark[]; minority: AggMark[] }
