// Emissão NATIVA de Ordem de Produção a partir de um Item de Orçamento Gráfico.
//
// TASK 21 (spec orcamento-grafico-op-relatorio-paridade §4.4 — frente D).
//
// Objetivo: a partir de um `ItemOrcamentoGrafico` (com 0..N `PlanoCalculoGrafico`),
// EMITIR (1ª via) ou REEMITIR uma `OrdemProducao` NATIVA do PCP, reusando os models
// existentes do PCP (`OrdemProducao`, `PlanoOrdemProducao`, `ItemOrdemProducao`,
// `EtapaOrdemProducao`, `ProgramacaoEntrega`) — SEM reescrever o PCP. A OP nasce em
// status `PROGRAMADA` para cair no painel de Programação do PCP (Req 9.6), com
// `origemImportacao = 'NATIVA_CALCULO'` e vínculo `orcamentoItemId = itemId` (Req 9.5).
//
// ─────────────────────────────────────────────────────────────────────────────
// MULTI-TENANT (Req 9.8 / steering ATENCAO-pontos-verificar.md): TODA leitura e
// escrita filtra/grava com o `empresaId` DO ORÇAMENTO DE ORIGEM (não o do usuário
// que clicou). O item é carregado por `{ id, empresaId }`; os planos por
// `{ itemId, empresaId }`; a OP (e todas as filhas) são gravadas com esse mesmo
// `empresaId`. Nunca confiamos só no prismaScoped (bypass p/ SUPER_ADMIN).
//
// ─────────────────────────────────────────────────────────────────────────────
// ESTRATÉGIA DE REEMISSÃO / IDEMPOTÊNCIA (Req 9.4 / 16.6) — documentada:
//
//   • 1ª EMISSÃO (não há OP vinculada ao item): cria a OP nova com número
//     sequencial por empresa (padrão `proximoNumeroOp`/adicionar-avulsa),
//     `via = 'PRIMEIRA'`, `revisao = 0`, `emitidaPorId/emitidaEm`.
//
//   • IDEMPOTÊNCIA: se já existe OP vinculada E a emissão NÃO implica mudança
//     (as opções persistentes — hoje só `opReserva` — já batem com a OP atual),
//     retornamos a OP existente SEM criar nada novo e SEM alterar nada
//     (Req 16.6). Isso evita duplicar/incrementar revisão à toa quando o
//     usuário clica "Emitir" 2× sem mudar nada.
//
//   • REEMISSÃO: se já existe OP vinculada E houve mudança (ex.: `opReserva`
//     diferente, ou o chamador força via `forcarReemissao`), tratamos como
//     REEMISSÃO: MANTÉM o número (Req 9.4), `via = 'REEMISSAO'`,
//     `revisao = revisao + 1`, grava `reemitidaPorId/reemitidaEm`. Para
//     simplicidade e segurança (não deixar filhas órfãs/divergentes), as filhas
//     (planos/etapas/itens/programação) são APAGADAS e RECRIADAS do estado atual
//     do item — o número e o histórico de emissão permanecem. Como a OP nativa
//     ainda não entrou em produção (nasce PROGRAMADA e é gerida por esta spec),
//     recriar as filhas é seguro; não há apontamentos a preservar neste fluxo.
//
// ─────────────────────────────────────────────────────────────────────────────
// OPÇÕES (Req 11) — tratamento nesta task:
//   • `opReserva`     → PERSISTE em `OrdemProducao.opReserva` (Req 11.3).
//   • `naoGerarPedido`→ nesta task NENHUM `PedidoVenda` é criado de qualquer
//                       forma (a criação de pedido não faz parte da emissão da
//                       OP aqui); a flag é só registrada como aviso informativo.
//   • `serieAutomatica` / `gerarEmArquivo` / `imprimirTracado` → por ora apenas
//                       registram comportamento (aviso informativo), SEM efeito
//                       colateral destrutivo (Req 11.1/11.4/11.5).
//
// SEÇÕES VAZIAS (Req 10.7): item sem planos / sem materiais / sem programação de
// entrega → a OP é gerada MESMO ASSIM e os `avisos[]` acumulam mensagens APENAS
// informativas (não bloqueia, não exige confirmação).

import type { Prisma, PrismaClient } from '@prisma/client'
import { prisma } from '../../lib/prisma'
import { proximoNumeroOp } from '../ordem-producao/ordem-producao.service'
import { consumoMaterialOp } from './consumo-op.service'

// ============================================================================
// TIPOS PÚBLICOS (design §4.4)
// ============================================================================

export interface OpcoesEmissaoOp {
  /** Não gerar PedidoVenda (Req 11.2). Nesta task nenhum pedido é criado — informativo. */
  naoGerarPedido?: boolean
  /** Marca a OP como reserva (Req 11.3) — persiste em OrdemProducao.opReserva. */
  opReserva?: boolean
  /** Imprimir traçado (Req 11.1) — sem efeito colateral nesta task (informativo). */
  imprimirTracado?: boolean
  /** Série automática (Req 11.4) — sem efeito colateral nesta task (informativo). */
  serieAutomatica?: boolean
  /** Gerar em arquivo (Req 11.5) — sem efeito colateral nesta task (informativo). */
  gerarEmArquivo?: boolean
  /**
   * Força o tratamento como REEMISSÃO mesmo quando as opções persistentes não
   * mudaram (usado quando o chamador sabe que o item mudou e quer regenerar a
   * OP). Não faz parte da assinatura do design (default false) — extensão
   * interna para o fluxo de rota/lote.
   */
  forcarReemissao?: boolean
}

export interface ResultadoEmissaoOp {
  op: { id: string; numero: number; via: string; revisao: number }
  avisos: string[]
}

/**
 * Erro de regra de negócio da emissão de OP. `statusCode` mapeável pela rota
 * (mesmo padrão de `TrocaSuporteError`/`ItemOrcamentoError`):
 *  - 404 → item não encontrado para a empresa
 *  - 400 → dados inconsistentes
 */
export class EmissaoOpError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number = 400,
  ) {
    super(message)
    this.name = 'EmissaoOpError'
  }
}

// Cliente de transação do Prisma (subconjunto usado aqui).
type Tx = Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>

// ============================================================================
// HELPERS PUROS
// ============================================================================

function toNum(v: unknown, def = 0): number {
  if (v === null || v === undefined) return def
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : def
}

/** Lê o ResultadoOrcamento (Json) de um plano/item com segurança de tipo. */
interface ResultadoCalculoLike {
  encaixe?: {
    folhasNecessarias?: number
    aproveitamento?: number
    layout?: { folhaLarguraMm?: number; folhaAlturaMm?: number }
  }
  papel?: { pesoKg?: number; custo?: number }
  tinta?: { detalhePorCor?: Array<{ cor?: string; consumoKg?: number; custo?: number }> }
  maquinas?: { detalhePorEtapa?: Array<{ etapa?: string; setupMin?: number; operacaoMin?: number; custo?: number }> }
  acabamentosCentros?: { detalhePorEtapa?: Array<{ etapa?: string; setupMin?: number; operacaoMin?: number; custo?: number }> }
}

function lerResultado(json: unknown): ResultadoCalculoLike | null {
  if (!json || typeof json !== 'object') return null
  return json as ResultadoCalculoLike
}

// ============================================================================
// EMISSÃO NATIVA DE OP (Req 9/10/11/16.6)
// ============================================================================

/**
 * Emite (1ª via) ou reemite uma OP NATIVA a partir de um Item de Orçamento Gráfico.
 *
 * Idempotente por `(itemId, mesmas opções)`: a 2ª aplicação sem mudança NÃO
 * duplica nem altera a OP (Req 16.6).
 *
 * @param itemId     Item de Orçamento Gráfico de origem.
 * @param opcoes     Opções de emissão (Req 11).
 * @param usuarioId  Quem está emitindo/reemitindo.
 * @param empresaId  Empresa do ORÇAMENTO de origem (multi-tenant — Req 9.8).
 */
export async function emitirOpDoCalculo(
  itemId: string,
  opcoes: OpcoesEmissaoOp,
  usuarioId: string,
  empresaId: string,
): Promise<ResultadoEmissaoOp> {
  // 1. Carrega item + planos + orçamento pai, SEMPRE por empresaId (Req 9.8).
  const item = await prisma.itemOrcamentoGrafico.findFirst({
    where: { id: itemId, empresaId },
    include: {
      orcamento: {
        select: {
          id: true,
          empresaId: true,
          numero: true,
          clienteId: true,
          clienteNome: true,
          vendedorId: true,
          pedidoVendaId: true,
        },
      },
      planos: { where: { empresaId }, orderBy: { sequencia: 'asc' } },
    },
  })

  if (!item) {
    throw new EmissaoOpError('Item de orçamento não encontrado para esta empresa.', 404)
  }

  // Defesa extra de isolamento: o orçamento pai tem de ser da MESMA empresa.
  if (item.orcamento.empresaId !== empresaId) {
    throw new EmissaoOpError('Item de orçamento não encontrado para esta empresa.', 404)
  }

  const avisos: string[] = []

  // Opções apenas informativas nesta task (sem efeito colateral destrutivo).
  if (opcoes.naoGerarPedido) {
    avisos.push('Opção "não gerar pedido" registrada: nenhum pedido de venda é criado nesta emissão.')
  }
  if (opcoes.imprimirTracado) {
    avisos.push('Opção "imprimir traçado" registrada (sem efeito nesta emissão).')
  }
  if (opcoes.serieAutomatica) {
    avisos.push('Opção "série automática" registrada (sem efeito nesta emissão).')
  }
  if (opcoes.gerarEmArquivo) {
    avisos.push('Opção "gerar em arquivo" registrada (sem efeito nesta emissão).')
  }

  // 2. Verifica se JÁ existe OP vinculada ao item (por empresaId — Req 9.8).
  const opExistente = await prisma.ordemProducao.findFirst({
    where: { orcamentoItemId: itemId, empresaId },
    select: { id: true, numero: true, revisao: true, opReserva: true, via: true },
  })

  const opReservaDesejada = opcoes.opReserva ?? false

  // 2a. IDEMPOTÊNCIA (Req 16.6): OP já existe e nada muda → retorna sem alterar.
  if (opExistente && !opcoes.forcarReemissao && opExistente.opReserva === opReservaDesejada) {
    return {
      op: {
        id: opExistente.id,
        numero: opExistente.numero,
        via: opExistente.via ?? 'PRIMEIRA',
        revisao: opExistente.revisao,
      },
      avisos: [
        ...avisos,
        `OP ${opExistente.numero} já existente e sem alterações — emissão idempotente (nada foi duplicado nem alterado).`,
      ],
    }
  }

  // 3. Monta o bloco de faturamento (Req 10.6) a partir do orçamento/item.
  const faturamento = {
    faturamentoRazaoSocial: item.orcamento.clienteNome ?? null,
    faturamentoCodCliente: item.orcamento.clienteId ?? null,
    faturamentoPedidoInterno: item.orcamento.pedidoVendaId ?? null,
    faturamentoFichaTecnica: item.siglaAcabado ?? null,
    // Prisma aceita number diretamente em campo Decimal (converte internamente).
    faturamentoQtdPorAcabado: item.conteudoVolume != null ? item.conteudoVolume : null,
  }

  const quantidade = toNum(item.quantidade, 0)
  const descricaoItem = item.descricao ?? `Item ${item.sequencia}`

  // 4. Executa tudo numa transação única (atômica), filtrada por empresaId.
  const resultado = await prisma.$transaction(async (tx) => {
    let opId: string
    let numero: number
    let via: string
    let revisao: number

    if (!opExistente) {
      // ── 1ª EMISSÃO ──────────────────────────────────────────────────────
      numero = await proximoNumeroOpTx(tx, empresaId)
      via = 'PRIMEIRA'
      revisao = 0
      const op = await tx.ordemProducao.create({
        data: {
          empresaId,
          numero,
          origemImportacao: 'NATIVA_CALCULO',
          orcamentoItemId: itemId,
          via,
          revisao,
          opReserva: opReservaDesejada,
          emitidaPorId: usuarioId,
          emitidaEm: new Date(),
          status: 'PROGRAMADA', // cai no painel do PCP (Req 9.6)
          prioridade: 'NORMAL',
          quantidade,
          unidadeMedida: 'UN',
          clienteId: item.orcamento.clienteId ?? undefined,
          referenciaExterna: `OG-${item.orcamento.numero}-${item.sequencia}`,
          observacoes: montarObservacoes(item, descricaoItem),
          dataEmissao: new Date(),
          dataEntregaPrevista: new Date(),
          dataEntregaOriginal: new Date(),
          criadoPorId: usuarioId,
          ...faturamento,
        },
        select: { id: true },
      })
      opId = op.id
    } else {
      // ── REEMISSÃO (mantém número, incrementa revisão) ─────────────────────
      numero = opExistente.numero
      via = 'REEMISSAO'
      revisao = opExistente.revisao + 1
      opId = opExistente.id

      // Apaga as filhas e recria do estado atual do item (estratégia documentada
      // no cabeçalho). A OP nativa nasce PROGRAMADA e é gerida por esta spec —
      // não há apontamentos a preservar neste fluxo.
      await tx.apontamentoEtapa.deleteMany({ where: { etapaOrdemProducao: { ordemProducaoId: opId } } })
      await tx.etapaOrdemProducao.deleteMany({ where: { ordemProducaoId: opId } })
      await tx.itemOrdemProducao.deleteMany({ where: { ordemProducaoId: opId } })
      await tx.programacaoEntrega.deleteMany({ where: { ordemProducaoId: opId } })
      await tx.planoOrdemProducao.deleteMany({ where: { ordemProducaoId: opId } })

      await tx.ordemProducao.update({
        where: { id: opId },
        data: {
          via,
          revisao,
          opReserva: opReservaDesejada,
          reemitidaPorId: usuarioId,
          reemitidaEm: new Date(),
          quantidade,
          observacoes: montarObservacoes(item, descricaoItem),
          ...faturamento,
        },
      })
    }

    // ── Filhas: planos de produção, etapas, materiais, programação ──────────
    await criarFilhasDaOp(tx, {
      opId,
      empresaId,
      item,
      planos: item.planos,
      quantidade,
      descricaoItem,
      avisos,
    })

    return { opId, numero, via, revisao }
  })

  return {
    op: { id: resultado.opId, numero: resultado.numero, via: resultado.via, revisao: resultado.revisao },
    avisos,
  }
}

// ============================================================================
// NUMERAÇÃO SEQUENCIAL DENTRO DA TRANSAÇÃO
// ============================================================================

/**
 * Próximo número sequencial de OP por empresa (max + 1), DENTRO da transação —
 * mesmo padrão de `proximoNumeroOp`/`adicionar-avulsa`, mas usando o cliente
 * transacional para que a leitura e a criação sejam consistentes.
 */
async function proximoNumeroOpTx(tx: Tx, empresaId: string): Promise<number> {
  const ultima = await tx.ordemProducao.findFirst({
    where: { empresaId },
    orderBy: { numero: 'desc' },
    select: { numero: true },
  })
  return (ultima?.numero ?? 0) + 1
}

// ============================================================================
// OBSERVAÇÕES (tags, mesmo padrão do PCP — seção 1.6 do steering pcp-modulo)
// ============================================================================

/**
 * Monta as `observacoes` da OP com as tags estruturadas que o PCP já consome
 * (`[Cliente]`, `[Produto]`, etc.), para a OP nativa aparecer corretamente no
 * painel de Programação (que prioriza as tags sobre o relacionamento formal).
 */
function montarObservacoes(
  item: { orcamento: { clienteNome: string | null }; descricao: string | null },
  descricaoItem: string,
): string {
  const tags: string[] = []
  if (item.orcamento.clienteNome) tags.push(`[Cliente] ${item.orcamento.clienteNome}`)
  tags.push(`[Produto] ${descricaoItem}`)
  tags.push('[TipoOp] NATIVA_CALCULO')
  return tags.join('\n')
}

// ============================================================================
// CRIAÇÃO DAS FILHAS DA OP (planos / etapas / materiais / programação)
// ============================================================================

interface CriarFilhasParams {
  opId: string
  empresaId: string
  item: Prisma.ItemOrcamentoGraficoGetPayload<{
    include: { planos: true; orcamento: true }
  }>
  planos: Prisma.PlanoCalculoGraficoGetPayload<{}>[]
  quantidade: number
  descricaoItem: string
  avisos: string[]
}

/**
 * Cria as entidades-filhas da OP a partir do item e seus planos:
 *   • 1 `PlanoOrdemProducao` por `PlanoCalculoGrafico` (ou 1 implícito do item
 *     quando o item não tem planos);
 *   • `EtapaOrdemProducao` por plano com tempos Fixo/Variável de impressão e
 *     acabamento, extraídos do `resultadoCalculo` quando disponível;
 *   • `ItemOrdemProducao` por material (suporte/papel em KG via `consumoMaterialOp`
 *     com o suporte de PRODUÇÃO + tintas/pantones quando disponíveis);
 *   • `ProgramacaoEntrega` por entrega (quando houver dados de entrega).
 *
 * Seções vazias acumulam avisos informativos (Req 10.7) e NÃO bloqueiam.
 */
async function criarFilhasDaOp(tx: Tx, p: CriarFilhasParams): Promise<void> {
  const { opId, empresaId, item, planos, quantidade, descricaoItem, avisos } = p

  // ── 1. Planos de produção ──────────────────────────────────────────────
  // Mapa planoCalculoId → planoOrdemProducaoId (para vincular etapas ao plano).
  const planoProducaoIdPorSeq = new Map<number, string>()

  if (planos.length > 0) {
    for (const plano of planos) {
      const res = lerResultado(plano.resultadoCalculo)
      const aproveitamento = res?.encaixe?.aproveitamento != null ? Math.round(toNum(res.encaixe.aproveitamento)) : null
      const pesoKg = res?.papel?.pesoKg != null ? toNum(res.papel.pesoKg) : null
      const suporteNome = await resolverNomeSuporte(tx, empresaId, plano.suporteProducaoId ?? plano.suporteId)

      const pop = await tx.planoOrdemProducao.create({
        data: {
          ordemProducaoId: opId,
          empresaId,
          nome: plano.nome,
          tipo: 'COMPONENTE',
          formato: `${toNum(plano.formatoLarguraMm)} x ${toNum(plano.formatoAlturaMm)}`,
          cores: plano.numCores > 0 ? `${plano.numCores}x0` : null,
          tiragem: quantidade,
          material: suporteNome,
          gramatura: plano.gramatura != null ? toNum(plano.gramatura) : null,
          pesoKg,
          aproveitamento,
          sequencia: plano.sequencia,
        },
        select: { id: true },
      })
      planoProducaoIdPorSeq.set(plano.sequencia, pop.id)
    }
  } else {
    // Item SEM planos → cria 1 PlanoOrdemProducao IMPLÍCITO a partir do próprio
    // item (plano único). Escolha documentada: criar o plano implícito (em vez de
    // pular) mantém a OP consistente no painel (um subitem) e dá âncora às etapas.
    const res = lerResultado(item.resultadoCalculo)
    const aproveitamento = res?.encaixe?.aproveitamento != null ? Math.round(toNum(res.encaixe.aproveitamento)) : null
    const pesoKg = res?.papel?.pesoKg != null ? toNum(res.papel.pesoKg) : null
    const suporteNome = await resolverNomeSuporte(tx, empresaId, item.suporteProducaoId ?? item.suporteId)

    const pop = await tx.planoOrdemProducao.create({
      data: {
        ordemProducaoId: opId,
        empresaId,
        nome: descricaoItem.slice(0, 60),
        tipo: 'COMPONENTE',
        formato: formatoDoItem(item),
        cores: item.numCores > 0 ? `${item.numCores}x0` : null,
        tiragem: quantidade,
        material: suporteNome,
        gramatura: item.gramatura != null ? toNum(item.gramatura) : null,
        pesoKg,
        aproveitamento,
        sequencia: 1,
      },
      select: { id: true },
    })
    planoProducaoIdPorSeq.set(1, pop.id)
    avisos.push('Item sem planos: 1 plano de produção implícito foi criado a partir do item.')
  }

  // ── 2. Etapas de produção (impressão + acabamento) por plano ────────────
  await criarEtapas(tx, { opId, empresaId, item, planos, planoProducaoIdPorSeq, avisos })

  // ── 3. Materiais consumidos (ItemOrdemProducao) ─────────────────────────
  await criarMateriais(tx, { opId, empresaId, item, planos, quantidade, avisos })

  // ── 4. Programação de entrega ───────────────────────────────────────────
  // O item/orçamento gráfico não modela entregas parciais explícitas nesta
  // spec — se não há dados de entrega, pulamos com aviso informativo (Req 10.7).
  avisos.push('Sem programação de entrega no orçamento: nenhuma entrega parcial foi gerada na OP.')
}

/** Formato "L x A" a partir do formato de corte/suporte do item (ou null). */
function formatoDoItem(item: {
  formatoCorteLarguraMm: Prisma.Decimal | null
  formatoCorteAlturaMm: Prisma.Decimal | null
  formatoSupLarguraMm: Prisma.Decimal | null
  formatoSupAlturaMm: Prisma.Decimal | null
}): string | null {
  if (item.formatoCorteLarguraMm != null && item.formatoCorteAlturaMm != null) {
    return `${toNum(item.formatoCorteLarguraMm)} x ${toNum(item.formatoCorteAlturaMm)}`
  }
  if (item.formatoSupLarguraMm != null && item.formatoSupAlturaMm != null) {
    return `${toNum(item.formatoSupLarguraMm)} x ${toNum(item.formatoSupAlturaMm)}`
  }
  return null
}

/** Resolve o nome do suporte (descrição) para gravar em PlanoOrdemProducao.material. */
async function resolverNomeSuporte(tx: Tx, empresaId: string, suporteId: string | null): Promise<string | null> {
  if (!suporteId) return null
  const sup = await tx.suporteGrafico.findFirst({
    where: { id: suporteId, empresaId },
    select: { codigo: true, descricao: true },
  })
  return sup ? `${sup.codigo} - ${sup.descricao}` : null
}

// ============================================================================
// ETAPAS (impressão + acabamento) por plano
// ============================================================================

interface CriarEtapasParams {
  opId: string
  empresaId: string
  item: CriarFilhasParams['item']
  planos: CriarFilhasParams['planos']
  planoProducaoIdPorSeq: Map<number, string>
  avisos: string[]
}

/**
 * Cria `EtapaOrdemProducao` por plano a partir do `resultadoCalculo`:
 *   • impressão (`maquinas.detalhePorEtapa`) com tempos Fixo (setup) / Variável
 *     (operação);
 *   • acabamento (`acabamentosCentros.detalhePorEtapa`).
 *
 * Cada etapa precisa de `centroProducaoId`. Usamos o `maquinaId` do plano/item
 * quando houver (para a etapa de impressão) — se não houver centro resolvível,
 * registramos aviso e NÃO criamos a etapa (Req 10.7, não bloqueia).
 */
async function criarEtapas(tx: Tx, p: CriarEtapasParams): Promise<void> {
  const { opId, empresaId, item, planos, planoProducaoIdPorSeq, avisos } = p

  let sequenciaGlobal = 0

  const criarEtapasDeUmResultado = async (
    res: ResultadoCalculoLike | null,
    planoNome: string,
    planoOrdemProducaoId: string | undefined,
    maquinaId: string | null,
  ) => {
    if (!res) {
      avisos.push(`Plano "${planoNome}" sem resultado de cálculo: nenhuma etapa de produção foi gerada.`)
      return
    }

    // Resolve o centro de impressão (maquinaId do plano/item).
    let centroImpressaoId: string | null = null
    if (maquinaId) {
      const centro = await tx.centroProducao.findFirst({
        where: { id: maquinaId, empresaId },
        select: { id: true },
      })
      centroImpressaoId = centro?.id ?? null
      if (!centro) {
        avisos.push(`Plano "${planoNome}": máquina de impressão não encontrada para a empresa — etapa de impressão sem centro não foi criada.`)
      }
    }

    // Impressão.
    const impressao = res.maquinas?.detalhePorEtapa ?? []
    for (const et of impressao) {
      if (!centroImpressaoId) {
        avisos.push(`Plano "${planoNome}": etapa "${et.etapa ?? 'Impressão'}" sem centro de produção — não foi criada (Req 10.7).`)
        continue
      }
      sequenciaGlobal += 1
      await tx.etapaOrdemProducao.create({
        data: {
          ordemProducaoId: opId,
          sequencia: sequenciaGlobal,
          descricao: `${planoNome} / ${et.etapa ?? 'Impressão'}`.slice(0, 200),
          centroProducaoId: centroImpressaoId,
          tempoSetupMinutos: toNum(et.setupMin),
          tempoOperacaoCalculado: toNum(et.operacaoMin),
          status: 'PENDENTE',
          planoId: planoOrdemProducaoId ?? null,
        },
      })
    }

    // Acabamento (centros de acabamento ricos). Sem centroProducaoId resolvível
    // pelo nome → registra aviso e não cria (Req 10.7).
    const acab = res.acabamentosCentros?.detalhePorEtapa ?? []
    for (const et of acab) {
      const nome = et.etapa ?? 'Acabamento'
      const centro = await tx.centroProducao.findFirst({
        where: { empresaId, nome: { equals: nome, mode: 'insensitive' } },
        select: { id: true },
      })
      if (!centro) {
        avisos.push(`Plano "${planoNome}": etapa de acabamento "${nome}" sem centro de produção correspondente — não foi criada (Req 10.7).`)
        continue
      }
      sequenciaGlobal += 1
      await tx.etapaOrdemProducao.create({
        data: {
          ordemProducaoId: opId,
          sequencia: sequenciaGlobal,
          descricao: `${planoNome} / ${nome}`.slice(0, 200),
          centroProducaoId: centro.id,
          tempoSetupMinutos: toNum(et.setupMin),
          tempoOperacaoCalculado: toNum(et.operacaoMin),
          status: 'PENDENTE',
          planoId: planoOrdemProducaoId ?? null,
        },
      })
    }
  }

  if (planos.length > 0) {
    for (const plano of planos) {
      await criarEtapasDeUmResultado(
        lerResultado(plano.resultadoCalculo),
        plano.nome,
        planoProducaoIdPorSeq.get(plano.sequencia),
        plano.maquinaId,
      )
    }
  } else {
    await criarEtapasDeUmResultado(
      lerResultado(item.resultadoCalculo),
      item.descricao ?? `Item ${item.sequencia}`,
      planoProducaoIdPorSeq.get(1),
      item.maquinaId,
    )
  }

  if (sequenciaGlobal === 0) {
    avisos.push('Nenhuma etapa de produção foi gerada (sem máquinas/acabamentos resolvíveis). A OP foi criada mesmo assim.')
  }
}

// ============================================================================
// MATERIAIS (ItemOrdemProducao) — suporte (KG) + tintas/pantones
// ============================================================================

interface CriarMateriaisParams {
  opId: string
  empresaId: string
  item: CriarFilhasParams['item']
  planos: CriarFilhasParams['planos']
  quantidade: number
  avisos: string[]
}

/**
 * Cria `ItemOrdemProducao` por material:
 *   • suporte/papel como material em KG — consumo calculado com o SUPORTE DE
 *     PRODUÇÃO via `consumoMaterialOp` (frente C), usando a geometria/folhas do
 *     `resultadoCalculo` e gramatura/preço do suporte real;
 *   • tintas/pantones a partir de `tinta.detalhePorCor` do resultado (quando
 *     disponível), em KG.
 */
async function criarMateriais(tx: Tx, p: CriarMateriaisParams): Promise<void> {
  const { opId, empresaId, item, planos, avisos } = p

  let algumMaterial = false

  const criarPapelETintas = async (
    res: ResultadoCalculoLike | null,
    planoNome: string,
    suporteProducaoId: string | null,
    gramaturaFallback: number | null,
  ) => {
    if (!res) return

    // ── Suporte / papel (KG) ──
    const folhas = res.encaixe?.folhasNecessarias != null ? toNum(res.encaixe.folhasNecessarias) : 0
    if (folhas > 0 && suporteProducaoId) {
      const sup = await tx.suporteGrafico.findFirst({
        where: { id: suporteProducaoId, empresaId },
        select: { codigo: true, descricao: true, gramaturas: true },
      })
      // Resolve preço/gramatura do suporte de produção via PrecoMateriaPrima.
      const preco = await tx.precoMateriaPrima.findFirst({
        where: { empresaId, suporteId: suporteProducaoId, tipo: 'PAPEL', status: true },
        orderBy: { dataVigencia: 'desc' },
        select: { precoUnitario: true, gramatura: true },
      })
      const gramatura = preco?.gramatura != null ? toNum(preco.gramatura) : gramaturaFallback ?? 0
      const precoKg = preco?.precoUnitario != null ? toNum(preco.precoUnitario) : 0

      // Dimensões da folha (metros) — do layout do encaixe quando disponível.
      const layout = res.encaixe?.layout
      const larguraFolhaM = layout?.folhaLarguraMm != null ? toNum(layout.folhaLarguraMm) / 1000 : 0
      const alturaFolhaM = layout?.folhaAlturaMm != null ? toNum(layout.folhaAlturaMm) / 1000 : 0

      let quantidadeKg = 0
      if (larguraFolhaM > 0 && alturaFolhaM > 0 && gramatura > 0) {
        const consumo = consumoMaterialOp({
          folhasNecessarias: folhas,
          larguraFolhaM,
          alturaFolhaM,
          gramatura,
          precoKg,
        })
        quantidadeKg = consumo.pesoKg
      } else if (res.papel?.pesoKg != null) {
        // Fallback: peso já calculado no resultado (sem recálculo possível).
        quantidadeKg = toNum(res.papel.pesoKg)
      }

      if (quantidadeKg > 0) {
        const descricao = sup ? `${sup.codigo} - ${sup.descricao}` : `Suporte ${planoNome}`
        await tx.itemOrdemProducao.create({
          data: {
            ordemProducaoId: opId,
            empresaId,
            descricaoProduto: descricao.slice(0, 200),
            quantidade: quantidadeKg,
            unidadeMedida: 'KG',
            tipoMaterial: 'PAPEL',
            status: 'PENDENTE',
          },
        })
        algumMaterial = true
      }
    }

    // ── Tintas / pantones (KG) ──
    const tintas = res.tinta?.detalhePorCor ?? []
    for (const t of tintas) {
      const consumoKg = toNum(t.consumoKg)
      if (consumoKg <= 0) continue
      await tx.itemOrdemProducao.create({
        data: {
          ordemProducaoId: opId,
          empresaId,
          descricaoProduto: `Tinta ${t.cor ?? ''}`.trim().slice(0, 200),
          quantidade: consumoKg,
          unidadeMedida: 'KG',
          tipoMaterial: 'TINTA',
          status: 'PENDENTE',
        },
      })
      algumMaterial = true
    }
  }

  if (planos.length > 0) {
    for (const plano of planos) {
      await criarPapelETintas(
        lerResultado(plano.resultadoCalculo),
        plano.nome,
        plano.suporteProducaoId ?? plano.suporteId,
        plano.gramatura != null ? toNum(plano.gramatura) : null,
      )
    }
  } else {
    await criarPapelETintas(
      lerResultado(item.resultadoCalculo),
      item.descricao ?? `Item ${item.sequencia}`,
      item.suporteProducaoId ?? item.suporteId,
      item.gramatura != null ? toNum(item.gramatura) : null,
    )
  }

  if (!algumMaterial) {
    avisos.push('Nenhum material (suporte/tinta) foi gerado para a OP. A OP foi criada mesmo assim (Req 10.7).')
  }
}

// ============================================================================
// EMISSÃO EM LOTE (Req 11.7 / 11.8 — design §4.4)
// ============================================================================

export interface ResultadoItemLote {
  itemId: string
  status: 'ok' | 'erro'
  numero?: number
  via?: string
  revisao?: number
  motivo?: string
}

/**
 * Emite OP em lote para vários itens, aplicando as MESMAS opções a todos.
 * Conclui os sucessos; NÃO gera os que falharem (Req 11.8). Retorna o resultado
 * por item (ok/erro + número/motivo). Cada item é emitido independentemente —
 * a falha de um não interrompe os demais.
 *
 * Cada `emitirOpDoCalculo` já roda em sua PRÓPRIA transação (`prisma.$transaction`
 * interno), então um item que falha não corrompe/reverte os itens já concluídos.
 */
export async function emitirOpEmLote(
  itemIds: string[],
  opcoes: OpcoesEmissaoOp,
  usuarioId: string,
  empresaId: string,
): Promise<ResultadoItemLote[]> {
  const resultados: ResultadoItemLote[] = []
  for (const itemId of itemIds) {
    try {
      const r = await emitirOpDoCalculo(itemId, opcoes, usuarioId, empresaId)
      resultados.push({
        itemId,
        status: 'ok',
        numero: r.op.numero,
        via: r.op.via,
        revisao: r.op.revisao,
      })
    } catch (err) {
      const motivo =
        err instanceof EmissaoOpError
          ? err.message
          : err instanceof Error
            ? err.message
            : 'erro desconhecido'
      resultados.push({ itemId, status: 'erro', motivo })
    }
  }
  return resultados
}
