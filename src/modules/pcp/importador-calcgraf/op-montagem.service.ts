/**
 * MOTOR UNIFICADO de montagem de OP (spec `importador-calcgraf-paridade-pdf`).
 *
 * Fonte ÚNICA das regras de negócio compartilhadas entre:
 *  - a confirmação da importação de PDF (`importacao-op.routes.ts`), e
 *  - a ingestão do agente Calcgraf (`ingestao-op-calcgraf.service.ts`).
 *
 * OBJETIVO: eliminar a divergência entre os dois fluxos (o agente criava
 * centros irreais, não vinculava cliente, perdia data de entrega, etc.) ao
 * fazer AMBOS usarem exatamente a mesma lógica.
 *
 * Esta primeira extração (Tarefa 1) traz a **resolução/criação de Centro de
 * Produção** — o ponto mais crítico (de-para → reuso → criar), hoje o que mais
 * causa "máquina errada" quando o agente ignora o de-para. A lógica é copiada
 * FIELMENTE de `importacao-op.routes.ts` (comportamento neutro): o importador de
 * PDF passa a chamar esta função, produzindo o MESMO resultado de antes.
 *
 * Todas as funções recebem o `tx` (Prisma client ou transação) para funcionar
 * dentro das transações de cada chamador. Isolamento multi-tenant SEMPRE por
 * `empresaId` explícito.
 */

import { Prisma } from '@prisma/client'

type PrismaLike = Prisma.TransactionClient | {
  centroProducao: any
  tipoProcesso: any
  deParaImportacao: any
}

/**
 * Mapa tipo da etapa → código de `TipoProcesso`. Aceita AMBOS os vocabulários:
 *  - PDF (parser GPrint): `IMPRESSAO`/`CORTADEIRA`/`COLAGEM`/`VERNIZ`/`ACABAMENTO`.
 *  - Calcgraf (CalculoAtividades.tipo): `I` (impressão) | `A` (acabamento).
 * Qualquer outro valor cai em ACABAMENTO (base padrão).
 */
const CODIGO_PROCESSO_POR_TIPO: Record<string, string> = {
  // Vocabulário do PDF
  CORTADEIRA: 'CORTADEIRA',
  IMPRESSAO: 'IMPRESSAO',
  COLAGEM: 'COLAGEM',
  VERNIZ: 'VERNIZ',
  ACABAMENTO: 'ACABAMENTO',
  // Vocabulário do Calcgraf (letra única)
  I: 'IMPRESSAO',
  A: 'ACABAMENTO',
}

/** Resultado da resolução de centro, com rastro do que aconteceu (auditoria). */
export interface ResultadoCentro {
  /** Id do centro resolvido/criado (sempre preenchido quando há nome). */
  centroId: string | null
  /** Como foi resolvido: de-para, reuso por nome, ou criado novo. */
  origem: 'DE_PARA' | 'REUSO_NOME' | 'CRIADO' | 'SEM_NOME'
  /** `true` quando um centro NOVO foi criado (sinaliza possível máquina irreal). */
  criouNovo: boolean
}

/**
 * Infere o `tipoProcessoId` de um centro novo a partir do tipo da etapa.
 * Ordem: (1) código mapeado do tipo; (2) ACABAMENTO; (3) primeiro Tipo de
 * Processo ATIVO da empresa. Lança erro claro se a empresa não tiver nenhum
 * (mesmo comportamento do importador de PDF).
 */
export async function inferirTipoProcessoId(
  tx: PrismaLike,
  empresaId: string,
  tipoEtapa?: string | null,
): Promise<string> {
  const codigo = CODIGO_PROCESSO_POR_TIPO[(tipoEtapa ?? '').toUpperCase()] ?? 'ACABAMENTO'

  const porCodigo = await tx.tipoProcesso.findFirst({
    where: { empresaId, codigo },
    select: { id: true },
  })
  if (porCodigo) return porCodigo.id

  if (codigo !== 'ACABAMENTO') {
    const acab = await tx.tipoProcesso.findFirst({
      where: { empresaId, codigo: 'ACABAMENTO' },
      select: { id: true },
    })
    if (acab) return acab.id
  }

  const qualquer = await tx.tipoProcesso.findFirst({
    where: { empresaId, status: true },
    orderBy: { posicao: 'asc' },
    select: { id: true },
  })
  if (qualquer) return qualquer.id

  throw new Error(
    'Nenhum Tipo de Processo cadastrado para esta empresa. Cadastre em PCP → Cadastros → Tipo de Processo antes de importar OPs.',
  )
}

/**
 * Resolve o Centro de Produção de uma etapa, na ORDEM do importador de PDF —
 * priorizando o CADASTRO REAL para NÃO criar máquina inexistente:
 *
 *   1) DE-PARA (`DeParaImportacao`, tipoEntidade CENTRO_PRODUCAO,
 *      codigoExterno = `centroCodigo`): vínculo persistido código→centro. É o
 *      que o agente IGNORAVA e por isso criava "Heidelberg" em vez de reusar o
 *      centro cadastrado. Validamos que o centro vinculado ainda existe.
 *   2) REUSO POR NOME (`descricao` case-insensitive; menor `codigo` =
 *      determinístico): reaproveita um centro já cadastrado com o mesmo nome.
 *   3) CRIAR (último recurso): código sanitizado único + `tipoProcessoId`
 *      inferido. Marca `criouNovo = true` para o chamador poder auditar.
 *
 * Toda etapa com nome fica com um centro (nunca invisível no painel — regra à
 * prova de falhas da OS 3133). Isolamento por `empresaId`.
 */
export async function resolverOuCriarCentro(
  tx: PrismaLike,
  empresaId: string,
  params: { centroCodigo?: string | null; nomeCentro?: string | null; tipoEtapa?: string | null },
): Promise<ResultadoCentro> {
  const nomeCentro = (params.nomeCentro ?? '').trim()
  const centroCodigo = (params.centroCodigo ?? '').trim()

  // 1) DE-PARA por código externo (quando o chamador fornece o código).
  if (centroCodigo) {
    const dePara = await tx.deParaImportacao.findFirst({
      where: {
        empresaId,
        sistemaOrigem: 'GPRINT',
        tipoEntidade: 'CENTRO_PRODUCAO',
        codigoExterno: centroCodigo,
      },
      select: { entidadeInternaId: true },
    })
    if (dePara?.entidadeInternaId) {
      const centro = await tx.centroProducao.findFirst({
        where: { id: dePara.entidadeInternaId, empresaId },
        select: { id: true },
      })
      if (centro) return { centroId: centro.id, origem: 'DE_PARA', criouNovo: false }
      // de-para órfão (centro apagado) → cai para reuso/criação pelo nome.
    }
  }

  if (!nomeCentro) {
    return { centroId: null, origem: 'SEM_NOME', criouNovo: false }
  }

  // 2) REUSO por descrição (nome), case-insensitive, determinístico.
  const existentePorNome = await tx.centroProducao.findFirst({
    where: { empresaId, descricao: { equals: nomeCentro, mode: 'insensitive' } },
    select: { id: true },
    orderBy: { codigo: 'asc' },
  })
  if (existentePorNome) {
    return { centroId: existentePorNome.id, origem: 'REUSO_NOME', criouNovo: false }
  }

  // 3) CRIAR (último recurso) — código sanitizado único.
  let codigoBase = nomeCentro
    .substring(0, 20)
    .toUpperCase()
    .replace(/\s+/g, '_')
    .replace(/[^A-Z0-9_]/g, '')
  if (!codigoBase) codigoBase = `CENTRO_${Date.now() % 100000}`

  let codigoFinal = codigoBase
  let tentativa = 0
  while (tentativa < 10) {
    const jaExiste = await tx.centroProducao.findFirst({
      where: { empresaId, codigo: codigoFinal },
      select: { id: true },
    })
    if (!jaExiste) break
    tentativa++
    codigoFinal = `${codigoBase.substring(0, 17)}_${tentativa}`
  }

  const tipoProcessoId = await inferirTipoProcessoId(tx, empresaId, params.tipoEtapa)
  const novo = await tx.centroProducao.create({
    data: {
      empresaId,
      codigo: codigoFinal,
      descricao: nomeCentro.substring(0, 100),
      tipo: 'MAQUINA',
      tipoProcessoId,
    },
    select: { id: true },
  })
  return { centroId: novo.id, origem: 'CRIADO', criouNovo: true }
}
