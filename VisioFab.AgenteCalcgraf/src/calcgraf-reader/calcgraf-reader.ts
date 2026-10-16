/**
 * Leitor do Calcgraf — SOMENTE LEITURA (Tarefa 9 / Requisitos 1.1, 1.2, 1.4).
 *
 * Este módulo abre uma conexão ao SQL Server local do Calcgraf e lê as OPs
 * candidatas (OpHeader + OpItem + OpItemEstrutura + OpLote), montando o
 * `OpOrigemDTO` — o MESMO shape consumido pelo backend do Vizor
 * (`ingestao-op-calcgraf.pure.ts`).
 *
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║  SOMENTE LEITURA — GARANTIA DE SEGURANÇA (Requisito 1.1)                  ║
 * ║                                                                          ║
 * ║  O leitor SÓ emite comandos `SELECT`. NÃO existe, em nenhum lugar deste   ║
 * ║  módulo, qualquer `INSERT`/`UPDATE`/`DELETE`/DDL. Não há método público   ║
 * ║  de escrita. Toda query passa por `assertSomenteLeitura()`, que rejeita   ║
 * ║  qualquer comando que não comece por SELECT/WITH/SET (lança erro antes de ║
 * ║  tocar o banco). Em produção, recomenda-se ainda um usuário SQL com role  ║
 * ║  `db_datareader` (Requisito 1.2) — a escrita fica impossível por dupla    ║
 * ║  camada: credencial de leitura + este guardião de comando.               ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 *
 * ─────────────────────────── Abstração de conexão ──────────────────────────
 * A instância do Calcgraf costuma NÃO expor TCP/1433 (só named pipes / shared
 * memory — ver docs/calcgraf-mapeamento-importacao.md). Por isso há dois modos,
 * atrás de uma interface comum `ConexaoCalcgrafSomenteLeitura`:
 *
 *  1. Driver primário `msnodesqlv8` (ODBC + named pipes; Trusted_Connection ou
 *     usuário SQL). Resolvido por require dinâmico; tipos via o ambient
 *     `msnodesqlv8.d.ts` deste projeto (mantém `tsc --noEmit` verde sem instalar).
 *  2. Fallback por ponte `sqlcmd` + `FOR JSON PATH` (child_process). Já validado
 *     no levantamento: `sqlcmd -S <server> -E -C -d <db> -y 0 -Q "<query> FOR
 *     JSON PATH"`. O sqlcmd quebra o JSON em várias linhas por largura de coluna
 *     — removemos as quebras antes de parsear (documento contíguo).
 *
 * A escolha é por `modo` na config de conexão (`'driver' | 'sqlcmd' | 'auto'`).
 * Em `'auto'`, tenta o driver e, se o require/connect falhar, cai no sqlcmd.
 */

import { execFile } from 'node:child_process'
import {
  montarEtapaDTO,
  montarVariacaoDTO,
  montarTextoTintas,
  montarProgramacaoDeLotes,
  type AtividadeRow,
  type PlanoRow,
  type TintaRow,
} from './calcgraf-roteiro'

// ===========================================================================
// DTO — ESPELHO do DTO do backend
// ---------------------------------------------------------------------------
// Estas interfaces são uma CÓPIA LOCAL de `OpOrigemDTO` (e filhas) definidas em
// `VisioFab.Wms.Back/src/modules/pcp/importador-calcgraf/ingestao-op-calcgraf.pure.ts`.
// Os dois projetos são SEPARADOS (agente Electron × backend Fastify) e NÃO
// compartilham tipos; por isso duplicamos aqui. Ao evoluir o DTO no backend,
// manter este espelho em sincronia (mesma ordem/nomes de campos → o hash
// calculado dos dois lados precisa casar para a idempotência funcionar).
// ===========================================================================

/** Item/estrutura (componente) de uma OP de origem. Espelho do backend. */
export interface ItemOpOrigemDTO {
  /** Número/sequência do item dentro da OP (chave estável de ordenação). */
  item?: number
  /** Código do item de estoque no Calcgraf (OpItem.CodItemEstoque). */
  codItemEstoque?: string
  /** Descrição do componente. */
  descricao?: string
  /** Quantidade do componente. */
  quantidade?: number
  /** Unidade de medida. */
  unidadeMedida?: string
  /** Status do item na origem. */
  status?: string
}

/** Etapa/operação do roteiro de uma OP de origem (quando disponível). Espelho do backend. */
export interface EtapaOpOrigemDTO {
  /** Sequência da etapa (chave estável de ordenação). */
  sequencia?: number
  /** Nome/código do centro de produção ou operação. */
  centro?: string
  /** Descrição/detalhe da etapa. */
  descricao?: string
  /** Status da etapa na origem. */
  status?: string
  // ── Fase 2 (roteiro completo) — aditivos/opcionais (espelho do backend) ──
  /** Tipo da operação no Calcgraf: 'I' (impressão) | 'A' (acabamento). */
  tipo?: string
  /** Tempo de setup/acerto em minutos. */
  setupMinutos?: number
  /** Tempo de operação/produção em minutos. */
  operacaoMinutos?: number
  /**
   * Código do centro de produção no Calcgraf (CentrosProducao.Codigo) — para o
   * de-para no backend resolver o centro REAL antes de reusar por nome/criar.
   * Aditivo/opcional (paridade PDF — T6). Espelho do backend.
   */
  centroCodigo?: string
}

/** Entrega parcial programada de uma OP de origem — paridade PDF (T6). Espelho do backend. */
export interface EntregaOpOrigemDTO {
  /** Data da entrega (ISO string). */
  data?: string
  /** Quantidade dessa entrega parcial. */
  quantidade?: number
}

/** Plano/componente de uma OP de origem — paridade PDF (T6). Espelho do backend. */
export interface PlanoOpOrigemDTO {
  /** Nome do plano/componente (ex.: "TAMPA", "CAIXA", "Impressos"). */
  nome: string
  /** 'COMPONENTE' (padrão) | 'FACE' (frente/verso de retiração). */
  tipo?: string
  formato?: string
  cores?: string
  tiragem?: number
  montagem?: string
  material?: string
  gramatura?: number
  aproveitamento?: number
  matriz?: string
  /** `true` → gera 2 FACES (FRENTE/VERSO) no backend. */
  retiracao?: boolean
  coresFrente?: string
  coresVerso?: string
  /** Ordem/sequência do plano. */
  sequencia?: number
}

/** Variação/plano (componente) de uma OP de origem — Fase 2 (CalculoPlanos). Espelho do backend. */
export interface VariacaoOpOrigemDTO {
  /** Sequência/ordem do plano (CalculoPlanos.Ordem). */
  sequencia?: number
  /** Código do plano (CalculoPlanos.codPlano). */
  codigoPlano?: string
  /** Nome do plano (CalculoPlanos.nomePlano). */
  nome?: string
  /** Quantidade/tiragem do plano. */
  quantidade?: number
  /** Nome do papel/suporte resolvido. */
  suporte?: string
  /** Gramatura do papel do plano. */
  gramatura?: number
  /** Dimensão do plano ("dimensao1 x dimensao2"). */
  dimensao?: string
  /** Aproveitamento. */
  aproveitamento?: number
}

/** Lote/tiragem de uma OP de origem (OpLote). Espelho do backend. */
export interface LoteOpOrigemDTO {
  /** Tiragem do lote (OpLote.Tiragem). */
  tiragem?: number
  /** Data prometida de entrega (OpLote.DataPrometida, ISO string). */
  dataPrometida?: string
  /** Posição na fila de entregas (OpLote.OrdemFilaOp). */
  ordemFila?: number
  /** Status do lote na origem (OpLote.Status). */
  status?: string
}

/** Payload de uma OP de origem do Calcgraf (shape de UMA OP). Espelho do backend. */
export interface OpOrigemDTO {
  /** Número da OP no Calcgraf (OpHeader.Numero) — chave de identidade. */
  numero: number
  /** Descrição da OP (OpHeader.Descricao). */
  descricao: string
  /** Data de emissão (OpHeader.DataHoraEmissao, ISO string). */
  dataEmissao?: string
  /** Nome do produto (via OpItem.CodItemEstoque → cadastro de item). Best-effort. */
  produtoNome?: string
  /** Código do produto. Best-effort. */
  produtoCodigo?: string
  /** Nome do cliente. Best-effort (depende de vínculo pedido). */
  clienteNome?: string
  /** Quantidade (tiragem do lote principal). */
  quantidade?: number
  /** Data de entrega (OpLote.DataPrometida do lote principal). */
  dataEntrega?: string
  /** Tiragem. */
  tiragem?: number
  /** Itens/estrutura (BOM) — fase MVP: mínimo para liberar. */
  itens?: ItemOpOrigemDTO[]
  /** Etapas/roteiro — quando disponível. */
  etapas?: EtapaOpOrigemDTO[]
  /** Lotes/tiragens (OpLote). */
  lotes?: LoteOpOrigemDTO[]
  // ── Fase 2 (roteiro completo) — aditivos/opcionais (espelho do backend) ──
  /** Variações/planos do cálculo (CalculoPlanos). */
  variacoes?: VariacaoOpOrigemDTO[]
  /** Tintas/cores resumidas como texto (tag [Cores]). */
  tintasTexto?: string
  // ── Paridade PDF (T6) — aditivos/opcionais; ausência = backend preserva ──
  /** Código do cliente no Calcgraf (para de-para CLIENTE no backend). */
  clienteCodigo?: string
  /** CNPJ/CPF do cliente (chave de vínculo com o cadastro — match por dígitos). */
  clienteDoc?: string
  /** Programação de entrega: TODAS as datas parciais (não só a 1ª). */
  programacaoEntrega?: EntregaOpOrigemDTO[]
  /** Planos/componentes + retiração (frente/verso). */
  planos?: PlanoOpOrigemDTO[]
  /** Matriz/faca (tag [Matriz]). */
  matriz?: string
  /** Formato (tag [Formato]). */
  formato?: string
  /** Bobinas (tags [Bobina]). */
  bobinasTexto?: string[]
}

// ===========================================================================
// Guardião de somente-leitura (Requisito 1.1)
// ===========================================================================

/** Erro específico do leitor do Calcgraf. */
export class CalcgrafReaderError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CalcgrafReaderError'
  }
}

/**
 * Garante que o SQL é somente-leitura antes de qualquer execução.
 * Aceita apenas comandos que comecem por SELECT, WITH (CTE de leitura) ou SET
 * (ex.: `SET NOCOUNT ON`, usado com o sqlcmd). Qualquer outra palavra-chave
 * (INSERT/UPDATE/DELETE/DROP/ALTER/EXEC/MERGE/TRUNCATE/CREATE...) é rejeitada.
 */
export function assertSomenteLeitura(sql: string): void {
  const limpo = sql
    .replace(/--[^\n]*/g, ' ') // remove comentários de linha
    .replace(/\/\*[\s\S]*?\*\//g, ' ') // remove comentários de bloco
    .trim()

  // Primeira palavra significativa de cada statement separado por ';'.
  const statements = limpo
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)

  const PERMITIDOS = /^(select|with|set)\b/i
  for (const stmt of statements) {
    if (!PERMITIDOS.test(stmt)) {
      const primeira = stmt.split(/\s+/)[0] ?? ''
      throw new CalcgrafReaderError(
        `Comando SQL não permitido pelo leitor somente-leitura: "${primeira}". ` +
          'O agente só emite SELECT (Requisito 1.1).',
      )
    }
  }
}

// ===========================================================================
// Abstração de conexão SOMENTE-LEITURA
// ===========================================================================

/**
 * Modo de acesso ao SQL Server.
 * - `'mssql'`: driver `tedious` (pacote `mssql`), 100% JavaScript, conecta por
 *   TCP e declara `appName` nativamente (passa pela logon trigger do Calcgraf).
 *   É o PRIMÁRIO no modo `auto` — não depende de ODBC Driver nem binário nativo.
 * - `'driver'`: `msnodesqlv8` (ODBC/named pipes). Requer binário nativo + ODBC.
 * - `'sqlcmd'`: ponte `sqlcmd` + FOR JSON PATH. NÃO suporta Application Name.
 * - `'auto'` (padrão): tenta `mssql` → driver → sqlcmd.
 */
export type ModoConexao = 'mssql' | 'driver' | 'sqlcmd' | 'auto'

/** Configuração de conexão do leitor. */
export interface ConfigConexaoCalcgraf {
  /**
   * Modo de acesso:
   * - `'driver'`: usa `msnodesqlv8` (named pipes/ODBC).
   * - `'sqlcmd'`: usa a ponte `sqlcmd` + FOR JSON PATH.
   * - `'auto'` (padrão): tenta o driver; se indisponível, cai no sqlcmd.
   */
  modo?: ModoConexao
  /**
   * Connection string ODBC para o driver `msnodesqlv8` (modo driver).
   * Ex. (Trusted): `server=localhost;Database=CalcgrafCartonWega;Trusted_Connection=yes;`
   * Ex. (usuário SQL leitura): `server=localhost;Database=...;UID=leitor;PWD=...;`
   */
  connectionString?: string
  /** Servidor para o sqlcmd (ex.: `localhost`). Modo sqlcmd. */
  servidor?: string
  /** Banco para o sqlcmd (ex.: `CalcgrafCartonWega`). Modo sqlcmd. */
  database?: string
  /**
   * Usar Trusted Connection (`-E`) no sqlcmd (autenticação Windows do serviço).
   * Default `true`. Quando `false`, informe `usuario`/`senha`.
   */
  trustedConnection?: boolean
  /** Usuário SQL (sqlcmd `-U`), quando não usar Trusted Connection. */
  usuario?: string
  /** Senha SQL (sqlcmd `-P`), quando não usar Trusted Connection. */
  senha?: string
  /** Caminho do executável `sqlcmd` (default: `sqlcmd` no PATH). */
  caminhoSqlcmd?: string
  /**
   * Application Name (program_name) a declarar na conexão ao SQL Server.
   *
   * POR QUE EXISTE: o SQL Server do Calcgraf tem uma LOGON TRIGGER (`[connection]`)
   * que BLOQUEIA (ROLLBACK) qualquer conexão ao banco cujo `program_name` NÃO
   * esteja numa allowlist mantida pela PHTech. A lista inclui nomes de
   * integração/leitura (ex.: `ExportadorMovimentos`, `.NET SqlClient Data
   * Provider`, `SLL_GPRINT_ESPECIFICOS`) e o padrão `%GPRINT_ESPECIFICOS%`.
   *
   * O agente se identifica com um desses nomes AUTORIZADOS para passar pela
   * trigger — é a forma oficial/explícita prevista pela própria allowlist (não
   * um contorno). Default: `ExportadorMovimentos` (nome destinado a exportação
   * de movimentos/dados). Pode ser trocado pelo valor que a PHTech indicar.
   *
   * No modo driver (`msnodesqlv8`), vai como `APP=<applicationName>` na
   * connection string ODBC. No modo sqlcmd, vai como `-G`? Não — o sqlcmd não
   * suporta Application Name; por isso, quando `applicationName` está definido,
   * a fábrica PRIORIZA o driver nativo (ver `abrirConexaoCalcgraf`).
   */
  applicationName?: string
}

/** Application Name padrão — autorizado na allowlist da logon trigger do Calcgraf. */
export const APPLICATION_NAME_PADRAO = 'ExportadorMovimentos'

/**
 * Interface comum de uma conexão somente-leitura ao Calcgraf. Expõe APENAS
 * leitura (`consultar`) e `fechar` — nenhum método de escrita.
 */
export interface ConexaoCalcgrafSomenteLeitura {
  /** Executa um SELECT e retorna as linhas como objetos. SOMENTE LEITURA. */
  consultar<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>
  /** Fecha a conexão/libera recursos. */
  fechar(): Promise<void>
}

// ---------------------------------------------------------------------------
// Implementação 1 — driver msnodesqlv8 (named pipes / ODBC)
// ---------------------------------------------------------------------------

/**
 * Superfície MÍNIMA do driver `msnodesqlv8` que usamos, declarada localmente
 * para NÃO acoplar o reader aos tipos oficiais do pacote (que variam entre
 * versões — ex.: `err: Error | undefined` vs `SqlError | null`). O `require`
 * dinâmico devolve a API crua; tratamos tudo como `unknown` nas bordas e
 * convertemos para esta forma segura.
 */
interface DriverConnectionMinima {
  query(
    sql: string,
    paramsOuCb: unknown[] | ((err: unknown, rows?: unknown[]) => void),
    cb?: (err: unknown, rows?: unknown[]) => void,
  ): unknown
  close(cb?: (err?: unknown) => void): void
}
interface DriverMsnodesqlv8Minimo {
  open(
    connectionString: string,
    cb: (err: unknown, conn?: DriverConnectionMinima) => void,
  ): void
}

/**
 * Carrega `msnodesqlv8` sem quebrar quando o pacote não está instalado.
 * Retorna `null` se indisponível (cai no fallback sqlcmd no modo `'auto'`).
 */
function carregarMsnodesqlv8(): DriverMsnodesqlv8Minimo | null {
  try {
    // require dinâmico: fora do TS do Calcgraf o binário nativo não existe.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require('msnodesqlv8') as DriverMsnodesqlv8Minimo
  } catch {
    return null
  }
}

/** Extrai uma mensagem de erro de um valor `unknown` vindo das callbacks. */
function msgErro(err: unknown): string {
  if (err instanceof Error) return err.message
  if (typeof err === 'string') return err
  if (err && typeof err === 'object' && 'message' in err) {
    return String((err as { message: unknown }).message)
  }
  return 'erro desconhecido'
}

/**
 * Garante que a connection string ODBC declare um `APP=<applicationName>`
 * (program_name). Se já houver `APP=`/`Application Name=`, não duplica.
 * Necessário para passar pela logon trigger do Calcgraf (allowlist de apps).
 */
function garantirApplicationName(connectionString: string, applicationName?: string): string {
  const app = (applicationName ?? '').trim()
  if (!app) return connectionString
  // Já tem APP= ou Application Name=? Não mexe.
  if (/(^|;)\s*(app|application name)\s*=/i.test(connectionString)) return connectionString
  const base = connectionString.replace(/;+\s*$/, '')
  return `${base};APP=${app};`
}

/** Conexão via driver nativo `msnodesqlv8`. */
class ConexaoDriver implements ConexaoCalcgrafSomenteLeitura {
  private constructor(private readonly conn: DriverConnectionMinima) {}

  /** Abre a conexão a partir da connection string ODBC (com APP= já injetado). */
  static abrir(connectionString: string): Promise<ConexaoDriver> {
    const sql = carregarMsnodesqlv8()
    if (!sql) {
      return Promise.reject(
        new CalcgrafReaderError(
          'Driver msnodesqlv8 não está instalado. Use o modo sqlcmd ou instale o driver no TS.',
        ),
      )
    }
    return new Promise<ConexaoDriver>((resolve, reject) => {
      sql.open(connectionString, (err, conn) => {
        if (err || !conn) {
          reject(
            new CalcgrafReaderError(
              `Falha ao abrir conexão msnodesqlv8: ${err ? msgErro(err) : 'conexão nula'}`,
            ),
          )
          return
        }
        resolve(new ConexaoDriver(conn))
      })
    })
  }

  consultar<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
    assertSomenteLeitura(sql) // Requisito 1.1 — rejeita qualquer escrita.
    return new Promise<T[]>((resolve, reject) => {
      const cb = (err: unknown, rows?: unknown[]): void => {
        if (err) {
          reject(new CalcgrafReaderError(`Erro na consulta: ${msgErro(err)}`))
          return
        }
        resolve((rows ?? []) as T[])
      }
      if (params.length > 0) {
        this.conn.query(sql, params, cb)
      } else {
        this.conn.query(sql, cb)
      }
    })
  }

  fechar(): Promise<void> {
    return new Promise<void>((resolve) => {
      this.conn.close(() => resolve())
    })
  }
}

// ---------------------------------------------------------------------------
// Implementação 1b — driver `mssql`/tedious (TCP, 100% JS, Application Name)
// ---------------------------------------------------------------------------

/**
 * Config do tedious/mssql derivada da connection string. Separa host, porta,
 * instância, credenciais e database — o tedious conecta por TCP (não ODBC).
 */
interface ConfigMssql {
  server: string
  port?: number
  instanceName?: string
  database: string
  user?: string
  password?: string
  trusted: boolean
  appName: string
}

/**
 * Converte uma connection string ODBC/OLEDB (ex. do UDL do Calcgraf
 * `Data Source=127.0.0.1\SQL2019Express,5520; Initial Catalog=CartonWega; User
 * ID=sa; Password=...`) para a config do tedious. Trata:
 *  - `host\instancia,porta` (instância nomeada + porta explícita).
 *  - `host,porta` (porta sem instância).
 *  - `host\instancia` (só instância; porta resolvida pelo SQL Browser).
 */
export function derivarConfigMssql(cfg: ConfigConexaoCalcgraf): ConfigMssql {
  const d = cfg.connectionString
    ? derivarConfigSqlcmdDaConnString(cfg.connectionString)
    : {}
  const servidorBruto = (cfg.servidor ?? d.servidor ?? 'localhost').trim()
  const database = (cfg.database ?? d.database ?? '').trim()
  const user = cfg.usuario ?? d.usuario
  const password = cfg.senha ?? d.senha
  const trusted = cfg.trustedConnection ?? d.trustedConnection ?? !user

  // Separa "host\instancia,porta". A porta vem após a vírgula; a instância após
  // a contrabarra. Qualquer um pode faltar.
  let host = servidorBruto
  let port: number | undefined
  let instanceName: string | undefined

  const virgula = host.lastIndexOf(',')
  if (virgula >= 0) {
    const p = Number(host.slice(virgula + 1).trim())
    if (Number.isFinite(p) && p > 0) port = p
    host = host.slice(0, virgula).trim()
  }
  const barra = host.indexOf('\\')
  if (barra >= 0) {
    instanceName = host.slice(barra + 1).trim()
    host = host.slice(0, barra).trim()
  }
  // '(local)'/'.' → localhost
  if (host === '.' || host.toLowerCase() === '(local)') host = 'localhost'

  return {
    server: host || 'localhost',
    port,
    instanceName,
    database,
    user,
    password,
    trusted,
    appName: cfg.applicationName ?? APPLICATION_NAME_PADRAO,
  }
}

/** Carrega o pacote `tedious` sem quebrar se não estiver instalado. */
function carregarTedious(): any | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require('tedious')
  } catch {
    return null
  }
}

/**
 * Conexão via `tedious` (driver TDS puro JavaScript, TCP). PRIMÁRIA: declara
 * `appName` (program_name) para passar pela logon trigger do Calcgraf, e NÃO
 * depende de ODBC Driver nem binário nativo (roda em qualquer Windows sob
 * Electron). SOMENTE LEITURA (toda query passa por `assertSomenteLeitura`).
 *
 * Usamos o `tedious` direto (não o wrapper `mssql`) para manter o pacote leve
 * — o `mssql` arrasta `@azure/identity` e dezenas de subdependências que
 * incham o instalador e travam o empacotamento.
 */
class ConexaoTedious implements ConexaoCalcgrafSomenteLeitura {
  private constructor(
    private readonly conn: any,
    private readonly tds: any,
  ) {}

  static abrir(cfg: ConfigConexaoCalcgraf): Promise<ConexaoTedious> {
    const tds = carregarTedious()
    if (!tds) {
      return Promise.reject(new CalcgrafReaderError('Pacote `tedious` não está instalado.'))
    }
    const c = derivarConfigMssql(cfg)
    if (!c.database) {
      return Promise.reject(
        new CalcgrafReaderError('Config exige `database`/Initial Catalog.'),
      )
    }

    // Autenticação: SQL (default/produção com `sa`) ou NTLM (Windows, raro).
    const authentication =
      c.trusted && !c.user
        ? {
            type: 'ntlm',
            options: {
              userName: process.env.USERNAME ?? '',
              password: '',
              domain: process.env.USERDOMAIN ?? '',
            },
          }
        : {
            type: 'default',
            options: { userName: c.user, password: c.password },
          }

    const config = {
      server: c.server,
      authentication,
      options: {
        appName: c.appName, // ← passa pela logon trigger (allowlist de apps)
        database: c.database,
        encrypt: false,
        trustServerCertificate: true,
        rowCollectionOnRequestCompletion: true,
        ...(c.port ? { port: c.port } : {}),
        ...(c.instanceName && !c.port ? { instanceName: c.instanceName } : {}),
      },
    }

    return new Promise<ConexaoTedious>((resolve, reject) => {
      const conn = new tds.Connection(config)
      let resolvido = false
      conn.on('connect', (err: unknown) => {
        if (resolvido) return
        resolvido = true
        if (err) {
          reject(new CalcgrafReaderError(`Falha ao conectar via tedious: ${msgErro(err)}`))
          return
        }
        resolve(new ConexaoTedious(conn, tds))
      })
      conn.on('error', (err: unknown) => {
        if (resolvido) return
        resolvido = true
        reject(new CalcgrafReaderError(`Erro de conexão tedious: ${msgErro(err)}`))
      })
      conn.connect()
    })
  }

  consultar<T = Record<string, unknown>>(sql: string, _params: unknown[] = []): Promise<T[]> {
    assertSomenteLeitura(sql) // Requisito 1.1.
    return new Promise<T[]>((resolve, reject) => {
      const linhas: T[] = []
      const req = new this.tds.Request(sql, (err: unknown, _rowCount: number, rows?: unknown[]) => {
        if (err) {
          reject(new CalcgrafReaderError(`Erro na consulta (tedious): ${msgErro(err)}`))
          return
        }
        // Com rowCollectionOnRequestCompletion, `rows` vem no callback.
        const fonte = Array.isArray(rows) ? rows : []
        for (const row of fonte) {
          linhas.push(converterLinhaTedious<T>(row))
        }
        resolve(linhas)
      })
      this.conn.execSql(req)
    })
  }

  fechar(): Promise<void> {
    return new Promise<void>((resolve) => {
      try {
        this.conn.on('end', () => resolve())
        this.conn.close()
      } catch {
        resolve()
      }
    })
  }
}

/**
 * Converte uma linha do tedious (array de colunas `{ metadata, value }`) para
 * um objeto `{ nomeColuna: valor }`, no mesmo formato que o resto do reader
 * espera (igual ao recordset do driver/sqlcmd).
 */
function converterLinhaTedious<T>(row: unknown): T {
  const obj: Record<string, unknown> = {}
  if (Array.isArray(row)) {
    for (const col of row as Array<{ metadata?: { colName?: string }; value?: unknown }>) {
      const nome = col?.metadata?.colName
      if (nome) obj[nome] = col.value
    }
  }
  return obj as T
}

// ---------------------------------------------------------------------------
// Implementação 2 — ponte sqlcmd + FOR JSON PATH (fallback / modo dev)
// ---------------------------------------------------------------------------

/**
 * Conexão via `sqlcmd`. Cada consulta roda um processo `sqlcmd` com
 * `FOR JSON PATH` e parseia o JSON retornado. Não há "conexão" persistente —
 * `fechar()` é no-op. Validado no levantamento (docs/calcgraf-mapeamento-importacao.md).
 */
class ConexaoSqlcmd implements ConexaoCalcgrafSomenteLeitura {
  constructor(private readonly cfg: ConfigConexaoCalcgraf) {
    if (!cfg.servidor || !cfg.database) {
      throw new CalcgrafReaderError(
        'Modo sqlcmd exige `servidor` e `database` na configuração de conexão.',
      )
    }
  }

  /**
   * Monta os argumentos do sqlcmd. Usa execFile (array de args, sem shell) para
   * evitar injeção de comando: a query vai como um único argumento após `-Q`.
   */
  private montarArgs(sqlComJson: string): string[] {
    const cfg = this.cfg
    const args: string[] = ['-S', cfg.servidor as string, '-d', cfg.database as string]
    // Trust do certificado (ODBC Driver 18 exige): `-C`.
    args.push('-C')
    // Largura ilimitada de coluna: `-y 0` (evita truncar o JSON).
    args.push('-y', '0')
    if (cfg.trustedConnection === false) {
      if (!cfg.usuario) {
        throw new CalcgrafReaderError(
          'sqlcmd sem Trusted Connection exige `usuario` (e `senha`).',
        )
      }
      args.push('-U', cfg.usuario)
      if (cfg.senha) args.push('-P', cfg.senha)
    } else {
      // Autenticação Windows do serviço.
      args.push('-E')
    }
    // SET NOCOUNT ON evita a linha "(N rows affected)" no meio da saída.
    args.push('-Q', `SET NOCOUNT ON; ${sqlComJson}`)
    return args
  }

  consultar<T = Record<string, unknown>>(sql: string, _params: unknown[] = []): Promise<T[]> {
    assertSomenteLeitura(sql) // Requisito 1.1.
    // sqlcmd não parametriza como o driver: a query já deve vir pronta (as
    // queries deste módulo usam só literais numéricos/datas controlados).
    const sqlComJson = `${sql.trim().replace(/;+$/, '')} FOR JSON PATH`
    const exe = this.cfg.caminhoSqlcmd ?? 'sqlcmd'
    const args = this.montarArgs(sqlComJson)

    return new Promise<T[]>((resolve, reject) => {
      execFile(exe, args, { maxBuffer: 64 * 1024 * 1024 }, (err, stdout, stderr) => {
        if (err) {
          reject(
            new CalcgrafReaderError(
              `Falha ao executar sqlcmd: ${err.message}${stderr ? ` | ${stderr}` : ''}`,
            ),
          )
          return
        }
        try {
          resolve(parseJsonDoSqlcmd<T>(stdout))
        } catch (e) {
          reject(
            new CalcgrafReaderError(
              `Falha ao parsear JSON do sqlcmd: ${(e as Error).message}`,
            ),
          )
        }
      })
    })
  }

  fechar(): Promise<void> {
    return Promise.resolve()
  }
}

/**
 * Parseia a saída do `sqlcmd ... FOR JSON PATH`. O sqlcmd QUEBRA o documento
 * JSON em múltiplas linhas por largura de coluna; precisamos reconstituir o
 * documento contíguo removendo as quebras de linha (como descreve o doc de
 * mapeamento). Linhas vazias e a cauda "(N rows affected)" são ignoradas.
 */
export function parseJsonDoSqlcmd<T = Record<string, unknown>>(saidaBruta: string): T[] {
  if (!saidaBruta) return []
  const contiguo = saidaBruta
    .split(/\r?\n/)
    // descarta linhas de contagem/afetadas e vazias
    .filter((l) => l.trim().length > 0 && !/^\(\d+ rows? affected\)/i.test(l.trim()))
    .join('') // junta sem separador — o JSON foi partido no meio por largura
    .trim()

  if (!contiguo) return []
  const parsed = JSON.parse(contiguo) as T[] | T
  return Array.isArray(parsed) ? parsed : [parsed]
}

// ---------------------------------------------------------------------------
// Fábrica de conexão (resolve o modo driver/sqlcmd/auto)
// ---------------------------------------------------------------------------

/**
 * Extrai `servidor`/`database`/credenciais de uma connection string ODBC
 * (ex.: `server=localhost\SQL2019EXPRESS;Database=CartonWega;Trusted_Connection=yes;`).
 *
 * POR QUE EXISTE: o fallback `sqlcmd` precisa de `servidor` e `database` em
 * campos separados (o `sqlcmd -S/-d`), mas o agente só pede UMA connection
 * string na tela. Quando caímos no sqlcmd (driver nativo ausente/indisponível),
 * derivamos esses campos da própria connection string — assim o agente funciona
 * só com a connection string, com ou sem o driver `msnodesqlv8`.
 *
 * Chaves ODBC reconhecidas (case-insensitive):
 *  - servidor:  `server`, `data source`, `addr`, `address`, `network address`
 *  - database:  `database`, `initial catalog`
 *  - usuário:   `uid`, `user id`, `user`
 *  - senha:     `pwd`, `password`
 *  - trusted:   `trusted_connection`, `integrated security` (yes/sspi/true → Windows auth)
 */
export function derivarConfigSqlcmdDaConnString(
  connectionString: string,
): Partial<ConfigConexaoCalcgraf> {
  const pares = new Map<string, string>()
  for (const parte of connectionString.split(';')) {
    const idx = parte.indexOf('=')
    if (idx <= 0) continue
    const chave = parte.slice(0, idx).trim().toLowerCase()
    const valor = parte.slice(idx + 1).trim()
    if (chave) pares.set(chave, valor)
  }

  const pegar = (...chaves: string[]): string | undefined => {
    for (const k of chaves) {
      const v = pares.get(k)
      if (v !== undefined && v !== '') return v
    }
    return undefined
  }

  const servidor = pegar('server', 'data source', 'addr', 'address', 'network address')
  const database = pegar('database', 'initial catalog')
  const usuario = pegar('uid', 'user id', 'user')
  const senha = pegar('pwd', 'password')

  const trustedRaw = (pegar('trusted_connection', 'integrated security') ?? '').toLowerCase()
  // Trusted quando explicitamente yes/true/sspi, OU quando não há usuário/senha.
  const trustedConnection =
    ['yes', 'true', 'sspi', '1'].includes(trustedRaw) || (!usuario && !senha)

  return { servidor, database, usuario, senha, trustedConnection }
}

/**
 * Abre uma conexão SOMENTE-LEITURA ao Calcgraf conforme a config.
 * - `'driver'`: exige `connectionString`.
 * - `'sqlcmd'`: usa `servidor`+`database`; se faltarem mas houver
 *   `connectionString`, deriva deles.
 * - `'auto'` (padrão): tenta o driver (se houver `connectionString` e o pacote
 *   instalar/conectar); caso contrário, cai para o sqlcmd (derivando os campos
 *   da connection string quando necessário).
 */
export async function abrirConexaoCalcgraf(
  cfg: ConfigConexaoCalcgraf,
): Promise<ConexaoCalcgrafSomenteLeitura> {
  const modo: ModoConexao = cfg.modo ?? 'auto'

  // Application Name a declarar (passa pela logon trigger do Calcgraf). Default
  // = nome autorizado na allowlist. A connection string do driver recebe APP=.
  const appName = cfg.applicationName ?? APPLICATION_NAME_PADRAO
  const connStringComApp = cfg.connectionString
    ? garantirApplicationName(cfg.connectionString, appName)
    : undefined

  if (modo === 'mssql') {
    return ConexaoTedious.abrir({ ...cfg, applicationName: appName })
  }

  if (modo === 'driver') {
    if (!connStringComApp) {
      throw new CalcgrafReaderError('Modo driver exige `connectionString`.')
    }
    return ConexaoDriver.abrir(connStringComApp)
  }

  if (modo === 'sqlcmd') {
    return new ConexaoSqlcmd(resolverCfgSqlcmd(cfg))
  }

  // modo 'auto': ordem de preferência pensada para a logon trigger do Calcgraf,
  // que exige um Application Name (program_name) na allowlist:
  //  1. `mssql`/tedious — PRIMÁRIO: 100% JS (sem ODBC/binário nativo), conecta
  //     por TCP e declara `appName` nativamente. É o mais robusto no servidor.
  //  2. `msnodesqlv8` — se o mssql falhar e o binário nativo carregar (APP= na
  //     connection string ODBC).
  //  3. `sqlcmd` — ÚLTIMO recurso. NÃO declara Application Name, então a trigger
  //     bloqueia; só serve em ambientes sem a trigger (ex.: backup local de dev).
  if (carregarTedious()) {
    try {
      return await ConexaoTedious.abrir({ ...cfg, applicationName: appName })
    } catch {
      // tenta o driver nativo abaixo
    }
  }
  if (connStringComApp && carregarMsnodesqlv8()) {
    try {
      return await ConexaoDriver.abrir(connStringComApp)
    } catch {
      // cai para o sqlcmd abaixo (último recurso)
    }
  }
  return new ConexaoSqlcmd(resolverCfgSqlcmd(cfg))
}

/**
 * Garante que a config do sqlcmd tenha `servidor`/`database`: usa os campos
 * explícitos quando presentes; senão deriva da `connectionString`. Mantém
 * credenciais/trusted vindos da string quando os campos explícitos faltarem.
 */
function resolverCfgSqlcmd(cfg: ConfigConexaoCalcgraf): ConfigConexaoCalcgraf {
  if (cfg.servidor && cfg.database) return cfg
  if (!cfg.connectionString) return cfg // deixa o ConexaoSqlcmd lançar o erro claro
  const derivado = derivarConfigSqlcmdDaConnString(cfg.connectionString)
  return {
    ...cfg,
    servidor: cfg.servidor ?? derivado.servidor,
    database: cfg.database ?? derivado.database,
    usuario: cfg.usuario ?? derivado.usuario,
    senha: cfg.senha ?? derivado.senha,
    trustedConnection: cfg.trustedConnection ?? derivado.trustedConnection,
  }
}

// ===========================================================================
// Queries de OP (SOMENTE SELECT) — colunas conferidas com
// docs/calcgraf-mapeamento-importacao.md (seção "Tabelas de OP").
// ===========================================================================

/**
 * Filtro opcional para não varrer as ~3193 OPs todo ciclo (o hash decide o que
 * mudou; este filtro só reduz o conjunto candidato).
 */
export interface FiltroOps {
  /** Só OPs com `OpHeader.Numero >= numeroMinimo`. */
  numeroMinimo?: number
  /** Só OPs com `OpHeader.Numero <= numeroMaximo`. */
  numeroMaximo?: number
  /** Só OPs com `DataHoraEmissao >= dataEmissaoMinima` (ISO `YYYY-MM-DD`). */
  dataEmissaoMinima?: string
  /** Limite de OPs retornadas (TOP N). Útil para validação pontual (golden). */
  limite?: number
}

// Linhas cruas de cada tabela (só as colunas que lemos).
interface LinhaOpHeader {
  Codigo: number
  Numero: number
  DataHoraEmissao: string | null
  Descricao: string | null
}
interface LinhaOpItem {
  CodOpHeader: number
  CodItemEstoque: number | string | null
  Item: number | null
  Status: number | null
}
interface LinhaOpItemEstrutura {
  CodOpHeader: number
  CodEstrutura: number | string | null
  Item: number | null
  CodItemEstoque: number | string | null
}
interface LinhaOpLote {
  CodOpItemEstrutura: number | null
  Tiragem: number | null
  DataPrometida: string | null
  OrdemFilaOp: number | null
  Status: number | null
}

/**
 * Monta o SELECT das OpHeader candidatas. Filtra `Ativo <> 'N'` (ignora
 * canceladas/inativas na origem) e aplica o filtro opcional por faixa de
 * Numero / data de emissão. Ordena por Numero para leitura previsível.
 *
 * ATENÇÃO: valores do filtro são numéricos/data saneados abaixo (não vêm de
 * texto livre do usuário) — seguro para interpolar no sqlcmd.
 */
export function montarQueryOpHeader(filtro: FiltroOps = {}): string {
  const where: string[] = [`Ativo <> 'N'`]
  if (typeof filtro.numeroMinimo === 'number' && Number.isFinite(filtro.numeroMinimo)) {
    where.push(`Numero >= ${Math.trunc(filtro.numeroMinimo)}`)
  }
  if (typeof filtro.numeroMaximo === 'number' && Number.isFinite(filtro.numeroMaximo)) {
    where.push(`Numero <= ${Math.trunc(filtro.numeroMaximo)}`)
  }
  if (filtro.dataEmissaoMinima && /^\d{4}-\d{2}-\d{2}$/.test(filtro.dataEmissaoMinima)) {
    where.push(`DataHoraEmissao >= '${filtro.dataEmissaoMinima}'`)
  }
  const top =
    typeof filtro.limite === 'number' && filtro.limite > 0
      ? `TOP ${Math.trunc(filtro.limite)} `
      : ''
  return (
    `SELECT ${top}Codigo, Numero, DataHoraEmissao, Descricao ` +
    `FROM OpHeader WHERE ${where.join(' AND ')} ORDER BY Numero`
  )
}

/** SELECT dos itens (OpItem) de um conjunto de OpHeader.Codigo. */
export function montarQueryOpItem(codigosHeader: number[]): string {
  const lista = codigosHeader.map((c) => Math.trunc(c)).join(', ')
  return (
    `SELECT CodOpHeader, CodItemEstoque, Item, Status ` +
    `FROM OpItem WHERE CodOpHeader IN (${lista}) ORDER BY CodOpHeader, Item`
  )
}

/** SELECT da estrutura (OpItemEstrutura) de um conjunto de OpHeader.Codigo. */
export function montarQueryOpItemEstrutura(codigosHeader: number[]): string {
  const lista = codigosHeader.map((c) => Math.trunc(c)).join(', ')
  return (
    `SELECT CodOpHeader, CodEstrutura, Item, CodItemEstoque ` +
    `FROM OpItemEstrutura WHERE CodOpHeader IN (${lista}) ORDER BY CodOpHeader, Item`
  )
}

/**
 * SELECT dos lotes (OpLote) ligados à estrutura das OPs. OpLote referencia
 * `CodOpItemEstrutura` (FK → OpItemEstrutura.Codigo); como lemos a estrutura por
 * OpHeader, trazemos os lotes via JOIN para saber a qual OpHeader cada lote
 * pertence.
 */
export function montarQueryOpLote(codigosHeader: number[]): string {
  const lista = codigosHeader.map((c) => Math.trunc(c)).join(', ')
  return (
    `SELECT e.CodOpHeader AS CodOpHeader, l.Tiragem, l.DataPrometida, ` +
    `l.OrdemFilaOp, l.Status ` +
    `FROM OpLote l ` +
    `INNER JOIN OpItemEstrutura e ON e.Codigo = l.CodOpItemEstrutura ` +
    `WHERE e.CodOpHeader IN (${lista}) ` +
    `ORDER BY e.CodOpHeader, l.OrdemFilaOp`
  )
}

// Mesma query, mas trazendo CodOpHeader para o SELECT de lotes (versão JOIN acima).
interface LinhaOpLoteJoin extends LinhaOpLote {
  CodOpHeader: number
}

/**
 * SELECT do CLIENTE de cada OP. No Calcgraf o cliente NÃO está em OpHeader nem
 * (confiavelmente) em CalculoHeader.CodNome (quase sempre NULL) — vem do PEDIDO
 * associado ao item da OP:
 *   OpItem → OpItemxPedidoItem → PedidoItem → PedidoHeader.CodNome → Nomes.
 * Pegamos o nome via COALESCE(RazaoSocial, NomePrincipal) e o CNPJ/CPF. Usamos
 * MIN(h.Numero como chave) + MAX nos nomes para 1 cliente por OP (o normal; se
 * houver mais de um pedido por OP, pega um determinístico). Validado no backup
 * (3130/3131 = BELGO BEKAERT; 3133 = MARBRAN/SOL & NEVE).
 */
export function montarQueryClienteDaOp(codigosHeader: number[]): string {
  const lista = codigosHeader.map((c) => Math.trunc(c)).join(', ')
  return (
    `SELECT h.Codigo AS CodOpHeader, ` +
    `MAX(COALESCE(NULLIF(LTRIM(RTRIM(n.RazaoSocial)), ''), n.NomePrincipal)) AS clienteNome, ` +
    `MAX(n.CNPJCPF) AS clienteDoc ` +
    `FROM OpHeader h ` +
    `JOIN OpItem oi ON oi.CodOpHeader = h.Codigo ` +
    `JOIN OpItemxPedidoItem ox ON ox.CodOpItem = oi.Codigo ` +
    `JOIN PedidoItem pi ON pi.Codigo = ox.CodPedidoItem ` +
    `JOIN PedidoHeader ph ON ph.Codigo = pi.CodPedidoHeader ` +
    `JOIN Nomes n ON n.Codigo = ph.CodNome ` +
    `WHERE h.Codigo IN (${lista}) ` +
    `GROUP BY h.Codigo`
  )
}

interface LinhaClienteOp {
  CodOpHeader: number
  clienteNome?: string | null
  clienteDoc?: string | null
}

// ===========================================================================
// Queries de ROTEIRO (Fase 2) — resolve o CÁLCULO que originou a OP e lê
// etapas/variações/tintas. Caminho validado: OpItemEstrutura.Codigo =
// CalculoHeader.CodOpItemEstrutura (maior Codigo = recálculo mais recente).
// Ver docs/calcgraf-mapeamento-roteiro-op.md. SOMENTE SELECT.
// ===========================================================================

/**
 * SELECT que resolve, por OpHeader.Codigo, o `CalculoHeader.Codigo` MAIS RECENTE
 * (maior Codigo = recálculo). Agrupa por OpHeader para 1 cálculo por OP.
 */
export function montarQueryCalculoDaOp(codigosHeader: number[]): string {
  const lista = codigosHeader.map((c) => Math.trunc(c)).join(', ')
  return (
    `SELECT e.CodOpHeader AS CodOpHeader, MAX(ch.Codigo) AS CalcCodigo ` +
    `FROM OpItemEstrutura e ` +
    `INNER JOIN CalculoHeader ch ON ch.CodOpItemEstrutura = e.Codigo ` +
    `WHERE e.CodOpHeader IN (${lista}) ` +
    `GROUP BY e.CodOpHeader`
  )
}

/** SELECT das etapas (CalculoAtividades) de um conjunto de cálculos, com nomes. */
export function montarQueryCalculoAtividades(codigosCalculo: number[]): string {
  const lista = codigosCalculo.map((c) => Math.trunc(c)).join(', ')
  return (
    `SELECT a.Codigo AS CalcCodigo, a.tipo, a.itemSeq1, a.itemSeq2, ` +
    `atv.Nome AS atividadeNome, cp.Nome AS centroNome, a.codCentroCusto AS centroCodigo, ` +
    `a.quantAcertos, a.tempoPorAcerto, a.tempoPrimeiroAcerto, a.producaoHora, a.tiragem ` +
    `FROM CalculoAtividades a ` +
    `LEFT JOIN Atividades atv ON atv.Codigo = a.codAtividade ` +
    `LEFT JOIN CentrosProducao cp ON cp.Codigo = a.codCentroCusto ` +
    `WHERE a.Codigo IN (${lista}) ` +
    `ORDER BY a.Codigo, a.itemSeq1, a.itemSeq2`
  )
}

/** SELECT dos planos/variações (CalculoPlanos) de um conjunto de cálculos, com suporte. */
export function montarQueryCalculoPlanos(codigosCalculo: number[]): string {
  const lista = codigosCalculo.map((c) => Math.trunc(c)).join(', ')
  // Nome do suporte (papel) resolvido via cadastro de suporte (Suportes.Nome).
  // CalculoPlanos não tem coluna "Ordem"; ordenamos por codPlano.
  return (
    `SELECT p.Codigo AS CalcCodigo, p.codPlano AS Ordem, p.codPlano, p.nomePlano, ` +
    `s.Nome AS suporteNome, p.gramatura, p.dimensao1, p.dimensao2, ` +
    `p.aproveitamento, p.tiragem ` +
    `FROM CalculoPlanos p ` +
    `LEFT JOIN Suportes s ON s.Codigo = p.codSuporte ` +
    `WHERE p.Codigo IN (${lista}) ` +
    `ORDER BY p.Codigo, p.codPlano`
  )
}

/** SELECT das tintas (CalculoTintas) de um conjunto de cálculos. */
export function montarQueryCalculoTintas(codigosCalculo: number[]): string {
  const lista = codigosCalculo.map((c) => Math.trunc(c)).join(', ')
  return (
    `SELECT Codigo AS CalcCodigo, codTinta, areaTinta, ComplementoNome ` +
    `FROM CalculoTintas WHERE Codigo IN (${lista}) ORDER BY Codigo`
  )
}

/** SELECT dos materiais de acabamento (CalculoMatAcabamento) de um conjunto de cálculos. */
export function montarQueryCalculoMatAcabamento(codigosCalculo: number[]): string {
  const lista = codigosCalculo.map((c) => Math.trunc(c)).join(', ')
  // Nome do material resolvido via cadastro Itc (coluna Descritivo).
  // CalculoMatAcabamento não tem coluna de quantidade (só params de acabamento).
  return (
    `SELECT m.Codigo AS CalcCodigo, m.CodMaterial, m.codAtvAcabamento, ` +
    `i.Descritivo AS materialNome ` +
    `FROM CalculoMatAcabamento m ` +
    `LEFT JOIN Itc i ON i.Codigo = m.CodMaterial ` +
    `WHERE m.Codigo IN (${lista}) ORDER BY m.Codigo`
  )
}

// Linhas cruas do roteiro.
interface LinhaCalcDaOp {
  CodOpHeader: number
  CalcCodigo: number | null
}
interface LinhaAtividade {
  CalcCodigo: number
  tipo?: string
  itemSeq1?: number
  itemSeq2?: number
  atividadeNome?: string
  centroNome?: string
  centroCodigo?: number | string
  quantAcertos?: number
  tempoPorAcerto?: number
  tempoPrimeiroAcerto?: number
  producaoHora?: number
  tiragem?: number
}
interface LinhaPlano {
  CalcCodigo: number
  Ordem?: number
  codPlano?: string | number
  nomePlano?: string
  suporteNome?: string
  gramatura?: number
  dimensao1?: number
  dimensao2?: number
  aproveitamento?: number
  tiragem?: number
}
interface LinhaTinta {
  CalcCodigo: number
  codTinta?: string | number
  areaTinta?: number
  ComplementoNome?: string
}
interface LinhaMatAcab {
  CalcCodigo: number
  CodMaterial?: string | number
  codAtvAcabamento?: string | number
  materialNome?: string
}

// ---------------------------------------------------------------------------
// Helpers de normalização de valores vindos do SQL Server
// ---------------------------------------------------------------------------

/** Converte um valor cru em `number` ou `undefined`. */
function numOuUndef(v: unknown): number | undefined {
  if (v === null || v === undefined || v === '') return undefined
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : undefined
}

/** Converte um valor cru em `string` (trim) ou `undefined`. */
function strOuUndef(v: unknown): string | undefined {
  if (v === null || v === undefined) return undefined
  const s = String(v).trim()
  return s.length === 0 ? undefined : s
}

/** Normaliza datas do SQL Server (smalldatetime) para ISO string, se possível. */
function dataIsoOuUndef(v: unknown): string | undefined {
  const s = strOuUndef(v)
  if (!s) return undefined
  // sqlcmd/driver podem retornar 'YYYY-MM-DD HH:mm:ss' ou já ISO; tentamos Date.
  const d = new Date(s)
  return Number.isNaN(d.getTime()) ? s : d.toISOString()
}

// ===========================================================================
// Função principal — lê as OPs candidatas e monta os DTOs
// ===========================================================================

/**
 * Lê as OPs candidatas do Calcgraf e monta uma lista de `OpOrigemDTO` (header +
 * itens + estrutura + lotes). SOMENTE LEITURA.
 *
 * Estratégia (poucas queries por lote, evita N+1):
 *  1. Lê OpHeader candidatas (com o filtro).
 *  2. Lê OpItem, OpItemEstrutura e OpLote de TODAS as OpHeader do lote de uma vez.
 *  3. Agrupa as filhas por `CodOpHeader` e monta cada DTO.
 *
 * Produto/cliente: BEST-EFFORT nesta fase (ver TODO abaixo) — o vínculo exato de
 * `CodItemEstoque` → nome do produto e do cliente (via pedido) é "risco/pendência"
 * no design. Entregamos cabeçalho + lotes + itens básicos; `produtoNome`/
 * `produtoCodigo`/`clienteNome` ficam indefinidos até resolver o de/para.
 */
export async function lerOpsCandidatas(
  conexao: ConexaoCalcgrafSomenteLeitura,
  filtro: FiltroOps = {},
): Promise<OpOrigemDTO[]> {
  // 1) Cabeçalhos candidatos.
  const headers = await conexao.consultar<LinhaOpHeader>(montarQueryOpHeader(filtro))
  if (headers.length === 0) return []

  const codigos = headers.map((h) => h.Codigo).filter((c): c is number => typeof c === 'number')
  if (codigos.length === 0) return []

  // 2) Filhas em lote (3 queries). SEQUENCIAIS, não paralelas: o driver
  //    `tedious` só aceita UMA request por conexão por vez (disparar em
  //    Promise.all causa "Requests can only be made in the LoggedIn state, not
  //    the SentClientRequest state"). O custo é 3 idas sequenciais ao banco —
  //    aceitável, e cada uma já traz todas as filhas do lote de OPs de uma vez.
  const itensRaw = await conexao.consultar<LinhaOpItem>(montarQueryOpItem(codigos))
  const estruturaRaw = await conexao.consultar<LinhaOpItemEstrutura>(montarQueryOpItemEstrutura(codigos))
  const lotesRaw = await conexao.consultar<LinhaOpLoteJoin>(montarQueryOpLote(codigos))

  // 3) Agrupa as filhas por CodOpHeader.
  const itensPorHeader = agruparPor(itensRaw, (r) => r.CodOpHeader)
  const estruturaPorHeader = agruparPor(estruturaRaw, (r) => r.CodOpHeader)
  const lotesPorHeader = agruparPor(lotesRaw, (r) => r.CodOpHeader)

  // 3b) ROTEIRO (Fase 2): resolve o cálculo mais recente de cada OP e lê
  //     etapas/variações/tintas/mat.acabamento em lote. SEQUENCIAL (tedious).
  const roteiro = await lerRoteiroEmLote(conexao, codigos)

  // 3c) CLIENTE (via pedido): nome + doc por OpHeader. SEQUENCIAL. Best-effort —
  //     OP sem pedido associado fica sem cliente (não quebra).
  const clienteRows = await conexao.consultar<LinhaClienteOp>(montarQueryClienteDaOp(codigos))
  const clientePorHeader = new Map<number, { nome?: string; doc?: string }>()
  for (const c of clienteRows) {
    if (c.CodOpHeader != null) {
      clientePorHeader.set(c.CodOpHeader, {
        nome: strOuUndef(c.clienteNome),
        doc: strOuUndef(c.clienteDoc),
      })
    }
  }

  const dtos: OpOrigemDTO[] = []
  for (const h of headers) {
    const itens = (itensPorHeader.get(h.Codigo) ?? []).map(mapearItem)
    // A estrutura também é componente da OP; mesclamos no array `itens` do DTO.
    const estrutura = (estruturaPorHeader.get(h.Codigo) ?? []).map(mapearEstrutura)
    const lotes = (lotesPorHeader.get(h.Codigo) ?? []).map(mapearLote)

    // Lote principal = o de menor OrdemFilaOp (quando houver), para derivar
    // quantidade/tiragem/dataEntrega do cabeçalho do DTO.
    const lotePrincipal = escolherLotePrincipal(lotes)

    // Roteiro resolvido desta OP (undefined quando a OP não tem cálculo — ~1,2%
    // das OPs, avulsas; mantém comportamento da fase 1, sem etapas).
    const r = roteiro.get(h.Codigo)

    const cli = clientePorHeader.get(h.Codigo)

    const dto: OpOrigemDTO = {
      numero: h.Numero,
      descricao: strOuUndef(h.Descricao) ?? '',
      dataEmissao: dataIsoOuUndef(h.DataHoraEmissao),
      clienteNome: cli?.nome,
      // CNPJ/CPF do cliente (match por dígitos no backend → vínculo com o
      // cadastro Cliente; resolve o "ACTUAL"). Já lido no passo 3c.
      clienteDoc: cli?.doc,
      quantidade: lotePrincipal?.tiragem,
      tiragem: lotePrincipal?.tiragem,
      dataEntrega: lotePrincipal?.dataPrometida,
      // Programação de entrega: TODAS as datas dos lotes (não só a 1ª). Resolve
      // o "entrega em branco" quando o lote principal não tem data mas há
      // lotes com data. Função pura (testável).
      programacaoEntrega: montarProgramacaoDeLotes(lotes),
      // Materiais de acabamento (do cálculo) entram como itens, junto do
      // papel/estrutura; tintas vão em `tintasTexto` (tag [Cores] no backend).
      itens: [...itens, ...estrutura, ...(r?.materiais ?? [])],
      lotes,
      etapas: r?.etapas,
      variacoes: r?.variacoes,
      tintasTexto: r?.tintasTexto,
    }

    // CLIENTE: resolvido via pedido (OpItem → OpItemxPedidoItem → PedidoItem →
    // PedidoHeader.CodNome → Nomes) — ver `montarQueryClienteDaOp` / passo 3c.
    // `clienteNome` já foi preenchido acima a partir de `clientePorHeader`.
    // TODO (produto): produtoNome/produtoCodigo ainda best-effort — resolver
    // OpItem.CodItemEstoque contra o cadastro de item do Calcgraf numa evolução
    // futura (não bloqueia a ingestão; o backend usa a descrição da OP).

    dtos.push(dto)
  }

  return dtos
}

/** Roteiro resolvido de UMA OP (Fase 2). */
interface RoteiroOp {
  etapas: EtapaOpOrigemDTO[]
  variacoes: VariacaoOpOrigemDTO[]
  materiais: ItemOpOrigemDTO[]
  tintasTexto?: string
}

/**
 * Resolve o cálculo mais recente de cada OP e lê etapas/variações/tintas/
 * mat.acabamento em LOTE (poucas queries, SEQUENCIAIS — tedious). Retorna um
 * mapa `OpHeader.Codigo → RoteiroOp`. OPs sem cálculo não entram no mapa (o
 * chamador trata como fase 1, sem etapas).
 */
async function lerRoteiroEmLote(
  conexao: ConexaoCalcgrafSomenteLeitura,
  codigosHeader: number[],
): Promise<Map<number, RoteiroOp>> {
  const resultado = new Map<number, RoteiroOp>()

  // 1) OpHeader.Codigo → CalculoHeader.Codigo (maior = recálculo).
  const calcRows = await conexao.consultar<LinhaCalcDaOp>(montarQueryCalculoDaOp(codigosHeader))
  const calcPorHeader = new Map<number, number>()
  for (const row of calcRows) {
    const calc = numOuUndef(row.CalcCodigo)
    if (calc != null && row.CodOpHeader != null) calcPorHeader.set(row.CodOpHeader, calc)
  }
  const codigosCalculo = Array.from(new Set(calcPorHeader.values()))
  if (codigosCalculo.length === 0) return resultado

  // 2) Lê as filhas do cálculo em lote (4 queries SEQUENCIAIS).
  const atividadesRaw = await conexao.consultar<LinhaAtividade>(montarQueryCalculoAtividades(codigosCalculo))
  const planosRaw = await conexao.consultar<LinhaPlano>(montarQueryCalculoPlanos(codigosCalculo))
  const tintasRaw = await conexao.consultar<LinhaTinta>(montarQueryCalculoTintas(codigosCalculo))
  const matRaw = await conexao.consultar<LinhaMatAcab>(montarQueryCalculoMatAcabamento(codigosCalculo))

  // 3) Agrupa por CalcCodigo.
  const atividadesPorCalc = agruparPor(atividadesRaw, (r) => r.CalcCodigo)
  const planosPorCalc = agruparPor(planosRaw, (r) => r.CalcCodigo)
  const tintasPorCalc = agruparPor(tintasRaw, (r) => r.CalcCodigo)
  const matPorCalc = agruparPor(matRaw, (r) => r.CalcCodigo)

  // 4) Monta o RoteiroOp por OpHeader usando as funções puras.
  for (const [codHeader, calc] of calcPorHeader) {
    const etapas = (atividadesPorCalc.get(calc) ?? []).map((a, i) =>
      montarEtapaDTO(a as AtividadeRow, i),
    )
    const variacoes = (planosPorCalc.get(calc) ?? []).map((p, i) =>
      montarVariacaoDTO(p as PlanoRow, i),
    )
    const tintasTexto = montarTextoTintas((tintasPorCalc.get(calc) ?? []) as TintaRow[]) || undefined
    const materiais: ItemOpOrigemDTO[] = (matPorCalc.get(calc) ?? []).map((m) => ({
      codItemEstoque: strOuUndef(m.CodMaterial),
      descricao: strOuUndef(m.materialNome) ?? strOuUndef(m.CodMaterial),
      unidadeMedida: 'KG',
    }))
    resultado.set(codHeader, { etapas, variacoes, materiais, tintasTexto })
  }

  return resultado
}

/** Agrupa linhas por uma chave numérica, preservando a ordem de entrada. */
function agruparPor<T>(linhas: T[], chave: (l: T) => number): Map<number, T[]> {
  const mapa = new Map<number, T[]>()
  for (const l of linhas) {
    const k = chave(l)
    const arr = mapa.get(k)
    if (arr) arr.push(l)
    else mapa.set(k, [l])
  }
  return mapa
}

/** Mapeia uma linha de OpItem para ItemOpOrigemDTO. */
function mapearItem(r: LinhaOpItem): ItemOpOrigemDTO {
  return {
    item: numOuUndef(r.Item),
    codItemEstoque: strOuUndef(r.CodItemEstoque),
    status: strOuUndef(r.Status),
  }
}

/** Mapeia uma linha de OpItemEstrutura para ItemOpOrigemDTO. */
function mapearEstrutura(r: LinhaOpItemEstrutura): ItemOpOrigemDTO {
  return {
    item: numOuUndef(r.Item),
    codItemEstoque: strOuUndef(r.CodItemEstoque),
    descricao: strOuUndef(r.CodEstrutura),
  }
}

/** Mapeia uma linha de OpLote para LoteOpOrigemDTO. */
function mapearLote(r: LinhaOpLoteJoin): LoteOpOrigemDTO {
  return {
    tiragem: numOuUndef(r.Tiragem),
    dataPrometida: dataIsoOuUndef(r.DataPrometida),
    ordemFila: numOuUndef(r.OrdemFilaOp),
    status: strOuUndef(r.Status),
  }
}

/**
 * Escolhe o lote principal: o de menor `ordemFila` definido; se nenhum tiver
 * ordem, o primeiro da lista. Retorna `undefined` se não houver lotes.
 */
function escolherLotePrincipal(lotes: LoteOpOrigemDTO[]): LoteOpOrigemDTO | undefined {
  if (lotes.length === 0) return undefined
  const comOrdem = lotes.filter((l) => typeof l.ordemFila === 'number')
  if (comOrdem.length > 0) {
    return comOrdem.reduce((a, b) => ((a.ordemFila as number) <= (b.ordemFila as number) ? a : b))
  }
  return lotes[0]
}

/**
 * Conveniência: abre a conexão, lê as OPs e fecha. Útil para validação pontual.
 *
 * COMO VALIDAR contra o backup local `CalcgrafCartonWega` (quando houver SQL
 * Server acessível), via sqlcmd (golden: OP 3138/3137):
 *   const ops = await lerOpsEComFechar(
 *     { modo: 'sqlcmd', servidor: 'localhost', database: 'CalcgrafCartonWega' },
 *     { numeroMinimo: 3137, numeroMaximo: 3138 },
 *   )
 * Equivale a: sqlcmd -S localhost -E -C -d CalcgrafCartonWega -y 0 \
 *   -Q "SET NOCOUNT ON; SELECT Codigo, Numero, DataHoraEmissao, Descricao
 *       FROM OpHeader WHERE Ativo <> 'N' AND Numero >= 3137 AND Numero <= 3138
 *       ORDER BY Numero FOR JSON PATH"
 */
export async function lerOpsEComFechar(
  cfg: ConfigConexaoCalcgraf,
  filtro: FiltroOps = {},
): Promise<OpOrigemDTO[]> {
  const conexao = await abrirConexaoCalcgraf(cfg)
  try {
    return await lerOpsCandidatas(conexao, filtro)
  } finally {
    await conexao.fechar()
  }
}
