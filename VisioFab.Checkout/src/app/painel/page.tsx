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

/** Chaves de localStorage usadas para o Funcionario identificado (task 19.2). */
const FUNCIONARIO_ID_STORAGE_KEY = 'checkout_funcionario_identificado_id'
const FUNCIONARIO_NOME_STORAGE_KEY = 'checkout_funcionario_identificado_nome'

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
  // Base de contagem por Tipo de Processo (spec base-contagem-por-tipo-processo):
  // COLAGEM → Unidade (peças); demais → Tiragem (folhas). Fonte única no backend.
  contagem?: { base: 'UNIDADE' | 'TIRAGEM'; planejado: number; apontado: number; progresso: number }
}

/** Requisição de Corte na fila do checkout (GET /checkout/rcs). */
interface RcCheckout {
  id: string
  numeroExibicao: string
  status: string
  nomeProduto: string
  fabricanteCartao: string
  estagio: 'CORTE' | 'GUILHOTINA'
  qtdFolhasCortadeira: number | null
  qtdFolhasGuilhotina: number | null
  dataInicioCorte: string | null
  dataFimCorte: string | null
  dataInicioGuilhotina: string | null
  contagem?: { base: 'UNIDADE' | 'TIRAGEM'; planejado: number; apontado: number; progresso: number }
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

  // Operador identificado — lido de localStorage (mesmo padrão de etapa/[id])
  const [operadorNome, setOperadorNome] = useState<string | null>(null)
  // Máquina (Centro de Produção) da sessão do terminal — para o operador
  // saber em qual máquina está logado.
  const [maquina, setMaquina] = useState<{ codigo: string; descricao: string; tipoProcesso: string | null } | null>(null)
  // Requisições de Corte (RC) na fila deste centro (quando é Cortadeira/Guilhotina).
  const [rcs, setRcs] = useState<RcCheckout[]>([])
  const [processandoRc, setProcessandoRc] = useState<string | null>(null)
  // Resumo da última RC concluída (histórico de conclusão, R2 da spec
  // apontamentos-melhorias-caio): a RC não tem ApontamentoEtapa (só datas de
  // corte/guilhotina), então ao concluir mostramos um resumo do que foi
  // registrado — espelha a intenção "ver o histórico ao concluir".
  const [resumoRcConcluida, setResumoRcConcluida] = useState<{
    numero: string
    etapa: string
    folhas: number | null
  } | null>(null)

  useEffect(() => {
    if (typeof window === 'undefined') return
    const nome = window.localStorage.getItem(FUNCIONARIO_NOME_STORAGE_KEY)
    setOperadorNome(nome)
  }, [])

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

  // Busca os dados da máquina (centro) da sessão — não-bloqueante.
  useEffect(() => {
    if (!estaAutenticado) return
    checkoutApiClient
      .get<{ codigo: string; descricao: string; tipoProcesso: string | null }>('/sessao')
      .then((r) => setMaquina(r.data))
      .catch(() => setMaquina(null))
  }, [estaAutenticado])

  // Busca as RCs na fila deste centro (Cortadeira/Guilhotina) — não-bloqueante.
  const buscarRcs = useCallback(async () => {
    try {
      const response = await checkoutApiClient.get<RcCheckout[]>('/rcs')
      setRcs(response.data)
    } catch {
      setRcs([])
    }
  }, [])

  useEffect(() => {
    if (!estaAutenticado) return
    buscarRcs()
  }, [estaAutenticado, buscarRcs])

  // Executa uma ação da RC (iniciar/concluir corte, iniciar/concluir guilhotina).
  async function acaoRc(rcId: string, acao: string, body?: Record<string, unknown>) {
    if (processandoRc) return
    setProcessandoRc(rcId)
    const rcAtual = rcs.find((r) => r.id === rcId)
    try {
      await checkoutApiClient.patch(`/rcs/${rcId}/${acao}`, body ?? {})
      // Ao CONCLUIR (corte ou guilhotina), guarda um resumo do que foi
      // registrado para exibir como "histórico de conclusão" (R2).
      if (acao === 'concluir-corte' || acao === 'concluir-guilhotina') {
        const folhasBody =
          acao === 'concluir-corte'
            ? (body?.qtdFolhasCortadeira as number | undefined)
            : (body?.qtdFolhasGuilhotina as number | undefined)
        setResumoRcConcluida({
          numero: rcAtual?.numeroExibicao ?? 'RC',
          etapa: acao === 'concluir-corte' ? 'Corte' : 'Guilhotina',
          folhas: folhasBody ?? null,
        })
      }
      await buscarRcs()
    } catch {
      // silencioso — o card recarrega no próximo refresh
    } finally {
      setProcessandoRc(null)
    }
  }

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
        <div>
          <h1 className={styles.title}>Fila de Etapas</h1>
          {maquina && (
            <p className={styles.maquinaLinha}>
              <span className={styles.maquinaIcone} aria-hidden>🖥</span>
              Máquina: {maquina.codigo} — {maquina.descricao}
              {maquina.tipoProcesso ? ` (${maquina.tipoProcesso})` : ''}
            </p>
          )}
        </div>
        <button type="button" className={styles.logoutButton} onClick={encerrarSessao}>
          ✕ Encerrar sessão
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

      {/* Banner de operador identificado — mostra quem está logado ou
          avisa que ninguém se identificou ainda. */}
      {operadorNome ? (
        <div className={`${styles.operadorBanner} ${styles.operadorBannerIdentificado}`}>
          <span>
            Operador: <span className={styles.operadorBannerNome}>{operadorNome}</span>
          </span>
          <Link href="/identificar-operador" className={styles.operadorBannerLink}>
            Trocar
          </Link>
        </div>
      ) : (
        <div className={`${styles.operadorBanner} ${styles.operadorBannerNaoIdentificado}`}>
          <span>Nenhum operador identificado</span>
          <Link href="/identificar-operador" className={styles.operadorBannerLink}>
            Identificar-se
          </Link>
        </div>
      )}

      {/* Resumo da última conclusão de RC (R2 — histórico ao concluir). Como a
          RC não registra apontamentos individuais, mostramos o que foi
          registrado na conclusão (estágio + folhas). Dispensável com um toque. */}
      {resumoRcConcluida && (
        <div className={styles.operadorBanner} style={{ borderLeft: '4px solid #2f9e44' }}>
          <span>
            ✓ {resumoRcConcluida.numero} — {resumoRcConcluida.etapa} concluído
            {resumoRcConcluida.folhas != null
              ? `: ${resumoRcConcluida.folhas.toLocaleString('pt-BR')} folhas`
              : ''}
          </span>
          <button
            type="button"
            className={styles.operadorBannerLink}
            onClick={() => setResumoRcConcluida(null)}
          >
            Fechar
          </button>
        </div>
      )}

      {carregando && <p className={styles.infoMessage}>Carregando fila de etapas...</p>}

      {!carregando && erro && (
        <div className={styles.errorContainer}>
          <p className={styles.errorMessage}>{erro}</p>
          <button type="button" className={styles.retryButton} onClick={buscarPainel}>
            Tentar novamente
          </button>
        </div>
      )}

      {/* Requisições de Corte na fila deste centro — cards com ações de
          corte/guilhotina (botões conforme o estágio). Destaque visual verde. */}
      {!carregando && rcs.length > 0 && (
        <ul className={styles.lista}>
          {rcs.map((rc) => {
            const corteIniciado = Boolean(rc.dataInicioCorte)
            const guilhotinaIniciada = Boolean(rc.dataInicioGuilhotina)
            const proc = processandoRc === rc.id
            const planejado = rc.contagem?.planejado ?? 0
            const apontado = rc.contagem?.apontado ?? 0
            const progresso = rc.contagem?.progresso ?? 0
            const completo = progresso >= 100
            return (
              <li key={rc.id}>
                <div className={styles.card} style={{ cursor: 'default' }}>
                  <div className={styles.cardInfo}>
                    <span className={styles.opNumero}>✂ {rc.numeroExibicao}</span>
                    <p className={styles.produtoNome}>{rc.nomeProduto}</p>
                    <p className={styles.descricao}>{rc.fabricanteCartao}</p>
                    <p className={styles.quantidade}>
                      {apontado} / {planejado} folhas
                    </p>
                  </div>

                  <div className={styles.cardProgresso}>
                    <div className={styles.cardProgressoTopo}>
                      <span className={styles.status}>
                        {rc.estagio === 'CORTE' ? 'Corte' : 'Guilhotina'}
                      </span>
                    </div>
                    <div className={styles.progressoBarraLinha}>
                      <div className={styles.progressoTrilho}>
                        <div
                          className={`${styles.progressoPreenchido} ${completo ? styles.progressoPreenchidoCompleto : ''}`}
                          style={{ width: `${Math.min(100, Math.max(0, progresso))}%` }}
                        />
                      </div>
                      <span className={styles.progressoLabel}>
                        {apontado} / {progresso}%
                      </span>
                    </div>
                  </div>

                  <div className={styles.rcAcoes}>
                    {rc.estagio === 'CORTE' ? (
                      !corteIniciado ? (
                        <button type="button" className={`${styles.rcBotao} ${styles.rcBotaoIniciar}`} disabled={proc} onClick={() => acaoRc(rc.id, 'iniciar-corte')}>
                          {proc ? 'Aguarde...' : 'Iniciar corte'}
                        </button>
                      ) : (
                        <button type="button" className={`${styles.rcBotao} ${styles.rcBotaoConcluir}`} disabled={proc} onClick={() => {
                          const v = window.prompt('Quantidade de folhas cortadas (opcional):', rc.qtdFolhasCortadeira ? String(rc.qtdFolhasCortadeira) : '')
                          const qtd = v && !Number.isNaN(Number(v)) ? Number(v) : undefined
                          acaoRc(rc.id, 'concluir-corte', qtd != null ? { qtdFolhasCortadeira: qtd } : undefined)
                        }}>
                          {proc ? 'Aguarde...' : 'Concluir corte'}
                        </button>
                      )
                    ) : (
                      !guilhotinaIniciada ? (
                        <button type="button" className={`${styles.rcBotao} ${styles.rcBotaoIniciar}`} disabled={proc} onClick={() => acaoRc(rc.id, 'iniciar-guilhotina')}>
                          {proc ? 'Aguarde...' : 'Iniciar guilhotina'}
                        </button>
                      ) : (
                        <button type="button" className={`${styles.rcBotao} ${styles.rcBotaoConcluir}`} disabled={proc} onClick={() => {
                          const v = window.prompt('Quantidade de folhas refiladas (opcional):', rc.qtdFolhasGuilhotina ? String(rc.qtdFolhasGuilhotina) : '')
                          const qtd = v && !Number.isNaN(Number(v)) ? Number(v) : undefined
                          acaoRc(rc.id, 'concluir-guilhotina', qtd != null ? { qtdFolhasGuilhotina: qtd } : undefined)
                        }}>
                          {proc ? 'Aguarde...' : 'Concluir guilhotina'}
                        </button>
                      )
                    )}
                  </div>
                </div>
              </li>
            )
          })}
        </ul>
      )}

      {!carregando && !erro && etapas.length === 0 && rcs.length === 0 && (
        <p className={styles.infoMessage}>Nenhuma etapa na fila</p>
      )}

      {!carregando && !erro && etapas.length > 0 && (
        <ul className={styles.lista}>
          {etapas.map((etapa) => {
            const navegavel = !STATUS_NAO_NAVEGAVEL.has(etapa.status)
            const alerta = alertasPorEtapaId.get(etapa.id)
            const apontado = etapa.contagem?.apontado ?? etapa.quantidadeProduzida
            const planejado = etapa.contagem?.planejado ?? etapa.quantidade
            const unidade = etapa.contagem ? (etapa.contagem.base === 'UNIDADE' ? 'un' : 'folhas') : etapa.unidade
            const progresso = etapa.contagem?.progresso ?? (planejado > 0 ? Math.round((apontado / planejado) * 100) : 0)
            const completo = progresso >= 100

            return (
              <li key={etapa.id}>
                <button
                  type="button"
                  className={`${styles.card} ${alerta ? styles.cardEmAlerta : ''}`}
                  onClick={() => handleSelecionarEtapa(etapa)}
                  disabled={!navegavel}
                >
                  <div className={styles.cardInfo}>
                    <span className={styles.opNumero}>OP {etapa.opNumero}</span>
                    {etapa.produtoNome && <p className={styles.produtoNome}>{etapa.produtoNome}</p>}
                    <p className={styles.descricao}>{etapa.descricao}</p>
                    <p className={styles.quantidade}>
                      {apontado} / {planejado} {unidade}
                    </p>
                  </div>

                  <div className={styles.cardProgresso}>
                    <div className={styles.cardProgressoTopo}>
                      <span className={`${styles.status} ${styles[`status-${etapa.status}`] ?? ''}`}>
                        {ROTULO_STATUS[etapa.status] ?? etapa.status}
                      </span>
                      <span className={styles.menuIcone} aria-hidden>≡</span>
                    </div>
                    <div className={styles.progressoBarraLinha}>
                      <div className={styles.progressoTrilho}>
                        <div
                          className={`${styles.progressoPreenchido} ${completo ? styles.progressoPreenchidoCompleto : ''}`}
                          style={{ width: `${Math.min(100, Math.max(0, progresso))}%` }}
                        />
                      </div>
                      <span className={styles.progressoLabel}>
                        {apontado} / {progresso}%
                      </span>
                    </div>
                  </div>

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
