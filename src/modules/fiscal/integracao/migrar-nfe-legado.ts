/**
 * Script de Migração: Nfe (legado) → DocumentoFiscal (novo)
 *
 * Migra todos os registros existentes da tabela `nfe` para `documento_fiscal`,
 * preservando número, série, status, itens com tributos e vínculo com VendaEfetivada.
 *
 * - Idempotente: verifica chaveAcesso antes de inserir (duplicidades ignoradas)
 * - Registros inconsistentes: log warn + defaults documentados
 * - Preserva vendaEfetivadaId
 * - tipoOperacao derivado de tpNF (0=Entrada, 1=Saída)
 *
 * Requirements: 4.1, 4.2, 4.3, 4.6, 4.7
 */

import { prisma } from '../../../lib/prisma'
import type { Nfe, ItemNfe, Empresa } from '@prisma/client'

// === Tipos ===

export interface MigracaoResult {
  totalMigrados: number
  totalItens: number
  erros: Array<{ nfeId: string; motivo: string }>
  duplicados: number
}

type NfeComItens = Nfe & { itens: ItemNfe[]; empresa: Pick<Empresa, 'cnpj' | 'razaoSocial' | 'uf'> }

// === Defaults documentados para registros inconsistentes ===

const DEFAULTS = {
  /** Número padrão quando null/0 */
  numero: 0,
  /** Série padrão quando null */
  serie: 1,
  /** Natureza de operação padrão */
  naturezaOp: 'VENDA',
  /** UF padrão quando empresa não tem UF */
  uf: 'SP',
  /** CNPJ placeholder quando empresa não tem CNPJ (não deve ocorrer) */
  cnpj: '00000000000000',
  /** Razão social placeholder */
  razaoSocial: 'EMPRESA NAO IDENTIFICADA',
  /** Data de emissão padrão quando não derivável */
  dataEmissao: () => new Date(),
} as const

// === Mapeamento de Status ===

const STATUS_MAP: Record<string, string> = {
  PENDENTE: 'PENDENTE',
  AUTORIZADA: 'AUTORIZADO',
  REJEITADA: 'REJEITADO',
  CANCELADA: 'CANCELADO',
}

/**
 * Mapeia o status legado da Nfe para o status do DocumentoFiscal.
 * Statuses não reconhecidos são mapeados para PENDENTE com log warn.
 */
function mapearStatus(statusLegado: string): string {
  const mapped = STATUS_MAP[statusLegado]
  if (!mapped) {
    console.warn(
      `[migrar-nfe-legado] Status não reconhecido: "${statusLegado}" → usando PENDENTE`,
    )
    return 'PENDENTE'
  }
  return mapped
}

/**
 * Mapeia um registro Nfe legado para os dados de criação de DocumentoFiscal.
 *
 * Conforme tabela de mapeamento do design:
 * - tipo: fixo 'NFE'
 * - modelo: fixo 55
 * - tipoOperacao: derivado de tpNF (0=Entrada, 1=Saída)
 * - status: PENDENTE→PENDENTE, AUTORIZADA→AUTORIZADO, REJEITADA→REJEITADO
 * - naturezaOp: 'VENDA' (default)
 * - finalidade: direto de finNFe
 * - ambiente: direto
 *
 * Requirements: 4.2, 4.3
 */
export function mapearNfeParaDocFiscal(nfe: NfeComItens) {
  const empresa = nfe.empresa

  // Validar e aplicar defaults para campos obrigatórios inconsistentes
  const emitenteCnpj = empresa?.cnpj || DEFAULTS.cnpj
  const emitenteRazao = empresa?.razaoSocial || DEFAULTS.razaoSocial
  const emitenteUf = empresa?.uf || DEFAULTS.uf

  if (!empresa?.cnpj) {
    console.warn(
      `[migrar-nfe-legado] Nfe ${nfe.id}: empresa sem CNPJ, usando default "${DEFAULTS.cnpj}"`,
    )
  }

  // tipoOperacao derivado de tpNF (0=Entrada, 1=Saída)
  const tipoOperacao = nfe.tpNF ?? 1

  // Finalidade (finNFe: 1=Normal, 2=Complementar, 3=Ajuste, 4=Devolução)
  const finalidade = nfe.finNFe ?? 1

  // Ambiente (1=Produção, 2=Homologação)
  const ambiente = nfe.ambiente ?? 2

  // Status mapeado
  const status = mapearStatus(nfe.status)

  // Data de emissão: usar criadoEm como fallback
  const dataEmissao = nfe.criadoEm || DEFAULTS.dataEmissao()

  // Calcular totais a partir dos itens
  const valorProdutos = nfe.itens.reduce(
    (acc, item) => acc + Number(item.vProd || 0),
    0,
  )
  const valorIcms = nfe.itens.reduce(
    (acc, item) => acc + Number(item.vICMS || 0),
    0,
  )
  const valorIpi = nfe.itens.reduce(
    (acc, item) => acc + Number(item.vIPI || 0),
    0,
  )
  const valorPis = nfe.itens.reduce(
    (acc, item) => acc + Number(item.vPIS || 0),
    0,
  )
  const valorCofins = nfe.itens.reduce(
    (acc, item) => acc + Number(item.vCOFINS || 0),
    0,
  )
  const valorTotal = valorProdutos

  return {
    empresaId: nfe.empresaId,
    tipo: 'NFE' as const,
    modelo: 55,
    serie: nfe.serie ?? DEFAULTS.serie,
    numero: nfe.numero ?? DEFAULTS.numero,
    chaveAcesso: nfe.chaveAcesso || null,
    status,
    naturezaOp: DEFAULTS.naturezaOp,
    dataEmissao,
    tipoOperacao,
    finalidade,
    emitenteCnpj,
    emitenteRazao,
    emitenteUf,
    valorProdutos,
    valorTotal,
    valorIcms,
    valorIpi,
    valorPis,
    valorCofins,
    xmlEnviado: nfe.xmlEnviado || null,
    xmlRetorno: nfe.xmlRetorno || null,
    protocolo: nfe.protocolo || null,
    dataAutorizacao: status === 'AUTORIZADO' ? dataEmissao : null,
    ambiente,
    vendaEfetivadaId: nfe.vendaEfetivadaId || null,
  }
}

/**
 * Mapeia um ItemNfe legado para os dados de criação de ItemDocumentoFiscal.
 *
 * Preserva todos os campos tributários conforme tabela do design:
 * - nItem, codigoProd (cProd), descricao (xProd), ncm, cfop, unidade (uCom)
 * - quantidade (qCom), valorUnitario (vUnCom), valorTotal (vProd)
 * - valorIcms (vICMS), valorIpi (vIPI), valorPis (vPIS), valorCofins (vCOFINS)
 *
 * Requirements: 4.3
 */
function mapearItemNfeParaItemDocFiscal(item: ItemNfe) {
  return {
    nItem: item.nItem,
    produtoId: item.produtoId || null,
    codigoProd: item.cProd || 'SEM_CODIGO',
    descricao: item.xProd || 'SEM DESCRICAO',
    ncm: item.ncm || '00000000',
    cfop: item.cfop || '5102',
    unidade: item.uCom || 'UN',
    quantidade: Number(item.qCom || 0),
    valorUnitario: Number(item.vUnCom || 0),
    valorTotal: Number(item.vProd || 0),
    // Tributos preservados
    icmsValor: Number(item.vICMS || 0),
    ipiValor: Number(item.vIPI || 0),
    pisValor: Number(item.vPIS || 0),
    cofinsValor: Number(item.vCOFINS || 0),
  }
}

/**
 * Migra registros da tabela Nfe legado para DocumentoFiscal.
 *
 * Características:
 * - Idempotente: verifica duplicidade por chaveAcesso antes de inserir
 * - Para registros sem chaveAcesso: verifica por (empresaId, tipo, serie, numero)
 * - Preserva vendaEfetivadaId
 * - Log warn para registros inconsistentes + defaults documentados
 * - Opcional: filtra por empresaId se fornecido
 *
 * Requirements: 4.1, 4.2, 4.3, 4.6, 4.7
 */
export async function migrarNfeLegado(empresaId?: string): Promise<MigracaoResult> {
  const result: MigracaoResult = {
    totalMigrados: 0,
    totalItens: 0,
    erros: [],
    duplicados: 0,
  }

  // Buscar todos os registros Nfe com itens e dados da empresa
  const where = empresaId ? { empresaId } : {}
  const nfes = await prisma.nfe.findMany({
    where,
    include: {
      itens: true,
      empresa: {
        select: {
          cnpj: true,
          razaoSocial: true,
          uf: true,
        },
      },
    },
    orderBy: { criadoEm: 'asc' },
  })

  console.log(
    `[migrar-nfe-legado] Encontrados ${nfes.length} registros Nfe para migrar${empresaId ? ` (empresa: ${empresaId})` : ''}`,
  )

  for (const nfe of nfes) {
    try {
      // Verificar duplicidade por chaveAcesso (idempotência)
      if (nfe.chaveAcesso) {
        const existente = await prisma.documentoFiscal.findFirst({
          where: { chaveAcesso: nfe.chaveAcesso },
          select: { id: true },
        })
        if (existente) {
          result.duplicados++
          continue
        }
      } else {
        // Sem chaveAcesso: verificar por (empresaId, tipo, serie, numero)
        const existente = await prisma.documentoFiscal.findFirst({
          where: {
            empresaId: nfe.empresaId,
            tipo: 'NFE',
            serie: nfe.serie ?? DEFAULTS.serie,
            numero: nfe.numero ?? DEFAULTS.numero,
          },
          select: { id: true },
        })
        if (existente) {
          result.duplicados++
          continue
        }
      }

      // Mapear dados
      const docData = mapearNfeParaDocFiscal(nfe as NfeComItens)
      const itensData = nfe.itens.map(mapearItemNfeParaItemDocFiscal)

      // Criar DocumentoFiscal + ItemDocumentoFiscal em transação
      await prisma.$transaction(async (tx) => {
        await tx.documentoFiscal.create({
          data: {
            ...docData,
            itens: {
              create: itensData,
            },
          },
        })
      })

      result.totalMigrados++
      result.totalItens += nfe.itens.length
    } catch (error) {
      const motivo = error instanceof Error ? error.message : 'Erro desconhecido'
      console.warn(
        `[migrar-nfe-legado] Erro ao migrar Nfe ${nfe.id}: ${motivo}`,
      )
      result.erros.push({ nfeId: nfe.id, motivo })
    }
  }

  console.log(
    `[migrar-nfe-legado] Migração concluída: ${result.totalMigrados} documentos migrados, ${result.totalItens} itens, ${result.duplicados} duplicados ignorados, ${result.erros.length} erros`,
  )

  return result
}
