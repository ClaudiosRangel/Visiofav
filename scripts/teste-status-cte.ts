/**
 * Teste MÍNIMO: consulta StatusServico CT-e no SVRS homologação
 * Se isso funcionar (HTTP 200 + cStat 107), a comunicação TLS está OK.
 *
 * npx tsx scripts/teste-status-cte.ts
 */
import * as https from 'node:https'

async function main() {
  const { prisma } = await import('../src/lib/prisma')
  const { decryptPfx, decryptSenha } = await import('../src/modules/fiscal/certificado/certificado-crypto')

  const cert = await prisma.certificadoDigital.findFirst({
    where: { ativo: true },
    orderBy: { validoAte: 'desc' },
  })
  await prisma.$disconnect()

  if (!cert?.pfxEncrypted || !cert?.senhaEncrypted) {
    console.error('Nenhum certificado ativo no banco')
    process.exit(1)
  }

  const pfx = decryptPfx(cert.pfxEncrypted)
  const senha = decryptSenha(cert.senhaEncrypted)
  console.log('Certificado:', cert.razaoSocial, '| Senha length:', senha.length)

  // Verificar SecureContext
  const tls = require('node:tls')
  try {
    tls.createSecureContext({ pfx, passphrase: senha })
    console.log('SecureContext: OK')
  } catch (e: any) {
    console.error('SecureContext FALHOU:', e.message)
    process.exit(1)
  }

  // Envelope StatusServico CT-e
  const url = 'https://cte-homologacao.svrs.rs.gov.br/ws/CTeStatusServicoV4/CTeStatusServicoV4.asmx'
  const action = 'http://www.portalfiscal.inf.br/cte/wsdl/CTeStatusServicoV4/cteStatusServicoCT'
  const envelope = '<soap12:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:soap12="http://www.w3.org/2003/05/soap-envelope"><soap12:Body><cteDadosMsg xmlns="http://www.portalfiscal.inf.br/cte/wsdl/CTeStatusServicoV4"><consStatServCTe xmlns="http://www.portalfiscal.inf.br/cte" versao="4.00"><tpAmb>2</tpAmb><xServ>STATUS</xServ></consStatServCTe></cteDadosMsg></soap12:Body></soap12:Envelope>'

  const bodyBuf = Buffer.from(envelope, 'utf-8')
  const contentType = `application/soap+xml; charset=utf-8; action="${action}"`

  console.log('\nURL:', url)
  console.log('Content-Type:', contentType)
  console.log('Content-Length:', bodyBuf.length)
  console.log('Envelope:', envelope)

  const parsedUrl = new URL(url)
  const agent = new https.Agent({
    pfx,
    passphrase: senha,
    rejectUnauthorized: false,
    minVersion: 'TLSv1.2',
    maxVersion: 'TLSv1.2',
  })

  const req = https.request({
    hostname: parsedUrl.hostname,
    port: 443,
    path: parsedUrl.pathname,
    method: 'POST',
    agent,
    timeout: 30000,
    headers: {
      'Content-Type': contentType,
      'Content-Length': bodyBuf.length,
      'SOAPAction': `"${action}"`,
    },
  }, (res) => {
    const chunks: Buffer[] = []
    res.on('data', (c) => chunks.push(c))
    res.on('end', () => {
      const body = Buffer.concat(chunks).toString('utf-8')
      console.log('\n=== RESPOSTA ===')
      console.log('HTTP Status:', res.statusCode)
      console.log('Content-Length:', res.headers['content-length'])
      console.log('Body:', body.substring(0, 1500))

      if (res.statusCode === 200 && body.includes('107')) {
        console.log('\n✓ SUCESSO — StatusServico OK (cStat 107 = Serviço em Operação)')
        console.log('  → Comunicação TLS com certificado está funcionando!')
      } else if (res.statusCode === 400 && body.length === 0) {
        console.log('\n✗ FALHA — HTTP 400 body vazio')
        console.log('  → Problema de comunicação TLS ou formato do envelope')
      } else {
        console.log('\n? Status inesperado — verificar body acima')
      }
    })
  })

  req.on('error', (e) => console.error('ERRO:', e.message))
  req.on('timeout', () => { req.destroy(); console.error('TIMEOUT') })
  req.write(bodyBuf)
  req.end()
}

main().catch(console.error)
