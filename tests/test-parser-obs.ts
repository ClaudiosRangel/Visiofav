import fs from 'fs'
import { parseGprintPdf } from '../src/modules/pcp/importacao-op/parsers/gprint-parser'

const texto = fs.readFileSync('tests/texto-pdf-real.txt', 'utf8')
const result = parseGprintPdf(texto)
console.log('=== OBSERVAÇÕES ===')
console.log('Gerais:', result.observacoes.gerais)
console.log('Produção:', result.observacoes.producao)
console.log('Bobinas:', result.observacoes.bobinas)
console.log('Expedição:', result.observacoes.expedicao)
process.exit(0)
