/**
 * A keyboard event's modifier/base-key facts, decoupled from KeyboardEvent so
 * composeEntryLabel is a pure function testable without DOM events.
 */
export interface ChordKeyEvent {
  code: string
  shiftKey: boolean
  ctrlKey: boolean
  altKey: boolean
  metaKey: boolean
}

const DIGIT_RE = /^Digit([0-9])$/
const LETTER_RE = /^Key([A-Z])$/

/**
 * Composes a stable, human-readable label for an entry-mode keypress, e.g.
 * 'Shift+2' or 'Ctrl+Alt+Shift+A'. Returns null when the event isn't a valid
 * L0 entry keystroke — either metaKey is held (reserved for the OS/browser,
 * e.g. Cmd on macOS) or the base key isn't a digit/letter (e.by e.code, not
 * e.key: e.code is layout- and modifier-independent, so Shift+2 is still seen
 * as base key '2' instead of the shifted '@' that e.key would report. That
 * mismatch is exactly the entry-mode drop bug this function fixes.
 *
 * Modifier prefixes are joined in a canonical Ctrl,Alt,Shift order regardless
 * of which was physically pressed first, so the label is deterministic.
 */
export function composeEntryLabel(e: ChordKeyEvent): string | null {
  if (e.metaKey) return null

  const digitMatch = DIGIT_RE.exec(e.code)
  const letterMatch = LETTER_RE.exec(e.code)
  const base = digitMatch?.[1] ?? letterMatch?.[1]
  if (base === undefined) return null

  const prefixes: string[] = []
  if (e.ctrlKey) prefixes.push('Ctrl')
  if (e.altKey) prefixes.push('Alt')
  if (e.shiftKey) prefixes.push('Shift')

  return [...prefixes, base].join('+')
}
