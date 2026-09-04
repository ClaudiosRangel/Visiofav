/**
 * Service de contrato de cobrança e preços por módulo do Financeiro Vizor.
 *
 * Uso exclusivo do SUPER_ADMIN (billing do SaaS). Este service faz a I/O de
 * `ContratoCobranca` + `PrecoModulo` de uma empresa-alvo e monta o
 * `DetalheCobranca` consumido pela tela de detalhe.
 *
 * ⚠️ ISOLAMENTO INVERTIDO (ver steering `ATENCAO-pontos-verificar.md`):
 * este módulo é do SUPER_ADMIN e VARRE/gerencia QUALQUER empresa. Por isso usa
 * o Prisma GLOBAL (`import { prisma }`) — NUNCA `request.prismaScoped` — e o
 * isolamento por empresa é feito EXPLICITAMENTE com `where: { empresaId }`,
 * onde `empresaId` é o da empresa-alvo passada por parâmetro (não do usuário
 * logado). É o oposto do padrão multi-tenant normal do projeto.
 *
 * Ver design em `.kiro/specs/financeiro-vizor/design.md`
 * (seção "Components and Interfaces" item 2).
 */

import type { Decimal } from '@prisma/client/runtime/library'

import { prisma } from '../../lib/prisma'
import {
  calcularDiasEmAtraso,
  calcularTotalMensal,
  calcularTotalVencidoEmAberto,
} from './financeiro-calculo'
import {
  MODULOS,
  PRECO_MAX,
  type DetalheCobranca,
  type Modulo,
  type PrecoModuloView,
  type SalvarContratoInput,
  type StatusFatura,
} from './financeiro.types'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Converte um `Decimal` (Prisma) para `number`, aceitando também `null`. */
function decimalParaNumero(valor: Decimal | number | null | undefined): number {
  if (valor === null || valor === undefined) return 0
  return typeof valor === 'number' ? valor : valor.toNumber()
}

/**
 * A partir dos preços gravados (parciais), monta a lista completa dos SEIS
 * módulos na ordem canônica de `MODULOS`, preenchendo com preço 0 os módulos
 * não precificados. (Req 3.1)
 */
function montarSeisModulos(precosGravados: { modulo: string; preco: Decimal }[]): PrecoModuloView[] {
  const mapa = new Map<string, number>()
  for (const p of precosGravados) {
    mapa.set(p.modulo, decimalParaNumero(p.preco))
  }
  return MODULOS.map((modulo) => ({
    modulo,
    preco: mapa.get(modulo) ?? 0,
  }))
}

// ---------------------------------------------------------------------------
// obterDetalheEmpresa
// ---------------------------------------------------------------------------

/**
 * Detalhe do contrato de cobrança de uma empresa-alvo. Sempre retorna os SEIS
 * módulos (preço 0 para os não precificados), o `totalMensal` (via
 * `calcularTotalMensal`), o `diaVencimento`, a `dataContrato`, o
 * `totalVencidoEmAberto` e o `diasEmAtraso` (ou `null` quando não há atraso).
 * (Req 3.1, 3.3, 4.1, 10.6)
 *
 * Empresa sem contrato retorna os seis módulos com preço 0, `totalMensal: 0`,
 * `diaVencimento: null` e `dataContrato: null`.
 *
 * @param empresaId empresa-alvo (controle global do SUPER_ADMIN — filtro
 *   explícito por este `empresaId`, não pelo do usuário logado).
 */
export async function obterDetalheEmpresa(empresaId: string): Promise<DetalheCobranca> {
  // Isolamento explícito: filtra pela empresa-alvo (Prisma global).
  const [contrato, faturas] = await Promise.all([
    prisma.contratoCobranca.findUnique({
      where: { empresaId },
      include: { precosModulo: true },
    }),
    prisma.fatura.findMany({
      where: { empresaId },
      select: { status: true, dataVencimento: true, valor: true },
    }),
  ])

  const precos = montarSeisModulos(contrato?.precosModulo ?? [])
  const totalMensal = calcularTotalMensal(precos)

  const agora = new Date()
  const faturasCalc = faturas.map((f) => ({
    status: f.status as StatusFatura,
    dataVencimento: f.dataVencimento,
    valor: decimalParaNumero(f.valor),
  }))

  const totalVencidoEmAberto = calcularTotalVencidoEmAberto(faturasCalc, agora)
  const diasEmAtrasoCalc = calcularDiasEmAtraso(faturasCalc, agora)

  return {
    empresaId,
    precos,
    totalMensal,
    diaVencimento: contrato?.diaVencimento ?? null,
    dataContrato: contrato?.dataContrato ?? null,
    totalVencidoEmAberto,
    // `null` quando não há atraso (nenhuma fatura vencida em aberto). (Req 6.3)
    diasEmAtraso: diasEmAtrasoCalc > 0 ? diasEmAtrasoCalc : null,
  }
}

// ---------------------------------------------------------------------------
// salvarContrato
// ---------------------------------------------------------------------------

/**
 * Cria ou atualiza (upsert) o contrato de cobrança de uma empresa-alvo e seus
 * preços por módulo.
 *
 * VALIDAÇÃO ANTES DE QUALQUER ESCRITA: a validação de `input` (dataContrato
 * não futura, diaVencimento 1..31, cada preço 0..PRECO_MAX) é feita pelo schema
 * Zod na camada de rota; aqui reforçamos as invariantes básicas e só então
 * escrevemos — em caso de erro nada é persistido (o estado anterior é
 * preservado). Toda a escrita ocorre dentro de um `prisma.$transaction`.
 * (Req 3.4, 3.7)
 *
 * ⚠️ ISOLAMENTO INVERTIDO: Prisma global + filtro explícito por `empresaId`
 * (empresa-alvo, não o usuário logado).
 *
 * @returns o `DetalheCobranca` atualizado.
 */
export async function salvarContrato(
  empresaId: string,
  input: SalvarContratoInput,
): Promise<DetalheCobranca> {
  // --- Validação ANTES de qualquer escrita (defesa em profundidade) ---------
  validarInput(empresaId, input)

  // Normaliza os preços recebidos (parciais) para os módulos válidos, evitando
  // gravar módulos fora do conjunto canônico ou duplicados.
  const precosPorModulo = new Map<Modulo, number>()
  for (const p of input.precos) {
    if (!MODULOS.includes(p.modulo)) {
      throw new ContratoValidacaoError(`Módulo inválido: "${p.modulo}".`)
    }
    // Último valor por módulo vence (defensivo contra duplicatas no payload).
    precosPorModulo.set(p.modulo, p.preco)
  }

  // --- Escrita transacional (nada persiste em caso de erro) -----------------
  await prisma.$transaction(async (tx) => {
    // Upsert do contrato pela empresa-alvo (relação 1:1).
    const contrato = await tx.contratoCobranca.upsert({
      where: { empresaId },
      create: {
        empresaId,
        dataContrato: input.dataContrato,
        diaVencimento: input.diaVencimento,
      },
      update: {
        dataContrato: input.dataContrato,
        diaVencimento: input.diaVencimento,
      },
    })

    // Substitui o conjunto de preços: apaga os antigos e recria os informados.
    // (mantém o comportamento previsível de "o payload é a verdade").
    await tx.precoModulo.deleteMany({ where: { contratoCobrancaId: contrato.id } })

    if (precosPorModulo.size > 0) {
      await tx.precoModulo.createMany({
        data: Array.from(precosPorModulo.entries()).map(([modulo, preco]) => ({
          contratoCobrancaId: contrato.id,
          modulo,
          preco,
        })),
      })
    }
  })

  return obterDetalheEmpresa(empresaId)
}

// ---------------------------------------------------------------------------
// Validação (reforço; a validação primária é o schema Zod na rota)
// ---------------------------------------------------------------------------

/** Erro de validação de contrato — a rota mapeia para HTTP 422. */
export class ContratoValidacaoError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ContratoValidacaoError'
  }
}

/**
 * Reforça as invariantes de negócio antes de escrever. A validação de formato
 * já é feita pelo Zod (`salvarContratoSchema`); aqui garantimos que nenhuma
 * escrita aconteça mesmo se este service for chamado fora da rota.
 */
function validarInput(empresaId: string, input: SalvarContratoInput): void {
  if (!empresaId) {
    throw new ContratoValidacaoError('empresaId é obrigatório.')
  }
  if (!(input.dataContrato instanceof Date) || Number.isNaN(input.dataContrato.getTime())) {
    throw new ContratoValidacaoError('A data do contrato deve ser uma data válida e não futura.')
  }
  if (input.dataContrato.getTime() > Date.now()) {
    throw new ContratoValidacaoError('A data do contrato deve ser uma data válida e não futura.')
  }
  if (
    !Number.isInteger(input.diaVencimento) ||
    input.diaVencimento < 1 ||
    input.diaVencimento > 31
  ) {
    throw new ContratoValidacaoError('O dia de vencimento deve ser um inteiro entre 1 e 31.')
  }
  for (const p of input.precos) {
    if (
      typeof p.preco !== 'number' ||
      Number.isNaN(p.preco) ||
      p.preco < 0 ||
      p.preco > PRECO_MAX
    ) {
      throw new ContratoValidacaoError('O preço deve estar entre 0,00 e 999.999.999,99.')
    }
  }
}
