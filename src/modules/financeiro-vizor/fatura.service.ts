/**
 * Service de faturas do Financeiro Vizor (billing do SaaS).
 *
 * Camada de I/O sobre a entidade `Fatura`. Toda a lógica determinística
 * (total mensal, geração de datas de vencimento) vem do núcleo puro
 * `financeiro-calculo.ts`; aqui ficam apenas as operações que tocam o banco.
 *
 * ISOLAMENTO INVERTIDO (uso exclusivo do SUPER_ADMIN): este módulo usa o
 * Prisma GLOBAL (`import { prisma }`), NUNCA `request.prismaScoped`. O
 * isolamento por empresa é feito EXPLICITAMENTE com `where: { empresaId }` em
 * cada query — o `empresaId` é a empresa-alvo passada por parâmetro (a empresa
 * cliente sobre a qual o SUPER_ADMIN está operando), não a empresa da sessão do
 * usuário. Ver design em `.kiro/specs/financeiro-vizor/design.md` (decisão
 * arquitetural 1 e "Components and Interfaces" item 3) e a steering
 * `ATENCAO-pontos-verificar.md`.
 */

import { prisma } from '../../lib/prisma'
import {
  calcularDatasVencimento,
  calcularTotalMensal,
  competenciaMesSeguinte,
} from './financeiro-calculo'
import type { FaturaView, Modulo, StatusFatura } from './financeiro.types'

/**
 * Erro de regra de negócio do módulo, carregando o `statusCode` HTTP que a
 * rota deve devolver. As rotas (Tarefa 9) mapeiam este erro para a resposta
 * correspondente (ex.: 422 para "empresa sem preços configurados").
 */
export class FinanceiroError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
  ) {
    super(message)
    this.name = 'FinanceiroError'
  }
}

/** Converte uma linha de `Fatura` do Prisma para a view (Decimal -> number). */
function paraFaturaView(fatura: {
  id: string
  empresaId: string
  competencia: string
  dataVencimento: Date
  valor: unknown
  status: string
  dataPagamento: Date | null
}): FaturaView {
  return {
    id: fatura.id,
    empresaId: fatura.empresaId,
    competencia: fatura.competencia,
    dataVencimento: fatura.dataVencimento,
    valor: Number(fatura.valor),
    status: fatura.status as StatusFatura,
    dataPagamento: fatura.dataPagamento,
  }
}

/**
 * Lista as faturas de uma empresa, ordenadas por competência decrescente
 * (mais recente primeiro). Converte `Decimal` -> `number`. (Req 4.2)
 *
 * Isolamento explícito: filtra por `empresaId` (empresa-alvo).
 */
export async function listarFaturas(empresaId: string): Promise<FaturaView[]> {
  const faturas = await prisma.fatura.findMany({
    where: { empresaId },
    orderBy: { competencia: 'desc' },
  })
  return faturas.map(paraFaturaView)
}

/**
 * Geração em lote idempotente de faturas mensais para uma empresa. (Req 5)
 *
 * Fluxo:
 * 1. Busca o contrato + preços da empresa (isolamento explícito por `empresaId`).
 * 2. Calcula o `totalMensal` (núcleo puro). Se `<= 0`, REJEITA com
 *    `FinanceiroError` 422 "empresa sem preços configurados" — nenhuma fatura
 *    é criada. (Req 5.5)
 * 3. Determina a competência inicial: usa a informada (`YYYY-MM`) ou, por
 *    padrão, o mês seguinte ao atual (`competenciaMesSeguinte(new Date())`).
 *    (Req 5.6)
 * 4. Calcula as N datas de vencimento consecutivas (`calcularDatasVencimento`),
 *    respeitando o `diaVencimento` do contrato e meses curtos. (Req 5.2, 5.3)
 * 5. Idempotência: ignora competências que já possuem fatura NÃO cancelada
 *    (uma competência `CANCELADA` não bloqueia uma nova geração). (Req 5.8)
 * 6. Cria as faturas novas em `createMany` com status `PENDENTE`, tudo dentro
 *    de uma transação. (Req 5.4)
 *
 * @returns `{ criadas, ignoradas }` — a contagem de faturas criadas e a lista
 *          de competências ignoradas por já existirem.
 */
export async function gerarVencimentos(
  empresaId: string,
  meses: number,
  competenciaInicial?: string,
): Promise<{ criadas: number; ignoradas: string[] }> {
  // 1. Contrato + preços da empresa-alvo (isolamento explícito por empresaId).
  const contrato = await prisma.contratoCobranca.findUnique({
    where: { empresaId },
    include: { precosModulo: true },
  })

  if (!contrato) {
    // Sem contrato não há dia de vencimento nem preços — mesma classe de erro
    // que "sem preços configurados". (Req 5.5)
    throw new FinanceiroError(
      'Empresa sem preços configurados: cadastre um contrato antes de gerar vencimentos.',
      422,
    )
  }

  // 2. Total mensal via núcleo puro. Rejeita se <= 0. (Req 5.5)
  const precos = contrato.precosModulo.map((p) => ({
    modulo: p.modulo as Modulo,
    preco: Number(p.preco),
  }))
  const totalMensal = calcularTotalMensal(precos)

  if (totalMensal <= 0) {
    throw new FinanceiroError(
      'Empresa sem preços configurados: configure ao menos um módulo com preço maior que zero.',
      422,
    )
  }

  // 3. Competência inicial: informada ou mês seguinte ao atual. (Req 5.6)
  const inicial = competenciaInicial ?? competenciaMesSeguinte(new Date())

  // 4. Datas de vencimento consecutivas (núcleo puro). (Req 5.2, 5.3)
  const vencimentos = calcularDatasVencimento(inicial, meses, contrato.diaVencimento)

  return prisma.$transaction(async (tx) => {
    // 5. Competências já existentes NÃO canceladas -> bloqueiam a geração. (Req 5.8)
    const competencias = vencimentos.map((v) => v.competencia)
    const existentes = await tx.fatura.findMany({
      where: {
        empresaId,
        competencia: { in: competencias },
        status: { not: 'CANCELADA' },
      },
      select: { competencia: true },
    })
    const competenciasExistentes = new Set(existentes.map((f) => f.competencia))

    const novas = vencimentos.filter((v) => !competenciasExistentes.has(v.competencia))
    const ignoradas = vencimentos
      .filter((v) => competenciasExistentes.has(v.competencia))
      .map((v) => v.competencia)

    // 6. Cria as faturas novas com status PENDENTE. (Req 5.4)
    if (novas.length > 0) {
      await tx.fatura.createMany({
        data: novas.map((v) => ({
          empresaId,
          competencia: v.competencia,
          dataVencimento: v.dataVencimento,
          valor: totalMensal,
          status: 'PENDENTE',
        })),
      })
    }

    return { criadas: novas.length, ignoradas }
  })
}

/**
 * Baixa de pagamento de uma fatura: `PENDENTE|VENCIDA -> PAGA`. (Req 8.1, 8.3, 8.4, 8.5)
 *
 * - Seta `dataPagamento = agora` no momento da baixa.
 * - REJEITA fatura já `PAGA` ou `CANCELADA` com `FinanceiroError` 409 (a baixa
 *   só é válida para faturas em aberto). (Req 8.3, 8.4)
 * - REJEITA fatura inexistente OU de outra empresa com `FinanceiroError` 404 —
 *   o isolamento por `empresaId` é explícito no `where` (`{ id, empresaId }`),
 *   de modo que uma fatura de outra empresa nunca é encontrada, lida nem
 *   alterada (não vaza dados entre empresas). (Req 8.10, 10.6)
 * - MANTÉM o `statusFinanceiro` da empresa inalterado — em particular, NÃO
 *   reativa automaticamente uma empresa em `SOMENTE_LEITURA`. A reativação é
 *   uma AÇÃO MANUAL do SUPER_ADMIN (Req 8.6/5.5), tratada no
 *   `status-financeiro.service.ts`. Dar baixa em uma fatura vencida não desfaz
 *   o bloqueio por si só.
 *
 * O `diasEmAtraso` NÃO é um campo persistido na `Fatura`: é derivado das
 * faturas em aberto por `calcularDiasEmAtraso` (núcleo puro) sempre que
 * consultado. Portanto, "recalcular o atraso" após a baixa acontece
 * naturalmente na próxima leitura/recálculo — aqui basta mudar o status da
 * fatura para `PAGA`, o que a remove do conjunto "vencida em aberto".
 *
 * Envolvido em `prisma.$transaction` para atomicidade da leitura + escrita.
 *
 * @returns a `FaturaView` já atualizada (status `PAGA`, `dataPagamento` setada).
 */
export async function darBaixa(empresaId: string, faturaId: string): Promise<FaturaView> {
  return prisma.$transaction(async (tx) => {
    // Isolamento explícito: só encontra a fatura se pertencer à empresa-alvo.
    const fatura = await tx.fatura.findFirst({
      where: { id: faturaId, empresaId },
    })

    if (!fatura) {
      throw new FinanceiroError('Fatura não encontrada.', 404)
    }

    // Só faturas em aberto (PENDENTE/VENCIDA) podem ser baixadas. (Req 8.3, 8.4)
    if (fatura.status !== 'PENDENTE' && fatura.status !== 'VENCIDA') {
      throw new FinanceiroError(
        `Não é possível dar baixa em uma fatura com status ${fatura.status}.`,
        409,
      )
    }

    const atualizada = await tx.fatura.update({
      where: { id: fatura.id },
      data: { status: 'PAGA', dataPagamento: new Date() },
    })

    return paraFaturaView(atualizada)
  })
}

/**
 * Cancelamento de uma fatura: `PENDENTE|VENCIDA -> CANCELADA`. (Req 8.9, 8.10)
 *
 * - REJEITA fatura já `PAGA` ou `CANCELADA` com `FinanceiroError` 409 (uma
 *   fatura paga não deve ser cancelada; uma já cancelada é no-op inválido).
 * - REJEITA fatura inexistente OU de outra empresa com `FinanceiroError` 404,
 *   via isolamento explícito no `where` (`{ id, empresaId }`). (Req 8.10, 10.6)
 *
 * Cancelar uma competência não impede uma nova geração para a mesma
 * competência: a idempotência de `gerarVencimentos` considera apenas faturas
 * NÃO canceladas. (Req 5.8)
 *
 * Envolvido em `prisma.$transaction` para atomicidade da leitura + escrita.
 *
 * @returns a `FaturaView` já atualizada (status `CANCELADA`).
 */
export async function cancelarFatura(empresaId: string, faturaId: string): Promise<FaturaView> {
  return prisma.$transaction(async (tx) => {
    // Isolamento explícito: só encontra a fatura se pertencer à empresa-alvo.
    const fatura = await tx.fatura.findFirst({
      where: { id: faturaId, empresaId },
    })

    if (!fatura) {
      throw new FinanceiroError('Fatura não encontrada.', 404)
    }

    // Só faturas em aberto (PENDENTE/VENCIDA) podem ser canceladas. (Req 8.10)
    if (fatura.status !== 'PENDENTE' && fatura.status !== 'VENCIDA') {
      throw new FinanceiroError(
        `Não é possível cancelar uma fatura com status ${fatura.status}.`,
        409,
      )
    }

    const atualizada = await tx.fatura.update({
      where: { id: fatura.id },
      data: { status: 'CANCELADA' },
    })

    return paraFaturaView(atualizada)
  })
}
