import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
import fs from 'fs'

const buf = fs.readFileSync('OP 2849.pdf')
const uint8 = new Uint8Array(buf)
const doc = await getDocument({ data: uint8 }).promise

let texto = ''
for (let i = 1; i <= doc.numPages; i++) {
  const page = await doc.getPage(i)
  const content = await page.getTextContent()
  const pageText = content.items.map(item => item.str).join(' ')
  texto += pageText + '\n\n'
}

fs.writeFileSync('tests/texto-pdf-real.txt', texto, 'utf8')
console.log('OK -', texto.length, 'chars,', doc.numPages, 'pages')
process.exit(0)
