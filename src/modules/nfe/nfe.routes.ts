import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../../lib/prisma'
import { authenticate } from '../../middleware/authenticate'
import { moduloGuard } from '../../middleware/modulo-guard'
import { cancelarNFeSefaz, inutilizarNFeSefaz } from './nfe-sefaz'

const idParamsSchema = z.object({ id: z.string().uuid() })

const cancelarBodySchema = z.object({
  justificativa: z.string().min(15, 'Justificativa deve ter no mínimo 15 caracteres'),
})

const inutilizarBodySchema = z.object({
  serie: z.number().int().positive(),
  numInicio: z.number().int().positive(),
  numFim: z.number().int().positive(),
  justificativa: z.string().min(15),
})

const listQuerySchema = z.object({
  page: z.coerce.number().int().positive().optional().default(1),
  limit: z.coerce.number().int().positive().max(100).optional().default(20),
})

export async function nfeRoutes(app: FastifyInstance) {
  app.addHook('onRequest', authenticate)
  app.addHook('preHandler', moduloGuard('VENDAS'))

  // GET / — lista NF-e (agora via DocumentoFiscal)
  app.get('/', async (request) => {
    const user = request.user as { id: string; empresaId: string }
    const { page, limit } = listQuerySchema.parse(request.query)

    const where = { empresaId: user.empresaId, tipo: 'NFE' as const }
    const [data, total] = await Promise.all([
      prisma.documentoFiscal.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { criadoEm: 'desc' },
        select: {
          id: true, numero: true, serie: true, chaveAcesso: true,
          status: true, tipoOperacao: true, ambiente: true, criadoEm: true,
          valorTotal: true,
          vendaEfetivada: { select: { valorTotal: true, pedidoVenda: { select: { numero: true, cliente: { select: { razaoSocial: true } } } } } },
        },
      }),
      prisma.documentoFiscal.count({ where }),
    ])

    // Mapear tipoOperacao para tipoNfe (retrocompatibilidade)
    const dataCompat = data.map((d) => ({
      ...d,
      tipoNfe: d.tipoOperacao === 1 ? 'SAIDA' : 'ENTRADA',
    }))

    return { data: dataCompat, total }
  })

  // GET /:id — detalhe
  app.get('/:id', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const { id } = idParamsSchema.parse(request.params)

    const nfe = await prisma.documentoFiscal.findFirst({
      where: { id, empresaId: user.empresaId, tipo: 'NFE' },
      include: { itens: { include: { produto: { select: { nome: true } } } } },
    })

    if (!nfe) return reply.status(404).send({ message: 'NF-e não encontrada' })
    return nfe
  })

  // POST /:id/cancelar — cancela NF-e
  app.post('/:id/cancelar', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const { id } = idParamsSchema.parse(request.params)
    const { justificativa } = cancelarBodySchema.parse(request.body)

    const nfe = await prisma.documentoFiscal.findFirst({ where: { id, empresaId: user.empresaId, tipo: 'NFE' } })
    if (!nfe) return reply.status(404).send({ message: 'NF-e não encontrada' })
    if (nfe.status !== 'AUTORIZADO') return reply.status(422).send({ message: 'Apenas NF-e autorizadas podem ser canceladas' })

    const resposta = await cancelarNFeSefaz(nfe.chaveAcesso || '', nfe.protocolo || '', justificativa, nfe.ambiente)

    if (resposta.sucesso) {
      await prisma.documentoFiscal.update({ where: { id }, data: { status: 'CANCELADO' } })
    }

    return { sucesso: resposta.sucesso, sefaz: resposta }
  })

  // GET /:id/danfe — redireciona para novo serviço DANFE PDF
  app.get('/:id/danfe', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const { id } = idParamsSchema.parse(request.params)

    const nfe = await prisma.documentoFiscal.findFirst({
      where: { id, empresaId: user.empresaId, tipo: 'NFE' },
      include: { itens: true },
    })
    if (!nfe) return reply.status(404).send({ message: 'NF-e não encontrada' })

    const empresa = await prisma.empresa.findUnique({ where: { id: user.empresaId } })

    // Gerar HTML do DANFE e retornar para impressão
    const itensHtml = nfe.itens.map((item) => `
      <tr>
        <td style="padding:3px 6px;border:1px solid #000;text-align:center;font-size:9px">${item.nItem}</td>
        <td style="padding:3px 6px;border:1px solid #000;font-size:9px">${item.codigoProd}</td>
        <td style="padding:3px 6px;border:1px solid #000;font-size:9px">${item.descricao}</td>
        <td style="padding:3px 6px;border:1px solid #000;font-size:9px">${item.ncm}</td>
        <td style="padding:3px 6px;border:1px solid #000;font-size:9px">${item.cfop}</td>
        <td style="padding:3px 6px;border:1px solid #000;font-size:9px">${item.unidade}</td>
        <td style="padding:3px 6px;border:1px solid #000;text-align:right;font-size:9px">${Number(item.quantidade).toFixed(4)}</td>
        <td style="padding:3px 6px;border:1px solid #000;text-align:right;font-size:9px">${Number(item.valorUnitario).toFixed(4)}</td>
        <td style="padding:3px 6px;border:1px solid #000;text-align:right;font-size:9px">${Number(item.valorTotal).toFixed(2)}</td>
      </tr>
    `).join('')

    const valorTotal = nfe.itens.reduce((s, i) => s + Number(i.valorTotal), 0)
    const totalICMS = nfe.itens.reduce((s, i) => s + Number(i.icmsValor), 0)

    const html = `
    <!DOCTYPE html>
    <html><head><meta charset="utf-8"><title>DANFE - NF ${nfe.numero}</title>
    <style>
      body { font-family: Arial, sans-serif; margin: 10px; font-size: 10px; }
      .header { border: 2px solid #000; padding: 8px; margin-bottom: 4px; }
      .header h1 { font-size: 14px; margin: 0; }
      .header h2 { font-size: 11px; margin: 2px 0; color: #333; }
      .info-grid { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 4px; margin-bottom: 4px; }
      .info-box { border: 1px solid #000; padding: 4px 6px; }
      .info-box label { font-size: 7px; color: #666; display: block; }
      .info-box span { font-size: 10px; font-weight: bold; }
      table { width: 100%; border-collapse: collapse; }
      th { padding: 3px 6px; border: 1px solid #000; background: #f0f0f0; font-size: 8px; text-align: center; }
      .chave { font-family: monospace; font-size: 9px; letter-spacing: 1px; text-align: center; margin: 4px 0; }
      .danfe-label { font-size: 20px; font-weight: bold; text-align: center; border: 2px solid #000; padding: 4px; }
      @media print { body { margin: 5mm; } }
    </style></head><body>
    <div class="header">
      <div style="display:flex;justify-content:space-between;align-items:center">
        <div style="flex:1">
          <h1>${empresa?.razaoSocial || 'EMPRESA'}</h1>
          <h2>${empresa?.nomeFantasia || ''}</h2>
          <div style="font-size:9px">CNPJ: ${empresa?.cnpj || ''} | IE: ${empresa?.inscEstadual || ''}</div>
          <div style="font-size:9px">${empresa?.logradouro || ''}, ${empresa?.numero || ''} - ${empresa?.bairro || ''} - ${empresa?.cidade || ''}/${empresa?.uf || ''} - CEP: ${empresa?.cep || ''}</div>
        </div>
        <div class="danfe-label">DANFE</div>
        <div style="text-align:right">
          <div style="font-size:9px">NF-e</div>
          <div style="font-size:16px;font-weight:bold">Nº ${String(nfe.numero).padStart(9, '0')}</div>
          <div style="font-size:9px">Série ${nfe.serie}</div>
          <div style="font-size:9px">${nfe.tipoOperacao === 1 ? 'SAÍDA' : 'ENTRADA'}</div>
        </div>
      </div>
    </div>

    <div class="chave">CHAVE DE ACESSO: ${nfe.chaveAcesso || 'N/A'}</div>
    <div style="text-align:center;font-size:8px;margin-bottom:4px">
      ${nfe.protocolo ? `Protocolo: ${nfe.protocolo}` : 'Sem protocolo de autorização'}
    </div>

    <div class="info-grid">
      <div class="info-box"><label>NATUREZA DA OPERAÇÃO</label><span>${nfe.naturezaOp || 'VENDA'}</span></div>
      <div class="info-box"><label>TIPO</label><span>${nfe.tipoOperacao === 1 ? '1 - SAÍDA' : '0 - ENTRADA'}</span></div>
      <div class="info-box"><label>AMBIENTE</label><span>${nfe.ambiente === 1 ? 'PRODUÇÃO' : 'HOMOLOGAÇÃO'}</span></div>
    </div>

    <div style="border:1px solid #000;padding:4px;margin-bottom:4px">
      <div style="font-size:8px;font-weight:bold;margin-bottom:2px">DADOS DOS PRODUTOS / SERVIÇOS</div>
      <table>
        <thead><tr>
          <th>Item</th><th>Código</th><th>Descrição</th><th>NCM</th><th>CFOP</th><th>Un</th><th>Qtd</th><th>Vl Unit</th><th>Vl Total</th>
        </tr></thead>
        <tbody>${itensHtml}</tbody>
      </table>
    </div>

    <div class="info-grid">
      <div class="info-box"><label>VALOR TOTAL DOS PRODUTOS</label><span>R$ ${valorTotal.toFixed(2)}</span></div>
      <div class="info-box"><label>VALOR TOTAL ICMS</label><span>R$ ${totalICMS.toFixed(2)}</span></div>
      <div class="info-box"><label>VALOR TOTAL DA NOTA</label><span>R$ ${valorTotal.toFixed(2)}</span></div>
    </div>

    <div style="text-align:center;font-size:8px;margin-top:8px;color:#888">
      Documento gerado pelo VisioFab ERP — ${new Date().toLocaleString('pt-BR')}
    </div>
    </body></html>`

    reply.header('Content-Type', 'text/html')
    return reply.send(html)
  })

  // POST /inutilizar — inutiliza faixa
  app.post('/inutilizar', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const body = inutilizarBodySchema.parse(request.body)

    const empresa = await prisma.empresa.findUnique({ where: { id: user.empresaId } })
    if (!empresa) return reply.status(404).send({ message: 'Empresa não encontrada' })

    const resposta = await inutilizarNFeSefaz(empresa.cnpj, body.serie, body.numInicio, body.numFim, body.justificativa, empresa.ambienteNFe)

    return { sucesso: resposta.sucesso, sefaz: resposta }
  })
}
