import { prisma } from '../../lib/prisma'
import { Decimal } from '@prisma/client/runtime/library'

let workerInterval: NodeJS.Timeout | null = null

const INTERVALO_MINUTOS = 60

/**
 * Worker de medição automática diária de ocupação.
 * Executa a cada 60 minutos e verifica se já existe medição para o dia corrente.
 * Para cada ContratoArmazenagem ativo, calcula:
 * - quantidadePallets: posições distintas com saldo > 0 para produtos do cliente
 * - volumeM3: soma do volume dos SKUs em estoque (largura × altura × comprimento em metros)
 * - posicoesOcupadas: endereços distintos com saldo > 0
 *
 * Cria um registro MedicaoOcupacao por contrato/dia (idempotente).
 */
export function startFaturamentoWorker() {
  console.log(`📦 Faturamento Worker iniciado — medição de ocupação a cada ${INTERVALO_MINUTOS} minutos`)

  // Run immediately on start (com delay de 15s para o server carregar)
  setTimeout(() => {
    executarMedicaoDiaria().catch((err) =>
      console.error('[Faturamento Worker] Erro na execução inicial:', err),
    )
  }, 15_000)

  // Then every 60 minutes (checks idempotency internally)
  workerInterval = setInterval(
    () => {
      executarMedicaoDiaria().catch((err) =>
        console.error('[Faturamento Worker] Erro na execução periódica:', err),
      )
    },
    INTERVALO_MINUTOS * 60 * 1000,
  )

  // Evitar que o interval impeça o shutdown do processo
  if (workerInterval.unref) {
    workerInterval.unref()
  }
}

export function stopFaturamentoWorker() {
  if (workerInterval) {
    clearInterval(workerInterval)
    workerInterval = null
    console.log('📦 Faturamento Worker parado')
  }
}

export async function executarMedicaoDiaria() {
  const inicio = Date.now()
  console.log('[Faturamento Worker] Iniciando medição diária de ocupação...')

  try {
    // Buscar todos os contratos ativos (cross-empresa)
    const contratosAtivos = await prisma.contratoArmazenagem.findMany({
      where: { status: 'ATIVO' },
      select: {
        id: true,
        empresaId: true,
        clienteId: true,
      },
    })

    if (contratosAtivos.length === 0) {
      console.log('[Faturamento Worker] Nenhum contrato ativo encontrado. Finalizando.')
      return
    }

    const hoje = new Date()
    hoje.setHours(0, 0, 0, 0)

    let medicoesCriadas = 0
    let medicoesSkipped = 0

    for (const contrato of contratosAtivos) {
      try {
        // Verificar idempotência — se já existe medição para hoje neste contrato, pular
        const medicaoExistente = await prisma.medicaoOcupacao.findFirst({
          where: {
            contratoId: contrato.id,
            empresaId: contrato.empresaId,
            dataMedicao: hoje,
          },
        })

        if (medicaoExistente) {
          medicoesSkipped++
          continue
        }

        // Calcular ocupação para este contrato/cliente
        const medicao = await calcularOcupacaoContrato(
          contrato.empresaId,
          contrato.clienteId,
          contrato.id,
        )

        // Criar registro de medição
        await prisma.medicaoOcupacao.create({
          data: {
            empresaId: contrato.empresaId,
            contratoId: contrato.id,
            clienteId: contrato.clienteId,
            dataMedicao: hoje,
            quantidadePallets: medicao.quantidadePallets,
            volumeM3: medicao.volumeM3,
            posicoesOcupadas: medicao.posicoesOcupadas,
            detalhamento: medicao.detalhamento,
          },
        })

        medicoesCriadas++
      } catch (err) {
        console.error(
          `[Faturamento Worker] Erro ao medir contrato ${contrato.id} (empresa: ${contrato.empresaId}):`,
          err,
        )
      }
    }

    const duracao = ((Date.now() - inicio) / 1000).toFixed(2)
    console.log(
      `[Faturamento Worker] Medição concluída em ${duracao}s — ` +
        `${medicoesCriadas} medições criadas, ${medicoesSkipped} já existentes (skipped).`,
    )
  } catch (err) {
    console.error('[Faturamento Worker] Erro geral na medição diária:', err)
  }
}

/**
 * Calcula a ocupação de um contrato específico.
 * Usa SaldoEndereco para contar posições ocupadas e Sku para calcular volume.
 */
export async function calcularOcupacaoContrato(
  empresaId: string,
  clienteId: string,
  contratoId: string,
): Promise<{
  quantidadePallets: number
  volumeM3: Decimal
  posicoesOcupadas: number
  detalhamento: object
}> {
  // Buscar saldos em endereços para esta empresa com quantidade > 0
  // No modelo 3PL, os saldos pertencem ao cliente via empresa
  const saldos = await prisma.saldoEndereco.findMany({
    where: {
      empresaId,
      quantidade: { gt: 0 },
    },
    select: {
      id: true,
      enderecoId: true,
      produtoId: true,
      quantidade: true,
    },
  })

  // Posições ocupadas = endereços distintos com saldo
  const enderecosOcupados = new Set(saldos.map((s) => s.enderecoId))
  const posicoesOcupadas = enderecosOcupados.size

  // Quantidade de pallets = número de posições com saldo (cada posição = 1 pallet)
  const quantidadePallets = posicoesOcupadas

  // Calcular volume total baseado nos SKUs dos produtos em estoque
  const produtoIds = [...new Set(saldos.map((s) => s.produtoId))]

  let volumeTotal = new Decimal(0)
  const detalhePorProduto: Array<{
    produtoId: string
    quantidade: number
    volumeUnitario: number | null
    volumeTotal: number
  }> = []

  if (produtoIds.length > 0) {
    // Buscar SKUs com dimensões para os produtos em estoque
    const skus = await prisma.sku.findMany({
      where: {
        produtoId: { in: produtoIds },
        status: true,
      },
      select: {
        produtoId: true,
        volume: true,
        largura: true,
        altura: true,
        comprimento: true,
        qtdEmbalagem: true,
      },
    })

    // Criar mapa de volume por produtoId (usa o primeiro SKU encontrado)
    const volumePorProduto = new Map<string, Decimal>()
    for (const sku of skus) {
      if (volumePorProduto.has(sku.produtoId)) continue

      let vol: Decimal | null = null
      if (sku.volume && Number(sku.volume) > 0) {
        // Volume já em m³ (campo volume do SKU)
        vol = new Decimal(sku.volume.toString())
      } else if (sku.largura && sku.altura && sku.comprimento) {
        // Dimensões em metros — calcular volume
        vol = new Decimal(sku.largura.toString())
          .mul(new Decimal(sku.altura.toString()))
          .mul(new Decimal(sku.comprimento.toString()))
      }

      if (vol) {
        volumePorProduto.set(sku.produtoId, vol)
      }
    }

    // Agregar quantidade por produto
    const qtdPorProduto = new Map<string, Decimal>()
    for (const saldo of saldos) {
      const atual = qtdPorProduto.get(saldo.produtoId) || new Decimal(0)
      qtdPorProduto.set(saldo.produtoId, atual.add(new Decimal(saldo.quantidade.toString())))
    }

    // Calcular volume total
    for (const [produtoId, quantidade] of qtdPorProduto) {
      const volUnit = volumePorProduto.get(produtoId)
      const volProduto = volUnit ? new Decimal(volUnit.toString()).mul(quantidade) : new Decimal(0)
      volumeTotal = volumeTotal.add(volProduto)

      detalhePorProduto.push({
        produtoId,
        quantidade: Number(quantidade),
        volumeUnitario: volUnit ? Number(volUnit) : null,
        volumeTotal: Number(volProduto),
      })
    }
  }

  return {
    quantidadePallets,
    volumeM3: volumeTotal,
    posicoesOcupadas,
    detalhamento: {
      totalProdutosDistintos: produtoIds.length,
      totalSaldos: saldos.length,
      produtos: detalhePorProduto,
    },
  }
}

/**
 * Reprocessa medição de ocupação para um contrato em um intervalo de datas.
 * Deleta medições existentes no range e recalcula dia a dia.
 * Usado pelo endpoint POST /api/faturamento/medicoes/reprocessar.
 *
 * Isola erros por dia — um dia falhando não impede os demais.
 */
export async function reprocessarMedicao(
  empresaId: string,
  contratoId: string,
  dataInicio: Date,
  dataFim: Date,
): Promise<{ criadas: number; erros: number; dias: number }> {
  console.log(
    `[Faturamento Worker] Reprocessando medição do contrato ${contratoId} ` +
      `de ${dataInicio.toISOString().slice(0, 10)} a ${dataFim.toISOString().slice(0, 10)}`,
  )

  // Buscar contrato para obter clienteId
  const contrato = await prisma.contratoArmazenagem.findFirst({
    where: { id: contratoId, empresaId },
    select: { id: true, clienteId: true },
  })

  if (!contrato) {
    throw { statusCode: 404, message: 'Contrato não encontrado' }
  }

  // Normalizar datas para meia-noite
  const inicio = new Date(dataInicio)
  inicio.setHours(0, 0, 0, 0)

  const fim = new Date(dataFim)
  fim.setHours(0, 0, 0, 0)

  // Deletar medições existentes no range
  await prisma.medicaoOcupacao.deleteMany({
    where: {
      empresaId,
      contratoId,
      dataMedicao: { gte: inicio, lte: fim },
    },
  })

  // Iterar dia a dia e criar medições
  let criadas = 0
  let erros = 0
  const current = new Date(inicio)

  while (current <= fim) {
    try {
      const medicao = await calcularOcupacaoContrato(
        empresaId,
        contrato.clienteId,
        contratoId,
      )

      await prisma.medicaoOcupacao.create({
        data: {
          empresaId,
          contratoId,
          clienteId: contrato.clienteId,
          dataMedicao: new Date(current),
          quantidadePallets: medicao.quantidadePallets,
          volumeM3: medicao.volumeM3,
          posicoesOcupadas: medicao.posicoesOcupadas,
          detalhamento: medicao.detalhamento,
        },
      })

      criadas++
    } catch (err) {
      console.error(
        `[Faturamento Worker] Erro ao reprocessar dia ${current.toISOString().slice(0, 10)} ` +
          `do contrato ${contratoId}:`,
        err,
      )
      erros++
    }

    current.setDate(current.getDate() + 1)
  }

  const dias = Math.ceil((fim.getTime() - inicio.getTime()) / 86400000) + 1
  console.log(
    `[Faturamento Worker] Reprocessamento concluído: ${criadas} criadas, ${erros} erros, ${dias} dias.`,
  )

  return { criadas, erros, dias }
}
