import fs from 'fs'
import { parseGprintPdf, isGprintPdf } from '../src/modules/pcp/importacao-op/parsers/gprint-parser'

const texto = fs.readFileSync('tests/texto-pdf-real.txt', 'utf8')
console.log('isGprint:', isGprintPdf(texto))
const result = parseGprintPdf(texto)
console.log('Confiança:', result.confianca)
console.log('Avisos:', result.avisos)
console.log('\n=== MATERIAIS ===', result.materiais.length)
result.materiais.forEach((m, i) => console.log(`  ${i}: [${m.tipo}] ${m.descricao} = ${m.quantidade} ${m.unidade}`))
console.log('\n=== ETAPAS ===', result.etapas.length)
result.etapas.forEach((e, i) => console.log(`  ${i}: ${e.descricao} | Setup: ${e.tempoFixoMin}min | Op: ${e.tempoVariavelMin}min | Det: ${e.detalhes}`))
console.log('\n=== PROGRAMAÇÃO ===', result.cabecalho.programacaoEntrega)
console.log('\n=== CABEÇALHO ===')
console.log('  OP:', result.cabecalho.numeroOp)
console.log('  Cliente:', result.cabecalho.cliente)
console.log('  Qtd:', result.cabecalho.quantidade)
console.log('  Pedido:', result.cabecalho.pedido)
process.exit(0)
