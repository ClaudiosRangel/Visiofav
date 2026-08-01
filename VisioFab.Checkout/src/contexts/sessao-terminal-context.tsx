'use client'

// Contexto React da Sessão_Terminal — expõe o Centro_Producao vinculado à
// sessão ativa, o tempo restante até a expiração (contagem decrescente) e a
// função de encerramento manual da sessão (logout do Terminal).
//
// A autenticação de PIN do Operador (Requirement 2) NÃO faz parte deste
// contexto — aqui só existe o dado da Sessão_Terminal (Requirement 1), que
// dura um turno inteiro (até 12h).
//
// _Requirements: 1.4_

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { useRouter } from 'next/navigation'
import { limparToken, obterToken } from '@/lib/checkout-api-client'

/** Chaves próprias de localStorage usadas para persistir os dados da Sessão_Terminal. */
const CENTRO_PRODUCAO_ID_STORAGE_KEY = 'checkout_centro_producao_id'
const SESSAO_TERMINAL_ID_STORAGE_KEY = 'checkout_sessao_terminal_id'
const EXPIRA_EM_STORAGE_KEY = 'checkout_expira_em'

/** Rota de login do Terminal, para onde o Terminal é redirecionado ao encerrar a sessão. */
const LOGIN_TERMINAL_PATH = '/login-terminal'

/** Dados retornados por `POST /checkout/auth/sessao` necessários para iniciar a sessão no contexto. */
export interface IniciarSessaoParams {
  centroProducaoId: string
  sessaoTerminalId: string
  expiraEm: string | Date
}

export interface SessaoTerminalContextValue {
  /** Centro_Producao vinculado à Sessão_Terminal ativa, ou `null` se não houver sessão. */
  centroProducaoId: string | null
  /** Id da Sessão_Terminal ativa, ou `null` se não houver sessão. */
  sessaoTerminalId: string | null
  /** Instante de expiração da Sessão_Terminal, ou `null` se não houver sessão. */
  expiraEm: Date | null
  /** Tempo restante até a expiração, em milissegundos (nunca negativo). */
  tempoRestanteMs: number
  /** `true` quando há Token_Checkout salvo e a Sessão_Terminal ainda não expirou. */
  estaAutenticado: boolean
  /** Persiste os dados da Sessão_Terminal recém-criada e atualiza o contexto. */
  iniciarSessao: (dados: IniciarSessaoParams) => void
  /** Encerra a Sessão_Terminal manualmente: limpa token + dados locais e redireciona para o login. */
  encerrarSessao: () => void
}

const SessaoTerminalContext = createContext<SessaoTerminalContextValue | null>(null)

interface SessaoTerminalState {
  centroProducaoId: string | null
  sessaoTerminalId: string | null
  expiraEm: Date | null
}

const ESTADO_VAZIO: SessaoTerminalState = {
  centroProducaoId: null,
  sessaoTerminalId: null,
  expiraEm: null,
}

/** Lê os dados da Sessão_Terminal persistidos em localStorage, se houver. */
function restaurarEstadoDoStorage(): SessaoTerminalState {
  if (typeof window === 'undefined') return ESTADO_VAZIO

  const centroProducaoId = window.localStorage.getItem(CENTRO_PRODUCAO_ID_STORAGE_KEY)
  const sessaoTerminalId = window.localStorage.getItem(SESSAO_TERMINAL_ID_STORAGE_KEY)
  const expiraEmRaw = window.localStorage.getItem(EXPIRA_EM_STORAGE_KEY)

  if (!centroProducaoId || !sessaoTerminalId || !expiraEmRaw) {
    return ESTADO_VAZIO
  }

  const expiraEm = new Date(expiraEmRaw)
  if (Number.isNaN(expiraEm.getTime())) {
    return ESTADO_VAZIO
  }

  return { centroProducaoId, sessaoTerminalId, expiraEm }
}

/** Persiste os dados da Sessão_Terminal em localStorage (chaves próprias do contexto). */
function persistirEstadoNoStorage(dados: IniciarSessaoParams): void {
  if (typeof window === 'undefined') return

  const expiraEm = dados.expiraEm instanceof Date ? dados.expiraEm : new Date(dados.expiraEm)

  window.localStorage.setItem(CENTRO_PRODUCAO_ID_STORAGE_KEY, dados.centroProducaoId)
  window.localStorage.setItem(SESSAO_TERMINAL_ID_STORAGE_KEY, dados.sessaoTerminalId)
  window.localStorage.setItem(EXPIRA_EM_STORAGE_KEY, expiraEm.toISOString())
}

/** Remove os dados da Sessão_Terminal de localStorage. */
function limparEstadoDoStorage(): void {
  if (typeof window === 'undefined') return

  window.localStorage.removeItem(CENTRO_PRODUCAO_ID_STORAGE_KEY)
  window.localStorage.removeItem(SESSAO_TERMINAL_ID_STORAGE_KEY)
  window.localStorage.removeItem(EXPIRA_EM_STORAGE_KEY)
}

/** Calcula o tempo restante até `expiraEm`, nunca negativo. */
function calcularTempoRestanteMs(expiraEm: Date | null): number {
  if (!expiraEm) return 0
  return Math.max(0, expiraEm.getTime() - Date.now())
}

export function SessaoTerminalProvider({ children }: { children: ReactNode }) {
  const router = useRouter()
  const [estado, setEstado] = useState<SessaoTerminalState>(ESTADO_VAZIO)
  const [tempoRestanteMs, setTempoRestanteMs] = useState(0)

  const encerrarSessao = useCallback(() => {
    limparToken()
    limparEstadoDoStorage()
    setEstado(ESTADO_VAZIO)
    setTempoRestanteMs(0)
    router.push(LOGIN_TERMINAL_PATH)
  }, [router])

  const iniciarSessao = useCallback((dados: IniciarSessaoParams) => {
    const expiraEm = dados.expiraEm instanceof Date ? dados.expiraEm : new Date(dados.expiraEm)
    persistirEstadoNoStorage(dados)
    setEstado({
      centroProducaoId: dados.centroProducaoId,
      sessaoTerminalId: dados.sessaoTerminalId,
      expiraEm,
    })
    setTempoRestanteMs(calcularTempoRestanteMs(expiraEm))
  }, [])

  // Ao montar, tenta restaurar a sessão persistida em localStorage. Se a
  // sessão restaurada já expirou, encerra automaticamente.
  useEffect(() => {
    const restaurado = restaurarEstadoDoStorage()
    if (!restaurado.expiraEm) return

    if (calcularTempoRestanteMs(restaurado.expiraEm) <= 0) {
      encerrarSessao()
      return
    }

    setEstado(restaurado)
    setTempoRestanteMs(calcularTempoRestanteMs(restaurado.expiraEm))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Contagem decrescente do tempo restante da sessão, atualizada a cada
  // segundo. Ao chegar a zero, encerra a sessão automaticamente.
  useEffect(() => {
    if (!estado.expiraEm) return

    const intervalId = setInterval(() => {
      const restante = calcularTempoRestanteMs(estado.expiraEm)
      setTempoRestanteMs(restante)
      if (restante <= 0) {
        encerrarSessao()
      }
    }, 1000)

    return () => clearInterval(intervalId)
  }, [estado.expiraEm, encerrarSessao])

  const estaAutenticado = useMemo(
    () => Boolean(obterToken()) && estado.sessaoTerminalId !== null && tempoRestanteMs > 0,
    [estado.sessaoTerminalId, tempoRestanteMs],
  )

  const value = useMemo<SessaoTerminalContextValue>(
    () => ({
      centroProducaoId: estado.centroProducaoId,
      sessaoTerminalId: estado.sessaoTerminalId,
      expiraEm: estado.expiraEm,
      tempoRestanteMs,
      estaAutenticado,
      iniciarSessao,
      encerrarSessao,
    }),
    [estado, tempoRestanteMs, estaAutenticado, iniciarSessao, encerrarSessao],
  )

  return <SessaoTerminalContext.Provider value={value}>{children}</SessaoTerminalContext.Provider>
}

/** Hook de acesso ao contexto da Sessão_Terminal. Deve ser usado dentro de `SessaoTerminalProvider`. */
export function useSessaoTerminal(): SessaoTerminalContextValue {
  const context = useContext(SessaoTerminalContext)
  if (!context) {
    throw new Error('useSessaoTerminal deve ser usado dentro de um SessaoTerminalProvider')
  }
  return context
}
