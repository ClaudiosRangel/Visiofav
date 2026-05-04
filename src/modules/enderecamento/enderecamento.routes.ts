import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../../lib/prisma'

export async function enderecamentoRoutes(app: FastifyInstance) {
  // Endereçar itens de uma NF conferida — cria OS, movimentos e atualiza saldos
  app.post('/enderecamento-automatico', async (request, reply) => {
    const body = z.object({
      notaEntradaId: z.string().uuid(),
      centroDistribuicaoId: z.string().uuid(),
    }).parse(request.body)

    // Busca NF com itens
    const nota = await prisma.notaEntrada.findUnique({
      where: { id: body.notaEntradaId },
      include: { itens: true },
    })
    if (!nota) return reply.status(404).send({ message: 'Nota não encontrada' })
    if (nota.status !== 'CONFERIDA') return reply.status(400).send({ message: 'Nota precisa estar conferida' })

    // Busca endereços livres
    const enderecosLivres = await prisma.endereco.findMany({
      where: { centroDistribuicaoId: body.centroDistribuicaoId, estado: 'LIVRE', status: true, tipo: 'ARMAZENAGEM' },
      orderBy: { enderecoCompleto: 'asc' },
      take: nota.itens.length,
    })

    if (enderecosLivres.length === 0) {
      return reply.status(400).send({ message: 'Nenhum endereço livre disponível' })
    }

    // Cria OS de endereçamento
    const hora = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
    const os = await prisma.ordemServico.create({
      data: {
        tipo: 'ENTRADA', tipoOperacao: 'ENDERECAMENTO', hora,
        numDocumento: String(nota.numero), status: 'CONCLUIDO',
        centroDistribuicaoId: body.centroDistribuicaoId,
      },
    })

    // Para cada item, cria movimento e atualiza saldo
    const movimentos = []
    for (let i = 0; i < nota.itens.length; i++) {
      const item = nota.itens[i]
      const endereco = enderecosLivres[i % enderecosLivres.length]

      // Busca produto pelo código ou descrição
      let produto = await prisma.produto.findFirst({
        where: { centroDistribuicaoId: body.centroDistribuicaoId, descricao: { contains: item.descricao, mode: 'insensitive' } },
      })

      // Se não encontrou, cria o produto
      if (!produto) {
        produto = await prisma.produto.create({
          data: { descricao: item.descricao, unidade: item.unidade, centroDistribuicaoId: body.centroDistribuicaoId },
        })
      }

      // Cria movimento
      const mov = await prisma.movimento.create({
        data: {
          item: i + 1, quantidade: item.quantidade, lote: item.lote,
          validade: item.validade, data: new Date(), hora,
          status: 'EXECUTADO', enderecado: true,
          ordemServicoId: os.id, produtoId: produto.id, destinoId: endereco.id,
        },
      })
      movimentos.push(mov)

      // Atualiza ou cria saldo
      const saldoExistente = await prisma.saldoEndereco.findFirst({
        where: { enderecoId: endereco.id, produtoId: produto.id, lote: item.lote || null },
      })

      if (saldoExistente) {
        await prisma.saldoEndereco.update({
          where: { id: saldoExistente.id },
          data: { quantidade: { increment: item.quantidade } },
        })
      } else {
        await prisma.saldoEndereco.create({
          data: {
            enderecoId: endereco.id, produtoId: produto.id,
            quantidade: item.quantidade, lote: item.lote, validade: item.validade,
          },
        })
      }

      // Marca endereço como ocupado
      await prisma.endereco.update({ where: { id: endereco.id }, data: { estado: 'OCUPADO' } })
    }

    // Atualiza status da NF
    await prisma.notaEntrada.update({ where: { id: body.notaEntradaId }, data: { status: 'ENDERECADA' } })

    // Log
    await prisma.logOrdemServico.create({
      data: { ordemServicoId: os.id, acao: 'Endereçamento automático concluído', descricao: `NF ${nota.numero} - ${movimentos.length} itens endereçados` },
    })

    return reply.status(201).send({
      ordemServico: os,
      movimentos: movimentos.length,
      message: `${movimentos.length} itens endereçados com sucesso`,
    })
  })
}
