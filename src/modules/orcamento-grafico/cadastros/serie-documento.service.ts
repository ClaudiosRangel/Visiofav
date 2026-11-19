import { Prisma } from '@prisma/client'

/**
 * Série de numeração do Orçamento Gráfico (cadastro `SerieDocumento`).
 *
 * Regras:
 * - O Nº do orçamento é sequencial POR SÉRIE (empresa + série).
 * - Sem série informada → usa a série padrão ATIVA da empresa; se não houver
 *   nenhuma série padrão/sem nome, cria a padrão na hora.
 * - Reserva do Nº é atômica (UPDATE ... RETURNING na mesma transação) e nunca
 *   devolve um Nº já usado na série (GREATEST com o maior Nº + 1).
 * - empresaId EXPLÍCITO em toda query (não confiar só no prismaScoped).
 */

export const ORIGEM_ORCAMENTO = 'ORCAMENTO'

export class SerieDocumentoError extends Error {
  constructor(
    public statusCode: 400 | 404,
    message: string,
  ) {
    super(message)
    this.name = 'SerieDocumentoError'
  }
}

/** Cliente mínimo (prisma global ou `tx` de transação). */
type Db = Pick<Prisma.TransactionClient, 'serieDocumento' | 'orcamentoGrafico' | '$queryRaw'>

export interface SerieResolvida {
  id: string
  nome: string
}

/**
 * Resolve a série do orçamento. `serieId` informado: precisa ser da empresa
 * (senão 404), da origem ORCAMENTO e ativa (senão 400). Ausente: série padrão
 * ativa; se não existir nenhuma padrão nem série sem nome, cria a padrão.
 */
export async function resolverSerieOrcamento(
  db: Db,
  empresaId: string,
  serieId?: string | null,
): Promise<SerieResolvida> {
  if (serieId) {
    const serie = await db.serieDocumento.findFirst({
      where: { id: serieId, empresaId, origem: ORIGEM_ORCAMENTO },
      select: { id: true, nome: true, ativo: true },
    })
    if (!serie) throw new SerieDocumentoError(404, 'serieId: série não encontrada')
    if (!serie.ativo) throw new SerieDocumentoError(400, 'serieId: série inativa')
    return { id: serie.id, nome: serie.nome }
  }

  const padrao = await db.serieDocumento.findFirst({
    where: { empresaId, origem: ORIGEM_ORCAMENTO, padrao: true, ativo: true },
    select: { id: true, nome: true },
  })
  if (padrao) return padrao

  // Sem padrão ativa: a série sem nome (ativa) serve de padrão.
  const semNome = await db.serieDocumento.findFirst({
    where: { empresaId, origem: ORIGEM_ORCAMENTO, nome: '' },
    select: { id: true, nome: true, ativo: true },
  })
  if (semNome) {
    if (!semNome.ativo) {
      throw new SerieDocumentoError(400, 'serieId: nenhuma série padrão ativa; defina uma em Cadastros → Séries')
    }
    return { id: semNome.id, nome: semNome.nome }
  }

  // Nenhuma série: cria a padrão (próximo = maior Nº da empresa + 1).
  const ultimo = await db.orcamentoGrafico.findFirst({
    where: { empresaId },
    orderBy: { numero: 'desc' },
    select: { numero: true },
  })
  try {
    return await db.serieDocumento.create({
      data: {
        empresaId,
        origem: ORIGEM_ORCAMENTO,
        nome: '',
        descricao: 'Série padrão',
        padrao: true,
        ativo: true,
        proximoNumero: (ultimo?.numero ?? 0) + 1,
      },
      select: { id: true, nome: true },
    })
  } catch (err: any) {
    // Corrida: outra requisição criou a padrão ao mesmo tempo.
    if (err?.code !== 'P2002') throw err
    const criada = await db.serieDocumento.findFirst({
      where: { empresaId, origem: ORIGEM_ORCAMENTO, nome: '' },
      select: { id: true, nome: true },
    })
    if (!criada) throw err
    return criada
  }
}

/**
 * Reserva o próximo Nº da série, atomicamente (lock de linha do UPDATE). O Nº
 * devolvido é GREATEST(proximo_numero, maior Nº já usado na série + 1); o
 * contador avança para Nº + 1. Na série padrão, orçamentos ainda sem série
 * (serie_id NULL, criados por fluxos antigos) também contam, para não repetir Nº.
 */
export async function reservarNumeroSerie(db: Db, empresaId: string, serieId: string): Promise<number> {
  const linhas = await db.$queryRaw<Array<{ numero: number }>>`
    UPDATE "serie_documento" sd
       SET "proximo_numero" = GREATEST(
             sd."proximo_numero",
             COALESCE((
               SELECT MAX(o."numero") FROM "orcamento_grafico" o
                WHERE o."empresa_id" = ${empresaId}
                  AND (o."serie_id" = sd."id" OR (sd."padrao" AND o."serie_id" IS NULL))
             ), 0) + 1
           ) + 1,
           "atualizado_em" = CURRENT_TIMESTAMP
     WHERE sd."id" = ${serieId} AND sd."empresa_id" = ${empresaId}
     RETURNING (sd."proximo_numero" - 1)::int AS numero
  `
  const numero = linhas?.[0]?.numero
  if (numero == null) throw new SerieDocumentoError(404, 'serieId: série não encontrada')
  return Number(numero)
}

/** Resolve a série e reserva o Nº numa única chamada (usar dentro da transação). */
export async function proximoNumeroOrcamento(
  db: Db,
  empresaId: string,
  serieId?: string | null,
): Promise<{ serieId: string; serie: string; numero: number }> {
  const s = await resolverSerieOrcamento(db, empresaId, serieId)
  const numero = await reservarNumeroSerie(db, empresaId, s.id)
  return { serieId: s.id, serie: s.nome, numero }
}
