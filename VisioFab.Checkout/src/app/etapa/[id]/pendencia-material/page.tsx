'use client'

// Tela de registro de falta de material durante a produção (task 25.1) do
// spec `checkout-apontamento`.
//
// Permite ao Operador registrar a falta de material sem sair da tela de
// apontamento (Requirement 12.1): um formulário simples com um único campo
// opcional (descrição) e um botão de ação principal, chamando
// `POST /checkout/etapas/:id/pendencia-material`. O backend, ao criar a
// Pendência_Material, também pausa a Etapa com motivo `FALTA_MATERIAL`
// (Requirement 12.3) — por isso, após o registro, a tela informa que a
// etapa foi pausada e oferece a ação de resolver a pendência
// (`PATCH /checkout/pendencias-material/:id/resolver`, Requirement 12.4),
// usando o `id` da Pendência_Material (não o `id` da Etapa) retornado pela
// criação, mantido em estado local desta tela.
//
// A qualquer momento o Operador pode voltar para a tela de ação principal
// da Etapa, sem precisar resolver a pendência antes (Requirement 14.2, 14.3
// — uma ação principal em destaque, mínimo de campos por tela).
//
// _Requirements: 12.1, 12.3, 12.4_

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { checkoutApiClient } from '@/lib/checkout-api-client'
import { useSessaoTerminal } from '@/contexts/sessao-terminal-context'
import styles from './pendencia-material.module.css'

/** Shape da `PendenciaMaterial` retornada por `POST /etapas/:id/pendencia-material`. */
interface PendenciaMaterial {
  id: string
  status: string
}

export default function PendenciaMaterialPage() {
  const params = useParams<{ id: string }>()
  const etapaId = params.id
  const router = useRouter()
  const { estaAutenticado } = useSessaoTerminal()

  // Proteção básica de rota client-side (task 29.1, item 5), mesmo
  // padrão já usado em `painel/page.tsx` e `etapa/[id]/page.tsx`.
  useEffect(() => {
    if (!estaAutenticado) {
      router.push('/login-terminal')
    }
  }, [estaAutenticado, router])

  const [descricao, setDescricao] = useState('')
  const [registrando, setRegistrando] = useState(false)
  const [erroRegistro, setErroRegistro] = useState<string | null>(null)
  const [pendencia, setPendencia] = useState<PendenciaMaterial | null>(null)

  const [resolvendo, setResolvendo] = useState(false)
  const [erroResolver, setErroResolver] = useState<string | null>(null)

  if (!estaAutenticado) {
    return null
  }

  async function registrarPendencia() {
    if (registrando) return
    setRegistrando(true)
    setErroRegistro(null)

    try {
      const response = await checkoutApiClient.post<PendenciaMaterial>(
        `/etapas/${etapaId}/pendencia-material`,
        { descricao: descricao.trim() || undefined },
      )
      setPendencia(response.data)
    } catch {
      setErroRegistro('Não foi possível registrar a falta de material. Tente novamente.')
    } finally {
      setRegistrando(false)
    }
  }

  async function resolverPendencia() {
    if (!pendencia || resolvendo) return
    setResolvendo(true)
    setErroResolver(null)

    try {
      await checkoutApiClient.patch(`/pendencias-material/${pendencia.id}/resolver`)
      router.push(`/etapa/${etapaId}`)
    } catch {
      setErroResolver('Não foi possível resolver a pendência. Tente novamente.')
    } finally {
      setResolvendo(false)
    }
  }

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <button
          type="button"
          className={styles.voltarLink}
          onClick={() => router.push(`/etapa/${etapaId}`)}
        >
          ‹ Voltar à etapa
        </button>
      </div>

      <h1 className={styles.titulo}>Falta de material</h1>

      {!pendencia && (
        <>
          <p className={styles.instrucao}>
            Descreva (opcional) o material em falta. A etapa será pausada
            automaticamente ao registrar.
          </p>

          <textarea
            className={styles.textarea}
            placeholder="Descrição (opcional)"
            value={descricao}
            onChange={(evento) => setDescricao(evento.target.value)}
            rows={3}
          />

          {erroRegistro && <p className={styles.errorMessage}>{erroRegistro}</p>}

          <button
            type="button"
            className={styles.botaoRegistrar}
            onClick={registrarPendencia}
            disabled={registrando}
          >
            {registrando ? 'Registrando...' : 'Registrar falta de material'}
          </button>
        </>
      )}

      {pendencia && (
        <div className={styles.confirmacaoCard}>
          <p className={styles.confirmacaoMensagem}>
            Pendência registrada. A etapa foi pausada.
          </p>

          {erroResolver && <p className={styles.errorMessage}>{erroResolver}</p>}

          <button
            type="button"
            className={styles.botaoResolver}
            onClick={resolverPendencia}
            disabled={resolvendo}
          >
            {resolvendo ? 'Resolvendo...' : 'Resolver pendência'}
          </button>
        </div>
      )}
    </div>
  )
}
