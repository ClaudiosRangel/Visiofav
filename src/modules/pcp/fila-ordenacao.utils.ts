/**
 * Funções puras de ordenação automática da fila de programação (por
 * centro de produção). Isoladas do framework HTTP/Prisma para facilitar
 * testes property-based.
 *
 * Regra de negócio (definida pelo usuário):
 * - Critério 1: número da OP (crescente)
 * - Critério 2 (empate no critério 1): data de entrega prevista (crescente,
 *   mais antiga primeiro)
 * - Etapas que o usuário posicionou manualmente (drag-and-drop em
 *   PATCH /etapas/reordenar) mantêm sua posição fixa, sobrepondo os
 *   critérios automáticos — apenas as etapas SEM posicionamento manual são
 *   reordenadas quando uma nova etapa entra na fila.
 */

export interface EtapaParaOrdenar {
  id: string
  posicaoFila: number | null
  ordemManual: boolean
  opNumero: number
  dataEntregaPrevista: Date | null
  /**
   * Trava de sequência (spec gantt-travar-sequencia). Etapa travada mantém a
   * posição SEMPRE, e etapas novas (sem posição) entram depois da última
   * travada ("zona congelada"). Opcional: ausente/false = comportamento legado.
   */
  sequenciaTravada?: boolean
}

function compararAutomaticas(a: EtapaParaOrdenar, b: EtapaParaOrdenar): number {
  if (a.opNumero !== b.opNumero) return a.opNumero - b.opNumero
  const da = a.dataEntregaPrevista ? a.dataEntregaPrevista.getTime() : Infinity
  const db = b.dataEntregaPrevista ? b.dataEntregaPrevista.getTime() : Infinity
  return da - db
}

/** Há alguma etapa travada por sequência (com posição) na fila? */
function temTravadas(etapas: EtapaParaOrdenar[]): boolean {
  return etapas.some((e) => e.sequenciaTravada === true && e.posicaoFila != null)
}

/**
 * Cálculo de posições quando existem etapas travadas por sequência. PURA.
 *
 * - Travadas e manuais (ordemManual) mantêm a posição atual.
 * - Automáticas JÁ posicionadas (posicaoFila != null) seguem o critério padrão
 *   (OP, entrega) e preenchem os slots livres em ordem.
 * - Automáticas NOVAS (posicaoFila == null) entram sempre DEPOIS da última
 *   etapa travada, nos primeiros slots livres após a zona congelada.
 * - `prioritariaId` (etapa recém-iniciada) vai à frente das demais antigas.
 * Posições resultantes são únicas.
 */
function calcularComTravadas(etapas: EtapaParaOrdenar[], prioritariaId?: string): Map<string, number> {
  const fixas = etapas.filter(
    (e) => e.posicaoFila != null && (e.sequenciaTravada === true || e.ordemManual),
  )
  const zona = Math.max(
    0,
    ...etapas.filter((e) => e.sequenciaTravada === true && e.posicaoFila != null).map((e) => e.posicaoFila as number),
  )
  const idsFixas = new Set(fixas.map((f) => f.id))
  const automaticas = etapas.filter((e) => !idsFixas.has(e.id))

  let antigas = automaticas.filter((e) => e.posicaoFila != null).sort(compararAutomaticas)
  const novas = automaticas.filter((e) => e.posicaoFila == null).sort(compararAutomaticas)
  if (prioritariaId) {
    const p = antigas.find((e) => e.id === prioritariaId) ?? novas.find((e) => e.id === prioritariaId)
    if (p && antigas.includes(p)) antigas = [p, ...antigas.filter((e) => e.id !== prioritariaId)]
  }

  const ocupadas = new Set(fixas.map((f) => f.posicaoFila as number))
  const resultado = new Map<string, number>()
  for (const f of fixas) resultado.set(f.id, f.posicaoFila as number)

  let pos = 1
  for (const e of antigas) {
    while (ocupadas.has(pos)) pos++
    resultado.set(e.id, pos)
    ocupadas.add(pos)
    pos++
  }
  // Novas: depois da zona congelada (e depois de qualquer slot já usado).
  pos = zona + 1
  for (const e of novas) {
    while (ocupadas.has(pos)) pos++
    resultado.set(e.id, pos)
    ocupadas.add(pos)
    pos++
  }
  return resultado
}

/**
 * Recalcula a posicaoFila (1..N) de todas as etapas de uma fila.
 *
 * Etapas com `ordemManual=true` e `posicaoFila` já definida mantêm sua
 * posição atual (o "slot" fica reservado para elas). As demais etapas
 * (automáticas) são ordenadas por `opNumero` ascendente, depois por
 * `dataEntregaPrevista` ascendente (etapas sem data de entrega vão para o
 * final), e preenchem os slots restantes na ordem, pulando as posições já
 * ocupadas pelas manuais.
 *
 * @param etapas - todas as etapas ativas da fila (incluindo a nova, se aplicável)
 * @returns Map de etapaId -> nova posicaoFila (1..N)
 */
export function recalcularPosicoesFila(etapas: EtapaParaOrdenar[]): Map<string, number> {
  // Com etapas travadas por sequência: ramo dedicado. Sem travas: legado intacto.
  if (temTravadas(etapas)) return calcularComTravadas(etapas)

  const manuais = etapas.filter((e) => e.ordemManual && e.posicaoFila != null)
  const automaticas = etapas.filter((e) => !e.ordemManual || e.posicaoFila == null)

  const automaticasOrdenadas = [...automaticas].sort((a, b) => {
    if (a.opNumero !== b.opNumero) return a.opNumero - b.opNumero
    const da = a.dataEntregaPrevista ? a.dataEntregaPrevista.getTime() : Infinity
    const db = b.dataEntregaPrevista ? b.dataEntregaPrevista.getTime() : Infinity
    return da - db
  })

  const totalPosicoes = etapas.length
  const posicoesOcupadas = new Set(manuais.map((m) => m.posicaoFila as number))

  const resultado = new Map<string, number>()
  for (const m of manuais) {
    resultado.set(m.id, m.posicaoFila as number)
  }

  let posAtual = 1
  let idx = 0
  while (idx < automaticasOrdenadas.length) {
    if (posAtual > totalPosicoes) {
      // Segurança contra dados inconsistentes (não deveria ocorrer quando
      // totalPosicoes === etapas.length) — evita loop infinito.
      resultado.set(automaticasOrdenadas[idx].id, posAtual)
      idx++
      posAtual++
      continue
    }
    if (!posicoesOcupadas.has(posAtual)) {
      resultado.set(automaticasOrdenadas[idx].id, posAtual)
      idx++
    }
    posAtual++
  }

  return resultado
}

/**
 * R1 (spec apontamentos-melhorias-caio, pedido #1 do Caio) — fila reativa ao
 * operador: ao INICIAR uma etapa, ela deve aparecer à frente das etapas
 * PENDENTES não-manuais do mesmo centro (o que está "em produção" vem
 * primeiro). As etapas posicionadas manualmente (drag-and-drop) mantêm seu
 * slot. Função PURA.
 *
 * Estratégia: a etapa iniciada passa a ter prioridade máxima entre as
 * automáticas (não-manuais). Reusa `recalcularPosicoesFila`, mas marca a
 * etapa iniciada para vir antes das demais automáticas, mantendo o critério
 * OP/entrega entre as outras.
 *
 * @param etapas fila atual do centro (todas as etapas ativas)
 * @param etapaIniciadaId id da etapa que acabou de ser iniciada
 * @returns Map etapaId -> nova posicaoFila (1..N)
 */
export function reordenarComIniciadaNoTopo(
  etapas: EtapaParaOrdenar[],
  etapaIniciadaId: string,
): Map<string, number> {
  const iniciada = etapas.find((e) => e.id === etapaIniciadaId)
  // Com travas de sequência: a iniciada só sobe se NÃO for travada/manual; as
  // travadas nunca mudam de posição.
  if (temTravadas(etapas)) {
    if (!iniciada || iniciada.sequenciaTravada === true) return calcularComTravadas(etapas)
    return calcularComTravadas(etapas, etapaIniciadaId)
  }
  // Se a etapa não existe na fila OU está posicionada manualmente, não mexe
  // (respeita o drag-and-drop do usuário) — cai no recálculo padrão.
  if (!iniciada || (iniciada.ordemManual && iniciada.posicaoFila != null)) {
    return recalcularPosicoesFila(etapas)
  }

  const manuais = etapas.filter((e) => e.ordemManual && e.posicaoFila != null)
  const automaticas = etapas.filter((e) => !e.ordemManual || e.posicaoFila == null)

  // Ordena as automáticas pelo critério padrão (OP, entrega) e então move a
  // etapa iniciada para a frente das demais automáticas.
  const automaticasOrdenadas = [...automaticas].sort((a, b) => {
    if (a.opNumero !== b.opNumero) return a.opNumero - b.opNumero
    const da = a.dataEntregaPrevista ? a.dataEntregaPrevista.getTime() : Infinity
    const db = b.dataEntregaPrevista ? b.dataEntregaPrevista.getTime() : Infinity
    return da - db
  })
  const semIniciada = automaticasOrdenadas.filter((e) => e.id !== etapaIniciadaId)
  const ordemFinalAutomaticas = [iniciada, ...semIniciada]

  const totalPosicoes = etapas.length
  const posicoesOcupadas = new Set(manuais.map((m) => m.posicaoFila as number))
  const resultado = new Map<string, number>()
  for (const m of manuais) resultado.set(m.id, m.posicaoFila as number)

  let posAtual = 1
  let idx = 0
  while (idx < ordemFinalAutomaticas.length) {
    if (posAtual > totalPosicoes) {
      resultado.set(ordemFinalAutomaticas[idx].id, posAtual)
      idx++
      posAtual++
      continue
    }
    if (!posicoesOcupadas.has(posAtual)) {
      resultado.set(ordemFinalAutomaticas[idx].id, posAtual)
      idx++
    }
    posAtual++
  }
  return resultado
}
