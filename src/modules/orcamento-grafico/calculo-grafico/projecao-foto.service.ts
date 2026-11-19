// Projeção PURA da Foto rica para os campos comerciais do item copiado.
//
// Spec orcamento-grafico-paridade-fluxo-legado (tarefa 2.3, Req. 6.4 e 6.5).
// Não arredonda e não calcula: apenas lê o que a Foto já traz. Campo ausente
// vira `null` e o nome entra em `faltantes`.
//
// Campos lidos (foto-rica.types.ts):
//   margens[selecionada === true].margemPercent -> margemPerc
//   margens[selecionada === true].cmPercent     -> cmPerc
//   cev.totalPercent                            -> cevPerc
// (no JSON gravado pelo exportador, `valorContMarginal` do legado já vira
// `cmPercent` da faixa selecionada; a foto não guarda `valorContMarginal`.)

import type { FotoMargem, FotoRicaCalculo } from './foto-rica.types'

export type CampoFotoFaltante = 'margemSelecionada' | 'margem' | 'cm' | 'cev'

export interface ProjecaoFoto {
  /** Faixa de margem marcada como selecionada na Foto (sem alteração). */
  margemSelecionada: FotoMargem | null
  margemPerc: number | null
  cmPerc: number | null
  cevPerc: number | null
  faltantes: CampoFotoFaltante[]
}

function numeroOuNull(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

export function projetarFoto(
  foto: Partial<FotoRicaCalculo> | null | undefined,
): ProjecaoFoto {
  const margens = Array.isArray(foto?.margens) ? foto!.margens : []
  const sel = margens.find((m) => m && m.selecionada === true) ?? null

  const margemPerc = numeroOuNull(sel?.margemPercent)
  const cmPerc = numeroOuNull(sel?.cmPercent)
  const cevPerc = numeroOuNull(foto?.cev?.totalPercent)

  const faltantes: CampoFotoFaltante[] = []
  if (sel === null) faltantes.push('margemSelecionada')
  if (margemPerc === null) faltantes.push('margem')
  if (cmPerc === null) faltantes.push('cm')
  if (cevPerc === null) faltantes.push('cev')

  return { margemSelecionada: sel, margemPerc, cmPerc, cevPerc, faltantes }
}
