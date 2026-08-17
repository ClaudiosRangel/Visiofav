/**
 * Teste definitivo: enviar o CT-e 3111 (já autorizado pelo ACBr) para a SEFAZ
 * usando nosso envelope, para confirmar se o formato funciona.
 * Deve retornar cStat 204 (Duplicidade) — provando que o envelope está OK.
 *
 * npx tsx scripts/teste-cte-acbr.ts
 */
import * as https from 'node:https'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as zlib from 'node:zlib'

async function main() {
  const { prisma } = await import('../src/lib/prisma')
  const { decryptPfx, decryptSenha } = await import('../src/modules/fiscal/certificado/certificado-crypto')

  const cert = await prisma.certificadoDigital.findFirst({
    where: { ativo: true },
    orderBy: { validoAte: 'desc' },
  })
  await prisma.$disconnect()
  if (!cert?.pfxEncrypted || !cert?.senhaEncrypted) { process.exit(1) }

  const pfx = decryptPfx(cert.pfxEncrypted)
  const senha = decryptSenha(cert.senhaEncrypted)
  console.log('Certificado OK')

  // Ler o CT-e 3111 autorizado pelo ACBr
  const ctePath = path.join(__dirname, '..', '..', 'Pedicon', 'CTE', '33260868176347000123570010000031111000031110-cte.xml')
  if (!fs.existsSync(ctePath)) {
    console.error('CT-e 3111 não encontrado em:', ctePath)
    process.exit(1)
  }
  const cteXml = fs.readFileSync(ctePath, 'utf-8')
  console.log('CT-e 3111 carregado:', cteXml.length, 'chars')

  const url = 'https://cte-homologacao.svrs.rs.gov.br/ws/CTeRecepcaoSincV4/CTeRecepcaoSincV4.asmx'
  const action = 'http://www.portalfiscal.inf.br/cte/wsdl/CTeRecepcaoSincV4/cteRecepcao'

  async function enviar(label: string, envelope: string) {
    console.log(`\n========== ${label} ==========`)
    const bodyBuf = Buffer.from(envelope, 'utf-8')
    console.log('Content-Length:', bodyBuf.length)

    return new Promise<void>((resolve) => {
      const parsedUrl = new URL(url)
      const agent = new https.Agent({ pfx, passphrase: senha, rejectUnauthorized: false, minVersion: 'TLSv1.2', maxVersion: 'TLSv1.2' })
      const contentType = `application/soap+xml; charset=utf-8; action="${action}"`

      const req = https.request({
        hostname: parsedUrl.hostname, port: 443, path: parsedUrl.pathname,
        method: 'POST', agent, timeout: 30000,
        headers: { 'Content-Type': contentType, 'Content-Length': bodyBuf.length, 'SOAPAction': `"${action}"` },
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
          else console.log('→ BODY VAZIO')
          resolve()
        })
      })
      req.on('error', (e) => { console.error('ERRO:', e.message); resolve() })
      req.on('timeout', () => { req.destroy(); console.error('TIMEOUT'); resolve() })
      req.write(bodyBuf)
      req.end()
    })
  }

  // Remover <?xml?> do CT-e se presente (não vai dentro de SOAP)
  const cteClean = cteXml.replace(/<\?xml[^?]*\?>/, '').trim()

  // TESTE 1: XML plain-text com enviCTe
  const env1 = `<soap12:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:soap12="http://www.w3.org/2003/05/soap-envelope"><soap12:Body><cteDadosMsg><enviCTe xmlns="http://www.portalfiscal.inf.br/cte" versao="4.00"><idLote>1</idLote>${cteClean}</enviCTe></cteDadosMsg></soap12:Body></soap12:Envelope>`
  await enviar('TESTE 1: CT-e 3111 plain-text com enviCTe', env1)

  await new Promise(r => setTimeout(r, 2000))

  // TESTE 2: GZip+Base64 do enviCTe completo
  const enviCTeXml = `<enviCTe xmlns="http://www.portalfiscal.inf.br/cte" versao="4.00"><idLote>1</idLote>${cteClean}</enviCTe>`
  const gzipped = zlib.gzipSync(Buffer.from(enviCTeXml, 'utf-8'))
  const b64 = gzipped.toString('base64')
  const env2 = `<soap12:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:soap12="http://www.w3.org/2003/05/soap-envelope"><soap12:Body><cteDadosMsg>${b64}</cteDadosMsg></soap12:Body></soap12:Envelope>`
  await enviar('TESTE 2: CT-e 3111 GZip+Base64 (enviCTe comprimido)', env2)

  await new Promise(r => setTimeout(r, 2000))

  // TESTE 3: GZip+Base64 APENAS do CT-e (sem enviCTe wrapper)
  const gzipped3 = zlib.gzipSync(Buffer.from(cteClean, 'utf-8'))
  const b64_3 = gzipped3.toString('base64')
  const env3 = `<soap12:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:soap12="http://www.w3.org/2003/05/soap-envelope"><soap12:Body><cteDadosMsg>${b64_3}</cteDadosMsg></soap12:Body></soap12:Envelope>`
  await enviar('TESTE 3: CT-e 3111 GZip+Base64 (só CTe, sem enviCTe)', env3)

  console.log('\n=== FIM ===')
}

main().catch(console.error)
