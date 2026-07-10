/**
 * Kardex de estoque — funções puras de validação e cálculo de saldo.
 *
 * Estas funções não realizam I/O (sem chamadas a Prisma/rede); são usadas
 * pela camada transacional (`registrarMovimentacao`, implementada em tarefa
 * separada) para decidir se um lançamento é válido e qual o saldo resultante.
 */

/** Tipos fechados de movimentação de estoque (Requirement 4.1). */
export type TipoMovimentacaoEstoque =
  | 'ENTRADA_COMPRA'
  | 'SAIDA_VENDA'
  | 'AJUSTE_MANUAL'
  | 'ENTRADA_ESTORNO_VENDA'
  | 'SAIDA_ESTORNO_COMPRA'

/** Tipos cujo sentido é de entrada (incrementam o saldo). Os demais são saída. */
const TIPOS_ENTRADA: TipoMovimentacaoEstoque[] = ['ENTRADA_COMPRA', 'ENTRADA_ESTORNO_VENDA']

/**
 * Tipos que exigem `origemId` preenchido (Requirement 4.2). O único tipo que
 * permite `origemId` nulo é AJUSTE_MANUAL.
 */
const TIPOS_QUE_EXIGEM_ORIGEM: TipoMovimentacaoEstoque[] = [
  'ENTRADA_COMPRA',
  'SAIDA_VENDA',
  'SAIDA_ESTORNO_COMPRA',
  'ENTRADA_ESTORNO_VENDA',
]

export interface RegistrarMovimentacaoInput {
  empresaId: string
  produtoId: string
  tipo: TipoMovimentacaoEstoque
  quantidade: number
  origemId?: string | null
}

/**
 * Valida um input de Movimentação_Estoque sem tocar no banco.
 *
 * Regras (Requirements 4.2, 4.3):
 * - `quantidade` deve ser maior que zero.
 * - `origemId` é obrigatório para todos os tipos, exceto `AJUSTE_MANUAL`.
 *
 * @returns mensagem de erro descrevendo a violação, ou `null` quando o input é válido.
 */
export function validarMovimentacao(input: RegistrarMovimentacaoInput): string | null {
  if (input.quantidade <= 0) {
    return 'Quantidade deve ser maior que zero'
  }

  if (TIPOS_QUE_EXIGEM_ORIGEM.includes(input.tipo) && !input.origemId) {
    return `Campo origemId é obrigatório para o tipo ${input.tipo}`
  }

  return null
}

/**
 * Calcula o saldo posterior de uma Movimentação_Estoque a partir do saldo
 * anterior, da quantidade lançada (sempre positiva) e do sentido determinado
 * pelo tipo de movimentação (Requirement 4.11).
 *
 * Tipos de entrada somam a quantidade ao saldo anterior; os demais tipos
 * (saída) subtraem. O saldo posterior pode ser negativo (ex.: SAIDA_VENDA
 * com estoque insuficiente — Requirement 4.7), sem que esta função bloqueie
 * o cálculo.
 */
export function calcularSaldoPosterior(
  saldoAnterior: number,
  quantidade: number,
  tipo: TipoMovimentacaoEstoque,
): number {
  const sentido = TIPOS_ENTRADA.includes(tipo) ? 1 : -1
  return saldoAnterior + sentido * quantidade
}

// ─── Registro transacional (I/O) ────────────────────────────────────────────

import type { MovimentacaoEstoque, PrismaClient } from '@prisma/client'

type PrismaTransaction = Parameters<Parameters<PrismaClient['$transaction']>[0]>[0]

export interface RegistrarMovimentacaoResult {
  movimentacao: MovimentacaoEstoque
  saldoNegativo: boolean
}

/**
 * Registra uma Movimentação_Estoque de ponta a ponta, dentro da transação `tx`
 * recebida (Requirement 4.10 — todas as operações usam `tx`, nunca `prisma`
 * global, para que a falha de qualquer etapa reverta junto com a transação
 * maior da operação de negócio que chama esta função).
 *
 * Fluxo:
 * 1. Valida o input via `validarMovimentacao`; se inválido, lança exceção
 *    sem tocar em `Estoque` nem `MovimentacaoEstoque` (Requirement 4.3).
 * 2. Busca o saldo atual em `Estoque` (0 se não existir registro ainda).
 * 3. Calcula o saldo posterior via `calcularSaldoPosterior`.
 * 4. Faz upsert de `Estoque` com o novo saldo — permite saldo negativo sem
 *    bloquear (Requirement 4.7).
 * 5. Cria o registro `MovimentacaoEstoque` na mesma transação.
 *
 * Requirements: 4.1, 4.4, 4.5, 4.7, 4.8, 4.9, 4.10
 */
export async function registrarMovimentacao(
  tx: PrismaTransaction,
  input: RegistrarMovimentacaoInput,
): Promise<RegistrarMovimentacaoResult> {
  const erro = validarMovimentacao(input)
  if (erro) {
    throw new Error(erro)
  }

  const estoqueAtual = await tx.estoque.findUnique({
    where: { empresaId_produtoId: { empresaId: input.empresaId, produtoId: input.produtoId } },
  })

  const saldoAnterior = estoqueAtual ? Number(estoqueAtual.quantidade) : 0
  const saldoPosterior = calcularSaldoPosterior(saldoAnterior, input.quantidade, input.tipo)

  await tx.estoque.upsert({
    where: { empresaId_produtoId: { empresaId: input.empresaId, produtoId: input.produtoId } },
    create: {
      empresaId: input.empresaId,
      produtoId: input.produtoId,
      quantidade: saldoPosterior,
    },
    update: {
      quantidade: saldoPosterior,
    },
  })

  const movimentacao = await tx.movimentacaoEstoque.create({
    data: {
      empresaId: input.empresaId,
      produtoId: input.produtoId,
      tipo: input.tipo,
      quantidade: input.quantidade,
      saldoAnterior,
      saldoPosterior,
      origemId: input.origemId ?? null,
    },
  })

  return { movimentacao, saldoNegativo: saldoPosterior < 0 }
}
