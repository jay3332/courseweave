import { describe, expect, it } from 'vitest'
import { modeCode, parseDetailsGrouping, parseSearchPage, sectionName, splitSocTitle } from '../../scripts/lib/soc-parse.ts'

const link = (id: string) => `<a href="" onclick="openModal('#m', '', '/SOC/SOCServlet/courseDetails?COURSE=${id}&SEMESTER=F26'); return false;">${id}</a>`
const head = (cols: string[]) => `<thead><tr>${cols.map((c) => `<th class="col-${c}">${c}</th>`).join('')}</tr></thead>`
const FALL_COLS = ['course', 'title', 'units', 'section', 'mini', 'days', 'begin', 'end', 'location', 'deliverymode']
const row = (cells: string[], open = true) => `${open ? '<tr>' : ''}${cells.map((c) => `<td>\n  ${c}\n</td>`).join('')}</tr>`

const searchPage = `
<h4 class="department-title">COMPUTER SCIENCE</h4>
<table>${head(FALL_COLS)}<tbody>
${row([link('15122'), 'Principles of Imperative Computation ', '12', 'Lec 1', '', 'TR', '09:30AM', '10:50AM', 'Pittsburgh, Pennsylvania', 'In-person Expectation'])}
${row(['&nbsp;', '', '&nbsp;', '&nbsp;', '', 'T', '07:00PM', '08:20PM', 'Pittsburgh, Pennsylvania', 'In-person Expectation'], false)}
${row(['&nbsp;', '', '&nbsp;', 'A', '', 'F', '09:00AM', '09:50AM', 'Pittsburgh, Pennsylvania', 'In-person Expectation'], false)}
</tbody></table>
<h4 class="department-title">ARTS &amp; ENTERTAINMENT MANAGEMENT</h4>
<table>${head(['course', 'title', 'session', 'units', 'section', 'mini', 'days', 'begin', 'end', 'location', 'deliverymode'])}<tbody>
${row([link('93430'), 'Technologies Transforming the Arts', 'summer', '6', 'A5', 'Y', 'TR', '11:00AM', '12:20PM', 'Pittsburgh, Pennsylvania', 'Remote only'])}
</tbody></table>`

describe('parseSearchPage', () => {
  const rows = parseSearchPage(searchPage)

  it('reads every row, including continuation rows without an opening <tr>', () => {
    expect(rows).toHaveLength(4)
    expect(rows[0]).toMatchObject({ department: 'COMPUTER SCIENCE', course: '15122', title: 'Principles of Imperative Computation', units: '12', section: 'Lec 1', days: 'TR' })
    expect(rows[1]).toMatchObject({ course: '', section: '', days: 'T', begin: '07:00PM' })
    expect(rows[2]).toMatchObject({ course: '', section: 'A', days: 'F' })
  })

  it('maps columns from the header, so summer tables with a Session column line up', () => {
    expect(rows[3]).toMatchObject({ department: 'ARTS & ENTERTAINMENT MANAGEMENT', session: 'summer', units: '6', section: 'A5', mini: 'Y', mode: 'Remote only' })
  })
})

describe('parseDetailsGrouping', () => {
  it('assigns sections to the lecture they are listed under', () => {
    const html = `<table><thead><tr><th></th><th>Units</th><th>Section</th><th>Mini</th><th>Days</th></tr></thead><tbody>
      <tr><td></td><td>12.0</td><td>Lec 1</td><td></td><td>TR</td></tr>
      <tr><td></td><td></td><td></td><td></td><td>T</td></tr>
      <tr><td></td><td></td><td>A</td><td></td><td>F</td></tr>
      <tr><td></td><td></td><td>S</td><td></td><td>F</td></tr>
      <tr><td></td><td></td><td>Lec 2</td><td></td><td>TR</td></tr>
      <tr><td></td><td></td><td>J</td><td></td><td>F</td></tr>
    </tbody></table>`
    expect(parseDetailsGrouping(html)).toEqual([
      { name: 'Lec 1', lecture: null },
      { name: 'A', lecture: 'Lec 1' },
      { name: 'S', lecture: 'Lec 1' },
      { name: 'Lec 2', lecture: null },
      { name: 'J', lecture: 'Lec 2' },
    ])
  })
})

describe('title and label helpers', () => {
  it('splits topics and the cancelled flag', () => {
    expect(splitSocTitle('Independent Study')).toEqual({ base: 'Independent Study', topic: null, cancelled: false })
    expect(splitSocTitle('New Pedagogies : Unreasonable Architecture This Section Cancelled')).toEqual({
      base: 'New Pedagogies',
      topic: 'Unreasonable Architecture',
      cancelled: true,
    })
    expect(splitSocTitle(': Faculty Research Focus Groups')).toEqual({ base: '', topic: 'Faculty Research Focus Groups', cancelled: false })
    expect(splitSocTitle('Structural Design 2: Materials & Analysis')).toMatchObject({ base: 'Structural Design 2: Materials & Analysis', topic: null })
  })

  it('normalizes lecture labels and delivery modes', () => {
    expect(sectionName('Lec 1')).toBe('1')
    expect(sectionName('Lec')).toBe('1')
    expect(sectionName('A3')).toBe('A3')
    expect(modeCode('In-Person + Technology')).toBe('IPT')
    expect(modeCode('Remote only')).toBe('REO')
    expect(modeCode('Something new')).toBe('Something new')
  })
})
