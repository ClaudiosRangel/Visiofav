/**
 * Script de teste isolado — transmite CT-e para SEFAZ SVRS homologação
 * usando exatamente o mesmo formato que o ACBr (Pedicon) usa.
 *
 * Uso: npx tsx scripts/teste-sefaz-cte.ts
 *
 * Objetivo: isolar se o problema é na comunicação HTTP/TLS ou no conteúdo XML.
 * Usa o XML do CT-e 3111 já autorizado pelo ACBr como base de comparação.
 */

import * as https from 'node:https'
import * as fs from 'node:fs'
import * as path from 'node:path'

// Carregar certificado PFX do banco
async function carregarCertificado(): Promise<{ pfx: Buffer; senha: string }> {
  const { prisma } = await import('../src/lib/prisma')
  const { decryptPfx, decryptSenha } = await import('../src/modules/fiscal/certificado/certificado-crypto')

  // Buscar qualquer certificado ativo
  const cert = await prisma.certificadoDigital.findFirst({
    where: { ativo: true },
    orderBy: { validoAte: 'desc' },
  })

  if (!cert || !cert.pfxEncrypted || !cert.senhaEncrypted) {
    await prisma.$disconnect()
    throw new Error('Nenhum certificado ativo encontrado no banco. Configure um certificado digital primeiro.')
  }

  console.log('✓ Certificado encontrado:', cert.razaoSocial || cert.cnpj, '| Válido até:', cert.validoAte?.toISOString())

  const pfxBuffer = decryptPfx(cert.pfxEncrypted)
  const senha = decryptSenha(cert.senhaEncrypted)

  await prisma.$disconnect()
  return { pfx: pfxBuffer, senha }
}

/**
 * Transmite um envelope SOAP para a SEFAZ e retorna a resposta bruta
 */
function enviarParaSefaz(
  url: string,
  envelope: string,
  soapAction: string,
  pfx: Buffer,
  senha: string
): Promise<{ status: number; body: string; headers: Record<string, string> }> {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url)
    const bodyBuffer = Buffer.from(envelope, 'utf-8')

    const agent = new https.Agent({
      pfx,
      passphrase: senha,
      rejectUnauthorized: false,
      minVersion: 'TLSv1.2',
      maxVersion: 'TLSv1.2',
    })

    const contentType = `application/soap+xml; charset=utf-8; action="${soapAction}"`

    const options: https.RequestOptions = {
      hostname: parsedUrl.hostname,
      port: 443,
      path: parsedUrl.pathname,
      method: 'POST',
      agent,
      timeout: 30000,
      headers: {
        'Content-Type': contentType,
        'Content-Length': bodyBuffer.length,
        'SOAPAction': `"${soapAction}"`,
      },
    }

    console.log('\n--- REQUEST ---')
    console.log('URL:', url)
    console.log('Content-Type:', contentType)
    console.log('Content-Length:', bodyBuffer.length)
    console.log('Body (primeiros 500):', envelope.substring(0, 500))
    console.log('...')

    const req = https.request(options, (res) => {
      const chunks: Buffer[] = []
      res.on('data', (chunk) => chunks.push(chunk))
      res.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf-8')
        console.log('\n--- RESPONSE ---')
        console.log('HTTP Status:', res.statusCode)
        console.log('Headers:', JSON.stringify(res.headers, null, 2))
        console.log('Body length:', body.length)
        console.log('Body:', body.substring(0, 2000))
        resolve({
          status: res.statusCode || 0,
          body,
          headers: res.headers as Record<string, string>,
        })
      })
    })

    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')) })
    req.on('error', (err) => reject(err))
    req.write(bodyBuffer)
    req.end()
  })
}

async function main() {
  console.log('=== Teste de transmissão CT-e SEFAZ SVRS (Homologação) ===\n')

  const { pfx, senha } = await carregarCertificado()

  // Verificar se o certificado é válido
  try {
    const tls = require('node:tls')
    tls.createSecureContext({ pfx, passphrase: senha })
    console.log('✓ Certificado PFX válido\n')
  } catch (e: any) {
    console.error('✗ Certificado PFX INVÁLIDO:', e.message)
    process.exit(1)
  }

  const url = 'https://cte-homologacao.svrs.rs.gov.br/ws/CTeRecepcaoSincV4/CTeRecepcaoSincV4.asmx'
  const soapAction = 'http://www.portalfiscal.inf.br/cte/wsdl/CTeRecepcaoSincV4/cteRecepcao'

  // =====================================================
  // TESTE 1: Envelope mínimo com StatusServico (sem CT-e)
  // Apenas para confirmar que a comunicação TLS funciona
  // =====================================================
  console.log('\n========== TESTE 1: StatusServico (testar comunicação) ==========')
  
  const urlStatus = 'https://cte-homologacao.svrs.rs.gov.br/ws/CTeStatusServicoV4/CTeStatusServicoV4.asmx'
  const actionStatus = 'http://www.portalfiscal.inf.br/cte/wsdl/CTeStatusServicoV4/cteStatusServicoCT'
  
  const envelopeStatus = `<soap12:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:soap12="http://www.w3.org/2003/05/soap-envelope"><soap12:Body><cteDadosMsg xmlns="http://www.portalfiscal.inf.br/cte/wsdl/CTeStatusServicoV4"><consStatServCTe xmlns="http://www.portalfiscal.inf.br/cte" versao="4.00"><tpAmb>2</tpAmb><xServ>STATUS</xServ></consStatServCTe></cteDadosMsg></soap12:Body></soap12:Envelope>`

  try {
    const resp1 = await enviarParaSefaz(urlStatus, envelopeStatus, actionStatus, pfx, senha)
    if (resp1.status === 200 && resp1.body.includes('<cStat>')) {
      console.log('\n✓ TESTE 1 PASSOU — comunicação TLS OK, SEFAZ respondeu')
    } else {
      console.log('\n✗ TESTE 1 FALHOU — HTTP', resp1.status)
      if (resp1.status === 400 && resp1.body.length === 0) {
        console.log('  → HTTP 400 body vazio = problema de TLS/certificado ou formato do envelope')
      }
    }
  } catch (e: any) {
    console.log('\n✗ TESTE 1 ERRO:', e.message)
  }

  // =====================================================
  // TESTE 2: Enviar o debug-envelope-cte.xml atual
  // =====================================================
  console.log('\n\n========== TESTE 2: Envelope CT-e do Vizor (debug-envelope-cte.xml) ==========')

  const debugEnvelopePath = path.join(__dirname, '..', 'debug-envelope-cte.xml')
  if (fs.existsSync(debugEnvelopePath)) {
    const envelopeCTe = fs.readFileSync(debugEnvelopePath, 'utf-8')
    try {
      const resp2 = await enviarParaSefaz(url, envelopeCTe, soapAction, pfx, senha)
      if (resp2.body.includes('<cStat>')) {
        const cStatMatch = resp2.body.match(/<cStat>(\d+)<\/cStat>/)
        const xMotivoMatch = resp2.body.match(/<xMotivo>([^<]+)<\/xMotivo>/)
        console.log(`\n✓ SEFAZ respondeu — cStat: ${cStatMatch?.[1]}, xMotivo: ${xMotivoMatch?.[1]}`)
      } else {
        console.log('\n✗ HTTP', resp2.status, '— sem cStat na resposta')
      }
    } catch (e: any) {
      console.log('\n✗ TESTE 2 ERRO:', e.message)
    }
  } else {
    console.log('  (arquivo debug-envelope-cte.xml não encontrado — transmita um CT-e primeiro)')
  }

  console.log('\n\n=== FIM DOS TESTES ===')
}

main().catch(console.error)
