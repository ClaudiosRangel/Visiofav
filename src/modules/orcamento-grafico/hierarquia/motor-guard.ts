/**
 * Guard de "motor intacto" (spec orcamento-grafico-hierarquia-item-plano, tarefa 1.9; Req. 15.1, 15.2).
 *
 * Extrai do CÓDIGO-FONTE o corpo de `calcularOrcamentoGrafico` e de `ancorarCustoCalcgraf`
 * e calcula o SHA-256 do texto normalizado (fim de linha LF, sem espaços no fim de cada linha).
 * Só leitura de arquivo: não importa nem executa o motor.
 */
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const RAIZ_MODULO = resolve(__dirname, '..')

export interface AlvoGuard {
  nome: 'calcularOrcamentoGrafico' | 'ancorarCustoCalcgraf'
  arquivo: string
  /** Início da assinatura (a linha começa por isto). */
  assinatura: RegExp
}

export const ALVOS_GUARD: readonly AlvoGuard[] = [
  {
    nome: 'calcularOrcamentoGrafico',
    arquivo: resolve(RAIZ_MODULO, 'orcamento-grafico-calculo.service.ts'),
    assinatura: /^export function calcularOrcamentoGrafico\(/m,
  },
  {
    nome: 'ancorarCustoCalcgraf',
    arquivo: resolve(RAIZ_MODULO, 'orcamento-grafico.routes.ts'),
    assinatura: /^async function ancorarCustoCalcgraf\(/m,
  },
]

function normalizar(texto: string): string {
  return texto
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((l) => l.replace(/\s+$/, ''))
    .join('\n')
}

/** Corpo completo da função: da assinatura até o `}` na coluna 0 que a fecha. */
export function extrairCorpoFuncao(alvo: AlvoGuard): string {
  const fonte = normalizar(readFileSync(alvo.arquivo, 'utf8'))
  const m = alvo.assinatura.exec(fonte)
  if (!m) throw new Error(`Guard do motor: assinatura de ${alvo.nome} não encontrada em ${alvo.arquivo}`)
  const resto = fonte.slice(m.index)
  const fim = resto.indexOf('\n}\n')
  if (fim < 0) throw new Error(`Guard do motor: fim de ${alvo.nome} não encontrado`)
  return resto.slice(0, fim + 2)
}

export function hashTexto(texto: string): string {
  return createHash('sha256').update(texto, 'utf8').digest('hex')
}

export function hashCorpoFuncao(alvo: AlvoGuard): string {
  return hashTexto(extrairCorpoFuncao(alvo))
}

/**
 * Hashes do código de HOJE (árvore de trabalho antes de qualquer tarefa que mexa no motor).
 * Só mudam com decisão registrada do usuário; a spec proíbe alterar o motor e a ancoragem.
 */
export const HASH_BASELINE_MOTOR: Readonly<Record<AlvoGuard['nome'], string>> = {
  calcularOrcamentoGrafico: '840a216558e72323bf56b5a8d78a85fa79866dae70740cdf7f40c9e315396e24',
  ancorarCustoCalcgraf: 'c440441405df3380138b229e82a86b94b2b47c294924e8afc162d607516269bc',
}
