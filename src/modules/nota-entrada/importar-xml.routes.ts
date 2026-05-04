import { FastifyInstance } from 'fastify'
import multipart from '@fastify/multipart'

export async function importarXmlRoutes(app: FastifyInstance) {
  app.post('/importar-xml', async (request, reply) => {
    const data = await request.file()
    if (!data) return reply.status(400).send({ message: 'Nenhum arquivo enviado' })

    const buffer = await data.toBuffer()
    const xmlString = buffer.toString('utf-8')

    try {
      const nota = parseNfeXml(xmlString)
      return nota
    } catch (err: any) {
      return reply.status(400).send({ message: 'Erro ao processar XML: ' + err.message })
    }
  })
}

function parseNfeXml(xml: string) {
  // Parser simples de XML da NF-e usando regex (sem dependência externa)
  const getTag = (tag: string, source: string): string => {
    const regex = new RegExp(`<${tag}[^>]*>([^<]*)</${tag}>`, 'i')
    const match = source.match(regex)
    return match ? match[1].trim() : ''
  }

  const getBlock = (tag: string, source: string): string => {
    const regex = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i')
    const match = source.match(regex)
    return match ? match[1] : ''
  }

  const getAllBlocks = (tag: string, source: string): string[] => {
    const regex = new RegExp(`<${tag}[^>]*>[\\s\\S]*?</${tag}>`, 'gi')
    return source.match(regex) || []
  }

  // Dados da NF
  const ide = getBlock('ide', xml)
  const numero = parseInt(getTag('nNF', ide)) || 0
  const serie = getTag('serie', ide)
  const dataEmissao = getTag('dhEmi', ide).substring(0, 10) // YYYY-MM-DD

  // Emitente (fornecedor)
  const emit = getBlock('emit', xml)
  const fornecedor = getTag('xNome', emit)
  const fornecedorDoc = getTag('CNPJ', emit)

  // Transportadora
  const transp = getBlock('transp', xml)
  const transportadoraBlock = getBlock('transporta', transp)
  const transportadora = getTag('xNome', transportadoraBlock)

  // Itens
  const dets = getAllBlocks('det', xml)
  const itens = dets.map((det, index) => {
    const prod = getBlock('prod', det)
    return {
      item: index + 1,
      codigoProduto: getTag('cProd', prod),
      descricao: getTag('xProd', prod),
      unidade: getTag('uCom', prod),
      quantidade: parseFloat(getTag('qCom', prod)) || 0,
      valorUnitario: parseFloat(getTag('vUnCom', prod)) || 0,
      valorTotal: parseFloat(getTag('vProd', prod)) || 0,
      ncm: getTag('NCM', prod),
      ean: getTag('cEAN', prod) !== 'SEM GTIN' ? getTag('cEAN', prod) : '',
      lote: '', // Lote vem em outro bloco (rastro)
    }
  })

  // Tenta extrair lotes do bloco rastro
  const rastros = getAllBlocks('rastro', xml)
  rastros.forEach((rastro, i) => {
    const nLote = getTag('nLote', rastro)
    if (nLote && itens[i]) {
      itens[i].lote = nLote
    }
  })

  return {
    numero,
    serie,
    dataEmissao,
    fornecedor,
    fornecedorDoc: formatCnpj(fornecedorDoc),
    transportadora,
    tipo: 'COMPRA',
    itens,
  }
}

function formatCnpj(cnpj: string): string {
  if (!cnpj || cnpj.length !== 14) return cnpj
  return `${cnpj.slice(0,2)}.${cnpj.slice(2,5)}.${cnpj.slice(5,8)}/${cnpj.slice(8,12)}-${cnpj.slice(12)}`
}
