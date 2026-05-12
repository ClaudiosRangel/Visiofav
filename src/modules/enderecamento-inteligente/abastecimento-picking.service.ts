/**
 * Serviço de abastecimento do picking — calcula a quantidade a ser alocada
 * no(s) endereço(s) de picking antes de distribuir o restante no pulmão.
 * Função pura — sem side-effects, recebe dados pré-fetched.
 */

// ── Tipos de Entrada ──────────────────────────────────────────────────

export interface DadosPickingConfig {
  enderecoPickingId: string
  enderecoCompleto: string
  capacidade: number // capacidadePicking (unidades master)
  pontoReposicao: number | null // null = sempre abastecer quando há espaço
  saldoAtual: number // saldo físico atual no picking
  enderecoAtivo: boolean // status do endereço
  sequencia: number // ordem de processamento
}

export interface AbastecimentoPickingInput {
  quantidadeRestante: number // quantidade total a endereçar (em unidade master)
  dadosPicking: DadosPickingConfig[] // pode ser vazio (sem picking configurado)
}

// ── Tipos de Saída ────────────────────────────────────────────────────

export interface AlocacaoPicking {
  enderecoId: string
  enderecoCompleto: string
  quantidadeAlocada: number
  areaArmazenagem: 'PICKING'
  capacidadeTotal: number
  saldoAnterior: number
  saldoResultante: number
}

export interface AbastecimentoPickingResult {
  alocacoes: AlocacaoPicking[]
  quantidadeAbastecida: number // soma de todas alocações picking
  quantidadeRestante: number // quantidade disponível para pulmão
  avisos: string[] // warnings (capacidade inválida, endereço inativo, etc.)
}

export interface AbastecimentoPickingError {
  tipo: 'PARAMETROS_INVALIDOS' | 'ERRO_INESPERADO'
  mensagem: string
}

export type AbastecimentoPickingOutput =
  | { sucesso: true; resultado: AbastecimentoPickingResult }
  | { sucesso: false; erro: AbastecimentoPickingError }

// ── Funções de Cálculo ────────────────────────────────────────────────

/**
 * Calcula a quantidade de abastecimento para um único endereço de picking.
 * Fórmula: max(0, min(quantidadeRestante, capacidade - saldoAtual))
 *
 * Pré-condições (validadas pelo chamador):
 * - quantidadeRestante >= 0
 * - saldoAtual >= 0
 * - capacidade >= 1
 *
 * @returns número inteiro representando unidades a alocar
 */
export function calcularQuantidadeUnitaria(
  quantidadeRestante: number,
  capacidade: number,
  saldoAtual: number,
): number {
  const espacoDisponivel = capacidade - saldoAtual
  return Math.max(0, Math.min(quantidadeRestante, espacoDisponivel))
}

/**
 * Calcula a quantidade a ser alocada no(s) endereço(s) de picking.
 * Função PURA — sem side-effects, sem I/O.
 *
 * Regras:
 * 1. Validar parâmetros de entrada
 * 2. Para cada DadosPickingConfig (em ordem de sequência):
 *    a. Pular se endereço inativo
 *    b. Pular se capacidade <= 0 (registrar aviso)
 *    c. Verificar ponto de reposição (se configurado e saldo > ponto, pular)
 *    d. Calcular: min(quantidadeRestante, capacidade - saldoAtual)
 *    e. Se resultado > 0: criar alocação e decrementar quantidadeRestante
 * 3. Retornar resultado com alocações e quantidade restante
 */
export function calcularAbastecimentoPicking(
  input: AbastecimentoPickingInput,
): AbastecimentoPickingOutput {
  // ── Validação de parâmetros ───────────────────────────────────────────
  if (input.quantidadeRestante < 0) {
    return {
      sucesso: false,
      erro: {
        tipo: 'PARAMETROS_INVALIDOS',
        mensagem: 'quantidadeRestante não pode ser negativa',
      },
    }
  }

  for (const config of input.dadosPicking) {
    if (config.saldoAtual < 0) {
      return {
        sucesso: false,
        erro: {
          tipo: 'PARAMETROS_INVALIDOS',
          mensagem: `saldoAtual não pode ser negativo para endereço ${config.enderecoPickingId}`,
        },
      }
    }
    if (config.capacidade < 1) {
      return {
        sucesso: false,
        erro: {
          tipo: 'PARAMETROS_INVALIDOS',
          mensagem: `capacidade deve ser >= 1 para endereço ${config.enderecoPickingId}`,
        },
      }
    }
  }

  // ── Ordenar por sequência crescente ───────────────────────────────────
  const dadosOrdenados = [...input.dadosPicking].sort(
    (a, b) => a.sequencia - b.sequencia,
  )

  // ── Processar cada endereço de picking ────────────────────────────────
  const alocacoes: AlocacaoPicking[] = []
  const avisos: string[] = []
  let quantidadeRestante = input.quantidadeRestante

  for (const config of dadosOrdenados) {
    // Pular se não há mais quantidade para alocar
    if (quantidadeRestante <= 0) break

    // Pular se endereço inativo
    if (!config.enderecoAtivo) {
      avisos.push(
        `Endereço ${config.enderecoCompleto} (${config.enderecoPickingId}) está inativo, pulando abastecimento`,
      )
      continue
    }

    // Pular se capacidade inválida (<=0)
    if (config.capacidade <= 0) {
      avisos.push(
        `Capacidade inválida (${config.capacidade}) para endereço ${config.enderecoPickingId}, pulando abastecimento`,
      )
      continue
    }

    // Verificar ponto de reposição
    if (
      config.pontoReposicao !== null &&
      config.pontoReposicao > 0 &&
      config.saldoAtual > config.pontoReposicao
    ) {
      // Saldo acima do ponto de reposição — não abastecer
      continue
    }

    // pontoReposicao nulo, zero ou negativo → tratar como inativo (sempre abastecer quando há espaço)
    // Calcular quantidade de abastecimento
    const quantidade = calcularQuantidadeUnitaria(
      quantidadeRestante,
      config.capacidade,
      config.saldoAtual,
    )

    if (quantidade > 0) {
      alocacoes.push({
        enderecoId: config.enderecoPickingId,
        enderecoCompleto: config.enderecoCompleto,
        quantidadeAlocada: quantidade,
        areaArmazenagem: 'PICKING',
        capacidadeTotal: config.capacidade,
        saldoAnterior: config.saldoAtual,
        saldoResultante: config.saldoAtual + quantidade,
      })
      quantidadeRestante -= quantidade
    }
  }

  // ── Montar resultado ──────────────────────────────────────────────────
  const quantidadeAbastecida = alocacoes.reduce(
    (soma, a) => soma + a.quantidadeAlocada,
    0,
  )

  return {
    sucesso: true,
    resultado: {
      alocacoes,
      quantidadeAbastecida,
      quantidadeRestante,
      avisos,
    },
  }
}
