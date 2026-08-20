import { create } from 'zustand'

export interface AppError { id: number; msg: string }

interface Errors {
  errors: AppError[]
  pushError: (msg: string) => void
  dismiss: (id: number) => void
  clear: () => void
}

let seq = 0

export const useErrors = create<Errors>(set => ({
  errors: [],
  pushError: msg => set(s => ({ errors: [...s.errors, { id: ++seq, msg }] })),
  dismiss: id => set(s => ({ errors: s.errors.filter(e => e.id !== id) })),
  clear: () => set({ errors: [] }),
}))
