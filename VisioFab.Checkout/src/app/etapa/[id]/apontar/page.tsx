'use client'

// Tela de apontamento de Produção/Perda/Retrabalho da Etapa (task 23.1) do
// spec `checkout-apontamento`.
//
// Formulário com o mínimo de campos necessários (Requirement 14.3): tipo
// do apontamento (Produção/Perda/Retrabalho), quantidade, motivo de perda
// (só aparece quando o tipo selecionado é "Perda"), observação opcional e
// anexo de foto opcional. Envia para `POST /checkout/etapas/:id/apontar`
// (Requirements 7.1-7.5).
//
// Validação client-side (Requirement 7.5): a quantidade não pode ser
// negativa nem vazia antes de chamar a API — a validação definitiva
// (Zod) permanece no backend.
//
// Quando há foto anexada, o corpo é enviado como `multipart/form-data`
// (via `FormData`); sem foto, como JSON puro — replicando o suporte dual
// já existente na rota do backend.
//
// _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 14.3_

import { useEffect, useState, type FormEvent } from 'react'
import { useParams, useRouter } from 'next/navigation'
import axios from 'axios'
import Link from 'next/link'
import { checkoutApiClient } from '@/lib/checkout-api-client'
import { useSessaoTerminal } from '@/contexts/sessao-terminal-context'
import styles from './apontar.module.css'

/** Chaves de localStorage usadas para o Funcionario identificado (task 19.2). */
const FUNCIONARIO_ID_STORAGE_KEY = 'checkout_funcionario_identificado_id'
const FUNCIONARIO_NOME_STORAGE_KEY = 'checkout_funcionario_identificado_nome'

type TipoApontamento = 'PRODUCAO' | 'PERDA' | 'RETRABALHO'
type MotivoPerda = 'ACERTO' | 'REFUGO' | 'DEFEITO' | 'APARA'

const OPCOES_TIPO: { valor: TipoApontamento; rotulo: string }[] = [
  { valor: 'PRODUCAO', rotulo: 'Produção' },
  { valor: 'PERDA', rotulo: 'Perda' },
  { valor: 'RETRABALHO', rotulo: 'Retrabalho' },
]

const OPCOES_MOTIVO_PERDA: { valor: MotivoPerda; rotulo: string }[] = [
  { valor: 'ACERTO', rotulo: 'Acerto' },
  { valor: 'REFUGO', rotulo: 'Refugo' },
  { valor: 'DEFEITO', rotulo: 'Defeito' },
  { valor: 'APARA', rotulo: 'Apara' },
]

const TIPOS_ARQUIVO_ACEITOS = 'image/jpeg,image/png,image/webp'

/** Lê o Funcionario identificado (task 19.2) salvo em localStorage. */
function lerFuncionarioIdentificado(): { funcionarioId: string; nome: string } | null {
  if (typeof window === 'undefined') return null

  const funcionarioId = window.localStorage.getItem(FUNCIONARIO_ID_STORAGE_KEY)
  const nome = window.localStorage.getItem(FUNCIONARIO_NOME_STORAGE_KEY)

  if (!funcionarioId || !nome) return null
  return { funcionarioId, nome }
}

export default function ApontarPage() {
  const params = useParams<{ id: string }>()
  const etapaId = params.id
  const router = useRouter()
  const { estaAutenticado } = useSessaoTerminal()

  const funcionarioIdentificado = lerFuncionarioIdentificado()

  // Proteção básica de rota client-side (task 29.1, item 5), mesmo
  // padrão já usado em `painel/page.tsx` e `etapa/[id]/page.tsx`.
  useEffect(() => {
    if (!estaAutenticado) {
      router.push('/login-terminal')
    }
  }, [estaAutenticado, router])

  const [tipo, setTipo] = useState<TipoApontamento>('PRODUCAO')
  const [quantidade, setQuantidade] = useState('')
  const [motivoPerda, setMotivoPerda] = useState<MotivoPerda | ''>('')
  const [observacao, setObservacao] = useState('')
  const [foto, setFoto] = useState<File | null>(null)
  const [enviando, setEnviando] = useState(false)
  const [erroValidacao, setErroValidacao] = useState<string | null>(null)
  const [erroEnvio, setErroEnvio] = useState<string | null>(null)

  function selecionarTipo(novoTipo: TipoApontamento) {
    setTipo(novoTipo)
    // Requirement 14.3 — ao trocar de tipo, o motivo de perda (campo
    // exclusivo de "Perda") é descartado para não ser enviado sem sentido.
    if (novoTipo !== 'PERDA') {
      setMotivoPerda('')
    }
  }

  async function enviarApontamento(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (enviando) return

    setErroValidacao(null)
    setErroEnvio(null)

    // Validação client-side (Requirement 7.5) — a validação definitiva
    // permanece no backend.
    const quantidadeNumero = Number(quantidade)
    if (quantidade.trim() === '' || Number.isNaN(quantidadeNumero)) {
      setErroValidacao('Informe a quantidade.')
      return
    }
    if (quantidadeNumero < 0) {
      setErroValidacao('A quantidade não pode ser negativa.')
      return
    }

    setEnviando(true)

    try {
      if (foto) {
        const formData = new FormData()
        formData.append('tipo', tipo)
        formData.append('quantidade', String(quantidadeNumero))
        if (motivoPerda) formData.append('motivoPerda', motivoPerda)
        if (funcionarioIdentificado) formData.append('funcionarioId', funcionarioIdentificado.funcionarioId)
        if (observacao.trim()) formData.append('observacao', observacao.trim())
        formData.append('foto', foto)

        await checkoutApiClient.post(`/etapas/${etapaId}/apontar`, formData, {
          headers: { 'Content-Type': 'multipart/form-data' },
        })
      } else {
        await checkoutApiClient.post(`/etapas/${etapaId}/apontar`, {
          tipo,
          quantidade: quantidadeNumero,
          motivoPerda: motivoPerda || undefined,
          funcionarioId: funcionarioIdentificado?.funcionarioId,
          observacao: observacao.trim() || undefined,
        })
      }

      router.push(`/etapa/${etapaId}`)
    } catch (err) {
      const mensagem =
        (axios.isAxiosError(err) && (err.response?.data as { message?: string } | undefined)?.message) ||
        'Não foi possível registrar o apontamento. Tente novamente.'
      setErroEnvio(mensagem)
    } finally {
      setEnviando(false)
    }
  }

  if (!estaAutenticado) {
    return null
  }

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <Link href={`/etapa/${etapaId}`} className={styles.voltarLink}>
          ‹ Voltar
        </Link>
      </div>

      <h1 className={styles.titulo}>Apontar</h1>

      <form className={styles.form} onSubmit={enviarApontamento}>
        <div className={styles.tipoGrupo} role="radiogroup" aria-label="Tipo de apontamento">
          {OPCOES_TIPO.map((opcao) => (
            <button
              key={opcao.valor}
              type="button"
              role="radio"
              aria-checked={tipo === opcao.valor}
              className={`${styles.botaoTipo} ${tipo === opcao.valor ? styles.botaoTipoAtivo : ''}`}
              onClick={() => selecionarTipo(opcao.valor)}
            >
              {opcao.rotulo}
            </button>
          ))}
        </div>

        {tipo === 'PERDA' && (
          <div className={styles.campo}>
            <label className={styles.rotulo} htmlFor="motivoPerda">
              Motivo da perda
            </label>
            <select
              id="motivoPerda"
              className={styles.select}
              value={motivoPerda}
              onChange={(event) => setMotivoPerda(event.target.value as MotivoPerda)}
              required
            >
              <option value="">Selecione...</option>
              {OPCOES_MOTIVO_PERDA.map((opcao) => (
                <option key={opcao.valor} value={opcao.valor}>
                  {opcao.rotulo}
                </option>
              ))}
            </select>
          </div>
        )}

        <div className={styles.campo}>
          <label className={styles.rotulo} htmlFor="quantidade">
            Quantidade
          </label>
          <input
            id="quantidade"
            type="number"
            inputMode="decimal"
            min="0"
            step="any"
            className={styles.input}
            value={quantidade}
            onChange={(event) => setQuantidade(event.target.value)}
            required
          />
        </div>

        {erroValidacao && <p className={styles.errorMessage}>{erroValidacao}</p>}

        <div className={styles.campo}>
          <label className={styles.rotulo} htmlFor="observacao">
            Observação (opcional)
          </label>
          <textarea
            id="observacao"
            className={styles.textarea}
            rows={2}
            value={observacao}
            onChange={(event) => setObservacao(event.target.value)}
          />
        </div>

        <div className={styles.campo}>
          <label className={styles.rotulo} htmlFor="foto">
            Foto (opcional)
          </label>
          <input
            id="foto"
            type="file"
            accept={TIPOS_ARQUIVO_ACEITOS}
            className={styles.inputArquivo}
            onChange={(event) => setFoto(event.target.files?.[0] ?? null)}
          />
        </div>

        {erroEnvio && <p className={styles.errorMessage}>{erroEnvio}</p>}

        <button type="submit" className={styles.botaoConfirmar} disabled={enviando}>
          {enviando ? 'Enviando...' : 'Confirmar'}
        </button>
      </form>
    </div>
  )
}
