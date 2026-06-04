/**
 * Serviço de Cálculo de Consumo Teórico — Indústria Gráfica
 *
 * Calcula o consumo de matéria-prima (papel) para uma Ordem de Produção,
 * diferenciando entre impressão plana (folhas) e rotativa (bobinas/metros lineares).
 * Converte o resultado final para KG (unidade que o WMS usa para reserva e separação).
 *
 * Referência: estudos.txt + regras do PCP Delphi legado
 */

// ============================================================================
// TIPOS
// ============================================================================

export type TipoImpressao = 'PLANA' | 'ROTATIVA'

export interface ParametrosPlana {
  tipo: 'PLANA'
  qtdPedida: number              // Quantidade de produtos finais na OP
  aproveitamento: number         // Quantos produtos cabem em 1 folha inteira (imposição)
  percentualPerda: number        // Margem de acerto/acabamento (5% a 15%)
  larguraFolhaMm: number         // Largura da folha do almoxarifado (ex: 660mm)
  comprimentoFolhaMm: number     // Comprimento da folha (ex: 960mm)
  gramaturaGm2: number           // Gramatura do papel (g/m²)
}

export interface ParametrosRotativa {
  tipo: 'ROTATIVA'
  qtdPedida: number              // Quantidade de produtos finais na OP
  repeticaoCorteMm: number       // Avanço/passo do cilindro (mm por puxada)
  produtosPorPuxada: number      // Quantos produtos saem por puxada (largura)
  metrosAcertoFixo: number       // Metros gastos no acerto de registro (ex: 50m)
  larguraBobinaMm: number        // Largura da bobina (mm)
  gramaturaGm2: number           // Gramatura do papel (g/m²)
}

export type ParametrosCalculo = ParametrosPlana | ParametrosRotativa

export interface ResultadoCalculo {
  tipo: TipoImpressao
  // Consumo em unidade gráfica
  folhasFisicas: number | null       // Apenas para PLANA
  metrosLineares: number | null      // Apenas para ROTATIVA
  // Consumo convertido para KG (o que o WMS precisa)
  pesoTotalKg: number
  // Detalhamento do cálculo
  detalhamento: {
    qtdPedida: number
    gramaturaGm2: number
    // Plana
    folhasPuras?: number
    folhasAcerto?: number
    aproveitamento?: number
    percentualPerda?: number
    larguraFolhaM?: number
    comprimentoFolhaM?: number
    // Rotativa
    puxadasNecessarias?: number
    metragemPuraMm?: number
    metragemPuraM?: number
    metrosAcertoFixo?: number
    larguraBobinaM?: number
  }
}

// ============================================================================
// CÁLCULO PARA IMPRESSÃO PLANA (FOLHAS FÍSICAS)
// ============================================================================

/**
 * Calcula consumo para impressão plana (offset, digital plana).
 *
 * Fórmulas:
 *   Folhas Puras = Qtd_Pedida / Aproveitamento
 *   Folhas Acerto = Folhas_Puras × (Percentual_Perda / 100)
 *   Total Folhas = Ceil(Folhas_Puras + Folhas_Acerto)
 *   Peso (kg) = Largura(m) × Comprimento(m) × Gramatura(g/m²) × Total_Folhas / 1000
 */
export function calcularConsumoPlana(params: ParametrosPlana): ResultadoCalculo {
  const { qtdPedida, aproveitamento, percentualPerda, larguraFolhaMm, comprimentoFolhaMm, gramaturaGm2 } = params

  if (aproveitamento <= 0) throw new Error('Aproveitamento deve ser maior que zero')
  if (gramaturaGm2 <= 0) throw new Error('Gramatura deve ser maior que zero')

  const folhasPuras = qtdPedida / aproveitamento
  const folhasAcerto = folhasPuras * (percentualPerda / 100)
  const totalFolhas = Math.ceil(folhasPuras + folhasAcerto)

  // Conversão para KG
  const larguraM = larguraFolhaMm / 1000
  const comprimentoM = comprimentoFolhaMm / 1000
  const pesoTotalKg = (larguraM * comprimentoM * gramaturaGm2 * totalFolhas) / 1000

  return {
    tipo: 'PLANA',
    folhasFisicas: totalFolhas,
    metrosLineares: null,
    pesoTotalKg: Math.round(pesoTotalKg * 1000) / 1000, // 3 casas decimais
    detalhamento: {
      qtdPedida,
      gramaturaGm2,
      folhasPuras: Math.round(folhasPuras * 100) / 100,
      folhasAcerto: Math.round(folhasAcerto * 100) / 100,
      aproveitamento,
      percentualPerda,
      larguraFolhaM: larguraM,
      comprimentoFolhaM: comprimentoM,
    },
  }
}

// ============================================================================
// CÁLCULO PARA IMPRESSÃO ROTATIVA/FLEXOGRAFIA (METROS LINEARES)
// ============================================================================

/**
 * Calcula consumo para impressão rotativa (flexo, rotogravura, digital rotativa).
 *
 * Fórmulas:
 *   Puxadas Necessárias = Qtd_Pedida / Produtos_Por_Puxada
 *   Metragem Pura (mm) = Puxadas_Necessárias × Repetição_Corte_mm
 *   Metragem Pura (m) = Metragem_Pura_mm / 1000
 *   Total Metros Lineares = Metragem_Pura_m + Metros_Acerto_Fixo
 *   Peso (kg) = Largura_Bobina(m) × Total_Metros × Gramatura(g/m²) / 1000
 */
export function calcularConsumoRotativa(params: ParametrosRotativa): ResultadoCalculo {
  const { qtdPedida, repeticaoCorteMm, produtosPorPuxada, metrosAcertoFixo, larguraBobinaMm, gramaturaGm2 } = params

  if (produtosPorPuxada <= 0) throw new Error('Produtos por puxada deve ser maior que zero')
  if (repeticaoCorteMm <= 0) throw new Error('Repetição de corte deve ser maior que zero')
  if (gramaturaGm2 <= 0) throw new Error('Gramatura deve ser maior que zero')

  const puxadasNecessarias = Math.ceil(qtdPedida / produtosPorPuxada)
  const metragemPuraMm = puxadasNecessarias * repeticaoCorteMm
  const metragemPuraM = metragemPuraMm / 1000
  const totalMetros = metragemPuraM + metrosAcertoFixo

  // Conversão para KG
  const larguraBobinaM = larguraBobinaMm / 1000
  const pesoTotalKg = (larguraBobinaM * totalMetros * gramaturaGm2) / 1000

  return {
    tipo: 'ROTATIVA',
    folhasFisicas: null,
    metrosLineares: Math.round(totalMetros * 100) / 100, // 2 casas decimais
    pesoTotalKg: Math.round(pesoTotalKg * 1000) / 1000,
    detalhamento: {
      qtdPedida,
      gramaturaGm2,
      puxadasNecessarias,
      metragemPuraMm,
      metragemPuraM: Math.round(metragemPuraM * 100) / 100,
      metrosAcertoFixo,
      larguraBobinaM,
    },
  }
}

// ============================================================================
// FUNÇÃO UNIFICADA (detecta tipo e calcula)
// ============================================================================

export function calcularConsumoGrafico(params: ParametrosCalculo): ResultadoCalculo {
  if (params.tipo === 'PLANA') {
    return calcularConsumoPlana(params)
  }
  return calcularConsumoRotativa(params)
}
