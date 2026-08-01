'use client'

// Tela de identificação do Operador por PIN (tasks 19.2 e 19.3 do spec
// `checkout-apontamento`) — usa o teclado numérico `PinKeypad`
// (`lib/pin-keypad.tsx`) para o Operador digitar seu PIN de 6 dígitos e
// chama `POST /operador/identificar` automaticamente ao completar o PIN.
//
// _Requirements: 2.2, 2.3, 2.4, 4.3_

import { Suspense, useEffect, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import axios from 'axios'
import { checkoutApiClient } from '@/lib/checkout-api-client'
import { PinKeypad } from '@/lib/pin-keypad'
import { useSessaoTerminal } from '@/contexts/sessao-terminal-context'
import styles from './identificar-operador.module.css'

const PIN_LENGTH = 6

/**
 * Mensagem genérica exibida em PIN inválido (401) — nunca revela se o PIN
 * existe para outro Funcionario, da mesma empresa ou de outra
 * (Requirement 2.3). O backend (`pin-operador.service.ts`) já responde com
 * mensagem curta e segura, mas mantemos um texto próprio fixo aqui, mesmo
 * padrão já usado em `login-terminal/page.tsx`.
 */
const MENSAGEM_ERRO_GENERICA = 'PIN inválido'

/** Chaves de localStorage usadas para expor o Funcionario identificado. */
const FUNCIONARIO_ID_STORAGE_KEY = 'checkout_funcionario_identificado_id'
const FUNCIONARIO_NOME_STORAGE_KEY = 'checkout_funcionario_identificado_nome'

interface RespostaIdentificarOperador {
  funcionarioId: string
  nome: string
}

/**
 * NOTA DE DECISÃO (task 19.2): o design.md não especifica exatamente qual
 * é "a ação seguinte" a partir desta tela isoladamente — as telas que
 * consumiriam o Funcionario identificado (painel/etapa, tasks 20/21) ainda
 * não formalizam esse consumo. Para não acoplar esta tela a uma tela
 * futura específica, o `funcionarioId`/`nome` retornado é salvo em
 * localStorage sob chaves dedicadas do Checkout, e o Terminal navega para
 * `/painel` — que pode ler esses valores quando precisar (ex.: ao iniciar
 * uma etapa em nome deste Operador).
 */
function salvarFuncionarioIdentificado(funcionarioId: string, nome: string): void {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(FUNCIONARIO_ID_STORAGE_KEY, funcionarioId)
  window.localStorage.setItem(FUNCIONARIO_NOME_STORAGE_KEY, nome)
}

/**
 * Extrai a quantidade de minutos restante de bloqueio a partir da
 * mensagem retornada pelo backend em caso de 429
 * (`pin-operador.service.ts#identificarOperadorPorPin`): "Terminal
 * bloqueado por excesso de tentativas. Tente novamente em N minuto(s)."
 * Não há campo estruturado dedicado para esse tempo, só a mensagem em
 * texto — por isso o parse simples aqui. Retorna 1 minuto como fallback
 * conservador se o formato não puder ser interpretado, para nunca
 * reabilitar o teclado antes do tempo real de bloqueio no backend.
 */
function extrairMinutosRestantes(mensagem: string | undefined): number {
  const match = mensagem?.match(/(\d+)\s*minuto/)
  if (match) {
    const minutos = parseInt(match[1], 10)
    if (!Number.isNaN(minutos) && minutos > 0) return minutos
  }
  return 1
}

/** Formata segundos como "M:SS" para exibição da contagem decrescente. */
function formatarTempoRestante(segundos: number): string {
  const minutos = Math.floor(segundos / 60)
  const segundosRestantes = segundos % 60
  return `${minutos}:${segundosRestantes.toString().padStart(2, '0')}`
}

// `useSearchParams()` exige um Suspense boundary quando a página é
// pré-renderizada estaticamente (Next.js 15 App Router) — o export
// default abaixo envolve o conteúdo real (`IdentificarOperadorContent`)
// nesse boundary. O fallback é `null` (mesmo padrão de "sem UI própria
// durante o carregamento" já usado nas proteções de rota client-side
// deste app).
export default function IdentificarOperadorPage() {
  return (
    <Suspense fallback={null}>
      <IdentificarOperadorContent />
    </Suspense>
  )
}

function IdentificarOperadorContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { estaAutenticado } = useSessaoTerminal()
  // Task 29.1 — destino após identificação bem-sucedida (Requirement
  // 1.7/5.4): quando a tela é acessada com `?redirect=/etapa/xxx`, volta
  // para onde o Operador estava em vez de navegar sempre para `/painel`.
  const destinoAposIdentificar = searchParams.get('redirect') || '/painel'
  const [pin, setPin] = useState('')
  const [erro, setErro] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)
  const [segundosBloqueio, setSegundosBloqueio] = useState(0)
  const enviandoRef = useRef(false)

  // Proteção básica de rota client-side (task 29.1, item 5): sem
  // Sessão_Terminal ativa, não há Token_Checkout para chamar
  // `POST /operador/identificar` (mesmo padrão de `painel/page.tsx`).
  useEffect(() => {
    if (!estaAutenticado) {
      router.push('/login-terminal')
    }
  }, [estaAutenticado, router])

  // Contagem decrescente local do bloqueio por rate limiting (Requirement
  // 4.3) — reabilita o teclado automaticamente quando o tempo restante
  // chega a zero, sem exigir nenhuma ação do Operador/Supervisor.
  useEffect(() => {
    if (segundosBloqueio <= 0) return

    const intervalId = setInterval(() => {
      setSegundosBloqueio((atual) => Math.max(0, atual - 1))
    }, 1000)

    return () => clearInterval(intervalId)
  }, [segundosBloqueio])

  async function identificar(pinCompleto: string) {
    if (enviandoRef.current) return
    enviandoRef.current = true
    setEnviando(true)
    setErro(null)

    try {
      const response = await checkoutApiClient.post<RespostaIdentificarOperador>(
        '/operador/identificar',
        { pin: pinCompleto },
      )

      salvarFuncionarioIdentificado(response.data.funcionarioId, response.data.nome)
      router.push(destinoAposIdentificar)
    } catch (err) {
      setPin('')

      if (axios.isAxiosError(err) && err.response?.status === 429) {
        const minutos = extrairMinutosRestantes(
          (err.response.data as { message?: string } | undefined)?.message,
        )
        setSegundosBloqueio(minutos * 60)
      } else {
        // 401 (PIN inválido) e qualquer outro erro: mensagem genérica —
        // nunca revela se o PIN pertence a outro Funcionario (Requirement 2.3).
        setErro(MENSAGEM_ERRO_GENERICA)
      }
    } finally {
      setEnviando(false)
      enviandoRef.current = false
    }
  }

  const bloqueado = segundosBloqueio > 0
  const tecladoDesabilitado = bloqueado || enviando

  if (!estaAutenticado) {
    return null
  }

  return (
    <div className={styles.container}>
      <div className={styles.card}>
        <h1 className={styles.title}>Identificação do Operador</h1>
        <p className={styles.subtitle}>Digite seu PIN de 6 dígitos</p>

        {erro && <p className={styles.errorMessage}>{erro}</p>}

        {bloqueado && (
          <p className={styles.blockMessage} role="status">
            Terminal bloqueado por excesso de tentativas. Tente novamente em{' '}
            {formatarTempoRestante(segundosBloqueio)}.
          </p>
        )}

        <PinKeypad
          value={pin}
          onChange={setPin}
          maxLength={PIN_LENGTH}
          disabled={tecladoDesabilitado}
          onComplete={identificar}
        />
      </div>
    </div>
  )
}
