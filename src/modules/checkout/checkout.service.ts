import { z } from 'zod'
import { prisma } from '../../lib/prisma'
import {
  apontarProducao as apontarProducaoEtapa,
  concluirEtapa as concluirEtapaOperacional,
  pausarEtapa as pausarEtapaOperacional,
} from '../pcp/etapa-operacional.service'
import { SessaoTerminalError, validarCredenciaisSupervisorTerminal } from './sessao-terminal.service'

/**
 * Regras de negócio exclusivas do Checkout de Apontamento (task 10 do spec
 * `checkout-apontamento`).
 *
 * Este service é a camada de validação do Checkout que roda **antes** de
 * delegar para `etapa-operacional.service.ts` (`iniciarEtapa`,
 * `pausarEtapa`, `apontarProducao`, `concluirEtapa`) — nunca duplicando
 * essas 4 operações. As funções aqui implementam apenas o que o painel
 * interno do PCP não resolve: filtro de etapa por Terminal, setup como
 * evento próprio, bloqueio de sequência entre etapas dependentes,
 * múltiplos operadores simultâneos, apontamento retroativo auditável,
 * pendência de material e alerta de parada prolongada (ver design.md,
 * seção "Components and Interfaces" > "Rotas novas do Checkout").
 *
 * Padrão de erro: classe de erro customizada `CheckoutError` com
 * `statusCode` + `message`, seguindo o mesmo padrão idiomático já usado
 * neste spec em `EtapaOperacionalError` (`etapa-operacional.service.ts`),
 * `PinOperadorError` (`pin-operador.service.ts`) e `SessaoTerminalError`
 * (`sessao-terminal.service.ts`). É a classe de erro única para TODO este
 * `checkout.service.ts` — as demais funções deste arquivo (setup,
 * apontamento, parada, bloqueio de sequência, operadores ativos,
 * retroativo, pendência de material, alerta) devem reutilizá-la, nunca
 * criar uma nova classe de erro por subtarefa. Quem chama estas funções
 * (rotas de `checkout.routes.ts`) deve envolver a chamada em `try/catch`,
 * capturar `CheckoutError` e responder com `err.statusCode` +
 * `{ message: err.message }`.
 *
 * IMPORTANTE — regra central de isolamento multi-tenant (Requirements
 * 5.2, 17.1, 17.2): toda função deste service que recebe um `etapaId`
 * SEMPRE deve resolvê-lo através de `buscarEtapaDoTerminal`, nunca com uma
 * query direta a `prisma.etapaOrdemProducao` sem os dois filtros
 * (`centroProducaoId` da sessão do Terminal **e**
 * `ordemProducao.empresaId` da empresa do Token_Checkout). Os dois
 * filtros são ADITIVOS, não alternativos — ver design.md, seção
 * "Isolamento Multi-tenant", item 2. Etapa inexistente e etapa existente
 * mas de outro centro/empresa devem resultar exatamente no mesmo erro 404
 * (`CheckoutError`), propositalmente indistinguível (Property 5 do
 * design.md).
 */

export class CheckoutError extends Error {
  constructor(public statusCode: number, message: string) {
    super(message)
    this.name = 'CheckoutError'
  }
}

/**
 * Resolve uma `EtapaOrdemProducao` restrita ao Terminal do
 * `Token_Checkout` da requisição — filtrando simultaneamente por
 * `centroProducaoId` (Centro_Producao vinculado à Sessão_Terminal) e por
 * `ordemProducao.empresaId` (empresa do token). Os dois filtros são
 * aditivos: uma etapa que pertença à empresa correta mas a outro centro
 * (ou vice-versa) não é encontrada.
 *
 * Retorna a etapa com a `ordemProducao` relacionada incluída (campos
 * `id`, `empresaId`, `status` e `quantidade`, úteis para os consumidores
 * futuros deste service — ex.: bloqueio de sequência precisa saber se a
 * OP está `CANCELADA`, apontamentos precisam da quantidade planejada da
 * OP).
 *
 * Lança `CheckoutError` 404 tanto quando a etapa não existe quanto quando
 * existe mas pertence a outro centro/empresa — a resposta é
 * propositalmente idêntica nos dois casos, para não revelar a existência
 * de uma etapa fora do escopo do Terminal (Requirement 5.2, 17.1, 17.2;
 * Property 5 do design.md).
 *
 * Usada por todas as demais funções deste service que recebem um
 * `etapaId` — nunca fazer uma query direta a `etapaOrdemProducao` sem os
 * dois filtros abaixo.
 */
export async function buscarEtapaDoTerminal(
  etapaId: string,
  checkoutUser: { empresaId: string; centroProducaoId: string },
) {
  const etapa = await prisma.etapaOrdemProducao.findFirst({
    where: {
      id: etapaId,
      centroProducaoId: checkoutUser.centroProducaoId,
      ordemProducao: { empresaId: checkoutUser.empresaId },
    },
    include: {
      ordemProducao: {
        select: { id: true, empresaId: true, status: true, quantidade: true },
      },
    },
  })

  if (!etapa) {
    throw new CheckoutError(404, 'Etapa não encontrada')
  }

  return etapa
}

/**
 * Extrai o nome do produto das observações da OP (tag `[Produto]`), mesmo
 * padrão/prioridade já usado em `etapa-operacional.routes.ts` >
 * `GET /programacao/painel` (`extrairProdutoObs`) — a tag das observações
 * tem prioridade sobre o relacionamento formal `produtoId`, pois OPs
 * importadas via PDF frequentemente não têm `produtoId` vinculado a
 * cadastro (ver `pcp-modulo.md`, seção 1.6).
 */
function extrairProdutoObsPainel(obs: string | null): string | null {
  if (!obs) return null
  const m = obs.match(/\[Produto\]\s*(.+?)(?:\n|$)/)
  return m ? m[1].trim() : null
}

export interface EtapaPainelCheckout {
  id: string
  ordemProducaoId: string
  opNumero: string
  produtoNome: string | null
  descricao: string
  sequencia: number
  status: string
  posicaoFila: number | null
  quantidade: number
  unidade: string
  quantidadeProduzida: number
  quantidadePerda: number
  prioridade: string
}

/**
 * Lista as Etapas do painel do Checkout, restritas ao `Centro_Producao`
 * vinculado à Sessão_Terminal ativa (Requirement 5.4) e à empresa do
 * Token_Checkout (Requirement 17.1) — os mesmos dois filtros aditivos de
 * `buscarEtapaDoTerminal`, aqui aplicados a uma consulta de MÚLTIPLAS
 * etapas em vez de uma única.
 *
 * Reaproveita os mesmos status/ordenação já usados pelo painel de
 * Programação do PCP (`GET /pcp/programacao/painel`, documentado em
 * `pcp-modulo.md`, seção 4.1): etapas com `status` em `PENDENTE`,
 * `EM_ANDAMENTO` ou `PAUSADA`, ordenadas por `posicaoFila` (asc, nulls
 * last), depois prioridade da OP (desc) e sequência (asc).
 *
 * Retorna apenas os campos necessários para o card da etapa na tela do
 * Operador (Requirement 14.3 — mínimo de campos por tela): identificação
 * da OP/produto, descrição da etapa, status, posição na fila e
 * quantidade produzida/prevista.
 */
export async function listarPainelCheckout(
  checkoutUser: { empresaId: string; centroProducaoId: string },
): Promise<EtapaPainelCheckout[]> {
  const etapas = await prisma.etapaOrdemProducao.findMany({
    where: {
      centroProducaoId: checkoutUser.centroProducaoId,
      status: { in: ['PENDENTE', 'EM_ANDAMENTO', 'PAUSADA'] },
      ordemProducao: { empresaId: checkoutUser.empresaId },
    },
    include: {
      ordemProducao: {
        select: {
          numero: true,
          referenciaExterna: true,
          produtoId: true,
          quantidade: true,
          unidadeMedida: true,
          prioridade: true,
          observacoes: true,
        },
      },
    },
    orderBy: [
      { posicaoFila: { sort: 'asc', nulls: 'last' } },
      { ordemProducao: { prioridade: 'desc' } },
      { sequencia: 'asc' },
    ],
  })

  if (etapas.length === 0) {
    return []
  }

  const produtoIds = [
    ...new Set(etapas.map((e) => e.ordemProducao.produtoId).filter((id): id is string => id !== null)),
  ]
  const produtos =
    produtoIds.length > 0
      ? await prisma.produto.findMany({ where: { id: { in: produtoIds } }, select: { id: true, codigo: true, nome: true } })
      : []
  const produtoMap = new Map(produtos.map((p) => [p.id, `${p.codigo} - ${p.nome}`]))

  return etapas.map((etapa) => {
    const quantidade =
      Number(etapa.quantidadePrevista) > 0 ? Number(etapa.quantidadePrevista) : Number(etapa.ordemProducao.quantidade)

    return {
      id: etapa.id,
      ordemProducaoId: etapa.ordemProducaoId,
      opNumero: etapa.ordemProducao.referenciaExterna || String(etapa.ordemProducao.numero),
      produtoNome:
        extrairProdutoObsPainel(etapa.ordemProducao.observacoes) ||
        (etapa.ordemProducao.produtoId ? produtoMap.get(etapa.ordemProducao.produtoId) ?? null : null),
      descricao: etapa.descricao,
      sequencia: etapa.sequencia,
      status: etapa.status,
      posicaoFila: etapa.posicaoFila,
      quantidade,
      unidade: etapa.ordemProducao.unidadeMedida,
      quantidadeProduzida: Number(etapa.quantidadeProduzida),
      quantidadePerda: Number(etapa.quantidadePerda),
      prioridade: etapa.ordemProducao.prioridade,
    }
  })
}

/**
 * Verifica se há um `ApontamentoEtapa` tipo `SETUP` em aberto (setupInicio
 * preenchido e setupFim ainda nulo) para a etapa informada.
 *
 * Exportada para ser reutilizada por `registrarApontamentoProducao`
 * (task 10.5), que deve bloquear apontamento de tipo `PRODUCAO` enquanto
 * houver um setup em aberto para a etapa (Requirement 6.4).
 */
export async function existeSetupEmAberto(etapaId: string): Promise<boolean> {
  const setupAberto = await prisma.apontamentoEtapa.findFirst({
    where: {
      etapaOrdemProducaoId: etapaId,
      tipo: 'SETUP',
      setupInicio: { not: null },
      setupFim: null,
    },
  })

  return setupAberto !== null
}

/**
 * Inicia o setup de uma Etapa como um evento próprio, distinto da
 * produção (Requirement 6.1).
 *
 * Exige que a etapa esteja `PENDENTE` ou `PAUSADA` e que não haja um
 * setup já em aberto para ela (Requirement 6.2). O `empresaId` gravado no
 * `ApontamentoEtapa` é sempre o da Ordem de Produção real (resolvida via
 * `buscarEtapaDoTerminal`), nunca o `empresaId` do usuário que autenticou
 * a Sessão_Terminal (design.md, seção "Isolamento Multi-tenant", item 3).
 */
export async function iniciarSetup(
  etapaId: string,
  checkoutUser: { empresaId: string; centroProducaoId: string },
) {
  const etapa = await buscarEtapaDoTerminal(etapaId, checkoutUser)

  if (!['PENDENTE', 'PAUSADA'].includes(etapa.status)) {
    throw new CheckoutError(400, `Setup não pode ser iniciado. Status atual da etapa: ${etapa.status}`)
  }

  if (await existeSetupEmAberto(etapaId)) {
    throw new CheckoutError(400, 'Já existe um setup em aberto para esta etapa')
  }

  return prisma.apontamentoEtapa.create({
    data: {
      etapaOrdemProducaoId: etapaId,
      empresaId: etapa.ordemProducao.empresaId,
      tipo: 'SETUP',
      setupInicio: new Date(),
      fonteApontamento: 'MANUAL_OPERADOR',
    },
  })
}

/**
 * Finaliza o setup em aberto de uma Etapa, gravando `setupFim` e
 * calculando `setupDuracaoMinutos` (Requirement 6.3).
 */
export async function finalizarSetup(
  etapaId: string,
  checkoutUser: { empresaId: string; centroProducaoId: string },
) {
  await buscarEtapaDoTerminal(etapaId, checkoutUser)

  const setupAberto = await prisma.apontamentoEtapa.findFirst({
    where: {
      etapaOrdemProducaoId: etapaId,
      tipo: 'SETUP',
      setupInicio: { not: null },
      setupFim: null,
    },
    orderBy: { setupInicio: 'desc' },
  })

  if (!setupAberto || !setupAberto.setupInicio) {
    throw new CheckoutError(400, 'Não há setup em aberto para esta etapa')
  }

  const setupFim = new Date()
  const setupDuracaoMinutos = Math.round(
    (setupFim.getTime() - setupAberto.setupInicio.getTime()) / 60000,
  )

  return prisma.apontamentoEtapa.update({
    where: { id: setupAberto.id },
    data: { setupFim, setupDuracaoMinutos },
  })
}

/**
 * Schema de validação do payload de `registrarApontamentoProducao`
 * (Requirement 7.5) — usado tanto pela função quanto por
 * `checkout.routes.ts` (task 12.3, futura) para validar o corpo da
 * requisição antes de chegar aqui.
 *
 * `quantidade` não pode ser negativa. A checagem roda via `.parse()` no
 * início da função, antes de qualquer leitura/escrita no banco — nenhuma
 * persistência ocorre se a validação falhar.
 */
export const registrarApontamentoProducaoSchema = z.object({
  tipo: z.enum(['PRODUCAO', 'PERDA', 'RETRABALHO']),
  quantidade: z.number().min(0, 'Quantidade não pode ser negativa'),
  motivoPerda: z.enum(['ACERTO', 'REFUGO', 'DEFEITO', 'APARA']).optional(),
  funcionarioId: z.string().uuid().optional(),
  observacao: z.string().optional(),
  fotoUrl: z.string().optional(),
})

export type RegistrarApontamentoProducaoInput = z.infer<typeof registrarApontamentoProducaoSchema>

/**
 * Registra um apontamento de produção, perda ou retrabalho para uma Etapa
 * do Terminal (Requirement 7.2, 7.3, 7.4, 7.5).
 *
 * - `PRODUCAO`: delega para `etapaOperacionalService.apontarProducao()`
 *   (nunca duplicando a criação do `ApontamentoEtapa` nem o incremento de
 *   `EtapaOrdemProducao.quantidadeProduzida`). Reaproveita a mesma rota de
 *   negócio usada por `POST /pcp/etapas/:id/apontar` — decisão central do
 *   design (ver checkout.service.ts, cabeçalho do arquivo).
 * - `PERDA`: cria o `ApontamentoEtapa` diretamente aqui (tipo `PERDA`),
 *   pois o service compartilhado só aceita perda combinada com produção
 *   numa única chamada (`apontarProducao` decide o `tipo` a partir de
 *   `quantidadePerda > 0`) — o Checkout precisa de um apontamento de perda
 *   isolado, sem produção associada. Exige `motivoPerda`.
 * - `RETRABALHO`: cria o `ApontamentoEtapa` diretamente aqui (tipo
 *   `RETRABALHO`), usando exclusivamente `quantidadeRetrabalho` — NUNCA
 *   `quantidadePerda`, para não confundir retrabalho (reprocessamento) com
 *   perda (descarte definitivo). `EtapaOrdemProducao` não possui campo
 *   próprio de retrabalho acumulado; a reconciliação de totais é feita via
 *   soma dos `ApontamentoEtapa` (Property 2 do design.md), então nenhum
 *   incremento na etapa é necessário para este tipo.
 *
 * Em todos os casos, o `empresaId` gravado é sempre o da Ordem de Produção
 * real (resolvida via `buscarEtapaDoTerminal`), nunca o `empresaId` do
 * usuário que autenticou a Sessão_Terminal (Requirement 17.3).
 */
export async function registrarApontamentoProducao(
  etapaId: string,
  checkoutUser: { empresaId: string; centroProducaoId: string },
  dadosRecebidos: RegistrarApontamentoProducaoInput,
) {
  // Requirement 7.5 — valida quantidade não-negativa (e o restante do
  // payload) via Zod ANTES de qualquer consulta/persistência. Esta função
  // é a barreira de validação final: mesmo que `checkout.routes.ts` (task
  // 12.3, futura) já valide o corpo da requisição, `registrarApontamentoProducao`
  // pode ser chamada diretamente (testes/reuso futuro) sem passar pela
  // rota, então nunca confia apenas na validação do chamador.
  const resultado = registrarApontamentoProducaoSchema.safeParse(dadosRecebidos)
  if (!resultado.success) {
    throw new CheckoutError(400, resultado.error.errors[0]?.message ?? 'Dados inválidos para o apontamento')
  }
  const dados = resultado.data

  const etapa = await buscarEtapaDoTerminal(etapaId, checkoutUser)

  // Requirement 6.4 — bloqueia apontamento de produção enquanto houver
  // setup em aberto para a etapa.
  if (dados.tipo === 'PRODUCAO' && (await existeSetupEmAberto(etapaId))) {
    throw new CheckoutError(400, 'Finalize o setup em aberto antes de apontar produção')
  }

  if (dados.tipo === 'PRODUCAO') {
    return apontarProducaoEtapa(etapaId, checkoutUser.empresaId, {
      quantidadeProduzida: dados.quantidade,
      quantidadePerda: 0,
      funcionarioId: dados.funcionarioId,
      observacao: dados.observacao,
      fotoUrl: dados.fotoUrl,
    })
  }

  if (dados.tipo === 'PERDA') {
    if (!dados.motivoPerda) {
      throw new CheckoutError(400, 'motivoPerda é obrigatório para apontamento de perda')
    }

    const apontamento = await prisma.apontamentoEtapa.create({
      data: {
        etapaOrdemProducaoId: etapaId,
        empresaId: etapa.ordemProducao.empresaId,
        funcionarioId: dados.funcionarioId,
        tipo: 'PERDA',
        quantidadePerda: dados.quantidade,
        motivoPerda: dados.motivoPerda,
        fonteApontamento: 'MANUAL_OPERADOR',
        observacao: dados.observacao,
        fotoUrl: dados.fotoUrl,
      },
    })

    await prisma.etapaOrdemProducao.update({
      where: { id: etapaId },
      data: { quantidadePerda: { increment: dados.quantidade } },
    })

    return apontamento
  }

  // dados.tipo === 'RETRABALHO'
  // Usa quantidadeRetrabalho (nunca quantidadePerda — Requirement 7.3,
  // Property 11 do design.md). EtapaOrdemProducao não tem campo próprio
  // de retrabalho acumulado, então não há incremento de etapa aqui: a
  // reconciliação de totais é feita via soma dos ApontamentoEtapa.
  return prisma.apontamentoEtapa.create({
    data: {
      etapaOrdemProducaoId: etapaId,
      empresaId: etapa.ordemProducao.empresaId,
      funcionarioId: dados.funcionarioId,
      tipo: 'RETRABALHO',
      quantidadeRetrabalho: dados.quantidade,
      fonteApontamento: 'MANUAL_OPERADOR',
      observacao: dados.observacao,
      fotoUrl: dados.fotoUrl,
    },
  })
}

/**
 * Schema de validação do payload de `pausarEtapaComMotivo` (Requirement
 * 8.1) — usado tanto pela função quanto por `checkout.routes.ts` (task
 * 12.3, futura) para validar o corpo da requisição antes de chegar aqui.
 *
 * `motivoParada` e `paradaPlanejada` são obrigatórios: o Checkout, ao
 * contrário da rota interna `PATCH /pcp/etapas/:id/pausar` (que aceita
 * `paradaPlanejada` como opcional, para não quebrar chamadores
 * existentes), sempre exige os dois campos do Operador antes de aceitar a
 * pausa.
 */
export const pausarEtapaComMotivoSchema = z.object({
  motivoParada: z.enum(['MANUTENCAO', 'FALTA_MATERIAL', 'ACERTO_MAQUINA', 'TROCA_TURNO', 'OUTRO']),
  paradaPlanejada: z.boolean(),
  observacao: z.string().optional(),
})

export type PausarEtapaComMotivoInput = z.infer<typeof pausarEtapaComMotivoSchema>

/**
 * Resultado de `pausarEtapaComMotivo` — estende o retorno de
 * `etapaOperacionalService.pausarEtapa()` com o indicador de candidata a
 * ordem de manutenção (Requirement 8.3), calculado aqui e não persistido
 * em nenhum novo campo/tabela: o schema do Checkout não modela uma
 * entidade "ordem de manutenção" (não existe no `schema.prisma` — ver
 * design.md/requirements.md desta spec), então a sinalização é apenas
 * informativa, devolvida no retorno da função para quem for exibi-la
 * (tela de Supervisor, log, etc.).
 */
export interface PausarEtapaComMotivoResultado {
  message: string
  motivo: PausarEtapaComMotivoInput['motivoParada']
  paradaPlanejada: boolean
  candidataOrdemManutencao: boolean
}

/**
 * Pausa uma Etapa do Terminal exigindo motivo de parada e indicador de
 * parada planejada/não planejada (Requirement 8.1), delegando para
 * `etapaOperacionalService.pausarEtapa()` (Requirement 8.4) — nunca
 * duplicando a transição de status da etapa nem a criação do
 * `ApontamentoEtapa` tipo `PARADA`.
 *
 * - Requirement 8.2: quando `paradaPlanejada` é `true`, o `paradaPlanejada`
 *   é gravado no `ApontamentoEtapa` correspondente (repassado para
 *   `pausarEtapa`, que agora aceita o campo — ver
 *   `etapa-operacional.service.ts`).
 * - Requirement 8.3: quando `paradaPlanejada` é `false` e `motivoParada`
 *   é `MANUTENCAO`, a parada é sinalizada como candidata a abertura de
 *   ordem de manutenção — apenas uma flag no retorno (`candidataOrdemManutencao`),
 *   já que não existe entidade "ordem de manutenção" no modelo de dados.
 *
 * O `empresaId` usado é o da `checkoutUser` (empresa do Token_Checkout),
 * já resolvido a partir da entidade de negócio real na autenticação da
 * Sessão_Terminal — `buscarEtapaDoTerminal` é chamada implicitamente
 * dentro de `pausarEtapaOperacional` (via filtro por `ordemProducao.empresaId`),
 * mas aqui validamos primeiro via `buscarEtapaDoTerminal` para aplicar o
 * filtro adicional de `centroProducaoId` do Terminal (Requirement 5.2,
 * 17.1, 17.2), antes de delegar.
 */
export async function pausarEtapaComMotivo(
  etapaId: string,
  checkoutUser: { empresaId: string; centroProducaoId: string },
  dadosRecebidos: PausarEtapaComMotivoInput,
): Promise<PausarEtapaComMotivoResultado> {
  const resultado = pausarEtapaComMotivoSchema.safeParse(dadosRecebidos)
  if (!resultado.success) {
    throw new CheckoutError(400, resultado.error.errors[0]?.message ?? 'Dados inválidos para a parada')
  }
  const dados = resultado.data

  // Requirement 5.2, 17.1, 17.2 — garante que a etapa pertence ao
  // Terminal (centro + empresa) antes de delegar para o service
  // compartilhado, que só filtra por empresa.
  await buscarEtapaDoTerminal(etapaId, checkoutUser)

  const paradaResultado = await pausarEtapaOperacional(etapaId, checkoutUser.empresaId, {
    motivoParada: dados.motivoParada,
    observacao: dados.observacao,
    paradaPlanejada: dados.paradaPlanejada,
  })

  const candidataOrdemManutencao = !dados.paradaPlanejada && dados.motivoParada === 'MANUTENCAO'

  return {
    message: paradaResultado.message,
    motivo: dados.motivoParada,
    paradaPlanejada: dados.paradaPlanejada,
    candidataOrdemManutencao,
  }
}

/**
 * Deriva a "sequência original" de uma Etapa a partir de `sequencia`,
 * revertendo a fórmula de desmembramento documentada em
 * `pcp-modulo.md` (seção 4.5): `sequencia = sequenciaOriginal * 10 +
 * índice + 1`. Etapas nunca desmembradas têm `quantidadePrevista === 0`
 * (marcador de desmembramento) e sua própria `sequencia` já é a
 * "original" (não passaram pela fórmula).
 *
 * Usada por `verificarSequenciaConcluivel` para identificar quais etapas
 * de sequência "menor" são, na verdade, partes-irmãs do mesmo
 * desmembramento da etapa que está sendo concluída (Requirement 9.3,
 * Property 4 do design.md) — essas nunca devem bloquear a conclusão umas
 * das outras, independente do valor numérico de `sequencia` resultante da
 * fórmula.
 */
function sequenciaOriginalDe(etapa: { sequencia: number; quantidadePrevista: unknown }): number {
  const desmembrada = Number(etapa.quantidadePrevista) > 0
  return desmembrada ? Math.floor(etapa.sequencia / 10) : etapa.sequencia
}

export interface VerificarSequenciaConcluivelResultado {
  concluivel: boolean
  etapaBloqueadoraId?: string
  etapaBloqueadoraSequencia?: number
  etapaBloqueadoraDescricao?: string
}

/**
 * Verifica se uma Etapa pode ser concluída sem violar a ordem de
 * sequência da Ordem de Produção (Requirement 9.1, 9.2, 9.3).
 *
 * Busca todas as etapas da mesma `OrdemProducao` com `sequencia` menor que
 * a da etapa avaliada e status diferente de `CONCLUIDA`, EXCETO as que são
 * partes-irmãs do mesmo desmembramento da etapa avaliada (mesma sequência
 * original, ambas com `quantidadePrevista > 0` — Requirement 9.3, Property
 * 4 do design.md): essas nunca bloqueiam a conclusão umas das outras,
 * independentemente do status das demais partes.
 *
 * Retorna `{ concluivel: true }` se nenhuma etapa bloqueadora for
 * encontrada, ou `{ concluivel: false, etapaBloqueadoraId, ... }` com os
 * dados da primeira etapa pendente encontrada (para a mensagem de erro
 * indicar qual etapa anterior está pendente — Requirement 9.2).
 */
export async function verificarSequenciaConcluivel(
  etapaId: string,
  checkoutUser: { empresaId: string; centroProducaoId: string },
): Promise<VerificarSequenciaConcluivelResultado> {
  const etapa = await buscarEtapaDoTerminal(etapaId, checkoutUser)

  const sequenciaOriginalEtapa = sequenciaOriginalDe(etapa)

  const etapasDaOp = await prisma.etapaOrdemProducao.findMany({
    where: {
      ordemProducaoId: etapa.ordemProducaoId,
      sequencia: { lt: etapa.sequencia },
    },
    select: { id: true, sequencia: true, status: true, quantidadePrevista: true, descricao: true },
  })

  const etapaBloqueadora = etapasDaOp.find((etapaAnterior) => {
    if (etapaAnterior.status === 'CONCLUIDA') {
      return false
    }

    // Requirement 9.3 / Property 4 — etapas irmãs do mesmo desmembramento
    // (mesma sequência original, ambas resultantes de desmembramento)
    // nunca bloqueiam a conclusão uma da outra.
    const ambasDesmembradas = Number(etapaAnterior.quantidadePrevista) > 0 && Number(etapa.quantidadePrevista) > 0
    if (ambasDesmembradas && sequenciaOriginalDe(etapaAnterior) === sequenciaOriginalEtapa) {
      return false
    }

    return true
  })

  if (!etapaBloqueadora) {
    return { concluivel: true }
  }

  return {
    concluivel: false,
    etapaBloqueadoraId: etapaBloqueadora.id,
    etapaBloqueadoraSequencia: etapaBloqueadora.sequencia,
    etapaBloqueadoraDescricao: etapaBloqueadora.descricao,
  }
}

/**
 * Payload de autorização explícita de Supervisor para concluir uma Etapa
 * fora da ordem de sequência (Requirement 9.4) — mesmas credenciais
 * (email/senha) validadas pelo mesmo fluxo já usado em
 * `criarSessaoTerminal`/`trocarCentroSessao`
 * (`validarCredenciaisSupervisorTerminal`, `sessao-terminal.service.ts`),
 * para não introduzir um segundo padrão de autenticação de Supervisor
 * dentro do mesmo módulo.
 */
export const autorizacaoSupervisorSchema = z.object({
  email: z.string().email(),
  senha: z.string().min(1),
})

export type AutorizacaoSupervisorInput = z.infer<typeof autorizacaoSupervisorSchema>

/**
 * Conclui uma Etapa do Terminal aplicando o bloqueio de sequência entre
 * etapas dependentes (Requirement 9.1, 9.2, 9.3, 9.4, 9.6).
 *
 * Fluxo:
 * 1. Resolve a etapa via `buscarEtapaDoTerminal` (isolamento multi-tenant).
 * 2. Requirement 9.6 — se a `OrdemProducao` estiver `CANCELADA`, bloqueia
 *    IMEDIATAMENTE sem chamar `verificarSequenciaConcluivel` nem a rota
 *    interna de conclusão, mantendo a etapa no status atual.
 * 3. Requirement 9.1, 9.2, 9.3 — chama `verificarSequenciaConcluivel`. Se
 *    concluível, delega direto para
 *    `etapaOperacionalService.concluirEtapa()` (Requirement 9.5).
 * 4. Requirement 9.4 — se bloqueada e `autorizacaoSupervisor` foi
 *    informada, valida as credenciais do Supervisor
 *    (`validarCredenciaisSupervisorTerminal`), registra a
 *    `EtapaAutorizacaoSequencia` vinculando a etapa bloqueadora, e só
 *    então delega para `etapaOperacionalService.concluirEtapa()`.
 * 5. Se bloqueada e sem autorização (ou autorização com credenciais
 *    inválidas), lança `CheckoutError` e NÃO chama a rota interna de
 *    conclusão — a etapa permanece no status atual (Requirement 9.6).
 *
 * O `empresaId` gravado na `EtapaAutorizacaoSequencia` é sempre o da Ordem
 * de Produção real (`etapa.ordemProducao.empresaId`), nunca o `empresaId`
 * do usuário que autenticou a Sessão_Terminal (Requirement 17.3).
 */
export async function concluirEtapaComBloqueio(
  etapaId: string,
  checkoutUser: { empresaId: string; centroProducaoId: string; autenticadaPorUsuarioId: string },
  autorizacaoSupervisor?: AutorizacaoSupervisorInput,
) {
  const etapa = await buscarEtapaDoTerminal(etapaId, checkoutUser)

  // Requirement 9.6 — OP cancelada: nunca chamar a rota interna de
  // conclusão, etapa permanece no status atual.
  if (etapa.ordemProducao.status === 'CANCELADA') {
    throw new CheckoutError(400, 'Ordem de Produção está cancelada. A etapa não pode ser concluída.')
  }

  const verificacao = await verificarSequenciaConcluivel(etapaId, checkoutUser)

  if (verificacao.concluivel) {
    // usuarioId gravado em LogOrdemProducao (quando esta for a última
    // etapa da OP) é o Usuario que autenticou a Sessão_Terminal — não há
    // supervisor autorizando nesse caminho (sequência já concluível).
    return concluirEtapaOperacional(etapaId, checkoutUser.empresaId, checkoutUser.autenticadaPorUsuarioId)
  }

  // Etapa bloqueada por sequência pendente — Requirement 9.2.
  if (!autorizacaoSupervisor) {
    throw new CheckoutError(
      400,
      `Conclusão bloqueada: a etapa de sequência ${verificacao.etapaBloqueadoraSequencia} ` +
        `(${verificacao.etapaBloqueadoraDescricao}) ainda não está concluída. ` +
        'É necessária autorização de um Supervisor para concluir fora de sequência.',
    )
  }

  const resultado = autorizacaoSupervisorSchema.safeParse(autorizacaoSupervisor)
  if (!resultado.success) {
    throw new CheckoutError(400, resultado.error.errors[0]?.message ?? 'Autorização de Supervisor inválida')
  }

  // Requirement 9.4 — valida credenciais de Supervisor (mesmo fluxo de
  // sessao-terminal.service.ts). Credenciais inválidas → nunca chama a
  // rota interna de conclusão (Requirement 9.6).
  let usuarioAutorizador
  try {
    usuarioAutorizador = await validarCredenciaisSupervisorTerminal(
      resultado.data,
      checkoutUser.empresaId,
      'unknown',
      'unknown',
    )
  } catch (err) {
    if (err instanceof SessaoTerminalError) {
      throw new CheckoutError(err.statusCode, err.message)
    }
    throw err
  }

  // Registra a autorização no histórico da Etapa (Requirement 9.4) —
  // empresaId sempre da OP real, nunca do usuário autenticado.
  await prisma.etapaAutorizacaoSequencia.create({
    data: {
      empresaId: etapa.ordemProducao.empresaId,
      etapaOrdemProducaoId: etapaId,
      etapaBloqueadoraId: verificacao.etapaBloqueadoraId as string,
      autorizadoPorUsuarioId: usuarioAutorizador.id,
    },
  })

  return concluirEtapaOperacional(etapaId, checkoutUser.empresaId, usuarioAutorizador.id)
}

/**
 * Schema de validação do `funcionarioId` recebido por
 * `registrarEntradaOperador`/`registrarSaidaOperador` (Requirement 10.1,
 * 10.2, 10.3) — mesmo padrão de validação via Zod já usado no restante
 * deste arquivo (`registrarApontamentoProducaoSchema`,
 * `pausarEtapaComMotivoSchema`), rodando ANTES de qualquer consulta/
 * persistência no banco.
 */
const funcionarioIdSchema = z.string().uuid('funcionarioId inválido')

/**
 * Registra a entrada de um Operador numa Etapa, suportando múltiplos
 * Operadores simultâneos trabalhando na mesma Etapa (Requirement 10.1,
 * 10.2) — ex.: coladeira operada por 2-3 pessoas.
 *
 * Decisão de design (idempotência): se já existir um `OperadorAtivoEtapa`
 * ativo (sem `saidaEm`) para o mesmo `funcionarioId` nesta Etapa, a função
 * NÃO cria um registro duplicado — apenas retorna o registro já ativo.
 * Isso evita duas "entradas" abertas simultâneas para o mesmo Operador na
 * mesma Etapa (o que quebraria a leitura de `listarOperadoresAtivos`, que
 * passaria a listar o mesmo Operador duas vezes) — por exemplo, se o
 * cliente reenviar a requisição por instabilidade de rede, ou se o
 * Operador tocar "entrar" novamente sem ter saído. Um Operador que queira
 * "reiniciar" sua contagem de tempo ativo deve primeiro registrar saída
 * (`registrarSaidaOperador`) e depois entrada novamente.
 *
 * O `empresaId` gravado é sempre o da Ordem de Produção real (resolvida
 * via `buscarEtapaDoTerminal`), nunca o `empresaId` do usuário que
 * autenticou a Sessão_Terminal (Requirement 17.3).
 */
export async function registrarEntradaOperador(
  etapaId: string,
  checkoutUser: { empresaId: string; centroProducaoId: string },
  funcionarioId: string,
) {
  const resultado = funcionarioIdSchema.safeParse(funcionarioId)
  if (!resultado.success) {
    throw new CheckoutError(400, resultado.error.errors[0]?.message ?? 'funcionarioId inválido')
  }

  const etapa = await buscarEtapaDoTerminal(etapaId, checkoutUser)

  const operadorJaAtivo = await prisma.operadorAtivoEtapa.findFirst({
    where: {
      etapaOrdemProducaoId: etapaId,
      funcionarioId: resultado.data,
      saidaEm: null,
    },
  })

  if (operadorJaAtivo) {
    // Idempotente — não duplica a entrada de um Operador já ativo na
    // Etapa (ver decisão de design no cabeçalho desta função).
    return operadorJaAtivo
  }

  return prisma.operadorAtivoEtapa.create({
    data: {
      empresaId: etapa.ordemProducao.empresaId,
      etapaOrdemProducaoId: etapaId,
      funcionarioId: resultado.data,
    },
  })
}

/**
 * Registra a saída de um Operador de uma Etapa sem concluí-la (ex.: fim de
 * turno), preservando os demais Operadores que permanecerem ativos
 * (Requirement 10.3) — grava `saidaEm` apenas no `OperadorAtivoEtapa`
 * daquele `funcionarioId`, nunca tocando nos registros dos demais
 * Operadores ativos na mesma Etapa (Property 14 do design.md).
 *
 * Lança `CheckoutError` 404 se não houver um `OperadorAtivoEtapa` ativo
 * (sem `saidaEm`) para o `funcionarioId` informado nesta Etapa — nada é
 * gravado nesse caso.
 */
export async function registrarSaidaOperador(
  etapaId: string,
  checkoutUser: { empresaId: string; centroProducaoId: string },
  funcionarioId: string,
) {
  const resultado = funcionarioIdSchema.safeParse(funcionarioId)
  if (!resultado.success) {
    throw new CheckoutError(400, resultado.error.errors[0]?.message ?? 'funcionarioId inválido')
  }

  await buscarEtapaDoTerminal(etapaId, checkoutUser)

  const operadorAtivo = await prisma.operadorAtivoEtapa.findFirst({
    where: {
      etapaOrdemProducaoId: etapaId,
      funcionarioId: resultado.data,
      saidaEm: null,
    },
  })

  if (!operadorAtivo) {
    throw new CheckoutError(404, 'Operador não está ativo nesta etapa')
  }

  // Update por `id` (não por `funcionarioId`/`etapaOrdemProducaoId`) —
  // afeta exclusivamente este registro, preservando os demais
  // `OperadorAtivoEtapa` ativos da mesma Etapa (Requirement 10.3).
  return prisma.operadorAtivoEtapa.update({
    where: { id: operadorAtivo.id },
    data: { saidaEm: new Date() },
  })
}

export interface OperadorAtivoResultado {
  id: string
  funcionarioId: string
  nome: string
  entradaEm: Date
}

/**
 * Lista todos os Operadores atualmente ativos (sem `saidaEm`) numa Etapa
 * `EM_ANDAMENTO` (Requirement 10.4), enriquecendo cada registro com o
 * nome do `Funcionario` para exibição na tela — não há relação Prisma
 * declarada entre `OperadorAtivoEtapa` e `Funcionario` no schema, então o
 * enriquecimento é feito com uma segunda consulta e um `Map`, mesmo padrão
 * já usado em outras rotas do projeto (ex.:
 * `relatorios-wms.routes.ts`, `onda-separacao.routes.ts`).
 */
export async function listarOperadoresAtivos(
  etapaId: string,
  checkoutUser: { empresaId: string; centroProducaoId: string },
): Promise<OperadorAtivoResultado[]> {
  await buscarEtapaDoTerminal(etapaId, checkoutUser)

  const operadoresAtivos = await prisma.operadorAtivoEtapa.findMany({
    where: {
      etapaOrdemProducaoId: etapaId,
      saidaEm: null,
    },
    orderBy: { entradaEm: 'asc' },
  })

  if (operadoresAtivos.length === 0) {
    return []
  }

  const funcionarioIds = [...new Set(operadoresAtivos.map((o) => o.funcionarioId))]
  const funcionarios = await prisma.funcionario.findMany({
    where: { id: { in: funcionarioIds } },
    select: { id: true, nome: true },
  })
  const nomeporFuncionarioId = new Map(funcionarios.map((f) => [f.id, f.nome]))

  return operadoresAtivos.map((operador) => ({
    id: operador.id,
    funcionarioId: operador.funcionarioId,
    nome: nomeporFuncionarioId.get(operador.funcionarioId) ?? 'Desconhecido',
    entradaEm: operador.entradaEm,
  }))
}

/**
 * Schema de validação do payload de `registrarApontamentoRetroativo`
 * (Requirement 11.2) — `motivo` é obrigatório (grava em
 * `motivoRetroativo`); `quantidade` acompanha o mesmo tipo do
 * `ApontamentoEtapa` original (produção/perda/retrabalho) e segue a mesma
 * regra de não-negatividade já usada em
 * `registrarApontamentoProducaoSchema` (Requirement 7.5).
 *
 * Nota de design: a task 10.15 descreve a assinatura da função como
 * `registrarApontamentoRetroativo(apontamentoOrigemId, checkoutUser,
 * motivo, autorizacaoSupervisor)`, mas o registro retroativo de um
 * apontamento de produção/perda/retrabalho não tem sentido sem uma
 * quantidade (é exatamente o que alimenta o recálculo de totais do
 * Requirement 11.4 / Property 2 do design.md). Por isso `quantidade` foi
 * agrupado junto de `motivo` num único objeto `dados`, seguindo o mesmo
 * padrão já usado por `registrarApontamentoProducao`
 * (`dadosRecebidos: RegistrarApontamentoProducaoInput`) em vez de um
 * parâmetro posicional solto.
 */
export const registrarApontamentoRetroativoSchema = z.object({
  motivo: z.string().min(1, 'motivo é obrigatório'),
  quantidade: z.number().min(0, 'Quantidade não pode ser negativa').default(0),
  observacao: z.string().optional(),
  fotoUrl: z.string().optional(),
})

export type RegistrarApontamentoRetroativoInput = z.infer<typeof registrarApontamentoRetroativoSchema>

/**
 * Recalcula `EtapaOrdemProducao.quantidadeProduzida`/`quantidadePerda`
 * somando TODOS os `ApontamentoEtapa` da etapa (originais + retroativos)
 * do tipo correspondente — nunca incrementando, sempre recalculando a
 * soma total, para garantir que os totais da etapa permaneçam
 * reconciliáveis com a soma dos apontamentos mesmo após a inclusão de um
 * `Apontamento_Retroativo` (Requirement 11.4, Property 2 do design.md).
 *
 * Exportada para ser reaproveitada por `listarHistoricoApontamentos`
 * (task 10.24, futura) e por qualquer outro fluxo que precise reconciliar
 * os totais da etapa a partir do zero.
 */
export async function recalcularTotaisEtapa(etapaId: string) {
  const [totalProduzida, totalPerda] = await Promise.all([
    prisma.apontamentoEtapa.aggregate({
      where: { etapaOrdemProducaoId: etapaId, tipo: 'PRODUCAO' },
      _sum: { quantidadeProduzida: true },
    }),
    prisma.apontamentoEtapa.aggregate({
      where: { etapaOrdemProducaoId: etapaId, tipo: 'PERDA' },
      _sum: { quantidadePerda: true },
    }),
  ])

  return prisma.etapaOrdemProducao.update({
    where: { id: etapaId },
    data: {
      quantidadeProduzida: totalProduzida._sum.quantidadeProduzida ?? 0,
      quantidadePerda: totalPerda._sum.quantidadePerda ?? 0,
    },
  })
}

/**
 * Registra um Apontamento_Retroativo vinculado a um `ApontamentoEtapa`
 * original, exigindo autorização explícita de Supervisor (Requirement
 * 11.2, 11.3) e sem NUNCA apagar ou sobrescrever o registro original
 * (Requirement 11.1, Property 1 do design.md).
 *
 * Fluxo:
 * 1. Valida `dadosRecebidos` (`motivo` obrigatório, `quantidade`
 *    não-negativa) via Zod — Requirement 11.2.
 * 2. Requirement 11.3 — exige `autorizacaoSupervisor`; sem ela, bloqueia
 *    ANTES de qualquer leitura/escrita de negócio (mesmo padrão de
 *    `concluirEtapaComBloqueio`, Requirement 9.4/9.6). Com ela, reutiliza
 *    `validarCredenciaisSupervisorTerminal` (mesmo fluxo de autenticação
 *    de Supervisor já usado em `criarSessaoTerminal`/
 *    `concluirEtapaComBloqueio`) — credenciais inválidas também bloqueiam
 *    o registro.
 * 3. Busca o `ApontamentoEtapa` original filtrando por `empresaId` do
 *    Token_Checkout (isolamento multi-tenant) — não encontrado é 404.
 * 4. Resolve a etapa do apontamento original via `buscarEtapaDoTerminal`
 *    (Centro_Producao da Sessão_Terminal + empresa), garantindo que a
 *    correção só pode ser feita a partir do mesmo Terminal/empresa da
 *    etapa original (Requirement 17.1, 17.2, Property 5 do design.md).
 * 5. Cria o novo `ApontamentoEtapa` com `apontamentoOrigemId` preenchido,
 *    MESMO `tipo` do original (Requirement 11.1 — nunca um apontamento
 *    "novo" desvinculado do tipo que está sendo corrigido/complementado),
 *    `motivoRetroativo` e `autorizadoPorUsuarioId` gravados (Requirement
 *    11.2), e `empresaId` sempre da Ordem de Produção real (Requirement
 *    17.3) — nunca lê, apaga ou sobrescreve o `ApontamentoEtapa` original.
 * 6. Requirement 11.4/Property 2 — recalcula os totais da etapa via
 *    `recalcularTotaisEtapa`, somando TODOS os apontamentos (originais +
 *    retroativos) do tipo correspondente.
 *
 * O `apontamentoOrigemId` preenchido no registro criado é o que permite
 * distinguir apontamento original de retroativo no histórico (Requirement
 * 11.5), responsabilidade de leitura de `listarHistoricoApontamentos`
 * (task 10.24, futura) — esta função apenas garante que o dado necessário
 * para essa distinção seja gravado corretamente.
 */
export async function registrarApontamentoRetroativo(
  apontamentoOrigemId: string,
  checkoutUser: { empresaId: string; centroProducaoId: string },
  dadosRecebidos: RegistrarApontamentoRetroativoInput,
  autorizacaoSupervisor?: AutorizacaoSupervisorInput,
) {
  const resultadoDados = registrarApontamentoRetroativoSchema.safeParse(dadosRecebidos)
  if (!resultadoDados.success) {
    throw new CheckoutError(400, resultadoDados.error.errors[0]?.message ?? 'Dados inválidos para o apontamento retroativo')
  }
  const dados = resultadoDados.data

  // Requirement 11.3 — sem autorização de Supervisor, bloqueia ANTES de
  // qualquer leitura/escrita de negócio. Nenhum ApontamentoEtapa é criado
  // neste caminho.
  if (!autorizacaoSupervisor) {
    throw new CheckoutError(400, 'Apontamento retroativo requer autorização de Supervisor')
  }

  const resultadoAutorizacao = autorizacaoSupervisorSchema.safeParse(autorizacaoSupervisor)
  if (!resultadoAutorizacao.success) {
    throw new CheckoutError(400, resultadoAutorizacao.error.errors[0]?.message ?? 'Autorização de Supervisor inválida')
  }

  let usuarioAutorizador
  try {
    usuarioAutorizador = await validarCredenciaisSupervisorTerminal(
      resultadoAutorizacao.data,
      checkoutUser.empresaId,
      'unknown',
      'unknown',
    )
  } catch (err) {
    if (err instanceof SessaoTerminalError) {
      throw new CheckoutError(err.statusCode, err.message)
    }
    throw err
  }

  // Requirement 17.1, 17.2 — busca o apontamento original restrito à
  // empresa do Token_Checkout. Não encontrado (inexistente OU de outra
  // empresa) resulta no mesmo erro 404 abaixo.
  const apontamentoOriginal = await prisma.apontamentoEtapa.findFirst({
    where: { id: apontamentoOrigemId, empresaId: checkoutUser.empresaId },
  })

  if (!apontamentoOriginal) {
    throw new CheckoutError(404, 'Apontamento original não encontrado')
  }

  // Requirement 5.2, 17.1, 17.2 — resolve a etapa do apontamento original
  // via buscarEtapaDoTerminal, garantindo o filtro aditivo de
  // Centro_Producao da Sessão_Terminal + empresa (Property 5 do
  // design.md). Lança 404 (mesma mensagem) se a etapa não pertencer ao
  // Terminal atual.
  const etapa = await buscarEtapaDoTerminal(apontamentoOriginal.etapaOrdemProducaoId, checkoutUser)

  // Requirement 11.1 — o novo ApontamentoEtapa é sempre criado (nunca
  // atualiza/apaga o original). MESMO tipo do apontamento original: se
  // original é PRODUCAO, o retroativo também é PRODUCAO, apenas
  // complementando/corrigindo — nunca um tipo diferente do que está sendo
  // corrigido.
  const dadosPorTipo: {
    quantidadeProduzida?: number
    quantidadePerda?: number
    quantidadeRetrabalho?: number
    motivoPerda?: string | null
  } = {}

  if (apontamentoOriginal.tipo === 'PRODUCAO') {
    dadosPorTipo.quantidadeProduzida = dados.quantidade
  } else if (apontamentoOriginal.tipo === 'PERDA') {
    dadosPorTipo.quantidadePerda = dados.quantidade
    dadosPorTipo.motivoPerda = apontamentoOriginal.motivoPerda
  } else if (apontamentoOriginal.tipo === 'RETRABALHO') {
    dadosPorTipo.quantidadeRetrabalho = dados.quantidade
  }
  // Demais tipos (SETUP, PARADA, RETOMADA): o retroativo preserva o tipo
  // original e o vínculo de auditoria, sem quantidade associada — não há
  // campo de quantidade aplicável a esses tipos no modelo de dados.

  const apontamentoRetroativo = await prisma.apontamentoEtapa.create({
    data: {
      etapaOrdemProducaoId: apontamentoOriginal.etapaOrdemProducaoId,
      empresaId: etapa.ordemProducao.empresaId,
      funcionarioId: apontamentoOriginal.funcionarioId,
      tipo: apontamentoOriginal.tipo,
      ...dadosPorTipo,
      fonteApontamento: 'MANUAL_OPERADOR',
      observacao: dados.observacao,
      fotoUrl: dados.fotoUrl,
      apontamentoOrigemId: apontamentoOriginal.id,
      motivoRetroativo: dados.motivo,
      autorizadoPorUsuarioId: usuarioAutorizador.id,
    },
  })

  // Requirement 11.4, Property 2 — recalcula os totais da etapa somando
  // TODOS os ApontamentoEtapa (originais + retroativos), nunca apenas
  // incrementando.
  await recalcularTotaisEtapa(apontamentoOriginal.etapaOrdemProducaoId)

  return apontamentoRetroativo
}

/**
 * Schema de validação do payload de `registrarPendenciaMaterial`
 * (Requirement 12.1) — `descricao` é opcional (texto livre do Operador
 * sobre o material em falta), seguindo o mesmo padrão de validação via
 * Zod já usado no restante deste arquivo, rodando ANTES de qualquer
 * consulta/persistência no banco.
 */
export const registrarPendenciaMaterialSchema = z.object({
  descricao: z.string().optional(),
})

export type RegistrarPendenciaMaterialInput = z.infer<typeof registrarPendenciaMaterialSchema>

/**
 * Registra falta de material identificada durante a execução de uma Etapa
 * `EM_ANDAMENTO`, sem exigir navegação para outra tela (Requirement 12.1):
 * cria uma `PendenciaMaterial` vinculada à Etapa e, na mesma chamada, um
 * `ApontamentoEtapa` tipo `PARADA` com `motivoParada='FALTA_MATERIAL'`
 * (Requirement 12.3), vinculando os dois registros entre si.
 *
 * Fluxo:
 * 1. Resolve a etapa via `buscarEtapaDoTerminal` (isolamento
 *    multi-tenant — Requirement 5.2, 17.1, 17.2).
 * 2. Exige que a etapa esteja `EM_ANDAMENTO` — é justamente o caso que o
 *    painel interno não resolve hoje: falta de material percebida DEPOIS
 *    de a etapa já estar em produção, não antes de iniciá-la.
 * 3. Delega para `etapaOperacionalService.pausarEtapa()` (nunca
 *    duplicando a transição de status da etapa para `PAUSADA` nem a
 *    criação do `ApontamentoEtapa` tipo `PARADA` — mesmo princípio já
 *    aplicado em `pausarEtapaComMotivo`), com `motivoParada='FALTA_MATERIAL'`
 *    e `paradaPlanejada=false` (falta de material percebida em produção é,
 *    por definição, não planejada).
 * 4. Cria a `PendenciaMaterial` com `apontamentoParadaId` apontando para o
 *    `ApontamentoEtapa` tipo `PARADA` recém-criado (Requirement 12.3) e
 *    `status='PENDENTE'` — dado que permite a consulta futura por PCP/
 *    almoxarifado (Requirement 12.2), fora do escopo desta função (não é
 *    responsabilidade do Checkout expor uma nova rota de listagem para
 *    esses perfis nesta tarefa).
 *
 * O `empresaId` gravado na `PendenciaMaterial` é sempre o da Ordem de
 * Produção real (`etapa.ordemProducao.empresaId`, resolvida via
 * `buscarEtapaDoTerminal`), nunca o `empresaId` do usuário que autenticou
 * a Sessão_Terminal (Requirement 17.3).
 */
export async function registrarPendenciaMaterial(
  etapaId: string,
  checkoutUser: { empresaId: string; centroProducaoId: string },
  dadosRecebidos?: RegistrarPendenciaMaterialInput,
) {
  const resultado = registrarPendenciaMaterialSchema.safeParse(dadosRecebidos ?? {})
  if (!resultado.success) {
    throw new CheckoutError(400, resultado.error.errors[0]?.message ?? 'Dados inválidos para a pendência de material')
  }
  const dados = resultado.data

  const etapa = await buscarEtapaDoTerminal(etapaId, checkoutUser)

  if (etapa.status !== 'EM_ANDAMENTO') {
    throw new CheckoutError(400, `Pendência de material só pode ser registrada com a etapa em andamento. Status atual: ${etapa.status}`)
  }

  // Requirement 12.3 — cria o ApontamentoEtapa tipo PARADA delegando para
  // o service compartilhado (pausa a etapa e grava o apontamento numa
  // única operação, nunca duplicada aqui).
  const paradaResultado = await pausarEtapaOperacional(etapaId, checkoutUser.empresaId, {
    motivoParada: 'FALTA_MATERIAL',
    observacao: dados.descricao,
    paradaPlanejada: false,
  })

  // Requirement 12.1, 12.2 — cria a PendenciaMaterial vinculando o
  // apontamento de parada recém-criado, com empresaId sempre da Ordem de
  // Produção real (Requirement 17.3).
  return prisma.pendenciaMaterial.create({
    data: {
      empresaId: etapa.ordemProducao.empresaId,
      etapaOrdemProducaoId: etapaId,
      apontamentoParadaId: paradaResultado.apontamento.id,
      descricao: dados.descricao,
      status: 'PENDENTE',
    },
  })
}

/**
 * Resolve uma `PendenciaMaterial` restrita à empresa do Token_Checkout da
 * requisição — mesmo padrão de isolamento multi-tenant de
 * `buscarEtapaDoTerminal` (Requirement 17.1, 17.2), mas sem o filtro
 * adicional de `centroProducaoId`: uma `PendenciaMaterial` pode ser
 * resolvida por um Supervisor a partir de qualquer Terminal da mesma
 * empresa, não apenas do Terminal que a originou (a etapa já foi
 * validada por `centroProducaoId` no momento da criação da pendência —
 * ver `registrarPendenciaMaterial`).
 *
 * Lança `CheckoutError` 404 tanto quando a pendência não existe quanto
 * quando existe mas pertence a outra empresa — mesma resposta idêntica
 * nos dois casos, seguindo o padrão já usado em
 * `registrarApontamentoRetroativo` para o apontamento original
 * (Property 5 do design.md).
 */
async function buscarPendenciaMaterialDaEmpresa(pendenciaId: string, empresaId: string) {
  const pendencia = await prisma.pendenciaMaterial.findFirst({
    where: { id: pendenciaId, empresaId },
  })

  if (!pendencia) {
    throw new CheckoutError(404, 'Pendência de material não encontrada')
  }

  return pendencia
}

/**
 * Resolve uma `PendenciaMaterial`, marcando `resolvidaEm`/
 * `resolvidaPorUsuarioId` e transicionando `status` para `RESOLVIDA`
 * (Requirement 12.4).
 *
 * "Permitir a retomada normal da etapa" (Requirement 12.4) não significa
 * reabrir a Etapa aqui — a Etapa permanece `PAUSADA` e a retomada é feita
 * pela rota normal de iniciar/retomar etapa já existente
 * (`etapaOperacionalService.iniciarEtapa()`); esta função apenas
 * desbloqueia a pendência em si, que é o dado consultado por PCP/
 * almoxarifado (Requirement 12.2).
 *
 * `resolvidaPorUsuarioId` é gravado com
 * `checkoutUser.autenticadaPorUsuarioId` (o Usuario que autenticou a
 * Sessão_Terminal do Token_Checkout da requisição) — mesmo padrão já
 * usado em `concluirEtapaComBloqueio` para identificar quem autenticou a
 * sessão do Terminal quando não há autorização explícita de Supervisor
 * envolvida na operação.
 */
export async function resolverPendenciaMaterial(
  pendenciaId: string,
  checkoutUser: { empresaId: string; autenticadaPorUsuarioId: string },
) {
  const pendencia = await buscarPendenciaMaterialDaEmpresa(pendenciaId, checkoutUser.empresaId)

  if (pendencia.status === 'RESOLVIDA') {
    throw new CheckoutError(400, 'Pendência de material já está resolvida')
  }

  return prisma.pendenciaMaterial.update({
    where: { id: pendencia.id },
    data: {
      status: 'RESOLVIDA',
      resolvidaEm: new Date(),
      resolvidaPorUsuarioId: checkoutUser.autenticadaPorUsuarioId,
    },
  })
}

export interface EtapaEmAlertaParadaProlongada {
  etapaId: string
  ordemProducaoNumero: number
  sequencia: number
  centroProducaoId: string | null
  minutosParada: number
  motivoParada: string | null
}

/**
 * Limite, em minutos, a partir do qual uma Etapa `PAUSADA` passa a ser
 * sinalizada como alerta de parada prolongada (Requirement 13.1).
 */
const LIMITE_MINUTOS_ALERTA_PARADA_PROLONGADA = 60

/**
 * Lista as Etapas em alerta de parada prolongada para a visão de
 * Supervisor (Requirement 13.1, 13.2, 13.3).
 *
 * Diferente das demais funções deste service, que operam sobre uma única
 * Etapa resolvida via `buscarEtapaDoTerminal` (Requirement 5.2), esta é
 * uma consulta agregada sobre MÚLTIPLAS Etapas: filtra apenas por
 * `ordemProducao.empresaId` (empresa do Token_Checkout), sem restringir
 * por `centroProducaoId` da Sessão_Terminal — um Supervisor pode
 * monitorar Etapas de qualquer Centro_Producao da empresa, não somente do
 * Centro do Terminal em que autenticou (design.md, seção "Isolamento
 * Multi-tenant": o filtro por centro é uma regra do Operador no Terminal,
 * não uma regra geral de toda consulta do Checkout).
 *
 * Fluxo:
 * 1. Busca todas as `EtapaOrdemProducao` com `status='PAUSADA'` da
 *    empresa.
 * 2. Busca, numa única query, todos os `ApontamentoEtapa` tipo `PARADA`
 *    dessas Etapas ordenados por `dataHora` desc — como a ordenação já é
 *    decrescente, a primeira ocorrência encontrada para cada
 *    `etapaOrdemProducaoId` na iteração é o último apontamento de parada
 *    daquela Etapa (evita N+1 queries, uma por Etapa).
 * 3. Calcula `minutosParada` (diferença entre `new Date()` e a
 *    `dataHora` do último apontamento tipo `PARADA`) e mantém no
 *    resultado apenas as Etapas com `minutosParada` maior que
 *    `LIMITE_MINUTOS_ALERTA_PARADA_PROLONGADA` (Requirement 13.1).
 *
 * Requirement 13.3 — o alerta deixa de ser retornado quando a Etapa é
 * retomada (`status` volta a `EM_ANDAMENTO`) ou concluída (`status` passa
 * a `CONCLUIDA`): não há lógica extra além do filtro `status='PAUSADA'`
 * do passo 1, já que nesses dois casos a Etapa simplesmente deixa de
 * aparecer no resultado da busca inicial.
 *
 * Retorna os dados úteis para exibição no painel de Supervisor
 * (`GET /checkout/supervisor/alertas`, task 12.7, futura): `etapaId`,
 * `ordemProducaoNumero`, `sequencia`, `centroProducaoId`, `minutosParada`
 * (calculado) e `motivoParada` (do último `ApontamentoEtapa` tipo
 * `PARADA`).
 */
export async function listarEtapasEmAlertaParadaProlongada(
  checkoutUser: { empresaId: string },
): Promise<EtapaEmAlertaParadaProlongada[]> {
  const etapasPausadas = await prisma.etapaOrdemProducao.findMany({
    where: {
      status: 'PAUSADA',
      ordemProducao: { empresaId: checkoutUser.empresaId },
    },
    select: {
      id: true,
      sequencia: true,
      centroProducaoId: true,
      ordemProducao: { select: { numero: true } },
    },
  })

  if (etapasPausadas.length === 0) {
    return []
  }

  const etapaIds = etapasPausadas.map((etapa) => etapa.id)

  const apontamentosParada = await prisma.apontamentoEtapa.findMany({
    where: {
      etapaOrdemProducaoId: { in: etapaIds },
      tipo: 'PARADA',
    },
    orderBy: { dataHora: 'desc' },
    select: { etapaOrdemProducaoId: true, dataHora: true, motivoParada: true },
  })

  // A query acima já vem ordenada por dataHora desc — a primeira
  // ocorrência de cada etapaOrdemProducaoId encontrada na iteração é o
  // último ApontamentoEtapa tipo PARADA daquela etapa.
  const ultimaParadaPorEtapaId = new Map<string, { dataHora: Date; motivoParada: string | null }>()
  for (const apontamento of apontamentosParada) {
    if (!ultimaParadaPorEtapaId.has(apontamento.etapaOrdemProducaoId)) {
      ultimaParadaPorEtapaId.set(apontamento.etapaOrdemProducaoId, {
        dataHora: apontamento.dataHora,
        motivoParada: apontamento.motivoParada,
      })
    }
  }

  const agora = new Date()
  const alertas: EtapaEmAlertaParadaProlongada[] = []

  for (const etapa of etapasPausadas) {
    const ultimaParada = ultimaParadaPorEtapaId.get(etapa.id)
    if (!ultimaParada) {
      // Etapa PAUSADA sem nenhum ApontamentoEtapa tipo PARADA registrado
      // (situação anômala/dado legado) — sem horário de referência, não
      // há como calcular minutosParada, então não entra no alerta.
      continue
    }

    const minutosParada = Math.floor((agora.getTime() - ultimaParada.dataHora.getTime()) / 60000)

    if (minutosParada > LIMITE_MINUTOS_ALERTA_PARADA_PROLONGADA) {
      alertas.push({
        etapaId: etapa.id,
        ordemProducaoNumero: etapa.ordemProducao.numero,
        sequencia: etapa.sequencia,
        centroProducaoId: etapa.centroProducaoId,
        minutosParada,
        motivoParada: ultimaParada.motivoParada,
      })
    }
  }

  return alertas
}

export interface ApontamentoHistoricoResultado {
  id: string
  tipo: string
  quantidade: number
  motivo: string | null
  funcionarioId: string | null
  operadorNome: string | null
  dataHora: Date
  observacao: string | null
  fotoUrl: string | null
  ehRetroativo: boolean
  apontamentoOrigemId: string | null
  motivoRetroativo: string | null
  autorizadoPorUsuarioId: string | null
}

/**
 * Lista o histórico cronológico de `ApontamentoEtapa` de uma Etapa, com
 * Operador, tipo, quantidade, motivo, horário e o vínculo original/
 * retroativo distinguível (Requirement 16.1, 16.3).
 *
 * Decisão de design — filtro por empresa, não por Centro_Producao do
 * Terminal (Requirement 16.4): "Checkout SHALL permitir a um Supervisor
 * consultar o histórico de apontamentos de qualquer Etapa da empresa
 * vinculada à sua Sessão_Terminal ou ao seu Usuario" exige que o filtro
 * seja por EMPRESA, não pelo `centroProducaoId` do Terminal em que a
 * Sessão_Terminal está autenticada no momento — um Supervisor deve
 * conseguir consultar o histórico de uma Etapa de qualquer centro da
 * empresa, não somente do centro do Terminal atual. Por isso esta função
 * NÃO usa `buscarEtapaDoTerminal` (que filtra também por
 * `centroProducaoId` da sessão, adequado para o Operador no chão de
 * fábrica) — segue o mesmo padrão já adotado por
 * `listarEtapasEmAlertaParadaProlongada` (task 10.22), que também é uma
 * consulta de visão de Supervisor filtrada apenas por
 * `ordemProducao.empresaId`.
 *
 * Continua isolado por empresa (Requirement 17.1, 17.2): uma Etapa que
 * não pertença à empresa do `Token_Checkout` resulta no mesmo erro 404
 * de "Etapa não encontrada", sem revelar sua existência em outra empresa.
 *
 * Fluxo:
 * 1. Resolve a Etapa filtrando apenas por `ordemProducao.empresaId`.
 * 2. Busca todos os `ApontamentoEtapa` da Etapa ordenados por `dataHora`
 *    ascendente (ordem cronológica, do mais antigo para o mais recente —
 *    Requirement 16.1).
 * 3. Enriquece cada apontamento com o nome do `Funcionario` autor (quando
 *    houver `funcionarioId` — pode ser nulo para `Fonte_Apontamento
 *    INTEGRACAO_MAQUINA`, Requirement 15.4), reaproveitando o mesmo padrão
 *    de busca em lote + `Map` já usado em `listarOperadoresAtivos` (não
 *    há relação Prisma declarada entre `ApontamentoEtapa` e
 *    `Funcionario`).
 * 4. Resolve `quantidade`/`motivo` de acordo com o `tipo` do apontamento:
 *    `PRODUCAO` usa `quantidadeProduzida`; `PERDA` usa `quantidadePerda` +
 *    `motivoPerda`; `RETRABALHO` usa `quantidadeRetrabalho`; `PARADA` usa
 *    `motivoParada` (sem quantidade aplicável); `SETUP`/`RETOMADA` não têm
 *    quantidade nem motivo aplicáveis (permanecem `0`/`null`).
 * 5. Calcula `ehRetroativo` a partir de `apontamentoOrigemId !== null`
 *    (Requirement 11.5) e inclui `apontamentoOrigemId`,
 *    `motivoRetroativo` e `autorizadoPorUsuarioId` já persistidos pelo
 *    registro (task 10.15), tornando o vínculo original/retroativo
 *    distinguível no retorno (Requirement 16.3).
 */
export async function listarHistoricoApontamentos(
  etapaId: string,
  checkoutUser: { empresaId: string },
): Promise<ApontamentoHistoricoResultado[]> {
  const etapa = await prisma.etapaOrdemProducao.findFirst({
    where: { id: etapaId, ordemProducao: { empresaId: checkoutUser.empresaId } },
    select: { id: true },
  })

  if (!etapa) {
    throw new CheckoutError(404, 'Etapa não encontrada')
  }

  const apontamentos = await prisma.apontamentoEtapa.findMany({
    where: { etapaOrdemProducaoId: etapaId, empresaId: checkoutUser.empresaId },
    orderBy: { dataHora: 'asc' },
  })

  if (apontamentos.length === 0) {
    return []
  }

  const funcionarioIds = [
    ...new Set(apontamentos.map((a) => a.funcionarioId).filter((id): id is string => id !== null)),
  ]
  const funcionarios =
    funcionarioIds.length > 0
      ? await prisma.funcionario.findMany({
          where: { id: { in: funcionarioIds } },
          select: { id: true, nome: true },
        })
      : []
  const nomePorFuncionarioId = new Map(funcionarios.map((f) => [f.id, f.nome]))

  return apontamentos.map((apontamento) => {
    let quantidade = 0
    let motivo: string | null = null

    if (apontamento.tipo === 'PRODUCAO') {
      quantidade = Number(apontamento.quantidadeProduzida)
    } else if (apontamento.tipo === 'PERDA') {
      quantidade = Number(apontamento.quantidadePerda)
      motivo = apontamento.motivoPerda
    } else if (apontamento.tipo === 'RETRABALHO') {
      quantidade = Number(apontamento.quantidadeRetrabalho)
    } else if (apontamento.tipo === 'PARADA') {
      motivo = apontamento.motivoParada
    }
    // SETUP e RETOMADA não têm quantidade nem motivo aplicáveis —
    // permanecem 0/null.

    return {
      id: apontamento.id,
      tipo: apontamento.tipo,
      quantidade,
      motivo,
      funcionarioId: apontamento.funcionarioId,
      operadorNome: apontamento.funcionarioId
        ? nomePorFuncionarioId.get(apontamento.funcionarioId) ?? 'Desconhecido'
        : null,
      dataHora: apontamento.dataHora,
      observacao: apontamento.observacao,
      fotoUrl: apontamento.fotoUrl,
      ehRetroativo: apontamento.apontamentoOrigemId !== null,
      apontamentoOrigemId: apontamento.apontamentoOrigemId,
      motivoRetroativo: apontamento.motivoRetroativo,
      autorizadoPorUsuarioId: apontamento.autorizadoPorUsuarioId,
    }
  })
}
