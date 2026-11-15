/**
 * Planejador PURO da importação (sem Prisma, sem I/O).
 *
 * Recebe os itens já mapeados do legado + os registros existentes no Vizor e devolve
 * um PLANO de operações (criar / preencher / ignorar / não casado). Quem grava é
 * `executarPlano`, que recebe um executor injetado; em `--dry-run` o executor nunca
 * é chamado. Spec orcamento-grafico-cadastros-relacoes, tarefas 7.2, 7.4 e 7.6
 * (Req 14.2, 14.3, 14.4, 14.6).
 *
 * Regras:
 *  - Idempotência: casa por `codigoOrigem`; depois pela chave textual (ex.: `CG-ACAB-8`);
 *    depois por nome normalizado (sem acento/caixa) quando há UM candidato sem `codigoOrigem`.
 *  - Nunca sobrescreve: só preenche campo VAZIO (null, undefined, '' ou []) do registro existente.
 *  - 2+ candidatos, nome repetido no legado ou chave em uso por outro item = NÃO CASADO.
 *    O planejador não mescla nem inventa.
 */
import { casarItem, indexarExistentes, nomesRepetidosNoLegado, type CandidatoCasamento } from './casamento'
import { ehVazio, normalizarNome } from './normalizar'
import type { RelatorioFase } from './relatorio'

export type Campos = Record<string, unknown>

export type MotivoNaoCasado =
  | 'AMBIGUO'
  | 'NOME_REPETIDO_NO_LEGADO'
  | 'CHAVE_EM_USO'
  | 'SEM_EQUIVALENTE'
  | 'DEPENDENCIA_SEM_EQUIVALENTE'
  | 'VALOR_SEM_EQUIVALENTE'
  | 'SEM_CODIGO'

export type MotivoIgnorar = 'JA_COMPLETO' | 'CANCELADO_NO_LEGADO' | 'DUPLICADO_NO_LEGADO'

/** Item do legado já mapeado para os campos do Vizor. */
export interface ItemLegado {
  /** Código no legado. `null` nas fases por chave natural (opções, limites, ajustes…). */
  codigoOrigem: number | null
  /** Nome para exibição e gravação (acentos preservados). */
  nome: string
  /** Nome usado só para o casamento, quando difere de `nome` (ex.: `acabamentoId|nome`). */
  nomeCasamento?: string
  /** Chave textual determinística (ex.: `CG-ACAB-8`). */
  chave?: string | null
  /** Chave natural composta, para fases sem `codigoOrigem`. */
  chaveNatural?: string
  /** Campos a gravar (sem `nome`, `chave` e `codigoOrigem`, que são explícitos). */
  dados: Campos
  /** Cancelado no legado: não é criado (pode preencher um existente). */
  cancelado?: boolean
  /** Item que o mapeamento não consegue traduzir: vira "não casado". */
  rejeicao?: { motivo: MotivoNaoCasado; detalhe: string }
}

export interface ExistenteCadastro extends CandidatoCasamento {
  chave?: string | null
  chaveNatural?: string
  /** Valores atuais dos campos que podem ser preenchidos. */
  campos: Campos
}

export type OperacaoCadastro =
  | { tipo: 'CRIAR'; item: ItemLegado }
  | { tipo: 'PREENCHER'; item: ItemLegado; id: string; patch: Campos; via: 'EXATO' | 'CHAVE' | 'NOME' | 'NATURAL' }
  | { tipo: 'IGNORAR'; item: ItemLegado; id?: string; motivo: MotivoIgnorar }
  | { tipo: 'NAO_CASADO'; item: ItemLegado; motivo: MotivoNaoCasado; detalhe: string }

export interface PlanoCadastro {
  fase: string
  operacoes: OperacaoCadastro[]
}

export interface OpcoesPlanejamento {
  /** `false` para entidades que o importador não cria (Centros, Suportes): sem equivalente = não casado. */
  criaQuandoSemEquivalente?: boolean
  /** Predicados extras de "vazio" por campo (ex.: `valorReferencia` 0 conta como vazio). */
  tratarComoVazio?: Record<string, (valor: unknown) => boolean>
}

/** Campos de `dados` que estão vazios no existente e preenchidos no legado. */
export function calcularPreenchimento(
  existente: ExistenteCadastro,
  item: ItemLegado,
  tratarComoVazio: OpcoesPlanejamento['tratarComoVazio'] = {},
): Campos {
  const patch: Campos = {}
  for (const [campo, valor] of Object.entries(item.dados)) {
    if (ehVazio(valor)) continue
    const atual = existente.campos[campo]
    const vazio = tratarComoVazio[campo] ? tratarComoVazio[campo](atual) : ehVazio(atual)
    if (vazio) patch[campo] = valor
  }
  if (
    item.codigoOrigem !== null &&
    item.chaveNatural === undefined &&
    (existente.codigoOrigem === null || existente.codigoOrigem === undefined)
  ) {
    patch.codigoOrigem = item.codigoOrigem
  }
  return patch
}

function naoCasado(item: ItemLegado, motivo: MotivoNaoCasado, detalhe: string): OperacaoCadastro {
  return { tipo: 'NAO_CASADO', item, motivo, detalhe }
}

function finalizarCasamento(
  item: ItemLegado,
  registro: ExistenteCadastro,
  via: 'EXATO' | 'CHAVE' | 'NOME',
  opcoes: OpcoesPlanejamento,
): OperacaoCadastro {
  const patch = calcularPreenchimento(registro, item, opcoes.tratarComoVazio)
  if (Object.keys(patch).length === 0) return { tipo: 'IGNORAR', item, id: registro.id, motivo: 'JA_COMPLETO' }
  return { tipo: 'PREENCHER', item, id: registro.id, patch, via }
}

/** Plano para entidades identificadas por `codigoOrigem` (catálogos, produtos, planos, atividades, materiais…). */
export function planejarPorOrigem(
  fase: string,
  itens: readonly ItemLegado[],
  existentes: readonly ExistenteCadastro[],
  opcoes: OpcoesPlanejamento = {},
): PlanoCadastro {
  const criaQuandoSemEquivalente = opcoes.criaQuandoSemEquivalente ?? true
  const indice = indexarExistentes(existentes)
  const porChave = new Map<string, ExistenteCadastro>()
  const chavesUsadas = new Set<string>()
  for (const e of existentes) {
    if (e.chave) {
      porChave.set(e.chave, e)
      chavesUsadas.add(e.chave)
    }
  }
  const repetidos = nomesRepetidosNoLegado(itens.map((i) => ({ nome: i.nomeCasamento ?? i.nome })))
  const vistos = new Set<number>()
  const reivindicados = new Set<string>()
  const operacoes: OperacaoCadastro[] = []

  for (const item of itens) {
    if (item.rejeicao) {
      operacoes.push(naoCasado(item, item.rejeicao.motivo, item.rejeicao.detalhe))
      continue
    }
    if (item.codigoOrigem === null) {
      operacoes.push(naoCasado(item, 'SEM_CODIGO', 'item do legado sem código'))
      continue
    }
    if (vistos.has(item.codigoOrigem)) {
      operacoes.push({ tipo: 'IGNORAR', item, motivo: 'DUPLICADO_NO_LEGADO' })
      continue
    }
    vistos.add(item.codigoOrigem)

    const nomeMatch = item.nomeCasamento ?? item.nome
    const exato = indice.porCodigo.get(item.codigoOrigem)
    if (exato) {
      operacoes.push(finalizarCasamento(item, exato, 'EXATO', opcoes))
      continue
    }

    const porChaveTexto = item.chave ? porChave.get(item.chave) : undefined
    if (porChaveTexto) {
      if (porChaveTexto.codigoOrigem !== null && porChaveTexto.codigoOrigem !== undefined) {
        operacoes.push(naoCasado(item, 'CHAVE_EM_USO', `chave ${item.chave} já pertence ao código de origem ${porChaveTexto.codigoOrigem}`))
      } else if (reivindicados.has(porChaveTexto.id)) {
        operacoes.push(naoCasado(item, 'CHAVE_EM_USO', `registro ${porChaveTexto.id} já casado com outro item do legado`))
      } else {
        reivindicados.add(porChaveTexto.id)
        operacoes.push(finalizarCasamento(item, porChaveTexto, 'CHAVE', opcoes))
      }
      continue
    }

    const porNome = casarItem(item.codigoOrigem, nomeMatch, indice)
    if (porNome.tipo === 'NOME') {
      if (repetidos.has(normalizarNome(nomeMatch))) {
        operacoes.push(naoCasado(item, 'NOME_REPETIDO_NO_LEGADO', `nome "${nomeMatch}" aparece em 2+ itens do legado`))
      } else if (reivindicados.has(porNome.registro.id)) {
        operacoes.push(naoCasado(item, 'AMBIGUO', `registro ${porNome.registro.id} já casado com outro item do legado`))
      } else {
        reivindicados.add(porNome.registro.id)
        operacoes.push(finalizarCasamento(item, porNome.registro, 'NOME', opcoes))
      }
      continue
    }
    if (porNome.tipo === 'AMBIGUO') {
      operacoes.push(naoCasado(item, 'AMBIGUO', `${porNome.candidatos.length} candidatos: ${porNome.candidatos.map((c) => c.id).join(', ')}`))
      continue
    }

    // Sem equivalente.
    if (!criaQuandoSemEquivalente) {
      operacoes.push(naoCasado(item, 'SEM_EQUIVALENTE', `sem registro equivalente no Vizor para "${item.nome}"`))
      continue
    }
    if (item.cancelado) {
      operacoes.push({ tipo: 'IGNORAR', item, motivo: 'CANCELADO_NO_LEGADO' })
      continue
    }
    if (item.chave && chavesUsadas.has(item.chave)) {
      operacoes.push(naoCasado(item, 'CHAVE_EM_USO', `chave ${item.chave} já usada por outro registro`))
      continue
    }
    if (item.chave) chavesUsadas.add(item.chave)
    operacoes.push({ tipo: 'CRIAR', item })
  }
  return { fase, operacoes }
}

/** Plano para fases sem `codigoOrigem` (opções, limites, ajustes, defaults, parâmetros), por chave natural. */
export function planejarPorChaveNatural(
  fase: string,
  itens: readonly ItemLegado[],
  existentes: readonly ExistenteCadastro[],
  opcoes: OpcoesPlanejamento = {},
): PlanoCadastro {
  const porChave = new Map<string, ExistenteCadastro>()
  for (const e of existentes) if (e.chaveNatural) porChave.set(e.chaveNatural, e)
  const vistos = new Set<string>()
  const operacoes: OperacaoCadastro[] = []

  for (const item of itens) {
    if (item.rejeicao) {
      operacoes.push(naoCasado(item, item.rejeicao.motivo, item.rejeicao.detalhe))
      continue
    }
    const chave = item.chaveNatural
    if (!chave) {
      operacoes.push(
        item.cancelado ? { tipo: 'IGNORAR', item, motivo: 'CANCELADO_NO_LEGADO' } : naoCasado(item, 'SEM_CODIGO', 'item sem chave natural'),
      )
      continue
    }
    if (vistos.has(chave)) {
      operacoes.push({ tipo: 'IGNORAR', item, motivo: 'DUPLICADO_NO_LEGADO' })
      continue
    }
    vistos.add(chave)
    const existente = porChave.get(chave)
    if (existente) {
      const patch = calcularPreenchimento(existente, item, opcoes.tratarComoVazio)
      operacoes.push(
        Object.keys(patch).length === 0
          ? { tipo: 'IGNORAR', item, id: existente.id, motivo: 'JA_COMPLETO' }
          : { tipo: 'PREENCHER', item, id: existente.id, patch, via: 'NATURAL' },
      )
      continue
    }
    operacoes.push(item.cancelado ? { tipo: 'IGNORAR', item, motivo: 'CANCELADO_NO_LEGADO' } : { tipo: 'CRIAR', item })
  }
  return { fase, operacoes }
}

/** Efeitos colaterais injetados (Prisma no script; espião nos testes). */
export interface ExecutorCadastro {
  criar(item: ItemLegado): Promise<string>
  atualizar(id: string, patch: Campos, item: ItemLegado): Promise<void>
}

export interface ResultadoExecucao {
  /** `codigoOrigem` → id do Vizor (em dry-run, os criados recebem id `dry:<fase>:<codigo>`). */
  idsPorCodigo: Map<number, string>
  /** `chaveNatural` → id (mesma regra do dry-run). */
  idsPorChave: Map<string, string>
  relatorio: RelatorioFase
}

/** Executa o plano. Com `dryRun` o executor NÃO é chamado: só calcula ids sintéticos e o relatório. */
export async function executarPlano(
  plano: PlanoCadastro,
  executor: ExecutorCadastro,
  opcoes: { dryRun: boolean },
): Promise<ResultadoExecucao> {
  const idsPorCodigo = new Map<number, string>()
  const idsPorChave = new Map<string, string>()
  const relatorio: RelatorioFase = {
    fase: plano.fase,
    criados: 0,
    atualizados: 0,
    ignorados: 0,
    ignoradosPorMotivo: {},
    naoCasados: [],
  }
  const registrar = (item: ItemLegado, id: string) => {
    if (item.codigoOrigem !== null) idsPorCodigo.set(item.codigoOrigem, id)
    if (item.chaveNatural) idsPorChave.set(item.chaveNatural, id)
  }

  for (const op of plano.operacoes) {
    switch (op.tipo) {
      case 'CRIAR': {
        const sufixo = op.item.codigoOrigem ?? op.item.chaveNatural ?? op.item.nome
        const id = opcoes.dryRun ? `dry:${plano.fase}:${sufixo}` : await executor.criar(op.item)
        registrar(op.item, id)
        relatorio.criados++
        break
      }
      case 'PREENCHER':
        if (!opcoes.dryRun) await executor.atualizar(op.id, op.patch, op.item)
        registrar(op.item, op.id)
        relatorio.atualizados++
        break
      case 'IGNORAR':
        if (op.id) registrar(op.item, op.id)
        relatorio.ignorados++
        relatorio.ignoradosPorMotivo[op.motivo] = (relatorio.ignoradosPorMotivo[op.motivo] ?? 0) + 1
        break
      case 'NAO_CASADO':
        relatorio.naoCasados.push({
          codigoOrigem: op.item.codigoOrigem,
          nome: op.item.nome,
          motivo: op.motivo,
          detalhe: op.detalhe,
        })
        break
    }
  }
  return { idsPorCodigo, idsPorChave, relatorio }
}
