/**
 * Serviço de ingestão de OPs do Calcgraf (agente desktop → Vizor).
 *
 * Regras de negócio da Tarefa 4 do spec `importador-op-calcgraf`. Para cada OP
 * do payload recebido do agente, numa transação por OP:
 *
 *  1. Recalcula o hash no servidor (`calcularHashOp`) — mais seguro que confiar
 *     no hash enviado pelo agente. O `op.hashOrigem` (se vier) é usado apenas
 *     como referência de diagnóstico/log, nunca como fonte de verdade.
 *  2. Busca a OP de destino por
 *     `{ empresaId, origemImportacao: 'AGENTE_CALCGRAF', referenciaExterna }`.
 *  3. Monta o `OpDestinoResumo` (existe / hashSalvo / statusFinalizado /
 *     temProducao) consultando contadores baratos.
 *  4. Classifica via `classificarIngestao` (função pura).
 *  5. Age conforme o resultado:
 *     - `'criada'`    → cria `OrdemProducao` nova (numero interno sequencial,
 *                       tags `[Cliente]`/`[Produto]` em observacoes, status
 *                       inicial `PLANEJADA` — igual ao importador de PDF).
 *     - `'atualizada'`→ atualiza cabeçalho/itens/etapas/quantidade,
 *                       preservando vínculos manuais por descrição.
 *     - `'pendente'`  → NÃO altera a OP; cria/atualiza `AlteracaoOpPendente`.
 *     - `'ignorada'`  → nada muda.
 *
 * Isolamento multi-tenant (steering ATENCAO-pontos-verificar.md): o `empresaId`
 * usado é SEMPRE o recebido (dono da API key do agente) — nunca `prismaScoped`
 * sozinho. Toda query/gravação filtra/grava explicitamente por esse `empresaId`.
 *
 * MVP: foca na OP (cabeçalho + itens/estrutura básicos + etapas quando vierem).
 * Cálculos gráficos ficam para fase futura. Se o DTO não trouxer itens/etapas,
 * criar a OP só com cabeçalho + tags já é aceitável (ela precisa aparecer
 * liberável no menu Ordens de Produção).
 */

import { Prisma } from '@prisma/client'
import { prisma } from '../../../lib/prisma'
import {
  OpOrigemDTO,
  OpDestinoResumo,
  ResultadoIngestao,
  calcularHashOp,
  classificarIngestao,
} from './ingestao-op-calcgraf.pure'

/** Origem de importação gravada nas OPs criadas por este agente. */
const ORIGEM_CALCGRAF = 'AGENTE_CALCGRAF'

/**
 * Status inicial de uma OP criada pelo agente. Mesmo status inicial que o
 * importador de PDF usa (`PLANEJADA`), de forma que a OP já apareça liberável
 * no menu Ordens de Produção seguindo o fluxo normal
 * (PLANEJADA → PROGRAMADA → LIBERADA → ...).
 */
const STATUS_INICIAL = 'PLANEJADA'

/** Status terminais da OP (protegidos: nunca sobrescritos automaticamente). */
const STATUS_FINALIZADOS = ['CONCLUIDA', 'CANCELADA']

/**
 * Status de etapa que caracterizam produção já em curso/concluída — bloqueiam
 * a sobrescrita automática (a mudança vira `AlteracaoOpPendente`).
 */
const STATUS_ETAPA_PRODUCAO = ['EM_ANDAMENTO', 'CONCLUIDA']

/**
 * `usuarioId` registrado nos `LogOrdemProducao` gerados pelo agente. O campo é
 * obrigatório no schema e o agente não é um usuário; usamos um identificador
 * de sistema estável para distinguir a origem na auditoria.
 */
const USUARIO_AGENTE = 'AGENTE_CALCGRAF'

/** Resultado da ingestão de UMA OP, devolvido por OP ao chamador/rota. */
export interface ResultadoIngestaoOp {
  /** Número da OP no Calcgraf (identidade entre os dois sistemas). */
  numero: number
  /** Classificação do que aconteceu com a OP. */
  resultado: ResultadoIngestao | 'erro'
  /** Mensagem opcional (motivo de erro, detalhe de pendência, etc.). */
  mensagem?: string
}

// ---------------------------------------------------------------------------
// Helpers de montagem de dados (reuso do padrão do importador de PDF)
// ---------------------------------------------------------------------------

/**
 * Monta o texto de `observacoes` com as tags estruturadas `[Cliente]` /
 * `[Produto]` (mesmo padrão do importador de PDF — seção 1.6 do steering
 * pcp-modulo). Quando não há vínculo formal de cliente/produto, essas tags são
 * a fonte do dado real exibido na tela. Também inclui tags de contexto úteis
 * (tiragem, data de emissão) quando disponíveis.
 */
function montarObservacoes(dto: OpOrigemDTO): string | undefined {
  const linhas: string[] = []
  if (dto.clienteNome && dto.clienteNome.trim()) {
    linhas.push(`[Cliente] ${dto.clienteNome.trim()}`)
  }
  // Produto: prioriza o nome; cai para a descrição da OP como texto do produto.
  const produto = (dto.produtoNome && dto.produtoNome.trim()) || (dto.descricao && dto.descricao.trim())
  if (produto) {
    linhas.push(`[Produto] ${produto}`)
  }
  if (dto.tiragem != null && Number.isFinite(dto.tiragem)) {
    linhas.push(`[Tiragem] ${dto.tiragem}`)
  }
  return linhas.length > 0 ? linhas.join('\n') : undefined
}

/** Resolve a quantidade da OP a partir do DTO (quantidade → tiragem → 0). */
function resolverQuantidade(dto: OpOrigemDTO): number {
  if (dto.quantidade != null && Number.isFinite(dto.quantidade) && dto.quantidade > 0) {
    return dto.quantidade
  }
  if (dto.tiragem != null && Number.isFinite(dto.tiragem) && dto.tiragem > 0) {
    return dto.tiragem
  }
  return 0
}

/** Converte uma string de data (ISO) para Date, ou undefined se inválida. */
function parseData(valor?: string): Date | undefined {
  if (!valor) return undefined
  const d = new Date(valor)
  return Number.isNaN(d.getTime()) ? undefined : d
}

/** Mapeia o tipo de material a partir da descrição/dado do item (best-effort). */
function tipoMaterialDeDescricao(descricao?: string): string | undefined {
  if (!descricao) return undefined
  const d = descricao.toLowerCase()
  if (/papel|cart[aã]o|bobina|couch|kraft/.test(d)) return 'PAPEL'
  if (/tinta|pantone|verniz/.test(d)) return /verniz/.test(d) ? 'VERNIZ' : 'TINTA'
  if (/cola/.test(d)) return 'COLA'
  if (/faca|matriz/.test(d)) return 'FACA'
  return 'OUTRO'
}

type PrismaTx = Prisma.TransactionClient

/**
 * Cria os `ItemOrdemProducao` a partir dos itens do DTO (quando houver). MVP:
 * grava descrição/quantidade/unidade/tipo; vínculo formal de produto fica para
 * fase futura (sem de-para por enquanto).
 */
async function criarItens(tx: PrismaTx, ordemProducaoId: string, empresaId: string, dto: OpOrigemDTO) {
  const itens = dto.itens ?? []
  for (const item of itens) {
    const descricao = (item.descricao && item.descricao.trim()) || (item.codItemEstoque && item.codItemEstoque.trim()) || 'Item sem descrição'
    await tx.itemOrdemProducao.create({
      data: {
        ordemProducaoId,
        empresaId,
        descricaoProduto: descricao.substring(0, 200),
        descricaoExterna: (item.descricao ?? item.codItemEstoque ?? undefined)?.substring(0, 300),
        quantidade: item.quantidade != null && Number.isFinite(item.quantidade) ? item.quantidade : 0,
        unidadeMedida: (item.unidadeMedida && item.unidadeMedida.trim()) || 'UN',
        tipoMaterial: tipoMaterialDeDescricao(item.descricao),
        status: 'PENDENTE',
      },
    })
  }
}

/**
 * Cria as `EtapaOrdemProducao` a partir das etapas do DTO (quando houver). MVP:
 * grava sequência/descrição/status PENDENTE, sem resolver centro de produção
 * (a resolução/criação de centro por nome, como no importador de PDF, fica para
 * uma evolução — a etapa sem centro ainda documenta o roteiro). O operador pode
 * atribuir a máquina depois no painel.
 */
async function criarEtapas(tx: PrismaTx, ordemProducaoId: string, dto: OpOrigemDTO) {
  const etapas = dto.etapas ?? []
  let seq = 1
  for (const etapa of etapas) {
    const descricao = (etapa.descricao && etapa.descricao.trim()) || (etapa.centro && etapa.centro.trim()) || `Etapa ${seq}`
    await tx.etapaOrdemProducao.create({
      data: {
        ordemProducaoId,
        sequencia: etapa.sequencia != null && Number.isFinite(etapa.sequencia) ? etapa.sequencia : seq,
        descricao: descricao.substring(0, 200),
        status: 'PENDENTE',
      },
    })
    seq++
  }
}

// ---------------------------------------------------------------------------
// Processamento por OP
// ---------------------------------------------------------------------------

/**
 * Processa UMA OP do payload dentro de uma transação própria. Retorna o
 * resultado por OP. Erros são capturados pelo chamador (`ingerirOpsCalcgraf`)
 * para isolar a falha de uma OP das demais (Property 7 / Req 8.4).
 */
async function processarOp(empresaId: string, dto: OpOrigemDTO): Promise<ResultadoIngestaoOp> {
  // 1. Recalcula o hash no servidor (fonte de verdade). O dto pode carregar um
  //    `hashOrigem` do agente, mas não confiamos nele para a idempotência.
  const hashRecebido = calcularHashOp(dto)
  const referenciaExterna = String(dto.numero)

  // 2. Busca a OP de destino (casada por referenciaExterna + origem).
  const destino = await prisma.ordemProducao.findFirst({
    where: { empresaId, origemImportacao: ORIGEM_CALCGRAF, referenciaExterna },
    select: { id: true, status: true, hashImportacaoOrigem: true },
  })

  // 3. Monta o OpDestinoResumo (consultas baratas para detectar produção).
  let temProducao = false
  if (destino) {
    const [apontEtapa, apontProd, etapasEmProducao] = await Promise.all([
      prisma.apontamentoEtapa.count({ where: { etapaOrdemProducao: { ordemProducaoId: destino.id } } }),
      prisma.apontamentoProducao.count({ where: { ordemProducaoId: destino.id } }),
      prisma.etapaOrdemProducao.count({ where: { ordemProducaoId: destino.id, status: { in: STATUS_ETAPA_PRODUCAO } } }),
    ])
    temProducao = apontEtapa + apontProd + etapasEmProducao > 0
  }

  const resumo: OpDestinoResumo = {
    existe: !!destino,
    hashSalvo: destino?.hashImportacaoOrigem ?? null,
    statusFinalizado: destino ? STATUS_FINALIZADOS.includes(destino.status) : false,
    temProducao,
  }

  // 4. Classifica (função pura).
  const resultado = classificarIngestao(resumo, hashRecebido)

  // 5. Age conforme o resultado.
  switch (resultado) {
    case 'ignorada':
      return { numero: dto.numero, resultado: 'ignorada' }

    case 'criada':
      await prisma.$transaction(async (tx) => {
        await criarOp(tx, empresaId, dto, hashRecebido)
      })
      return { numero: dto.numero, resultado: 'criada' }

    case 'atualizada':
      await prisma.$transaction(async (tx) => {
        await atualizarOp(tx, empresaId, destino!.id, destino!.status, dto, hashRecebido)
      })
      return { numero: dto.numero, resultado: 'atualizada' }

    case 'pendente':
      await prisma.$transaction(async (tx) => {
        await registrarPendente(tx, empresaId, destino!.id, dto, hashRecebido)
      })
      return {
        numero: dto.numero,
        resultado: 'pendente',
        mensagem: 'OP já possui produção; alteração registrada para revisão manual.',
      }

    default:
      return { numero: dto.numero, resultado: 'erro', mensagem: 'Resultado de classificação desconhecido.' }
  }
}

/** Cria uma `OrdemProducao` nova a partir do DTO (resultado `criada`). */
async function criarOp(tx: PrismaTx, empresaId: string, dto: OpOrigemDTO, hashRecebido: string) {
  // numero interno = SEMPRE sequencial próprio do ERP (nunca o número do
  // Calcgraf; ele vai só em referenciaExterna). Mesma regra do importador de
  // PDF — evita colisão entre os dois espaços de numeração.
  const ultimaOp = await tx.ordemProducao.findFirst({
    where: { empresaId },
    orderBy: { numero: 'desc' },
    select: { numero: true },
  })
  const proximoNumero = (ultimaOp?.numero ?? 0) + 1

  const dataEntrega = parseData(dto.dataEntrega)

  const op = await tx.ordemProducao.create({
    data: {
      numero: proximoNumero,
      empresaId,
      quantidade: resolverQuantidade(dto),
      unidadeMedida: 'UN',
      status: STATUS_INICIAL,
      prioridade: 'NORMAL',
      dataEmissao: parseData(dto.dataEmissao) ?? new Date(),
      dataEntregaPrevista: dataEntrega,
      dataEntregaOriginal: dataEntrega,
      observacoes: montarObservacoes(dto),
      referenciaExterna: String(dto.numero),
      origemImportacao: ORIGEM_CALCGRAF,
      hashImportacaoOrigem: hashRecebido,
    },
  })

  await criarItens(tx, op.id, empresaId, dto)
  await criarEtapas(tx, op.id, dto)

  await tx.logOrdemProducao.create({
    data: {
      ordemProducaoId: op.id,
      statusAnterior: '',
      statusNovo: op.status,
      usuarioId: USUARIO_AGENTE,
      observacao: `OP criada via agente Calcgraf. Referência externa: ${dto.numero}`,
    },
  })
}

/**
 * Atualiza uma `OrdemProducao` existente sem produção (resultado `atualizada`).
 * Substitui cabeçalho/itens/etapas/quantidade com os dados do Calcgraf,
 * preservando o status atual (não força regressão — Req 3.3) e os vínculos
 * manuais de produto por descrição (espírito da reextração de PDF — Req 5.3).
 */
async function atualizarOp(
  tx: PrismaTx,
  empresaId: string,
  ordemProducaoId: string,
  statusAtual: string,
  dto: OpOrigemDTO,
  hashRecebido: string,
) {
  const dataEntrega = parseData(dto.dataEntrega)

  // Preserva vínculos manuais de produto já feitos por descrição (de-para),
  // no mesmo espírito da reextração de PDF.
  const itensExistentes = await tx.itemOrdemProducao.findMany({
    where: { ordemProducaoId },
    select: { descricaoProduto: true, produtoComponenteId: true },
  })
  const vinculoPorDescricao = new Map<string, string>()
  for (const it of itensExistentes) {
    if (it.produtoComponenteId) {
      vinculoPorDescricao.set(it.descricaoProduto.trim().toLowerCase(), it.produtoComponenteId)
    }
  }

  await tx.ordemProducao.update({
    where: { id: ordemProducaoId },
    data: {
      quantidade: resolverQuantidade(dto),
      dataEntregaPrevista: dataEntrega ?? undefined,
      observacoes: montarObservacoes(dto),
      hashImportacaoOrigem: hashRecebido,
      // status NÃO é alterado — preserva o roteiro atual.
    },
  })

  // Substituição total de itens/etapas a partir do novo conteúdo (a OP não tem
  // produção; essa é a condição que permite a sobrescrita automática).
  await tx.itemOrdemProducao.deleteMany({ where: { ordemProducaoId } })
  await tx.etapaOrdemProducao.deleteMany({ where: { ordemProducaoId } })

  // Recria itens preservando vínculo de produto por descrição quando possível.
  const itens = dto.itens ?? []
  for (const item of itens) {
    const descricao = (item.descricao && item.descricao.trim()) || (item.codItemEstoque && item.codItemEstoque.trim()) || 'Item sem descrição'
    const vinculo = vinculoPorDescricao.get(descricao.trim().toLowerCase())
    await tx.itemOrdemProducao.create({
      data: {
        ordemProducaoId,
        empresaId,
        produtoComponenteId: vinculo ?? undefined,
        descricaoProduto: descricao.substring(0, 200),
        descricaoExterna: (item.descricao ?? item.codItemEstoque ?? undefined)?.substring(0, 300),
        quantidade: item.quantidade != null && Number.isFinite(item.quantidade) ? item.quantidade : 0,
        unidadeMedida: (item.unidadeMedida && item.unidadeMedida.trim()) || 'UN',
        tipoMaterial: tipoMaterialDeDescricao(item.descricao),
        status: 'PENDENTE',
      },
    })
  }

  await criarEtapas(tx, ordemProducaoId, dto)

  await tx.logOrdemProducao.create({
    data: {
      ordemProducaoId,
      statusAnterior: statusAtual,
      statusNovo: statusAtual,
      usuarioId: USUARIO_AGENTE,
      observacao: `OP atualizada via agente Calcgraf (status ${statusAtual} preservado). Referência externa: ${dto.numero}`,
    },
  })
}

/**
 * Registra uma `AlteracaoOpPendente` quando a OP já tem produção (resultado
 * `pendente`). NÃO altera a OP. Faz upsert por `(ordemProducaoId, status
 * PENDENTE)`: se já há uma pendência aberta para a OP, atualiza-a com o novo
 * snapshot/hash; senão cria uma nova. O `payloadJson` guarda o DTO recebido
 * para que a revisão manual possa aplicá-lo depois.
 */
async function registrarPendente(
  tx: PrismaTx,
  empresaId: string,
  ordemProducaoId: string,
  dto: OpOrigemDTO,
  hashRecebido: string,
) {
  const pendenteExistente = await tx.alteracaoOpPendente.findFirst({
    where: { empresaId, ordemProducaoId, status: 'PENDENTE' },
    select: { id: true },
  })

  const dados = {
    empresaId,
    ordemProducaoId,
    numeroOrigem: String(dto.numero),
    hashOrigem: hashRecebido,
    payloadJson: dto as unknown as Prisma.InputJsonValue,
    status: 'PENDENTE',
  }

  if (pendenteExistente) {
    await tx.alteracaoOpPendente.update({
      where: { id: pendenteExistente.id },
      data: { numeroOrigem: dados.numeroOrigem, hashOrigem: dados.hashOrigem, payloadJson: dados.payloadJson },
    })
  } else {
    await tx.alteracaoOpPendente.create({ data: dados })
  }
}

// ---------------------------------------------------------------------------
// Função principal
// ---------------------------------------------------------------------------

/**
 * Ingere a lista de OPs recebida do agente do Calcgraf, criando/atualizando
 * `OrdemProducao` no Vizor conforme as regras de negócio do spec.
 *
 * @param empresaId  A empresa dona da API key do agente (`request.agente.empresaId`).
 *                   SEMPRE o escopo multi-tenant — nunca outra empresa.
 * @param ops        Lista de OPs de origem (payload do agente).
 * @returns          Um resultado por OP (`numero`, `resultado`, `mensagem?`).
 *
 * Cada OP é processada em sua própria transação; uma OP malformada/erro NÃO
 * impede o processamento das demais (erro isolado por OP — Property 7 / Req 8.4).
 */
export async function ingerirOpsCalcgraf(
  empresaId: string,
  ops: OpOrigemDTO[],
): Promise<ResultadoIngestaoOp[]> {
  const resultados: ResultadoIngestaoOp[] = []

  for (const dto of ops) {
    try {
      const r = await processarOp(empresaId, dto)
      resultados.push(r)
    } catch (err) {
      const mensagem = err instanceof Error ? err.message : 'Erro desconhecido ao processar a OP.'
      resultados.push({ numero: dto?.numero, resultado: 'erro', mensagem })
    }
  }

  return resultados
}

// ---------------------------------------------------------------------------
// Aplicação de alteração pendente (revisão manual — Tarefa 6)
// ---------------------------------------------------------------------------

/** Erro de domínio da aplicação de pendência (mapeado para HTTP pela rota). */
export class AlteracaoPendenteError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message)
    this.name = 'AlteracaoPendenteError'
  }
}

/** Resultado da aplicação de uma alteração pendente. */
export interface ResultadoAplicacaoPendente {
  /** Id da pendência resolvida. */
  pendenteId: string
  /** Id da OP de destino atualizada. */
  ordemProducaoId: string
  /** Número da OP no Calcgraf. */
  numeroOrigem: string
}

/**
 * Aplica uma `AlteracaoOpPendente` à OP de destino, FORÇANDO a atualização
 * mesmo quando a OP já tem produção (é exatamente esse o caso que gera a
 * pendência — ver `registrarPendente`). Reusa a mesma lógica de `atualizarOp`
 * (não duplica a regra de atualização): substitui cabeçalho/itens/etapas/
 * quantidade a partir do `payloadJson` guardado, preservando o status atual
 * (nunca força regressão) e os vínculos manuais de produto por descrição.
 *
 * Ao final, grava o `hashImportacaoOrigem` com o hash da pendência (de forma
 * que uma reingestão idêntica do agente seja `ignorada`), marca a pendência
 * como APLICADA (`resolvidoPorId` = usuário do ERP, `resolvidoEm` = agora) e
 * grava `LogOrdemProducao`.
 *
 * Isolamento multi-tenant: a pendência é carregada filtrando por `empresaId`;
 * se não pertencer à empresa, lança 404 (a rota devolve 404).
 *
 * @param empresaId   Empresa do usuário do ERP (`user.empresaId`).
 * @param pendenteId  Id da `AlteracaoOpPendente` a aplicar.
 * @param usuarioId   Id do usuário do ERP que está aplicando (auditoria).
 */
export async function aplicarAlteracaoPendente(
  empresaId: string,
  pendenteId: string,
  usuarioId: string,
): Promise<ResultadoAplicacaoPendente> {
  // Carrega a pendência isolando por empresaId (nunca de outro tenant).
  const pendente = await prisma.alteracaoOpPendente.findFirst({
    where: { id: pendenteId, empresaId },
    select: {
      id: true,
      ordemProducaoId: true,
      numeroOrigem: true,
      hashOrigem: true,
      payloadJson: true,
      status: true,
    },
  })
  if (!pendente) {
    throw new AlteracaoPendenteError(404, 'Alteração pendente não encontrada.')
  }
  if (pendente.status !== 'PENDENTE') {
    throw new AlteracaoPendenteError(409, `Alteração já resolvida (status ${pendente.status}).`)
  }

  // A OP de destino deve pertencer à mesma empresa (dupla checagem de tenant).
  const op = await prisma.ordemProducao.findFirst({
    where: { id: pendente.ordemProducaoId, empresaId },
    select: { id: true, status: true },
  })
  if (!op) {
    throw new AlteracaoPendenteError(404, 'OP de destino não encontrada.')
  }
  if (STATUS_FINALIZADOS.includes(op.status)) {
    throw new AlteracaoPendenteError(
      409,
      `OP finalizada (status ${op.status}) não pode receber alterações.`,
    )
  }

  const dto = pendente.payloadJson as unknown as OpOrigemDTO

  await prisma.$transaction(async (tx) => {
    // Reusa a lógica de atualização da OP (mesma função do fluxo automático).
    await atualizarOp(tx, empresaId, op.id, op.status, dto, pendente.hashOrigem)

    // Log específico de que a atualização foi aplicada FORÇADA via revisão.
    await tx.logOrdemProducao.create({
      data: {
        ordemProducaoId: op.id,
        statusAnterior: op.status,
        statusNovo: op.status,
        usuarioId,
        observacao: `Alteração pendente do Calcgraf aplicada manualmente (OP já tinha produção). Referência externa: ${pendente.numeroOrigem}`,
      },
    })

    // Marca a pendência como aplicada.
    await tx.alteracaoOpPendente.update({
      where: { id: pendente.id },
      data: { status: 'APLICADA', resolvidoPorId: usuarioId, resolvidoEm: new Date() },
    })
  })

  return {
    pendenteId: pendente.id,
    ordemProducaoId: op.id,
    numeroOrigem: pendente.numeroOrigem,
  }
}

/**
 * Descarta uma `AlteracaoOpPendente` sem tocar a OP: marca como DESCARTADA
 * (`resolvidoPorId`/`resolvidoEm`). Isolamento por `empresaId`. 404 se a
 * pendência não pertencer à empresa; 409 se já resolvida.
 */
export async function descartarAlteracaoPendente(
  empresaId: string,
  pendenteId: string,
  usuarioId: string,
): Promise<ResultadoAplicacaoPendente> {
  const pendente = await prisma.alteracaoOpPendente.findFirst({
    where: { id: pendenteId, empresaId },
    select: { id: true, ordemProducaoId: true, numeroOrigem: true, status: true },
  })
  if (!pendente) {
    throw new AlteracaoPendenteError(404, 'Alteração pendente não encontrada.')
  }
  if (pendente.status !== 'PENDENTE') {
    throw new AlteracaoPendenteError(409, `Alteração já resolvida (status ${pendente.status}).`)
  }

  await prisma.alteracaoOpPendente.update({
    where: { id: pendente.id },
    data: { status: 'DESCARTADA', resolvidoPorId: usuarioId, resolvidoEm: new Date() },
  })

  return {
    pendenteId: pendente.id,
    ordemProducaoId: pendente.ordemProducaoId,
    numeroOrigem: pendente.numeroOrigem,
  }
}
