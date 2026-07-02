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
 * NOTA: Este script usa $queryRaw para ler da tabela `nfe` porque o modelo Prisma
 * foi removido do schema. É um script one-time de migração histórica.
 *
 * Requirements: 4.1, 4.2, 4.3, 4.6, 4.7
 */

import { prisma } from '../../../lib/prisma'
import { Decimal } from '@prisma/client/runtime/library'

// === Tipos (raw SQL - modelos removidos do schema Prisma) ===

export interface MigracaoResult {
  totalMigrados: number
  totalItens: number
  erros: Array<{ nfeId: string; motivo: string }>
  duplicados: number
}

interface NfeRaw {
  id: string
  empresa_id: string
  venda_efetivada_id: string | null
  numero: number
  serie: number
  chave_acesso: string | null
  xml_enviado: string | null
  xml_retorno: string | null
  protocolo: string | null
  status: string
  tipo_nfe: string
  tp_nf: number
  fin_nfe: number
  ambiente: number
  criado_em: Date
  mapa_ok: boolean
}

interface ItemNfeRaw {
  id: string
  nfe_id: string
  n_item: number
  produto_id: string | null
  c_prod: string
  x_prod: string
  ncm: string
  cfop: string
  u_com: string
  q_com: Decimal
  v_un_com: Decimal
  v_prod: Decimal
  v_icms: Decimal
  v_ipi: Decimal
  v_pis: Decimal
  v_cofins: Decimal
}

interface EmpresaRaw {
  cnpj: string | null
  razao_social: string | null
  uf: string | null
}

interface NfeComItens {
  nfe: NfeRaw
  empresa: EmpresaRaw
  itens: ItemNfeRaw[]
}

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
export function mapearNfeParaDocFiscal(data: NfeComItens) {
  const { nfe, empresa, itens } = data

  // Validar e aplicar defaults para campos obrigatórios inconsistentes
  const emitenteCnpj = empresa?.cnpj || DEFAULTS.cnpj
  const emitenteRazao = empresa?.razao_social || DEFAULTS.razaoSocial
  const emitenteUf = empresa?.uf || DEFAULTS.uf

  if (!empresa?.cnpj) {
    console.warn(
      `[migrar-nfe-legado] Nfe ${nfe.id}: empresa sem CNPJ, usando default "${DEFAULTS.cnpj}"`,
    )
  }

  // tipoOperacao derivado de tpNF (0=Entrada, 1=Saída)
  const tipoOperacao = nfe.tp_nf ?? 1

  // Finalidade (finNFe: 1=Normal, 2=Complementar, 3=Ajuste, 4=Devolução)
  const finalidade = nfe.fin_nfe ?? 1

  // Ambiente (1=Produção, 2=Homologação)
  const ambiente = nfe.ambiente ?? 2

  // Status mapeado
  const status = mapearStatus(nfe.status)

  // Data de emissão: usar criadoEm como fallback
  const dataEmissao = nfe.criado_em || DEFAULTS.dataEmissao()

  // Calcular totais a partir dos itens
  const valorProdutos = itens.reduce(
    (acc, item) => acc + Number(item.v_prod || 0),
    0,
  )
  const valorIcms = itens.reduce(
    (acc, item) => acc + Number(item.v_icms || 0),
    0,
  )
  const valorIpi = itens.reduce(
    (acc, item) => acc + Number(item.v_ipi || 0),
    0,
  )
  const valorPis = itens.reduce(
    (acc, item) => acc + Number(item.v_pis || 0),
    0,
  )
  const valorCofins = itens.reduce(
    (acc, item) => acc + Number(item.v_cofins || 0),
    0,
  )
  const valorTotal = valorProdutos

  return {
    empresaId: nfe.empresa_id,
    tipo: 'NFE' as const,
    modelo: 55,
    serie: nfe.serie ?? DEFAULTS.serie,
    numero: nfe.numero ?? DEFAULTS.numero,
    chaveAcesso: nfe.chave_acesso || null,
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
    xmlEnviado: nfe.xml_enviado || null,
    xmlRetorno: nfe.xml_retorno || null,
    protocolo: nfe.protocolo || null,
    dataAutorizacao: status === 'AUTORIZADO' ? dataEmissao : null,
    ambiente,
    vendaEfetivadaId: nfe.venda_efetivada_id || null,
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
function mapearItemNfeParaItemDocFiscal(item: ItemNfeRaw) {
  return {
    nItem: item.n_item,
    produtoId: item.produto_id || null,
    codigoProd: item.c_prod || 'SEM_CODIGO',
    descricao: item.x_prod || 'SEM DESCRICAO',
    ncm: item.ncm || '00000000',
    cfop: item.cfop || '5102',
    unidade: item.u_com || 'UN',
    quantidade: Number(item.q_com || 0),
    valorUnitario: Number(item.v_un_com || 0),
    valorTotal: Number(item.v_prod || 0),
    // Tributos preservados
    icmsValor: Number(item.v_icms || 0),
    ipiValor: Number(item.v_ipi || 0),
    pisValor: Number(item.v_pis || 0),
    cofinsValor: Number(item.v_cofins || 0),
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
 * - Usa $queryRaw porque o modelo Nfe foi removido do schema Prisma
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

  // Buscar todos os registros Nfe via raw SQL (modelo removido do schema)
  const nfes: NfeRaw[] = empresaId
    ? await prisma.$queryRaw`SELECT * FROM nfe WHERE empresa_id = ${empresaId} ORDER BY criado_em ASC`
    : await prisma.$queryRaw`SELECT * FROM nfe ORDER BY criado_em ASC`

  console.log(
    `[migrar-nfe-legado] Encontrados ${nfes.length} registros Nfe para migrar${empresaId ? ` (empresa: ${empresaId})` : ''}`,
  )

  for (const nfe of nfes) {
    try {
      // Buscar empresa dados via raw SQL
      const empresas: EmpresaRaw[] = await prisma.$queryRaw`
        SELECT cnpj, razao_social, uf FROM empresa WHERE id = ${nfe.empresa_id} LIMIT 1
      `
      const empresa = empresas[0] || { cnpj: null, razao_social: null, uf: null }

      // Buscar itens da Nfe via raw SQL
      const itens: ItemNfeRaw[] = await prisma.$queryRaw`
        SELECT * FROM item_nfe WHERE nfe_id = ${nfe.id}
      `

      // Verificar duplicidade por chaveAcesso (idempotência)
      if (nfe.chave_acesso) {
        const existente = await prisma.documentoFiscal.findFirst({
          where: { chaveAcesso: nfe.chave_acesso },
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
            empresaId: nfe.empresa_id,
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
      const docData = mapearNfeParaDocFiscal({ nfe, empresa, itens })
      const itensData = itens.map(mapearItemNfeParaItemDocFiscal)

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
      result.totalItens += itens.length
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
