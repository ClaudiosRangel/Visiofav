/**
 * Detector de alteração de OP (Tarefa 10 / Requisitos 2.1, 2.2).
 *
 * Classifica cada `OpOrigemDTO` em NOVA / ALTERADA / INALTERADA comparando o
 * hash de conteúdo atual (`calcularHashOp`) com o hash salvo no estado local
 * para aquele `numero`:
 *   - sem registro no estado        → NOVA
 *   - registro com hash diferente   → ALTERADA
 *   - registro com hash igual       → INALTERADA
 *
 * É PURO/TESTÁVEL: recebe o estado como dependência (`LeitorHashEstado`), não lê
 * disco diretamente. O `EstadoLocal` do `state-store` satisfaz essa interface
 * (expõe `obterHash`), mas qualquer objeto com `obterHash(numero)` serve — o que
 * facilita testar sem tocar o sistema de arquivos.
 *
 * O hash usado é o ESPELHO EXATO do backend (ver `hash.ts`), para a idempotência
 * da ingestão casar dos dois lados.
 */

import type { OpOrigemDTO } from '../calcgraf-reader/calcgraf-reader'
import { calcularHashOp } from './hash'

/** Classificação de uma OP quanto ao que mudou desde a última sincronização. */
export type ClassificacaoOp = 'NOVA' | 'ALTERADA' | 'INALTERADA'

/**
 * Dependência mínima que o detector precisa do estado local: dado o número de
 * uma OP, devolve o hash salvo na última sincronização bem-sucedida, ou `null`
 * se a OP nunca foi enviada. `EstadoLocal` (state-store) implementa isto.
 */
export interface LeitorHashEstado {
  obterHash(numero: number): string | null
}

/** Resultado da classificação de UMA OP (DTO + hash atual + classificação). */
export interface OpClassificada {
  /** O DTO da OP de origem avaliado. */
  op: OpOrigemDTO
  /** Hash de conteúdo calculado agora (espelho do backend). */
  hash: string
  /** Classificação resultante. */
  classificacao: ClassificacaoOp
}

/** Agregado do resultado da detecção sobre um lote de OPs. */
export interface ResultadoDeteccao {
  /** DTOs classificados como NOVA (sem registro no estado). */
  novas: OpOrigemDTO[]
  /** DTOs classificados como ALTERADA (hash divergente do salvo). */
  alteradas: OpOrigemDTO[]
  /** Números das OPs classificadas como INALTERADA (hash igual ao salvo). */
  inalteradas: number[]
  /** Lista anotada completa (DTO + hash + classificação), na ordem de entrada. */
  classificadas: OpClassificada[]
}

/**
 * Classifica UMA OP comparando seu hash atual com o salvo no estado.
 * Função pura: mesma entrada ⇒ mesma saída.
 */
export function classificarOp(
  op: OpOrigemDTO,
  estado: LeitorHashEstado,
): OpClassificada {
  const hash = calcularHashOp(op)
  const hashSalvo = estado.obterHash(op.numero)

  let classificacao: ClassificacaoOp
  if (hashSalvo === null) {
    classificacao = 'NOVA'
  } else if (hashSalvo === hash) {
    classificacao = 'INALTERADA'
  } else {
    classificacao = 'ALTERADA'
  }

  return { op, hash, classificacao }
}

/**
 * Detecta as mudanças de um lote de OPs contra o estado local.
 *
 * Retorna tanto as listas separadas (`novas`/`alteradas`/`inalteradas`) para o
 * sender decidir o que enviar, quanto a lista anotada (`classificadas`) com o
 * hash de cada OP — útil para o sender registrar o hash no estado só após o 2xx
 * (Tarefa 11), sem recalcular.
 *
 * PURA: não lê disco; recebe o estado por parâmetro.
 */
export function detectarMudancas(
  ops: OpOrigemDTO[],
  estado: LeitorHashEstado,
): ResultadoDeteccao {
  const classificadas: OpClassificada[] = []
  const novas: OpOrigemDTO[] = []
  const alteradas: OpOrigemDTO[] = []
  const inalteradas: number[] = []

  for (const op of ops) {
    const c = classificarOp(op, estado)
    classificadas.push(c)
    switch (c.classificacao) {
      case 'NOVA':
        novas.push(c.op)
        break
      case 'ALTERADA':
        alteradas.push(c.op)
        break
      case 'INALTERADA':
        inalteradas.push(c.op.numero)
        break
    }
  }

  return { novas, alteradas, inalteradas, classificadas }
}
