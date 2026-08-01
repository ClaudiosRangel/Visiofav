'use client'

// Tela de ação principal da Etapa (task 21.1) + operadores ativos (task
// 21.2) do spec `checkout-apontamento`.
//
// Task 21.1 — ação principal:
// Mostra uma única ação em destaque conforme o status da Etapa
// (Requirement 5.3): iniciar/retomar via `PATCH /etapas/:id/iniciar`
// quando `PENDENTE`/`PAUSADA`, ou navegação para apontar/pausar/
// pendencia-material quando já `EM_ANDAMENTO`. Botões com toque grande
// (mínimo 48x48px, Requirement 14.2).
//
// Task 21.2 — operadores ativos:
// Consome `GET /etapas/:id/operadores` para listar os Operadores
// atualmente ativos na Etapa, permitindo múltiplos Operadores entrarem
// (`POST /etapas/:id/operadores/entrar`) e saírem
// (`PATCH /etapas/:id/operadores/saida`) de forma independente
// (Requirements 10.1-10.4).
//
// Decisão de design (leitura dos dados da Etapa): não existe uma rota
// `GET /checkout/etapas/:id` dedicada no backend deste spec — a forma
// mais simples de obter os dados atuais da Etapa aqui, sem alterar a tela
// `painel` (já implementada na task 20.1), é buscar `GET /painel`
// novamente e filtrar pelo `id` do parâmetro de rota. O painel já lista
// todas as Etapas do Centro_Producao da Sessão_Terminal, então o filtro
// client-side é aceitável e evita duplicar lógica de busca por id no
// backend só para esta tela.
//
// Em Next.js 15 (App Router), `params` como prop de página é uma Promise
// quando a página é um Server Component — mas esta página é `'use client'`,
// então o `id` da rota dinâmica é lido de forma síncrona via `useParams()`
// de `next/navigation`, não como prop.
//
// _Requirements: 5.3, 10.1, 10.2, 10.3, 10.4, 14.2_

import { useCallback, useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { checkoutApiClient } from '@/lib/checkout-api-client'
import { useSessaoTerminal } from '@/contexts/sessao-terminal-context'
import styles from './etapa.module.css'

/** Chaves de localStorage usadas para o Funcionario identificado (task 19.2). */
const FUNCIONARIO_ID_STORAGE_KEY = 'checkout_funcionario_identificado_id'
const FUNCIONARIO_NOME_STORAGE_KEY = 'checkout_funcionario_identificado_nome'

/**
 * Shape de cada Etapa retornada por `GET /checkout/painel`, mesmo formato
 * já usado em `painel/page.tsx` — duplicado aqui porque cada página do
 * Checkout define seu próprio shape local (mesmo padrão já observado em
 * `identificar-operador/page.tsx`).
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

/** Shape de cada Operador ativo retornado por `GET /etapas/:id/operadores`. */
interface OperadorAtivo {
  id: string
  funcionarioId: string
  nome: string
  entradaEm: string
}

/**
 * Shape de cada item retornado por `GET /checkout/etapas/:id/apontamentos`
 * (task 27.1), espelhando `ApontamentoHistoricoResultado` do
 * `checkout.service.ts` (backend).
 */
interface ApontamentoHistorico {
  id: string
  tipo: string
  quantidade: number
  motivo: string | null
  funcionarioId: string | null
  operadorNome: string | null
  dataHora: string
  observacao: string | null
  fotoUrl: string | null
  ehRetroativo: boolean
  apontamentoOrigemId: string | null
  motivoRetroativo: string | null
  autorizadoPorUsuarioId: string | null
}

/** Tradução dos tipos de apontamento para exibição no histórico (task 27.1). */
const ROTULO_TIPO_APONTAMENTO: Record<string, string> = {
  PRODUCAO: 'Produção',
  PERDA: 'Perda',
  RETRABALHO: 'Retrabalho',
  PARADA: 'Parada',
  RETOMADA: 'Retomada',
  SETUP: 'Setup',
}

const ROTULO_STATUS: Record<string, string> = {
  PENDENTE: 'Pendente',
  EM_ANDAMENTO: 'Em andamento',
  PAUSADA: 'Pausada',
  CONCLUIDA: 'Concluída',
}

/** Lê o Funcionario identificado (task 19.2) salvo em localStorage. */
function lerFuncionarioIdentificado(): { funcionarioId: string; nome: string } | null {
  if (typeof window === 'undefined') return null

  const funcionarioId = window.localStorage.getItem(FUNCIONARIO_ID_STORAGE_KEY)
  const nome = window.localStorage.getItem(FUNCIONARIO_NOME_STORAGE_KEY)

  if (!funcionarioId || !nome) return null
  return { funcionarioId, nome }
}

export default function EtapaPage() {
  const params = useParams<{ id: string }>()
  const etapaId = params.id
  const router = useRouter()
  const { estaAutenticado } = useSessaoTerminal()

  const [etapa, setEtapa] = useState<EtapaPainelCheckout | null>(null)
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [iniciando, setIniciando] = useState(false)
  const [erroAcaoPrincipal, setErroAcaoPrincipal] = useState<string | null>(null)

  const [operadoresAtivos, setOperadoresAtivos] = useState<OperadorAtivo[]>([])
  const [carregandoOperadores, setCarregandoOperadores] = useState(false)
  const [erroOperadores, setErroOperadores] = useState<string | null>(null)
  const [processandoOperador, setProcessandoOperador] = useState(false)

  const [historico, setHistorico] = useState<ApontamentoHistorico[]>([])
  const [carregandoHistorico, setCarregandoHistorico] = useState(true)
  const [erroHistorico, setErroHistorico] = useState<string | null>(null)

  const funcionarioIdentificado = lerFuncionarioIdentificado()

  // Proteção básica de rota client-side, mesmo padrão de `painel/page.tsx`.
  useEffect(() => {
    if (!estaAutenticado) {
      router.push('/login-terminal')
    }
  }, [estaAutenticado, router])

  const buscarEtapa = useCallback(async () => {
    setCarregando(true)
    setErro(null)

    try {
      const response = await checkoutApiClient.get<EtapaPainelCheckout[]>('/painel')
      const encontrada = response.data.find((item) => item.id === etapaId) ?? null

      if (!encontrada) {
        setErro('Etapa não encontrada na fila do Terminal.')
      }
      setEtapa(encontrada)
    } catch {
      setErro('Não foi possível carregar os dados da etapa. Tente novamente.')
    } finally {
      setCarregando(false)
    }
  }, [etapaId])

  useEffect(() => {
    if (!estaAutenticado) return
    buscarEtapa()
  }, [estaAutenticado, buscarEtapa])

  const buscarOperadoresAtivos = useCallback(async () => {
    setCarregandoOperadores(true)
    setErroOperadores(null)

    try {
      const response = await checkoutApiClient.get<OperadorAtivo[]>(`/etapas/${etapaId}/operadores`)
      setOperadoresAtivos(response.data)
    } catch {
      setErroOperadores('Não foi possível carregar os operadores ativos.')
    } finally {
      setCarregandoOperadores(false)
    }
  }, [etapaId])

  // Só busca a lista de operadores ativos quando a etapa está em
  // andamento — não há operadores ativos para uma etapa pendente/pausada.
  useEffect(() => {
    if (!estaAutenticado) return
    if (etapa?.status !== 'EM_ANDAMENTO') return
    buscarOperadoresAtivos()
  }, [estaAutenticado, etapa?.status, buscarOperadoresAtivos])

  // Task 27.1 — histórico de apontamentos, busca própria e não-bloqueante
  // em relação ao restante da tela (ação principal, operadores ativos).
  // Exibida sempre que a etapa é encontrada, independente do status.
  const buscarHistorico = useCallback(async () => {
    setCarregandoHistorico(true)
    setErroHistorico(null)

    try {
      const response = await checkoutApiClient.get<ApontamentoHistorico[]>(
        `/etapas/${etapaId}/apontamentos`,
      )
      setHistorico(response.data)
    } catch {
      setErroHistorico('Não foi possível carregar o histórico de apontamentos.')
    } finally {
      setCarregandoHistorico(false)
    }
  }, [etapaId])

  useEffect(() => {
    if (!estaAutenticado) return
    buscarHistorico()
  }, [estaAutenticado, buscarHistorico])

  async function iniciarOuRetomarEtapa() {
    if (iniciando) return
    setIniciando(true)
    setErroAcaoPrincipal(null)

    try {
      await checkoutApiClient.patch(`/etapas/${etapaId}/iniciar`, {
        funcionarioId: funcionarioIdentificado?.funcionarioId,
      })

      // Atualiza o estado local para `EM_ANDAMENTO` sem precisar re-navegar
      // ou refazer a busca completa do painel.
      setEtapa((atual) => (atual ? { ...atual, status: 'EM_ANDAMENTO' } : atual))
    } catch {
      setErroAcaoPrincipal('Não foi possível iniciar/retomar a etapa. Tente novamente.')
    } finally {
      setIniciando(false)
    }
  }

  async function entrarNaEtapa() {
    if (!funcionarioIdentificado || processandoOperador) return
    setProcessandoOperador(true)
    setErroOperadores(null)

    try {
      await checkoutApiClient.post(`/etapas/${etapaId}/operadores/entrar`, {
        funcionarioId: funcionarioIdentificado.funcionarioId,
      })
      await buscarOperadoresAtivos()
    } catch {
      setErroOperadores('Não foi possível registrar sua entrada na etapa.')
    } finally {
      setProcessandoOperador(false)
    }
  }

  async function sairDaEtapa() {
    if (!funcionarioIdentificado || processandoOperador) return
    setProcessandoOperador(true)
    setErroOperadores(null)

    try {
      await checkoutApiClient.patch(`/etapas/${etapaId}/operadores/saida`, {
        funcionarioId: funcionarioIdentificado.funcionarioId,
      })
      await buscarOperadoresAtivos()
    } catch {
      setErroOperadores('Não foi possível registrar sua saída da etapa.')
    } finally {
      setProcessandoOperador(false)
    }
  }

  if (!estaAutenticado) {
    return null
  }

  const euEstouAtivo = Boolean(
    funcionarioIdentificado &&
      operadoresAtivos.some((op) => op.funcionarioId === funcionarioIdentificado.funcionarioId),
  )

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <Link href="/painel" className={styles.voltarLink}>
          ‹ Voltar ao painel
        </Link>
      </div>

      {carregando && <p className={styles.infoMessage}>Carregando etapa...</p>}

      {!carregando && erro && (
        <div className={styles.errorContainer}>
          <p className={styles.errorMessage}>{erro}</p>
          <button type="button" className={styles.retryButton} onClick={buscarEtapa}>
            Tentar novamente
          </button>
        </div>
      )}

      {!carregando && !erro && etapa && (
        <>
          <div className={styles.infoCard}>
            <div className={styles.infoHeader}>
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
          </div>

          <div className={styles.acaoPrincipal}>
            {erroAcaoPrincipal && <p className={styles.errorMessage}>{erroAcaoPrincipal}</p>}

            {(etapa.status === 'PENDENTE' || etapa.status === 'PAUSADA') && (
              <button
                type="button"
                className={styles.botaoIniciar}
                onClick={iniciarOuRetomarEtapa}
                disabled={iniciando}
              >
                {iniciando ? 'Aguarde...' : etapa.status === 'PAUSADA' ? 'Retomar' : 'Iniciar'}
              </button>
            )}

            {etapa.status === 'EM_ANDAMENTO' && (
              <div className={styles.acoesEmAndamento}>
                <button
                  type="button"
                  className={styles.botaoApontar}
                  onClick={() => router.push(`/etapa/${etapaId}/apontar`)}
                >
                  Apontar
                </button>
                <button
                  type="button"
                  className={styles.botaoSecundario}
                  onClick={() => router.push(`/etapa/${etapaId}/pausar`)}
                >
                  Pausar
                </button>
                <button
                  type="button"
                  className={styles.botaoSecundario}
                  onClick={() => router.push(`/etapa/${etapaId}/pendencia-material`)}
                >
                  Falta de material
                </button>
              </div>
            )}

            {etapa.status === 'CONCLUIDA' && (
              <p className={styles.infoMessage}>Esta etapa já foi concluída.</p>
            )}
          </div>

          {etapa.status === 'EM_ANDAMENTO' && (
            <section className={styles.operadoresSection}>
              <h2 className={styles.operadoresTitulo}>Operadores ativos</h2>

              {carregandoOperadores && (
                <p className={styles.infoMessage}>Carregando operadores...</p>
              )}

              {!carregandoOperadores && erroOperadores && (
                <p className={styles.errorMessage}>{erroOperadores}</p>
              )}

              {!carregandoOperadores && !erroOperadores && operadoresAtivos.length === 0 && (
                <p className={styles.infoMessage}>Nenhum operador ativo nesta etapa</p>
              )}

              {!carregandoOperadores && operadoresAtivos.length > 0 && (
                <ul className={styles.operadoresLista}>
                  {operadoresAtivos.map((operador) => (
                    <li key={operador.id} className={styles.operadorItem}>
                      {operador.nome}
                    </li>
                  ))}
                </ul>
              )}

              {funcionarioIdentificado ? (
                euEstouAtivo ? (
                  <button
                    type="button"
                    className={styles.botaoSairEtapa}
                    onClick={sairDaEtapa}
                    disabled={processandoOperador}
                  >
                    Sair desta etapa
                  </button>
                ) : (
                  <button
                    type="button"
                    className={styles.botaoEntrarEtapa}
                    onClick={entrarNaEtapa}
                    disabled={processandoOperador}
                  >
                    Entrar nesta etapa
                  </button>
                )
              ) : (
                <p className={styles.infoMessage}>
                  <Link
                    href={`/identificar-operador?redirect=/etapa/${etapaId}`}
                    className={styles.identificarLink}
                  >
                    Identifique-se
                  </Link>{' '}
                  para entrar nesta etapa
                </p>
              )}
            </section>
          )}

          <section className={styles.historicoSection}>
            <h2 className={styles.historicoTitulo}>Histórico de apontamentos</h2>

            {carregandoHistorico && (
              <p className={styles.infoMessage}>Carregando histórico...</p>
            )}

            {!carregandoHistorico && erroHistorico && (
              <div className={styles.errorContainer}>
                <p className={styles.errorMessage}>{erroHistorico}</p>
                <button type="button" className={styles.retryButton} onClick={buscarHistorico}>
                  Tentar novamente
                </button>
              </div>
            )}

            {!carregandoHistorico && !erroHistorico && historico.length === 0 && (
              <p className={styles.infoMessage}>Nenhum apontamento registrado ainda</p>
            )}

            {!carregandoHistorico && !erroHistorico && historico.length > 0 && (
              <ul className={styles.historicoLista}>
                {historico.map((item) => (
                  <li
                    key={item.id}
                    className={`${styles.historicoItem} ${
                      item.ehRetroativo ? styles.historicoItemRetroativo : ''
                    }`}
                  >
                    <div className={styles.historicoItemHeader}>
                      <span className={styles.historicoTipo}>
                        {ROTULO_TIPO_APONTAMENTO[item.tipo] ?? item.tipo}
                      </span>
                      <span className={styles.historicoHorario}>
                        {new Date(item.dataHora).toLocaleString('pt-BR')}
                      </span>
                    </div>

                    <p className={styles.historicoOperador}>
                      {item.operadorNome ?? 'Sistema'}
                    </p>

                    {item.quantidade > 0 && (
                      <p className={styles.historicoQuantidade}>
                        Quantidade: {item.quantidade}
                      </p>
                    )}

                    {item.motivo && (
                      <p className={styles.historicoMotivo}>Motivo: {item.motivo}</p>
                    )}

                    {item.ehRetroativo && (
                      <div className={styles.historicoRetroativoBadge}>
                        <span className={styles.historicoRetroativoTag}>Retroativo</span>
                        {item.motivoRetroativo && <span>{item.motivoRetroativo}</span>}
                        {item.apontamentoOrigemId && (
                          <p className={styles.historicoCorrige}>
                            ↳ Corrige apontamento anterior
                          </p>
                        )}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  )
}
