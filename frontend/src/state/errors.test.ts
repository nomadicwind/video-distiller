import { beforeEach, expect, test } from 'vitest'
import { useErrors } from './errors'

beforeEach(() => useErrors.getState().clear())

test('pushError accumulates and dismiss removes', () => {
  useErrors.getState().pushError('boom')
  useErrors.getState().pushError('bang')
  expect(useErrors.getState().errors.map(e => e.msg)).toEqual(['boom', 'bang'])
  const id = useErrors.getState().errors[0].id
  useErrors.getState().dismiss(id)
  expect(useErrors.getState().errors.map(e => e.msg)).toEqual(['bang'])
})
