/**
 * Turn a real statement PDF into the text lines the parser sees, for testing.
 *
 *   node scripts/extract-fixture.mjs "<file.pdf>" <name>
 *   PDF_PASSWORD=... node scripts/extract-fixture.mjs "<locked.pdf>" <name>
 *
 * Writes fixtures/<name>.json. The fixtures/ folder is git-ignored: a statement
 * is personal data and this repository is public. The password, if any, is read
 * from the environment and is never written anywhere.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'
import { groupRunsIntoLines } from '../src/lib/pdfLines.ts'

const [file, name] = process.argv.slice(2)
if (!file || !name) {
  console.error('usage: node scripts/extract-fixture.mjs <file.pdf> <fixture-name>')
  process.exit(1)
}

const doc = await pdfjs.getDocument({
  data: new Uint8Array(readFileSync(file)),
  useSystemFonts: true,
  verbosity: 0,
  password: process.env.PDF_PASSWORD,
}).promise

const pages = []
for (let i = 1; i <= doc.numPages; i++) {
  const content = await (await doc.getPage(i)).getTextContent()
  pages.push(groupRunsIntoLines(content.items.filter((item) => 'str' in item)))
}

const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'fixtures')
mkdirSync(dir, { recursive: true })
writeFileSync(path.join(dir, `${name}.json`), JSON.stringify({ source: path.basename(file), pages }, null, 1))
console.log(`fixtures/${name}.json  ${pages.length} pages, ${pages.flat().length} lines`)
