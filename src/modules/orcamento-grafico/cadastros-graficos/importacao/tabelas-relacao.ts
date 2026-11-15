/**
 * Tradutor dos códigos de tabela da `RelTabelas` do sistema legado para os
 * tipos de `RelacaoCadastroGrafico` do Vizor (Req 14.5).
 *
 * Módulo PURO (sem Prisma). Regras:
 *  - código 9 é DESCARTADO (resíduo desalinhado, HANDOFF §16.2); linhas com
 *    `descartar = true` também;
 *  - código sem equivalente vira rejeição "CODIGO_DESCONHECIDO" (nunca inventa);
 *  - a `RelTabelas` guarda o par nos dois sentidos (ex.: Atividade → Plano e
 *    Plano → Atividade). O tradutor tenta o sentido direto e, se não estiver
 *    em PARES_PERMITIDOS, o invertido; fora da lista nos dois = rejeitado.
 */
import { parEhPermitido, type TipoRelacao } from '../relacoes-permitidas'

/** Tabela descartada do legado. */
export const TABELA_DESCARTADA = 9

/** 0 Suportes, 1 Itens Diversos, 2 Planos, 3 Coberturas, 4 Atividades, 5 Linhas, 6 Acondicionamento, 8 Centros, 10 Produtos, 11 Tintas, 12 Matrizes, 13 Materiais. */
export const CODIGO_TABELA_PARA_TIPO: Readonly<Record<number, TipoRelacao>> = {
  0: 'SUPORTE',
  1: 'ITEM_DIVERSO',
  2: 'PLANO',
  3: 'COBERTURA_TINTA',
  4: 'ATIVIDADE',
  5: 'LINHA',
  6: 'ACONDICIONAMENTO',
  8: 'CENTRO',
  10: 'PRODUTO',
  11: 'TINTA',
  12: 'MATRIZ',
  13: 'MATERIAL',
}

export interface LinhaRelTabelas {
  CodTabela1: number
  CodItem1: number
  CodTabela2: number
  CodItem2: number
  descartar?: boolean
}

export interface ExtremoRelacao {
  tipo: TipoRelacao
  /** Código do item no sistema legado. */
  codigo: number
}

export type MotivoRejeicaoRelacao = 'DESCARTADA' | 'CODIGO_DESCONHECIDO' | 'PAR_NAO_PERMITIDO'

export type ResultadoTraducao =
  | { ok: true; origem: ExtremoRelacao; destino: ExtremoRelacao; invertida: boolean }
  | { ok: false; motivo: MotivoRejeicaoRelacao; detalhe: string }

/** Tipo do Vizor para um código de tabela do legado (undefined = sem equivalente, inclui a 9). */
export function tipoDaTabela(codigoTabela: number): TipoRelacao | undefined {
  return CODIGO_TABELA_PARA_TIPO[codigoTabela]
}

/** Traduz UMA linha da `RelTabelas`. */
export function traduzirRelTabela(linha: LinhaRelTabelas): ResultadoTraducao {
  const { CodTabela1: t1, CodTabela2: t2 } = linha
  if (linha.descartar === true || t1 === TABELA_DESCARTADA || t2 === TABELA_DESCARTADA) {
    return { ok: false, motivo: 'DESCARTADA', detalhe: `tabela ${TABELA_DESCARTADA} descartada (${t1}→${t2})` }
  }
  const tipo1 = tipoDaTabela(t1)
  const tipo2 = tipoDaTabela(t2)
  if (!tipo1 || !tipo2) {
    const sem = !tipo1 ? t1 : t2
    return { ok: false, motivo: 'CODIGO_DESCONHECIDO', detalhe: `código de tabela ${sem} sem equivalente no Vizor` }
  }
  const e1: ExtremoRelacao = { tipo: tipo1, codigo: linha.CodItem1 }
  const e2: ExtremoRelacao = { tipo: tipo2, codigo: linha.CodItem2 }
  if (parEhPermitido(tipo1, tipo2)) return { ok: true, origem: e1, destino: e2, invertida: false }
  if (parEhPermitido(tipo2, tipo1)) return { ok: true, origem: e2, destino: e1, invertida: true }
  return { ok: false, motivo: 'PAR_NAO_PERMITIDO', detalhe: `par ${tipo1} ↔ ${tipo2} fora da lista permitida` }
}

export interface RelacaoTraduzida {
  origem: ExtremoRelacao
  destino: ExtremoRelacao
}

export interface ResumoTraducao {
  relacoes: RelacaoTraduzida[]
  descartadas: number
  duplicadas: number
  rejeitadas: { linha: LinhaRelTabelas; motivo: MotivoRejeicaoRelacao; detalhe: string }[]
}

/** Traduz o conjunto inteiro, remove duplicatas (mesmo par nos dois sentidos) e separa as rejeitadas. */
export function traduzirRelTabelas(linhas: readonly LinhaRelTabelas[]): ResumoTraducao {
  const vistos = new Set<string>()
  const relacoes: RelacaoTraduzida[] = []
  const rejeitadas: ResumoTraducao['rejeitadas'] = []
  let descartadas = 0
  let duplicadas = 0
  for (const linha of linhas) {
    const r = traduzirRelTabela(linha)
    if (!r.ok) {
      if (r.motivo === 'DESCARTADA') descartadas++
      else rejeitadas.push({ linha, motivo: r.motivo, detalhe: r.detalhe })
      continue
    }
    const chave = `${r.origem.tipo}:${r.origem.codigo}>${r.destino.tipo}:${r.destino.codigo}`
    if (vistos.has(chave)) {
      duplicadas++
      continue
    }
    vistos.add(chave)
    relacoes.push({ origem: r.origem, destino: r.destino })
  }
  return { relacoes, descartadas, duplicadas, rejeitadas }
}
