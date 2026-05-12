/**
 * Rotas do módulo de Endereçamento Inteligente.
 * POST /distribuir — calcula distribuição por capacidade com split
 * GET /ocupacao — retorna estado de ocupação dos endereços de um depósito
 */

import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { prisma } from '../../lib/prisma'
import { authenticate } from '../../middleware/authenticate'
import { moduloGuard } from '../../middleware/modulo-guard'
import { converterParaUnidadeMaster, selecionarSkuMaster, type SkuInfo } from './conversor-unidade.service'
import { validarCubagem, type DimensoesSku, type DimensoesEstrutura, type CapacidadeNivelConfig } from './validador-cubagem.service'
import { ordenarPorProximidade, type EnderecoCandidate } from './alocador-proximidade.service'
import { calcularDistribuicao, calcularCapacidadePalete, type EnderecoComCapacidade, type DistribuicaoResult } from './motor-distribuicao.service'
import { calcularAbastecimentoPicking, type DadosPickingConfig, type AlocacaoPicking } from './abastecimento-picking.service'

// ── Zod Schemas ────────────────────────────────────────────────────────

const distribuirBodySchema = z.object({
  produtoId: z.string().uuid(),
  quantidade: z.number().positive('Quantidade deve ser maior que zero'),
  lote: z.string().optional(),
  validade: z.string().optional(),
  skuId: z.string().uuid().optional(),
})

const ocupacaoQuerySchema = z.object({
  depositoId: z.string().uuid(),
})

// ── Route Registration ─────────────────────────────────────────────────

export async function enderecamentoInteligenteRoutes(app: FastifyInstance) {
  app.addHook('onRequest', authenticate)
  app.addHook('preHandler', moduloGuard('WMS'))

  // ── POST /distribuir ─────────────────────────────────────────────────
  app.post('/distribuir', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const body = distribuirBodySchema.parse(request.body)

    // 1. Buscar produto
    const produto = await prisma.produto.findFirst({
      where: { id: body.produtoId, empresaId: user.empresaId },
    })
    if (!produto) {
      return reply.status(404).send({ message: 'Produto não encontrado' })
    }

    // 2. Buscar SKUs do produto (ordenados por sequência)
    const skusRaw = await prisma.sku.findMany({
      where: { produtoId: body.produtoId },
      orderBy: { sequencia: 'asc' },
    })

    const skus: SkuInfo[] = skusRaw.map((s) => ({
      id: s.id,
      sequencia: s.sequencia,
      qtdEmbalagem: s.qtdEmbalagem,
      lastro: s.lastro,
      camada: s.camada,
    }))

    // 3. Selecionar SKU master
    let skuMaster: SkuInfo
    try {
      skuMaster = selecionarSkuMaster(skus)
    } catch (err: any) {
      return reply.status(422).send({ message: err.message })
    }

    // 4. Determinar SKU de expedição
    const skuExpedicao = body.skuId
      ? skus.find((s) => s.id === body.skuId) ?? skus[0]
      : skus[0]

    if (!skuExpedicao) {
      return reply.status(422).send({ message: 'Nenhum SKU encontrado para este produto' })
    }

    // 5. Converter para unidade master
    const { quantidadeMaster } = converterParaUnidadeMaster({
      quantidade: body.quantidade,
      skuExpedicao,
      skuMaster,
    })

    // 6. Buscar DadosLogisticos
    const dadosArmazenagem = await prisma.dadosLogisticosArmazenagem.findFirst({
      where: { produtoId: body.produtoId },
    })
    const dadosPicking = await prisma.dadosLogisticosPicking.findFirst({
      where: { produtoId: body.produtoId },
    })

    // 7. Determinar prédio/rua de origem
    let predioOrigem = 1
    let ruaOrigem = 'A'
    let nivelMin = dadosArmazenagem?.nivelMinPP ?? 1
    let nivelMax = dadosArmazenagem?.nivelMaxPP ?? 99

    // Se nivelMin/nivelMax são 0, usar defaults amplos
    if (nivelMin === 0) nivelMin = 1
    if (nivelMax === 0) nivelMax = 99

    // Tentar obter origem do picking
    if (dadosPicking?.enderecoPickingId) {
      const enderecoPicking = await prisma.endereco.findUnique({
        where: { id: dadosPicking.enderecoPickingId },
      })
      if (enderecoPicking) {
        predioOrigem = parseInt(enderecoPicking.codigoPredio || '1', 10) || 1
        ruaOrigem = enderecoPicking.codigoRua || 'A'
      }
    } else if (dadosArmazenagem?.enderecoFixoId) {
      const enderecoFixo = await prisma.endereco.findUnique({
        where: { id: dadosArmazenagem.enderecoFixoId },
      })
      if (enderecoFixo) {
        predioOrigem = parseInt(enderecoFixo.codigoPredio || '1', 10) || 1
        ruaOrigem = enderecoFixo.codigoRua || 'A'
      }
    }

    // 8. Buscar DadosLogisticosPicking do produto (Task 4.1)
    // Multi-tenant: o isolamento é garantido pelo produtoId já validado como pertencente à empresa do usuário
    const dadosLogisticosPickingList = await prisma.dadosLogisticosPicking.findMany({
      where: {
        produtoId: body.produtoId,
      },
      orderBy: { sequencia: 'asc' },
    })

    // 9. Montar array de DadosPickingConfig (Task 4.2)
    const dadosPickingConfigs: DadosPickingConfig[] = []

    for (const dadosLogPicking of dadosLogisticosPickingList) {
      // Pular se enderecoPickingId é nulo
      if (!dadosLogPicking.enderecoPickingId) {
        console.warn(
          `[abastecimento-picking] DadosLogisticosPicking ${dadosLogPicking.id} sem enderecoPickingId, pulando`,
        )
        continue
      }

      // Buscar endereço de picking (verificar existência e status) filtrado por empresaId
      const enderecoPick = await prisma.endereco.findFirst({
        where: {
          id: dadosLogPicking.enderecoPickingId,
          empresaId: user.empresaId,
        },
        select: { id: true, status: true, enderecoCompleto: true, empresaId: true },
      })

      if (!enderecoPick) {
        console.warn(
          `[abastecimento-picking] Endereço de picking ${dadosLogPicking.enderecoPickingId} não encontrado no DB para produto ${body.produtoId}, pulando`,
        )
        continue
      }

      // Buscar saldo físico atual via SaldoEndereco.aggregate (sum quantidade) filtrado por empresaId
      let saldoAtual = 0
      try {
        const saldoAggregate = await prisma.saldoEndereco.aggregate({
          where: {
            enderecoId: dadosLogPicking.enderecoPickingId,
            produtoId: body.produtoId,
            empresaId: user.empresaId,
          },
          _sum: { quantidade: true },
        })
        // Se não há registros, _sum.quantidade será null → considerar saldo = 0
        saldoAtual = Number(saldoAggregate._sum.quantidade ?? 0)
      } catch (err) {
        console.error(
          `[abastecimento-picking] Erro ao buscar saldo do endereço ${dadosLogPicking.enderecoPickingId}:`,
          err,
        )
        // Se saldo não pode ser determinado, considerar saldo = 0
        saldoAtual = 0
      }

      dadosPickingConfigs.push({
        enderecoPickingId: enderecoPick.id,
        enderecoCompleto: enderecoPick.enderecoCompleto ?? '',
        capacidade: Number(dadosLogPicking.capacidade),
        pontoReposicao: Number(dadosLogPicking.pontoReposicao) || null,
        saldoAtual,
        enderecoAtivo: enderecoPick.status,
        sequencia: dadosLogPicking.sequencia,
      })
    }

    // 10. Implementar cadeia de prioridade: fixo → consolidação → livre
    const resultado = await executarCadeiaPrioridade({
      produtoId: body.produtoId,
      empresaId: user.empresaId,
      quantidadeMaster,
      dadosArmazenagem,
      predioOrigem,
      ruaOrigem,
      nivelMin,
      nivelMax,
      skuMaster,
      skuMasterRaw: skusRaw.find((s) => s.id === skuMaster.id)!,
      dadosPickingConfigs,
    })

    return resultado
  })

  // ── POST /confirmar — confirma distribuição e registra LogMovimentacao ──
  app.post('/confirmar', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const body = z.object({
      produtoId: z.string().uuid(),
      alocacoes: z.array(z.object({
        enderecoId: z.string().uuid(),
        enderecoCompleto: z.string(),
        quantidadeAlocada: z.number().positive(),
        areaArmazenagem: z.enum(['PICKING', 'PULMAO']).optional(),
      })).min(1),
      lote: z.string().optional(),
      validade: z.string().optional(),
    }).parse(request.body)

    // Verificar produto
    const produto = await prisma.produto.findFirst({
      where: { id: body.produtoId, empresaId: user.empresaId },
    })
    if (!produto) {
      return reply.status(404).send({ message: 'Produto não encontrado' })
    }

    await prisma.$transaction(async (tx) => {
      for (const alocacao of body.alocacoes) {
        const endereco = await tx.endereco.findUnique({ where: { id: alocacao.enderecoId } })
        if (!endereco) {
          throw new Error(`Endereço ${alocacao.enderecoId} não encontrado`)
        }

        // Upsert SaldoEndereco
        const saldoExistente = await tx.saldoEndereco.findFirst({
          where: { enderecoId: alocacao.enderecoId, produtoId: body.produtoId, lote: body.lote || null },
        })

        const saldoAnterior = saldoExistente ? Number(saldoExistente.quantidade) : 0
        const saldoNovo = saldoAnterior + alocacao.quantidadeAlocada

        if (saldoExistente) {
          await tx.saldoEndereco.update({
            where: { id: saldoExistente.id },
            data: { quantidade: { increment: alocacao.quantidadeAlocada } },
          })
        } else {
          await tx.saldoEndereco.create({
            data: {
              enderecoId: alocacao.enderecoId,
              produtoId: body.produtoId,
              quantidade: alocacao.quantidadeAlocada,
              lote: body.lote,
              validade: body.validade ? new Date(body.validade) : undefined,
            },
          })
        }

        // Atualizar estoque consolidado
        await tx.estoque.upsert({
          where: { empresaId_produtoId: { empresaId: user.empresaId, produtoId: body.produtoId } },
          update: { quantidade: { increment: alocacao.quantidadeAlocada } },
          create: { empresaId: user.empresaId, produtoId: body.produtoId, quantidade: alocacao.quantidadeAlocada },
        })

        // Atualizar tipo do endereço para ARMAZENAGEM se estava LIVRE
        if (endereco.tipo === 'LIVRE') {
          await tx.endereco.update({ where: { id: alocacao.enderecoId }, data: { tipo: 'ARMAZENAGEM' } })
        }

        // Registrar LogMovimentacao para cada alocação
        // Para alocações de picking, incluir lote e validade no motivo (Req 3.3, 7.3)
        const isPicking = alocacao.areaArmazenagem === 'PICKING'
        let motivo = isPicking
          ? `Endereçamento picking — ${alocacao.enderecoCompleto}`
          : `Endereçamento inteligente — ${alocacao.enderecoCompleto}`

        if (isPicking && (body.lote || body.validade)) {
          const detalhes: string[] = []
          if (body.lote) detalhes.push(`lote: ${body.lote}`)
          if (body.validade) detalhes.push(`validade: ${body.validade}`)
          motivo += ` (${detalhes.join(', ')})`
        }

        await tx.logMovimentacao.create({
          data: {
            empresaId: user.empresaId,
            produtoId: body.produtoId,
            enderecoId: alocacao.enderecoId,
            tipo: 'ENDERECAMENTO',
            quantidade: alocacao.quantidadeAlocada,
            saldoAnterior,
            saldoNovo,
            motivo,
            usuarioId: user.id,
          },
        })
      }
    })

    return {
      message: 'Endereçamento confirmado',
      alocacoesConfirmadas: body.alocacoes.length,
      quantidadeTotal: body.alocacoes.reduce((acc, a) => acc + a.quantidadeAlocada, 0),
    }
  })

  // ── GET /ocupacao ────────────────────────────────────────────────────
  app.get('/ocupacao', async (request, reply) => {
    const user = request.user as { id: string; empresaId: string }
    const { depositoId } = ocupacaoQuerySchema.parse(request.query)

    // Verificar se depósito existe
    const deposito = await prisma.deposito.findFirst({
      where: { id: depositoId },
    })
    if (!deposito) {
      return reply.status(404).send({ message: 'Depósito não encontrado' })
    }

    // Buscar todos os endereços do depósito
    const enderecos = await prisma.endereco.findMany({
      where: {
        depositoId,
        tipo: { in: ['ARMAZENAGEM', 'LIVRE', 'BLOQUEADO'] },
      },
      include: {
        saldos: {
          where: { quantidade: { gt: 0 } },
          include: { produto: { select: { id: true, nome: true } } },
        },
        estrutura: { select: { capacidade: true } },
      },
      orderBy: [{ codigoRua: 'asc' }, { codigoPredio: 'asc' }, { codigoNivel: 'asc' }, { codigoApto: 'asc' }],
    })

    // Para cada endereço, calcular ocupação
    const resultado = await Promise.all(
      enderecos.map(async (endereco) => {
        const saldoTotal = endereco.saldos.reduce((acc, s) => acc + Number(s.quantidade), 0)

        // Calcular capacidade: tentar via SKU master do produto no endereço, senão via estrutura
        let capacidadePalete = 0
        if (endereco.saldos.length > 0) {
          const produtoId = endereco.saldos[0].produtoId
          const skuMasterProduto = await prisma.sku.findFirst({
            where: { produtoId, lastro: { not: null }, camada: { not: null } },
            orderBy: { sequencia: 'desc' },
          })
          if (skuMasterProduto?.lastro && skuMasterProduto?.camada) {
            capacidadePalete = skuMasterProduto.lastro * skuMasterProduto.camada
          }
        }

        if (capacidadePalete === 0 && endereco.estrutura?.capacidade) {
          capacidadePalete = Number(endereco.estrutura.capacidade)
        }

        // Classificar status
        let status: 'VAZIO' | 'PARCIAL' | 'CHEIO' | 'BLOQUEADO'
        if (!endereco.status) {
          status = 'BLOQUEADO'
        } else if (saldoTotal === 0) {
          status = 'VAZIO'
        } else if (capacidadePalete > 0 && saldoTotal >= capacidadePalete) {
          status = 'CHEIO'
        } else if (saldoTotal > 0) {
          status = 'PARCIAL'
        } else {
          status = 'VAZIO'
        }

        const percentualOcupacao = capacidadePalete > 0
          ? Math.min((saldoTotal / capacidadePalete) * 100, 100)
          : 0

        // Produto info (primeiro saldo)
        const primeiroProduto = endereco.saldos.length > 0
          ? {
              id: endereco.saldos[0].produto.id,
              nome: endereco.saldos[0].produto.nome,
              quantidade: Number(endereco.saldos[0].quantidade),
              lote: endereco.saldos[0].lote ?? undefined,
            }
          : undefined

        // Determinar área de armazenagem (PICKING ou PULMAO)
        const areaArmazenagem: 'PICKING' | 'PULMAO' =
          endereco.areaArmazenagem === 'PICKING' ? 'PICKING' : 'PULMAO'

        return {
          id: endereco.id,
          enderecoCompleto: endereco.enderecoCompleto ?? '',
          rua: endereco.codigoRua ?? '',
          predio: endereco.codigoPredio ?? '',
          nivel: endereco.codigoNivel ?? '',
          apartamento: endereco.codigoApto ?? '',
          status,
          areaArmazenagem,
          percentualOcupacao: Math.round(percentualOcupacao * 100) / 100,
          capacidadePalete,
          saldoAtual: saldoTotal,
          produto: primeiroProduto,
        }
      }),
    )

    return { enderecos: resultado }
  })
}

// ── Helper: Cadeia de Prioridade ───────────────────────────────────────

interface CadeiaPrioridadeInput {
  produtoId: string
  empresaId: string
  quantidadeMaster: number
  dadosArmazenagem: {
    enderecoFixoId: string | null
    nivelMinPP: number
    nivelMaxPP: number
  } | null
  predioOrigem: number
  ruaOrigem: string
  nivelMin: number
  nivelMax: number
  skuMaster: SkuInfo
  skuMasterRaw: { largura: any; altura: any; comprimento: any; volume: any; pesoBruto: any }
  dadosPickingConfigs: DadosPickingConfig[]
}

async function executarCadeiaPrioridade(input: CadeiaPrioridadeInput): Promise<DistribuicaoResult> {
  const {
    produtoId, empresaId, quantidadeMaster, dadosArmazenagem,
    predioOrigem, ruaOrigem, nivelMin, nivelMax, skuMaster, skuMasterRaw,
    dadosPickingConfigs,
  } = input

  // ── Abastecimento do Picking (Task 4.3) ──────────────────────────────
  // Invocar calcularAbastecimentoPicking ANTES do motor de distribuição.
  // A quantidade passada ao motor será reduzida pela alocação no picking.
  let alocacoesPicking: AlocacaoPicking[] = []
  let quantidadeAbastecidaPicking = 0
  let quantidadeParaMotor = quantidadeMaster
  let pickingInfo: { capacidadeTotal: number; saldoResultante: number; quantidadeAbastecida: number } | undefined

  try {
    if (dadosPickingConfigs.length > 0) {
      const resultadoPicking = calcularAbastecimentoPicking({
        quantidadeRestante: quantidadeMaster,
        dadosPicking: dadosPickingConfigs,
      })

      if (!resultadoPicking.sucesso) {
        // Log do erro, graceful degradation: quantidade total → pulmão
        console.error(
          '[abastecimento-picking] Erro no cálculo de picking:',
          resultadoPicking.erro,
        )
        // quantidadeParaMotor permanece = quantidadeMaster
      } else {
        quantidadeAbastecidaPicking = resultadoPicking.resultado.quantidadeAbastecida
        alocacoesPicking = resultadoPicking.resultado.alocacoes
        quantidadeParaMotor = resultadoPicking.resultado.quantidadeRestante

        // Registrar avisos se houver
        if (resultadoPicking.resultado.avisos.length > 0) {
          for (const aviso of resultadoPicking.resultado.avisos) {
            console.warn('[abastecimento-picking]', aviso)
          }
        }

        // Montar pickingInfo se houve abastecimento
        if (quantidadeAbastecidaPicking > 0) {
          const ultimaAlocacao = alocacoesPicking[alocacoesPicking.length - 1]
          pickingInfo = {
            capacidadeTotal: alocacoesPicking.reduce((sum, a) => sum + a.capacidadeTotal, 0),
            saldoResultante: ultimaAlocacao.saldoResultante,
            quantidadeAbastecida: quantidadeAbastecidaPicking,
          }
        }

        // Se picking consumiu TODA a quantidade: retornar apenas alocação picking (completa=true)
        if (quantidadeAbastecidaPicking === quantidadeMaster) {
          return {
            alocacoes: alocacoesPicking.map((a) => ({
              enderecoId: a.enderecoId,
              enderecoCompleto: a.enderecoCompleto,
              rua: '',
              predio: '',
              nivel: '',
              apartamento: '',
              quantidadeAlocada: a.quantidadeAlocada,
              areaArmazenagem: 'PICKING' as const,
            })),
            quantidadeTotal: quantidadeMaster,
            quantidadeAlocada: quantidadeAbastecidaPicking,
            quantidadeRestante: 0,
            completa: true,
            pickingInfo,
          } as any
        }
      }
    }
  } catch (err) {
    // Erro inesperado — graceful degradation: quantidade total → pulmão
    console.error('[abastecimento-picking] Erro inesperado no abastecimento picking:', err)
    alocacoesPicking = []
    quantidadeAbastecidaPicking = 0
    quantidadeParaMotor = quantidadeMaster
    pickingInfo = undefined
  }

  const enderecosComCapacidade: EnderecoComCapacidade[] = []
  let quantidadeRestante = quantidadeParaMotor

  // ── Prioridade 1: Endereço fixo ──────────────────────────────────────
  if (dadosArmazenagem?.enderecoFixoId) {
    const enderecoFixo = await prisma.endereco.findFirst({
      where: { id: dadosArmazenagem.enderecoFixoId, status: true },
      include: { estrutura: true },
    })

    if (enderecoFixo) {
      const saldoFixo = await prisma.saldoEndereco.aggregate({
        where: { enderecoId: enderecoFixo.id, quantidade: { gt: 0 } },
        _sum: { quantidade: true },
      })
      const saldoAtual = Number(saldoFixo._sum.quantidade ?? 0)
      const capacidade = calcularCapacidadePalete(
        skuMaster.lastro,
        skuMaster.camada,
        enderecoFixo.estrutura?.capacidade ? Number(enderecoFixo.estrutura.capacidade) : null,
      )
      const disponivel = Math.max(0, capacidade - saldoAtual)

      if (disponivel > 0) {
        enderecosComCapacidade.push({
          id: enderecoFixo.id,
          enderecoCompleto: enderecoFixo.enderecoCompleto ?? '',
          rua: enderecoFixo.codigoRua ?? '',
          predio: enderecoFixo.codigoPredio ?? '',
          nivel: enderecoFixo.codigoNivel ?? '',
          apartamento: enderecoFixo.codigoApto ?? '',
          capacidadePalete: capacidade,
          saldoAtual,
          disponivel,
        })
      }
    }
  }

  // ── Prioridade 2: Consolidação (endereços com saldo do mesmo produto) ──
  const saldosConsolidacao = await prisma.saldoEndereco.findMany({
    where: {
      produtoId,
      quantidade: { gt: 0 },
      endereco: { status: true, tipo: { in: ['ARMAZENAGEM', 'LIVRE'] } },
    },
    include: { endereco: { include: { estrutura: true } } },
  })

  for (const saldo of saldosConsolidacao) {
    // Evitar duplicar endereço fixo
    if (enderecosComCapacidade.some((e) => e.id === saldo.enderecoId)) continue

    const saldoAtual = Number(saldo.quantidade)
    const capacidade = calcularCapacidadePalete(
      skuMaster.lastro,
      skuMaster.camada,
      saldo.endereco.estrutura?.capacidade ? Number(saldo.endereco.estrutura.capacidade) : null,
    )
    const disponivel = Math.max(0, capacidade - saldoAtual)

    if (disponivel > 0) {
      enderecosComCapacidade.push({
        id: saldo.enderecoId,
        enderecoCompleto: saldo.endereco.enderecoCompleto ?? '',
        rua: saldo.endereco.codigoRua ?? '',
        predio: saldo.endereco.codigoPredio ?? '',
        nivel: saldo.endereco.codigoNivel ?? '',
        apartamento: saldo.endereco.codigoApto ?? '',
        capacidadePalete: capacidade,
        saldoAtual,
        disponivel,
      })
    }
  }

  // ── Prioridade 3: Endereços livres ───────────────────────────────────
  const enderecosCandidatos = await prisma.endereco.findMany({
    where: {
      tipo: { in: ['ARMAZENAGEM', 'LIVRE'] },
      status: true,
      saldos: { none: { quantidade: { gt: 0 } } },
    },
    include: { estrutura: true },
  })

  // Buscar CapacidadeNivel para as estruturas envolvidas
  const estruturaIds = Array.from(new Set(enderecosCandidatos.filter((e) => e.estruturaId).map((e) => e.estruturaId!)))
  const capacidadesNivel = await prisma.capacidadeNivel.findMany({
    where: { estruturaId: { in: estruturaIds }, status: true },
  })
  const capacidadeNivelMap = new Map(capacidadesNivel.map((c) => [`${c.estruturaId}_${c.codigoNivel}`, c]))

  // Dimensões do SKU master para validação de cubagem
  const dimensoesSku: DimensoesSku = {
    largura: skuMasterRaw.largura ? Number(skuMasterRaw.largura) : null,
    altura: skuMasterRaw.altura ? Number(skuMasterRaw.altura) : null,
    comprimento: skuMasterRaw.comprimento ? Number(skuMasterRaw.comprimento) : null,
    volume: skuMasterRaw.volume ? Number(skuMasterRaw.volume) : null,
    pesoBruto: skuMasterRaw.pesoBruto ? Number(skuMasterRaw.pesoBruto) : null,
  }

  // Filtrar por cubagem e montar candidatos para proximidade
  const candidatosProximidade: EnderecoCandidate[] = []

  for (const endereco of enderecosCandidatos) {
    // Evitar duplicar endereços já incluídos
    if (enderecosComCapacidade.some((e) => e.id === endereco.id)) continue

    const dimensoesEstrutura: DimensoesEstrutura = {
      largura: endereco.estrutura?.largura ? Number(endereco.estrutura.largura) : null,
      altura: endereco.estrutura?.altura ? Number(endereco.estrutura.altura) : null,
      comprimento: endereco.estrutura?.comprimento ? Number(endereco.estrutura.comprimento) : null,
      cubagem: endereco.estrutura?.cubagem ? Number(endereco.estrutura.cubagem) : null,
    }

    const capNivelKey = `${endereco.estruturaId}_${endereco.codigoNivel}`
    const capNivel = capacidadeNivelMap.get(capNivelKey)
    const capacidadeNivelConfig: CapacidadeNivelConfig | null = capNivel
      ? {
          pesoMaximo: capNivel.pesoMaximo ? Number(capNivel.pesoMaximo) : null,
          volumeMaximo: capNivel.volumeMaximo ? Number(capNivel.volumeMaximo) : null,
          paletesMaximo: capNivel.paletesMaximo,
        }
      : null

    // Validar cubagem
    const cubagemResult = validarCubagem({
      sku: dimensoesSku,
      estrutura: dimensoesEstrutura,
      capacidadeNivel: capacidadeNivelConfig,
      quantidadeDesejada: quantidadeMaster,
      saldoAtualPeso: 0,
      saldoAtualVolume: 0,
    })

    if (!cubagemResult.cabe) continue

    candidatosProximidade.push({
      id: endereco.id,
      rua: endereco.codigoRua ?? '',
      predio: parseInt(endereco.codigoPredio || '1', 10) || 1,
      nivel: parseInt(endereco.codigoNivel || '1', 10) || 1,
      apartamento: parseInt(endereco.codigoApto || '1', 10) || 1,
      enderecoCompleto: endereco.enderecoCompleto ?? '',
      estruturaId: endereco.estruturaId,
      classificacaoProdutoId: endereco.classificacaoProdutoId,
    })
  }

  // Ordenar por proximidade
  const ordenados = ordenarPorProximidade({
    candidatos: candidatosProximidade,
    predioOrigem,
    ruaOrigem,
    nivelMin,
    nivelMax,
  })

  // Montar EnderecoComCapacidade para os endereços livres ordenados
  for (const candidato of ordenados) {
    const enderecoOriginal = enderecosCandidatos.find((e) => e.id === candidato.id)!
    const capacidade = calcularCapacidadePalete(
      skuMaster.lastro,
      skuMaster.camada,
      enderecoOriginal.estrutura?.capacidade ? Number(enderecoOriginal.estrutura.capacidade) : null,
    )

    if (capacidade > 0) {
      enderecosComCapacidade.push({
        id: candidato.id,
        enderecoCompleto: candidato.enderecoCompleto,
        rua: candidato.rua,
        predio: enderecoOriginal.codigoPredio ?? '',
        nivel: enderecoOriginal.codigoNivel ?? '',
        apartamento: enderecoOriginal.codigoApto ?? '',
        capacidadePalete: capacidade,
        saldoAtual: 0,
        disponivel: capacidade,
      })
    }
  }

  // ── Calcular distribuição (motor de distribuição para pulmão) ────────
  // Se quantidadeAbastecidaPicking === 0: invocar motor com quantidade total original
  // Se quantidadeAbastecidaPicking > 0 e quantidadeParaMotor > 0: invocar motor com quantidadeRestante
  // Se quantidadeAbastecidaPicking === quantidadeMaster: já retornou acima (não chega aqui)
  let resultadoMotor: DistribuicaoResult | null = null

  try {
    resultadoMotor = calcularDistribuicao({
      quantidade: quantidadeParaMotor,
      enderecosOrdenados: enderecosComCapacidade,
    })
  } catch (err) {
    // Se motor de distribuição falha após picking: retornar resultado parcial com picking + restante
    console.error('[enderecamento-inteligente] Erro no motor de distribuição:', err)

    if (quantidadeAbastecidaPicking > 0) {
      // Retornar resultado parcial com picking + quantidade restante não alocada
      const alocacoesPickingFormatadas = alocacoesPicking.map((a) => ({
        enderecoId: a.enderecoId,
        enderecoCompleto: a.enderecoCompleto,
        rua: '',
        predio: '',
        nivel: '',
        apartamento: '',
        quantidadeAlocada: a.quantidadeAlocada,
        areaArmazenagem: 'PICKING' as const,
      }))

      return {
        alocacoes: alocacoesPickingFormatadas,
        quantidadeTotal: quantidadeMaster,
        quantidadeAlocada: quantidadeAbastecidaPicking,
        quantidadeRestante: quantidadeParaMotor,
        completa: false,
        pickingInfo,
      } as any
    }

    // Se não houve picking, retornar resultado vazio com erro
    return {
      alocacoes: [],
      quantidadeTotal: quantidadeMaster,
      quantidadeAlocada: 0,
      quantidadeRestante: quantidadeMaster,
      completa: false,
    } as any
  }

  // ── Montar resultado final com picking + pulmão (Task 4.4) ───────────
  // Cada alocação de pulmão recebe campo areaArmazenagem: 'PULMAO'
  const alocacoesPulmaoFormatadas = resultadoMotor.alocacoes.map((a) => ({
    ...a,
    areaArmazenagem: 'PULMAO' as const,
  }))

  if (quantidadeAbastecidaPicking > 0) {
    // Alocação de picking como primeiro item, seguida pelas alocações de pulmão (ordem de proximidade do motor)
    const alocacoesPickingFormatadas = alocacoesPicking.map((a) => ({
      enderecoId: a.enderecoId,
      enderecoCompleto: a.enderecoCompleto,
      rua: '',
      predio: '',
      nivel: '',
      apartamento: '',
      quantidadeAlocada: a.quantidadeAlocada,
      areaArmazenagem: 'PICKING' as const,
    }))

    const todasAlocacoes = [...alocacoesPickingFormatadas, ...alocacoesPulmaoFormatadas]
    const quantidadeAlocadaTotal = quantidadeAbastecidaPicking + resultadoMotor.quantidadeAlocada

    return {
      alocacoes: todasAlocacoes,
      quantidadeTotal: quantidadeMaster,
      quantidadeAlocada: quantidadeAlocadaTotal,
      quantidadeRestante: resultadoMotor.quantidadeRestante,
      completa: resultadoMotor.quantidadeRestante === 0,
      pickingInfo,
    } as any
  }

  // Se não houve abastecimento de picking, retornar resultado do motor com areaArmazenagem: 'PULMAO'
  return {
    alocacoes: alocacoesPulmaoFormatadas,
    quantidadeTotal: resultadoMotor.quantidadeTotal,
    quantidadeAlocada: resultadoMotor.quantidadeAlocada,
    quantidadeRestante: resultadoMotor.quantidadeRestante,
    completa: resultadoMotor.completa,
  }
}
