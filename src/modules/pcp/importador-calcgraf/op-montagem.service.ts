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

// ===========================================================================
// Resolução de CLIENTE (determinística — nunca cria, nunca usa "ACTUAL")
// ===========================================================================

type PrismaClienteLike = Prisma.TransactionClient | {
  cliente: any
  deParaImportacao: any
}

/** Só dígitos de um CNPJ/CPF (chave de match com o cadastro). */
export function soDigitos(doc: string | null | undefined): string {
  return (doc ?? '').replace(/\D/g, '')
}

export interface ResultadoCliente {
  /** Id do cliente do cadastro, ou null (sem match confiável). */
  clienteId: string | null
  /** Nome a gravar na tag `[Cliente]` das observações (sempre o nome de origem). */
  tagCliente: string | null
  /** Como foi resolvido (auditoria). */
  origem: 'CNPJ' | 'DE_PARA' | 'SEM_MATCH'
}

/**
 * Resolve o cliente de uma OP de forma DETERMINÍSTICA, priorizando o cadastro
 * real e NUNCA adivinhando:
 *
 *   1) por CNPJ (só dígitos) no cadastro `Cliente` — chave mais confiável;
 *      múltiplas filiais com CNPJs distintos ⇒ o CNPJ exato já desempata.
 *   2) por `DeParaImportacao` (CLIENTE, codigoExterno = `clienteCodigo`).
 *   3) SEM MATCH → `clienteId = null` + tag `[Cliente] <nome>` (texto confiável).
 *
 * NUNCA cria cliente. NUNCA vincula a placeholder "ACTUAL". A tag preserva o
 * nome de origem para exibição mesmo quando não há vínculo formal.
 *
 * Isolamento por `empresaId`.
 */
export async function resolverCliente(
  tx: PrismaClienteLike,
  empresaId: string,
  params: { clienteDoc?: string | null; clienteCodigo?: string | null; clienteNome?: string | null },
): Promise<ResultadoCliente> {
  const nome = (params.clienteNome ?? '').trim() || null
  const docDigitos = soDigitos(params.clienteDoc)
  const codigo = (params.clienteCodigo ?? '').trim()

  // 1) Por CNPJ (dígitos). CNPJ de placeholder (ex.: "00000000000") é ignorado.
  if (docDigitos && !/^0+$/.test(docDigitos)) {
    const clientes = await tx.cliente.findMany({
      where: { empresaId, cpfCnpj: { not: null } },
      select: { id: true, cpfCnpj: true },
    })
    const alvo = (clientes as Array<{ id: string; cpfCnpj: string | null }>)
      .find((c) => soDigitos(c.cpfCnpj) === docDigitos)
    if (alvo) return { clienteId: alvo.id, tagCliente: nome, origem: 'CNPJ' }
  }

  // 2) Por de-para de código do Calcgraf → cliente.
  if (codigo) {
    const dePara = await tx.deParaImportacao.findFirst({
      where: {
        empresaId,
        sistemaOrigem: 'GPRINT',
        tipoEntidade: 'CLIENTE',
        codigoExterno: codigo,
      },
      select: { entidadeInternaId: true },
    })
    if (dePara?.entidadeInternaId) {
      const cliente = await tx.cliente.findFirst({
        where: { id: dePara.entidadeInternaId, empresaId },
        select: { id: true },
      })
      if (cliente) return { clienteId: cliente.id, tagCliente: nome, origem: 'DE_PARA' }
    }
  }

  // 3) Sem match: só a tag com o nome de origem (nunca cria, nunca ACTUAL).
  return { clienteId: null, tagCliente: nome, origem: 'SEM_MATCH' }
}

// ===========================================================================
// Programação de entrega (todas as datas) — resolve o "entrega em branco"
// ===========================================================================

/** Uma entrega parcial de origem (data ISO + quantidade). */
export interface EntradaEntrega {
  data?: string | null
  quantidade?: number | null
}

/** Entrega normalizada para gravar em `ProgramacaoEntrega`. */
export interface EntregaMontada {
  dataEntrega: Date
  quantidade: number
}

export interface ResultadoEntregas {
  /** Entregas válidas (data parseável), ordenadas por data crescente. */
  entregas: EntregaMontada[]
  /** 1ª data (menor) para `dataEntregaPrevista`; null se nenhuma válida. */
  dataPrevista: Date | null
}

/** Converte uma data ISO/`YYYY-MM-DD` para Date, ou null se inválida. */
function parseDataIso(valor?: string | null): Date | null {
  if (!valor) return null
  const d = new Date(valor)
  return Number.isNaN(d.getTime()) ? null : d
}

/**
 * Monta as entregas a partir de TODAS as datas de programação de entrega do
 * Calcgraf (não só a 1ª). Função PURA (sem Prisma): o chamador grava as
 * `ProgramacaoEntrega` e usa `dataPrevista` como `dataEntregaPrevista`.
 *
 * - Ignora entradas com data inválida (sem inventar data).
 * - Ordena por data crescente; `dataPrevista` = menor data.
 * - Lista vazia/sem datas válidas → `dataPrevista = null` (o chamador decide o
 *   fallback: data do lote principal). Resolve o "entrega em branco" quando a
 *   OP tem programação mas o lote não traz data.
 */
export function montarEntregas(programacao?: EntradaEntrega[] | null): ResultadoEntregas {
  const entregas: EntregaMontada[] = []
  for (const p of programacao ?? []) {
    const data = parseDataIso(p?.data)
    if (!data) continue
    const q = typeof p?.quantidade === 'number' && Number.isFinite(p.quantidade) ? p.quantidade : 0
    entregas.push({ dataEntrega: data, quantidade: q })
  }
  entregas.sort((a, b) => a.dataEntrega.getTime() - b.dataEntrega.getTime())
  return { entregas, dataPrevista: entregas.length > 0 ? entregas[0].dataEntrega : null }
}
