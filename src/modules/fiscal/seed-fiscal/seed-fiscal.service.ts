/**
 * Aplica os registros retornados pela fonte externa (`fonte-externa.service.ts`)
 * nas tabelas globais Ncm, Cfop e Cest, inserindo apenas os `codigo`s ainda não
 * cadastrados e nunca alterando registros já existentes (idempotência estrita —
 * design.md, Property 10).
 *
 * Não faz nenhuma chamada de rede: recebe o array `registros` já carregado por
 * quem a invoca (rota HTTP, task 6.5), que é responsável por chamar
 * `buscarDadosExternos` e tratar `FonteExternaError` separadamente.
 */

import { prisma } from '../../../lib/prisma'
import type { RegistroExterno, TabelaFiscalSeed } from './fonte-externa.service'

/**
 * Lançado quando um registro do array `registros` (numa posição arbitrária)
 * tem `codigo`/`descricao` ausente ou em formato inválido para a tabela em
 * questão. `seedTabela` interrompe o processamento exatamente nessa posição,
 * preservando os registros válidos já inseridos/ignorados antes dela.
 *
 * `inseridos`/`ignorados` refletem a contagem parcial acumulada até a posição
 * de falha (exclusive), permitindo que quem chama (rota, task 6.5) monte a
 * resposta HTTP parcial exigida pelo Requirement 3.5 sem perder essa informação.
 */
export class RegistroInvalidoError extends Error {
  public readonly tabela: TabelaFiscalSeed
  public readonly motivo: string
  public readonly posicao: number
  public readonly inseridos: number
  public readonly ignorados: number

  constructor(params: {
    tabela: TabelaFiscalSeed
    motivo: string
    posicao: number
    inseridos: number
    ignorados: number
  }) {
    super(
      `Registro inválido na posição ${params.posicao} do lote de ${params.tabela}: ${params.motivo}`
    )
    this.name = 'RegistroInvalidoError'
    this.tabela = params.tabela
    this.motivo = params.motivo
    this.posicao = params.posicao
    this.inseridos = params.inseridos
    this.ignorados = params.ignorados

    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, RegistroInvalidoError)
    }
  }
}

/**
 * Formato esperado de `codigo` por tabela, alinhado ao `db.VarChar(n)` do
 * model Prisma correspondente (Ncm=8, Cfop=4, Cest=7) e às mesmas regras já
 * usadas na validação de XML de NFe (`emissor-dfe/xml/xml-validator.ts`):
 * apenas dígitos, com CFOP restrito ao primeiro dígito 1-7 (ENTRADA 1-3,
 * SAÍDA 5-7 — o dígito 4 e 8-9 não são usados pela tabela oficial de CFOP).
 */
const CODIGO_REGEX: Record<TabelaFiscalSeed, RegExp> = {
  NCM: /^\d{8}$/,
  CFOP: /^[1-7]\d{3}$/,
  CEST: /^\d{7}$/,
}

/** Máximo de caracteres de `descricao` aceito pelas três tabelas (`db.VarChar(500)`). */
const DESCRICAO_MAX_LENGTH = 500

/**
 * Valida a estrutura mínima de um registro externo para a tabela informada.
 * Retorna o motivo da invalidade (string) ou `null` quando o registro é válido.
 */
function validarRegistro(tabela: TabelaFiscalSeed, registro: RegistroExterno): string | null {
  const { codigo, descricao } = registro

  if (typeof codigo !== 'string' || codigo.trim() === '') {
    return `campo 'codigo' ausente ou não é uma string não-vazia`
  }
  if (!CODIGO_REGEX[tabela].test(codigo)) {
    return `campo 'codigo' ('${codigo}') não está no formato esperado para ${tabela}`
  }
  if (typeof descricao !== 'string' || descricao.trim() === '') {
    return `campo 'descricao' ausente ou não é uma string não-vazia`
  }
  if (descricao.length > DESCRICAO_MAX_LENGTH) {
    return `campo 'descricao' excede o tamanho máximo de ${DESCRICAO_MAX_LENGTH} caracteres`
  }

  return null
}

/**
 * Deriva `tipo` (ENTRADA/SAIDA) e `ambito` (ESTADUAL/INTERESTADUAL/EXTERIOR) de
 * um código de CFOP a partir do primeiro dígito (padrão oficial da tabela
 * CFOP), usado quando a fonte externa não fornece esses campos explicitamente.
 */
function derivarClassificacaoCfop(codigo: string): { tipo: string; ambito: string } {
  const primeiroDigito = codigo[0]
  const tipo = ['1', '2', '3'].includes(primeiroDigito) ? 'ENTRADA' : 'SAIDA'
  const mapaAmbito: Record<string, string> = {
    '1': 'ESTADUAL',
    '5': 'ESTADUAL',
    '2': 'INTERESTADUAL',
    '6': 'INTERESTADUAL',
    '3': 'EXTERIOR',
    '7': 'EXTERIOR',
  }
  const ambito = mapaAmbito[primeiroDigito] ?? 'ESTADUAL'
  return { tipo, ambito }
}

/** Verifica se já existe um registro com o `codigo` informado na tabela global. */
async function existeCodigo(tabela: TabelaFiscalSeed, codigo: string): Promise<boolean> {
  switch (tabela) {
    case 'NCM':
      return (await prisma.ncm.findUnique({ where: { codigo }, select: { id: true } })) !== null
    case 'CFOP':
      return (await prisma.cfop.findUnique({ where: { codigo }, select: { id: true } })) !== null
    case 'CEST':
      return (await prisma.cest.findUnique({ where: { codigo }, select: { id: true } })) !== null
  }
}

/** Insere um novo registro (já validado e confirmado inexistente) na tabela global. */
async function inserirRegistro(tabela: TabelaFiscalSeed, registro: RegistroExterno): Promise<void> {
  switch (tabela) {
    case 'NCM':
      await prisma.ncm.create({
        data: {
          codigo: registro.codigo,
          descricao: registro.descricao,
          unidadeEstat: registro.unidadeEstat ?? null,
          aliqII: registro.aliqII ?? null,
          aliqIPI: registro.aliqIPI ?? null,
        },
      })
      return
    case 'CFOP': {
      const derivado = derivarClassificacaoCfop(registro.codigo)
      await prisma.cfop.create({
        data: {
          codigo: registro.codigo,
          descricao: registro.descricao,
          tipo: registro.tipo ?? derivado.tipo,
          ambito: registro.ambito ?? derivado.ambito,
          geraCredIcms: registro.geraCredIcms ?? false,
          geraCredPisCofins: registro.geraCredPisCofins ?? false,
          incideIpi: registro.incideIpi ?? false,
        },
      })
      return
    }
    case 'CEST':
      await prisma.cest.create({
        data: {
          codigo: registro.codigo,
          descricao: registro.descricao,
          segmento: registro.segmento ?? null,
        },
      })
      return
  }
}

/**
 * Aplica os `registros` (já obtidos da fonte externa) na tabela global
 * correspondente, inserindo apenas os códigos ainda não cadastrados.
 *
 * - Registros com `codigo` já existente são contados em `ignorados`, sem
 *   nenhuma alteração nos campos do registro pré-existente (idempotência).
 * - Ao encontrar um registro inválido (`codigo`/`descricao` ausente ou em
 *   formato inválido) numa posição do array, interrompe o processamento
 *   imediatamente, preservando no destino tudo que já foi inserido/ignorado
 *   antes dessa posição, e lança `RegistroInvalidoError` com essa contagem
 *   parcial e o motivo da falha.
 * - `inseridos + ignorados` é sempre igual à quantidade de registros válidos
 *   processados até o ponto de eventual interrupção.
 */
export async function seedTabela(
  tabela: TabelaFiscalSeed,
  registros: RegistroExterno[]
): Promise<{ inseridos: number; ignorados: number }> {
  let inseridos = 0
  let ignorados = 0

  for (let posicao = 0; posicao < registros.length; posicao++) {
    const registro = registros[posicao]

    const motivo = validarRegistro(tabela, registro)
    if (motivo) {
      throw new RegistroInvalidoError({ tabela, motivo, posicao, inseridos, ignorados })
    }

    if (await existeCodigo(tabela, registro.codigo)) {
      ignorados++
      continue
    }

    await inserirRegistro(tabela, registro)
    inseridos++
  }

  return { inseridos, ignorados }
}
