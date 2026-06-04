import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  console.log('🌱 Seed: Vendas Completas — Fluxo end-to-end com chain Cliente→PedidoVenda→VendaEfetivada→Nfe→MapaCarregamento\n')

  // ============================================================================
  // BUSCAR ENTIDADES BASE
  // ============================================================================
  const empresa = await prisma.empresa.findFirst()
  if (!empresa) throw new Error('❌ Execute prisma/seed.ts primeiro — empresa não encontrada')

  const produtos = await prisma.produto.findMany({ where: { empresaId: empresa.id } })
  if (produtos.length < 10) throw new Error('❌ Produtos insuficientes. Execute prisma/seed.ts primeiro')

  const fornecedores = await prisma.fornecedor.findMany({ where: { empresaId: empresa.id } })
  if (fornecedores.length === 0) throw new Error('❌ Fornecedores não encontrados')

  const tabela = await prisma.tabelaPreco.findFirst({ where: { empresaId: empresa.id } })
  if (!tabela) throw new Error('❌ Tabela de preço não encontrada')

  const vendedor = await prisma.vendedor.findFirst({ where: { empresaId: empresa.id } })
  const funcionario = await prisma.funcionario.findFirst({ where: { tipo: 'LIDER' } })
    || await prisma.funcionario.findFirst()
  if (!funcionario) throw new Error('❌ Funcionário não encontrado para criadoPorId')

  console.log(`✅ Base encontrada: empresa=${empresa.nomeFantasia}, ${produtos.length} produtos, ${fornecedores.length} fornecedores`)

  // ============================================================================
  // 1. ROTAS (5)
  // ============================================================================
  const rotasData = [
    { codigo: 'R-SP-CENTRO', descricao: 'Rota São Paulo Centro' },
    { codigo: 'R-SP-NORTE', descricao: 'Rota Zona Norte SP' },
    { codigo: 'R-ABC', descricao: 'Rota ABC Paulista' },
    { codigo: 'R-OESTE', descricao: 'Rota Oeste - Osasco/Barueri/Cotia' },
    { codigo: 'R-LESTE', descricao: 'Rota Leste - Guarulhos/Mogi' },
  ]

  const rotas: any[] = []
  for (const r of rotasData) {
    const rota = await prisma.rota.upsert({
      where: { empresaId_codigo: { empresaId: empresa.id, codigo: r.codigo } },
      update: {},
      create: { empresaId: empresa.id, ...r },
    })
    rotas.push(rota)
  }
  console.log('✅ 5 rotas criadas')

  // ============================================================================
  // 2. CLIENTES (10) — com endereços completos e coordenadas
  // ============================================================================
  const clientesData = [
    { razaoSocial: 'Supermercado Estrela Ltda', nomeFantasia: 'Supermercado Estrela', cpfCnpj: '10100100000101', logradouro: 'Rua Augusta', numero: '1200', bairro: 'Consolação', cidade: 'São Paulo', uf: 'SP', cep: '01304-001', telefone: '(11) 3251-0001', email: 'contato@superestrela.com.br', latitude: -23.5535, longitude: -46.6562, rotaIdx: 0 },
    { razaoSocial: 'Mercearia do Zé Comércio Ltda', nomeFantasia: 'Mercearia do Zé', cpfCnpj: '10200200000102', logradouro: 'Av. Tiradentes', numero: '450', bairro: 'Centro', cidade: 'Guarulhos', uf: 'SP', cep: '07011-000', telefone: '(11) 2443-0002', email: 'ze@mercearia.com.br', latitude: -23.4628, longitude: -46.5322, rotaIdx: 4 },
    { razaoSocial: 'Atacado Big Store S.A.', nomeFantasia: 'Atacado Big Store', cpfCnpj: '10300300000103', logradouro: 'Rod. Anhanguera km 98', numero: 'S/N', bairro: 'Distrito Industrial', cidade: 'Campinas', uf: 'SP', cep: '13054-750', telefone: '(19) 3287-0003', email: 'compras@bigstore.com.br', latitude: -22.9099, longitude: -47.0626, rotaIdx: 1 },
    { razaoSocial: 'Padaria Pão Quente Eireli', nomeFantasia: 'Padaria Pão Quente', cpfCnpj: '10400400000104', logradouro: 'Rua das Figueiras', numero: '88', bairro: 'Jardim', cidade: 'Santo André', uf: 'SP', cep: '09080-300', telefone: '(11) 4438-0004', email: 'padaria@paoquente.com.br', latitude: -23.6737, longitude: -46.5432, rotaIdx: 2 },
    { razaoSocial: 'Restaurante Sabor & Arte Ltda', nomeFantasia: 'Restaurante Sabor & Arte', cpfCnpj: '10500500000105', logradouro: 'Av. dos Autonomistas', numero: '1500', bairro: 'Vila Yara', cidade: 'Osasco', uf: 'SP', cep: '06020-010', telefone: '(11) 3652-0005', email: 'reservas@saborarte.com.br', latitude: -23.5327, longitude: -46.7916, rotaIdx: 3 },
    { razaoSocial: 'Mini Mercado Família ME', nomeFantasia: 'Mini Mercado Família', cpfCnpj: '10600600000106', logradouro: 'Rua Marechal Deodoro', numero: '320', bairro: 'Centro', cidade: 'São Bernardo do Campo', uf: 'SP', cep: '09710-020', telefone: '(11) 4330-0006', email: 'familia@minimercado.com.br', latitude: -23.6914, longitude: -46.5650, rotaIdx: 2 },
    { razaoSocial: 'Empório Natural Comércio Ltda', nomeFantasia: 'Empório Natural', cpfCnpj: '10700700000107', logradouro: 'Alameda Araguaia', numero: '2044', bairro: 'Alphaville', cidade: 'Barueri', uf: 'SP', cep: '06455-000', telefone: '(11) 4195-0007', email: 'vendas@emporionatural.com.br', latitude: -23.4953, longitude: -46.8491, rotaIdx: 3 },
    { razaoSocial: 'Distribuidora Sol Nascente Ltda', nomeFantasia: 'Distribuidora Sol', cpfCnpj: '10800800000108', logradouro: 'Rua Henry Ford', numero: '600', bairro: 'Cézar de Souza', cidade: 'Mogi das Cruzes', uf: 'SP', cep: '08820-000', telefone: '(11) 4726-0008', email: 'sol@distribuidora.com.br', latitude: -23.5220, longitude: -46.1882, rotaIdx: 4 },
    { razaoSocial: 'Lanchonete Express Fast Food ME', nomeFantasia: 'Lanchonete Express', cpfCnpj: '10900900000109', logradouro: 'Av. Presidente Kennedy', numero: '1070', bairro: 'Eldorado', cidade: 'Diadema', uf: 'SP', cep: '09972-000', telefone: '(11) 4057-0009', email: 'express@lanchonete.com.br', latitude: -23.6861, longitude: -46.6228, rotaIdx: 2 },
    { razaoSocial: 'Hortifruti Verde Vida Ltda', nomeFantasia: 'Hortifruti Verde Vida', cpfCnpj: '11000100000110', logradouro: 'Rod. Raposo Tavares km 23', numero: '100', bairro: 'Granja Viana', cidade: 'Cotia', uf: 'SP', cep: '06709-015', telefone: '(11) 4612-0010', email: 'verde@hortifruti.com.br', latitude: -23.5937, longitude: -46.8420, rotaIdx: 3 },
  ]

  const clientes: any[] = []
  for (const c of clientesData) {
    const { rotaIdx, ...clienteFields } = c
    const cliente = await prisma.cliente.upsert({
      where: { empresaId_cpfCnpj: { empresaId: empresa.id, cpfCnpj: c.cpfCnpj } },
      update: {},
      create: { ...clienteFields, empresaId: empresa.id, rotaId: rotas[rotaIdx].id },
    })
    clientes.push(cliente)
  }
  console.log('✅ 10 clientes criados com endereços e coordenadas')

  // ============================================================================
  // 3. PEDIDOS DE VENDA (10 CONFIRMADOS, 1 per client, 2-4 items each)
  // ============================================================================
  const maxNumPV = (await prisma.pedidoVenda.findFirst({
    where: { empresaId: empresa.id },
    orderBy: { numero: 'desc' },
  }))?.numero || 0

  // Items distribution per pedido (2-4 items using existing products)
  const pedidoItemsConfig = [
    [0, 1, 6],        // Arroz, Feijão, Café
    [2, 3, 4, 9],     // Óleo, Açúcar, Farinha, Molho
    [0, 5, 7],        // Arroz, Leite, Macarrão
    [1, 6, 8, 9],     // Feijão, Café, Sal, Molho
    [2, 3],           // Óleo, Açúcar
    [0, 4, 5, 7],     // Arroz, Farinha, Leite, Macarrão
    [1, 2, 8],        // Feijão, Óleo, Sal
    [3, 6, 9],        // Açúcar, Café, Molho
    [0, 5, 7, 8],     // Arroz, Leite, Macarrão, Sal
    [4, 6],           // Farinha, Café
  ]

  const pedidosVenda: any[] = []
  for (let i = 0; i < 10; i++) {
    const itemIdxs = pedidoItemsConfig[i]
    const qtds = [30, 20, 50, 15, 40, 25, 35, 60, 10, 45]
    const itens = itemIdxs.map((prodIdx, idx) => {
      const prod = produtos[prodIdx]
      const qty = qtds[(i + idx) % qtds.length]
      const preco = Number(prod.precoBase)
      return {
        produtoId: prod.id,
        quantidade: qty,
        precoBase: preco,
        precoFinal: preco,
        valorTotal: preco * qty,
      }
    })
    const valorTotal = itens.reduce((s, it) => s + it.valorTotal, 0)

    const pv = await prisma.pedidoVenda.create({
      data: {
        empresaId: empresa.id,
        numero: maxNumPV + 100 + i + 1,
        clienteId: clientes[i].id,
        vendedorId: vendedor?.id || undefined,
        tabelaPrecoId: tabela.id,
        rotaId: rotas[clientesData[i].rotaIdx].id,
        valorTotal,
        status: 'FATURADO',
        itens: { create: itens },
      },
    })
    pedidosVenda.push(pv)
  }
  console.log('✅ 10 pedidos de venda criados (status FATURADO)')

  // ============================================================================
  // 4. VENDAS EFETIVADAS (10)
  // ============================================================================
  const vendasEfetivadas: any[] = []
  for (let i = 0; i < 10; i++) {
    const pv = pedidosVenda[i]
    const ve = await prisma.vendaEfetivada.create({
      data: {
        empresaId: empresa.id,
        pedidoVendaId: pv.id,
        valorTotal: pv.valorTotal,
        statusEntrega: 'PENDENTE',
      },
    })
    vendasEfetivadas.push(ve)
  }
  console.log('✅ 10 vendas efetivadas criadas')

  // ============================================================================
  // 5. NF-e PARA CADA VENDA (10 notas de saída)
  // ============================================================================
  const maxNumNfe = (await prisma.nfe.findFirst({
    where: { empresaId: empresa.id },
    orderBy: { numero: 'desc' },
  }))?.numero || 0

  const nfes: any[] = []
  for (let i = 0; i < 10; i++) {
    const ve = vendasEfetivadas[i]
    const pv = pedidosVenda[i]

    // Get items from the pedido
    const itensPV = await prisma.itemPedidoVenda.findMany({
      where: { pedidoVendaId: pv.id },
      include: { produto: true },
    })

    const nfe = await prisma.nfe.create({
      data: {
        empresaId: empresa.id,
        vendaEfetivadaId: ve.id,
        numero: maxNumNfe + 2000 + i + 1,
        serie: 1,
        status: 'AUTORIZADA',
        tipoNfe: 'SAIDA',
        tpNF: 1,
        finNFe: 1,
        ambiente: 2,
        mapaOk: false,
        itens: {
          create: itensPV.map((item, idx) => ({
            nItem: idx + 1,
            produtoId: item.produtoId,
            cProd: item.produto.codigo,
            xProd: item.produto.nome,
            ncm: item.produto.ncm || '00000000',
            cfop: item.produto.cfopEstadual || '5102',
            uCom: item.unidade || 'UN',
            qCom: item.quantidade,
            vUnCom: item.precoFinal,
            vProd: item.valorTotal,
          })),
        },
      },
    })
    nfes.push(nfe)
  }
  console.log('✅ 10 NF-e de saída criadas (AUTORIZADA, vinculadas a VendaEfetivada)')

  // ============================================================================
  // 6. CONTAS A RECEBER (1 por venda)
  // ============================================================================
  for (let i = 0; i < 10; i++) {
    const ve = vendasEfetivadas[i]
    const vencimento = new Date()
    vencimento.setDate(vencimento.getDate() + 30 + i * 5)

    await prisma.contaReceber.create({
      data: {
        empresaId: empresa.id,
        vendaEfetivadaId: ve.id,
        clienteId: clientes[i].id,
        descricao: `NF-e ${maxNumNfe + 2000 + i + 1} - ${clientes[i].nomeFantasia || clientes[i].razaoSocial}`,
        valor: ve.valorTotal,
        dataVencimento: vencimento,
        formaPagamento: ['BOLETO', 'PIX', 'BOLETO', 'CARTAO_CREDITO', 'BOLETO', 'PIX', 'BOLETO', 'PIX', 'CARTAO_CREDITO', 'BOLETO'][i],
        status: 'ABERTA',
      },
    })
  }
  console.log('✅ 10 contas a receber criadas')

  // ============================================================================
  // 7. MAPAS DE CARREGAMENTO (5 mapas, 2 NFs cada)
  // ============================================================================
  const maxNumMapa = (await prisma.mapaCarregamento.findFirst({
    where: { empresaId: empresa.id },
    orderBy: { numero: 'desc' },
  }))?.numero || 0

  const mapasConfig = [
    {
      rotaIdx: 0,
      veiculoPlaca: 'FRG4H56',
      motorista: 'Roberto Almeida',
      motoristaCpf: '32165498700',
      status: 'AGUARDANDO_SEPARACAO',
      nfeIdxs: [0, 2], // NFs dos clientes SP Centro e Campinas
    },
    {
      rotaIdx: 4,
      veiculoPlaca: 'KLM7N89',
      motorista: 'Sérgio Nascimento',
      motoristaCpf: '65432198700',
      status: 'EM_CARREGAMENTO',
      nfeIdxs: [1, 7], // NFs Guarulhos e Mogi
    },
    {
      rotaIdx: 2,
      veiculoPlaca: 'PQR1S23',
      motorista: 'Eduardo Ferreira',
      motoristaCpf: '78945612300',
      status: 'FINALIZADO',
      nfeIdxs: [3, 5], // NFs Santo André e SBC
    },
    {
      rotaIdx: 3,
      veiculoPlaca: 'TUV4W56',
      motorista: 'Marcelo Dias',
      motoristaCpf: '45678912300',
      status: 'EM_CARREGAMENTO',
      nfeIdxs: [4, 6], // NFs Osasco e Barueri
    },
    {
      rotaIdx: 2,
      veiculoPlaca: 'XYZ7A89',
      motorista: 'Fábio Costa',
      motoristaCpf: '98712365400',
      status: 'AGUARDANDO_SEPARACAO',
      nfeIdxs: [8, 9], // NFs Diadema e Cotia
    },
  ]

  for (let i = 0; i < mapasConfig.length; i++) {
    const cfg = mapasConfig[i]
    await prisma.mapaCarregamento.create({
      data: {
        empresaId: empresa.id,
        numero: maxNumMapa + 500 + i + 1,
        rotaId: rotas[cfg.rotaIdx].id,
        veiculoPlaca: cfg.veiculoPlaca,
        motorista: cfg.motorista,
        motoristaCpf: cfg.motoristaCpf,
        status: cfg.status,
        criadoPorId: funcionario!.id,
        distanciaTotalKm: 25 + i * 12.5,
        finalizadoEm: cfg.status === 'FINALIZADO' ? new Date() : null,
        nfs: {
          create: cfg.nfeIdxs.map((nfeIdx, ordem) => ({
            nfeId: nfes[nfeIdx].id,
            ordemEntrega: ordem + 1,
            distanciaParcialKm: 8 + ordem * 6.3,
          })),
        },
      },
    })
  }
  console.log('✅ 5 mapas de carregamento criados (2 NFs cada, com chain completa)')

  // ============================================================================
  // 8. COMPRAS EFETIVADAS (10)
  // ============================================================================
  const maxNumPC = (await prisma.pedidoCompra.findFirst({
    where: { empresaId: empresa.id },
    orderBy: { numero: 'desc' },
  }))?.numero || 0

  for (let i = 0; i < 10; i++) {
    const forn = fornecedores[i % fornecedores.length]
    const prods = produtos.slice((i * 2) % 8, ((i * 2) % 8) + 3)
    const itens = prods.map((p, idx) => ({
      produtoId: p.id,
      quantidade: 80 + idx * 30,
      precoUnitario: Number(p.precoBase) * 0.8,
      classificacao: 'REVENDA' as const,
      valorTotal: Number(p.precoBase) * 0.8 * (80 + idx * 30),
    }))
    const valorTotal = itens.reduce((s, it) => s + it.valorTotal, 0)

    const pc = await prisma.pedidoCompra.create({
      data: {
        empresaId: empresa.id,
        numero: maxNumPC + 200 + i + 1,
        fornecedorId: forn.id,
        dataEntrega: new Date(Date.now() + (i + 5) * 24 * 60 * 60 * 1000),
        valorTotal,
        status: 'CONFIRMADO',
        itens: { create: itens },
      },
    })

    // Efetivar compra
    await prisma.compraEfetivada.create({
      data: {
        empresaId: empresa.id,
        pedidoCompraId: pc.id,
        valorTotal,
      },
    })
  }
  console.log('✅ 10 pedidos de compra CONFIRMADOS + 10 compras efetivadas')

  // ============================================================================
  // RESUMO FINAL
  // ============================================================================
  console.log('\n🎉 Seed de vendas completas executado com sucesso!')
  console.log('\n📋 Resumo:')
  console.log('   - 5 rotas regionais')
  console.log('   - 10 clientes com endereço completo + geolocalização')
  console.log('   - 10 pedidos de venda (FATURADO) com 2-4 itens cada')
  console.log('   - 10 vendas efetivadas')
  console.log('   - 10 NF-e de saída (AUTORIZADA) com itens fiscais')
  console.log('   - 10 contas a receber')
  console.log('   - 5 mapas de carregamento (2 NFs cada)')
  console.log('   - 10 pedidos de compra + compras efetivadas')
  console.log('\n🔗 Chain completa: MapaCarregamentoNf → Nfe.vendaEfetivadaId → VendaEfetivada.pedidoVendaId → PedidoVenda.clienteId → Cliente')
  console.log('   O modal de Mapas de Carregamento agora mostrará o nome do cliente na coluna "Cliente"!')
}

main()
  .catch((e) => { console.error('❌ Erro:', e); process.exit(1) })
  .finally(async () => { await prisma.$disconnect() })
