'use client'

// Tela de autorização de Apontamento_Retroativo pelo Supervisor (task 26.2
// do spec `checkout-apontamento`).
//
// Formulário que autoriza um `Apontamento_Retroativo` vinculado a um
// `ApontamentoEtapa` ORIGINAL (o apontamento sendo corrigido/
// complementado), chamando `POST /checkout/apontamentos/:id/retroativo`.
//
// Decisão de design (documentada aqui por não haver equivalente no
// design.md): não existe, em nenhuma outra tela deste spec, uma lista de
// "apontamentos passíveis de correção" para navegar até esta tela. A
// forma mais simples de implementar o MVP é pedir o `apontamentoOrigemId`
// (UUID do `ApontamentoEtapa` original) como campo de texto digitado
// manualmente pelo Supervisor — mesma limitação de MVP já assumida na
// task 18.1 para `empresaId`/`centroProducaoId` (ausência de seletor/lista
// disponível no momento). Quando existir uma tela de histórico/lista de
// apontamentos com ação de "corrigir", ela pode navegar para esta rota
// pré-preenchendo o campo via query string, sem alterar o restante do
// formulário.
//
// `autorizacaoSupervisor` (email + senha) é obrigatório na prática: o
// backend bloqueia com 400 sem ele (Requirement 11.3), mesmo que o tipo
// TypeScript do corpo o marque como opcional na camada de rota — por
// isso ambos os campos são exigidos no cliente antes de habilitar o envio.
//
// Em sucesso, exibe confirmação e limpa o formulário — permanece na
// mesma tela para permitir autorizar outra correção em sequência, já que
// não há navegação de origem que precise ser "desfeita".
//
// _Requirements: 11.2, 11.3_

import { useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import axios from 'axios'
import { checkoutApiClient } from '@/lib/checkout-api-client'
import { useSessaoTerminal } from '@/contexts/sessao-terminal-context'
import styles from './autorizar-retroativo.module.css'

/** Shape do corpo aceito por `POST /checkout/apontamentos/:id/retroativo`. */
interface RegistrarApontamentoRetroativoBody {
  motivo: string
  quantidade?: number
  observacao?: string
  fotoUrl?: string
  autorizacaoSupervisor: {
    email: string
    senha: string
  }
}

export default function AutorizarRetroativoPage() {
  const router = useRouter()
  const { estaAutenticado } = useSessaoTerminal()

  const [apontamentoOrigemId, setApontamentoOrigemId] = useState('')
  const [motivo, setMotivo] = useState('')
  const [quantidade, setQuantidade] = useState('')
  const [observacao, setObservacao] = useState('')
  const [email, setEmail] = useState('')
  const [senha, setSenha] = useState('')

  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [sucesso, setSucesso] = useState(false)

  const camposObrigatoriosPreenchidos =
    apontamentoOrigemId.trim() !== '' && motivo.trim() !== '' && email.trim() !== '' && senha !== ''

  function limparFormulario() {
    setApontamentoOrigemId('')
    setMotivo('')
    setQuantidade('')
    setObservacao('')
    setEmail('')
    setSenha('')
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!camposObrigatoriosPreenchidos || enviando) return

    setEnviando(true)
    setErro(null)
    setSucesso(false)

    const quantidadeNumerica = quantidade.trim() !== '' ? Number(quantidade) : undefined

    const body: RegistrarApontamentoRetroativoBody = {
      motivo: motivo.trim(),
      quantidade: quantidadeNumerica,
      observacao: observacao.trim() ? observacao.trim() : undefined,
      autorizacaoSupervisor: {
        email: email.trim(),
        senha,
      },
    }

    try {
      await checkoutApiClient.post(`/apontamentos/${apontamentoOrigemId.trim()}/retroativo`, body)
      setSucesso(true)
      limparFormulario()
    } catch (err) {
      const mensagem =
        (axios.isAxiosError(err) && (err.response?.data as { message?: string } | undefined)?.message) ||
        'Não foi possível registrar o apontamento retroativo. Tente novamente.'
      setErro(mensagem)
    } finally {
      setEnviando(false)
    }
  }

  if (!estaAutenticado) {
    return (
      <div className={styles.container}>
        <p className={styles.infoMessage}>Sessão do Terminal não encontrada.</p>
        <button type="button" className={styles.voltarButton} onClick={() => router.push('/login-terminal')}>
          Ir para o login do Terminal
        </button>
      </div>
    )
  }

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <h1 className={styles.title}>Autorizar Apontamento Retroativo</h1>
        <button type="button" className={styles.voltarButton} onClick={() => router.push('/painel')}>
          Voltar ao painel
        </button>
      </header>

      <form className={styles.form} onSubmit={handleSubmit}>
        <section className={styles.secao}>
          <label className={styles.label} htmlFor="apontamentoOrigemId">
            ID do apontamento original (UUID) *
          </label>
          <input
            id="apontamentoOrigemId"
            type="text"
            className={styles.input}
            value={apontamentoOrigemId}
            onChange={(e) => setApontamentoOrigemId(e.target.value)}
            placeholder="Ex: 3fa85f64-5717-4562-b3fc-2c963f66afa6"
            disabled={enviando}
            required
          />
        </section>

        <section className={styles.secao}>
          <label className={styles.label} htmlFor="motivo">
            Motivo da correção *
          </label>
          <textarea
            id="motivo"
            className={styles.textarea}
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            placeholder="Explique o motivo da correção retroativa"
            rows={3}
            disabled={enviando}
            required
          />
        </section>

        <section className={styles.secao}>
          <label className={styles.label} htmlFor="quantidade">
            Quantidade (opcional)
          </label>
          <input
            id="quantidade"
            type="number"
            min={0}
            step="any"
            inputMode="decimal"
            className={styles.input}
            value={quantidade}
            onChange={(e) => setQuantidade(e.target.value)}
            placeholder="Quantidade a corrigir/complementar"
            disabled={enviando}
          />
        </section>

        <section className={styles.secao}>
          <label className={styles.label} htmlFor="observacao">
            Observação (opcional)
          </label>
          <textarea
            id="observacao"
            className={styles.textarea}
            value={observacao}
            onChange={(e) => setObservacao(e.target.value)}
            placeholder="Detalhes adicionais"
            rows={2}
            disabled={enviando}
          />
        </section>

        <section className={styles.secaoAutorizacao}>
          <h2 className={styles.secaoTitulo}>Autorização de Supervisor</h2>
          <p className={styles.secaoDescricao}>
            Informe as credenciais do Supervisor que está autorizando esta correção.
          </p>

          <label className={styles.label} htmlFor="email">
            E-mail *
          </label>
          <input
            id="email"
            type="email"
            className={styles.input}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="supervisor@empresa.com"
            disabled={enviando}
            required
          />

          <label className={styles.label} htmlFor="senha">
            Senha *
          </label>
          <input
            id="senha"
            type="password"
            className={styles.input}
            value={senha}
            onChange={(e) => setSenha(e.target.value)}
            placeholder="Senha do Supervisor"
            disabled={enviando}
            required
          />
        </section>

        {erro && <p className={styles.errorMessage}>{erro}</p>}

        {sucesso && (
          <p className={styles.sucessoMessage}>Apontamento retroativo registrado com sucesso</p>
        )}

        <button
          type="submit"
          className={styles.botaoConfirmar}
          disabled={!camposObrigatoriosPreenchidos || enviando}
        >
          {enviando ? 'Aguarde...' : 'Autorizar e Registrar'}
        </button>
      </form>
    </div>
  )
}
