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

  return _consumirProximoCodigo(tx, empresaId)
}

/**
 * Lê (sem consumir/incrementar) qual seria o próximo código sequencial LIVRE
 * da empresa — usado apenas para PRÉ-VISUALIZAÇÃO no formulário de cadastro de
 * Produto (o operador vê o código sugerido antes de salvar). O código
 * definitivo só é gravado no momento do create do Produto (a unicidade é
 * garantida lá). Retorna null se a faixa estiver esgotada.
 *
 * Pula códigos já ocupados por produtos existentes: o contador
 * (`SequenciaProduto.proximoValor`) é independente da tabela `produto`, então
 * quando há produtos criados com código manual, importados ou migrados de
 * outra origem, o valor "cru" do contador pode colidir com um código que já
 * existe. Aqui avançamos a partir do contador até o primeiro código realmente
 * livre — sem consumir o contador (continua sendo só uma prévia).
 *
 * IMPORTANTE: como não incrementa, dois formulários abertos ao mesmo tempo
 * podem ver o mesmo código de prévia — aceitável para uma sugestão; a gravação
 * real resolve conflito pela constraint de unicidade do código.
 */
export async function peekProximoCodigo(
  tx: PrismaTransaction,
  empresaId: string,
): Promise<string | null> {
  const seq = await tx.sequenciaProduto.findUnique({ where: { empresaId }, select: { proximoValor: true } })
  let valor = seq?.proximoValor ?? 1

  // Avança sobre códigos já ocupados por produtos desta empresa (defensivo:
  // limita o número de saltos para não varrer indefinidamente em bases grandes).
  const MAX_SALTOS = 10000
  for (let i = 0; i < MAX_SALTOS; i += 1) {
    if (valor > CODIGO_SEQUENCIAL_MAXIMO) return null
    const codigo = String(valor).padStart(6, '0')
    // eslint-disable-next-line no-await-in-loop
    const existe = await tx.produto.findFirst({
      where: { empresaId, codigo },
      select: { id: true },
    })
    if (!existe) return codigo
    valor += 1
  }
  // Excedeu o limite de saltos: devolve o valor atual (a gravação ainda protege
  // contra duplicidade); evita loop longo no peek.
  if (valor > CODIGO_SEQUENCIAL_MAXIMO) return null
  return String(valor).padStart(6, '0')
}

async function _consumirProximoCodigo(tx: PrismaTransaction, empresaId: string): Promise<string> {

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
