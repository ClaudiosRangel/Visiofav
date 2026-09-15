/**
 * Serviço de Integração Vendas → Fiscal
 * Responsável por montar DadosNFe a partir de um pedido de venda e emitir via nfeEmissaoService.
 *
 * Requirements: 2.1, 2.2, 7.1, 7.2, 7.3, 7.4, 7.5, 2.3, 2.7
 */

import { prisma } from '../../../lib/prisma'
import { nfeEmissaoService, type EmissaoNFeResult } from '../emissor-dfe/nfe/nfe-emissao.service'
import { UF_CODES, type DadosNFe, type DadosItemNFe, type DadosEmitenteNFe, type DadosDestinatarioNFe } from '../emissor-dfe/nfe/nfe-xml-builder'
import type { DadosTransporte } from '../emissor-dfe/tipos'
import { buscarMunicipiosIBGE } from '../emissor-dfe/cte/cte-municipios.routes'

/**
 * Resolve o código IBGE de município (7 dígitos) a partir do nome + UF quando
 * o código cadastrado está ausente. Reusa o mesmo mecanismo do CT-e (cache
 * IBGE 24h). Retorna o código informado se já preenchido, ou '' se não achar.
 */
async function resolverCodigoMunicipio(
  codigoAtual: string | null | undefined,
  nomeMunicipio: string | null | undefined,
  uf: string | null | undefined,
): Promise<string> {
  const atual = (codigoAtual ?? '').trim()
  if (atual.length === 7) return atual
  if (!nomeMunicipio || !uf) return atual
  const municipios = await buscarMunicipiosIBGE(uf)
  if (municipios.length === 0) return atual
  const norm = (s: string) => s.toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim()
  const alvo = norm(nomeMunicipio)
  const achado = municipios.find((m) => norm(m.nome) === alvo)
  return achado?.codigo ?? atual
}

// === Tipos ===

export interface PedidoVendaComItens {
  id: string
  numero: number
  clienteId: string
  valorTotal: number | { toNumber(): number }
  modalidadeFrete?: string | null
  observacaoNota?: string | null
  numeroPedidoCliente?: string | null
  enderecoEntrega?: any | null
  transportadora?: {
    cnpj: string | null
    razaoSocial: string | null
    inscEstadual?: string | null
    logradouro?: string | null
    numero?: string | null
    bairro?: string | null
    cidade?: string | null
    uf?: string | null
  } | null
  itens: ItemPedidoVendaComProduto[]
}

export interface ItemPedidoVendaComProduto {
  produtoId: string
  quantidade: number | { toNumber(): number }
  precoFinal: number | { toNumber(): number }
  valorTotal: number | { toNumber(): number }
  unidade: string
  produto: {
    codigo: string
    nome: string
    ncm: string | null
    cfopEstadual: string | null
    cfopInterest: string | null
    unidade: string
  }
}

export interface EmpresaComEndereco {
  id: string
  cnpj: string
  razaoSocial: string
  nomeFantasia?: string | null
  inscEstadual?: string | null
  logradouro?: string | null
  numero?: string | null
  complemento?: string | null
  bairro?: string | null
  cidade?: string | null
  codigoMunicipio?: string | null
  uf?: string | null
  cep?: string | null
  telefone?: string | null
  regimeTributario: number
  ambienteNFe: number
  serieNFe: number
  respTecCnpj?: string | null
  respTecContato?: string | null
  respTecEmail?: string | null
  respTecFone?: string | null
}

export interface ClienteComEndereco {
  id: string
  cpfCnpj: string
  razaoSocial: string
  inscEstadual?: string | null
  logradouro?: string | null
  numero?: string | null
  complemento?: string | null
  bairro?: string | null
  cidade?: string | null
  codigoMunicipio?: string | null
  uf?: string | null
  cep?: string | null
}

// === Funções auxiliares ===

function toNumber(value: number | { toNumber(): number } | null | undefined): number {
  if (value === null || value === undefined) return 0
  if (typeof value === 'number') return value
  return value.toNumber()
}

function gerarCNF(): string {
  return String(Math.floor(Math.random() * 99999999)).padStart(8, '0')
}

/**
 * De/para de forma de pagamento (texto livre da CondicaoPagamento) → código
 * `tPag` da NF-e 4.00 (2 dígitos). Sem correspondência → 99 (Outros).
 *
 * Tabela tPag: 01=Dinheiro, 02=Cheque, 03=Cartão Crédito, 04=Cartão Débito,
 * 05=Crédito Loja, 10=Vale Alimentação, 11=Vale Refeição, 13=Vale Combustível,
 * 15=Boleto, 16=Depósito, 17=PIX, 18=Transferência, 19=Cashback,
 * 90=Sem pagamento, 99=Outros.
 */
export function mapearFormaPagamentoTPag(formaLivre: string | null | undefined): string {
  const f = (formaLivre ?? '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  if (!f) return '99'
  if (/dinheiro|especie|a vista|avista/.test(f)) return '01'
  if (/cheque/.test(f)) return '02'
  if (/credito|cartao de credito/.test(f)) return '03'
  if (/debito/.test(f)) return '04'
  if (/boleto|duplicata/.test(f)) return '15'
  if (/deposito/.test(f)) return '16'
  if (/pix/.test(f)) return '17'
  if (/transferencia|ted|doc/.test(f)) return '18'
  if (/cartao/.test(f)) return '03'
  return '99'
}

// === Serviço ===

/**
 * Monta DadosNFe a partir de um pedido de venda para emissão de NF-e.
 * Função pura — não faz I/O.
 *
 * Requirements: 2.2, 7.1, 7.2, 7.3, 7.4, 2.3
 */
export function montarDadosNFe(params: {
  pedidoVenda: PedidoVendaComItens
  empresa: EmpresaComEndereco
  cliente: ClienteComEndereco
  /** Forma de pagamento (texto livre da condição) e nº de parcelas, para o grupo pag/detPag. */
  pagamento?: { formaLivre?: string | null; parcelas?: number }
}): DadosNFe {
  const { pedidoVenda, empresa, cliente } = params

  const ufEmitente = empresa.uf || ''
  const ufDestinatario = cliente.uf || ufEmitente
  const isInterestadual = ufEmitente !== ufDestinatario

  const emitente: DadosEmitenteNFe = {
    cnpj: empresa.cnpj,
    razaoSocial: empresa.razaoSocial,
    uf: ufEmitente,
    ie: empresa.inscEstadual || undefined,
    nomeFantasia: empresa.nomeFantasia || undefined,
    crt: empresa.regimeTributario,
    endereco: {
      logradouro: empresa.logradouro || '',
      numero: empresa.numero || '',
      complemento: empresa.complemento || undefined,
      bairro: empresa.bairro || '',
      codigoMunicipio: empresa.codigoMunicipio || '', // fallback IBGE resolvido em emitirParaVenda
      municipio: empresa.cidade || '',
      uf: ufEmitente,
      cep: empresa.cep || '',
      telefone: empresa.telefone || undefined,
    },
  }

  // Determinar endereço do destinatário: usar enderecoEntrega se fornecido, senão endereço cadastral
  const enderecoEntrega = pedidoVenda.enderecoEntrega
  const destUf = enderecoEntrega?.uf || ufDestinatario
  const isInterestadualDest = ufEmitente !== destUf

  const destinatario: DadosDestinatarioNFe = {
    cpfCnpj: cliente.cpfCnpj,
    razaoSocial: cliente.razaoSocial,
    uf: destUf,
    ie: cliente.inscEstadual || undefined,
    indIEDest: cliente.inscEstadual ? 1 : 9,
    endereco: enderecoEntrega
      ? {
          logradouro: enderecoEntrega.logradouro || '',
          numero: enderecoEntrega.numero || '',
          complemento: enderecoEntrega.complemento || undefined,
          bairro: enderecoEntrega.bairro || '',
          codigoMunicipio: enderecoEntrega.codigoIbge || '',
          municipio: enderecoEntrega.cidade || '',
          uf: enderecoEntrega.uf || '',
          cep: enderecoEntrega.cep || '',
        }
      : {
          logradouro: cliente.logradouro || '',
          numero: cliente.numero || '',
          complemento: cliente.complemento || undefined,
          bairro: cliente.bairro || '',
          codigoMunicipio: cliente.codigoMunicipio || '',
          municipio: cliente.cidade || '',
          uf: ufDestinatario,
          cep: cliente.cep || '',
        },
  }

  // xPed: truncar numeroPedidoCliente em 15 chars
  const xPed = pedidoVenda.numeroPedidoCliente
    ? pedidoVenda.numeroPedidoCliente.substring(0, 15)
    : undefined

  const itens: DadosItemNFe[] = pedidoVenda.itens.map((item, index) => {
    const cfop = (isInterestadualDest || isInterestadual)
      ? (item.produto.cfopInterest || '6102')
      : (item.produto.cfopEstadual || '5102')

    return {
      nItem: index + 1,
      codigoProd: item.produto.codigo,
      descricao: item.produto.nome,
      ncm: item.produto.ncm || '00000000',
      cfop,
      unidade: item.produto.unidade || item.unidade || 'UN',
      quantidade: toNumber(item.quantidade),
      valorUnitario: toNumber(item.precoFinal),
      valorTotal: toNumber(item.valorTotal),
      xPed,
    }
  })

  const cUF = UF_CODES[ufEmitente] || 35

  // Montar grupo transporte com dados da transportadora
  const modalidadeFreteNum = pedidoVenda.modalidadeFrete
    ? parseInt(pedidoVenda.modalidadeFrete, 10)
    : 9

  const transporte: DadosTransporte = {
    modalidadeFrete: isNaN(modalidadeFreteNum) ? 9 : modalidadeFreteNum,
  }

  if (pedidoVenda.transportadora?.cnpj) {
    transporte.transportadoraCnpj = pedidoVenda.transportadora.cnpj
    transporte.transportadoraRazao = pedidoVenda.transportadora.razaoSocial || undefined
    transporte.transportadoraIE = pedidoVenda.transportadora.inscEstadual || undefined

    // Montar endereço completo da transportadora
    const transp = pedidoVenda.transportadora
    const endPartes = [transp.logradouro, transp.numero].filter(Boolean)
    if (endPartes.length > 0) {
      transporte.transportadoraEndereco = endPartes.join(', ')
    }
    transporte.transportadoraMunicipio = transp.cidade || undefined
    transporte.transportadoraUF = transp.uf || undefined
  }

  // infCpl: observacaoNota truncada em 5000 chars
  const informacoesAdicionais = pedidoVenda.observacaoNota
    ? pedidoVenda.observacaoNota.substring(0, 5000)
    : undefined

  // Grupo pag/detPag obrigatório (4.00). Mapeia a forma livre → tPag e divide
  // o valor total nas parcelas informadas (mínimo 1). Sem forma → 99 (Outros).
  const valorTotalNota = toNumber(pedidoVenda.valorTotal)
  const nParcelas = Math.max(1, params.pagamento?.parcelas ?? 1)
  const tPag = mapearFormaPagamentoTPag(params.pagamento?.formaLivre)
  const valorParcelaPag = Number((valorTotalNota / nParcelas).toFixed(2))
  const pagamento = Array.from({ length: nParcelas }, (_, i) => ({
    formaPagamento: tPag,
    valor:
      i === nParcelas - 1
        ? Number((valorTotalNota - valorParcelaPag * (nParcelas - 1)).toFixed(2))
        : valorParcelaPag,
  }))

  const dadosNFe: DadosNFe = {
    modelo: 55,
    serie: empresa.serieNFe,
    nNF: 0, // Será preenchido por proximoNumeroNFe no emitirParaVenda
    cUF,
    cNF: gerarCNF(),
    tpEmis: 1,
    ambiente: empresa.ambienteNFe,
    cMunFG: emitente.endereco.codigoMunicipio,
    naturezaOp: 'VENDA',
    tipoOperacao: 1, // Saída
    finalidade: 1,   // Normal
    dataEmissao: new Date(),
    dataSaida: new Date(),
    emitente,
    destinatario,
    itens,
    transporte,
    pagamento,
    informacoesAdicionais,
    respTec: empresa.respTecCnpj
      ? {
          cnpj: empresa.respTecCnpj,
          contato: empresa.respTecContato || empresa.razaoSocial,
          email: empresa.respTecEmail || '',
          fone: empresa.respTecFone || (empresa.telefone ?? ''),
        }
      : undefined,
  }

  return dadosNFe
}

/**
 * Emite NF-e para uma venda, buscando empresa e cliente do banco
 * e delegando para nfeEmissaoService.emitir().
 *
 * Requirements: 2.1, 7.5, 2.7
 */
export async function emitirParaVenda(params: {
  empresaId: string
  pedidoVenda: PedidoVendaComItens
}): Promise<EmissaoNFeResult> {
  const { empresaId, pedidoVenda } = params

  // Validar transportadora: deve ter CNPJ e razão social se informada
  if (pedidoVenda.transportadora) {
    const camposIncompletos: string[] = []
    if (!pedidoVenda.transportadora.cnpj) {
      camposIncompletos.push('cnpj')
    }
    if (!pedidoVenda.transportadora.razaoSocial) {
      camposIncompletos.push('razaoSocial')
    }
    if (camposIncompletos.length > 0) {
      throw Object.assign(
        new Error('Transportadora com dados incompletos para emissão da NF-e'),
        { statusCode: 422, camposIncompletos }
      )
    }
  }

  // Buscar empresa com dados de endereço
  const empresa = await prisma.empresa.findUniqueOrThrow({
    where: { id: empresaId },
    select: {
      id: true,
      cnpj: true,
      razaoSocial: true,
      nomeFantasia: true,
      inscEstadual: true,
      logradouro: true,
      numero: true,
      complemento: true,
      bairro: true,
      cidade: true,
      codigoMunicipio: true,
      uf: true,
      cep: true,
      telefone: true,
      regimeTributario: true,
      ambienteNFe: true,
      serieNFe: true,
      respTecCnpj: true,
      respTecContato: true,
      respTecEmail: true,
      respTecFone: true,
    },
  })

  // Buscar cliente com dados de endereço
  const cliente = await prisma.cliente.findUniqueOrThrow({
    where: { id: pedidoVenda.clienteId },
    select: {
      id: true,
      cpfCnpj: true,
      razaoSocial: true,
      inscEstadual: true,
      logradouro: true,
      numero: true,
      complemento: true,
      bairro: true,
      cidade: true,
      codigoMunicipio: true,
      uf: true,
      cep: true,
    },
  })

  // Validar que cliente possui endereço cadastral quando enderecoEntrega não informado
  if (!pedidoVenda.enderecoEntrega) {
    const temEndereco = cliente.logradouro && cliente.cidade && cliente.uf && cliente.cep
    if (!temEndereco) {
      throw Object.assign(
        new Error('Cliente não possui endereço cadastrado para emissão da NF-e'),
        { statusCode: 422 }
      )
    }
  }

  // Resolver códigos IBGE de município (obrigatórios: cMunFG/emit.cMun/dest.cMun).
  // Sem isso a SEFAZ rejeita. Fallback por nome+UF (cache IBGE) quando o
  // código cadastrado está ausente.
  const empresaComMun: EmpresaComEndereco = {
    ...empresa,
    codigoMunicipio: await resolverCodigoMunicipio(empresa.codigoMunicipio, empresa.cidade, empresa.uf),
  }
  const enderecoEntrega = pedidoVenda.enderecoEntrega
  let pedidoParaMontar = pedidoVenda
  if (enderecoEntrega && !enderecoEntrega.codigoIbge) {
    // Endereço de entrega sem código IBGE: resolver por nome+UF
    const codigoIbge = await resolverCodigoMunicipio(null, enderecoEntrega.cidade, enderecoEntrega.uf)
    pedidoParaMontar = {
      ...pedidoVenda,
      enderecoEntrega: { ...enderecoEntrega, codigoIbge },
    }
  }
  const clienteComMun: ClienteComEndereco = enderecoEntrega
    ? cliente // com endereço de entrega o cMun vem do próprio endereço (codigoIbge)
    : {
        ...cliente,
        codigoMunicipio: await resolverCodigoMunicipio(cliente.codigoMunicipio, cliente.cidade, cliente.uf),
      }

  // Resolver forma/parcelas de pagamento a partir da condição do pedido
  const pedidoBanco = await prisma.pedidoVenda.findUnique({
    where: { id: pedidoVenda.id },
    select: { condicaoPagId: true, tabelaPreco: { select: { condicoes: true } } },
  })
  const condicao = pedidoBanco?.condicaoPagId
    ? pedidoBanco.tabelaPreco?.condicoes.find((c) => c.id === pedidoBanco.condicaoPagId)
    : pedidoBanco?.tabelaPreco?.condicoes[0]
  const pagamento = {
    formaLivre: condicao?.formaPagamento ?? null,
    parcelas: condicao?.parcelas ?? 1,
  }

  // Montar dados da NF-e
  const dadosNFe = montarDadosNFe({ pedidoVenda: pedidoParaMontar, empresa: empresaComMun, cliente: clienteComMun, pagamento })

  // Obter próximo número da NF-e
  const ultimoDoc = await prisma.documentoFiscal.findFirst({
    where: { empresaId, tipo: 'NFE', serie: empresa.serieNFe },
    orderBy: { numero: 'desc' },
    select: { numero: true },
  })
  dadosNFe.nNF = (ultimoDoc?.numero || 0) + 1

  // Emitir via nfeEmissaoService
  const resultado = await nfeEmissaoService.emitir({
    empresaId,
    dadosNFe,
  })

  return resultado
}

// Exportar instância como objeto para manter padrão do projeto
export const vendaFiscalService = {
  montarDadosNFe,
  emitirParaVenda,
}
