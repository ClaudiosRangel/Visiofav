import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'

const prisma = new PrismaClient()

async function main() {
  console.log('🌱 Iniciando seed completo...\n')

  // ============================================================================
  // 1. EMPRESA + USUÁRIO
  // ============================================================================
  const empresa = await prisma.empresa.upsert({
    where: { cnpj: '12345678000190' },
    update: {},
    create: {
      razaoSocial: 'VisioFab Logística Ltda',
      nomeFantasia: 'VisioFab Demo',
      cnpj: '12345678000190',
      inscEstadual: '123456789',
      logradouro: 'Av. Brasil', numero: '1500', bairro: 'Centro',
      cidade: 'São Paulo', uf: 'SP', cep: '01000-000',
      telefone: '(11) 3000-0000', email: 'contato@visiofab.com',
      usaWms: true, regimeTributario: 3, ambienteNFe: 2,
    },
  })
  console.log('✅ Empresa:', empresa.nomeFantasia)

  const admin = await prisma.usuario.upsert({
    where: { email: 'admin@visiofab.com' },
    update: {},
    create: { nome: 'Administrador', email: 'admin@visiofab.com', senha: bcrypt.hashSync('123456', 10), perfil: 'ADMIN' },
  })

  await prisma.usuarioEmpresa.upsert({
    where: { usuarioId_empresaId: { usuarioId: admin.id, empresaId: empresa.id } },
    update: {},
    create: { usuarioId: admin.id, empresaId: empresa.id, modulos: '*' },
  })
  console.log('✅ Usuário admin vinculado')

  // ============================================================================
  // 2. FORNECEDORES
  // ============================================================================
  const fornecedores = [
    { razaoSocial: 'Distribuidora ABC Ltda', nomeFantasia: 'ABC Distribuidora', cnpj: '11111111000101', cidade: 'São Paulo', uf: 'SP', telefone: '(11) 3111-1111', email: 'contato@abc.com' },
    { razaoSocial: 'Indústria XYZ S.A.', nomeFantasia: 'XYZ Industrial', cnpj: '22222222000102', cidade: 'Campinas', uf: 'SP', telefone: '(19) 3222-2222', email: 'vendas@xyz.com' },
    { razaoSocial: 'Comércio Delta Eireli', nomeFantasia: 'Delta Comércio', cnpj: '33333333000103', cidade: 'Rio de Janeiro', uf: 'RJ', telefone: '(21) 3333-3333' },
  ]

  for (const f of fornecedores) {
    await prisma.fornecedor.upsert({
      where: { empresaId_cnpj: { empresaId: empresa.id, cnpj: f.cnpj } },
      update: {}, create: { ...f, empresaId: empresa.id },
    })
  }
  console.log('✅ 3 fornecedores criados')

  // ============================================================================
  // 3. CLIENTES
  // ============================================================================
  const clientes = [
    { razaoSocial: 'Supermercado Bom Preço Ltda', nomeFantasia: 'Bom Preço', cpfCnpj: '44444444000104', cidade: 'São Paulo', uf: 'SP', telefone: '(11) 3444-4444' },
    { razaoSocial: 'Mercearia Central Eireli', nomeFantasia: 'Mercearia Central', cpfCnpj: '55555555000105', cidade: 'Guarulhos', uf: 'SP', telefone: '(11) 3555-5555' },
    { razaoSocial: 'Atacado Norte S.A.', nomeFantasia: 'Atacado Norte', cpfCnpj: '66666666000106', cidade: 'Manaus', uf: 'AM', telefone: '(92) 3666-6666' },
    { razaoSocial: 'Maria Silva', nomeFantasia: null, cpfCnpj: '12345678901', cidade: 'São Paulo', uf: 'SP' },
  ]

  for (const c of clientes) {
    await prisma.cliente.upsert({
      where: { empresaId_cpfCnpj: { empresaId: empresa.id, cpfCnpj: c.cpfCnpj } },
      update: {}, create: { ...c, empresaId: empresa.id },
    })
  }
  console.log('✅ 4 clientes criados')

  // ============================================================================
  // 4. TRANSPORTADORAS
  // ============================================================================
  await prisma.transportadora.upsert({
    where: { empresaId_cnpj: { empresaId: empresa.id, cnpj: '77777777000107' } },
    update: {},
    create: { empresaId: empresa.id, razaoSocial: 'Transportes Rápido Ltda', nomeFantasia: 'Rápido Log', cnpj: '77777777000107', cidade: 'São Paulo', uf: 'SP' },
  })
  console.log('✅ 1 transportadora criada')

  // ============================================================================
  // 5. VENDEDORES
  // ============================================================================
  const vendedores = [
    { nome: 'João Silva', cpf: '11122233344', comissao: 5.0 },
    { nome: 'Maria Santos', cpf: '55566677788', comissao: 3.5 },
    { nome: 'Carlos Oliveira', cpf: '99988877766', comissao: 4.0 },
  ]

  for (const v of vendedores) {
    await prisma.vendedor.upsert({
      where: { empresaId_cpf: { empresaId: empresa.id, cpf: v.cpf } },
      update: {}, create: { ...v, empresaId: empresa.id },
    })
  }
  console.log('✅ 3 vendedores criados')

  // ============================================================================
  // 6. PRODUTOS (com dados fiscais)
  // ============================================================================
  const produtos = [
    { codigo: 'ARROZ5KG', nome: 'Arroz Tipo 1 5kg', unidade: 'UN', precoBase: 25.90, ncm: '10063021', cfopEstadual: '5102', cfopInterest: '6102', cst: '00', aliqICMS: 18, cstPIS: '01', aliqPIS: 0.65, cstCOFINS: '01', aliqCOFINS: 3.0 },
    { codigo: 'FEIJAO1KG', nome: 'Feijão Carioca 1kg', unidade: 'UN', precoBase: 8.50, ncm: '07133319', cfopEstadual: '5102', cfopInterest: '6102', cst: '00', aliqICMS: 7, cstPIS: '01', aliqPIS: 0.65, cstCOFINS: '01', aliqCOFINS: 3.0 },
    { codigo: 'OLEO900', nome: 'Óleo de Soja 900ml', unidade: 'UN', precoBase: 7.90, ncm: '15079011', cfopEstadual: '5102', cfopInterest: '6102', cst: '00', aliqICMS: 18, cstPIS: '01', aliqPIS: 0.65, cstCOFINS: '01', aliqCOFINS: 3.0 },
    { codigo: 'ACUCAR1KG', nome: 'Açúcar Refinado 1kg', unidade: 'UN', precoBase: 5.50, ncm: '17019900', cfopEstadual: '5102', cfopInterest: '6102', cst: '00', aliqICMS: 18, cstPIS: '01', aliqPIS: 0.65, cstCOFINS: '01', aliqCOFINS: 3.0 },
    { codigo: 'FARINHA1KG', nome: 'Farinha de Trigo 1kg', unidade: 'UN', precoBase: 4.90, ncm: '11010010', cfopEstadual: '5102', cfopInterest: '6102', cst: '00', aliqICMS: 7, cstPIS: '01', aliqPIS: 0.65, cstCOFINS: '01', aliqCOFINS: 3.0 },
    { codigo: 'LEITE1L', nome: 'Leite Integral 1L', unidade: 'UN', precoBase: 6.20, ncm: '04012010', cfopEstadual: '5102', cfopInterest: '6102', cst: '40', aliqICMS: 0, cstPIS: '07', aliqPIS: 0, cstCOFINS: '07', aliqCOFINS: 0 },
    { codigo: 'CAFE500', nome: 'Café Torrado 500g', unidade: 'UN', precoBase: 18.90, ncm: '09012100', cfopEstadual: '5102', cfopInterest: '6102', cst: '00', aliqICMS: 18, cstPIS: '01', aliqPIS: 0.65, cstCOFINS: '01', aliqCOFINS: 3.0 },
    { codigo: 'MACARRAO500', nome: 'Macarrão Espaguete 500g', unidade: 'UN', precoBase: 3.90, ncm: '19021100', cfopEstadual: '5102', cfopInterest: '6102', cst: '00', aliqICMS: 18, cstPIS: '01', aliqPIS: 0.65, cstCOFINS: '01', aliqCOFINS: 3.0 },
    { codigo: 'SAL1KG', nome: 'Sal Refinado 1kg', unidade: 'UN', precoBase: 2.50, ncm: '25010019', cfopEstadual: '5102', cfopInterest: '6102', cst: '00', aliqICMS: 18, cstPIS: '01', aliqPIS: 0.65, cstCOFINS: '01', aliqCOFINS: 3.0 },
    { codigo: 'MOLHO340', nome: 'Molho de Tomate 340g', unidade: 'UN', precoBase: 3.20, ncm: '20029090', cfopEstadual: '5102', cfopInterest: '6102', cst: '00', aliqICMS: 18, cstPIS: '01', aliqPIS: 0.65, cstCOFINS: '01', aliqCOFINS: 3.0 },
  ]

  const produtoIds: Record<string, string> = {}
  for (const p of produtos) {
    const prod = await prisma.produto.upsert({
      where: { empresaId_codigo: { empresaId: empresa.id, codigo: p.codigo } },
      update: {}, create: { ...p, empresaId: empresa.id },
    })
    produtoIds[p.codigo] = prod.id
  }
  console.log('✅ 10 produtos criados com dados fiscais')

  // ============================================================================
  // 7. TABELA DE PREÇO
  // ============================================================================
  const tabela = await prisma.tabelaPreco.create({
    data: {
      empresaId: empresa.id, nome: 'Tabela Padrão',
      condicoes: {
        create: [
          { formaPagamento: 'DINHEIRO', parcelas: 1, percentual: -5 },
          { formaPagamento: 'PIX', parcelas: 1, percentual: -3 },
          { formaPagamento: 'BOLETO', parcelas: 3, percentual: 0 },
          { formaPagamento: 'CARTAO_CREDITO', parcelas: 6, percentual: 5 },
        ],
      },
    },
  })
  console.log('✅ Tabela de preço criada com 4 condições')

  // ============================================================================
  // 8. WMS — CENTRO DE DISTRIBUIÇÃO + ESTRUTURA
  // ============================================================================
  const cd = await prisma.centroDistribuicao.upsert({
    where: { empresaId_codigo: { empresaId: empresa.id, codigo: 'CD01' } },
    update: {},
    create: { empresaId: empresa.id, nome: 'CD São Paulo', codigo: 'CD01' },
  })
  console.log('✅ Centro de Distribuição criado')

  // ============================================================================
  // 9. ESTOQUE INICIAL (saldo por produto)
  // ============================================================================
  const estoqueInicial = [
    { codigo: 'ARROZ5KG', quantidade: 500 },
    { codigo: 'FEIJAO1KG', quantidade: 300 },
    { codigo: 'OLEO900', quantidade: 400 },
    { codigo: 'ACUCAR1KG', quantidade: 600 },
    { codigo: 'FARINHA1KG', quantidade: 250 },
    { codigo: 'LEITE1L', quantidade: 800 },
    { codigo: 'CAFE500', quantidade: 150 },
    { codigo: 'MACARRAO500', quantidade: 350 },
    { codigo: 'SAL1KG', quantidade: 200 },
    { codigo: 'MOLHO340', quantidade: 450 },
  ]

  for (const e of estoqueInicial) {
    await prisma.estoque.upsert({
      where: { empresaId_produtoId: { empresaId: empresa.id, produtoId: produtoIds[e.codigo] } },
      update: { quantidade: e.quantidade },
      create: { empresaId: empresa.id, produtoId: produtoIds[e.codigo], quantidade: e.quantidade },
    })
  }
  console.log('✅ Estoque inicial criado para 10 produtos')

  // ============================================================================
  // 10. PEDIDOS DE COMPRA
  // ============================================================================
  const fornecedor1 = await prisma.fornecedor.findFirst({ where: { empresaId: empresa.id, cnpj: '11111111000101' } })

  if (fornecedor1) {
    await prisma.pedidoCompra.create({
      data: {
        empresaId: empresa.id, numero: 1, fornecedorId: fornecedor1.id,
        dataEntrega: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        valorTotal: 12950, status: 'CONFIRMADO',
        itens: {
          create: [
            { produtoId: produtoIds['ARROZ5KG'], quantidade: 200, precoUnitario: 22.50, classificacao: 'REVENDA', valorTotal: 4500 },
            { produtoId: produtoIds['FEIJAO1KG'], quantidade: 500, precoUnitario: 6.90, classificacao: 'REVENDA', valorTotal: 3450 },
            { produtoId: produtoIds['CAFE500'], quantidade: 300, precoUnitario: 16.67, classificacao: 'REVENDA', valorTotal: 5000 },
          ],
        },
      },
    })

    await prisma.pedidoCompra.create({
      data: {
        empresaId: empresa.id, numero: 2, fornecedorId: fornecedor1.id,
        valorTotal: 3900, status: 'RASCUNHO',
        itens: {
          create: [
            { produtoId: produtoIds['OLEO900'], quantidade: 300, precoUnitario: 6.50, classificacao: 'REVENDA', valorTotal: 1950 },
            { produtoId: produtoIds['ACUCAR1KG'], quantidade: 500, precoUnitario: 3.90, classificacao: 'REVENDA', valorTotal: 1950 },
          ],
        },
      },
    })
  }
  console.log('✅ 2 pedidos de compra criados')

  // ============================================================================
  // 11. PEDIDOS DE VENDA
  // ============================================================================
  const cliente1 = await prisma.cliente.findFirst({ where: { empresaId: empresa.id, cpfCnpj: '44444444000104' } })
  const cliente2 = await prisma.cliente.findFirst({ where: { empresaId: empresa.id, cpfCnpj: '55555555000105' } })
  const vendedor1 = await prisma.vendedor.findFirst({ where: { empresaId: empresa.id, cpf: '11122233344' } })

  if (cliente1 && vendedor1) {
    await prisma.pedidoVenda.create({
      data: {
        empresaId: empresa.id, numero: 1, clienteId: cliente1.id, vendedorId: vendedor1.id,
        tabelaPrecoId: tabela.id, valorTotal: 2590, status: 'EM_SEPARACAO',
        itens: {
          create: [
            { produtoId: produtoIds['ARROZ5KG'], quantidade: 50, precoBase: 25.90, precoFinal: 25.90, valorTotal: 1295 },
            { produtoId: produtoIds['FEIJAO1KG'], quantidade: 100, precoBase: 8.50, precoFinal: 8.50, valorTotal: 850 },
            { produtoId: produtoIds['OLEO900'], quantidade: 50, precoBase: 7.90, precoFinal: 7.90, valorTotal: 395 },
          ],
        },
      },
    })
  }

  if (cliente2 && vendedor1) {
    await prisma.pedidoVenda.create({
      data: {
        empresaId: empresa.id, numero: 2, clienteId: cliente2.id, vendedorId: vendedor1.id,
        tabelaPrecoId: tabela.id, valorTotal: 1850, status: 'EM_SEPARACAO',
        itens: {
          create: [
            { produtoId: produtoIds['CAFE500'], quantidade: 50, precoBase: 18.90, precoFinal: 18.90, valorTotal: 945 },
            { produtoId: produtoIds['ACUCAR1KG'], quantidade: 100, precoBase: 5.50, precoFinal: 5.50, valorTotal: 550 },
            { produtoId: produtoIds['MACARRAO500'], quantidade: 100, precoBase: 3.55, precoFinal: 3.55, valorTotal: 355 },
          ],
        },
      },
    })

    await prisma.pedidoVenda.create({
      data: {
        empresaId: empresa.id, numero: 3, clienteId: cliente2.id,
        tabelaPrecoId: tabela.id, valorTotal: 780, status: 'CONFIRMADO',
        itens: {
          create: [
            { produtoId: produtoIds['LEITE1L'], quantidade: 100, precoBase: 6.20, precoFinal: 6.20, valorTotal: 620 },
            { produtoId: produtoIds['SAL1KG'], quantidade: 64, precoBase: 2.50, precoFinal: 2.50, valorTotal: 160 },
          ],
        },
      },
    })
  }
  console.log('✅ 3 pedidos de venda criados (2 EM_SEPARACAO, 1 CONFIRMADO)')

  // ============================================================================
  // 12. CONTAS A PAGAR E RECEBER (manuais)
  // ============================================================================
  await prisma.contaPagar.create({
    data: {
      empresaId: empresa.id, descricao: 'Aluguel do galpão - Maio/2026',
      valor: 15000, dataVencimento: new Date('2026-05-10'), formaPagamento: 'BOLETO',
    },
  })

  await prisma.contaPagar.create({
    data: {
      empresaId: empresa.id, descricao: 'Energia elétrica - Abril/2026',
      valor: 3500, dataVencimento: new Date('2026-04-25'), status: 'PAGA',
      dataPagamento: new Date('2026-04-24'), valorPago: 3500, formaPagamento: 'PIX',
    },
  })

  await prisma.contaReceber.create({
    data: {
      empresaId: empresa.id, descricao: 'Serviço de armazenagem - Cliente avulso',
      valor: 5000, dataVencimento: new Date('2026-05-15'), formaPagamento: 'BOLETO',
    },
  })
  console.log('✅ 2 contas a pagar + 1 conta a receber criadas')

  // ============================================================================
  // 13. WMS — DEPÓSITOS, ZONAS, ESTRUTURAS, ENDEREÇOS
  // ============================================================================
  const dep1 = await prisma.deposito.create({ data: { centroDistribuicaoId: cd.id, descricao: 'Depósito Principal', cidade: 'São Paulo', uf: 'SP' } })
  const dep2 = await prisma.deposito.create({ data: { centroDistribuicaoId: cd.id, descricao: 'Depósito Seco', cidade: 'São Paulo', uf: 'SP' } })
  console.log('✅ 2 depósitos criados')

  const zonaA = await prisma.zona.create({ data: { descricao: 'Zona A - Seco', depositoId: dep1.id } })
  const zonaB = await prisma.zona.create({ data: { descricao: 'Zona B - Refrigerado', depositoId: dep1.id } })
  await prisma.zona.create({ data: { descricao: 'Zona C - Picking', depositoId: dep2.id } })
  console.log('✅ 3 zonas criadas')

  const estPP = await prisma.estrutura.create({ data: { descricao: 'Porta Palete Convencional', tipo: 'PORTA_PALETE' } })
  await prisma.estrutura.create({ data: { descricao: 'Blocado Chão', tipo: 'BLOCADO' } })
  await prisma.estrutura.create({ data: { descricao: 'Drive-In Frio', tipo: 'DRIVE_IN' } })
  await prisma.estrutura.create({ data: { descricao: 'Flow Rack Picking', tipo: 'FLOW_RACK' } })
  console.log('✅ 4 estruturas criadas')

  // Gerar 24 endereços: 2 ruas x 3 prédios x 2 níveis x 2 aptos
  const pad = (n: number) => String(n).padStart(3, '0')
  const enderecoIds: string[] = []
  for (let rua = 1; rua <= 2; rua++) {
    for (let predio = 1; predio <= 3; predio++) {
      for (let nivel = 1; nivel <= 2; nivel++) {
        for (let apto = 1; apto <= 2; apto++) {
          const enderecoCompleto = `${pad(1)}-${pad(1)}-${pad(rua)}-${pad(predio)}-${pad(nivel)}-${pad(apto)}`
          const end = await prisma.endereco.create({
            data: {
              codigoDeposito: '001', codigoZona: '001', codigoRua: pad(rua), codigoPredio: pad(predio),
              codigoNivel: pad(nivel), codigoApto: pad(apto), enderecoCompleto,
              tipo: 'ARMAZENAGEM', centroDistribuicaoId: cd.id, depositoId: dep1.id,
              zonaId: zonaA.id, estruturaId: estPP.id,
            },
          })
          enderecoIds.push(end.id)
        }
      }
    }
  }
  console.log('✅ 24 endereços criados')

  // ============================================================================
  // 14. WMS — DOCAS
  // ============================================================================
  const doca1 = await prisma.doca.create({ data: { descricao: 'Doca 01 - Entrada', tipo: 'ENTRADA', centroDistribuicaoId: cd.id, depositoId: dep1.id } })
  const doca2 = await prisma.doca.create({ data: { descricao: 'Doca 02 - Entrada', tipo: 'ENTRADA', centroDistribuicaoId: cd.id, depositoId: dep1.id } })
  const doca3 = await prisma.doca.create({ data: { descricao: 'Doca 03 - Saída', tipo: 'SAIDA', centroDistribuicaoId: cd.id, depositoId: dep1.id } })
  await prisma.doca.create({ data: { descricao: 'Doca 04 - Mista', tipo: 'MISTA', centroDistribuicaoId: cd.id, depositoId: dep2.id } })
  console.log('✅ 4 docas criadas')

  // ============================================================================
  // 15. WMS — FUNCIONÁRIOS, FUNÇÕES, EQUIPAMENTOS
  // ============================================================================
  await prisma.funcao.create({ data: { descricao: 'Operador de Empilhadeira' } })
  await prisma.funcao.create({ data: { descricao: 'Conferente' } })
  await prisma.funcao.create({ data: { descricao: 'Separador' } })
  await prisma.funcao.create({ data: { descricao: 'Líder de Equipe' } })
  console.log('✅ 4 funções criadas')

  const func1 = await prisma.funcionario.create({ data: { nome: 'Pedro Operador', matricula: '001', tipo: 'OPERADOR', centroDistribuicaoId: cd.id, presente: true } })
  const func2 = await prisma.funcionario.create({ data: { nome: 'Ana Conferente', matricula: '002', tipo: 'CONFERENTE', centroDistribuicaoId: cd.id, presente: true } })
  const func3 = await prisma.funcionario.create({ data: { nome: 'Lucas Separador', matricula: '003', tipo: 'OPERADOR', centroDistribuicaoId: cd.id, presente: true } })
  await prisma.funcionario.create({ data: { nome: 'Marcos Líder', matricula: '004', tipo: 'LIDER', centroDistribuicaoId: cd.id, presente: true } })
  console.log('✅ 4 funcionários criados')

  await prisma.equipamentoMovimentacao.create({ data: { descricao: 'Empilhadeira Elétrica 01', tipo: 'EMPILHADEIRA', patrimonio: 'PAT-001' } })
  await prisma.equipamentoMovimentacao.create({ data: { descricao: 'Paleteira Manual 01', tipo: 'PALETEIRA', patrimonio: 'PAT-002' } })
  await prisma.equipamentoMovimentacao.create({ data: { descricao: 'Coletor Zebra MC9300', tipo: 'COLETOR', patrimonio: 'PAT-010' } })
  console.log('✅ 3 equipamentos criados')

  // ============================================================================
  // 16. WMS — FORMAS, AMBIENTES, CLASSIFICAÇÕES, TIPOS
  // ============================================================================
  await prisma.formaArmazenagem.create({ data: { descricao: 'Paletizado' } })
  await prisma.formaArmazenagem.create({ data: { descricao: 'Caixa Fechada' } })
  await prisma.formaArmazenagem.create({ data: { descricao: 'Unitário' } })

  await prisma.ambienteArmazenagem.create({ data: { descricao: 'Ambiente Seco', temperatura: 'SECO' } })
  await prisma.ambienteArmazenagem.create({ data: { descricao: 'Câmara Fria', temperatura: 'REFRIGERADO' } })
  await prisma.ambienteArmazenagem.create({ data: { descricao: 'Câmara Congelada', temperatura: 'CONGELADO' } })

  await prisma.classificacaoProduto.create({ data: { descricao: 'Alimentos' } })
  await prisma.classificacaoProduto.create({ data: { descricao: 'Bebidas' } })
  await prisma.classificacaoProduto.create({ data: { descricao: 'Higiene e Limpeza' } })

  await prisma.tipoCarga.create({ data: { descricao: 'Carga Seca' } })
  await prisma.tipoCarga.create({ data: { descricao: 'Carga Refrigerada' } })

  const bau = await prisma.tipoCarroceria.create({ data: { descricao: 'Baú' } })
  await prisma.tipoCarroceria.create({ data: { descricao: 'Sider' } })
  await prisma.tipoCarroceria.create({ data: { descricao: 'Refrigerado' } })

  await prisma.veiculoWms.create({ data: { descricao: 'Truck Baú', placa: 'ABC1D23', marca: 'Mercedes', modelo: 'Atego 2430', ano: 2022, tipoCarroceriaId: bau.id } })
  await prisma.veiculoWms.create({ data: { descricao: 'VUC Refrigerado', placa: 'GHI9J01', marca: 'Iveco', modelo: 'Daily 35S14', ano: 2021 } })
  console.log('✅ Formas, ambientes, classificações, tipos e veículos criados')

  // ============================================================================
  // 17. WMS — SALDO POR ENDEREÇO (distribuir produtos nos endereços)
  // ============================================================================
  const produtosCodigos = ['ARROZ5KG', 'FEIJAO1KG', 'OLEO900', 'ACUCAR1KG', 'FARINHA1KG', 'LEITE1L', 'CAFE500', 'MACARRAO500', 'SAL1KG', 'MOLHO340']
  for (let i = 0; i < Math.min(produtosCodigos.length, enderecoIds.length); i++) {
    const qtd = [100, 80, 120, 150, 60, 200, 40, 90, 50, 110][i]
    await prisma.saldoEndereco.create({
      data: {
        enderecoId: enderecoIds[i],
        produtoId: produtoIds[produtosCodigos[i]],
        quantidade: qtd,
      },
    })
  }
  // Alguns produtos em múltiplos endereços
  if (enderecoIds.length > 12) {
    await prisma.saldoEndereco.create({ data: { enderecoId: enderecoIds[12], produtoId: produtoIds['ARROZ5KG'], quantidade: 200 } })
    await prisma.saldoEndereco.create({ data: { enderecoId: enderecoIds[13], produtoId: produtoIds['FEIJAO1KG'], quantidade: 150 } })
    await prisma.saldoEndereco.create({ data: { enderecoId: enderecoIds[14], produtoId: produtoIds['CAFE500'], quantidade: 80 } })
  }
  console.log('✅ Saldo por endereço criado (13 posições)')

  // ============================================================================
  // 18. WMS — PARÂMETROS
  // ============================================================================
  const params = [
    { chave: 'WMS_CONF_TIPO', valor: 'CEGA' },
    { chave: 'WMS_END_AUTO', valor: 'S' },
    { chave: 'WMS_VIDA_UTIL', valor: '70' },
    { chave: 'WMS_FIFO', valor: 'S' },
    { chave: 'WMS_CASAS_DECIMAIS', valor: '2' },
    { chave: 'WMS_MODO_OPERACAO', valor: 'AMBOS' },       // MANUAL | COLETOR | AMBOS
    { chave: 'WMS_OCR_PROVIDER', valor: 'MOCK' },          // MOCK | GOOGLE_VISION
    { chave: 'WMS_OCR_API_KEY', valor: '' },                // API key for Google Vision (used when provider = GOOGLE_VISION)
  ]
  for (const p of params) {
    await prisma.parametro.upsert({
      where: { empresaId_chave: { empresaId: empresa.id, chave: p.chave } },
      update: {}, create: { empresaId: empresa.id, ...p },
    })
  }
  console.log('✅ 8 parâmetros WMS criados')

  // ============================================================================
  // 19. WMS — AGENDAMENTOS DE RECEBIMENTO
  // ============================================================================
  const hoje = new Date()
  hoje.setHours(0, 0, 0, 0)

  await prisma.agendaWms.create({
    data: {
      empresaId: empresa.id, fornecedorId: (await prisma.fornecedor.findFirst({ where: { empresaId: empresa.id, cnpj: '11111111000101' } }))!.id,
      docaId: doca1.id, dataPrevista: hoje, horaInicio: '08:00', horaFim: '10:00',
      motorista: 'José da Silva', placa: 'ABC1D23', tipoVeiculo: 'Baú',
      qtdCaixas: 50, qtdPaletes: 4, status: 'AGENDADO',
    },
  })

  await prisma.agendaWms.create({
    data: {
      empresaId: empresa.id, fornecedorId: (await prisma.fornecedor.findFirst({ where: { empresaId: empresa.id, cnpj: '22222222000102' } }))!.id,
      docaId: doca2.id, dataPrevista: hoje, horaInicio: '10:00', horaFim: '12:00',
      motorista: 'Carlos Pereira', placa: 'GHI9J01', tipoVeiculo: 'Sider',
      qtdCaixas: 80, qtdPaletes: 8, status: 'CONFIRMADO',
    },
  })

  await prisma.agendaWms.create({
    data: {
      empresaId: empresa.id, fornecedorId: (await prisma.fornecedor.findFirst({ where: { empresaId: empresa.id, cnpj: '33333333000103' } }))!.id,
      docaId: doca1.id, dataPrevista: hoje, horaInicio: '14:00', horaFim: '16:00',
      motorista: 'Roberto Santos', placa: 'XYZ5W67',
      qtdCaixas: 30, status: 'AGENDADO',
    },
  })

  // Agendamento para amanhã
  const amanha = new Date(hoje)
  amanha.setDate(amanha.getDate() + 1)
  await prisma.agendaWms.create({
    data: {
      empresaId: empresa.id, fornecedorId: (await prisma.fornecedor.findFirst({ where: { empresaId: empresa.id, cnpj: '11111111000101' } }))!.id,
      docaId: doca3.id, dataPrevista: amanha, horaInicio: '09:00', horaFim: '11:00',
      motorista: 'Paulo Oliveira', placa: 'DEF3G45',
      qtdPaletes: 6, status: 'AGENDADO',
    },
  })
  console.log('✅ 4 agendamentos de recebimento criados (3 hoje, 1 amanhã)')

  console.log('\n🎉 Seed completo! Dados de teste criados em todos os módulos.')
  console.log('\n📋 Resumo:')
  console.log('   - 1 empresa (VisioFab Demo)')
  console.log('   - 1 usuário admin (admin@visiofab.com / 123456)')
  console.log('   - 3 fornecedores, 4 clientes, 1 transportadora, 3 vendedores')
  console.log('   - 10 produtos com dados fiscais completos')
  console.log('   - 1 tabela de preço com 4 condições')
  console.log('   - 2 pedidos de compra, 3 pedidos de venda')
  console.log('   - Estoque inicial + saldo por endereço')
  console.log('   - Contas a pagar e receber')
  console.log('   - WMS: 1 CD, 2 depósitos, 3 zonas, 4 estruturas, 24 endereços')
  console.log('   - WMS: 4 docas, 4 funcionários, 3 equipamentos')
  console.log('   - WMS: Formas, ambientes, classificações, tipos, veículos')
  console.log('   - WMS: 8 parâmetros configurados')
}

main()
  .catch((e) => { console.error(e); process.exit(1) })
  .finally(async () => { await prisma.$disconnect() })
