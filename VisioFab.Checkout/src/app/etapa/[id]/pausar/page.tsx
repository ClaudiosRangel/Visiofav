'use client'

// Tela de pausa da Etapa (task 24.1 do spec `checkout-apontamento`).
//
// Formulário com motivo de parada (5 opções) e indicador planejada/não
// planejada, ambos obrigatórios no Checkout (Requirement 8.1), chamando
// `PATCH /checkout/etapas/:id/pausar`. Campo de observação é opcional.
//
// Requirement 8.3 — quando o motivo é `MANUTENCAO` e a parada é não
// planejada, o backend sinaliza a parada como candidata a abertura de
// ordem de manutenção (`candidataOrdemManutencao` no retorno). A UX
// escolhida aqui é a mais simples possível: exibir essa informação
// depois do envio, junto com a confirmação de sucesso, em vez de tentar
// prever/bloquear antes de enviar — evita duplicar a regra de negócio no
// frontend.
//
// Em sucesso, navega de volta para `/etapa/[id]` (mesmo padrão de
// navegação usado em `etapa/[id]/page.tsx`).
//
// _Requirements: 8.1, 8.2, 8.3_

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import axios from 'axios'
import { checkoutApiClient } from '@/lib/checkout-api-client'
import { useSessaoTerminal } from '@/contexts/sessao-terminal-context'
import styles from './pausar.module.css'

type MotivoParada = 'MANUTENCAO' | 'FALTA_MATERIAL' | 'ACERTO_MAQUINA' | 'TROCA_TURNO' | 'OUTRO'

/** Opções de motivo de parada aceitas pelo backend (Requirement 8.1). */
const OPCOES_MOTIVO: Array<{ valor: MotivoParada; rotulo: string }> = [
  { valor: 'MANUTENCAO', rotulo: 'Manutenção' },
  { valor: 'FALTA_MATERIAL', rotulo: 'Falta de Material' },
  { valor: 'ACERTO_MAQUINA', rotulo: 'Acerto de Máquina' },
  { valor: 'TROCA_TURNO', rotulo: 'Troca de Turno' },
  { valor: 'OUTRO', rotulo: 'Outro' },
]

/** Shape do corpo aceito por `PATCH /checkout/etapas/:id/pausar`. */
interface PausarEtapaBody {
  motivoParada: MotivoParada
  paradaPlanejada: boolean
  observacao?: string
}

/** Shape do retorno de `PATCH /checkout/etapas/:id/pausar`. */
interface PausarEtapaResultado {
  message: string
  motivo: MotivoParada
  paradaPlanejada: boolean
  candidataOrdemManutencao: boolean
}

export default function PausarEtapaPage() {
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

  const [motivoParada, setMotivoParada] = useState<MotivoParada | null>(null)
  const [paradaPlanejada, setParadaPlanejada] = useState<boolean | null>(null)
  const [observacao, setObservacao] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [resultado, setResultado] = useState<PausarEtapaResultado | null>(null)

  const camposObrigatoriosPreenchidos = motivoParada !== null && paradaPlanejada !== null

  if (!estaAutenticado) {
    return null
  }

  async function confirmarPausa() {
    if (!camposObrigatoriosPreenchidos || enviando) return

    setEnviando(true)
    setErro(null)

    const body: PausarEtapaBody = {
      motivoParada: motivoParada as MotivoParada,
      paradaPlanejada: paradaPlanejada as boolean,
      observacao: observacao.trim() ? observacao.trim() : undefined,
    }

    try {
      const response = await checkoutApiClient.patch<PausarEtapaResultado>(
        `/etapas/${etapaId}/pausar`,
        body,
      )
      setResultado(response.data)
    } catch (err) {
      const mensagem =
        (axios.isAxiosError(err) && (err.response?.data as { message?: string } | undefined)?.message) ||
        'Não foi possível registrar a pausa. Tente novamente.'
      setErro(mensagem)
    } finally {
      setEnviando(false)
    }
  }

  if (resultado) {
    return (
      <div className={styles.container}>
        <div className={styles.sucessoCard}>
          <p className={styles.sucessoTitulo}>Pausa registrada</p>
          <p className={styles.sucessoTexto}>{resultado.message}</p>

          {resultado.candidataOrdemManutencao && (
            <p className={styles.avisoManutencao}>
              Esta parada foi sinalizada como candidata a abertura de ordem de manutenção.
            </p>
          )}

          <button
            type="button"
            className={styles.botaoVoltar}
            onClick={() => router.push(`/etapa/${etapaId}`)}
          >
            Voltar para a etapa
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <Link href={`/etapa/${etapaId}`} className={styles.voltarLink}>
          ‹ Voltar
        </Link>
      </div>

      <h1 className={styles.titulo}>Pausar etapa</h1>

      <section className={styles.secao}>
        <h2 className={styles.secaoTitulo}>Motivo da parada</h2>
        <div className={styles.opcoesMotivo}>
          {OPCOES_MOTIVO.map((opcao) => (
            <button
              key={opcao.valor}
              type="button"
              className={`${styles.botaoMotivo} ${motivoParada === opcao.valor ? styles.botaoMotivoSelecionado : ''}`}
              onClick={() => setMotivoParada(opcao.valor)}
              disabled={enviando}
              aria-pressed={motivoParada === opcao.valor}
            >
              {opcao.rotulo}
            </button>
          ))}
        </div>
      </section>

      <section className={styles.secao}>
        <h2 className={styles.secaoTitulo}>A parada é planejada?</h2>
        <div className={styles.opcoesPlanejada}>
          <button
            type="button"
            className={`${styles.botaoPlanejada} ${paradaPlanejada === true ? styles.botaoPlanejadaSelecionado : ''}`}
            onClick={() => setParadaPlanejada(true)}
            disabled={enviando}
            aria-pressed={paradaPlanejada === true}
          >
            Planejada
          </button>
          <button
            type="button"
            className={`${styles.botaoPlanejada} ${paradaPlanejada === false ? styles.botaoPlanejadaSelecionado : ''}`}
            onClick={() => setParadaPlanejada(false)}
            disabled={enviando}
            aria-pressed={paradaPlanejada === false}
          >
            Não planejada
          </button>
        </div>
      </section>

      <section className={styles.secao}>
        <h2 className={styles.secaoTitulo}>Observação (opcional)</h2>
        <textarea
          className={styles.textarea}
          value={observacao}
          onChange={(e) => setObservacao(e.target.value)}
          placeholder="Detalhes sobre a parada"
          rows={3}
          disabled={enviando}
        />
      </section>

      {erro && <p className={styles.errorMessage}>{erro}</p>}

      <button
        type="button"
        className={styles.botaoConfirmar}
        onClick={confirmarPausa}
        disabled={!camposObrigatoriosPreenchidos || enviando}
      >
        {enviando ? 'Aguarde...' : 'Confirmar Pausa'}
      </button>
    </div>
  )
}
