/**
 * Serviço de Integração Devolução de Venda → Fiscal
 * Emite NF-e de entrada com finalidade=4 (devolução) referenciando a NF-e de saída original.
 */

import { prisma } from '../../lib/prisma'
import { nfeEmissaoService } from '../fiscal/emissor-dfe/nfe/nfe-emissao.service'
import { UF_CODES, type DadosNFe, type DadosItemNFe, type DadosEmitenteNFe, type DadosDestinatarioNFe } from '../fiscal/emissor-dfe/nfe/nfe-xml-builder'

function gerarCNF(): string {
  return String(Math.floor(Math.random() * 99999999)).padStart(8, '0')
}

export interface DadosDevolucaoParaNFe {
  empresaId: string
  vendaEfetivadaId: string
  itens: Array<{
    produtoId: string
    quantidade: number
    precoUnitario: number
    valorTotal: number
  }>
  valorTotal: number
  motivo: string
}

/**
 * Emite NF-e de entrada com finalidade=4 (devolução) referenciando a NF-e de saída original.
 *
 * Fluxo:
 * 1. Busca a NF-e de saída vinculada à VendaEfetivada (chaveAcesso)
 * 2. Monta DadosNFe com tipoOperacao=0 (entrada), finalidade=4 (devolução), nfesReferenciadas=[chave]
 * 3. Usa CFOPs de devolução (1202/2202 estadual/interestadual)
 * 4. Emite via nfeEmissaoService
 */
export async function emitirNFeDevolucao(dados: DadosDevolucaoParaNFe) {
  const { empresaId, vendaEfetivadaId, itens, valorTotal, motivo } = dados

  // 1. Buscar a NF-e de saída original vinculada à venda
  const docFiscalOriginal = await prisma.documentoFiscal.findFirst({
    where: {
      empresaId,
      vendaEfetivadaId,
      tipo: 'NFE',
      status: 'AUTORIZADO',
      tipoOperacao: 1, // Saída
    },
    select: { chaveAcesso: true, destCpfCnpj: true, destRazao: true, destUf: true, destIe: true },
  })

  // Se não encontrar NF-e autorizada, emite sem referência (fallback)
  const chaveReferenciada = docFiscalOriginal?.chaveAcesso || undefined

  // 2. Buscar empresa
  const empresa = await prisma.empresa.findUniqueOrThrow({
    where: { id: empresaId },
    select: {
      id: true, cnpj: true, razaoSocial: true, nomeFantasia: true, inscEstadual: true,
      logradouro: true, numero: true, complemento: true, bairro: true, cidade: true,
      uf: true, cep: true, telefone: true, regimeTributario: true, ambienteNFe: true, serieNFe: true,
    },
  })

  // 3. Buscar dados do cliente da venda
  const venda = await prisma.vendaEfetivada.findUniqueOrThrow({
    where: { id: vendaEfetivadaId },
    select: {
      pedidoVenda: {
        select: {
          clienteId: true,
          cliente: { select: { cpfCnpj: true, razaoSocial: true, inscEstadual: true, logradouro: true, numero: true, bairro: true, cidade: true, uf: true, cep: true } },
        },
      },
    },
  })

  const cliente = venda.pedidoVenda.cliente
  const ufEmitente = empresa.uf || 'SP'
  const ufCliente = cliente.uf || ufEmitente
  const isInterestadual = ufEmitente !== ufCliente

  // 4. Buscar produtos para montar itens
  const produtoIds = itens.map(i => i.produtoId)
  const produtos = await prisma.produto.findMany({
    where: { id: { in: produtoIds } },
    select: { id: true, codigo: true, nome: true, ncm: true, unidade: true },
  })
  const produtoMap = new Map(produtos.map(p => [p.id, p]))

  // 5. Montar DadosNFe para devolução
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
      codigoMunicipio: '',
      municipio: empresa.cidade || '',
      uf: ufEmitente,
      cep: empresa.cep || '',
      telefone: empresa.telefone || undefined,
    },
  }

  const destinatario: DadosDestinatarioNFe = {
    cpfCnpj: cliente.cpfCnpj,
    razaoSocial: cliente.razaoSocial,
    uf: ufCliente,
    ie: cliente.inscEstadual || undefined,
    indIEDest: cliente.inscEstadual ? 1 : 9,
    endereco: {
      logradouro: cliente.logradouro || '',
      numero: cliente.numero || '',
      bairro: cliente.bairro || '',
      codigoMunicipio: '',
      municipio: cliente.cidade || '',
      uf: ufCliente,
      cep: cliente.cep || '',
    },
  }

  // CFOPs de devolução de venda: 1202 (estadual) / 2202 (interestadual)
  const cfopDevolucao = isInterestadual ? '2202' : '1202'

  const itensNFe: DadosItemNFe[] = itens.map((item, index) => {
    const produto = produtoMap.get(item.produtoId)
    return {
      nItem: index + 1,
      codigoProd: produto?.codigo || item.produtoId,
      descricao: produto?.nome || 'Produto',
      ncm: produto?.ncm || '00000000',
      cfop: cfopDevolucao,
      unidade: produto?.unidade || 'UN',
      quantidade: item.quantidade,
      valorUnitario: item.precoUnitario,
      valorTotal: item.valorTotal,
    }
  })

  const cUF = UF_CODES[ufEmitente] || 35

  const dadosNFe: DadosNFe = {
    modelo: 55,
    serie: empresa.serieNFe,
    nNF: 0, // preenchido abaixo
    cUF,
    cNF: gerarCNF(),
    tpEmis: 1,
    ambiente: empresa.ambienteNFe,
    cMunFG: emitente.endereco.codigoMunicipio,
    naturezaOp: 'DEVOLUCAO DE VENDA',
    tipoOperacao: 0, // Entrada
    finalidade: 4,   // Devolução
    dataEmissao: new Date(),
    emitente,
    destinatario,
    itens: itensNFe,
    informacoesAdicionais: `Devolução de mercadoria. Motivo: ${motivo}`,
    nfesReferenciadas: chaveReferenciada ? [chaveReferenciada] : undefined,
  }

  // Próximo número
  const ultimoDoc = await prisma.documentoFiscal.findFirst({
    where: { empresaId, tipo: 'NFE', serie: empresa.serieNFe },
    orderBy: { numero: 'desc' },
    select: { numero: true },
  })
  dadosNFe.nNF = (ultimoDoc?.numero || 0) + 1

  // 6. Emitir
  const resultado = await nfeEmissaoService.emitir({ empresaId, dadosNFe })

  return resultado
}

export const devolucaoFiscalService = { emitirNFeDevolucao }
