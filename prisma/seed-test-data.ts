import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  console.log('🌱 Criando dados de teste completos...\n')

  // Buscar empresa e entidades base
  const empresa = await prisma.empresa.findFirst()
  if (!empresa) throw new Error('Execute prisma/seed.ts primeiro')

  const produtos = await prisma.produto.findMany({ where: { empresaId: empresa.id } })
  const clientes = await prisma.cliente.findMany({ where: { empresaId: empresa.id } })
  const fornecedores = await prisma.fornecedor.findMany({ where: { empresaId: empresa.id } })
  const enderecos = await prisma.endereco.findMany({ take: 24 })
  const docas = await prisma.doca.findMany({ take: 4 })
  const funcionarios = await prisma.funcionario.findMany({ take: 4 })
  const tabela = await prisma.tabelaPreco.findFirst({ where: { empresaId: empresa.id } })

  if (!tabela) throw new Error('Tabela de preço não encontrada')
  if (produtos.length < 10) throw new Error('Produtos insuficientes')

  // ============================================================================
  // 1. SKUs PARA TODOS OS PRODUTOS
  // ============================================================================
  const skuData = [
    { idx: 0, cod: '7891234000011', un: 'UN', qtdEmb: 1, larg: 0.20, alt: 0.08, comp: 0.35, peso: 5.0, lastro: 5, camada: 4 },
    { idx: 1, cod: '7891234000022', un: 'UN', qtdEmb: 1, larg: 0.12, alt: 0.05, comp: 0.20, peso: 1.0, lastro: 8, camada: 6 },
    { idx: 2, cod: '7891234000033', un: 'UN', qtdEmb: 1, larg: 0.08, alt: 0.25, comp: 0.08, peso: 0.9, lastro: 10, camada: 5 },
    { idx: 3, cod: '7891234000044', un: 'UN', qtdEmb: 1, larg: 0.12, alt: 0.04, comp: 0.18, peso: 1.0, lastro: 8, camada: 6 },
    { idx: 4, cod: '7891234000055', un: 'UN', qtdEmb: 1, larg: 0.12, alt: 0.04, comp: 0.18, peso: 1.0, lastro: 8, camada: 6 },
    { idx: 5, cod: '7891234000066', un: 'UN', qtdEmb: 1, larg: 0.07, alt: 0.22, comp: 0.07, peso: 1.05, lastro: 12, camada: 4 },
    { idx: 6, cod: '7891234000077', un: 'UN', qtdEmb: 1, larg: 0.10, alt: 0.15, comp: 0.10, peso: 0.5, lastro: 10, camada: 5 },
    { idx: 7, cod: '7891234000088', un: 'UN', qtdEmb: 1, larg: 0.08, alt: 0.25, comp: 0.08, peso: 0.5, lastro: 12, camada: 6 },
    { idx: 8, cod: '7891234000099', un: 'UN', qtdEmb: 1, larg: 0.10, alt: 0.04, comp: 0.15, peso: 1.0, lastro: 10, camada: 8 },
    { idx: 9, cod: '7891234000100', un: 'UN', qtdEmb: 1, larg: 0.07, alt: 0.12, comp: 0.07, peso: 0.34, lastro: 15, camada: 6 },
  ]

  for (const s of skuData) {
    const vol = s.larg * s.alt * s.comp
    await prisma.sku.upsert({
      where: { id: `sku-${produtos[s.idx].id}-1` },
      update: {},
      create: {
        id: `sku-${produtos[s.idx].id}-1`,
        produtoId: produtos[s.idx].id,
        sequencia: 1,
        descricao: `${produtos[s.idx].nome} - Unidade`,
        codigoBarra: s.cod,
        unidade: s.un,
        qtdEmbalagem: s.qtdEmb,
        largura: s.larg,
        altura: s.alt,
        comprimento: s.comp,
        volume: parseFloat(vol.toFixed(6)),
        pesoLiquido: s.peso,
        pesoBruto: s.peso * 1.02,
        pesoPalete: s.peso * s.lastro * s.camada + 25,
        lastro: s.lastro,
        camada: s.camada,
        tipoPalete: 'PBR',
        empresaId: empresa.id,
      },
    })
  }
  console.log('✅ 10 SKUs criados com dimensões e pesos')

  // ============================================================================
  // 2. DADOS LOGÍSTICOS
  // ============================================================================
  for (let i = 0; i < produtos.length; i++) {
    const p = produtos[i]
    // Armazenagem
    await prisma.dadosLogisticosArmazenagem.create({
      data: {
        produtoId: p.id, skuSeq: 1, sequencia: 1,
        enderecoFixoId: enderecos[i]?.id || null,
        tipoNorma: i < 5 ? 'FEFO' : 'FIFO',
        pulmaoRegulador: 2,
        nivelMinPP: 10, nivelMaxPP: 50, nivelMaxBlocado: 3,
        fixo: i < 3,
      },
    }).catch(() => {})

    // Picking
    await prisma.dadosLogisticosPicking.create({
      data: {
        produtoId: p.id, skuSeq: 1, sequencia: 1,
        enderecoPickingId: enderecos[i + 10]?.id || null,
        tipoPicking: i % 3 === 0 ? 'FLOW_RACK' : 'NORMAL',
        capacidade: [200, 150, 300, 250, 180, 400, 100, 200, 150, 300][i],
        pontoReposicao: [50, 40, 80, 60, 45, 100, 25, 50, 40, 80][i],
        pontoReposicaoPercent: 25,
        pontoReposicaoDias: 3,
      },
    }).catch(() => {})

    // Expedição
    await prisma.dadosLogisticosExpedicao.create({
      data: {
        produtoId: p.id, skuSeq: 1,
        fracionado: i > 5,
        absorbePaleteFechado: i < 4,
        absorbePaleteFechadoCx: false,
        tipoProduto: 'ALIMENTO',
      },
    }).catch(() => {})
  }
  console.log('✅ Dados logísticos (armazenagem, picking, expedição) criados para 10 produtos')

  // ============================================================================
  // 3. PEDIDOS DE COMPRA (10 totais — já existem 2 do seed base)
  // ============================================================================
  const maxNumPC = (await prisma.pedidoCompra.findFirst({ where: { empresaId: empresa.id }, orderBy: { numero: 'desc' } }))?.numero || 0

  for (let i = 1; i <= 8; i++) {
    const forn = fornecedores[i % fornecedores.length]
    const prods = produtos.slice((i * 2) % 8, ((i * 2) % 8) + 3)
    await prisma.pedidoCompra.create({
      data: {
        empresaId: empresa.id,
        numero: maxNumPC + i,
        fornecedorId: forn.id,
        dataEntrega: new Date(Date.now() + (i + 3) * 24 * 60 * 60 * 1000),
        valorTotal: prods.reduce((s, p) => s + Number(p.precoBase) * 100, 0),
        status: ['RASCUNHO', 'CONFIRMADO', 'CONFIRMADO', 'RASCUNHO', 'CONFIRMADO', 'RASCUNHO', 'CONFIRMADO', 'CONFIRMADO'][i - 1],
        itens: {
          create: prods.map((p, idx) => ({
            produtoId: p.id,
            quantidade: 100 + idx * 50,
            precoUnitario: Number(p.precoBase) * 0.85,
            classificacao: 'REVENDA',
            valorTotal: Number(p.precoBase) * 0.85 * (100 + idx * 50),
          })),
        },
      },
    })
  }
  console.log('✅ 8 pedidos de compra adicionais (total ~10)')

  // ============================================================================
  // 4. PEDIDOS DE VENDA (10 totais — já existem 3 do seed base)
  // ============================================================================
  const maxNumPV = (await prisma.pedidoVenda.findFirst({ where: { empresaId: empresa.id }, orderBy: { numero: 'desc' } }))?.numero || 0

  for (let i = 1; i <= 7; i++) {
    const cli = clientes[i % clientes.length]
    const prods = produtos.slice(i % 7, (i % 7) + 3)
    await prisma.pedidoVenda.create({
      data: {
        empresaId: empresa.id,
        numero: maxNumPV + i,
        clienteId: cli.id,
        tabelaPrecoId: tabela.id,
        valorTotal: prods.reduce((s, p) => s + Number(p.precoBase) * 30, 0),
        status: ['CONFIRMADO', 'EM_SEPARACAO', 'RASCUNHO', 'CONFIRMADO', 'EM_SEPARACAO', 'CONFIRMADO', 'RASCUNHO'][i - 1],
        itens: {
          create: prods.map((p, idx) => ({
            produtoId: p.id,
            quantidade: 30 + idx * 10,
            precoBase: Number(p.precoBase),
            precoFinal: Number(p.precoBase),
            valorTotal: Number(p.precoBase) * (30 + idx * 10),
          })),
        },
      },
    })
  }
  console.log('✅ 7 pedidos de venda adicionais (total ~10)')

  // ============================================================================
  // 5. WMS - AGENDA (10 totais — já existem 4 do seed base)
  // ============================================================================
  const hoje = new Date()
  hoje.setHours(0, 0, 0, 0)

  for (let i = 1; i <= 6; i++) {
    const data = new Date(hoje)
    data.setDate(data.getDate() + i)
    await prisma.agendaWms.create({
      data: {
        empresaId: empresa.id,
        fornecedorId: fornecedores[i % fornecedores.length].id,
        docaId: docas[i % docas.length].id,
        dataPrevista: data,
        horaInicio: `${8 + (i % 4) * 2}:00`,
        horaFim: `${10 + (i % 4) * 2}:00`,
        motorista: ['Antonio Souza', 'Fernando Lima', 'Ricardo Mendes', 'Paulo Costa', 'Marcos Alves', 'João Ferreira'][i - 1],
        placa: ['JKL2M34', 'NOP5Q67', 'RST8U90', 'VWX1Y23', 'BCD4E56', 'FGH7I89'][i - 1],
        tipoVeiculo: ['Baú', 'Sider', 'Truck', 'VUC', 'Baú', 'Sider'][i - 1],
        qtdCaixas: 20 + i * 10,
        qtdPaletes: i + 2,
        status: ['AGENDADO', 'CONFIRMADO', 'AGENDADO', 'CONFIRMADO', 'AGENDADO', 'AGENDADO'][i - 1],
      },
    })
  }
  console.log('✅ 6 agendamentos adicionais (total ~10)')

  // ============================================================================
  // 6. WMS - NOTAS DE ENTRADA + CONFERÊNCIA (OrdemServicoWms)
  // ============================================================================
  for (let i = 1; i <= 10; i++) {
    const forn = fornecedores[i % fornecedores.length]
    const nota = await prisma.notaEntrada.create({
      data: {
        numero: 1000 + i,
        serie: '1',
        fornecedor: forn.razaoSocial,
        fornecedorDoc: forn.cnpj,
        dataEmissao: new Date(Date.now() - i * 24 * 60 * 60 * 1000),
        tipo: 'COMPRA',
        status: i <= 5 ? 'CONFERIDO' : 'PENDENTE',
        empresaId: empresa.id,
        itens: {
          create: produtos.slice((i - 1) % 7, ((i - 1) % 7) + 3).map((p, idx) => ({
            item: idx + 1,
            descricao: p.nome,
            codigoProduto: p.codigo,
            unidade: 'UN',
            quantidade: 50 + idx * 25,
          })),
        },
      },
    })

    // Criar OS de conferência para notas conferidas
    if (i <= 5) {
      await prisma.ordemServicoWms.create({
        data: {
          empresaId: empresa.id,
          numero: 100 + i,
          tipo: 'ENTRADA',
          operacao: 'CONFERENCIA',
          status: 'CONCLUIDO',
          notaEntradaId: nota.id,
          funcionarioId: funcionarios[1]?.id,
          horaInicio: new Date(Date.now() - i * 20 * 60 * 1000),
          horaFim: new Date(Date.now() - i * 10 * 60 * 1000),
        },
      })
    }
  }
  console.log('✅ 10 notas de entrada + 5 ordens de conferência')

  // ============================================================================
  // 7. WMS - ENDEREÇAMENTO (OrdemServicoWms com operacao ENDERECAMENTO)
  // ============================================================================
  for (let i = 1; i <= 10; i++) {
    await prisma.ordemServicoWms.create({
      data: {
        empresaId: empresa.id,
        numero: 200 + i,
        tipo: 'ENTRADA',
        operacao: 'ENDERECAMENTO',
        status: i <= 7 ? 'CONCLUIDO' : 'ABERTO',
        funcionarioId: funcionarios[0]?.id,
        horaInicio: i <= 7 ? new Date(Date.now() - i * 30 * 60 * 1000) : null,
        horaFim: i <= 7 ? new Date(Date.now() - i * 15 * 60 * 1000) : null,
      },
    })
  }
  console.log('✅ 10 ordens de endereçamento')

  // ============================================================================
  // 8. WMS - SEPARAÇÃO (OndaSeparacao + OrdemSeparacao + ItemSeparacao)
  // ============================================================================
  const pedidosVenda = await prisma.pedidoVenda.findMany({
    where: { empresaId: empresa.id, status: 'EM_SEPARACAO' },
    take: 10,
  })

  for (let i = 0; i < Math.min(pedidosVenda.length, 10); i++) {
    const pv = pedidosVenda[i]
    const onda = await prisma.ondaSeparacao.create({
      data: {
        empresaId: empresa.id,
        numero: i + 1,
        prioridade: i < 3 ? 'ALTA' : 'MEDIA',
        status: i < 4 ? 'SEPARADA' : 'PENDENTE',
        docaId: docas[2]?.id || docas[0].id,
        criadoPorId: funcionarios[3]?.id || funcionarios[0].id,
        pedidos: { create: { pedidoVendaId: pv.id } },
      },
    })

    const ordem = await prisma.ordemSeparacao.create({
      data: {
        ondaSeparacaoId: onda.id,
        funcionarioId: funcionarios[2]?.id,
        status: i < 4 ? 'CONCLUIDA' : 'PENDENTE',
      },
    })

    // Itens de separação
    const itensPV = await prisma.itemPedidoVenda.findMany({ where: { pedidoVendaId: pv.id } })
    for (const item of itensPV) {
      await prisma.itemSeparacao.create({
        data: {
          ordemSeparacaoId: ordem.id,
          pedidoVendaId: pv.id,
          produtoId: item.produtoId,
          enderecoOrigemId: enderecos[0].id,
          enderecoDestinoId: enderecos[enderecos.length - 1].id,
          quantidadeSolicitada: Number(item.quantidade),
          quantidadeSeparada: i < 4 ? Number(item.quantidade) : 0,
          status: i < 4 ? 'SEPARADO' : 'PENDENTE',
          separadoEm: i < 4 ? new Date() : null,
        },
      })
    }
  }
  console.log(`✅ ${Math.min(pedidosVenda.length, 10)} ondas de separação com ordens e itens`)

  // ============================================================================
  // 9. WMS - MONTAGEM DE CARGA (Carregamento + Volumes)
  // ============================================================================
  const ondasSeparadas = await prisma.ondaSeparacao.findMany({
    where: { empresaId: empresa.id, status: 'SEPARADA' },
    include: { pedidos: true },
    take: 5,
  })

  for (let i = 0; i < Math.min(ondasSeparadas.length, 5); i++) {
    const onda = ondasSeparadas[i]
    // Criar volume
    const volume = await prisma.volume.create({
      data: {
        ondaSeparacaoId: onda.id,
        pedidoVendaId: onda.pedidos[0]?.pedidoVendaId || pedidosVenda[0].id,
        codigo: i + 1,
        tipo: 'CAIXA',
        pesoKg: 15 + i * 3,
        comprimentoCm: 60,
        larguraCm: 40,
        alturaCm: 30 + i * 5,
        status: i < 3 ? 'CARREGADO' : 'EMBALADO',
      },
    })

    if (i < 3) {
      // Criar carregamento
      const carreg = await prisma.carregamento.create({
        data: {
          empresaId: empresa.id,
          docaId: docas[2]?.id || docas[0].id,
          veiculoPlaca: ['ABC1D23', 'GHI9J01', 'JKL2M34'][i],
          transportadoraId: null,
          status: i === 0 ? 'CONCLUIDO' : 'EM_CARREGAMENTO',
          motorista: ['José da Silva', 'Carlos Pereira', 'Antonio Souza'][i],
          motoristaCpf: ['12345678900', '98765432100', '45678912300'][i],
          concluidoEm: i === 0 ? new Date() : null,
          emCarregamentoEm: new Date(),
        },
      })

      await prisma.carregamentoVolume.create({
        data: {
          carregamentoId: carreg.id,
          volumeId: volume.id,
          sequencia: 1,
          carregadoEm: i === 0 ? new Date() : null,
        },
      })
    }
  }
  console.log('✅ Montagem de carga: volumes + carregamentos criados')

  // ============================================================================
  // 10. WMS - MAPAS DE CARREGAMENTO
  // ============================================================================
  // Precisamos de DocumentoFiscal para vincular
  const nfes = await prisma.documentoFiscal.findMany({ where: { empresaId: empresa.id, tipo: 'NFE' }, take: 10 })

  // Se não existem NFs, vamos criar algumas simuladas
  let nfeIds: string[] = nfes.map(n => n.id)
  if (nfeIds.length < 10) {
    for (let i = nfeIds.length + 1; i <= 10; i++) {
      const nfe = await prisma.documentoFiscal.create({
        data: {
          empresaId: empresa.id,
          tipo: 'NFE',
          modelo: 55,
          numero: 5000 + i,
          serie: 1,
          status: 'AUTORIZADO',
          tipoOperacao: 1,
          finalidade: 1,
          ambiente: 2,
          mapaOk: false,
          dataEmissao: new Date(),
          emitenteCnpj: empresa.cnpj,
          emitenteRazao: empresa.razaoSocial,
          emitenteUf: empresa.uf || 'SP',
        },
      })
      nfeIds.push(nfe.id)
    }
  }

  // Criar rotas se não existem
  let rotas = await prisma.rota.findMany({ where: { empresaId: empresa.id }, take: 3 })
  if (rotas.length === 0) {
    for (const r of [
      { codigo: 'R01', descricao: 'Rota Centro SP' },
      { codigo: 'R02', descricao: 'Rota Zona Norte' },
      { codigo: 'R03', descricao: 'Rota Guarulhos' },
    ]) {
      const rota = await prisma.rota.create({ data: { empresaId: empresa.id, ...r } })
      rotas.push(rota)
    }
  }

  const maxNumMapa = (await prisma.mapaCarregamento.findFirst({ where: { empresaId: empresa.id }, orderBy: { numero: 'desc' } }))?.numero || 0

  for (let i = 1; i <= 10; i++) {
    const mapa = await prisma.mapaCarregamento.create({
      data: {
        empresaId: empresa.id,
        numero: maxNumMapa + i,
        rotaId: rotas[(i - 1) % rotas.length].id,
        veiculoPlaca: ['ABC1D23', 'GHI9J01', 'JKL2M34', 'NOP5Q67', 'RST8U90', 'VWX1Y23', 'BCD4E56', 'FGH7I89', 'ABC1D23', 'GHI9J01'][i - 1],
        motorista: ['José Silva', 'Carlos Pereira', 'Antonio Souza', 'Fernando Lima', 'Ricardo Mendes', 'Paulo Costa', 'Marcos Alves', 'João Ferreira', 'Roberto Santos', 'Luiz Oliveira'][i - 1],
        motoristaCpf: `${String(i).padStart(3, '0')}45678900`,
        status: ['AGUARDANDO_SEPARACAO', 'EM_CARREGAMENTO', 'FINALIZADO', 'AGUARDANDO_SEPARACAO', 'EM_CARREGAMENTO', 'FINALIZADO', 'AGUARDANDO_SEPARACAO', 'EM_CARREGAMENTO', 'AGUARDANDO_SEPARACAO', 'FINALIZADO'][i - 1],
        criadoPorId: funcionarios[3]?.id || funcionarios[0].id,
        distanciaTotalKm: i <= 6 ? 15.5 + i * 8.3 : null,
        nfs: {
          create: nfeIds.slice(i - 1, i).map(nfeId => ({
            nfeId,
            ordemEntrega: 1,
            distanciaParcialKm: 5 + i * 2.1,
          })),
        },
      },
    })
  }
  console.log('✅ 10 mapas de carregamento com NFs vinculadas')

  // ============================================================================
  // RESUMO FINAL
  // ============================================================================
  console.log('\n🎉 Dados de teste completos!')
  console.log('\n📋 Resumo dos lançamentos:')
  console.log('   - 10 SKUs com dimensões, peso e paletes')
  console.log('   - 10 Dados logísticos (armazenagem + picking + expedição)')
  console.log('   - ~10 Pedidos de Compra')
  console.log('   - ~10 Pedidos de Venda')
  console.log('   - ~10 Agendamentos WMS')
  console.log('   - 10 Notas de Entrada + 5 Conferências (OS concluídas)')
  console.log('   - 10 Ordens de Endereçamento')
  console.log('   - Ondas de Separação com ordens e itens')
  console.log('   - Montagem de Carga (volumes + carregamentos)')
  console.log('   - 10 Mapas de Carregamento com NFs')
}

main()
  .catch((e) => { console.error('❌ Erro:', e.message); process.exit(1) })
  .finally(async () => { await prisma.$disconnect() })
