// Reads an SIO unofficial academic record PDF, or a Stellic plan PDF, in the browser. pdf.js (and its worker) are
// loaded only when this runs, so they stay out of the main bundle; the file is never uploaded anywhere.
import type { PDFPageProxy } from 'pdfjs-dist'
import type { TextItem, TextMarkedContent } from 'pdfjs-dist/types/src/display/api'
import { NotSioRecordError, parseSioPieces, type SioRecord, type TextPiece } from '../../lib/sio-record'
import { isStellicPlan, parseStellicPieces, type StellicPlan } from '../../lib/stellic-plan'

/** Largest PDF we'll try to read; SIO's record and Stellic's plan are tens of kilobytes. */
const MAX_BYTES = 10 * 1024 * 1024

export type ImportPdf = { kind: 'sio'; record: SioRecord } | { kind: 'stellic'; plan: StellicPlan }

const NOT_SUPPORTED = "This PDF isn't an SIO academic record or a Stellic plan."

export async function readImportPdf(file: File): Promise<ImportPdf> {
  if (file.size > MAX_BYTES) throw new NotSioRecordError('That file is too large to be an SIO record or a Stellic plan.')
  const bytes = new Uint8Array(await file.arrayBuffer())
  if (!(bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46)) {
    throw new NotSioRecordError("That file isn't a PDF. Download the PDF from SIO or Stellic and choose that file.")
  }

  // The legacy build supports older browsers (Safari and iOS versions in use lag behind Chrome's).
  const [pdfjs, worker] = await Promise.all([import('pdfjs-dist/legacy/build/pdf.mjs'), import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url')])
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default

  // Text extraction needs no fonts, images or WebAssembly decoders; keeping them off also suits the site's strict
  // Content-Security-Policy (no eval, no wasm, same-origin scripts only).
  const task = pdfjs.getDocument({ data: bytes, disableFontFace: true, useSystemFonts: false, useWasm: false, isOffscreenCanvasSupported: false })
  const doc = await task.promise
  let pages: TextPiece[][]
  try {
    pages = []
    // Long graduate + undergraduate records run several pages; 60 is far beyond any real record or plan.
    for (let i = 1; i <= Math.min(doc.numPages, 60); i++) pages.push(await pageText(await doc.getPage(i)))
  } finally {
    void task.destroy()
  }
  if (isStellicPlan(pages)) return { kind: 'stellic', plan: parseStellicPieces(pages) }
  try {
    return { kind: 'sio', record: parseSioPieces(pages) }
  } catch (e) {
    if (e instanceof NotSioRecordError && pages.some((p) => p.some((x) => x.str.trim()))) throw new NotSioRecordError(NOT_SUPPORTED)
    throw e
  }
}

/**
 * A page's text pieces. Reads pdf.js's text stream with a reader rather than page.getTextContent(), which loops over
 * it with `for await`: Safari can't async-iterate a ReadableStream yet and fails with "readableStream is not async
 * iterable".
 */
async function pageText(page: PDFPageProxy): Promise<TextPiece[]> {
  const reader = (page.streamTextContent() as ReadableStream<{ items: (TextItem | TextMarkedContent)[] }>).getReader()
  const pieces: TextPiece[] = []
  try {
    for (;;) {
      const { value, done } = await reader.read()
      if (done) return pieces
      for (const item of value.items) {
        if (!('str' in item)) continue
        const [, , c, d, e, f] = item.transform as number[]
        pieces.push({ str: item.str, x: e, y: f, width: item.width, size: Math.hypot(c, d) || 10 })
      }
    }
  } finally {
    reader.releaseLock()
  }
}
