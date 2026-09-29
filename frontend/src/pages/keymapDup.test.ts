import { expect, test } from 'vitest'
import { findDuplicateBinds } from './keymapDup'

test('no rows -> no duplicates', () => {
  expect(findDuplicateBinds([])).toEqual([])
})

test('all-distinct skill_id rows -> no duplicates', () => {
  expect(findDuplicateBinds([
    { skill_id: 'sk_a', keys: 'Q' },
    { skill_id: 'sk_b', keys: 'W' },
  ])).toEqual([])
})

test('same skill_id on two rows -> flagged once', () => {
  expect(findDuplicateBinds([
    { skill_id: 'sk_a', keys: 'Q' },
    { skill_id: 'sk_b', keys: 'W' },
    { skill_id: 'sk_a', keys: 'Shift+Q' },
  ])).toEqual(['sk_a'])
})

test('three occurrences of the same skill_id still only appear once in the result', () => {
  expect(findDuplicateBinds([
    { skill_id: 'sk_a', keys: 'Q' },
    { skill_id: 'sk_a', keys: 'E' },
    { skill_id: 'sk_a', keys: 'R' },
  ])).toEqual(['sk_a'])
})

test('rows with empty skill_id (unselected dropdown) are never flagged', () => {
  expect(findDuplicateBinds([
    { skill_id: '', keys: 'Q' },
    { skill_id: '', keys: 'W' },
  ])).toEqual([])
})

test('multiple distinct duplicated ids are all reported, in first-collision order', () => {
  expect(findDuplicateBinds([
    { skill_id: 'sk_a', keys: 'Q' },
    { skill_id: 'sk_b', keys: 'W' },
    { skill_id: 'sk_a', keys: 'E' },
    { skill_id: 'sk_b', keys: 'R' },
  ])).toEqual(['sk_a', 'sk_b'])
})
