/**
 * Turning an uploaded file into lines of text.
 *
 * PDFs go through pdf.js. Because pdf.js returns loose text runs rather than
 * lines, we regroup runs by their y-position so each statement row comes back
 * as one line with its columns still in reading order. Images go through
 * tesseract.js with the Thai and English models.
 */
import * as pdfjs from 'pdfjs-dist'
import type { TextItem } from 'pdfjs-dist/types/src/display/api'
import workerUrl from 'pdfjs-dist/build/pdf.worker.mjs?url'

import { groupRunsIntoLines } from './pdfLines'

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

export interface ExtractedPage {
  pageNumber: number
  lines: string[]
}

export interface ExtractionResult {
  pages: ExtractedPage[]
  /** All lines across all pages, which most parsers work from. */
  lines: string[]
  text: string
  method: 'pdf-text' | 'ocr'
  /** True when a PDF had no embedded text, so it is a scan needing OCR. */
  needsOcr: boolean
}

/**
 * Thrown when a PDF is encrypted. Thai banks email statements locked by
 * default, so this is a normal path rather than an error: the UI catches it
 * and asks for the password instead of giving up on the file.
 */
export class PdfPasswordRequired extends Error {
  /** True when a password was supplied but rejected, vs none given at all. */
  readonly incorrect: boolean

  constructor(incorrect: boolean) {
    super(incorrect ? 'That password was not accepted.' : 'This PDF is password protected.')
    this.name = 'PdfPasswordRequired'
    this.incorrect = incorrect
  }
}

/** pdf.js signals both "needs a password" and "wrong password" this way. */
function asPasswordError(error: unknown): PdfPasswordRequired | null {
  const e = error as { name?: string; code?: number; message?: string }
  const isPasswordException =
    e?.name === 'PasswordException' || /password/i.test(e?.message ?? '')
  if (!isPasswordException) return null
  // pdf.js PasswordResponses: 1 = NEED_PASSWORD, 2 = INCORRECT_PASSWORD.
  return new PdfPasswordRequired(e?.code === 2 || /incorrect/i.test(e?.message ?? ''))
}

async function loadPdf(buffer: ArrayBuffer, password?: string) {
  try {
    return await pdfjs.getDocument({ data: buffer, password }).promise
  } catch (error) {
    const passwordError = asPasswordError(error)
    if (passwordError) throw passwordError
    throw error
  }
}

export async function extractFromPdf(file: File, password?: string): Promise<ExtractionResult> {
  const buffer = await file.arrayBuffer()
  const doc = await loadPdf(buffer, password)
  const pages: ExtractedPage[] = []

  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i)
    const content = await page.getTextContent()
    const items = content.items.filter((it): it is TextItem => 'str' in it)
    pages.push({ pageNumber: i, lines: groupRunsIntoLines(items) })
  }

  const lines = pages.flatMap((p) => p.lines)
  const text = lines.join('\n')
  // A statement PDF with almost no text is a scan; the caller falls back to OCR.
  const needsOcr = text.replace(/\s/g, '').length < 40

  return { pages, lines, text, method: 'pdf-text', needsOcr }
}

/** Render each PDF page to a canvas, for OCR of scanned statements. */
async function renderPdfToImages(
  file: File,
  password?: string,
  scale = 2,
): Promise<HTMLCanvasElement[]> {
  const buffer = await file.arrayBuffer()
  const doc = await loadPdf(buffer, password)
  const canvases: HTMLCanvasElement[] = []
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i)
    const viewport = page.getViewport({ scale })
    const canvas = document.createElement('canvas')
    canvas.width = viewport.width
    canvas.height = viewport.height
    const context = canvas.getContext('2d')!
    await page.render({ canvas, canvasContext: context, viewport }).promise
    canvases.push(canvas)
  }
  return canvases
}

type ProgressFn = (message: string, fraction: number) => void

/**
 * A reusable OCR worker.
 *
 * Starting a worker downloads and initialises the Thai and English models,
 * which costs seconds. Uploading a batch of order screenshots is the normal
 * case, so the caller opens one session for the whole batch instead of paying
 * that cost per file.
 */
export interface OcrSession {
  recognize: (source: File | HTMLCanvasElement, onProgress?: ProgressFn) => Promise<string[]>
  close: () => Promise<void>
}

/**
 * Where the OCR runtime is served from.
 *
 * tesseract.js otherwise pulls its worker script, WASM core and language
 * models from a public CDN at run time — third-party JavaScript executing in a
 * page that holds transactions and a Google access token, with no integrity
 * check. These copies are placed in public/ by scripts/sync-ocr-assets.mjs.
 *
 * BASE_URL keeps this correct under a GitHub Pages project path.
 */
const OCR_BASE = `${import.meta.env.BASE_URL}tesseract`
const OCR_PATHS = {
  workerPath: `${OCR_BASE}/worker.min.js`,
  corePath: `${OCR_BASE}/core`,
  langPath: `${OCR_BASE}/lang`,
}

/**
 * Phone screenshots arrive at full retina resolution — around 1179x2556 — and
 * Tesseract's cost scales with pixel count, which made a batch of them take
 * minutes. Text stays legible well below that, so cap the long edge.
 *
 * 1600 keeps small print readable while cutting a 3MP screenshot roughly in
 * half.
 */
const MAX_OCR_EDGE = 1600

async function prepareForOcr(source: File | HTMLCanvasElement): Promise<File | HTMLCanvasElement> {
  if (!(source instanceof File)) return source
  if (!source.type.startsWith('image/')) return source

  try {
    const bitmap = await createImageBitmap(source)
    const longEdge = Math.max(bitmap.width, bitmap.height)
    if (longEdge <= MAX_OCR_EDGE) {
      bitmap.close()
      return source
    }

    const scale = MAX_OCR_EDGE / longEdge
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(bitmap.width * scale)
    canvas.height = Math.round(bitmap.height * scale)
    const context = canvas.getContext('2d')!
    // Smoothing matters here: a hard downsample makes thin Thai glyphs ragged.
    context.imageSmoothingEnabled = true
    context.imageSmoothingQuality = 'high'
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    bitmap.close()
    return canvas
  } catch {
    // If the browser cannot decode it, let Tesseract try the original.
    return source
  }
}

export async function openOcrSession(onProgress?: ProgressFn): Promise<OcrSession> {
  onProgress?.('Starting the text recogniser', 0)
  // Imported lazily so the ~2MB OCR bundle only loads when an image is used.
  const { createWorker } = await import('tesseract.js')

  // Reassigned per call so progress is reported against the current file.
  let report: ProgressFn | undefined = onProgress
  const worker = await createWorker(['tha', 'eng'], 1, {
    ...OCR_PATHS,
    // The models are served from this origin, so let the browser cache them
    // rather than tesseract.js keeping its own copy in IndexedDB.
    cacheMethod: 'none',
    logger: (m: { status: string; progress: number }) => {
      if (m.status === 'recognizing text') report?.('Reading text', m.progress)
    },
  })

  return {
    async recognize(source, fileProgress) {
      report = fileProgress
      const { data } = await worker.recognize(await prepareForOcr(source))
      return data.text
        .split('\n')
        .map((l) => l.replace(/\s+/g, ' ').trim())
        .filter(Boolean)
    },
    async close() {
      await worker.terminate()
    },
  }
}

export async function extractFromImage(
  source: File | HTMLCanvasElement,
  onProgress?: ProgressFn,
  session?: OcrSession,
): Promise<ExtractionResult> {
  const own = session ?? (await openOcrSession(onProgress))
  try {
    const lines = await own.recognize(source, onProgress)
    return { pages: [{ pageNumber: 1, lines }], lines, text: lines.join('\n'), method: 'ocr', needsOcr: false }
  } finally {
    // Only close a session this call created; a shared one outlives the file.
    if (!session) await own.close()
  }
}

/**
 * Decide whether a file is really a PDF by reading its header.
 *
 * Neither the name nor the MIME type can be trusted: macOS hands over files
 * with extensions hidden and an empty `type`, so a statement arrives looking
 * like nothing in particular. Every PDF starts with "%PDF-".
 */
async function looksLikePdf(file: File): Promise<boolean> {
  if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) return true
  try {
    const header = new Uint8Array(await file.slice(0, 5).arrayBuffer())
    return (
      header[0] === 0x25 && header[1] === 0x50 && header[2] === 0x44 && header[3] === 0x46
    )
  } catch {
    return false
  }
}

/** Entry point: hand it any supported file and get lines back. */
export async function extractFile(
  file: File,
  onProgress?: ProgressFn,
  password?: string,
  session?: OcrSession,
): Promise<ExtractionResult> {
  const isPdf = await looksLikePdf(file)

  if (isPdf) {
    onProgress?.('Reading PDF', 0.1)
    const result = await extractFromPdf(file, password)
    if (!result.needsOcr) return result

    onProgress?.('Scanned PDF — running OCR', 0.2)
    const canvases = await renderPdfToImages(file, password)
    const pages: ExtractedPage[] = []
    for (let i = 0; i < canvases.length; i++) {
      const ocr = await extractFromImage(
        canvases[i],
        (msg, frac) =>
          onProgress?.(`${msg} (page ${i + 1}/${canvases.length})`, (i + frac) / canvases.length),
        session,
      )
      pages.push({ pageNumber: i + 1, lines: ocr.lines })
    }
    const lines = pages.flatMap((p) => p.lines)
    return { pages, lines, text: lines.join('\n'), method: 'ocr', needsOcr: false }
  }

  onProgress?.('Running OCR', 0.1)
  return extractFromImage(file, onProgress, session)
}
