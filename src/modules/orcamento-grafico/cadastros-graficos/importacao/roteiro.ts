/**
 * Aplicação PURA da ordem do `Roteiros` (campo `Ordem`) às relações PLANO→ATIVIDADE
 * e PRODUTO→ATIVIDADE, com lista de divergências. Sem Prisma. Spec
 * orcamento-grafico-cadastros-relacoes, tarefa 7.5 (Req 14.8).
 *
 * Fatos da base (verificados no export):
 *  - `Ordem = 999` significa "sem ordem";
 *  - o mesmo par plano×atividade se repete em várias linhas de produto, com ordens
 *    diferentes. Vale a linha do PRÓPRIO plano; sem linha do plano, vale o conjunto todo;
 *  - `CodPlanoCad = 0` são as atividades de PRODUTO (escopo = linha do produto).
 *
 * Divergências (nunca alteram dado; só listam):
 *  - `relacaoSemRoteiro`: relação da `RelTabelas` sem nenhuma linha de roteiro;
 *  - `roteiroSemRelacao`: linha de roteiro sem relação correspondente na `RelTabelas`;
 *  - `ordemConflitante`: mais de uma ordem válida para o mesmo par (vale a menor).
 */
import type { RelacaoTraduzida } from './tabelas-relacao'

export const ORDEM_SEM_ORDEM = 999

export interface LinhaRoteiro {
  CodLinhaProduto: number
  CodPlanoCad: number
  Ordem: number
  CodAtividade: number
  FlagCheck?: number
}

export interface EntradaRoteiro {
  roteiros: readonly LinhaRoteiro[]
  /** Relações já traduzidas (códigos do legado). Só PLANO→ATIVIDADE e PRODUTO→ATIVIDADE interessam. */
  relacoes: readonly RelacaoTraduzida[]
  /** Linha de produto do legado de cada plano / produto. */
  linhaDoPlano: ReadonlyMap<number, number>
  linhaDoProduto: ReadonlyMap<number, number>
}

export type OrigemOrdem = 'PLANO' | 'PRODUTO'

export interface OrdemAplicada {
  tipoOrigem: OrigemOrdem
  codigoOrigem: number
  codigoAtividade: number
  ordem: number
}

export interface DivergenciaRoteiro {
  tipo: 'RELACAO_SEM_ROTEIRO' | 'ROTEIRO_SEM_RELACAO' | 'ORDEM_CONFLITANTE'
  descricao: string
}

export interface ResultadoRoteiro {
  ordens: OrdemAplicada[]
  /** Relações cujo roteiro só tem 999 (sem ordem): a ordem fica vazia. */
  semOrdem: number
  divergencias: DivergenciaRoteiro[]
}

const rotulo = (o: OrigemOrdem) => (o === 'PLANO' ? 'plano' : 'produto')

export function aplicarRoteiro(entrada: EntradaRoteiro): ResultadoRoteiro {
  const porPlano = new Map<string, LinhaRoteiro[]>() // `${plano}:${atividade}` (plano ≠ 0)
  const porLinhaProduto = new Map<string, LinhaRoteiro[]>() // `${linha}:${atividade}` (plano 0)
  for (const l of entrada.roteiros) {
    const mapa = l.CodPlanoCad === 0 ? porLinhaProduto : porPlano
    const chave = l.CodPlanoCad === 0 ? `${l.CodLinhaProduto}:${l.CodAtividade}` : `${l.CodPlanoCad}:${l.CodAtividade}`
    const lista = mapa.get(chave)
    if (lista) lista.push(l)
    else mapa.set(chave, [l])
  }

  const ordens: OrdemAplicada[] = []
  const divergencias: DivergenciaRoteiro[] = []
  let semOrdem = 0
  const planoAtividadeComRelacao = new Set<string>()
  const linhaAtividadeComRelacao = new Set<string>()

  for (const r of entrada.relacoes) {
    if (r.destino.tipo !== 'ATIVIDADE') continue
    let origem: OrigemOrdem
    if (r.origem.tipo === 'PLANO') origem = 'PLANO'
    else if (r.origem.tipo === 'PRODUTO') origem = 'PRODUTO'
    else continue

    const atividade = r.destino.codigo
    let linhas: LinhaRoteiro[] | undefined
    let linhaPropria: number | undefined
    if (origem === 'PLANO') {
      planoAtividadeComRelacao.add(`${r.origem.codigo}:${atividade}`)
      linhas = porPlano.get(`${r.origem.codigo}:${atividade}`)
      linhaPropria = entrada.linhaDoPlano.get(r.origem.codigo)
    } else {
      linhaPropria = entrada.linhaDoProduto.get(r.origem.codigo)
      if (linhaPropria !== undefined) linhaAtividadeComRelacao.add(`${linhaPropria}:${atividade}`)
      linhas = linhaPropria === undefined ? undefined : porLinhaProduto.get(`${linhaPropria}:${atividade}`)
    }

    if (!linhas || linhas.length === 0) {
      divergencias.push({
        tipo: 'RELACAO_SEM_ROTEIRO',
        descricao: `${rotulo(origem)} ${r.origem.codigo} → atividade ${atividade}: relação sem linha no roteiro`,
      })
      continue
    }

    const daLinha = linhaPropria === undefined ? [] : linhas.filter((l) => l.CodLinhaProduto === linhaPropria)
    const consideradas = daLinha.length > 0 ? daLinha : linhas
    const validas = [...new Set(consideradas.map((l) => l.Ordem).filter((o) => o !== ORDEM_SEM_ORDEM))].sort((a, b) => a - b)
    if (validas.length === 0) {
      semOrdem++
      continue
    }
    if (validas.length > 1) {
      divergencias.push({
        tipo: 'ORDEM_CONFLITANTE',
        descricao: `${rotulo(origem)} ${r.origem.codigo} → atividade ${atividade}: ordens ${validas.join(', ')} (usada a menor: ${validas[0]})`,
      })
    }
    ordens.push({ tipoOrigem: origem, codigoOrigem: r.origem.codigo, codigoAtividade: atividade, ordem: validas[0] })
  }

  // Produtos por linha: um roteiro de produto (plano 0) tem relação se ALGUM produto da linha liga à atividade.
  for (const [chave, linhas] of porPlano) {
    if (!planoAtividadeComRelacao.has(chave)) {
      const [plano, atividade] = chave.split(':')
      divergencias.push({
        tipo: 'ROTEIRO_SEM_RELACAO',
        descricao: `plano ${plano} → atividade ${atividade}: ${linhas.length} linha(s) de roteiro sem relação`,
      })
    }
  }
  for (const [chave, linhas] of porLinhaProduto) {
    if (!linhaAtividadeComRelacao.has(chave)) {
      const [linha, atividade] = chave.split(':')
      divergencias.push({
        tipo: 'ROTEIRO_SEM_RELACAO',
        descricao: `atividade de produto ${atividade} na linha ${linha}: ${linhas.length} linha(s) de roteiro sem relação com nenhum produto da linha`,
      })
    }
  }
  return { ordens, semOrdem, divergencias }
}

/** Relação existente (ou planejada) que pode receber a ordem. `id` nulo = ainda não gravada (dry-run). */
export interface RelacaoParaOrdem {
  id: string | null
  tipoOrigem: string
  idOrigem: string
  tipoDestino: string
  idDestino: string
  ordem: number | null
}

export type OperacaoOrdem =
  | { tipo: 'DEFINIR'; id: string | null; ordem: number; aplicada: OrdemAplicada }
  | { tipo: 'IGNORAR'; motivo: 'JA_TEM_ORDEM' | 'SEM_RELACAO_NO_VIZOR'; aplicada: OrdemAplicada }

/**
 * Converte as ordens do legado em operações sobre as relações do Vizor. Só preenche
 * `ordem` vazia; ordem já preenchida nunca é sobrescrita (Req 14.4).
 */
export function planejarOrdens(
  aplicadas: readonly OrdemAplicada[],
  idsPlano: ReadonlyMap<number, string>,
  idsProduto: ReadonlyMap<number, string>,
  idsAtividade: ReadonlyMap<number, string>,
  relacoes: readonly RelacaoParaOrdem[],
): OperacaoOrdem[] {
  const indice = new Map<string, RelacaoParaOrdem>()
  for (const r of relacoes) indice.set(`${r.tipoOrigem}|${r.idOrigem}|${r.tipoDestino}|${r.idDestino}`, r)
  const ops: OperacaoOrdem[] = []
  for (const a of aplicadas) {
    const idOrigem = (a.tipoOrigem === 'PLANO' ? idsPlano : idsProduto).get(a.codigoOrigem)
    const idAtividade = idsAtividade.get(a.codigoAtividade)
    const rel = idOrigem && idAtividade ? indice.get(`${a.tipoOrigem}|${idOrigem}|ATIVIDADE|${idAtividade}`) : undefined
    if (!rel) {
      ops.push({ tipo: 'IGNORAR', motivo: 'SEM_RELACAO_NO_VIZOR', aplicada: a })
      continue
    }
    if (rel.ordem !== null && rel.ordem !== undefined) {
      ops.push({ tipo: 'IGNORAR', motivo: 'JA_TEM_ORDEM', aplicada: a })
      continue
    }
    ops.push({ tipo: 'DEFINIR', id: rel.id, ordem: a.ordem, aplicada: a })
  }
  return ops
}
