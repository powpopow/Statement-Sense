/**
 * Copy the OCR runtime out of node_modules and into public/.
 *
 * By default tesseract.js fetches its worker script, WASM core and language
 * models from a public CDN at runtime. That means third-party JavaScript
 * executing inside a page that holds bank transactions and a Google access
 * token, with no integrity check. Serving them ourselves removes that, pins
 * the exact versions in the lockfile, and lets OCR work offline.
 *
 * Run by `predev` and `prebuild`, so the copies cannot drift from the
 * installed packages. public/tesseract is gitignored — it is build output.
 */
import { cp, mkdir, readdir, rm, stat } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const out = path.join(root, 'public', 'tesseract')

/**
 * Languages the app recognises. Thai statements interleave both scripts, so
 * both models are always loaded.
 */
const LANGUAGES = ['tha', 'eng']

/**
 * The app runs Tesseract in LSTM-only mode, and the worker picks a build at
 * runtime from what the device supports, so every LSTM variant has to be here.
 */
const CORE_VARIANTS = [
  'tesseract-core-relaxedsimd-lstm',
  'tesseract-core-simd-lstm',
  'tesseract-core-lstm',
]

/** `4.0.0_best_int` is what LSTM-only mode asks for, and is far smaller. */
const LANG_VARIANT = '4.0.0_best_int'

function resolve(...parts) {
  const full = path.join(root, 'node_modules', ...parts)
  if (!existsSync(full)) {
    throw new Error(`Missing ${path.join(...parts)} — run "npm install" first.`)
  }
  return full
}

async function copyInto(source, destination) {
  await mkdir(path.dirname(destination), { recursive: true })
  await cp(source, destination)
  return (await stat(destination)).size
}

async function main() {
  await rm(out, { recursive: true, force: true })

  let total = 0

  total += await copyInto(
    resolve('tesseract.js', 'dist', 'worker.min.js'),
    path.join(out, 'worker.min.js'),
  )

  for (const variant of CORE_VARIANTS) {
    for (const suffix of ['.wasm.js', '.wasm']) {
      total += await copyInto(
        resolve('tesseract.js-core', `${variant}${suffix}`),
        path.join(out, 'core', `${variant}${suffix}`),
      )
    }
  }

  for (const lang of LANGUAGES) {
    total += await copyInto(
      resolve('@tesseract.js-data', lang, LANG_VARIANT, `${lang}.traineddata.gz`),
      path.join(out, 'lang', `${lang}.traineddata.gz`),
    )
  }

  const files = (await readdir(out, { recursive: true })).length
  console.log(
    `OCR assets: ${files} files, ${(total / 1024 / 1024).toFixed(1)}MB → public/tesseract (served locally, not from a CDN)`,
  )
}

main().catch((error) => {
  console.error(`\nCould not prepare the OCR assets: ${error.message}\n`)
  process.exit(1)
})
