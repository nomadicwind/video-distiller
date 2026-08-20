import { afterEach, expect, test, vi } from 'vitest'
import { api } from './client'

afterEach(() => vi.unstubAllGlobals())

test('newMark posts json and parses response', async () => {
  const fetchMock = vi.fn().mockResolvedValue(
    new Response(JSON.stringify({ id: 'mk_1', t_ms: 100 }), { status: 200 }))
  vi.stubGlobal('fetch', fetchMock)
  const m = await api.newMark('tk_1', { t_ms: 100, kind: 'input', label: '2' })
  expect(m.id).toBe('mk_1')
  const [url, init] = fetchMock.mock.calls[0]
  expect(url).toBe('/api/takes/tk_1/marks')
  expect(init.method).toBe('POST')
  expect(JSON.parse(init.body).label).toBe('2')
})

test('non-ok response throws', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('boom', { status: 400 })))
  await expect(api.listVideos()).rejects.toThrow('400')
})
