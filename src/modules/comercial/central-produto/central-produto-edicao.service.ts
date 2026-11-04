// Service de EDIÇÃO transacional da Central de Consulta do Produto/Acabado.
// Edita SÓ cadastro: Produto (descricao/imagemUrl), AtributoGrafico (ficha) e
// vínculos DeParaImportacao (códigos de acabado). NÃO toca OrdemProducao,
// CalculoGrafico nem ItemOrcamentoGrafico (Req 9.4). Tudo numa única transação,
// com rollback em falha (Req 9.5). empresaId validado na entidade real (Req 11.4).

import { Prisma } from '@prisma/client'
import { prisma } from '../../../lib/prisma'
import { CentralProdutoError } from './central-produto.errors'
import { validarEdicao } from './central-produto-validacao'
import { obterDetalhe } from './central-produto-detalhe.service'
import type { EdicaoParams, DetalheProduto } from './central-produto.types'

/**
 * Aplica as alterações de cadastro numa única transação.
 * Retorna o DetalheProduto atualizado.
 */
export async function aplicarEdicao(p: EdicaoParams): Promise<DetalheProduto> {
  const { empresaId, produtoId } = p

  // Resolve o produto da empresa real — cross-empresa ⇒ 404 (Req 11.4).
  const produto = await prisma.produto.findFirst({
    where: { id: produtoId, empresaId },
    select: { id: true },
  })
  if (!produto) throw new CentralProdutoError('Produto não encontrado.', 404)

  // Vínculos existentes (para validar duplicata de código acabado — Req 9.7).
  const existentes = await prisma.deParaImportacao.findMany({
    where: {
      empresaId,
      sistemaOrigem: 'GPRINT',
      tipoEntidade: 'PRODUTO',
      entidadeInternaId: produtoId,
    },
    select: { codigoExterno: true, nomeExterno: true },
  })

  validarEdicao({
    descricao: p.descricao,
    imagemUrl: p.imagemUrl,
    adicionarAcabados: p.adicionarAcabados,
    acabadosExistentes: existentes.map((e) => e.codigoExterno),
  })

  const nomeExterno = existentes[0]?.nomeExterno ?? p.descricao ?? ''

  try {
    await prisma.$transaction(async (tx) => {
      // 1) Produto: descricao / imagemUrl
      const dataProduto: Prisma.ProdutoUpdateInput = {}
      if (p.descricao !== undefined) dataProduto.descricao = p.descricao
      if (p.imagemUrl !== undefined) dataProduto.imagemUrl = p.imagemUrl
      if (Object.keys(dataProduto).length > 0) {
        await tx.produto.update({ where: { id: produtoId }, data: dataProduto })
      }

      // 2) AtributoGrafico (ficha técnica) — upsert por [empresaId, produtoId]
      if (p.fichaTecnica) {
        const f = p.fichaTecnica
        await tx.atributoGrafico.upsert({
          where: { empresaId_produtoId: { empresaId, produtoId } },
          create: {
            empresaId,
            produtoId,
            tipoCartaoId: f.tipoCartaoId ?? null,
            tipoFormatoId: f.tipoFormatoId ?? null,
            tipoGramaturaId: f.tipoGramaturaId ?? null,
            tipoPolicromiaId: f.tipoPolicromiaId ?? null,
            tipoVernizId: f.tipoVernizId ?? null,
            tipoCoresIds: f.tipoCoresIds ?? [],
          },
          update: {
            ...(f.tipoCartaoId !== undefined ? { tipoCartaoId: f.tipoCartaoId } : {}),
            ...(f.tipoFormatoId !== undefined ? { tipoFormatoId: f.tipoFormatoId } : {}),
            ...(f.tipoGramaturaId !== undefined
              ? { tipoGramaturaId: f.tipoGramaturaId }
              : {}),
            ...(f.tipoPolicromiaId !== undefined
              ? { tipoPolicromiaId: f.tipoPolicromiaId }
              : {}),
            ...(f.tipoVernizId !== undefined ? { tipoVernizId: f.tipoVernizId } : {}),
            ...(f.tipoCoresIds !== undefined ? { tipoCoresIds: f.tipoCoresIds } : {}),
          },
        })
      }

      // 3) Remover vínculos de código acabado
      if (p.removerAcabados && p.removerAcabados.length > 0) {
        await tx.deParaImportacao.deleteMany({
          where: {
            empresaId,
            sistemaOrigem: 'GPRINT',
            tipoEntidade: 'PRODUTO',
            entidadeInternaId: produtoId,
            codigoExterno: { in: p.removerAcabados.map((c) => c.trim()) },
          },
        })
      }

      // 4) Adicionar vínculos de código acabado (P2002 ⇒ 409)
      if (p.adicionarAcabados && p.adicionarAcabados.length > 0) {
        for (const bruto of p.adicionarAcabados) {
          const codigoExterno = bruto.trim()
          await tx.deParaImportacao.create({
            data: {
              empresaId,
              sistemaOrigem: 'GPRINT',
              tipoEntidade: 'PRODUTO',
              codigoExterno,
              nomeExterno,
              entidadeInternaId: produtoId,
            },
          })
        }
      }
    })
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw new CentralProdutoError(
        'Código de acabado já vinculado a outro produto.',
        409,
      )
    }
    throw err
  }

  // Retorna o estado atualizado.
  return obterDetalhe({ empresaId, produtoId })
}
