import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  console.log('🌱 Criando NFs livres para Montagem de Carga...\n')

  const empresa = await prisma.empresa.findFirst()
  if (!empresa) throw new Error('Empresa não encontrada')

  const produtos = await prisma.produto.findMany({ where: { empresaId: empresa.id } })
  const clientes = await prisma.cliente.findMany({ where: { empresaId: empresa.id, status: true } })
  const tabela = await prisma.tabelaPreco.findFirst({ where: { empresaId: empresa.id } })
  const vendedor = await prisma.vendedor.findFirst({ where: { empresaId: empresa.id } })
  const rotas = await prisma.rota.findMany({ where: { empresaId: empresa.id } })

  if (!tabela || clientes.length < 5 || produtos.length < 5) {
    throw new Error('Dados base insuficientes')
  }

  const maxNumPV = (await prisma.pedidoVenda.findFirst({ where: { empresaId: empresa.id }, orderBy: { numero: 'desc' } }))?.numero || 0
  const maxNumNfe = (await prisma.nfe.findFirst({ where: { empresaId: empresa.id }, orderBy: { numero: 'desc' } }))?.numero || 0

  console.log(`Base: ${clientes.length} clientes, ${produtos.length} produtos, ${rotas.length} rotas`)
  console.log(`Último PV: ${maxNumPV}, Última NF: ${maxNumNfe}`)

  // Criar 15 NFs livres (com fluxo completo PedidoVenda → VendaEfetivada → Nfe)
  for (let i = 0; i < 15; i++) {
    const cliente = clientes[i % clientes.length]
    const rota = rotas.length > 0 ? rotas[i % rotas.length] : null
    const prodsSelecionados = [
      produtos[i % produtos.length],
      produtos[(i + 3) % produtos.length],
      produtos[(i + 5) % produtos.length],
    ]

    const qtds = [20 + i * 5, 15 + i * 3, 10 + i * 2]
    const itens = prodsSelecionados.map((p, idx) => ({
      produtoId: p.id,
      quantidade: qtds[idx],
      precoBase: Number(p.precoBase),
      precoFinal: Number(p.precoBase),
      valorTotal: Number(p.precoBase) * qtds[idx],
    }))
    const valorTotal = itens.reduce((s, it) => s + it.valorTotal, 0)

    // 1. Pedido de Venda (FATURADO)
    const pv = await prisma.pedidoVenda.create({
      data: {
        empresaId: empresa.id,
        numero: maxNumPV + 300 + i + 1,
        clienteId: cliente.id,
        vendedorId: vendedor?.id || undefined,
        tabelaPrecoId: tabela.id,
        rotaId: rota?.id || undefined,
        valorTotal,
        status: 'FATURADO',
        itens: { create: itens },
      },
    })

    // 2. Venda Efetivada
    const ve = await prisma.vendaEfetivada.create({
      data: {
        empresaId: empresa.id,
        pedidoVendaId: pv.id,
        valorTotal,
        statusEntrega: 'PENDENTE',
      },
    })

    // 3. NF-e (AUTORIZADA, mapaOk = false)
    const itensPV = await prisma.itemPedidoVenda.findMany({
      where: { pedidoVendaId: pv.id },
      include: { produto: true },
    })

    await prisma.nfe.create({
      data: {
        empresaId: empresa.id,
        vendaEfetivadaId: ve.id,
        numero: maxNumNfe + 3000 + i + 1,
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
            uCom: item.produto?.unidade || 'UN',
            qCom: item.quantidade,
            vUnCom: item.precoFinal,
            vProd: item.valorTotal,
          })),
        },
      },
    })
  }

  console.log('✅ 15 NFs livres criadas (AUTORIZADA, mapaOk=false, não vinculadas a mapa)')
  console.log('   Essas NFs aparecerão na tela de Montagem de Carga')
}

main()
  .catch((e) => { console.error('❌ Erro:', e.message); process.exit(1) })
  .finally(async () => { await prisma.$disconnect() })
