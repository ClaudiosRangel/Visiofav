// Serviço de status/ciclo do Cálculo Padrão (Menu Cálculo Padrão).
//
// Spec: orcamento-grafico-paridade-fluxo-legado (tarefa 8.1; reqs 10.4–10.12, 11.1–11.6, 17.2).
//
// Ações: incluir (em branco), copiar (modo PADRAO), editar (cópia só quando migrado/ancorado),
// cancelar e reativar. Toda query filtra `empresaId` de forma EXPLÍCITA (SUPER_ADMIN não isola).
// Cálculo inexistente e de outra empresa produzem o MESMO 404, sem eco de campos.
// Falha em qualquer etapa reverte (transação) e não consome número (número = max+1, não sequence).
//
// NÃO altera `calcularOrcamentoGrafico`, `ancorarCustoCalcgraf` nem a lógica de `calculo-copia.service`.

import { Prisma } from '@prisma/client'
import { prisma } from '../../../lib/prisma'
import { copiarCalculo, CopiaCalculoError } from './calculo-copia.service'

export type AcaoCalculoPadrao = 'INCLUIR' | 'EDITAR' | 'COPIAR' | 'CANCELAR' | 'REATIVAR'

export interface CalculoParaDecisao {
  origem?: string | null
  cancelado?: boolean | null
  custoProducao?: unknown
  valorTotal?: unknown
  resultadoCalculo?: unknown
  custosCalcgraf?: unknown
}

const MSG_NAO_ENCONTRADO = 'Cálculo não encontrado'

// ─────────────────────────────────────────────────────────────────────────────
// Funções puras de decisão
// ─────────────────────────────────────────────────────────────────────────────

/** Há custo ancorado do sistema anterior: custo/valor gravados com decomposição STC ou Foto rica. */
export function temCustoAncorado(calc: CalculoParaDecisao): boolean {
  if (calc.custoProducao == null || calc.valorTotal == null) return false
  if (calc.custosCalcgraf != null) return true
  const foto = calc.resultadoCalculo as { versaoFoto?: unknown } | null | undefined
  return foto != null && typeof foto === 'object' && foto.versaoFoto != null
}

/** "Editar" cria cópia quando o cálculo é migrado ou tem custo ancorado; senão edita o próprio. */
export function deveCopiarAoEditar(calc: CalculoParaDecisao): boolean {
  return calc.origem === 'MIGRADO_CALCGRAF' || temCustoAncorado(calc)
}

/** Ações do Menu: não cancelado → Incluir/Editar/Copiar/Cancelar; cancelado → Reativar/Copiar. */
export function acoesPermitidas(calc: { cancelado?: boolean | null }): AcaoCalculoPadrao[] {
  return calc.cancelado ? ['REATIVAR', 'COPIAR'] : ['INCLUIR', 'EDITAR', 'COPIAR', 'CANCELAR']
}

// ─────────────────────────────────────────────────────────────────────────────
// Infra
// ─────────────────────────────────────────────────────────────────────────────

const selecaoDecisao = {
  id: true,
  numero: true,
  origem: true,
  status: true,
  cancelado: true,
  statusAnterior: true,
  tipoEmbalagemId: true,
  linhaProduto: true,
  produto: true,
  custoProducao: true,
  valorTotal: true,
  resultadoCalculo: true,
  custosCalcgraf: true,
} satisfies Prisma.CalculoGraficoSelect

/** 404 idêntico para inexistente e outra empresa (empresaId explícito). */
async function carregar(empresaId: string, id: string) {
  const calc = await prisma.calculoGrafico.findFirst({ where: { id, empresaId }, select: selecaoDecisao })
  if (!calc) throw new CopiaCalculoError(MSG_NAO_ENCONTRADO, 404)
  return calc
}

function exigirAcao(calc: { cancelado: boolean }, acao: AcaoCalculoPadrao) {
  if (acoesPermitidas(calc).includes(acao)) return
  const msg = calc.cancelado
    ? 'Cálculo cancelado: reative-o antes de continuar'
    : 'Cálculo não está cancelado'
  throw new CopiaCalculoError(msg, 409)
}

function ehColisaoNumero(err: unknown): boolean {
  const e = err as { code?: string; meta?: { target?: unknown } } | null
  if (e?.code !== 'P2002') return false
  const alvo = e.meta?.target
  if (alvo == null) return true
  const texto = Array.isArray(alvo) ? alvo.join(',') : String(alvo)
  return texto.includes('numero') && texto.includes('empresa')
}

// ─────────────────────────────────────────────────────────────────────────────
// Ações
// ─────────────────────────────────────────────────────────────────────────────

export interface IncluirCalculoParams {
  empresaId: string
  usuarioId: string
  /** Cálculo de referência (opcional): fornece só tipo de embalagem, linha e produto; nada de engenharia é copiado. */
  referenciaId?: string
  /** Obrigatório quando não há referência. */
  tipoEmbalagemId?: string
  quantidade?: number
}

/** Cria um Calculo_Padrao novo em branco (origem VIZOR, RASCUNHO, número = max+1 sob advisory lock). */
export async function incluirCalculoPadrao(
  p: IncluirCalculoParams,
): Promise<{ calculoId: string; numeroCalculo: number }> {
  let tipoEmbalagemId = p.tipoEmbalagemId ?? null
  let linhaProduto: string | null = null
  let produto: string | null = null

  if (p.referenciaId) {
    const ref = await carregar(p.empresaId, p.referenciaId)
    exigirAcao(ref, 'INCLUIR')
    tipoEmbalagemId = tipoEmbalagemId ?? ref.tipoEmbalagemId
    linhaProduto = ref.linhaProduto
    produto = ref.produto
  }
  if (!tipoEmbalagemId) throw new CopiaCalculoError('tipoEmbalagemId: obrigatório para incluir cálculo', 400)

  // Tipo de embalagem precisa ser da empresa (empresaId explícito).
  const tipo = await prisma.tipoEmbalagem.findFirst({
    where: { id: tipoEmbalagemId, empresaId: p.empresaId },
    select: { id: true },
  })
  if (!tipo) throw new CopiaCalculoError('tipoEmbalagemId: tipo de embalagem não encontrado', 404)

  const executar = () =>
    prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${p.empresaId}))`
        const maior = await tx.calculoGrafico.findFirst({
          where: { empresaId: p.empresaId },
          orderBy: { numero: 'desc' },
          select: { numero: true },
        })
        return tx.calculoGrafico.create({
          data: {
            empresaId: p.empresaId,
            numero: (maior?.numero ?? 0) + 1,
            origem: 'VIZOR',
            status: 'RASCUNHO',
            cancelado: false,
            tipoEmbalagemId: tipo.id,
            linhaProduto,
            produto,
            medidas: {},
            numCores: 0,
            quantidade: p.quantidade ?? 1,
            criadoPorId: p.usuarioId,
          },
          select: { id: true, numero: true },
        })
      },
      { timeout: 30000, maxWait: 10000 },
    )

  try {
    const novo = await executar().catch(async (err) => {
      if (!ehColisaoNumero(err)) throw err
      return executar()
    })
    return { calculoId: novo.id, numeroCalculo: novo.numero }
  } catch (err) {
    if (ehColisaoNumero(err)) throw new CopiaCalculoError('Número de cálculo já existe para esta empresa', 409)
    throw err
  }
}

/** "Copiar" no Menu: novo Calculo_Padrao (modo PADRAO). Permitido para cancelados e não cancelados. */
export async function copiarCalculoPadrao(p: { empresaId: string; usuarioId: string; id: string }) {
  const calc = await carregar(p.empresaId, p.id)
  exigirAcao(calc, 'COPIAR')
  const r = await copiarCalculo({
    empresaId: p.empresaId,
    usuarioId: p.usuarioId,
    origemId: calc.id,
    modo: 'PADRAO',
  })
  return { calculoId: r.calculoId, numeroCalculo: r.numeroCalculo, avisos: r.avisos }
}

/** "Editar": copia (modo EDICAO) se migrado/ancorado; senão devolve o próprio id sem consumir número. */
export async function editarCalculoPadrao(p: { empresaId: string; usuarioId: string; id: string }) {
  const calc = await carregar(p.empresaId, p.id)
  exigirAcao(calc, 'EDITAR')

  if (!deveCopiarAoEditar(calc)) {
    return { calculoId: calc.id, numeroCalculo: calc.numero, copiado: false }
  }
  const r = await copiarCalculo({
    empresaId: p.empresaId,
    usuarioId: p.usuarioId,
    origemId: calc.id,
    modo: 'EDICAO',
  })
  return { calculoId: r.calculoId, numeroCalculo: r.numeroCalculo, copiado: true }
}

/** Cancela: grava `statusAnterior`, `cancelado = true`; mantém o registro. Já cancelado → 409. */
export async function cancelarCalculoPadrao(p: { empresaId: string; id: string }) {
  const calc = await carregar(p.empresaId, p.id)
  if (calc.cancelado) throw new CopiaCalculoError('Cálculo já está cancelado', 409)

  // Condição `cancelado: false` no where protege contra corrida entre dois cancelamentos.
  const r = await prisma.calculoGrafico.updateMany({
    where: { id: p.id, empresaId: p.empresaId, cancelado: false },
    data: { statusAnterior: calc.status, cancelado: true },
  })
  if (r.count === 0) throw new CopiaCalculoError('Cálculo já está cancelado', 409)
  return { calculoId: calc.id, numeroCalculo: calc.numero, status: calc.status, cancelado: true }
}

/** Reativa: restaura o status de `statusAnterior` e limpa a marcação. Não cancelado → 409. */
export async function reativarCalculoPadrao(p: { empresaId: string; id: string }) {
  const calc = await carregar(p.empresaId, p.id)
  if (!calc.cancelado) throw new CopiaCalculoError('Cálculo não está cancelado', 409)

  const statusRestaurado = calc.statusAnterior ?? calc.status
  const r = await prisma.calculoGrafico.updateMany({
    where: { id: p.id, empresaId: p.empresaId, cancelado: true },
    data: { status: statusRestaurado, cancelado: false, statusAnterior: null },
  })
  if (r.count === 0) throw new CopiaCalculoError('Cálculo não está cancelado', 409)
  return { calculoId: calc.id, numeroCalculo: calc.numero, status: statusRestaurado, cancelado: false }
}
