import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../../lib/prisma'
import { authenticate } from '../../middleware/authenticate'
import { moduloGuard } from '../../middleware/modulo-guard'
import { calcularTributos, calcularTotaisNFe } from './nfe-calculo'
import { gerarChaveAcesso } from './nfe-chave'
import { buildNFeXml } from './nfe-xml-builder'
import { assinarXml } from './nfe-assinatura'
import { enviarNFe, cancelarNFeSefaz, inutilizarNFeSefaz } from './nfe-sefaz'

const idParamsSchema = z.object({ id: z.string().uuid() })

const emitirBodySchema = z.object({
  vendaEfetivadaId: z.string().uuid().optional(),
  tipoNfe: z.enum(['SAIDA', 'ENTRADA', 'DEVOLUCAO', 'TRANSFERENCIA']).default('SAIDA'),
  tpNF: z.number().int().min(0).max(1).default(1),
  finNFe: z.number().int().min(1).max(4).default(1),
  natOp: z.string().default('VENDA DE MERCADORIA'),
  idDest: z.number().int().min(1).max(3).default(1),
  // Dados do destinatário (se não vinculado a venda)
  destinatario: z.object({
    cpfCnpj: z.string(),
    razaoSocial: z.string(),
    inscEstadual: z.string().optional(),
    logradouro: z.string().optional(),
    numero: z.string().optional(),
    bairro: z.string().optional(),
    cidade: z.string().optional(),
    uf: z.string().optional(),
    cep: z.string().optional(),
    email: z.string().optional(),
  }).optional(),
  itens: z.array(z.object({
    produtoId: z.string().uuid(),
    quantidade: z.number().positive(),
    precoUnitario: z.number().positive(),
  })).optional(),
  pagamento: z.array(z.object({
    tPag: z.string().default('01'),
    vPag: z.number(),
  })).optional(),
})

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

  // GET / — lista NF-e
  app.get('/', async (request) => {
    const user = request.user as { id: string; empresaId: string }
    const { page, limit } = listQuerySchema.parse(request.query)

    const where = { empresaId: user.empresaId }
    const [data, total] = await Promise.all([
      prisma.nfe.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { criadoEm: 'desc' },
        select: {
          id: true, numero: true, serie: true, chaveAcesso: true,
          status: true, tipoNfe: true, ambiente: true, criadoEm: true,
          vendaEfetivada: { select: { valorTotal: true, pedidoVenda: { select: { numero: true, cliente: { select: { razaoSocial: true } } } } } },
        },
      }),
      prisma.nfe.count({ where }),
    ])

    return { data, total }
  })

  // POST /:id/gerar-xml — gera XML da NF-e sem enviar para SEFAZ
  app.post('/:id/gerar-xml', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const { id } = idParamsSchema.parse(request.params)

    const nfe = await prisma.nfe.findFirst({
      where: { id, empresaId: user.empresaId },
      include: {
        itens: { include: { produto: true } },
        vendaEfetivada: {
          include: {
            pedidoVenda: {
              include: {
                cliente: true,
                itens: { include: { produto: true } },
              },
            },
          },
        },
      },
    })

    if (!nfe) return reply.status(404).send({ message: 'NF-e não encontrada' })
    if (nfe.xmlEnviado) return reply.status(422).send({ message: 'XML já foi gerado' })

    const empresa = await prisma.empresa.findUnique({ where: { id: user.empresaId } })
    if (!empresa) return reply.status(404).send({ message: 'Empresa não encontrada' })

    // Montar dados do destinatário
    const cliente = nfe.vendaEfetivada?.pedidoVenda?.cliente
    const dest = cliente ? {
      cpfCnpj: cliente.cpfCnpj,
      razaoSocial: cliente.razaoSocial,
      inscEstadual: cliente.inscEstadual || undefined,
      logradouro: cliente.logradouro || '',
      numero: cliente.numero || 'S/N',
      bairro: cliente.bairro || '',
      cidade: cliente.cidade || '',
      uf: cliente.uf || '',
      cep: cliente.cep || '',
      email: cliente.email || undefined,
    } : null

    // Montar itens
    const itensXml = nfe.itens.map((item) => ({
      nItem: item.nItem,
      cProd: item.cProd,
      xProd: item.xProd,
      ncm: item.ncm,
      cfop: item.cfop,
      uCom: item.uCom,
      qCom: Number(item.qCom),
      vUnCom: Number(item.vUnCom),
      vProd: Number(item.vProd),
      vICMS: Number(item.vICMS),
      vIPI: Number(item.vIPI),
      vPIS: Number(item.vPIS),
      vCOFINS: Number(item.vCOFINS),
    }))

    const valorTotal = itensXml.reduce((s, i) => s + i.vProd, 0)

    // Gerar chave de acesso
    const chaveAcesso = gerarChaveAcesso({
      cUF: empresa.uf === 'SP' ? '35' : '35',
      dataEmissao: new Date(),
      cnpj: empresa.cnpj,
      mod: '55',
      serie: String(nfe.serie),
      nNF: String(nfe.numero),
      tpEmis: '1',
      cNF: String(nfe.numero).padStart(8, '0'),
    })

    // Montar XML simplificado (sem assinatura, sem envio)
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<NFe xmlns="http://www.portalfiscal.inf.br/nfe">
  <infNFe versao="4.00" Id="NFe${chaveAcesso}">
    <ide>
      <cUF>35</cUF>
      <cNF>${String(nfe.numero).padStart(8, '0')}</cNF>
      <natOp>VENDA DE MERCADORIA</natOp>
      <mod>55</mod>
      <serie>${nfe.serie}</serie>
      <nNF>${nfe.numero}</nNF>
      <dhEmi>${new Date().toISOString()}</dhEmi>
      <tpNF>${nfe.tpNF}</tpNF>
      <idDest>1</idDest>
      <cMunFG>3550308</cMunFG>
      <tpImp>1</tpImp>
      <tpEmis>1</tpEmis>
      <cDV>${chaveAcesso.slice(-1)}</cDV>
      <tpAmb>${nfe.ambiente}</tpAmb>
      <finNFe>${nfe.finNFe}</finNFe>
      <indFinal>1</indFinal>
      <indPres>1</indPres>
      <procEmi>0</procEmi>
      <verProc>VisioFab 1.0</verProc>
    </ide>
    <emit>
      <CNPJ>${empresa.cnpj.replace(/\D/g, '')}</CNPJ>
      <xNome>${empresa.razaoSocial}</xNome>
      <xFant>${empresa.nomeFantasia || empresa.razaoSocial}</xFant>
      <enderEmit>
        <xLgr>${empresa.logradouro || ''}</xLgr>
        <nro>${empresa.numero || 'S/N'}</nro>
        <xBairro>${empresa.bairro || ''}</xBairro>
        <cMun>3550308</cMun>
        <xMun>${empresa.cidade || 'São Paulo'}</xMun>
        <UF>${empresa.uf || 'SP'}</UF>
        <CEP>${(empresa.cep || '').replace(/\D/g, '')}</CEP>
      </enderEmit>
      <IE>${empresa.inscEstadual || ''}</IE>
      <CRT>${empresa.regimeTributario}</CRT>
    </emit>
    ${dest ? `<dest>
      <CNPJ>${dest.cpfCnpj.replace(/\D/g, '')}</CNPJ>
      <xNome>${dest.razaoSocial}</xNome>
      <enderDest>
        <xLgr>${dest.logradouro}</xLgr>
        <nro>${dest.numero}</nro>
        <xBairro>${dest.bairro}</xBairro>
        <cMun>3550308</cMun>
        <xMun>${dest.cidade}</xMun>
        <UF>${dest.uf}</UF>
        <CEP>${(dest.cep || '').replace(/\D/g, '')}</CEP>
      </enderDest>
    </dest>` : ''}
    ${itensXml.map((item) => `<det nItem="${item.nItem}">
      <prod>
        <cProd>${item.cProd}</cProd>
        <cEAN>SEM GTIN</cEAN>
        <xProd>${item.xProd}</xProd>
        <NCM>${item.ncm}</NCM>
        <CFOP>${item.cfop}</CFOP>
        <uCom>${item.uCom}</uCom>
        <qCom>${item.qCom.toFixed(4)}</qCom>
        <vUnCom>${item.vUnCom.toFixed(4)}</vUnCom>
        <vProd>${item.vProd.toFixed(2)}</vProd>
        <cEANTrib>SEM GTIN</cEANTrib>
        <uTrib>${item.uCom}</uTrib>
        <qTrib>${item.qCom.toFixed(4)}</qTrib>
        <vUnTrib>${item.vUnCom.toFixed(4)}</vUnTrib>
        <indTot>1</indTot>
      </prod>
      <imposto>
        <ICMS><ICMS00><orig>0</orig><CST>00</CST><modBC>0</modBC><vBC>${item.vProd.toFixed(2)}</vBC><pICMS>0.00</pICMS><vICMS>0.00</vICMS></ICMS00></ICMS>
        <PIS><PISAliq><CST>01</CST><vBC>${item.vProd.toFixed(2)}</vBC><pPIS>0.00</pPIS><vPIS>0.00</vPIS></PISAliq></PIS>
        <COFINS><COFINSAliq><CST>01</CST><vBC>${item.vProd.toFixed(2)}</vBC><pCOFINS>0.00</pCOFINS><vCOFINS>0.00</vCOFINS></COFINSAliq></COFINS>
      </imposto>
    </det>`).join('\n')}
    <total>
      <ICMSTot>
        <vBC>0.00</vBC><vICMS>0.00</vICMS><vICMSDeson>0.00</vICMSDeson>
        <vFCPUFDest>0.00</vFCPUFDest><vICMSUFDest>0.00</vICMSUFDest><vICMSUFRemet>0.00</vICMSUFRemet>
        <vFCP>0.00</vFCP><vBCST>0.00</vBCST><vST>0.00</vST><vFCPST>0.00</vFCPST>
        <vFCPSTRet>0.00</vFCPSTRet><vProd>${valorTotal.toFixed(2)}</vProd><vFrete>0.00</vFrete>
        <vSeg>0.00</vSeg><vDesc>0.00</vDesc><vII>0.00</vII><vIPI>0.00</vIPI><vIPIDevol>0.00</vIPIDevol>
        <vPIS>0.00</vPIS><vCOFINS>0.00</vCOFINS><vOutro>0.00</vOutro><vNF>${valorTotal.toFixed(2)}</vNF>
      </ICMSTot>
    </total>
    <transp><modFrete>9</modFrete></transp>
    <pag><detPag><tPag>01</tPag><vPag>${valorTotal.toFixed(2)}</vPag></detPag></pag>
    <infAdic><infCpl>NF-e gerada pelo VisioFab ERP - Ambiente de Homologação</infCpl></infAdic>
  </infNFe>
</NFe>`

    // Salvar XML na NF-e
    await prisma.nfe.update({
      where: { id },
      data: {
        xmlEnviado: xml,
        chaveAcesso,
      },
    })

    return { message: 'XML gerado com sucesso', chaveAcesso, nfeId: id }
  })

  // POST / — emitir NF-e
  app.post('/', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const body = emitirBodySchema.parse(request.body)

    const empresa = await prisma.empresa.findUnique({ where: { id: user.empresaId } })
    if (!empresa) return reply.status(404).send({ message: 'Empresa não encontrada' })

    // Buscar dados da venda se vinculada
    let venda: any = null
    let cliente: any = null
    let itensParaNfe: any[] = []

    if (body.vendaEfetivadaId) {
      venda = await prisma.vendaEfetivada.findFirst({
        where: { id: body.vendaEfetivadaId, empresaId: user.empresaId },
        include: {
          pedidoVenda: {
            include: {
              itens: { include: { produto: true } },
              cliente: true,
            },
          },
        },
      })

      if (!venda) return reply.status(404).send({ message: 'Venda não encontrada' })

      cliente = venda.pedidoVenda.cliente
      itensParaNfe = venda.pedidoVenda.itens.map((item: any, idx: number) => ({
        nItem: idx + 1,
        produto: item.produto,
        quantidade: Number(item.quantidade),
        precoUnitario: Number(item.precoFinal),
        vProd: Number(item.valorTotal),
      }))
    } else if (body.itens && body.destinatario) {
      // NF-e manual
      cliente = body.destinatario
      const produtos = await prisma.produto.findMany({
        where: { id: { in: body.itens.map((i) => i.produtoId) }, empresaId: user.empresaId },
      })

      itensParaNfe = body.itens.map((item, idx) => {
        const produto = produtos.find((p) => p.id === item.produtoId)
        return {
          nItem: idx + 1,
          produto,
          quantidade: item.quantidade,
          precoUnitario: item.precoUnitario,
          vProd: Number((item.quantidade * item.precoUnitario).toFixed(2)),
        }
      })
    } else {
      return reply.status(400).send({ message: 'Informe vendaEfetivadaId ou destinatario + itens' })
    }

    // Validar campos fiscais dos produtos
    for (const item of itensParaNfe) {
      if (!item.produto?.ncm) {
        return reply.status(400).send({ message: `Produto "${item.produto?.nome}" sem NCM configurado`, code: 'CAMPOS_FISCAIS_INCOMPLETOS' })
      }
    }

    // Calcular tributos
    const itensComTributos = itensParaNfe.map((item) => {
      const tributos = calcularTributos({
        vProd: item.vProd,
        cst: item.produto.cst,
        csosn: item.produto.csosn,
        aliqICMS: Number(item.produto.aliqICMS),
        aliqIPI: Number(item.produto.aliqIPI),
        cstPIS: item.produto.cstPIS,
        aliqPIS: Number(item.produto.aliqPIS),
        cstCOFINS: item.produto.cstCOFINS,
        aliqCOFINS: Number(item.produto.aliqCOFINS),
        origemProd: item.produto.origemProd,
        regimeTributario: empresa.regimeTributario,
      })

      return { ...item, tributos }
    })

    const totais = calcularTotaisNFe(itensComTributos.map((i) => ({ vProd: i.vProd, tributos: i.tributos })))

    // Incrementar número e gerar chave
    const numero = empresa.proximoNumeroNFe
    const serie = empresa.serieNFe

    const chaveAcesso = gerarChaveAcesso({
      uf: empresa.uf || 'SP',
      dataEmissao: new Date(),
      cnpj: empresa.cnpj,
      modelo: 55,
      serie,
      numero,
    })

    // Montar XML
    const xml = buildNFeXml({
      chaveAcesso,
      numero,
      serie,
      dataEmissao: new Date().toISOString(),
      natOp: body.natOp,
      tpNF: body.tpNF,
      idDest: body.idDest,
      tpAmb: empresa.ambienteNFe,
      finNFe: body.finNFe,
      indFinal: 0,
      indPres: 9,
      emitente: {
        cnpj: empresa.cnpj,
        razaoSocial: empresa.razaoSocial,
        nomeFantasia: empresa.nomeFantasia || undefined,
        inscEstadual: empresa.inscEstadual || undefined,
        logradouro: empresa.logradouro || undefined,
        numero: empresa.numero || undefined,
        bairro: empresa.bairro || undefined,
        cidade: empresa.cidade || undefined,
        uf: empresa.uf || undefined,
        cep: empresa.cep || undefined,
        crt: empresa.regimeTributario,
      },
      destinatario: {
        cpfCnpj: cliente.cpfCnpj || cliente.cnpj || '',
        razaoSocial: cliente.razaoSocial || '',
        inscEstadual: cliente.inscEstadual || undefined,
        logradouro: cliente.logradouro || undefined,
        numero: cliente.numero || undefined,
        bairro: cliente.bairro || undefined,
        cidade: cliente.cidade || undefined,
        uf: cliente.uf || undefined,
        cep: cliente.cep || undefined,
        email: cliente.email || undefined,
      },
      itens: itensComTributos.map((item) => ({
        nItem: item.nItem,
        cProd: item.produto.codigo,
        cEAN: item.produto.cEAN || 'SEM GTIN',
        xProd: item.produto.nome,
        ncm: item.produto.ncm,
        cfop: item.produto.cfopEstadual || '5102',
        uCom: item.produto.unidade,
        qCom: item.quantidade,
        vUnCom: item.precoUnitario,
        vProd: item.vProd,
        indTot: 1,
        origemProd: item.produto.origemProd,
        tributos: item.tributos,
      })),
      totais,
      pagamento: body.pagamento || [{ tPag: '90', vPag: 0 }],
    })

    // Assinar
    const xmlAssinado = assinarXml(xml, empresa.certificadoPfx ? { pfxBase64: empresa.certificadoPfx, senha: empresa.senhaCertificado || '' } : null)

    // Enviar para SEFAZ
    const resposta = await enviarNFe(xmlAssinado, empresa.ambienteNFe)

    // Salvar no banco
    const nfe = await prisma.$transaction(async (tx) => {
      const nfeRecord = await tx.nfe.create({
        data: {
          empresaId: user.empresaId,
          vendaEfetivadaId: body.vendaEfetivadaId,
          numero,
          serie,
          chaveAcesso,
          xmlEnviado: xmlAssinado,
          xmlRetorno: resposta.xmlRetorno,
          protocolo: resposta.protocolo,
          status: resposta.sucesso ? 'AUTORIZADA' : 'REJEITADA',
          tipoNfe: body.tipoNfe,
          tpNF: body.tpNF,
          finNFe: body.finNFe,
          ambiente: empresa.ambienteNFe,
          itens: {
            create: itensComTributos.map((item) => ({
              nItem: item.nItem,
              produtoId: item.produto.id,
              cProd: item.produto.codigo,
              xProd: item.produto.nome,
              ncm: item.produto.ncm,
              cfop: item.produto.cfopEstadual || '5102',
              uCom: item.produto.unidade,
              qCom: item.quantidade,
              vUnCom: item.precoUnitario,
              vProd: item.vProd,
              vICMS: item.tributos.vICMS,
              vIPI: item.tributos.vIPI,
              vPIS: item.tributos.vPIS,
              vCOFINS: item.tributos.vCOFINS,
            })),
          },
        },
      })

      // Incrementar número
      await tx.empresa.update({
        where: { id: user.empresaId },
        data: { proximoNumeroNFe: numero + 1 },
      })

      return nfeRecord
    })

    return reply.status(201).send({ nfe, sefaz: resposta })
  })

  // GET /:id — detalhe
  app.get('/:id', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const { id } = idParamsSchema.parse(request.params)

    const nfe = await prisma.nfe.findFirst({
      where: { id, empresaId: user.empresaId },
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

    const nfe = await prisma.nfe.findFirst({ where: { id, empresaId: user.empresaId } })
    if (!nfe) return reply.status(404).send({ message: 'NF-e não encontrada' })
    if (nfe.status !== 'AUTORIZADA') return reply.status(422).send({ message: 'Apenas NF-e autorizadas podem ser canceladas' })

    const resposta = await cancelarNFeSefaz(nfe.chaveAcesso || '', nfe.protocolo || '', justificativa, nfe.ambiente)

    if (resposta.sucesso) {
      await prisma.nfe.update({ where: { id }, data: { status: 'CANCELADA' } })
    }

    return { sucesso: resposta.sucesso, sefaz: resposta }
  })

  // GET /:id/danfe — gera PDF do DANFE
  app.get('/:id/danfe', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const { id } = idParamsSchema.parse(request.params)

    const nfe = await prisma.nfe.findFirst({
      where: { id, empresaId: user.empresaId },
      include: { itens: true },
    })
    if (!nfe) return reply.status(404).send({ message: 'NF-e não encontrada' })

    const empresa = await prisma.empresa.findUnique({ where: { id: user.empresaId } })

    // Gerar HTML do DANFE e retornar para impressão
    const itensHtml = nfe.itens.map((item, idx) => `
      <tr>
        <td style="padding:3px 6px;border:1px solid #000;text-align:center;font-size:9px">${item.nItem}</td>
        <td style="padding:3px 6px;border:1px solid #000;font-size:9px">${item.cProd}</td>
        <td style="padding:3px 6px;border:1px solid #000;font-size:9px">${item.xProd}</td>
        <td style="padding:3px 6px;border:1px solid #000;font-size:9px">${item.ncm}</td>
        <td style="padding:3px 6px;border:1px solid #000;font-size:9px">${item.cfop}</td>
        <td style="padding:3px 6px;border:1px solid #000;font-size:9px">${item.uCom}</td>
        <td style="padding:3px 6px;border:1px solid #000;text-align:right;font-size:9px">${Number(item.qCom).toFixed(4)}</td>
        <td style="padding:3px 6px;border:1px solid #000;text-align:right;font-size:9px">${Number(item.vUnCom).toFixed(4)}</td>
        <td style="padding:3px 6px;border:1px solid #000;text-align:right;font-size:9px">${Number(item.vProd).toFixed(2)}</td>
      </tr>
    `).join('')

    const valorTotal = nfe.itens.reduce((s, i) => s + Number(i.vProd), 0)
    const totalICMS = nfe.itens.reduce((s, i) => s + Number(i.vICMS), 0)

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
          <div style="font-size:9px">${nfe.tpNF === 1 ? 'SAÍDA' : 'ENTRADA'}</div>
        </div>
      </div>
    </div>

    <div class="chave">CHAVE DE ACESSO: ${nfe.chaveAcesso || 'N/A'}</div>
    <div style="text-align:center;font-size:8px;margin-bottom:4px">
      ${nfe.protocolo ? `Protocolo: ${nfe.protocolo}` : 'Sem protocolo de autorização'}
    </div>

    <div class="info-grid">
      <div class="info-box"><label>NATUREZA DA OPERAÇÃO</label><span>${nfe.finNFe === 1 ? 'VENDA' : nfe.finNFe === 2 ? 'COMPLEMENTAR' : nfe.finNFe === 3 ? 'AJUSTE' : nfe.finNFe === 4 ? 'DEVOLUÇÃO' : 'VENDA'}</span></div>
      <div class="info-box"><label>TIPO</label><span>${nfe.tpNF === 1 ? '1 - SAÍDA' : '0 - ENTRADA'}</span></div>
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
