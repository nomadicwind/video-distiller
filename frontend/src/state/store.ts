import { create } from 'zustand'
import type { AnalysisTree, Mark, Take, Tally } from '../api/types'

export interface Session {
  analysis: AnalysisTree | null
  laneId: string | null
  takeId: string | null
  selectedMarkId: string | null
  playheadMs: number
  entryMode: boolean
  showAggregate: boolean

  setAnalysis: (a: AnalysisTree) => void
  selectLane: (laneId: string) => void
  selectTake: (takeId: string) => void
  addTakeLocal: (laneId: string, take: Take) => void
  setPlayhead: (ms: number) => void
  selectMark: (id: string | null) => void
  insertMarkLocal: (m: Mark) => void
  updateMarkLocal: (m: Mark) => void
  removeMarkLocal: (id: string) => void
  addTallyLocal: (t: Tally) => void
  clearTallyLocal: () => void
  toggleEntryMode: () => void
  toggleAggregate: () => void
}

const mapMarks = (a: AnalysisTree, takeId: string, f: (marks: Mark[]) => Mark[]): AnalysisTree => ({
  ...a,
  lanes: a.lanes.map(l => ({
    ...l,
    takes: l.takes.map(t => (t.id === takeId ? { ...t, marks: f(t.marks) } : t)),
  })),
})

const byT = <T extends { t_ms: number }>(xs: T[]): T[] =>
  [...xs].sort((a, b) => a.t_ms - b.t_ms)

export const useSession = create<Session>((set, get) => ({
  analysis: null, laneId: null, takeId: null, selectedMarkId: null,
  playheadMs: 0, entryMode: false, showAggregate: false,

  setAnalysis: a => {
    const lane = a.lanes[0] ?? null
    const take = lane ? lane.takes[lane.takes.length - 1] : null
    set({ analysis: a, laneId: lane?.id ?? null, takeId: take?.id ?? null, selectedMarkId: null })
  },
  selectLane: laneId => {
    const lane = get().analysis?.lanes.find(l => l.id === laneId)
    const take = lane?.takes[lane.takes.length - 1]
    set({ laneId, takeId: take?.id ?? null, selectedMarkId: null })
  },
  selectTake: takeId => set({ takeId, selectedMarkId: null }),
  addTakeLocal: (laneId, take) =>
    set(s => ({
      analysis: s.analysis && {
        ...s.analysis,
        lanes: s.analysis.lanes.map(l =>
          l.id === laneId ? { ...l, takes: [...l.takes, take] } : l),
      },
      laneId, takeId: take.id, selectedMarkId: null,
    })),
  setPlayhead: ms => set({ playheadMs: ms }),
  selectMark: id => set({ selectedMarkId: id }),
  insertMarkLocal: m =>
    set(s => ({
      analysis: s.analysis && mapMarks(s.analysis, m.take_id, marks => byT([...marks, m])),
      selectedMarkId: m.id,
    })),
  updateMarkLocal: m =>
    set(s => ({
      analysis: s.analysis && mapMarks(s.analysis, m.take_id, marks =>
        byT(marks.map(x => (x.id === m.id ? m : x)))),
    })),
  removeMarkLocal: id =>
    set(s => ({
      analysis: s.analysis && {
        ...s.analysis,
        lanes: s.analysis.lanes.map(l => ({
          ...l,
          takes: l.takes.map(t => ({ ...t, marks: t.marks.filter(m => m.id !== id) })),
        })),
      },
      selectedMarkId: s.selectedMarkId === id ? null : s.selectedMarkId,
    })),
  addTallyLocal: t =>
    set(s => ({
      analysis: s.analysis && { ...s.analysis, tally: byT([...s.analysis.tally, t]) },
    })),
  clearTallyLocal: () =>
    set(s => ({ analysis: s.analysis && { ...s.analysis, tally: [] } })),
  toggleEntryMode: () => set(s => ({ entryMode: !s.entryMode })),
  toggleAggregate: () => set(s => ({ showAggregate: !s.showAggregate })),
}))

export const currentTake = (s: Session): Take | null => {
  const lane = s.analysis?.lanes.find(l => l.id === s.laneId)
  return lane?.takes.find(t => t.id === s.takeId) ?? null
}
