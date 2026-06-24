import XLSX from 'xlsx'
import fs from 'fs'

const filePath = 'PROGRAMAÇÃOWEGA MARÇO 2026.xlsx'
const buf = fs.readFileSync(filePath)
const workbook = XLSX.read(buf, { type: 'buffer', password: '180887' })

console.log('=== PLANILHA ===')
console.log('Abas:', workbook.SheetNames)
console.log('')

for (const sheetName of workbook.SheetNames) {
  const sheet = workbook.Sheets[sheetName]
  const range = XLSX.utils.decode_range(sheet['!ref'] || 'A1')
  console.log(`\n--- ABA: "${sheetName}" (${range.e.r + 1} linhas x ${range.e.c + 1} colunas) ---`)
  
  // Lê as primeiras 15 linhas como JSON
  const data = XLSX.utils.sheet_to_json(sheet, { header: 1, range: 0, defval: '' })
  const preview = data.slice(0, 15)
  for (let i = 0; i < preview.length; i++) {
    const row = preview[i] as any[]
    const cells = row.slice(0, 12).map((c: any) => String(c || '').substring(0, 20))
    console.log(`  L${i + 1}: ${cells.join(' | ')}`)
  }
}

process.exit(0)
