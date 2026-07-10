import type { PrismaClient } from '@prisma/client'

type PrismaTransaction = Parameters<Parameters<PrismaClient['$transaction']>[0]>[0]

/** Limite máximo de código sequencial (6 dígitos numéricos). */
export const CODIGO_SEQUENCIAL_MAXIMO = 999999

/**
 * Lançado quando a faixa de códigos sequenciais de Produto de uma Empresa
 * se esgota (proximoValor > 999999). O contador NÃO é alterado quando este
 * erro é lançado — chamadas subsequentes continuarão lançando o mesmo erro
 * até que a faixa seja ampliada manualmente.
 */
export class CodigoSequencialEsgotadoError extends Error {
  public readonly empresaId: string

  constructor(empresaId: string) {
    super(
      `Faixa de códigos sequenciais de Produto esgotada para a empresa ${empresaId} (limite de ${CODIGO_SEQUENCIAL_MAXIMO} códigos atingido)`
    )
    this.name = 'CodigoSequencialEsgotadoError'
    this.empresaId = empresaId

    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, CodigoSequencialEsgotadoError)
    }
  }
}

/**
 * Gera o próximo código sequencial de Produto para uma Empresa, formatado
 * como string numérica de 6 dígitos com zeros à esquerda (ex.: "000001").
 *
 * Garante atomicidade via um único UPDATE (`SET proximo_valor = proximo_valor + 1
 * ... RETURNING proximo_valor - 1`), que é serializado pelo próprio Postgres na
 * linha afetada — sem necessidade de `SELECT ... FOR UPDATE` explícito. Chamadas
 * concorrentes para a mesma empresa nunca retornam o mesmo valor.
 *
 * O `WHERE proximo_valor <= 999999` no mesmo UPDATE garante que o contador nunca
 * é incrementado além do limite: se a condição não for satisfeita, nenhuma linha
 * é afetada, `proximoValor` permanece inalterado e `CodigoSequencialEsgotadoError`
 * é lançado.
 */
export async function gerarProximoCodigo(tx: PrismaTransaction, empresaId: string): Promise<string> {
  // Garante que existe uma linha de contador para a empresa, sem alterar o
  // valor de contadores já existentes (upsert com update vazio).
  await tx.sequenciaProduto.upsert({
    where: { empresaId },
    update: {},
    create: { empresaId, proximoValor: 1 },
  })

  const rows = await tx.$queryRaw<Array<{ valor: number }>>`
    UPDATE sequencia_produto
    SET proximo_valor = proximo_valor + 1
    WHERE empresa_id = ${empresaId} AND proximo_valor <= ${CODIGO_SEQUENCIAL_MAXIMO}
    RETURNING proximo_valor - 1 AS valor
  `

  if (rows.length === 0) {
    throw new CodigoSequencialEsgotadoError(empresaId)
  }

  return String(rows[0].valor).padStart(6, '0')
}
