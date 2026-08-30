/**
 * Motor de Put-away (RF008) — orquestrador PURO.
 *
 * Consolida a regra de endereçamento automático de pulmão definida pelo
 * consultor logístico (documento "Regras de Manutenção dos Estoques — Parte 1",
 * RF008) numa única função pura, sem I/O. A rota é responsável por:
 *   - resolver o SKU master e a capacidade de palete;
 *   - buscar os candidatos de cada camada JÁ FILTRADOS por empresaId
 *     (isolamento multi-tenant — correção #2/#7) e por Compatibilidade_Area
 *     (RF004, via compatibilidade-area.service.ts);
 *   - passar os candidatos prontos para este motor.
 *
 * Ordem de destino (cadeia de prioridade):
 *   1. FIXO          — endereço fixo do produto (DadosLogisticosArmazenagem)
 *   2. CONSOLIDAÇÃO  — endereços que já contêm saldo do mesmo produto
 *   3. LIVRE         — endereços vazios, ORDENADOS por proximidade RF008
 *   4. OVERFLOW      — endereços de transbordo (permiteOverflow), último recurso
 *
 * Dentro da lista final ordenada, distribui pela capacidade residual usando o
 * algoritmo greedy (calcularDistribuicao), permitindo split entre endereços.
 *
 * Conservação (Property 4): quantidadeAlocada + quantidadeRestante == quantidade;
 * incompleto ⟺ quantidadeRestante > 0.
 */

import { calcularDistribuicao, type EnderecoComCapacidade } from './motor-distribuicao.service'
import { ordenarRF008, type EnderecoCandidatoRF008 } from './proximidade-rf008.service'

/** Candidato já resolvido pela rota (capacidade residual e coordenadas). */
export interface CandidatoPutaway {
  id: string
  enderecoCompleto: string
  rua: string
  predio: number
  nivel: number
  apartamento: number
  capacidadePalete: number
  saldoAtual: number
  /** Capacidade residual já calculada: max(0, capacidade - saldoAtual). */
  disponivel: number
  /** Curva ABC do produto (opcional; usada só se config.usarClasseAbc). */
  curvaAbc?: string | null
}

export interface PutawayInput {
  quantidade: number
  ruaOrigem: string
  predioOrigem: number
  nivelMin: number
  nivelMax: number
  prediosVarreduraPorLado: number
  usarClasseAbc: boolean
  /** Candidatos por camada da cadeia de prioridade (já filtrados na rota). */
  candidatosFixo: CandidatoPutaway[]
  candidatosConsolidacao: CandidatoPutaway[]
  candidatosLivre: CandidatoPutaway[]
  candidatosOverflow: CandidatoPutaway[]
}

export interface AlocacaoPutaway {
  enderecoId: string
  enderecoCompleto: string
  rua: string
  predio: string
  nivel: string
  apartamento: string
  quantidadeAlocada: number
}

export interface PutawayResult {
  alocacoes: AlocacaoPutaway[]
  quantidadeTotal: number
  quantidadeAlocada: number
  quantidadeRestante: number
  incompleto: boolean
}

/** Remove duplicados por id, preservando a primeira ocorrência (a de maior prioridade). */
function dedupPorId(candidatos: CandidatoPutaway[]): CandidatoPutaway[] {
  const vistos = new Set<string>()
  const out: CandidatoPutaway[] = []
  for (const c of candidatos) {
    if (vistos.has(c.id)) continue
    vistos.add(c.id)
    out.push(c)
  }
  return out
}

/** Converte CandidatoPutaway → EnderecoCandidatoRF008 (para a ordenação). */
function paraCandidatoRF008(c: CandidatoPutaway): EnderecoCandidatoRF008 {
  return {
    id: c.id,
    rua: c.rua,
    predio: c.predio,
    nivel: c.nivel,
    apartamento: c.apartamento,
    enderecoCompleto: c.enderecoCompleto,
  }
}

/** Converte CandidatoPutaway → EnderecoComCapacidade (para o greedy). */
function paraCapacidade(c: CandidatoPutaway): EnderecoComCapacidade {
  return {
    id: c.id,
    enderecoCompleto: c.enderecoCompleto,
    rua: c.rua,
    predio: String(c.predio),
    nivel: String(c.nivel),
    apartamento: String(c.apartamento),
    capacidadePalete: c.capacidadePalete,
    saldoAtual: c.saldoAtual,
    disponivel: c.disponivel,
  }
}

/**
 * Ordena a camada LIVRE pela regra RF008 e, opcionalmente, por curva ABC.
 * A ABC (quando habilitada) é um critério de ESTABILIDADE aplicado ANTES da
 * proximidade apenas para desempate de classe — sem violar a ordem de
 * proximidade da rua de origem (Req 3.5). Aqui, mantemos a proximidade como
 * critério primário e usamos a classe só para ordenar entre candidatos de
 * mesma posição de proximidade (isto é, a ordenação RF008 é feita primeiro e a
 * ABC reordena estável dentro de empates de rua/prédio/nível/apto).
 */
function ordenarCamadaLivre(input: PutawayInput): CandidatoPutaway[] {
  const porId = new Map(input.candidatosLivre.map((c) => [c.id, c]))

  const ordenados = ordenarRF008({
    candidatos: input.candidatosLivre.map(paraCandidatoRF008),
    ruaOrigem: input.ruaOrigem,
    predioOrigem: input.predioOrigem,
    prediosVarreduraPorLado: input.prediosVarreduraPorLado,
    nivelMin: input.nivelMin,
    nivelMax: input.nivelMax,
  })

  let lista = ordenados.map((o) => porId.get(o.id)!).filter(Boolean)

  if (input.usarClasseAbc) {
    // Rank de classe (A=0, B=1, C=2, demais/sem giro=3). Ordenação ESTÁVEL:
    // preserva a ordem de proximidade dentro da mesma classe.
    const rank = (cv?: string | null) => {
      const v = (cv ?? '').trim().toUpperCase()
      if (v === 'A') return 0
      if (v === 'B') return 1
      if (v === 'C') return 2
      return 3
    }
    lista = lista
      .map((c, i) => ({ c, i }))
      .sort((x, y) => {
        const r = rank(x.c.curvaAbc) - rank(y.c.curvaAbc)
        return r !== 0 ? r : x.i - y.i // estável: mantém proximidade em empate
      })
      .map((w) => w.c)
  }

  return lista
}

/**
 * Executa o put-away: monta a lista final (fixo → consolidação → livre
 * ordenada por RF008 → overflow), remove duplicados preservando prioridade, e
 * distribui pela capacidade residual com o greedy.
 */
export function calcularPutaway(input: PutawayInput): PutawayResult {
  const livreOrdenada = ordenarCamadaLivre(input)

  const listaFinal = dedupPorId([
    ...input.candidatosFixo,
    ...input.candidatosConsolidacao,
    ...livreOrdenada,
    ...input.candidatosOverflow,
  ]).filter((c) => c.disponivel > 0)

  const distribuicao = calcularDistribuicao({
    quantidade: input.quantidade,
    enderecosOrdenados: listaFinal.map(paraCapacidade),
  })

  return {
    alocacoes: distribuicao.alocacoes.map((a) => ({
      enderecoId: a.enderecoId,
      enderecoCompleto: a.enderecoCompleto,
      rua: a.rua,
      predio: a.predio,
      nivel: a.nivel,
      apartamento: a.apartamento,
      quantidadeAlocada: a.quantidadeAlocada,
    })),
    quantidadeTotal: input.quantidade,
    quantidadeAlocada: distribuicao.quantidadeAlocada,
    quantidadeRestante: distribuicao.quantidadeRestante,
    incompleto: distribuicao.quantidadeRestante > 0,
  }
}
