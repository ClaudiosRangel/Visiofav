/**
 * Camada de provider da fonte de dados de prospecção (base oficial de CNPJ).
 *
 * A prospecção precisa LISTAR empresas por CNAE + UF (busca massiva). As APIs
 * de CNPJ 100% gratuitas e sem cadastro consultam um CNPJ por vez e NÃO
 * suportam esse tipo de busca — só serviços pagos ou o dump oficial da Receita.
 *
 * Por isso a fonte de verdade é uma tabela LOCAL (`estabelecimento_cnpj`)
 * populada a partir do dump oficial da Receita (ver
 * scripts/importar-cnpj-oficial.ts), e o enriquecimento por API pública é
 * complementar (consulta unitária de um CNPJ conhecido).
 *
 * Esta interface isola o resto do módulo (rotas/tela/models) da fonte concreta.
 */

/** Critérios de busca por CNAE + UF (o "negócio a prospectar"). */
export interface CriteriosProspeccao {
  /** Lista de códigos CNAE (só dígitos, ex.: "2063100"). */
  cnaes: string[]
  uf?: string | null
  cidade?: string | null
  /** Situação cadastral alvo (ex.: "ATIVA"). */
  situacao?: string | null
  /** Portes alvo (ex.: ["ME","EPP"]). Vazio = todos. */
  portes?: string[]
  /** Limite de resultados por execução (proteção de volume). */
  limite?: number
}

/** Uma empresa candidata retornada pela fonte. */
export interface EmpresaEncontrada {
  cnpj: string
  razaoSocial: string
  nomeFantasia?: string | null
  cnaePrincipal?: string | null
  cnaeDescricao?: string | null
  situacao?: string | null
  porte?: string | null
  logradouro?: string | null
  numero?: string | null
  complemento?: string | null
  bairro?: string | null
  cidade?: string | null
  uf?: string | null
  cep?: string | null
  telefone?: string | null
  email?: string | null
}

export interface ResultadoBusca {
  empresas: EmpresaEncontrada[]
  /** Avisos não fatais (ex.: base local vazia, limite atingido). */
  avisos: string[]
}

export interface ProspeccaoProvider {
  /** Nome do provider (para log/diagnóstico). */
  readonly nome: string
  /** Busca empresas por CNAE + UF na fonte. */
  buscar(criterios: CriteriosProspeccao): Promise<ResultadoBusca>
}
