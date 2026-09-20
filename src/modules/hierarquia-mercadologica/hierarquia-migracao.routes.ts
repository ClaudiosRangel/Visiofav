import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../../lib/prisma'
import { authenticate } from '../../middleware/authenticate'
import {
  validarCodigoSegmento,
  normalizarCodigoSegmento,
  composeCodigoHierarquico,
  TIPO_PAI_OBRIGATORIO,
  type TipoNivel,
} from './hierarquia.service'
import {
  normalizarTexto,
  gerarSugestoes,
  type FolhaCandidata,
  type ValorLegadoAgrupado,
} from './hierarquia-analitica.service'

/**
 * Migração assistida dos campos legados (familia/subFamilia) para o vínculo
 * estruturado (Produto.familiaId), da Hierarquia Mercadológica (Fase 2).
 *
 * Não-destrutiva (nunca toca familia/subFamilia) e reversível (histórico por
 * execução). Isolamento multi-tenant com filtro EXPLÍCITO por empresaId.
 * Prefixo registrado no server.ts: /api/hierarquia-mercadologica/migracao.
 */

const ITEM_SEM_CLASSIFICACAO = '(sem classificação)'

function getEmpresaId(request: any): string | undefined {
  return (request.user as { empresaId?: string } | undefined)?.empresaId
}
function getUsuarioId(request: any): string | undefined {
  return (request.user as { id?: string } | undefined)?.id
}
function isAdmin(request: any): boolean {
  const perfil = (request.user as { perfil?: string } | undefined)?.perfil
  return ['ADMIN', 'SUPER_ADMIN'].includes(perfil ?? '')
}

export async function hierarquiaMigracaoRoutes(app: FastifyInstance) {
  app.addHook('onRequest', authenticate)

  // GET /analisar — levanta valores legados distintos + sugestões de vínculo.
  app.get('/analisar', async (request, reply) => {
    const empresaId = getEmpresaId(request)
    if (!empresaId) return reply.status(400).send({ message: 'Empresa não selecionada' })

    const produtos = await prisma.produto.findMany({
      where: { empresaId },
      select: { familia: true, subFamilia: true },
    })

    // Agrupa por texto normalizado do valor legado (familia com prioridade,
    // senão subFamilia). Vazio/nulo/só espaços → item "sem classificação".
    const grupos = new Map<string, ValorLegadoAgrupado>()
    let semClassificacao = 0
    for (const p of produtos) {
      const bruto = (p.familia ?? p.subFamilia ?? '').trim()
      if (!bruto) {
        semClassificacao += 1
        continue
      }
      const norm = normalizarTexto(bruto)
      const existente = grupos.get(norm)
      if (existente) existente.quantidade += 1
      else grupos.set(norm, { textoNormalizado: norm, valorOriginal: bruto, quantidade: 1 })
    }

    const folhas = await prisma.nivelMercadologico.findMany({
      where: { empresaId, tipo: 'SUBCATEGORIA' },
      select: { id: true, descricao: true, codigoHierarquico: true },
    })

    const itens = gerarSugestoes([...grupos.values()], folhas as FolhaCandidata[])

    return {
      itens,
      semClassificacao: { rotulo: ITEM_SEM_CLASSIFICACAO, quantidade: semClassificacao },
      totalFolhasDisponiveis: folhas.length,
    }
  })

  // POST /confirmar — aplica os mapeamentos, grava familiaId, registra histórico.
  app.post('/confirmar', async (request, reply) => {
    if (!isAdmin(request)) return reply.status(403).send({ message: 'Somente administradores podem executar a migração.' })
    const empresaId = getEmpresaId(request)
    if (!empresaId) return reply.status(400).send({ message: 'Empresa não selecionada' })
    const usuarioId = getUsuarioId(request)

    const body = z.object({
      decisoes: z.array(z.object({
        textoNormalizado: z.string(),
        decisao: z.enum(['VINCULAR', 'CRIAR', 'IGNORAR']),
        folhaId: z.string().uuid().optional(),
        substituirExistente: z.boolean().optional(),
        // Para CRIAR um novo nível folha (SUBCATEGORIA) durante a revisão.
        novoNivel: z.object({
          paiId: z.string().uuid(),           // CATEGORIA pai
          codigo: z.string().min(1),
          descricao: z.string().min(1),
        }).optional(),
      })).min(1),
    }).parse(request.body)

    const avisos: string[] = []

    const resultado = await prisma.$transaction(async (tx) => {
      const execucao = await tx.migracaoHierarquiaExecucao.create({
        data: { empresaId, usuarioId: usuarioId ?? null },
      })

      let totalAfetados = 0

      for (const dec of body.decisoes) {
        if (dec.decisao === 'IGNORAR') continue

        // Resolve a folha destino.
        let folhaId: string | null = null

        if (dec.decisao === 'CRIAR') {
          if (!dec.novoNivel) {
            avisos.push(`Mapeamento "${dec.textoNormalizado}" ignorado: dados do novo nível ausentes.`)
            continue
          }
          const tipo: TipoNivel = 'SUBCATEGORIA'
          const codigoNorm = normalizarCodigoSegmento(tipo, dec.novoNivel.codigo)
          const valSeg = validarCodigoSegmento(tipo, codigoNorm)
          if (!valSeg.valido) {
            avisos.push(`Mapeamento "${dec.textoNormalizado}" rejeitado: ${valSeg.erro}`)
            continue
          }
          const pai = await tx.nivelMercadologico.findFirst({
            where: { id: dec.novoNivel.paiId, empresaId },
            select: { tipo: true, codigoHierarquico: true },
          })
          if (!pai || pai.tipo !== TIPO_PAI_OBRIGATORIO[tipo]) {
            avisos.push(`Mapeamento "${dec.textoNormalizado}" rejeitado: pai inválido (deve ser CATEGORIA da empresa).`)
            continue
          }
          const codigoHierarquico = composeCodigoHierarquico(tipo, pai.codigoHierarquico, codigoNorm)
          try {
            const criado = await tx.nivelMercadologico.create({
              data: { empresaId, tipo, codigo: codigoNorm, codigoHierarquico, descricao: dec.novoNivel.descricao, paiId: dec.novoNivel.paiId },
            })
            folhaId = criado.id
          } catch (err: any) {
            if (err?.code === 'P2002') {
              avisos.push(`Mapeamento "${dec.textoNormalizado}" rejeitado: já existe nível com código "${codigoHierarquico}".`)
            } else {
              avisos.push(`Mapeamento "${dec.textoNormalizado}" rejeitado ao criar nível: ${err?.message ?? 'erro'}.`)
            }
            continue
          }
        } else {
          // VINCULAR: valida a folha existente (existe, é SUBCATEGORIA, mesma empresa).
          if (!dec.folhaId) {
            avisos.push(`Mapeamento "${dec.textoNormalizado}" ignorado: folha destino ausente.`)
            continue
          }
          const folha = await tx.nivelMercadologico.findFirst({
            where: { id: dec.folhaId, empresaId },
            select: { id: true, tipo: true },
          })
          if (!folha || folha.tipo !== 'SUBCATEGORIA') {
            avisos.push(`Mapeamento "${dec.textoNormalizado}" rejeitado: nível destino inválido (deve ser folha Subcategoria/Família desta empresa).`)
            continue
          }
          folhaId = folha.id
        }

        if (!folhaId) continue

        // Seleciona os produtos da empresa cujo valor legado normalizado bate.
        const candidatos = await tx.produto.findMany({
          where: { empresaId },
          select: { id: true, familia: true, subFamilia: true, familiaId: true },
        })
        for (const p of candidatos) {
          const bruto = (p.familia ?? p.subFamilia ?? '').trim()
          if (!bruto || normalizarTexto(bruto) !== dec.textoNormalizado) continue

          if (p.familiaId && dec.substituirExistente !== true) {
            // Mantém o vínculo existente (Req 7.2) — sem histórico.
            continue
          }
          if (p.familiaId === folhaId) continue // já está no destino, nada a fazer

          const anterior = p.familiaId ?? null
          await tx.produto.update({
            where: { id: p.id },
            data: { familiaId: folhaId },
          })
          await tx.migracaoHierarquiaItem.create({
            data: { execucaoId: execucao.id, produtoId: p.id, familiaIdAnterior: anterior, familiaIdNovo: folhaId },
          })
          totalAfetados += 1
        }
      }

      await tx.migracaoHierarquiaExecucao.update({
        where: { id: execucao.id },
        data: { totalAfetados },
      })

      return { execucaoId: execucao.id, totalAfetados }
    })

    return { ...resultado, avisos }
  })

  // GET /execucoes — lista execuções da empresa (auditoria / escolha de reversão).
  app.get('/execucoes', async (request, reply) => {
    const empresaId = getEmpresaId(request)
    if (!empresaId) return reply.status(400).send({ message: 'Empresa não selecionada' })
    const execucoes = await prisma.migracaoHierarquiaExecucao.findMany({
      where: { empresaId },
      orderBy: { criadoEm: 'desc' },
      select: { id: true, usuarioId: true, totalAfetados: true, revertidaEm: true, criadoEm: true },
    })
    return { data: execucoes }
  })

  // POST /execucoes/:id/reverter — restaura o familiaId anterior dos itens.
  app.post('/execucoes/:id/reverter', async (request, reply) => {
    if (!isAdmin(request)) return reply.status(403).send({ message: 'Somente administradores podem reverter a migração.' })
    const empresaId = getEmpresaId(request)
    if (!empresaId) return reply.status(400).send({ message: 'Empresa não selecionada' })
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)

    const execucao = await prisma.migracaoHierarquiaExecucao.findFirst({
      where: { id, empresaId },
      include: { itens: true },
    })
    if (!execucao) return reply.status(404).send({ message: 'Execução de migração não encontrada nesta empresa.' })
    if (execucao.revertidaEm) return reply.status(409).send({ message: 'Esta execução já foi revertida.' })

    const rejeitados: string[] = []
    let revertidos = 0

    await prisma.$transaction(async (tx) => {
      for (const item of execucao.itens) {
        const produto = await tx.produto.findFirst({
          where: { id: item.produtoId, empresaId },
          select: { id: true, familiaId: true },
        })
        // Só reverte se o estado atual continua sendo o valor gravado por esta execução.
        if (!produto || produto.familiaId !== item.familiaIdNovo) {
          rejeitados.push(item.produtoId)
          continue
        }
        await tx.produto.update({
          where: { id: produto.id },
          data: { familiaId: item.familiaIdAnterior },
        })
        revertidos += 1
      }
      await tx.migracaoHierarquiaExecucao.update({
        where: { id: execucao.id },
        data: { revertidaEm: new Date() },
      })
    })

    return { revertidos, rejeitados }
  })
}
