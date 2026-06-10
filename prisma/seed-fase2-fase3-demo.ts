/**
 * Seed de demonstração — Fase 2 + Fase 3
 *
 * Cria dados de exemplo para todos os módulos novos:
 * FASE 2: Faturamento, Picking Zona, LMS, Pátio, Multi-CD
 * FASE 3: Demanda/Slotting, BI, Wave Planning, Portal 3PL
 *
 * Execução:
 *   npx tsx prisma/seed-fase2-fase3-demo.ts
 */

import { PrismaClient } from '@prisma/client'
import { hashSync } from 'bcryptjs'

const prisma = new PrismaClient()

function daysAgo(n: number): Date {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return d
}

function daysFromNow(n: number): Date {
  const d = new Date()
  d.setDate(d.getDate() + n)
  return d
}

async function main() {
  console.log('🌱 Seed Fase 2 + Fase 3 Demo Data')

  // ── Get existing references ──────────────────────────────────────────────
  const empresa = await prisma.empresa.findFirst({ where: { id: '59512845-a692-4429-ace4-627566065fd4' } })
    || await prisma.empresa.findFirst({ where: { usaWms: true } })
  if (!empresa) throw new Error('Nenhuma empresa WMS encontrada')
  const empresaId = empresa.id

  const produtos = await prisma.produto.findMany({ where: { empresaId }, take: 10 })
  const enderecos = await prisma.endereco.findMany({ where: { empresaId }, take: 20 })
  const usuarios = await prisma.usuario.findMany({ take: 3 })
  const cds = await prisma.centroDistribuicao.findMany({ where: { empresaId } })
  const clientes = await prisma.cliente.findMany({ where: { empresaId }, take: 5 })
  const docas = await prisma.doca.findMany({ where: { empresaId }, take: 3 })
  const ordensServico = await prisma.ordemServicoWms.findMany({ where: { empresaId }, take: 10 })

  const uid = usuarios[0]?.id ?? 'system'
  const cdId = cds[0]?.id

  if (!cdId) { console.warn('⚠ Nenhum CD encontrado. Alguns módulos serão pulados.'); }
  if (produtos.length === 0) { console.warn('⚠ Nenhum produto encontrado.'); }

  // ════════════════════════════════════════════════════════════════════════════
  // FASE 2
  // ════════════════════════════════════════════════════════════════════════════


  // ── 1. FATURAMENTO ─────────────────────────────────────────────────────────
  try {
    console.log('  📄 Faturamento...')
    const clienteId = clientes[0]?.id
    if (!clienteId) throw new Error('Sem clientes')

    const contratos = await Promise.all([
      prisma.contratoArmazenagem.create({
        data: {
          empresaId, clienteId, dataInicio: daysAgo(180), dataFim: daysFromNow(180),
          periodicidade: 'MENSAL', status: 'ATIVO', criadoPorId: uid,
          tarifas: { create: [
            { tipo: 'ARMAZENAGEM_PALLET', valorUnitario: 45.00, descricao: 'Pallet/mês' },
            { tipo: 'MOVIMENTACAO_ENTRADA', valorUnitario: 8.50, descricao: 'Entrada por pallet' },
            { tipo: 'MOVIMENTACAO_SAIDA', valorUnitario: 9.00, descricao: 'Saída por pallet' },
          ] },
        },
      }),
      prisma.contratoArmazenagem.create({
        data: {
          empresaId, clienteId: clientes[1]?.id ?? clienteId,
          dataInicio: daysAgo(90), dataFim: daysFromNow(270),
          periodicidade: 'MENSAL', status: 'ATIVO', criadoPorId: uid,
          tarifas: { create: [
            { tipo: 'ARMAZENAGEM_PALLET', valorUnitario: 52.00, descricao: 'Pallet/mês premium' },
            { tipo: 'MANUSEIO', valorUnitario: 3.50, descricao: 'Manuseio por caixa' },
            { tipo: 'ETIQUETAGEM', valorUnitario: 1.20, descricao: 'Etiquetagem unidade' },
          ] },
        },
      }),
    ])

    // Medições
    for (let i = 0; i < 5; i++) {
      await prisma.medicaoOcupacao.create({
        data: {
          empresaId, contratoId: contratos[0].id, clienteId,
          dataMedicao: daysAgo(30 - i * 7), quantidadePallets: 80 + i * 5,
          volumeM3: 120 + i * 8, posicoesOcupadas: 75 + i * 4,
        },
      })
    }

    // Faturas
    const statusFaturas: Array<{ status: string; numero: string }> = [
      { status: 'GERADA', numero: 'FAT-2024-0001' },
      { status: 'ENVIADA', numero: 'FAT-2024-0002' },
      { status: 'PAGA', numero: 'FAT-2024-0003' },
    ]
    for (const sf of statusFaturas) {
      await prisma.faturaArmazenagem.create({
        data: {
          empresaId, contratoId: contratos[0].id, clienteId,
          numero: sf.numero, periodoInicio: daysAgo(60), periodoFim: daysAgo(30),
          valorTotal: 4250.00, dataVencimento: daysFromNow(15),
          status: sf.status, criadoPorId: uid,
          itens: { create: [
            { tipoTarifa: 'ARMAZENAGEM_PALLET', descricao: 'Armazenagem 85 pallets', quantidade: 85, valorUnitario: 45.00, subtotal: 3825.00 },
            { tipoTarifa: 'MOVIMENTACAO_ENTRADA', descricao: 'Entradas do período', quantidade: 50, valorUnitario: 8.50, subtotal: 425.00 },
          ] },
        },
      })
    }
    console.log('    ✅ Faturamento criado')
  } catch (e: any) { console.error('    ❌ Faturamento:', e.message) }

  // ── 2. PICKING ZONA ────────────────────────────────────────────────────────
  try {
    console.log('  🗺️  Picking Zona...')
    if (!cdId) throw new Error('Sem CD')

    const zonas = await Promise.all([
      prisma.zonaPicking.create({ data: { empresaId, cdId, nome: 'Zona Vermelha - Alimentos', codigo: 'ZN-A', cor: '#FF0000' } }),
      prisma.zonaPicking.create({ data: { empresaId, cdId, nome: 'Zona Verde - Bebidas', codigo: 'ZN-B', cor: '#00FF00' } }),
      prisma.zonaPicking.create({ data: { empresaId, cdId, nome: 'Zona Azul - Higiene', codigo: 'ZN-C', cor: '#0000FF' } }),
    ])

    // Endereços nas zonas (primeiro 6 endereços distribuídos)
    const endSlice = enderecos.slice(0, 6)
    for (let i = 0; i < endSlice.length; i++) {
      await prisma.enderecoZonaPicking.create({
        data: { zonaPickingId: zonas[i % 3].id, enderecoId: endSlice[i].id },
      }).catch(() => {}) // skip duplicates
    }

    // Separadores
    if (usuarios.length >= 2) {
      await prisma.separadorZona.createMany({
        data: [
          { zonaPickingId: zonas[0].id, usuarioId: usuarios[0].id, tipo: 'PRINCIPAL' },
          { zonaPickingId: zonas[1].id, usuarioId: usuarios[1].id, tipo: 'PRINCIPAL' },
        ],
        skipDuplicates: true,
      })
    }

    // Ponto de consolidação
    if (enderecos.length > 6) {
      await prisma.pontoConsolidacao.create({
        data: { empresaId, cdId, nome: 'Consolidação Principal', enderecoId: enderecos[7].id },
      })
    }
    console.log('    ✅ Picking Zona criado')
  } catch (e: any) { console.error('    ❌ Picking Zona:', e.message) }

  // ── 3. LMS (Labor Management) ─────────────────────────────────────────────
  try {
    console.log('  📊 LMS...')
    const tiposOp: Array<{ tipo: string; meta: number; unidade: string }> = [
      { tipo: 'CONFERENCIA', meta: 12.0, unidade: 'PALLET' },
      { tipo: 'ENDERECAMENTO', meta: 8.0, unidade: 'PALLET' },
      { tipo: 'SEPARACAO', meta: 15.0, unidade: 'LINHA' },
      { tipo: 'CARREGAMENTO', meta: 20.0, unidade: 'PALLET' },
      { tipo: 'INVENTARIO', meta: 25.0, unidade: 'POSICAO' },
    ]
    for (const t of tiposOp) {
      await prisma.metaOperacao.create({
        data: {
          empresaId, tipoOperacao: t.tipo, tempoMetaMinutos: t.meta,
          unidadeMedida: t.unidade, toleranciaPercentual: 15, criadoPorId: uid,
        },
      }).catch(() => {})
    }

    // Config Incentivos
    await prisma.configIncentivo.createMany({
      data: [
        { empresaId, faixa: 'ACIMA_META', pontosIncentivo: 10, descricao: 'Acima da meta - bônus' },
        { empresaId, faixa: 'NA_META', pontosIncentivo: 5, descricao: 'Dentro da tolerância' },
        { empresaId, faixa: 'ABAIXO_META', pontosIncentivo: -5, descricao: 'Abaixo da meta' },
      ],
      skipDuplicates: true,
    })

    // Registros de produtividade (precisa de OS existente)
    if (ordensServico.length > 0) {
      const faixas = ['ACIMA_META', 'NA_META', 'ABAIXO_META']
      for (let i = 0; i < Math.min(10, ordensServico.length); i++) {
        const meta = 12 + Math.random() * 8
        const real = meta * (0.7 + Math.random() * 0.6)
        await prisma.registroProdutividade.create({
          data: {
            empresaId, operadorId: uid,
            ordemServicoId: ordensServico[i % ordensServico.length].id,
            tipoOperacao: tiposOp[i % 5].tipo, tempoMetaMinutos: meta,
            tempoRealMinutos: real, tempoPausaMinutos: Math.random() * 5,
            indiceProdutividade: (meta / real) * 100,
            quantidadeItens: 10 + Math.floor(Math.random() * 40),
            faixaDesempenho: faixas[i % 3],
            iniciadoEm: daysAgo(i), concluidoEm: daysAgo(i),
          },
        }).catch(() => {})
      }
    }
    console.log('    ✅ LMS criado')
  } catch (e: any) { console.error('    ❌ LMS:', e.message) }


  // ── 4. PÁTIO (Yard Management) ─────────────────────────────────────────────
  try {
    console.log('  🚛 Pátio...')
    if (!cdId) throw new Error('Sem CD')

    // Config Pátio
    await prisma.configPatio.upsert({
      where: { empresaId_cdId: { empresaId, cdId } },
      update: {},
      create: {
        empresaId, cdId, limitePermMinutos: 240,
        alertaPermAtivo: true, prioridadeAgendado: 10,
        prioridadeDescarga: 5, prioridadeCarga: 3, prioridadePadrao: 1,
      },
    })

    // Veículos
    const placas = ['BRA2E19', 'RIO4F56', 'SPO7G89', 'MGA3H12', 'CWB5J34']
    const motoristas = ['Carlos Silva', 'João Ferreira', 'Ana Santos', 'Pedro Oliveira', 'Maria Costa']
    const statusVeic = ['AGUARDANDO', 'AGUARDANDO', 'AGUARDANDO', 'LIBERADO', 'LIBERADO']

    const veiculos = []
    for (let i = 0; i < 5; i++) {
      const v = await prisma.veiculoPatio.create({
        data: {
          empresaId, cdId, placa: placas[i], motoristaNome: motoristas[i],
          motoristaDocumento: `${String(i + 1).padStart(3, '0')}.456.789-0${i}`,
          tipoOperacao: i < 3 ? 'DESCARGA' : 'CARGA', status: statusVeic[i],
          entradaEm: daysAgo(0), criadoPorId: uid,
          docaId: statusVeic[i] === 'LIBERADO' && docas[i % docas.length] ? docas[i % docas.length].id : undefined,
        },
      })
      veiculos.push(v)
    }

    // Fila para os AGUARDANDO
    for (let i = 0; i < 3; i++) {
      await prisma.filaEsperaPatio.create({
        data: {
          empresaId, cdId, veiculoId: veiculos[i].id,
          posicao: i + 1, prioridade: i === 0 ? 10 : 1,
          justificativaPrioridade: i === 0 ? 'Carga perecível agendada' : undefined,
          entradaFilaEm: daysAgo(0),
        },
      }).catch(() => {})
    }

    // Chamadas de doca
    if (docas.length > 0) {
      await prisma.chamadaDoca.create({
        data: {
          empresaId, veiculoId: veiculos[3].id, docaId: docas[0].id,
          status: 'CHAMADO', chamadoEm: new Date(), chamadoPorId: uid,
        },
      })
      await prisma.chamadaDoca.create({
        data: {
          empresaId, veiculoId: veiculos[4].id, docaId: docas[docas.length > 1 ? 1 : 0].id,
          status: 'ATENDIDO', chamadoEm: daysAgo(0), atendidoEm: new Date(),
          tempoRespostaMin: 7, chamadoPorId: uid,
        },
      })
    }
    console.log('    ✅ Pátio criado')
  } catch (e: any) { console.error('    ❌ Pátio:', e.message) }

  // ── 5. MULTI-CD ────────────────────────────────────────────────────────────
  try {
    console.log('  🔄 Multi-CD...')
    if (cds.length < 2) throw new Error('Menos de 2 CDs. Pulando Multi-CD.')

    const statusTransf: Array<{ status: string; numero: string }> = [
      { status: 'PENDENTE', numero: 'TRF-2024-0001' },
      { status: 'APROVADA', numero: 'TRF-2024-0002' },
    ]
    for (const st of statusTransf) {
      const prodSlice = produtos.slice(0, 2)
      await prisma.solicitacaoTransferencia.create({
        data: {
          empresaId, numero: st.numero,
          cdOrigemId: cds[0].id, cdDestinoId: cds[1].id,
          motivo: st.status === 'PENDENTE' ? 'Reabastecimento estoque mínimo' : 'Balanceamento de carga entre CDs',
          prioridade: st.status === 'PENDENTE' ? 'ALTA' : 'NORMAL',
          status: st.status, criadoPorId: uid,
          aprovadoPorId: st.status === 'APROVADA' ? uid : undefined,
          aprovadoEm: st.status === 'APROVADA' ? new Date() : undefined,
          itens: { create: prodSlice.map((p, idx) => ({
            produtoId: p.id,
            quantidadeSolicitada: 50 + idx * 25,
          })) },
        },
      })
    }
    console.log('    ✅ Multi-CD criado')
  } catch (e: any) { console.error('    ❌ Multi-CD:', e.message) }

  // ════════════════════════════════════════════════════════════════════════════
  // FASE 3
  // ════════════════════════════════════════════════════════════════════════════

  // ── 6. DEMANDA / SLOTTING ──────────────────────────────────────────────────
  try {
    console.log('  📈 Demanda & Slotting...')

    // Config Previsão
    await prisma.configPrevisao.upsert({
      where: { empresaId },
      update: {},
      create: {
        empresaId, periodoHistoricoDias: 90, metodoPreferido: 'MEDIA_MOVEL',
        frequenciaAtualizacao: 'DIARIA', estoqueSegurancaDias: 7,
      },
    })

    // Previsões de demanda (top 5 produtos × 4 datas)
    const topProd = produtos.slice(0, 5)
    for (const prod of topProd) {
      for (let d = 0; d < 4; d++) {
        await prisma.previsaoDemanda.create({
          data: {
            empresaId, produtoId: prod.id, dataPrevisao: daysFromNow(7 * (d + 1)),
            quantidadePrevista: 100 + Math.floor(Math.random() * 200),
            metodo: d % 2 === 0 ? 'MEDIA_MOVEL' : 'SAZONAL',
            horizonte: 14, confianca: 75 + Math.floor(Math.random() * 20),
          },
        }).catch(() => {})
      }
    }

    // Classificação ABC (10 produtos)
    const classifProd = produtos.slice(0, 10)
    const classesDist = ['A', 'A', 'A', 'B', 'B', 'B', 'C', 'C', 'C', 'C']
    for (let i = 0; i < classifProd.length; i++) {
      await prisma.classificacaoAbc.create({
        data: {
          empresaId, produtoId: classifProd[i].id, criterio: 'FREQUENCIA',
          classificacao: classesDist[i], valor: 10000 - i * 800,
          percentualAcumulado: (i + 1) * 10, periodoInicio: daysAgo(90), periodoFim: new Date(),
        },
      }).catch(() => {})
    }

    // Sugestões Slotting
    const statusSlot = ['PENDENTE', 'PENDENTE', 'PENDENTE', 'APLICADA', 'REJEITADA']
    for (let i = 0; i < 5 && i < produtos.length && enderecos.length > i + 5; i++) {
      await prisma.sugestaoSlotting.create({
        data: {
          empresaId, produtoId: produtos[i].id,
          enderecoAtualId: enderecos[i]?.id, enderecoSugeridoId: enderecos[i + 5].id,
          motivo: `Produto curva ${classesDist[i]} com alta frequência - mover para zona picking`,
          prioridade: i < 2 ? 'ALTA' : 'MEDIA', score: 85 - i * 10,
          status: statusSlot[i],
          aplicadaEm: statusSlot[i] === 'APLICADA' ? new Date() : undefined,
          aplicadaPorId: statusSlot[i] === 'APLICADA' ? uid : undefined,
        },
      }).catch(() => {})
    }
    console.log('    ✅ Demanda & Slotting criado')
  } catch (e: any) { console.error('    ❌ Demanda/Slotting:', e.message) }


  // ── 7. BI (Business Intelligence) ──────────────────────────────────────────
  try {
    console.log('  📊 BI...')

    // Config Custo
    await prisma.configCusto.upsert({
      where: { empresaId },
      update: {},
      create: {
        empresaId, custoHoraOperador: 35.00, custoHoraEquipamento: 50.00,
        custoM2Mes: 25.00, depreciacao: 5.00,
      },
    })

    // Snapshots BI (30 dias × 4 indicadores)
    const indicadores = ['THROUGHPUT', 'ACURACIA', 'OCUPACAO', 'PRODUTIVIDADE_MEDIA']
    for (let d = 0; d < 30; d++) {
      for (const ind of indicadores) {
        const baseVal = ind === 'THROUGHPUT' ? 150 : ind === 'ACURACIA' ? 97 : ind === 'OCUPACAO' ? 72 : 88
        await prisma.snapshotBI.create({
          data: {
            empresaId, data: daysAgo(30 - d), indicador: ind,
            valor: baseVal + (Math.random() * 10 - 5),
          },
        }).catch(() => {})
      }
    }

    // Custos de operação (7 dias)
    const opsBI = ['RECEBIMENTO', 'ENDERECAMENTO', 'SEPARACAO', 'EXPEDICAO', 'INVENTARIO', 'SEPARACAO', 'RECEBIMENTO']
    for (let d = 0; d < 7; d++) {
      const custoMO = 800 + Math.random() * 400
      const custoEq = 300 + Math.random() * 200
      const custoEsp = 150 + Math.random() * 100
      await prisma.custoOperacao.create({
        data: {
          empresaId, data: daysAgo(7 - d), tipoOperacao: opsBI[d],
          custoMaoObra: custoMO, custoEquipamento: custoEq, custoEspaco: custoEsp,
          custoTotal: custoMO + custoEq + custoEsp,
          quantidadeOperacoes: 20 + Math.floor(Math.random() * 30),
          custoUnitario: (custoMO + custoEq + custoEsp) / (20 + Math.floor(Math.random() * 30)),
        },
      }).catch(() => {})
    }

    // Alertas de correlação
    await prisma.alertaCorrelacao.create({
      data: {
        empresaId, tipo: 'CORRELACAO', indicador1: 'THROUGHPUT', valor1: 120,
        indicador2: 'PRODUTIVIDADE_MEDIA', valor2: 72,
        mensagem: 'Queda de throughput correlacionada com baixa produtividade. Verificar escala de operadores no turno noturno.',
        severidade: 'ALTA', status: 'ABERTO',
      },
    })
    await prisma.alertaCorrelacao.create({
      data: {
        empresaId, tipo: 'ANOMALIA', indicador1: 'OCUPACAO', valor1: 95,
        mensagem: 'Ocupação acima de 95% por 3 dias consecutivos. Risco de bloqueio de recebimento.',
        severidade: 'MEDIA', status: 'RESOLVIDO', resolvidoEm: daysAgo(2),
      },
    })
    console.log('    ✅ BI criado')
  } catch (e: any) { console.error('    ❌ BI:', e.message) }

  // ── 8. WAVE PLANNING ───────────────────────────────────────────────────────
  try {
    console.log('  🌊 Wave Planning...')

    // Regras de onda
    await prisma.regraOnda.createMany({
      data: [
        {
          empresaId, nome: 'Corte Horário 14h', prioridade: 1, tipo: 'CORTE_HORARIO',
          parametros: { horaCorte: '14:00', antecedenciaMin: 30 },
        },
        {
          empresaId, nome: 'Agrupamento por Rota', prioridade: 2, tipo: 'AGRUPAMENTO_ROTA',
          parametros: { maxPedidosPorOnda: 50, agruparPorUf: true },
        },
        {
          empresaId, nome: 'Capacidade Doca', prioridade: 3, tipo: 'CAPACIDADE_DOCA',
          parametros: { maxOndasSimultaneas: 3, pesoMaxKg: 15000 },
        },
      ],
    })

    // Planejamento com simulações
    const planej = await prisma.planejamentoOnda.create({
      data: {
        empresaId, dataReferencia: daysFromNow(1), status: 'SIMULADO',
        totalOndas: 3, totalPedidos: 42, totalItens: 186, geradoEm: new Date(),
      },
    })

    const hojeBase = new Date()
    hojeBase.setHours(6, 0, 0, 0)
    for (let i = 0; i < 3; i++) {
      const inicio = new Date(hojeBase.getTime() + i * 2 * 60 * 60 * 1000)
      const fim = new Date(inicio.getTime() + 90 * 60 * 1000)
      await prisma.simulacaoOnda.create({
        data: {
          planejamentoOndaId: planej.id, ondaNumero: i + 1,
          docaId: docas[i % docas.length]?.id,
          totalPedidos: 12 + i * 3, totalItens: 55 + i * 10,
          horaInicioEstimada: inicio, horaFimEstimada: fim,
          cargaKg: 4500 + i * 1200, volumeM3: 18 + i * 6,
        },
      })
    }
    console.log('    ✅ Wave Planning criado')
  } catch (e: any) { console.error('    ❌ Wave Planning:', e.message) }

  // ── 9. PORTAL 3PL ─────────────────────────────────────────────────────────
  try {
    console.log('  🌐 Portal 3PL...')
    const clienteId = clientes[0]?.id
    if (!clienteId) throw new Error('Sem clientes')

    const senhaHash = hashSync('portal123', 10)

    const portalUsers = await Promise.all([
      prisma.portalUsuario.create({
        data: {
          empresaId, clienteId, nome: 'Roberto Almeida',
          email: 'roberto.almeida@logistica.com.br', senhaHash, status: 'ATIVO',
        },
      }),
      prisma.portalUsuario.create({
        data: {
          empresaId, clienteId: clientes[1]?.id ?? clienteId,
          nome: 'Fernanda Souza', email: 'fernanda.souza@transporte.com.br',
          senhaHash, status: 'ATIVO',
        },
      }),
    ])

    // Notificações
    const notifData: Array<{ tipo: string; titulo: string; msg: string }> = [
      { tipo: 'FATURA_GERADA', titulo: 'Nova fatura disponível', msg: 'A fatura FAT-2024-0001 no valor de R$ 4.250,00 foi gerada e está disponível para download.' },
      { tipo: 'CONTRATO_VENCENDO', titulo: 'Contrato próximo do vencimento', msg: 'Seu contrato de armazenagem vence em 30 dias. Entre em contato para renovação.' },
      { tipo: 'EXPEDICAO_CONCLUIDA', titulo: 'Expedição concluída', msg: 'A solicitação SOL-2024-000012 foi expedida. 45 volumes despachados via transportadora.' },
    ]
    for (let i = 0; i < notifData.length; i++) {
      await prisma.notificacaoPortal.create({
        data: {
          empresaId, clienteId, portalUsuarioId: portalUsers[0].id,
          tipo: notifData[i].tipo, titulo: notifData[i].titulo,
          mensagem: notifData[i].msg, lida: i === 2, enviadaEmail: true,
        },
      })
    }
    console.log('    ✅ Portal 3PL criado')
  } catch (e: any) { console.error('    ❌ Portal 3PL:', e.message) }
}

main()
  .then(() => { console.log('\n✅ Seed Fase 2 + Fase 3 concluído com sucesso!'); process.exit(0) })
  .catch((e) => { console.error('❌ Erro fatal:', e); process.exit(1) })
  .finally(() => prisma.$disconnect())
