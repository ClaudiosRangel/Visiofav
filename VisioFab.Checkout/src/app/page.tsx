'use client'

// Página raiz do Checkout — redireciona automaticamente para a tela
// apropriada conforme o estado da Sessão_Terminal (task 29.1, "amarração
// final" de navegação do spec `checkout-apontamento`):
//
// - Sem Sessão_Terminal ativa: redireciona para `/login-terminal`.
// - Com Sessão_Terminal ativa: redireciona para `/painel`.
//
// Não há UI própria além de uma mensagem transitória — o redirecionamento
// acontece assim que o estado de `useSessaoTerminal()` está disponível.
//
// _Requirements: 1.7, 3.4, 5.4_

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useSessaoTerminal } from '@/contexts/sessao-terminal-context'

export default function Home() {
  const router = useRouter()
  const { estaAutenticado } = useSessaoTerminal()

  useEffect(() => {
    router.replace(estaAutenticado ? '/painel' : '/login-terminal')
  }, [estaAutenticado, router])

  return null
}
