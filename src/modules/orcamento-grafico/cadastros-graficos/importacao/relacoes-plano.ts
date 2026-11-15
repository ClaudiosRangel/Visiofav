/**
 * Planejador PURO das relações (`RelacaoCadastroGrafico`) a partir da `RelTabelas`
 * já traduzida (ver `tabelas-relacao.ts`). Sem Prisma. Spec
 * orcamento-grafico-cadastros-relacoes, tarefas 7.3 e 7.4 (Req 14.3, 14.5, 14.6).
 *
 * Cada extremo (tipo + código do legado) é resolvido para o id do Vizor por um mapa
 * `codigoOrigem → id`. Sem mapa para o tipo (Tintas e Matrizes não têm cadastro com
 * `codigoOrigem` no Vizor) ou sem o código no mapa, a relação é "não casada".
 * Nada é inventado nem mesclado.
 */
import type { TipoRelacao } from '../relacoes-permitidas'
import {
  traduzirRelTabelas,
  type ExtremoRelacao,
  type LinhaRelTabelas,
  type RelacaoTraduzida,
  type ResumoTraducao,
} from './tabelas-relacao'
import type { NaoCasado, RelatorioFase } from './relatorio'

export interface ResolvedorRelacoes {
  /** `codigoOrigem` do legado → id do Vizor, por tipo. Tipo ausente = sem cadastro no Vizor. */
  ids: Partial<Record<TipoRelacao, ReadonlyMap<number, string>>>
  /** Códigos cancelados no legado (ignorados de propósito; não contam como "não casados"). */
  cancelados?: Partial<Record<TipoRelacao, ReadonlySet<number>>>
}

export interface RelacaoExistenteChave {
  tipoOrigem: string
  idOrigem: string
  tipoDestino: string
  idDestino: string
}

export interface RelacaoPlanejada {
  tipoOrigem: TipoRelacao
  idOrigem: string
  tipoDestino: TipoRelacao
  idDestino: string
  /** Extremos no legado (para o roteiro aplicar a ordem). */
  origem: ExtremoRelacao
  destino: ExtremoRelacao
}

export type MotivoNaoCasadoRelacao =
  | 'TIPO_SEM_CADASTRO_NO_VIZOR'
  | 'ORIGEM_SEM_EQUIVALENTE'
  | 'DESTINO_SEM_EQUIVALENTE'
  | 'PAR_NAO_PERMITIDO'
  | 'CODIGO_DESCONHECIDO'

export type OperacaoRelacao =
  | { tipo: 'CRIAR'; relacao: RelacaoPlanejada }
  | { tipo: 'IGNORAR'; relacao?: RelacaoPlanejada; motivo: 'JA_EXISTE' | 'CANCELADO_NO_LEGADO' }
  | { tipo: 'NAO_CASADO'; descricao: string; motivo: MotivoNaoCasadoRelacao; detalhe: string }

export interface PlanoRelacoes {
  operacoes: OperacaoRelacao[]
  /** Linhas descartadas (tabela 9 ou `descartar = true`). */
  descartadas: number
  /** Mesmo par repetido nos dois sentidos da `RelTabelas`. */
  duplicadas: number
  traducao: ResumoTraducao
}

export function chaveRelacao(r: RelacaoExistenteChave): string {
  return `${r.tipoOrigem}|${r.idOrigem}|${r.tipoDestino}|${r.idDestino}`
}

type FalhaResolucao = { ok: false; cancelado: false; motivo: MotivoNaoCasadoRelacao; detalhe: string }
type Resolucao = { ok: true; id: string } | { ok: false; cancelado: true } | FalhaResolucao

function resolverExtremo(extremo: ExtremoRelacao, resolvedor: ResolvedorRelacoes, lado: 'ORIGEM' | 'DESTINO'): Resolucao {
  const mapa = resolvedor.ids[extremo.tipo]
  if (!mapa) {
    return {
      ok: false,
      cancelado: false,
      motivo: 'TIPO_SEM_CADASTRO_NO_VIZOR',
      detalhe: `${extremo.tipo} ${extremo.codigo}: o Vizor não tem cadastro de ${extremo.tipo} com código de origem`,
    }
  }
  const id = mapa.get(extremo.codigo)
  if (id) return { ok: true, id }
  if (resolvedor.cancelados?.[extremo.tipo]?.has(extremo.codigo)) return { ok: false, cancelado: true }
  return {
    ok: false,
    cancelado: false,
    motivo: lado === 'ORIGEM' ? 'ORIGEM_SEM_EQUIVALENTE' : 'DESTINO_SEM_EQUIVALENTE',
    detalhe: `${extremo.tipo} ${extremo.codigo} sem equivalente no Vizor`,
  }
}

/** Planeja as relações já traduzidas contra o que existe no Vizor. */
export function planejarRelacoesTraduzidas(
  relacoes: readonly RelacaoTraduzida[],
  resolvedor: ResolvedorRelacoes,
  existentes: readonly RelacaoExistenteChave[],
  base?: Pick<PlanoRelacoes, 'descartadas' | 'duplicadas' | 'traducao'>,
): PlanoRelacoes {
  const jaExistem = new Set(existentes.map(chaveRelacao))
  const vistos = new Set<string>()
  const operacoes: OperacaoRelacao[] = []

  for (const r of relacoes) {
    const origem = resolverExtremo(r.origem, resolvedor, 'ORIGEM')
    const destino = resolverExtremo(r.destino, resolvedor, 'DESTINO')
    if (!origem.ok || !destino.ok) {
      if ((!origem.ok && origem.cancelado) || (!destino.ok && destino.cancelado)) {
        operacoes.push({ tipo: 'IGNORAR', motivo: 'CANCELADO_NO_LEGADO' })
        continue
      }
      // Os dois lados podem falhar: o motivo é o do primeiro, o detalhe junta ambos.
      const falhas = [origem, destino].filter((x): x is FalhaResolucao => !x.ok && !x.cancelado)
      operacoes.push({
        tipo: 'NAO_CASADO',
        descricao: `${r.origem.tipo} ${r.origem.codigo} → ${r.destino.tipo} ${r.destino.codigo}`,
        motivo: falhas[0].motivo,
        detalhe: falhas.map((x) => x.detalhe).join('; '),
      })
      continue
    }
    const planejada: RelacaoPlanejada = {
      tipoOrigem: r.origem.tipo,
      idOrigem: origem.id,
      tipoDestino: r.destino.tipo,
      idDestino: destino.id,
      origem: r.origem,
      destino: r.destino,
    }
    const chave = chaveRelacao(planejada)
    if (vistos.has(chave)) {
      operacoes.push({ tipo: 'IGNORAR', relacao: planejada, motivo: 'JA_EXISTE' })
      continue
    }
    vistos.add(chave)
    operacoes.push(jaExistem.has(chave) ? { tipo: 'IGNORAR', relacao: planejada, motivo: 'JA_EXISTE' } : { tipo: 'CRIAR', relacao: planejada })
  }
  return {
    operacoes,
    descartadas: base?.descartadas ?? 0,
    duplicadas: base?.duplicadas ?? 0,
    traducao: base?.traducao ?? { relacoes: [...relacoes], descartadas: 0, duplicadas: 0, rejeitadas: [] },
  }
}

/** Traduz a `RelTabelas` bruta (descarta a tabela 9), resolve os ids e planeja. */
export function planejarRelacoes(
  linhas: readonly LinhaRelTabelas[],
  resolvedor: ResolvedorRelacoes,
  existentes: readonly RelacaoExistenteChave[],
): PlanoRelacoes {
  const traducao = traduzirRelTabelas(linhas)
  const plano = planejarRelacoesTraduzidas(traducao.relacoes, resolvedor, existentes, {
    descartadas: traducao.descartadas,
    duplicadas: traducao.duplicadas,
    traducao,
  })
  // Pares fora da lista e códigos de tabela desconhecidos entram como "não casados".
  for (const rej of traducao.rejeitadas) {
    plano.operacoes.push({
      tipo: 'NAO_CASADO',
      descricao: `tabela ${rej.linha.CodTabela1}:${rej.linha.CodItem1} → tabela ${rej.linha.CodTabela2}:${rej.linha.CodItem2}`,
      motivo: rej.motivo === 'PAR_NAO_PERMITIDO' ? 'PAR_NAO_PERMITIDO' : 'CODIGO_DESCONHECIDO',
      detalhe: rej.detalhe,
    })
  }
  return plano
}

/** Códigos do legado que são destino de ACONDICIONAMENTO (atividades 39 e 53 no legado). */
export function codigosAcondicionamento(relacoes: readonly RelacaoTraduzida[]): Set<number> {
  const out = new Set<number>()
  for (const r of relacoes) if (r.destino.tipo === 'ACONDICIONAMENTO') out.add(r.destino.codigo)
  return out
}

/** Relatório da fase `relacoes`. */
export function relatorioDeRelacoes(plano: PlanoRelacoes): RelatorioFase {
  const rel: RelatorioFase = { fase: 'relacoes', criados: 0, atualizados: 0, ignorados: 0, ignoradosPorMotivo: {}, naoCasados: [] }
  const ignorar = (motivo: string, n = 1) => {
    rel.ignorados += n
    rel.ignoradosPorMotivo[motivo] = (rel.ignoradosPorMotivo[motivo] ?? 0) + n
  }
  for (const op of plano.operacoes) {
    if (op.tipo === 'CRIAR') rel.criados++
    else if (op.tipo === 'IGNORAR') ignorar(op.motivo)
    else {
      const n: NaoCasado = { codigoOrigem: null, nome: op.descricao, motivo: op.motivo, detalhe: op.detalhe }
      rel.naoCasados.push(n)
    }
  }
  if (plano.descartadas > 0) ignorar('TABELA_9_DESCARTADA', plano.descartadas)
  if (plano.duplicadas > 0) ignorar('PAR_DUPLICADO_NOS_DOIS_SENTIDOS', plano.duplicadas)
  return rel
}
