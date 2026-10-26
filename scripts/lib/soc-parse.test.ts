import { describe, expect, it } from 'vitest'
import { parseDetailsExtras, responseText, storedText } from './soc-parse.ts'

// Trimmed from the SOC's course detail page (21-128, Fall 2026).
const page = `
<div class="col-md-6"><dl><dt>Special Permission Required</dt>
      <dd>No</dd></dl></div>
<div class="row"><div class="col-md-12"><h4>Reservations</h4>
  <table class="table table-condensed">
    <tr><th>Section</th><th>Restriction</th></tr>
    <tr>
        <td>A</td>
        <td>Some reservations are for First-Year

            in M00
        </td>
     </tr>
    <tr><td>B</td><td>Some reservations are for First-Year in M00</td></tr>
    <tr><td>B</td><td>All reservations are for Sophomore in CS</td></tr>
  </table>
</div></div>`

describe('parseDetailsExtras', () => {
  it('reads reservations per section and the special permission flag', () => {
    expect(parseDetailsExtras(page)).toEqual({
      reservations: {
        A: ['Some reservations are for First-Year in M00'],
        B: ['All reservations are for Sophomore in CS', 'Some reservations are for First-Year in M00'],
      },
      permission: false,
    })
  })

  it('handles pages without reservations', () => {
    const none = '<dt>Special Permission Required</dt><dd>Yes</dd><h4>Reservations</h4><p>None</p>'
    expect(parseDetailsExtras(none)).toEqual({ reservations: {}, permission: true })
    expect(parseDetailsExtras('')).toEqual({ reservations: {}, permission: null })
  })
})

describe('responseText and storedText', () => {
  const detail = 'Today’s systems. '
  it('decode a response by the charset it declares', () => {
    // A search page (Latin-1) and a detail page (UTF-8).
    expect(responseText(new Uint8Array([0x50, 0x6f, 0x6b, 0xe9, 0xa0]), 'text/html;charset=ISO-8859-1')).toBe('Poké ')
    expect(responseText(new TextEncoder().encode(detail), 'text/html; charset="UTF-8"')).toBe(detail)
    expect(responseText(new Uint8Array([0x42, 0x6a, 0xf6]), 'text/html;charset=UTF-8')).toBe('Bjö')
    expect(responseText(new TextEncoder().encode('plain'), null)).toBe('plain')
  })
  it('read captures as UTF-8, or Latin-1 when they are not', () => {
    expect(storedText(Buffer.from(detail, 'utf8'))).toBe(detail)
    expect(storedText(Buffer.from([0x50, 0x6f, 0x6b, 0xe9]))).toBe('Poké')
  })
})
