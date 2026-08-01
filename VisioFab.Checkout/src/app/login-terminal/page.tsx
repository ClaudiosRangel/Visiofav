'use client'

// Tela de login do Terminal — Supervisor autentica o Terminal físico com
// suas credenciais + Centro_Producao, obtendo o Token_Checkout (escopo
// CHECKOUT_OPERADOR, válido por 12h) que autentica o Terminal como um todo
// (não o Operador individual — isso é feito depois, por PIN, na tela
// identificar-operador).
//
// Quando já existe uma Sessão_Terminal ativa, esta mesma tela também
// expõe a troca do Centro_Producao vinculado a essa sessão (Requirement
// 1.6) — ação exclusiva de Supervisor, que exige nova autenticação de
// credenciais (email/senha), já que a rota `PATCH
// /checkout/auth/sessao/trocar-centro` é protegida por `checkoutAuth`
// (exige um Token_Checkout válido, ou seja, uma sessão já ativa).
//
// _Requirements: 1.1, 1.2, 1.3, 1.6_

import { useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { checkoutApiClient, salvarToken } from '@/lib/checkout-api-client'
import { useSessaoTerminal } from '@/contexts/sessao-terminal-context'
import styles from './login-terminal.module.css'

/**
 * Mensagem de erro genérica exibida em qualquer falha de autenticação
 * (credenciais inválidas ou perfil não autorizado) — Requirement 1.2/1.3.
 * O backend (`sessao-terminal.service.ts`) já retorna mensagens curtas e
 * seguras ("Credenciais inválidas", "Perfil não autorizado para
 * autenticar um Terminal"), mas mantemos uma mensagem própria fixa aqui
 * para não acoplar o texto exibido ao texto exato do backend.
 */
const MENSAGEM_ERRO_GENERICA = 'Credenciais inválidas ou centro de produção não autorizado'

interface RespostaSessaoTerminal {
  token: string
  sessaoTerminalId: string
  centroProducaoId: string
  expiraEm: string
}

/**
 * NOTA DE DECISÃO (MVP): não existe, no escopo atual do spec, um endpoint
 * público de listagem de Empresas/Centros de Produção consumível antes de
 * haver uma Sessão_Terminal ativa. Por isso `empresaId` e
 * `centroProducaoId` são campos de texto simples (UUID) em vez de um
 * seletor. Isso é aceitável para o MVP do Terminal: na prática, esses
 * valores tendem a ser fixos por Terminal físico em produção (o mesmo
 * tablet/computador sempre aponta para o mesmo Centro_Producao), podendo
 * inclusive ser pré-preenchidos via configuração local do dispositivo em
 * uma iteração futura.
 */
export default function LoginTerminalPage() {
  const router = useRouter()
  const { estaAutenticado, centroProducaoId: centroProducaoIdAtivo, iniciarSessao } = useSessaoTerminal()

  const [email, setEmail] = useState('')
  const [senha, setSenha] = useState('')
  const [empresaId, setEmpresaId] = useState('')
  const [centroProducaoId, setCentroProducaoId] = useState('')
  const [erro, setErro] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)

  // Estado da seção de troca de centro (Requirement 1.6), visível apenas
  // quando já existe uma Sessão_Terminal ativa (`estaAutenticado`).
  const [mostrarTrocarCentro, setMostrarTrocarCentro] = useState(false)
  const [novoCentroProducaoId, setNovoCentroProducaoId] = useState('')
  const [emailTrocarCentro, setEmailTrocarCentro] = useState('')
  const [senhaTrocarCentro, setSenhaTrocarCentro] = useState('')
  const [erroTrocarCentro, setErroTrocarCentro] = useState<string | null>(null)
  const [sucessoTrocarCentro, setSucessoTrocarCentro] = useState(false)
  const [enviandoTrocarCentro, setEnviandoTrocarCentro] = useState(false)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setErro(null)
    setEnviando(true)

    try {
      const response = await checkoutApiClient.post<RespostaSessaoTerminal>('/auth/sessao', {
        email,
        senha,
        centroProducaoId,
        empresaId,
      })

      salvarToken(response.data.token)
      iniciarSessao({
        centroProducaoId: response.data.centroProducaoId,
        sessaoTerminalId: response.data.sessaoTerminalId,
        expiraEm: new Date(response.data.expiraEm),
      })

      router.push('/painel')
    } catch {
      // Credenciais inválidas (401) ou perfil não autorizado (403) — o
      // backend já responde com mensagem curta e segura, mas exibimos uma
      // mensagem genérica própria (Requirement 1.2/1.3) para não acoplar
      // o texto exibido ao texto exato retornado pela API.
      setErro(MENSAGEM_ERRO_GENERICA)
    } finally {
      setEnviando(false)
    }
  }

  async function handleSubmitTrocarCentro(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setErroTrocarCentro(null)
    setSucessoTrocarCentro(false)
    setEnviandoTrocarCentro(true)

    try {
      const response = await checkoutApiClient.patch<RespostaSessaoTerminal>('/auth/sessao/trocar-centro', {
        novoCentroProducaoId,
        email: emailTrocarCentro,
        senha: senhaTrocarCentro,
      })

      salvarToken(response.data.token)
      iniciarSessao({
        centroProducaoId: response.data.centroProducaoId,
        sessaoTerminalId: response.data.sessaoTerminalId,
        expiraEm: new Date(response.data.expiraEm),
      })

      setSucessoTrocarCentro(true)
      setNovoCentroProducaoId('')
      setEmailTrocarCentro('')
      setSenhaTrocarCentro('')
    } catch {
      // Credenciais inválidas (401) ou centro inexistente/perfil não
      // autorizado (403/404) — mensagem genérica, mesmo padrão do login
      // principal (Requirement 1.2/1.3 aplicado também à troca de centro).
      setErroTrocarCentro(MENSAGEM_ERRO_GENERICA)
    } finally {
      setEnviandoTrocarCentro(false)
    }
  }

  return (
    <div className={styles.container}>
      <div className={styles.card}>
        <h1 className={styles.title}>Login do Terminal</h1>
        <p className={styles.subtitle}>Autenticação de Supervisor para vincular este Terminal a um Centro de Produção</p>

        <form className={styles.form} onSubmit={handleSubmit}>
          {erro && <p className={styles.errorMessage}>{erro}</p>}

          <div className={styles.field}>
            <label className={styles.label} htmlFor="email">
              E-mail do Supervisor
            </label>
            <input
              id="email"
              type="email"
              className={styles.input}
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              autoComplete="username"
              required
            />
          </div>

          <div className={styles.field}>
            <label className={styles.label} htmlFor="senha">
              Senha
            </label>
            <input
              id="senha"
              type="password"
              className={styles.input}
              value={senha}
              onChange={(event) => setSenha(event.target.value)}
              autoComplete="current-password"
              required
            />
          </div>

          <div className={styles.field}>
            <label className={styles.label} htmlFor="empresaId">
              Empresa (ID)
            </label>
            <input
              id="empresaId"
              type="text"
              className={styles.input}
              value={empresaId}
              onChange={(event) => setEmpresaId(event.target.value)}
              placeholder="UUID da empresa"
              required
            />
          </div>

          <div className={styles.field}>
            <label className={styles.label} htmlFor="centroProducaoId">
              Centro de Produção (ID)
            </label>
            <input
              id="centroProducaoId"
              type="text"
              className={styles.input}
              value={centroProducaoId}
              onChange={(event) => setCentroProducaoId(event.target.value)}
              placeholder="UUID do centro de produção"
              required
            />
          </div>

          <button type="submit" className={styles.submitButton} disabled={enviando}>
            {enviando ? 'Entrando...' : 'Entrar'}
          </button>
        </form>

        {estaAutenticado && (
          <div className={styles.trocarCentroSection}>
            <button
              type="button"
              className={styles.trocarCentroToggle}
              onClick={() => setMostrarTrocarCentro((valor) => !valor)}
            >
              {mostrarTrocarCentro ? 'Cancelar troca de centro' : 'Trocar centro de produção'}
            </button>

            {mostrarTrocarCentro && (
              <form className={styles.form} onSubmit={handleSubmitTrocarCentro}>
                <p className={styles.subtitle}>
                  Centro atual: {centroProducaoIdAtivo} — informe suas credenciais de Supervisor para trocar
                </p>

                {erroTrocarCentro && <p className={styles.errorMessage}>{erroTrocarCentro}</p>}
                {sucessoTrocarCentro && <p className={styles.successMessage}>Centro de produção atualizado com sucesso</p>}

                <div className={styles.field}>
                  <label className={styles.label} htmlFor="novoCentroProducaoId">
                    Novo Centro de Produção (ID)
                  </label>
                  <input
                    id="novoCentroProducaoId"
                    type="text"
                    className={styles.input}
                    value={novoCentroProducaoId}
                    onChange={(event) => setNovoCentroProducaoId(event.target.value)}
                    placeholder="UUID do novo centro de produção"
                    required
                  />
                </div>

                <div className={styles.field}>
                  <label className={styles.label} htmlFor="emailTrocarCentro">
                    E-mail do Supervisor
                  </label>
                  <input
                    id="emailTrocarCentro"
                    type="email"
                    className={styles.input}
                    value={emailTrocarCentro}
                    onChange={(event) => setEmailTrocarCentro(event.target.value)}
                    autoComplete="username"
                    required
                  />
                </div>

                <div className={styles.field}>
                  <label className={styles.label} htmlFor="senhaTrocarCentro">
                    Senha
                  </label>
                  <input
                    id="senhaTrocarCentro"
                    type="password"
                    className={styles.input}
                    value={senhaTrocarCentro}
                    onChange={(event) => setSenhaTrocarCentro(event.target.value)}
                    autoComplete="current-password"
                    required
                  />
                </div>

                <button type="submit" className={styles.submitButton} disabled={enviandoTrocarCentro}>
                  {enviandoTrocarCentro ? 'Trocando...' : 'Trocar centro'}
                </button>
              </form>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
