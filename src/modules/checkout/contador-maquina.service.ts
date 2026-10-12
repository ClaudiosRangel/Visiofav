/**
 * Contagem por Contador de Máquina — regra PURA (spec
 * checkout-contagem-por-contador).
 *
 * Centros com `modoContagem = CONTADOR` apontam Produção pela leitura do
 * display (odômetro acumulativo da máquina): quantidade = leituraFinal −
 * leituraInicial. A inicial é derivada automaticamente (última final do centro,
 * ou 0 no 1º apontamento do dia quando o centro zera diariamente).
 *
 * Este arquivo é PURO (sem Prisma) para teste isolado. O I/O (buscar última
 * leitura, "tem leitura hoje", gravar) fica nas rotas/handlers do checkout.
 */

/** Erro de regra de contagem (status + mensagem), consumido pelo handler. */
export class ContadorError extends Error {
  constructor(public statusCode: number, message: string) {
    super(message)
    this.name = 'ContadorError'
  }
}

// ============================================================================
// Data civil local (America/Sao_Paulo) — reset diário é por DIA civil local.
// Mesmo padrão do projeto (offset -3h) usado em fmtDataHora do CT-e/NF-e.
// ============================================================================

/** Retorna a data civil (YYYY-MM-DD) em America/Sao_Paulo para um instante. */
export function dataCivilBrasilia(instante: Date = new Date()): string {
  const br = new Date(instante.getTime() - 3 * 60 * 60 * 1000)
  return br.toISOString().slice(0, 10)
}

/** True se dois instantes caem no MESMO dia civil local (Brasília). */
export function mesmoDiaBrasilia(a: Date, b: Date): boolean {
  return dataCivilBrasilia(a) === dataCivilBrasilia(b)
}

// ============================================================================
// Derivação da leitura inicial (Req 3)
// ============================================================================

export interface DerivarInicialInput {
  /** Última leitura FINAL registrada para o centro (null se nunca houve). */
  ultimaLeituraFinalDoCentro: number | null
  /** Centro reseta o display no início do dia? (CentroProducao.contadorZeraDiariamente) */
  zeraDiariamente: boolean
  /** Já existe alguma leitura do centro HOJE (data civil local)? */
  jaTemLeituraHoje: boolean
}

export interface DerivarInicialResultado {
  leituraInicial: number
  /** true quando a inicial foi assumida 0 por reset diário (1º do dia). */
  resetDoDia: boolean
}

/**
 * Deriva a leitura inicial do próximo apontamento de Produção (modo CONTADOR):
 *  - zera-diário E ainda não há leitura hoje  → 0 (display resetou no 1º turno)
 *  - senão, se há última final                → última final (odômetro contínuo)
 *  - senão (primeira vez)                      → 0
 */
export function derivarInicial(input: DerivarInicialInput): DerivarInicialResultado {
  if (input.zeraDiariamente && !input.jaTemLeituraHoje) {
    return { leituraInicial: 0, resetDoDia: true }
  }
  if (input.ultimaLeituraFinalDoCentro != null) {
    return { leituraInicial: input.ultimaLeituraFinalDoCentro, resetDoDia: false }
  }
  return { leituraInicial: 0, resetDoDia: false }
}

// ============================================================================
// Cálculo da quantidade (Req 2.3/2.4/2.5)
// ============================================================================

/**
 * Quantidade produzida no intervalo = final − inicial. Sem rollover nesta fase:
 * final < inicial é ERRO (ContadorError 400). final = inicial → 0 (aceito).
 */
export function calcularQuantidade(leituraInicial: number, leituraFinal: number): number {
  if (!Number.isFinite(leituraInicial) || !Number.isFinite(leituraFinal)) {
    throw new ContadorError(400, 'Leituras do contador inválidas.')
  }
  if (leituraFinal < leituraInicial) {
    throw new ContadorError(
      400,
      `Leitura final (${leituraFinal}) menor que a inicial (${leituraInicial}). ` +
        'Verifique o número do contador.',
    )
  }
  return leituraFinal - leituraInicial
}

// ============================================================================
// Validação de consistência da cadeia (Req 4.4/4.5) — correção pelo histórico
// ============================================================================

export interface LeituraCadeia {
  id: string
  leituraInicial: number
  leituraFinal: number
  resetDoDia: boolean
  /** Ordem cronológica (asc) já garantida pelo caller. */
}

export interface InconsistenciaCadeia {
  leituraId: string
  campo: 'leituraInicial' | 'leituraFinal'
  valorAtual: number
  valorEsperado: number
  motivo: string
}

/**
 * Valida a cadeia de leituras de um centro (ordem cronológica asc). Regras:
 *  - a inicial de cada leitura deve casar com a final da anterior, EXCETO
 *    quando `resetDoDia` da leitura atual é true (aí a inicial esperada é 0);
 *  - a final nunca pode ser menor que a inicial (quantidade negativa).
 * Retorna a lista de inconsistências (vazia = cadeia OK). Usada ao corrigir
 * uma leitura pelo histórico — mostra o `valorEsperado` para o usuário.
 */
export function validarCadeia(leituras: LeituraCadeia[]): InconsistenciaCadeia[] {
  const problemas: InconsistenciaCadeia[] = []
  for (let i = 0; i < leituras.length; i++) {
    const atual = leituras[i]
    // Quantidade não-negativa.
    if (atual.leituraFinal < atual.leituraInicial) {
      problemas.push({
        leituraId: atual.id,
        campo: 'leituraFinal',
        valorAtual: atual.leituraFinal,
        valorEsperado: atual.leituraInicial,
        motivo: 'A leitura final não pode ser menor que a inicial (quantidade negativa).',
      })
    }
    // Contiguidade com a anterior (salvo reset diário).
    if (i > 0) {
      const anterior = leituras[i - 1]
      const esperadoInicial = atual.resetDoDia ? 0 : anterior.leituraFinal
      if (atual.leituraInicial !== esperadoInicial) {
        problemas.push({
          leituraId: atual.id,
          campo: 'leituraInicial',
          valorAtual: atual.leituraInicial,
          valorEsperado: esperadoInicial,
          motivo: atual.resetDoDia
            ? 'Primeira leitura do dia (reset): a inicial deve ser 0.'
            : 'A inicial deve ser igual à final da leitura anterior.',
        })
      }
    }
  }
  return problemas
}
