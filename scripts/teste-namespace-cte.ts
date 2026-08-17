/**
 * Teste de namespaces no endpoint CTeRecepcaoSincV4
 * O endpoint CTeStatusServicoV4 funciona, mas CTeRecepcaoSincV4 dá 400.
 * Vamos testar variações do namespace no cteDadosMsg.
 *
 * npx tsx scripts/teste-namespace-cte.ts
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

  if (!cert?.pfxEncrypted || !cert?.senhaEncrypted) { process.exit(1) }

  const pfx = decryptPfx(cert.pfxEncrypted)
  const senha = decryptSenha(cert.senhaEncrypted)
  console.log('Certificado OK')

  const url = 'https://cte-homologacao.svrs.rs.gov.br/ws/CTeRecepcaoSincV4/CTeRecepcaoSincV4.asmx'

  // O CT-e mínimo válido para schema (tpAmb + xServ não é CT-e, mas vamos ver se aceita o envelope)
  // Vamos enviar um XML de consulta de status MAS no endpoint de Recepcao — para ver se aceita o formato
  const cteMinimo = `<enviCTe xmlns="http://www.portalfiscal.inf.br/cte" versao="4.00"><idLote>1</idLote></enviCTe>`

  // Variações a testar:
  const testes = [
    {
      label: 'Namespace SEM V4 + action SEM V4 (antigo padrão ACBr v3)',
      namespace: 'http://www.portalfiscal.inf.br/cte/wsdl/CteRecepcaoSinc',
      action: 'http://www.portalfiscal.inf.br/cte/wsdl/CteRecepcaoSinc/cteRecepcaoSinc',
    },
    {
      label: 'Namespace COM V4 (padrão atual)',
      namespace: 'http://www.portalfiscal.inf.br/cte/wsdl/CTeRecepcaoSincV4',
      action: 'http://www.portalfiscal.inf.br/cte/wsdl/CTeRecepcaoSincV4/cteRecepcao',
    },
    {
      label: 'Namespace COM V4 + tag nfeDadosMsg em vez de cteDadosMsg',
      namespace: 'http://www.portalfiscal.inf.br/cte/wsdl/CTeRecepcaoSincV4',
      action: 'http://www.portalfiscal.inf.br/cte/wsdl/CTeRecepcaoSincV4/cteRecepcao',
      tagDadosMsg: 'nfeDadosMsg',
    },
    {
      label: 'SEM namespace no cteDadosMsg (xmlns vazio)',
      namespace: '',
      action: 'http://www.portalfiscal.inf.br/cte/wsdl/CTeRecepcaoSincV4/cteRecepcao',
    },
    {
      label: 'Action diferente: CTeRecepcaoSinc (sem V4) no action',
      namespace: 'http://www.portalfiscal.inf.br/cte/wsdl/CTeRecepcaoSincV4',
      action: 'http://www.portalfiscal.inf.br/cte/wsdl/CTeRecepcaoSinc/cteRecepcaoSinc',
    },
  ]

  for (const teste of testes) {
    console.log(`\n========== ${teste.label} ==========`)
    const tag = teste.tagDadosMsg || 'cteDadosMsg'
    const nsAttr = teste.namespace ? ` xmlns="${teste.namespace}"` : ''
    const envelope = `<soap12:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:soap12="http://www.w3.org/2003/05/soap-envelope"><soap12:Body><${tag}${nsAttr}>${cteMinimo}</${tag}></soap12:Body></soap12:Envelope>`

    const bodyBuf = Buffer.from(envelope, 'utf-8')
    const contentType = `application/soap+xml; charset=utf-8; action="${teste.action}"`

    await new Promise<void>((resolve) => {
      const parsedUrl = new URL(url)
      const agent = new https.Agent({ pfx, passphrase: senha, rejectUnauthorized: false, minVersion: 'TLSv1.2', maxVersion: 'TLSv1.2' })

      const req = https.request({
        hostname: parsedUrl.hostname, port: 443, path: parsedUrl.pathname,
        method: 'POST', agent, timeout: 15000,
        headers: {
          'Content-Type': contentType,
          'Content-Length': bodyBuf.length,
          'SOAPAction': `"${teste.action}"`,
        },
      }, (res) => {
        const chunks: Buffer[] = []
        res.on('data', (c) => chunks.push(c))
        res.on('end', () => {
          const body = Buffer.concat(chunks).toString('utf-8')
          console.log(`HTTP ${res.statusCode} | Body: ${body.length} chars`)
          if (body.length > 0) {
            // Extrair cStat/xMotivo
            const cStat = body.match(/<cStat>(\d+)<\/cStat>/)
            const xMotivo = body.match(/<xMotivo>([^<]+)<\/xMotivo>/)
            if (cStat) console.log(`  cStat: ${cStat[1]} — ${xMotivo?.[1] || ''}`)
            else console.log(`  Body: ${body.substring(0, 300)}`)
          } else {
            console.log('  → BODY VAZIO (rejeitado)')
          }
          resolve()
        })
      })
      req.on('error', (e) => { console.error('  ERRO:', e.message); resolve() })
      req.on('timeout', () => { req.destroy(); console.error('  TIMEOUT'); resolve() })
      req.write(bodyBuf)
      req.end()
    })

    // Esperar 1s entre testes
    await new Promise(r => setTimeout(r, 1000))
  }

  console.log('\n=== FIM ===')
}

main().catch(console.error)
