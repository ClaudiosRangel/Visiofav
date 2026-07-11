/**
 * Encapsula a chamada HTTP à fonte externa oficial de dados fiscais (NCM/CFOP/CEST),
 * mantendo essa lógica de rede isolada e mockável para os testes de
 * `seed-fiscal.service.ts` (que nunca deve fazer chamadas de rede reais).
 *
 * Assumption (requirements.md, Requirement 3.3): a fonte oficial de referência é a
 * tabela TIPI/CFOP publicada pela Receita Federal, ou um dataset público espelhado
 * dela, consumido em lote único por execução de seed.
 *
 * Fallback de arquivo local: quando a variável de ambiente `SEED_FISCAL_<TABELA>_URL`
 * não está configurada, `buscarDadosExternos` tenta carregar um arquivo JSON
 * versionado em `./data/<tabela>.json` (ex.: `data/cfop.json`, convertido a partir
 * da tabela oficial de CFOP da planilha `160314_Tabela_CFOP.xlsx`). Isso permite
 * popular tabelas fiscais sem depender de uma URL externa de terceiros, mantendo
 * o mesmo formato de resposta (`RegistroExterno[]`) e o mesmo tratamento de erro
 * (`FonteExternaError`) do caminho HTTP. Se nem a URL nem o arquivo local
 * existirem para a tabela, o comportamento permanece o mesmo de antes (erro
 * `FONTE_INDISPONIVEL`).
 */
import { readFile } from 'fs/promises'
import path from 'path'

/** Tabelas fiscais suportadas pelo seed. */
export type TabelaFiscalSeed = 'NCM' | 'CFOP' | 'CEST'

/**
 * Registro retornado pela fonte externa para uma tabela fiscal.
 *
 * `codigo` e `descricao` são os campos mínimos exigidos pelos models `Ncm`,
 * `Cfop` e `Cest` do schema Prisma. Os demais campos são específicos de cada
 * tabela e opcionais — quando ausentes, `seed-fiscal.service.ts` (task 6.2)
 * decide o valor padrão a ser persistido.
 */
export interface RegistroExterno {
  codigo: string
  descricao: string
  /** Específico de Ncm. */
  unidadeEstat?: string
  aliqII?: number
  aliqIPI?: number
  /** Específico de Cfop. */
  tipo?: string
  ambito?: string
  geraCredIcms?: boolean
  geraCredPisCofins?: boolean
  incideIpi?: boolean
  /** Específico de Cest. */
  segmento?: string
}

/** Códigos de erro alinhados à tabela de erros do design.md (Requirement 3 — Seed Fiscal). */
export type CodigoErroFonteExterna = 'FONTE_INDISPONIVEL' | 'ESTRUTURA_INVALIDA'

/**
 * Lançado quando a fonte externa está indisponível (erro de conexão, timeout,
 * status HTTP não-2xx) ou quando a resposta não tem a estrutura mínima esperada
 * (ex.: corpo que não é uma lista de registros). `seed-fiscal.service.ts` captura
 * este erro para interromper apenas a tabela afetada, preservando o que já foi
 * inserido (Requirement 3.5).
 */
export class FonteExternaError extends Error {
  public readonly code: CodigoErroFonteExterna
  public readonly tabela: TabelaFiscalSeed

  constructor(code: CodigoErroFonteExterna, tabela: TabelaFiscalSeed, message: string) {
    super(message)
    this.name = 'FonteExternaError'
    this.code = code
    this.tabela = tabela

    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, FonteExternaError)
    }
  }
}

const TIMEOUT_MS = 30_000

/**
 * TODO: configurar a URL definitiva da fonte oficial para cada tabela.
 *
 * Nenhuma fonte pública, gratuita e estável (sem exigência de chave de API)
 * para NCM/CFOP/CEST em formato consumível diretamente foi integrada nesta
 * task — a URL real deve ser definida antes do seed fiscal entrar em uso em
 * produção (ex.: espelho público da tabela TIPI/CFOP da Receita Federal).
 * Até lá, cada URL é configurável via variável de ambiente e, se ausente,
 * `buscarDadosExternos` lança `FonteExternaError` de forma consistente (nunca
 * retorna um array vazio silenciosamente).
 */
const URL_FONTE_EXTERNA: Record<TabelaFiscalSeed, string | undefined> = {
  NCM: process.env.SEED_FISCAL_NCM_URL,
  CFOP: process.env.SEED_FISCAL_CFOP_URL,
  CEST: process.env.SEED_FISCAL_CEST_URL,
}

/** Caminho do arquivo JSON local de fallback para cada tabela (ver comentário acima). */
const ARQUIVO_LOCAL_FONTE: Record<TabelaFiscalSeed, string> = {
  NCM: path.join(__dirname, 'data', 'ncm.json'),
  CFOP: path.join(__dirname, 'data', 'cfop.json'),
  CEST: path.join(__dirname, 'data', 'cest.json'),
}

/**
 * Tenta carregar o arquivo JSON local de fallback para a tabela. Retorna
 * `null` se o arquivo não existir ou não puder ser lido/parseado — nesse
 * caso, `buscarDadosExternos` cai no erro `FONTE_INDISPONIVEL` já existente.
 */
async function carregarArquivoLocal(tabela: TabelaFiscalSeed): Promise<RegistroExterno[] | null> {
  try {
    const conteudo = await readFile(ARQUIVO_LOCAL_FONTE[tabela], 'utf-8')
    const dados = JSON.parse(conteudo)
    if (!Array.isArray(dados) || dados.length === 0) return null
    return dados as RegistroExterno[]
  } catch {
    return null
  }
}

/**
 * Busca os registros oficiais de uma tabela fiscal (NCM, CFOP ou CEST) na fonte
 * externa configurada, ou no arquivo JSON local de fallback quando a URL não
 * está configurada (ver comentário no topo do arquivo).
 *
 * Lança `FonteExternaError` (nunca retorna `null`/array vazio silencioso) quando:
 * - a URL da fonte não está configurada E não existe arquivo local de fallback
 *   para a tabela (`FONTE_INDISPONIVEL`);
 * - a requisição falha por erro de rede, timeout (30s) ou status HTTP não-2xx
 *   (`FONTE_INDISPONIVEL`);
 * - o corpo da resposta não é uma lista de registros (`ESTRUTURA_INVALIDA`).
 *
 * A validação de cada registro individual (ex.: `codigo` ausente ou em formato
 * inválido) é responsabilidade de `seed-fiscal.service.ts`, que precisa
 * interromper o processamento na posição exata da falha.
 */
export async function buscarDadosExternos(tabela: TabelaFiscalSeed): Promise<RegistroExterno[]> {
  const url = URL_FONTE_EXTERNA[tabela]

  if (!url) {
    const dadosLocais = await carregarArquivoLocal(tabela)
    if (dadosLocais) return dadosLocais

    throw new FonteExternaError(
      'FONTE_INDISPONIVEL',
      tabela,
      `URL da fonte externa para ${tabela} não configurada (defina a variável de ambiente SEED_FISCAL_${tabela}_URL) e nenhum arquivo local de fallback foi encontrado`
    )
  }

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS)

  let response: Response
  try {
    response = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    })
  } catch {
    throw new FonteExternaError(
      'FONTE_INDISPONIVEL',
      tabela,
      `Falha ao conectar à fonte externa de ${tabela} (indisponível, erro de rede ou timeout)`
    )
  } finally {
    clearTimeout(timeoutId)
  }

  if (!response.ok) {
    throw new FonteExternaError(
      'FONTE_INDISPONIVEL',
      tabela,
      `Fonte externa de ${tabela} respondeu com status HTTP ${response.status}`
    )
  }

  let body: unknown
  try {
    body = await response.json()
  } catch {
    throw new FonteExternaError(
      'ESTRUTURA_INVALIDA',
      tabela,
      `Resposta da fonte externa de ${tabela} não é um JSON válido`
    )
  }

  if (!Array.isArray(body)) {
    throw new FonteExternaError(
      'ESTRUTURA_INVALIDA',
      tabela,
      `Resposta da fonte externa de ${tabela} não é uma lista de registros`
    )
  }

  return body as RegistroExterno[]
}
