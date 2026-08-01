'use client'

// Tela de login do Terminal — fluxo em dois passos:
// 1. Supervisor informa email/senha → backend valida e retorna empresas/centros disponíveis
// 2. Supervisor seleciona empresa e centro de produção → backend cria a Sessão_Terminal
//
// Sem UUIDs digitados manualmente — tudo via seletores populados pela API.
//
// _Requirements: 1.1, 1.2, 1.3, 1.6_

import { useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { checkoutApiClient, salvarToken } from '@/lib/checkout-api-client'
import { useSessaoTerminal } from '@/contexts/sessao-terminal-context'
import styles from './login-terminal.module.css'

interface OpcaoEmpresa { id: string; nome: string }
interface OpcaoCentro { id: string; nome: string }

export default function LoginTerminalPage() {
  const router = useRouter()
  const { iniciarSessao } = useSessaoTerminal()

  // Passo 1 — credenciais
  const [email, setEmail] = useState('')
  const [senha, setSenha] = useState('')
  const [erroCredenciais, setErroCredenciais] = useState<string | null>(null)
  const [validando, setValidando] = useState(false)

  // Passo 2 — seletores (populados pelo pré-login)
  const [passo, setPasso] = useState<1 | 2>(1)
  const [empresas, setEmpresas] = useState<OpcaoEmpresa[]>([])
  const [centros, setCentros] = useState<OpcaoCentro[]>([])
  const [empresaSelecionada, setEmpresaSelecionada] = useState('')
  const [centroSelecionado, setCentroSelecionado] = useState('')
  const [erroLogin, setErroLogin] = useState<string | null>(null)
  const [logando, setLogando] = useState(false)
  const [carregandoCentros, setCarregandoCentros] = useState(false)

  async function handleValidarCredenciais(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setErroCredenciais(null)
    setValidando(true)

    try {
      const response = await checkoutApiClient.post<{ empresas: OpcaoEmpresa[]; centros: OpcaoCentro[] }>(
        '/auth/pre-login',
        { email, senha }
      )

      setEmpresas(response.data.empresas)
      setCentros(response.data.centros)

      if (response.data.empresas.length === 1) {
        setEmpresaSelecionada(response.data.empresas[0].id)
      }
      if (response.data.centros.length === 1) {
        setCentroSelecionado(response.data.centros[0].id)
      }

      setPasso(2)
    } catch {
      setErroCredenciais('Credenciais inválidas ou perfil não autorizado')
    } finally {
      setValidando(false)
    }
  }

  async function handleSelecionarEmpresa(novaEmpresaId: string) {
    setEmpresaSelecionada(novaEmpresaId)
    setCentroSelecionado('')
    setCentros([])
    setCarregandoCentros(true)

    try {
      const response = await checkoutApiClient.get<OpcaoCentro[]>(`/auth/centros/${novaEmpresaId}`)
      setCentros(response.data)
      if (response.data.length === 1) {
        setCentroSelecionado(response.data[0].id)
      }
    } catch {
      setCentros([])
    } finally {
      setCarregandoCentros(false)
    }
  }

  async function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setErroLogin(null)
    setLogando(true)

    try {
      const response = await checkoutApiClient.post<{
        token: string
        sessaoTerminalId: string
        centroProducaoId: string
        expiraEm: string
      }>('/auth/sessao', {
        email,
        senha,
        empresaId: empresaSelecionada,
        centroProducaoId: centroSelecionado,
      })

      salvarToken(response.data.token)
      iniciarSessao({
        centroProducaoId: response.data.centroProducaoId,
        sessaoTerminalId: response.data.sessaoTerminalId,
        expiraEm: new Date(response.data.expiraEm),
      })

      router.push('/painel')
    } catch {
      setErroLogin('Falha ao criar sessão. Verifique as credenciais e tente novamente.')
    } finally {
      setLogando(false)
    }
  }

  return (
    <div className={styles.container}>
      <div className={styles.card}>
        <h1 className={styles.title}>Login do Terminal</h1>
        <p className={styles.subtitle}>
          {passo === 1
            ? 'Informe as credenciais do Supervisor para ativar este Terminal'
            : 'Selecione a empresa e o centro de produção'}
        </p>

        {passo === 1 && (
          <form className={styles.form} onSubmit={handleValidarCredenciais}>
            {erroCredenciais && <p className={styles.errorMessage}>{erroCredenciais}</p>}

            <div className={styles.field}>
              <label className={styles.label} htmlFor="email">E-mail</label>
              <input
                id="email"
                type="email"
                className={styles.input}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="username"
                required
              />
            </div>

            <div className={styles.field}>
              <label className={styles.label} htmlFor="senha">Senha</label>
              <input
                id="senha"
                type="password"
                className={styles.input}
                value={senha}
                onChange={(e) => setSenha(e.target.value)}
                autoComplete="current-password"
                required
              />
            </div>

            <button type="submit" className={styles.submitButton} disabled={validando}>
              {validando ? 'Verificando...' : 'Continuar'}
            </button>
          </form>
        )}

        {passo === 2 && (
          <form className={styles.form} onSubmit={handleLogin}>
            {erroLogin && <p className={styles.errorMessage}>{erroLogin}</p>}

            <div className={styles.field}>
              <label className={styles.label} htmlFor="empresa">Empresa</label>
              <select
                id="empresa"
                className={styles.input}
                value={empresaSelecionada}
                onChange={(e) => handleSelecionarEmpresa(e.target.value)}
                required
              >
                <option value="">Selecione...</option>
                {empresas.map((emp) => (
                  <option key={emp.id} value={emp.id}>{emp.nome}</option>
                ))}
              </select>
            </div>

            <div className={styles.field}>
              <label className={styles.label} htmlFor="centro">Centro de Produção</label>
              <select
                id="centro"
                className={styles.input}
                value={centroSelecionado}
                onChange={(e) => setCentroSelecionado(e.target.value)}
                required
                disabled={carregandoCentros || centros.length === 0}
              >
                <option value="">{carregandoCentros ? 'Carregando...' : 'Selecione...'}</option>
                {centros.map((c) => (
                  <option key={c.id} value={c.id}>{c.nome}</option>
                ))}
              </select>
              {!carregandoCentros && empresaSelecionada && centros.length === 0 && (
                <p className={styles.errorMessage}>Nenhum centro de produção cadastrado para esta empresa</p>
              )}
            </div>

            <button type="submit" className={styles.submitButton} disabled={logando || !centroSelecionado}>
              {logando ? 'Entrando...' : 'Ativar Terminal'}
            </button>

            <button
              type="button"
              className={styles.voltarButton}
              onClick={() => { setPasso(1); setErroLogin(null) }}
            >
              ← Voltar
            </button>
          </form>
        )}
      </div>
    </div>
  )
}
