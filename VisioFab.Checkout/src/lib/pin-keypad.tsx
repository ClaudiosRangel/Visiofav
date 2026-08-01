'use client'

// Componente de teclado numérico (PIN) — usado pela tela `identificar-operador`
// (Requirement 2) para o Operador digitar seu PIN de 6 dígitos.
//
// Regras de design importantes:
// - NÃO exibe nenhuma lista de nomes/matrículas de Funcionário (Requirement 2.5)
//   — é um teclado numérico puro, sem autocomplete/sugestões.
// - Botões com no mínimo 48x48px de área de toque (Requirement 14.2).
// - O progresso do PIN é exibido como bolinhas preenchidas (estilo campo de
//   senha visual), nunca os dígitos reais em texto claro.
//
// Este componente é isolado/testável: recebe `value`/`onChange` (padrão
// controlado, sem estado interno do PIN) e não faz nenhuma chamada de rede.
//
// _Requirements: 2.5, 14.2_

import styles from './pin-keypad.module.css'

export interface PinKeypadProps {
  /** Dígitos já digitados do PIN (ex.: "123"). Componente controlado. */
  value: string
  /** Chamado com o novo valor a cada dígito digitado ou backspace. */
  onChange: (novoValor: string) => void
  /** Quantidade máxima de dígitos do PIN. Default: 6. */
  maxLength?: number
  /** Desabilita o teclado (ex.: bloqueio por rate limiting). */
  disabled?: boolean
  /** Chamado automaticamente quando o PIN atinge `maxLength`. */
  onComplete?: (pin: string) => void
}

const DEFAULT_MAX_LENGTH = 6

/** Layout do teclado: 1-2-3 / 4-5-6 / 7-8-9 / vazio-0-backspace. */
const TECLAS_NUMERICAS: readonly string[] = ['1', '2', '3', '4', '5', '6', '7', '8', '9']

export function PinKeypad({
  value,
  onChange,
  maxLength = DEFAULT_MAX_LENGTH,
  disabled = false,
  onComplete,
}: PinKeypadProps) {
  function digitar(digito: string) {
    if (disabled) return
    if (value.length >= maxLength) return

    const novoValor = value + digito
    onChange(novoValor)

    if (novoValor.length === maxLength) {
      onComplete?.(novoValor)
    }
  }

  function apagar() {
    if (disabled) return
    if (value.length === 0) return
    onChange(value.slice(0, -1))
  }

  return (
    <div className={styles.container}>
      <div
        className={styles.dots}
        role="status"
        aria-label={`${value.length} de ${maxLength} dígitos do PIN preenchidos`}
      >
        {Array.from({ length: maxLength }, (_, indice) => (
          <span
            key={indice}
            className={`${styles.dot} ${indice < value.length ? styles.dotFilled : ''}`}
          />
        ))}
      </div>

      <div className={styles.grid}>
        {TECLAS_NUMERICAS.map((digito) => (
          <button
            key={digito}
            type="button"
            className={styles.key}
            disabled={disabled}
            onClick={() => digitar(digito)}
            aria-label={`Dígito ${digito}`}
          >
            {digito}
          </button>
        ))}

        <span className={`${styles.key} ${styles.keyEmpty}`} aria-hidden="true" />

        <button
          type="button"
          className={styles.key}
          disabled={disabled}
          onClick={() => digitar('0')}
          aria-label="Dígito 0"
        >
          0
        </button>

        <button
          type="button"
          className={`${styles.key} ${styles.keyBackspace}`}
          disabled={disabled || value.length === 0}
          onClick={apagar}
          aria-label="Apagar último dígito"
        >
          ⌫
        </button>
      </div>
    </div>
  )
}

export default PinKeypad
