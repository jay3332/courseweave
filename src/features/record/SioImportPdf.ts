// Reads an SIO unofficial academic record PDF in the browser. pdf.js (and its worker) are loaded only when this
// runs, so they stay out of the main bundle; the file is never uploaded anywhere.
import { NotSioRecordError, parseSioPieces, type SioRecord, type TextPiece } from '../../lib/sio-record'

/** Largest PDF we'll try to read; SIO's record is tens of kilobytes. */
const MAX_BYTES = 10 * 1024 * 1024

export async function readSioRecord(file: File): Promise<SioRecord> {
  if (file.size > MAX_BYTES) throw new NotSioRecordError('That file is too large to be an SIO academic record.')
  const bytes = new Uint8Array(await file.arrayBuffer())
  if (!(bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46)) {
    throw new NotSioRecordError("That file isn't a PDF. In SIO, open Academic Record and use the PDF button under Unofficial Academic Record.")
  }

  const [pdfjs, worker] = await Promise.all([import('pdfjs-dist'), import('pdfjs-dist/build/pdf.worker.min.mjs?url')])
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default

  // Text extraction needs no fonts, images or WebAssembly decoders; keeping them off also suits the site's strict
  // Content-Security-Policy (no eval, no wasm, same-origin scripts only).
  const task = pdfjs.getDocument({ data: bytes, disableFontFace: true, useSystemFonts: false, useWasm: false, isOffscreenCanvasSupported: false })
  const doc = await task.promise
  try {
    const pages: TextPiece[][] = []
    for (let i = 1; i <= Math.min(doc.numPages, 20); i++) {
      const page = await doc.getPage(i)
      const content = await page.getTextContent()
      const pieces: TextPiece[] = []
      for (const item of content.items) {
        if (!('str' in item)) continue
        const [, , c, d, e, f] = item.transform as number[]
        pieces.push({ str: item.str, x: e, y: f, width: item.width, size: Math.hypot(c, d) || 10 })
      }
      pages.push(pieces)
    }
    return parseSioPieces(pages)
  } finally {
    void task.destroy()
  }
}
