// Vigência de tabela de custo gráfico — serviço PURO (sem Prisma).
//
// Paridade com `TabelasCusto` do Calcgraf: versões de valores com validade por
// período. Regra do projeto: NÃO pode haver vigência sobreposta na mesma empresa
// (o salvamento bloqueia sobreposição). Com isso, a seleção da versão vigente
// numa data retorna no máximo UMA versão. Spec configurador-grafico-calcgraf.

export interface Vigencia {
  /** Data de início de vigência (inclusive). */
  inicio: Date
  /** Data de fim de vigência (inclusive). `null` = em aberto (+∞). */
  fim: Date | null
}

const t = (d: Date): number => d.getTime()

/**
 * Duas vigências se sobrepõem se as faixas [inicio, fim] se intersectam, tratando
 * `fim = null` como +∞. Simétrica: sobrepoe(a,b) === sobrepoe(b,a).
 *
 * Faixas que apenas se tocam no limite (fimA === inicioB) são consideradas
 * SOBREPOSTAS (um dia não pode pertencer a duas versões) — o fim é inclusive.
 */
export function sobrepoe(a: Vigencia, b: Vigencia): boolean {
  const fimA = a.fim == null ? Infinity : t(a.fim)
  const fimB = b.fim == null ? Infinity : t(b.fim)
  return t(a.inicio) <= fimB && t(b.inicio) <= fimA
}

/**
 * Seleciona a versão vigente numa data: aquela cuja faixa cobre `data`
 * (inicio <= data <= fim, fim null = +∞). Como o salvamento impede sobreposição,
 * retorna no máximo UMA; se mais de uma cobrir (estado inconsistente), devolve a
 * de maior `inicio` por segurança. `undefined` quando nenhuma cobre a data.
 */
export function versaoVigenteNaData<T extends Vigencia>(versoes: T[], data: Date): T | undefined {
  const dref = t(data)
  const cobrem = versoes.filter((v) => {
    const fim = v.fim == null ? Infinity : t(v.fim)
    return t(v.inicio) <= dref && dref <= fim
  })
  if (cobrem.length === 0) return undefined
  return cobrem.reduce((maisRecente, v) => (t(v.inicio) > t(maisRecente.inicio) ? v : maisRecente))
}

/**
 * Verifica se uma vigência candidata sobrepõe QUALQUER versão existente (exceto
 * ela mesma, por `idIgnorar` na edição). Retorna a primeira versão conflitante ou
 * `undefined` se não houver conflito.
 */
export function conflitoDeVigencia<T extends Vigencia & { id?: string }>(
  candidata: Vigencia,
  existentes: T[],
  idIgnorar?: string,
): T | undefined {
  return existentes.find((v) => v.id !== idIgnorar && sobrepoe(candidata, v))
}
