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

test('createSkill posts to /api/skills', async () => {
  const fetchMock = vi.fn().mockResolvedValue(
    new Response(JSON.stringify({ id: 'sk_1', name: '火球术' }), { status: 200 }))
  vi.stubGlobal('fetch', fetchMock)
  const s = await api.createSkill({ name: '火球术', pattern: [{ op: 'tap', key: '2' }] })
  expect(s.id).toBe('sk_1')
  const [url, init] = fetchMock.mock.calls[0]
  expect(url).toBe('/api/skills')
  expect(JSON.parse(init.body).pattern[0].op).toBe('tap')
})

test('runDiscover posts to discover endpoint', async () => {
  const fetchMock = vi.fn().mockResolvedValue(
    new Response(JSON.stringify({ proposals: [], unmatched: 0, ambiguities: [] }), { status: 200 }))
  vi.stubGlobal('fetch', fetchMock)
  const r = await api.runDiscover('an_1')
  expect(r.proposals).toEqual([])
  expect(fetchMock.mock.calls[0][0]).toBe('/api/analyses/an_1/discover')
})

test('runCompose posts to compose endpoint', async () => {
  const fetchMock = vi.fn().mockResolvedValue(
    new Response(JSON.stringify({ proposal: { id: 'pp_1' } }), { status: 200 }))
  vi.stubGlobal('fetch', fetchMock)
  await api.runCompose('an_1')
  expect(fetchMock.mock.calls[0][0]).toBe('/api/analyses/an_1/compose')
})

test('acceptProposal sends adjudicated sections when provided', async () => {
  const fetchMock = vi.fn().mockResolvedValue(
    new Response(JSON.stringify({ proposal: {}, playbook: {} }), { status: 200 }))
  vi.stubGlobal('fetch', fetchMock)
  await api.acceptProposal('pp_1', [{ name: 's', body: [] }])
  const [, init] = fetchMock.mock.calls[0]
  expect(JSON.parse(init.body).sections[0].name).toBe('s')
})

test('putPlaybook and export urls', async () => {
  const fetchMock = vi.fn().mockResolvedValue(
    new Response(JSON.stringify({ id: 'pb_1', version: 2 }), { status: 200 }))
  vi.stubGlobal('fetch', fetchMock)
  await api.putPlaybook('pb_1', { sections: [] })
  expect(fetchMock.mock.calls[0][1].method).toBe('PUT')
  expect(api.playbookExportUrl('pb_1', 'ahk')).toBe('/api/playbooks/pb_1/export.ahk')
  expect(api.rotationExportUrl('rot_1', 'md')).toBe('/api/rotations/rot_1/export.md')
})

test('startExec posts to exec start endpoint', async () => {
  const fetchMock = vi.fn().mockResolvedValue(
    new Response(JSON.stringify({ state: 'running', cursor: 0 }), { status: 200 }))
  vi.stubGlobal('fetch', fetchMock)
  await api.startExec('rotation', 'rot_1', 1.0)
  const [url, init] = fetchMock.mock.calls[0]
  expect(url).toBe('/api/exec/start')
  expect(init.method).toBe('POST')
  expect(JSON.parse(init.body)).toEqual({ kind: 'rotation', id: 'rot_1', speed: 1.0, paused: false })
})

test('startExec body includes paused when requested', async () => {
  const fetchMock = vi.fn().mockResolvedValue(
    new Response(JSON.stringify({ state: 'idle' }), { status: 200 }))
  vi.stubGlobal('fetch', fetchMock)
  await api.startExec('playbook', 'pb_1', 1.0, true)
  const [, init] = fetchMock.mock.calls[0]
  expect(JSON.parse(init.body)).toEqual({ kind: 'playbook', id: 'pb_1', speed: 1.0, paused: true })
})

test('execCmd posts to exec command endpoint', async () => {
  const fetchMock = vi.fn().mockResolvedValue(
    new Response(JSON.stringify({ state: 'stopped' }), { status: 200 }))
  vi.stubGlobal('fetch', fetchMock)
  await api.execCmd('stop')
  const [url, init] = fetchMock.mock.calls[0]
  expect(url).toBe('/api/exec/stop')
  expect(init.method).toBe('POST')
  expect(JSON.parse(init.body)).toEqual({})
})

test('backfeedExec posts to exec backfeed endpoint', async () => {
  const fetchMock = vi.fn().mockResolvedValue(
    new Response(JSON.stringify({ id: 'tk_1', idx: 0, marks: [] }), { status: 200 }))
  vi.stubGlobal('fetch', fetchMock)
  await api.backfeedExec('an_1')
  const [url, init] = fetchMock.mock.calls[0]
  expect(url).toBe('/api/exec/backfeed')
  expect(init.method).toBe('POST')
  expect(JSON.parse(init.body)).toEqual({ analysis_id: 'an_1' })
})
