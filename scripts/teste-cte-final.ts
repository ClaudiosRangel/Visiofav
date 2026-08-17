/**
 * Teste FINAL: CT-e 3111 (autorizado) COM xmlns no cteDadosMsg
 * Antes dava 400 com enviCTe vazio — agora com CT-e completo pode funcionar.
 *
 * npx tsx scripts/teste-cte-final.ts
 */
import * as https from 'node:https'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as zlib from 'node:zlib'

async function main() {
  const { prisma } = await import('../src/lib/prisma')
  const { decryptPfx, decryptSenha } = await import('../src/modules/fiscal/certificado/certificado-crypto')

  const cert = await prisma.certificadoDigital.findFirst({ where: { ativo: true }, orderBy: { validoAte: 'desc' } })
  await prisma.$disconnect()
  if (!cert?.pfxEncrypted || !cert?.senhaEncrypted) { process.exit(1) }

  const pfx = decryptPfx(cert.pfxEncrypted)
  const senha = decryptSenha(cert.senhaEncrypted)

  const ctePath = path.join(__dirname, '..', '..', 'Pedicon', 'CTE', '33260868176347000123570010000031111000031110-cte.xml')
  const cteXml = fs.readFileSync(ctePath, 'utf-8').replace(/<\?xml[^?]*\?>/, '').trim()
  console.log('CT-e 3111:', cteXml.length, 'chars')

  const url = 'https://cte-homologacao.svrs.rs.gov.br/ws/CTeRecepcaoSincV4/CTeRecepcaoSincV4.asmx'
  const action = 'http://www.portalfiscal.inf.br/cte/wsdl/CTeRecepcaoSincV4/cteRecepcao'

  async function enviar(label: string, envelope: string) {
    console.log(`\n========== ${label} ==========`)
    const bodyBuf = Buffer.from(envelope, 'utf-8')
    console.log('Content-Length:', bodyBuf.length)
    return new Promise<void>((resolve) => {
      const parsedUrl = new URL(url)
      const agent = new https.Agent({ pfx, passphrase: senha, rejectUnauthorized: false, minVersion: 'TLSv1.2', maxVersion: 'TLSv1.2' })
      const req = https.request({
        hostname: parsedUrl.hostname, port: 443, path: parsedUrl.pathname,
        method: 'POST', agent, timeout: 30000,
        headers: {
          'Content-Type': `application/soap+xml; charset=utf-8; action="${action}"`,
          'Content-Length': bodyBuf.length,
          'SOAPAction': `"${action}"`,
        },
      }, (res) => {
        const chunks: Buffer[] = []
        res.on('data', (c) => chunks.push(c))
        res.on('end', () => {
          const body = Buffer.concat(chunks).toString('utf-8')
          console.log('HTTP Status:', res.statusCode, '| Body:', body.length, 'chars')
          const cStat = body.match(/<cStat>(\d+)<\/cStat>/)
          const xMotivo = body.match(/<xMotivo>([^<]+)<\/xMotivo>/)
          if (cStat) console.log(`→ cStat: ${cStat[1]} — ${xMotivo?.[1] || ''}`)
          else if (body.length > 0) console.log('→ Body:', body.substring(0, 500))
          else console.log('→ BODY VAZIO (HTTP 400)')
          resolve()
        })
      })
      req.on('error', (e) => { console.error('ERRO:', e.message); resolve() })
      req.on('timeout', () => { req.destroy(); console.error('TIMEOUT'); resolve() })
      req.write(bodyBuf)
      req.end()
    })
  }

  const ns = 'http://www.portalfiscal.inf.br/cte/wsdl/CTeRecepcaoSincV4'
  const enviCTe = `<enviCTe xmlns="http://www.portalfiscal.inf.br/cte" versao="4.00"><idLote>1</idLote>${cteXml}</enviCTe>`

  // TESTE 1: COM xmlns no cteDadosMsg + CT-e completo plain-text
  const env1 = `<soap12:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:soap12="http://www.w3.org/2003/05/soap-envelope"><soap12:Body><cteDadosMsg xmlns="${ns}">${enviCTe}</cteDadosMsg></soap12:Body></soap12:Envelope>`
  await enviar('TESTE 1: COM xmlns + CT-e 3111 plain-text + enviCTe', env1)
  await new Promise(r => setTimeout(r, 2000))

  // TESTE 2: COM xmlns + GZip+Base64 do enviCTe
  const gz2 = zlib.gzipSync(Buffer.from(enviCTe, 'utf-8')).toString('base64')
  const env2 = `<soap12:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:soap12="http://www.w3.org/2003/05/soap-envelope"><soap12:Body><cteDadosMsg xmlns="${ns}">${gz2}</cteDadosMsg></soap12:Body></soap12:Envelope>`
  await enviar('TESTE 2: COM xmlns + GZip(enviCTe)', env2)
  await new Promise(r => setTimeout(r, 2000))

  // TESTE 3: SEM xmlns + tag cteRecepcaoLote (nome alternativo usado em versões antigas)
  const env3 = `<soap12:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:soap12="http://www.w3.org/2003/05/soap-envelope"><soap12:Body><cteRecepcaoLote xmlns="${ns}">${enviCTe}</cteRecepcaoLote></soap12:Body></soap12:Envelope>`
  await enviar('TESTE 3: tag cteRecepcaoLote + CT-e plain-text', env3)
  await new Promise(r => setTimeout(r, 2000))

  // TESTE 4: COM xmlns + GZip Base64 só do CTe (sem enviCTe)
  const gz4 = zlib.gzipSync(Buffer.from(cteXml, 'utf-8')).toString('base64')
  const env4 = `<soap12:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:soap12="http://www.w3.org/2003/05/soap-envelope"><soap12:Body><cteDadosMsg xmlns="${ns}">${gz4}</cteDadosMsg></soap12:Body></soap12:Envelope>`
  await enviar('TESTE 4: COM xmlns + GZip(CTe sem enviCTe)', env4)

  console.log('\n=== FIM ===')
}

main().catch(console.error)
