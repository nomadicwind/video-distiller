import { expect, test } from 'vitest'
import { composeEntryLabel, type ChordKeyEvent } from './chord'

/** Fills in the modifier booleans not under test so each case only states what it cares about. */
function evt(partial: Partial<ChordKeyEvent> & { code: string }): ChordKeyEvent {
  return { shiftKey: false, ctrlKey: false, altKey: false, metaKey: false, ...partial }
}

test('single modifier prefixes the base key: Shift+2 (fixes the e.key "@" miss)', () => {
  expect(composeEntryLabel(evt({ code: 'Digit2', shiftKey: true }))).toBe('Shift+2')
})

test('single modifier prefixes a letter base key: Ctrl+Q', () => {
  expect(composeEntryLabel(evt({ code: 'KeyQ', ctrlKey: true }))).toBe('Ctrl+Q')
})

test('all three modifiers compose in canonical Ctrl,Alt,Shift order', () => {
  expect(composeEntryLabel(evt({ code: 'KeyA', ctrlKey: true, altKey: true, shiftKey: true })))
    .toBe('Ctrl+Alt+Shift+A')
})

test('no modifiers yields the bare base key', () => {
  expect(composeEntryLabel(evt({ code: 'Digit5' }))).toBe('5')
  expect(composeEntryLabel(evt({ code: 'KeyE' }))).toBe('E')
})

test('metaKey held always yields null, regardless of other modifiers', () => {
  expect(composeEntryLabel(evt({ code: 'KeyA', metaKey: true }))).toBeNull()
  expect(composeEntryLabel(evt({ code: 'Digit1', metaKey: true, shiftKey: true }))).toBeNull()
})

test('a code outside Digit0-9/KeyA-Z yields null', () => {
  expect(composeEntryLabel(evt({ code: 'Tab' }))).toBeNull()
  expect(composeEntryLabel(evt({ code: 'Space' }))).toBeNull()
  expect(composeEntryLabel(evt({ code: 'Comma' }))).toBeNull()
})

test('modifier composition is order-independent (set membership, not press order)', () => {
  const shiftThenCtrl = composeEntryLabel(evt({ code: 'KeyA', shiftKey: true, ctrlKey: true }))
  const ctrlThenShift = composeEntryLabel(evt({ code: 'KeyA', ctrlKey: true, shiftKey: true }))
  expect(shiftThenCtrl).toBe(ctrlThenShift)
  expect(shiftThenCtrl).toBe('Ctrl+Shift+A')
})
