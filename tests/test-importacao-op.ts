/**
 * Teste do endpoint de importação de OP via PDF.
 * Uso: npx tsx tests/test-importacao-op.ts
 */
import fs from 'fs'
import path from 'path'

const BASE_URL = 'http://localhost:3333'

async function main() {
  // 1. Login
  console.log('📋 Fazendo login...')
  const loginRes = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@visiofab.com', senha: 'teste123' }),
  })
  const loginData = await loginRes.json() as any
  if (!loginData.token) {
    console.error('❌ Falha no login:', loginData)
    return
  }
  console.log('✅ Login OK')

  // 2. Upload do PDF
  console.log('\n📤 Enviando PDF para importação...')
  const pdfPath = path.join(__dirname, 'op-gprint-teste.pdf')
  const pdfBuffer = fs.readFileSync(pdfPath)

  const formData = new FormData()
  const blob = new Blob([pdfBuffer], { type: 'application/pdf' })
  formData.append('file', blob, 'op-gprint-teste.pdf')

  const importRes = await fetch(`${BASE_URL}/api/pcp/importar-op-pdf`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${loginData.token}` },
    body: formData,
  })

  const importData = await importRes.json() as any
  console.log(`\n📊 Status: ${importRes.status}`)
  console.log('📊 Resposta:')
  console.log(JSON.stringify(importData, null, 2))

  // 3. Se sucesso, mostrar resumo
  if (importData.dadosExtraidos) {
    const cab = importData.dadosExtraidos.cabecalho
    console.log('\n═══════════════════════════════════════')
    console.log('📋 RESUMO DA OP EXTRAÍDA:')
    console.log(`   OP Número: ${cab.numeroOp || 'N/A'}`)
    console.log(`   Cliente: ${cab.cliente || 'N/A'}`)
    console.log(`   Produto: ${cab.descricao || cab.produto || 'N/A'}`)
    console.log(`   Quantidade: ${cab.quantidade || 'N/A'}`)
    console.log(`   Pedido: ${cab.pedido || 'N/A'}`)
    console.log(`   Materiais: ${importData.dadosExtraidos.materiais?.length || 0}`)
    console.log(`   Etapas: ${importData.dadosExtraidos.etapas?.length || 0}`)
    console.log(`   Confiança: ${importData.confianca}%`)
    console.log('═══════════════════════════════════════')
  }
}

main().catch(console.error)
