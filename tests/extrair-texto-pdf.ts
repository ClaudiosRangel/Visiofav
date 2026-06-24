import { PDFParse } from 'pdf-parse'
import fs from 'fs'

async function main() {
  const buf = fs.readFileSync('OP 2849.pdf')
  const u8 = new Uint8Array(buf)
  const parser = new PDFParse(u8)
  const result = await parser.getText()
  fs.writeFileSync('tests/texto-pdf-real.txt', result.text, 'utf8')
  console.log('OK -', result.text.length, 'chars')
  process.exit(0)
}

main().catch(e => { console.error(e.message); process.exit(1) })
