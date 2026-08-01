'use client'

// Tela dedicada de alertas do Supervisor (task 26.1 do spec
// `checkout-apontamento`) — lista, em versão expandida/dedicada (fora do
// painel principal), todas as Etapas em alerta de parada prolongada,
// consumindo `GET /checkout/supervisor/alertas`.
//
// Reaproveita o mesmo shape de dados e o mesmo padrão visual de destaque
// já usado em `app/painel/page.tsx` (task 20.2) para os alertas embutidos
// na fila — aqui, porém, cada alerta é a própria unidade de exibição (não
// um adendo a um card de etapa), com estilos equivalentes definidos num
// CSS Module próprio (módulos CSS são isolados por arquivo, então não é
// possível importar as classes de `painel.module.css` diretamente).
//
// _Requirements: 13.1, 13.2, 13.3_

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { checkoutApiClient } from '@/lib/checkout-api-client'
import { useSessaoTerminal } from '@/contexts/sessao-terminal-context'
import styles from './alertas.module.css'

/**
 * Shape de cada item retornado por `GET /checkout/supervisor/alertas`,
 * espelhando a interface `EtapaEmAlertaParadaProlongada` de
 * `checkout.service.ts` no backend (`listarEtapasEmAlertaParadaProlongada`).
 */
interface EtapaEmAlertaParadaProlongada {
  etapaId: string
  ordemProducaoNumero: number
  sequencia: number
  centroProducaoId: string | null
  minutosParada: number
  motivoParada: string | null
}

export default function AlertasSupervisorPage() {
  const router = useRouter()
  const { estaAutenticado } = useSessaoTerminal()

  const [alertas, setAlertas] = useState<EtapaEmAlertaParadaProlongada[]>([])
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState<string | null>(null)

  // Proteção básica de rota client-side (mesmo padrão de `painel/page.tsx`):
  // sem Sessão_Terminal ativa, redireciona para o login do Terminal.
  useEffect(() => {
    if (!estaAutenticado) {
      router.push('/login-terminal')
    }
  }, [estaAutenticado, router])

  const buscarAlertas = useCallback(async () => {
    setCarregando(true)
    setErro(null)

    try {
      const response = await checkoutApiClient.get<EtapaEmAlertaParadaProlongada[]>(
        '/supervisor/alertas',
      )
      setAlertas(response.data)
    } catch {
      setErro('Não foi possível carregar os alertas de parada prolongada. Tente novamente.')
    } finally {
      setCarregando(false)
    }
  }, [])

  useEffect(() => {
    if (!estaAutenticado) return
    buscarAlertas()
  }, [estaAutenticado, buscarAlertas])

  function handleSelecionarAlerta(alerta: EtapaEmAlertaParadaProlongada) {
    router.push(`/etapa/${alerta.etapaId}`)
  }

  if (!estaAutenticado) {
    return null
  }

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <h1 className={styles.title}>Alertas de Parada Prolongada</h1>
        <button type="button" className={styles.voltarButton} onClick={() => router.push('/painel')}>
          Voltar ao painel
        </button>
      </header>

      {carregando && <p className={styles.infoMessage}>Carregando alertas...</p>}

      {!carregando && erro && (
        <div className={styles.errorContainer}>
          <p className={styles.errorMessage}>{erro}</p>
          <button type="button" className={styles.retryButton} onClick={buscarAlertas}>
            Tentar novamente
          </button>
        </div>
      )}

      {!carregando && !erro && alertas.length === 0 && (
        <p className={styles.infoMessage}>Nenhuma etapa em alerta</p>
      )}

      {!carregando && !erro && alertas.length > 0 && (
        <ul className={styles.lista}>
          {alertas.map((alerta) => (
            <li key={alerta.etapaId}>
              <button
                type="button"
                className={styles.cardEmAlerta}
                onClick={() => handleSelecionarAlerta(alerta)}
              >
                <div className={styles.cardHeader}>
                  <span className={styles.opNumero}>OP {alerta.ordemProducaoNumero}</span>
                  <span className={styles.sequencia}>Etapa {alerta.sequencia}</span>
                </div>

                <p className={styles.alertaParada}>
                  ⚠ Parada há {alerta.minutosParada} min
                  {alerta.motivoParada ? ` — ${alerta.motivoParada}` : ''}
                </p>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
