import { describe, expect, it } from 'vitest'
import { decodeSchedule, encodeSchedule, shareUrl, type SharedSchedule } from './share'

const schedule: SharedSchedule = {
  termId: 'S27',
  name: 'Plan B | no Fridays, maybe',
  entries: [
    { courseId: '15122', section: '1', child: 'F', color: 0, hidden: false, passFail: false },
    { courseId: '21127', section: null, child: null, color: 3, hidden: true, passFail: false },
    { courseId: '05180', section: 'A3', child: null, color: 11, hidden: false, passFail: true },
    { courseId: '98012', section: 'A', child: null, color: 4, hidden: true, passFail: true },
  ],
}

function b64(text: string): string {
  return btoa(String.fromCharCode(...new TextEncoder().encode(text)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

describe('share links', () => {
  it('round-trips a schedule, including recitations and pass/fail', () => {
    const payload = encodeSchedule(schedule)
    expect(payload).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(decodeSchedule(payload)).toEqual(schedule)
  })

  it('round-trips unicode names', () => {
    const named = { ...schedule, name: 'Plan 🌷 für Frühling — 春' }
    expect(decodeSchedule(encodeSchedule(named))?.name).toBe(named.name)
  })

  it('round-trips an empty schedule', () => {
    const empty = { termId: 'F26', name: 'Empty', entries: [] }
    expect(decodeSchedule(encodeSchedule(empty))).toEqual(empty)
  })

  it('builds an import URL', () => {
    const url = shareUrl('https://courseweave.example', schedule)
    expect(url.startsWith('https://courseweave.example/S27/schedule?import=')).toBe(true)
    expect(decodeSchedule(new URL(url).searchParams.get('import')!)).toEqual(schedule)
  })

  it('still opens version 1 links', () => {
    expect(decodeSchedule(b64('1|S27|15122.1.0,21127..3h|Old link'))).toEqual({
      termId: 'S27',
      name: 'Old link',
      entries: [
        { courseId: '15122', section: '1', child: null, color: 0, hidden: false, passFail: false },
        { courseId: '21127', section: null, child: null, color: 3, hidden: true, passFail: false },
      ],
    })
  })

  it('rejects garbage', () => {
    for (const bad of [
      '',
      'not base64!',
      '%%%',
      'AAAA',
      b64('3|S27||x'),
      b64('1|S27|15122.1|x'),
      b64('2|S27|15122.1.0|x'),
      b64('2|S27|15122..A.0|child without section'),
      b64('1|S 27||x'),
      b64('2|S27|15122.1..0,15122.2..1|dupe'),
      b64('1|S27'),
    ]) {
      expect(decodeSchedule(bad)).toBeNull()
    }
  })

  it('rejects invalid UTF-8', () => {
    const bytes = new Uint8Array([0x32, 0x7c, 0xff, 0xfe])
    const payload = btoa(String.fromCharCode(...bytes)).replace(/=+$/, '')
    expect(decodeSchedule(payload)).toBeNull()
  })

  it('names unnamed schedules', () => {
    expect(decodeSchedule(b64('2|S27|15122.1..0|  '))?.name).toBe('Shared schedule')
  })
})
