import { describe, expect, it } from 'vitest'
import { parseDetailsExtras } from './soc-parse.ts'

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
