/**
 * Service de status financeiro do Financeiro Vizor (billing do SaaS).
 *
 * Uso exclusivo do SUPER_ADMIN. Concentra a listagem global de empresas com
 * seu estágio de cobrança e as transições de status (materialização usada pelo
 * job e pelas ações manuais de reativação/inativação).
 *
 * ISOLAMENTO INVERTIDO (ATENÇÃO — o oposto do padrão multi-tenant normal):
 * este é um módulo de controle GLOBAL do dono do Vizor. As queries varrem
 * TODAS as empresas do banco e por isso usam o Prisma GLOBAL (`prisma`), NUNCA
 * `request.prismaScoped`. O acesso é protegido pelo `requireSuperAdmin` na
 * camada de rota. Nas transições, o isolamento é explícito por
 * `where: { id: empresaId }` (a empresa-alvo escolhida pelo SUPER_ADMIN).
 *
 * Ver design em `.kiro/specs/financeiro-vizor/design.md`
 * (Components and Interfaces item 4).
 */

import { prisma } from '../../lib/prisma'
import { calcularTotalMensal, calcularTotalVencidoEmAberto } from './financeiro-calculo'
import type {
  EmpresaStatusView,
  Modulo,
  StatusFatura,
  StatusFinanceiro,
} from './financeiro.types'

/**
 * Converte um valor `Decimal` do Prisma (ou number/null) para `number`.
 * Trata `null`/`undefined` como 0.
 */
function paraNumero(valor: unknown): number {
  if (valor === null || valor === undefined) return 0
  // Prisma.Decimal expõe toNumber(); number passa direto.
  if (typeof valor === 'number') return valor
  const asDecimal = valor as { toNumber?: () => number }
  if (typeof asDecimal.toNumber === 'function') return asDecimal.toNumber()
  return Number(valor)
}

/**
 * Lista TODAS as empresas (razão social asc) com `statusFinanceiro`,
 * `totalMensal` e `totalVencidoEmAberto`. (Req 2.1, 2.2, 2.3, 2.4)
 *
 * - Varredura GLOBAL (Prisma global, sem escopo por empresa do usuário).
 * - Lista vazia é retornada sem erro quando não há empresas.
 * - Empresa sem contrato aparece com `statusFinanceiro` atual (default `ATIVO`)
 *   e `totalMensal`/`totalVencidoEmAberto` = 0.
 * - `Decimal` (preço/valor) é convertido para `number`.
 */
export async function listarEmpresasComStatus(): Promise<EmpresaStatusView[]> {
  const empresas = await prisma.empresa.findMany({
    orderBy: { razaoSocial: 'asc' },
    select: {
      id: true,
      razaoSocial: true,
      statusFinanceiro: true,
      contratoCobranca: {
        select: {
          precosModulo: { select: { modulo: true, preco: true } },
        },
      },
      faturas: {
        select: { status: true, dataVencimento: true, valor: true },
      },
    },
  })

  const agora = new Date()

  return empresas.map((empresa) => {
    const precos = (empresa.contratoCobranca?.precosModulo ?? []).map((p) => ({
      modulo: p.modulo as Modulo,
      preco: paraNumero(p.preco),
    }))
    const totalMensal = calcularTotalMensal(precos)

    const faturas = empresa.faturas.map((f) => ({
      status: f.status as StatusFatura,
      dataVencimento: f.dataVencimento,
      valor: paraNumero(f.valor),
    }))
    const totalVencidoEmAberto = calcularTotalVencidoEmAberto(faturas, agora)

    return {
      empresaId: empresa.id,
      nome: empresa.razaoSocial,
      statusFinanceiro: empresa.statusFinanceiro as StatusFinanceiro,
      totalMensal,
      totalVencidoEmAberto,
    }
  })
}

/**
 * Materializa um novo `statusFinanceiro` na `Empresa`. Usado pelo job diário e
 * (indiretamente) pelas ações manuais. Não registra auditoria — as ações
 * manuais que exigem auditoria usam `reativarEmpresa`/`inativarEmpresa`.
 *
 * Isolamento explícito por `where: { id: empresaId }` (empresa-alvo).
 */
export async function aplicarStatus(empresaId: string, novo: StatusFinanceiro): Promise<void> {
  await prisma.empresa.update({
    where: { id: empresaId },
    data: { statusFinanceiro: novo },
  })
}

/**
 * Reativação manual: `SOMENTE_LEITURA | INATIVADO -> ATIVO`, registrando
 * `reativadoPor`/`reativadoEm` para auditoria. (Req 8.7, 9.4, 9.6)
 *
 * Isolamento explícito por `where: { id: empresaId }` (empresa-alvo).
 */
export async function reativarEmpresa(empresaId: string, superAdminId: string): Promise<void> {
  await prisma.empresa.update({
    where: { id: empresaId },
    data: {
      statusFinanceiro: 'ATIVO',
      reativadoPor: superAdminId,
      reativadoEm: new Date(),
    },
  })
}

/**
 * Inativação manual: `ATIVO | SOMENTE_LEITURA -> INATIVADO`, registrando
 * `inativadoPor`/`inativadoEm` para auditoria. (Req 9.1, 9.5)
 *
 * Isolamento explícito por `where: { id: empresaId }` (empresa-alvo).
 */
export async function inativarEmpresa(empresaId: string, superAdminId: string): Promise<void> {
  await prisma.empresa.update({
    where: { id: empresaId },
    data: {
      statusFinanceiro: 'INATIVADO',
      inativadoPor: superAdminId,
      inativadoEm: new Date(),
    },
  })
}
