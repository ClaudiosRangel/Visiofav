/**
 * Serviço de validação de movimentação — integra bloqueio hierárquico,
 * compatibilidade de área, pulmão misto e inventário ativo numa única
 * função de validação chamada ANTES de qualquer movimentação de estoque.
 *
 * Deve ser chamado por: enderecamento-wms.routes.ts (confirmar, confirmar-coletor,
 * confirmar-lote), enderecamento-inteligente.routes.ts (confirmar),
 * ressuprimento.routes.ts (executar).
 */

import { prisma } from '../../lib/prisma'
import { verificarBloqueio } from './bloqueio-hierarquico.service'
import { validarCompatibilidadeArea, validarLimitePulmaoMisto } from './compatibilidade-area.service'

export interface ValidarMovimentacaoInput {
  empresaId: string
  enderecoId: string
  produtoId: string
  lote?: string | null
}

export interface ResultadoValidacao {
  permitido: boolean
  motivos: string[]
}

/**
 * Validação consolidada antes de qualquer movimentação de entrada em endereço.
 * Verifica em ordem:
 * 1. Bloqueio hierárquico (todos os níveis)
 * 2. Compatibilidade de área (classificação + ambiente)
 * 3. Limite de SKUs em pulmão misto
 * 4. Inventário ativo (endereço travado para contagem)
 *
 * Retorna { permitido: false, motivos: [...] } se qualquer regra bloquear.
 */
export async function validarMovimentacaoEntrada(input: ValidarMovimentacaoInput): Promise<ResultadoValidacao> {
  const { empresaId, enderecoId, produtoId, lote } = input
  const motivos: string[] = []

  // 1. Verificar bloqueio hierárquico
  const bloqueio = await verificarBloqueio({
    empresaId,
    enderecoId,
    produtoId,
    lote: lote ?? undefined,
  })

  if (bloqueio.bloqueado) {
    motivos.push(...bloqueio.motivos)
  }

  // 2. Verificar compatibilidade de área
  const produto = await prisma.produto.findFirst({
    where: { id: produtoId },
    select: { classificacaoArmazenagemId: true, ambienteExigido: true },
  })

  const endereco = await prisma.endereco.findFirst({
    where: { id: enderecoId },
    select: {
      classificacaoProdutoId: true,
      ambienteArmazenagemId: true,
      ambienteArmazenagem: { select: { temperatura: true } },
      maxSkusMisto: true,
      quarentena: true,
      inventarioAtivo: true,
    },
  })

  if (produto && endereco) {
    const compatibilidade = validarCompatibilidadeArea(
      {
        classificacaoArmazenagemId: produto.classificacaoArmazenagemId ?? null,
        ambienteExigido: produto.ambienteExigido ?? null,
      },
      {
        classificacaoProdutoId: endereco.classificacaoProdutoId,
        ambienteArmazenagemId: endereco.ambienteArmazenagemId,
        ambienteTemperatura: endereco.ambienteArmazenagem?.temperatura ?? null,
      },
    )

    if (!compatibilidade.compativel) {
      motivos.push(...compatibilidade.motivos)
    }

    // 3. Verificar limite de pulmão misto
    if (endereco.maxSkusMisto) {
      const saldos = await prisma.saldoEndereco.findMany({
        where: { enderecoId, quantidade: { gt: 0 } },
        select: { produtoId: true },
        distinct: ['produtoId'],
      })
      const produtosExistentes = saldos.map((s) => s.produtoId)

      const limiteMisto = validarLimitePulmaoMisto(
        endereco.maxSkusMisto,
        produtosExistentes,
        produtoId,
      )

      if (!limiteMisto.permitido) {
        motivos.push(limiteMisto.motivo!)
      }
    }

    // 4. Inventário ativo e quarentena já são capturados pelo bloqueio hierárquico (passo 1),
    // mas verificamos diretamente também como safety-net
    if (endereco.inventarioAtivo && !motivos.some((m) => m.includes('inventário'))) {
      motivos.push('Endereço em inventário ativo — movimentações bloqueadas')
    }
    if (endereco.quarentena && !motivos.some((m) => m.includes('quarentena'))) {
      motivos.push('Endereço em quarentena — entrada bloqueada')
    }
  }

  return {
    permitido: motivos.length === 0,
    motivos,
  }
}
