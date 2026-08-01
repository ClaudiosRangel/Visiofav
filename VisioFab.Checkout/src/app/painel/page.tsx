'use client'

// Tela do painel de Etapas do Checkout (task 20.1 do spec
// `checkout-apontamento`) — lista a fila de Etapas do Centro_Producao
// vinculado à Sessão_Terminal ativa, consumindo `GET /checkout/painel`.
//
// Cada Etapa é exibida como um card mobile-first (toque grande, mínimo
// 48x48px de área clicável). Etapas `PENDENTE`/`PAUSADA` são clicáveis e
// navegam para `etapa/[id]` (Requirement 5.2). Etapas `EM_ANDAMENTO`
// também são clicáveis: o Requirement 5.3 (ação principal na tela
// etapa/[id]) é escopo da task 21.1, mas a tela de destino decide a ação
// apropriada a partir do status da etapa — deixamos o card navegável já
// aqui para qualquer status diferente de `CONCLUIDA` (que não deveria
// aparecer no painel, já que o backend só retorna
// PENDENTE/EM_ANDAMENTO/PAUSADA), evitando ter que alterar esta tela de
// novo quando a 21.1 for implementada.
//
// Alertas de parada prolongada (Requirement 13.2, `GET
// /checkout/supervisor/alertas`) são implementados nesta mesma tela pela
// task 20.2 (ver função `buscarAlertas` abaixo).
//
// Decisão de design (task 20.2): a tela `painel` não tem, hoje, um
// mecanismo explícito de "modo Supervisor" — a Sessão_Terminal é
// autenticada por um Supervisor no login (task 18.1), mas depois disso
// qualquer Operador pode usar o mesmo Terminal, e `useSessaoTerminal` não
// distingue quem está com o Terminal em mãos no momento. Como
// `GET /checkout/supervisor/alertas` já é protegida no backend apenas por
// `checkoutAuth` (qualquer Token_Checkout válido, sem exigir
// reautenticação de Supervisor) e o design.md não define um mecanismo
// separado de "modo Supervisor" nesta tela, a decisão mais simples e
// coerente com o restante do app é: sempre buscar e exibir os alertas no
// painel quando existirem, sem escondê-los atrás de um toggle que não
// existe em nenhum outro lugar do app ainda.
//
// _Requirements: 5.1, 5.2, 5.4, 13.2_

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { checkoutApiClient } from '@/lib/checkout-api-client'
import { useSessaoTerminal } from '@/contexts/sessao-terminal-context'
import styles from './painel.module.css'

/**
 * Shape de cada Etapa retornada por `GET /checkout/painel`, espelhando a
 * interface `EtapaPainelCheckout` de `checkout.service.ts` no backend
 * (`listarPainelCheckout`). Duplicada aqui porque os dois projetos
 * (`VisioFab.Wms.Back` e `VisioFab.Checkout`) não compartilham tipos.
 */
interface EtapaPainelCheckout {
  id: string
  ordemProducaoId: string
  opNumero: string
  produtoNome: string | null
  descricao: string
  sequencia: number
  status: string
  posicaoFila: number | null
  quantidade: number
  unidade: string
  quantidadeProduzida: number
  quantidadePerda: number
  prioridade: string
}

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

/** Status de Etapa que não navegam para `etapa/[id]` a partir do painel. */
const STATUS_NAO_NAVEGAVEL = new Set(['CONCLUIDA'])

const ROTULO_STATUS: Record<string, string> = {
  PENDENTE: 'Pendente',
  EM_ANDAMENTO: 'Em andamento',
  PAUSADA: 'Pausada',
  CONCLUIDA: 'Concluída',
}

export default function PainelPage() {
  const router = useRouter()
  const { estaAutenticado, encerrarSessao } = useSessaoTerminal()

  const [etapas, setEtapas] = useState<EtapaPainelCheckout[]>([])
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState<string | null>(null)

  // Mapa de etapaId -> alerta, para lookup O(1) ao renderizar cada card.
  // A busca de alertas roda em paralelo com a busca do painel e falha de
  // forma silenciosa/não-bloqueante: não deve impedir a exibição do
  // painel principal se `GET /supervisor/alertas` falhar.
  const [alertasPorEtapaId, setAlertasPorEtapaId] = useState<
    Map<string, EtapaEmAlertaParadaProlongada>
  >(new Map())

  // Proteção básica de rota client-side: sem Sessão_Terminal ativa, não
  // há Centro_Producao vinculado para listar o painel.
  useEffect(() => {
    if (!estaAutenticado) {
      router.push('/login-terminal')
    }
  }, [estaAutenticado, router])

  const buscarPainel = useCallback(async () => {
    setCarregando(true)
    setErro(null)

    try {
      const response = await checkoutApiClient.get<EtapaPainelCheckout[]>('/painel')
      setEtapas(response.data)
    } catch {
      setErro('Não foi possível carregar a fila de etapas. Tente novamente.')
    } finally {
      setCarregando(false)
    }
  }, [])

  useEffect(() => {
    if (!estaAutenticado) return
    buscarPainel()
  }, [estaAutenticado, buscarPainel])

  const buscarAlertas = useCallback(async () => {
    try {
      const response = await checkoutApiClient.get<EtapaEmAlertaParadaProlongada[]>(
        '/supervisor/alertas',
      )
      setAlertasPorEtapaId(new Map(response.data.map((alerta) => [alerta.etapaId, alerta])))
    } catch (erroAlertas) {
      // Busca de alertas é não-bloqueante (Requirement 13.2): não deve
      // impedir a exibição do painel principal. Apenas loga no console.
      console.error('Não foi possível carregar os alertas de parada prolongada.', erroAlertas)
    }
  }, [])

  // useEffect separado e independente da busca do painel — pode rodar em
  // paralelo, já que consulta uma rota diferente (`/supervisor/alertas`).
  useEffect(() => {
    if (!estaAutenticado) return
    buscarAlertas()
  }, [estaAutenticado, buscarAlertas])

  function handleSelecionarEtapa(etapa: EtapaPainelCheckout) {
    if (STATUS_NAO_NAVEGAVEL.has(etapa.status)) return
    router.push(`/etapa/${etapa.id}`)
  }

  if (!estaAutenticado) {
    return null
  }

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <h1 className={styles.title}>Fila de Etapas</h1>
        <button type="button" className={styles.logoutButton} onClick={encerrarSessao}>
          Encerrar sessão
        </button>
      </header>

      {/* Barra de navegação simples (task 29.1, item 3) — o painel é a
          tela central do fluxo, então concentra aqui os acessos rápidos
          para identificação antecipada do Operador e para as telas de
          Supervisor (não há distinção de papel Operador/Supervisor
          implementada, então os links ficam sempre visíveis). */}
      <nav className={styles.navBar} aria-label="Navegação rápida">
        <Link href="/identificar-operador" className={styles.navLink}>
          Identificar-se
        </Link>
        <Link href="/supervisor/alertas" className={styles.navLink}>
          Alertas
        </Link>
        <Link href="/supervisor/autorizar-retroativo" className={styles.navLink}>
          Autorizar retroativo
        </Link>
      </nav>

      {carregando && <p className={styles.infoMessage}>Carregando fila de etapas...</p>}

      {!carregando && erro && (
        <div className={styles.errorContainer}>
          <p className={styles.errorMessage}>{erro}</p>
          <button type="button" className={styles.retryButton} onClick={buscarPainel}>
            Tentar novamente
          </button>
        </div>
      )}

      {!carregando && !erro && etapas.length === 0 && (
        <p className={styles.infoMessage}>Nenhuma etapa na fila</p>
      )}

      {!carregando && !erro && etapas.length > 0 && (
        <ul className={styles.lista}>
          {etapas.map((etapa) => {
            const navegavel = !STATUS_NAO_NAVEGAVEL.has(etapa.status)
            const alerta = alertasPorEtapaId.get(etapa.id)

            return (
              <li key={etapa.id}>
                <button
                  type="button"
                  className={`${styles.card} ${alerta ? styles.cardEmAlerta : ''}`}
                  onClick={() => handleSelecionarEtapa(etapa)}
                  disabled={!navegavel}
                >
                  <div className={styles.cardHeader}>
                    <span className={styles.opNumero}>OP {etapa.opNumero}</span>
                    <span className={`${styles.status} ${styles[`status-${etapa.status}`] ?? ''}`}>
                      {ROTULO_STATUS[etapa.status] ?? etapa.status}
                    </span>
                  </div>

                  {etapa.produtoNome && <p className={styles.produtoNome}>{etapa.produtoNome}</p>}

                  <p className={styles.descricao}>{etapa.descricao}</p>

                  <p className={styles.quantidade}>
                    {etapa.quantidadeProduzida} / {etapa.quantidade} {etapa.unidade}
                  </p>

                  {alerta && (
                    <p className={styles.alertaParada}>
                      ⚠ Parada há {alerta.minutosParada} min
                      {alerta.motivoParada ? ` — ${alerta.motivoParada}` : ''}
                    </p>
                  )}
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
