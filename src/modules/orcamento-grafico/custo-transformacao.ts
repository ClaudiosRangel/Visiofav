/**
 * Custo de Transformação (CT) — paridade com o Calcgraf/G-Print.
 *
 * Módulo PURO (sem dependências de banco) que reproduz como o Calcgraf calcula
 * o tempo e o custo das atividades de máquina (impressão + acabamentos) de uma
 * Ordem de Produção/Orçamento. Decifrado por engenharia reversa a partir do
 * banco restaurado (CalculoAtividades + CalculoResAgrupamento) e da memória de
 * cálculo (pré-cálculo 5355/15185). Ver docs/calcgraf-custo-transformacao.md.
 *
 * FÓRMULA VALIDADA (em 52/53 cálculos reais, desvio ≤1% no CustoFixo agregado):
 *
 *   custo_atividade = (tempoFixoHoras + tempoVarHoras) × custoHoraDaMaquina
 *
 *   tempoFixo (ACERTO/SETUP), em minutos:
 *     • Impressão offset: tempoFixo = cores × acertoPorCorMin + tempoPrimeiroAcerto
 *     • Demais atividades: tempoFixo = quantAcertos × tempoPorAcerto + tempoPrimeiroAcerto
 *     (× nº de ocorrências/partes do plano)
 *
 *   tempoVar (PRODUÇÃO), em horas:
 *     • tempoVar = unidadesProcessadas / producaoHora   (producaoHora em unid/h)
 *
 * Agregação (como o Calcgraf grava em CalculoResAgrupamento, agrupamento 1):
 *   CustoFixo  = Σ (tempoFixoHoras × custoHora)                (independe da tiragem)
 *   CustoUnit  = Σ (tempoVarHoras  × custoHora) / tiragem      (por unidade)
 *   CT(tiragem) = CustoFixo + CustoUnit × tiragem
 *
 * IMPORTANTE — custo-hora: usar SEMPRE a Tabela de Custos VIGENTE na data do
 * cálculo (no backup da Wega, a "Tabela 2"), não a antiga. Esse foi o erro de
 * base que mascarava a calibração (ex.: Heidelberg CD passou de 245,45 p/ 440,00).
 */

export interface AtividadeCT {
  nome: string
  /** true para impressão offset (acerto por cor); false para acabamentos. */
  impressao: boolean
  /** custo-hora da máquina (Tabela de Custos vigente). */
  custoHora: number
  /** velocidade de produção em unidades/hora (Calcgraf: producaoHora). */
  producaoHora: number
  /** unidades que a atividade processa (folhas impressas, folhas cortadas,
   * peças montadas, etc. — depende do tipo; vem do encaixe/aproveitamento). */
  unidadesProcessadas: number
  /** nº de ocorrências/partes do plano que repetem a mesma atividade. */
  ocorrencias?: number

  // --- Parâmetros de ACERTO ---
  /** Impressão: nº de cores (Calcgraf: coresF / quantChapas1). */
  cores?: number
  /** Impressão: tempo de acerto por cor em minutos (parâmetro da máquina). */
  acertoPorCorMin?: number
  /** Acabamentos: Calcgraf quantAcertos. */
  quantAcertos?: number
  /** Acabamentos: Calcgraf tempoPorAcerto (minutos). */
  tempoPorAcertoMin?: number
  /** Tempo de 1º acerto fixo em minutos (Calcgraf: tempoPrimeiroAcerto). */
  tempoPrimeiroAcertoMin?: number
}

export interface ResultadoCT {
  custoFixo: number // R$ (independe da tiragem)
  custoUnitario: number // R$ por unidade
  custoTotal: number // custoFixo + custoUnitario × tiragem
  detalhe: Array<{
    nome: string
    tempoFixoMin: number
    tempoVarHoras: number
    custoFixo: number
    custoVar: number
  }>
}

/** Tempo de acerto (setup) de UMA atividade, em minutos (sem multiplicar por ocorrências). */
export function tempoAcertoMinutos(a: AtividadeCT): number {
  const t1 = a.tempoPrimeiroAcertoMin ?? 0
  if (a.impressao) {
    const cores = a.cores ?? 0
    const porCor = a.acertoPorCorMin ?? 0
    return cores * porCor + t1
  }
  const qA = a.quantAcertos ?? 0
  const tPA = a.tempoPorAcertoMin ?? 0
  return qA * tPA + t1
}

/**
 * Calcula o Custo de Transformação de uma lista de atividades, reproduzindo a
 * decomposição CustoFixo/CustoUnitário do Calcgraf.
 *
 * @param atividades atividades de máquina (impressão + acabamentos)
 * @param tiragem quantidade do produto (para converter o VAR em custo unitário)
 */
export function calcularCustoTransformacao(
  atividades: AtividadeCT[],
  tiragem: number,
): ResultadoCT {
  let somaFixo = 0
  let somaVar = 0
  const detalhe: ResultadoCT['detalhe'] = []

  for (const a of atividades) {
    const ocor = a.ocorrencias ?? 1
    const tempoFixoMin = tempoAcertoMinutos(a) * ocor
    const tempoFixoHoras = tempoFixoMin / 60
    const tempoVarHoras =
      a.producaoHora > 0 ? (a.unidadesProcessadas / a.producaoHora) : 0

    const custoFixo = tempoFixoHoras * a.custoHora
    const custoVar = tempoVarHoras * a.custoHora

    somaFixo += custoFixo
    somaVar += custoVar

    detalhe.push({
      nome: a.nome,
      tempoFixoMin,
      tempoVarHoras: Math.round(tempoVarHoras * 10000) / 10000,
      custoFixo: Math.round(custoFixo * 100) / 100,
      custoVar: Math.round(custoVar * 100) / 100,
    })
  }

  const custoUnitario = tiragem > 0 ? somaVar / tiragem : 0
  const custoTotal = somaFixo + custoUnitario * tiragem

  return {
    custoFixo: Math.round(somaFixo * 10000) / 10000,
    custoUnitario: Math.round(custoUnitario * 1000000) / 1000000,
    custoTotal: Math.round(custoTotal * 100) / 100,
    detalhe,
  }
}
