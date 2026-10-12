import { prisma } from '../../lib/prisma'
import { validarCadeia, type LeituraCadeia, type InconsistenciaCadeia } from './contador-maquina.service'

/**
 * Histórico e correção de leituras de contador — lado ERP/PCP (supervisor),
 * NÃO o terminal do operador (spec checkout-contagem-por-contador, tasks 4.1–4.3).
 *
 * Diferença fundamental em relação a `checkout.service.ts`: aqui o escopo é a
 * EMPRESA (perfil PCP/supervisor logado no ERP), não a Sessão_Terminal de um
 * Centro específico. Por isso o isolamento multi-tenant é feito por `empresaId`
 * EXPLÍCITO em toda query (padrão do steering ATENCAO-pontos-verificar.md —
 * nunca confiar só no prismaScoped, especialmente sob SUPER_ADMIN).
 *
 * IMPORTANTE — `empresaId` sempre o da ENTIDADE DE NEGÓCIO REAL (a OP/etapa).
 * A `LeituraContador` carrega o `empresaId` da OP real (gravado no apontamento
 * do terminal); portanto filtrar `leituraContador.empresaId` já isola pela
 * empresa produtora. A correção também valida que o Centro de Produção
 * pertence à empresa, para não vazar entre tenants.
 */

/** Erro de regra do histórico/correção (status + mensagem). */
export class ContadorPcpError extends Error {
  constructor(public statusCode: number, message: string) {
    super(message)
    this.name = 'ContadorPcpError'
  }
}

export interface LeituraHistoricoItem {
  id: string
  etapaOrdemProducaoId: string
  apontamentoEtapaId: string | null
  leituraInicial: number
  leituraFinal: number
  quantidade: number
  resetDoDia: boolean
  funcionarioId: string | null
  funcionarioNome: string | null
  dataHora: Date
}

/**
 * Lista cronológica (asc) das `LeituraContador` de um Centro de Produção,
 * isolada por empresa. Valida que o centro pertence à empresa antes de listar
 * (um centro de outra empresa resulta em 404, não em lista vazia silenciosa).
 */
export async function historicoDoCentro(
  centroProducaoId: string,
  empresaId: string,
): Promise<LeituraHistoricoItem[]> {
  const centro = await prisma.centroProducao.findFirst({
    where: { id: centroProducaoId, empresaId },
    select: { id: true },
  })
  if (!centro) {
    throw new ContadorPcpError(404, 'Centro de produção não encontrado')
  }

  const leituras = await prisma.leituraContador.findMany({
    where: { empresaId, centroProducaoId },
    orderBy: { dataHora: 'asc' },
  })

  // Resolve nomes dos operadores (uma query só, sem N+1).
  const funcionarioIds = [
    ...new Set(leituras.map((l) => l.funcionarioId).filter((id): id is string => id !== null)),
  ]
  const funcionarios =
    funcionarioIds.length > 0
      ? await prisma.funcionario.findMany({
          where: { id: { in: funcionarioIds } },
          select: { id: true, nome: true },
        })
      : []
  const nomePorId = new Map(funcionarios.map((f) => [f.id, f.nome]))

  return leituras.map((l) => ({
    id: l.id,
    etapaOrdemProducaoId: l.etapaOrdemProducaoId,
    apontamentoEtapaId: l.apontamentoEtapaId,
    leituraInicial: Number(l.leituraInicial),
    leituraFinal: Number(l.leituraFinal),
    quantidade: Number(l.quantidade),
    resetDoDia: l.resetDoDia,
    funcionarioId: l.funcionarioId,
    funcionarioNome: l.funcionarioId ? nomePorId.get(l.funcionarioId) ?? null : null,
    dataHora: l.dataHora,
  }))
}

export interface CorrigirLeituraInput {
  leituraInicial?: number
  leituraFinal?: number
}

export interface CorrigirLeituraResultado {
  leitura: {
    id: string
    leituraInicial: number
    leituraFinal: number
    quantidade: number
  }
  /** Delta aplicado em EtapaOrdemProducao.quantidadeProduzida (novo − antigo). */
  deltaQuantidade: number
}

/**
 * Corrige uma `LeituraContador` pelo histórico (perfil PCP). Fluxo:
 * 1. Resolve a leitura isolada por empresa (404 se de outra empresa).
 * 2. Simula a cadeia do centro COM os novos valores e roda `validarCadeia`.
 *    Se quebrar a consistência (quantidade negativa ou descasar da vizinha),
 *    NÃO grava e lança 409 com o valor esperado (Req 4.5).
 * 3. Grava `LogLeituraContador` (um por campo alterado) com valor anterior/novo.
 * 4. Atualiza a leitura, recalcula `quantidade` (= final − inicial) e aplica o
 *    delta em `EtapaOrdemProducao.quantidadeProduzida` + no `ApontamentoEtapa`
 *    vinculado (Req 4.6), tudo numa transação.
 */
export async function corrigirLeitura(
  leituraId: string,
  empresaId: string,
  dados: CorrigirLeituraInput,
  usuarioId: string | null,
): Promise<CorrigirLeituraResultado> {
  if (dados.leituraInicial === undefined && dados.leituraFinal === undefined) {
    throw new ContadorPcpError(400, 'Informe leituraInicial e/ou leituraFinal para corrigir.')
  }

  const leitura = await prisma.leituraContador.findFirst({
    where: { id: leituraId, empresaId },
  })
  if (!leitura) {
    throw new ContadorPcpError(404, 'Leitura de contador não encontrada')
  }

  const novaInicial = dados.leituraInicial ?? Number(leitura.leituraInicial)
  const novaFinal = dados.leituraFinal ?? Number(leitura.leituraFinal)

  // Monta a cadeia completa do centro (ordem cronológica asc) substituindo a
  // leitura corrigida pelos novos valores, e valida a consistência.
  const cadeiaDb = await prisma.leituraContador.findMany({
    where: { empresaId, centroProducaoId: leitura.centroProducaoId },
    orderBy: { dataHora: 'asc' },
    select: { id: true, leituraInicial: true, leituraFinal: true, resetDoDia: true },
  })
  const cadeia: LeituraCadeia[] = cadeiaDb.map((l) => ({
    id: l.id,
    leituraInicial: l.id === leituraId ? novaInicial : Number(l.leituraInicial),
    leituraFinal: l.id === leituraId ? novaFinal : Number(l.leituraFinal),
    resetDoDia: l.resetDoDia,
  }))

  const problemas: InconsistenciaCadeia[] = validarCadeia(cadeia)
  if (problemas.length > 0) {
    // Prioriza, se existir, uma inconsistência da PRÓPRIA leitura corrigida;
    // senão a primeira da cadeia (ex.: a leitura seguinte descasou).
    const foco = problemas.find((p) => p.leituraId === leituraId) ?? problemas[0]
    throw new ContadorPcpError(
      409,
      JSON.stringify({
        message: 'A correção quebra a consistência da cadeia de contadores.',
        leituraId: foco.leituraId,
        campo: foco.campo,
        valorAtual: foco.valorAtual,
        valorEsperado: foco.valorEsperado,
        motivo: foco.motivo,
      }),
    )
  }

  const novaQuantidade = novaFinal - novaInicial
  const quantidadeAntiga = Number(leitura.quantidade)
  const deltaQuantidade = novaQuantidade - quantidadeAntiga

  const resultado = await prisma.$transaction(async (tx) => {
    // Auditoria: um log por campo efetivamente alterado.
    if (dados.leituraInicial !== undefined && novaInicial !== Number(leitura.leituraInicial)) {
      await tx.logLeituraContador.create({
        data: {
          empresaId,
          leituraContadorId: leituraId,
          campo: 'leituraInicial',
          valorAnterior: leitura.leituraInicial,
          valorNovo: novaInicial,
          usuarioId,
        },
      })
    }
    if (dados.leituraFinal !== undefined && novaFinal !== Number(leitura.leituraFinal)) {
      await tx.logLeituraContador.create({
        data: {
          empresaId,
          leituraContadorId: leituraId,
          campo: 'leituraFinal',
          valorAnterior: leitura.leituraFinal,
          valorNovo: novaFinal,
          usuarioId,
        },
      })
    }

    const leituraAtualizada = await tx.leituraContador.update({
      where: { id: leituraId },
      data: {
        leituraInicial: novaInicial,
        leituraFinal: novaFinal,
        quantidade: novaQuantidade,
      },
    })

    // Req 4.6 — reflete o ajuste no total da etapa e no apontamento vinculado.
    if (deltaQuantidade !== 0) {
      await tx.etapaOrdemProducao.update({
        where: { id: leitura.etapaOrdemProducaoId },
        data: { quantidadeProduzida: { increment: deltaQuantidade } },
      })
      if (leitura.apontamentoEtapaId) {
        await tx.apontamentoEtapa.update({
          where: { id: leitura.apontamentoEtapaId },
          data: { quantidadeProduzida: { increment: deltaQuantidade } },
        })
      }
    }

    return leituraAtualizada
  })

  return {
    leitura: {
      id: resultado.id,
      leituraInicial: Number(resultado.leituraInicial),
      leituraFinal: Number(resultado.leituraFinal),
      quantidade: Number(resultado.quantidade),
    },
    deltaQuantidade,
  }
}
