/**
 * Serviço de Integração Vendas → Fiscal
 * Responsável por montar DadosNFe a partir de um pedido de venda e emitir via nfeEmissaoService.
 *
 * Requirements: 2.1, 2.2
 */

import { prisma } from '../../../lib/prisma'
import { nfeEmissaoService, type EmissaoNFeResult } from '../emissor-dfe/nfe/nfe-emissao.service'
import { UF_CODES, type DadosNFe, type DadosItemNFe, type DadosEmitenteNFe, type DadosDestinatarioNFe } from '../emissor-dfe/nfe/nfe-xml-builder'

// === Tipos ===

export interface PedidoVendaComItens {
  id: string
  numero: number
  clienteId: string
  valorTotal: number | { toNumber(): number }
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
  uf?: string | null
  cep?: string | null
  telefone?: string | null
  regimeTributario: number
  ambienteNFe: number
  serieNFe: number
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

// === Serviço ===

/**
 * Monta DadosNFe a partir de um pedido de venda para emissão de NF-e.
 * Função pura — não faz I/O.
 *
 * Requirements: 2.2
 */
export function montarDadosNFe(params: {
  pedidoVenda: PedidoVendaComItens
  empresa: EmpresaComEndereco
  cliente: ClienteComEndereco
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
      codigoMunicipio: '', // Será preenchido pelo motor tributário ou pela empresa
      municipio: empresa.cidade || '',
      uf: ufEmitente,
      cep: empresa.cep || '',
      telefone: empresa.telefone || undefined,
    },
  }

  const destinatario: DadosDestinatarioNFe = {
    cpfCnpj: cliente.cpfCnpj,
    razaoSocial: cliente.razaoSocial,
    uf: ufDestinatario,
    ie: cliente.inscEstadual || undefined,
    indIEDest: cliente.inscEstadual ? 1 : 9,
    endereco: {
      logradouro: cliente.logradouro || '',
      numero: cliente.numero || '',
      complemento: cliente.complemento || undefined,
      bairro: cliente.bairro || '',
      codigoMunicipio: '',
      municipio: cliente.cidade || '',
      uf: ufDestinatario,
      cep: cliente.cep || '',
    },
  }

  const itens: DadosItemNFe[] = pedidoVenda.itens.map((item, index) => {
    const cfop = isInterestadual
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
    }
  })

  const cUF = UF_CODES[ufEmitente] || 35

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
  }

  return dadosNFe
}

/**
 * Emite NF-e para uma venda, buscando empresa e cliente do banco
 * e delegando para nfeEmissaoService.emitir().
 *
 * Requirements: 2.1
 */
export async function emitirParaVenda(params: {
  empresaId: string
  pedidoVenda: PedidoVendaComItens
}): Promise<EmissaoNFeResult> {
  const { empresaId, pedidoVenda } = params

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
      uf: true,
      cep: true,
      telefone: true,
      regimeTributario: true,
      ambienteNFe: true,
      serieNFe: true,
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
      uf: true,
      cep: true,
    },
  })

  // Montar dados da NF-e
  const dadosNFe = montarDadosNFe({ pedidoVenda, empresa, cliente })

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
