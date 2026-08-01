// Cliente axios do Checkout — anexa o Token_Checkout (Bearer) armazenado
// localmente em toda requisição e trata expiração/invalidez de sessão (401)
// redirecionando o Terminal para a tela de login.
//
// Este módulo é puro (sem JSX, sem hooks do Next.js) para permanecer
// desacoplado do React — o contexto de sessão (16.2) consome as funções
// auxiliares abaixo em vez de este arquivo depender dele.
//
// _Requirements: 1.7, 3.4_

import axios, { type InternalAxiosRequestConfig } from 'axios'

/** Chave usada no localStorage para persistir o Token_Checkout do Terminal. */
export const CHECKOUT_TOKEN_STORAGE_KEY = 'checkout_token'

/** Rota de login do Terminal, para onde o Terminal é redirecionado após 401. */
const LOGIN_TERMINAL_PATH = '/login-terminal'

/**
 * Salva o Token_Checkout no localStorage.
 * Não faz nada em ambiente sem `window` (renderização no servidor).
 */
export function salvarToken(token: string): void {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(CHECKOUT_TOKEN_STORAGE_KEY, token)
}

/**
 * Lê o Token_Checkout armazenado no localStorage.
 * Retorna `null` se não houver token ou em ambiente sem `window`.
 */
export function obterToken(): string | null {
  if (typeof window === 'undefined') return null
  return window.localStorage.getItem(CHECKOUT_TOKEN_STORAGE_KEY)
}

/** Remove o Token_Checkout do localStorage. */
export function limparToken(): void {
  if (typeof window === 'undefined') return
  window.localStorage.removeItem(CHECKOUT_TOKEN_STORAGE_KEY)
}

/**
 * Limpa a sessão do Terminal (Token_Checkout) e redireciona para a tela de
 * login do Terminal. Reutilizável fora do interceptor de resposta (ex.:
 * encerramento manual de sessão).
 */
export function limparSessaoELogin(): void {
  limparToken()
  if (typeof window !== 'undefined') {
    window.location.href = LOGIN_TERMINAL_PATH
  }
}

/** Instância axios do Checkout, com `baseURL` da API do Checkout. */
export const checkoutApiClient = axios.create({
  baseURL: process.env.NEXT_PUBLIC_CHECKOUT_API_URL,
})

// Interceptor de request — anexa o Token_Checkout (Bearer) em toda
// requisição, quando houver um token armazenado.
checkoutApiClient.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  const token = obterToken()
  if (token) {
    config.headers.set('Authorization', `Bearer ${token}`)
  }
  return config
})

// Interceptor de response — em caso de 401 (token expirado/inválido), limpa
// a sessão do Terminal e redireciona para login-terminal.
checkoutApiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    if (axios.isAxiosError(error) && error.response?.status === 401) {
      limparSessaoELogin()
    }
    return Promise.reject(error)
  },
)

export default checkoutApiClient
