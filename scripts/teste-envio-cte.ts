/**
 * Teste: enviar CT-e para CTeRecepcaoSincV4
 * Primeiro sem assinatura (deve dar rejeição de schema/assinatura, não 400 vazio)
 * Depois com o debug-envelope-cte.xml (que tem assinatura)
 *
 * npx tsx scripts/teste-envio-cte.ts
 */
import * as https from 'node:https'
import * as fs from 'node:fs'
import * as path from 'node:path'

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
  console.log('Certificado OK | Senha length:', senha.length)

  const url = 'https://cte-homologacao.svrs.rs.gov.br/ws/CTeRecepcaoSincV4/CTeRecepcaoSincV4.asmx'
  const action = 'http://www.portalfiscal.inf.br/cte/wsdl/CTeRecepcaoSincV4/cteRecepcao'

  // TESTE: usar exatamente o XML do CT-e 3111 que foi AUTORIZADO pelo ACBr/Pedicon
  // (sem a assinatura e sem o protocolo — apenas o corpo do CT-e dentro de enviCTe)
  // Se a SEFAZ retornar cStat (qualquer), significa que o envelope está OK e o problema
  // é no conteúdo/assinatura do nosso CT-e do Vizor.

  // Ler o debug-envelope atual
  const debugPath = path.join(__dirname, '..', 'debug-envelope-cte.xml')
  if (!fs.existsSync(debugPath)) {
    console.error('debug-envelope-cte.xml não encontrado')
    process.exit(1)
  }

  const envelopeAtual = fs.readFileSync(debugPath, 'utf-8')

  // TESTE ALTERNATIVO: envelope SEM o <CTe> (só o <enviCTe> vazio para ver se aceita)
  const envelopeMinimo = `<soap12:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:soap12="http://www.w3.org/2003/05/soap-envelope"><soap12:Body><cteDadosMsg xmlns="http://www.portalfiscal.inf.br/cte/wsdl/CTeRecepcaoSincV4"><enviCTe xmlns="http://www.portalfiscal.inf.br/cte" versao="4.00"><idLote>1</idLote></enviCTe></cteDadosMsg></soap12:Body></soap12:Envelope>`

  async function enviar(label: string, envelope: string) {
    console.log(`\n========== ${label} ==========`)
    const bodyBuf = Buffer.from(envelope, 'utf-8')
    const contentType = `application/soap+xml; charset=utf-8; action="${action}"`

    console.log('Content-Length:', bodyBuf.length)

    return new Promise<void>((resolve) => {
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
          console.log('HTTP Status:', res.statusCode)
          console.log('Content-Length resp:', res.headers['content-length'])
          console.log('Body length:', body.length)
          if (body.length > 0) {
            console.log('Body (1500 chars):', body.substring(0, 1500))
            // Extrair cStat/xMotivo
            const cStat = body.match(/<cStat>(\d+)<\/cStat>/)
            const xMotivo = body.match(/<xMotivo>([^<]+)<\/xMotivo>/)
            if (cStat) console.log('\n→ cStat:', cStat[1])
            if (xMotivo) console.log('→ xMotivo:', xMotivo[1])
          } else {
            console.log('→ BODY VAZIO (o servidor rejeitou antes de processar)')
          }
          resolve()
        })
      })

      req.on('error', (e) => { console.error('ERRO:', e.message); resolve() })
      req.on('timeout', () => { req.destroy(); console.error('TIMEOUT'); resolve() })
      req.write(bodyBuf)
      req.end()
    })
  }

  // Teste 1: envelope mínimo (sem CT-e, só enviCTe vazio)
  await enviar('TESTE 1: enviCTe VAZIO (testar se endpoint aceita o formato)', envelopeMinimo)

  // Esperar 2s entre testes
  await new Promise(r => setTimeout(r, 2000))

  // Teste 2: envelope completo do Vizor (com CT-e assinado)
  await enviar('TESTE 2: Envelope completo do Vizor (debug-envelope-cte.xml)', envelopeAtual)

  console.log('\n\n=== FIM ===')
}

main().catch(console.error)
