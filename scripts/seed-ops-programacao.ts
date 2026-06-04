import { PrismaClient } from '@prisma/client'
const p = new PrismaClient()

async function main() {
  const e = await p.empresa.findFirst()
  if (!e) { console.log('Sem empresa'); return }
  const eid = e.id

  const prod = await p.produto.findFirst({ where: { empresaId: eid, codigo: 'CX-P50-ESF07' } })
  if (!prod) { console.log('Produto nao encontrado'); return }

  const est = await p.estruturaProduto.findFirst({ where: { empresaId: eid, produtoId: prod.id, status: 'ATIVA' } })
  const rot = await p.roteiroProducao.findFirst({ where: { empresaId: eid, produtoId: prod.id, status: 'ATIVO' }, include: { etapas: true } })
  const cli = await p.cliente.findFirst({ where: { empresaId: eid } })

  const exemplos = [
    { num: 2700, cliente: 'Cervejaria Imperio', produto: 'Caixa 18 garrafas imperio gold', qtd: 11000, prio: 'URGENTE' },
    { num: 2701, cliente: 'Belgo', produto: 'Involucro Belgo motto mundial 500M', qtd: 22000, prio: 'ALTA' },
    { num: 2702, cliente: 'Energy Fruit', produto: 'Pote de Acai 10L com banana', qtd: 44000, prio: 'ALTA' },
    { num: 2703, cliente: 'Embelezze', produto: 'Cartucho Dup Display Salon', qtd: 500, prio: 'NORMAL' },
    { num: 2704, cliente: 'Cafe 3 Coracoes', produto: 'Caixa Capp Cafe Multisabor', qtd: 11000, prio: 'NORMAL' },
  ]

  for (let i = 0; i < exemplos.length; i++) {
    const ex = exemplos[i]
    const existe = await p.ordemProducao.findFirst({ where: { empresaId: eid, numero: ex.num } })
    if (existe) { console.log(`OP ${ex.num} ja existe, pulando`); continue }

    const op = await p.ordemProducao.create({
      data: {
        empresaId: eid,
        numero: ex.num,
        produtoId: prod.id,
        estruturaProdutoId: est?.id,
        quantidade: ex.qtd,
        unidadeMedida: 'UN',
        dataEntregaPrevista: new Date(2026, 4, 10 + i * 3),
        prioridade: ex.prio,
        clienteId: cli?.id,
        observacoes: `${ex.cliente} - ${ex.produto}`,
        status: 'PROGRAMADA',
      },
    })

    if (rot && rot.etapas.length > 0) {
      await p.etapaOrdemProducao.createMany({
        data: rot.etapas.map((et) => ({
          ordemProducaoId: op.id,
          sequencia: et.sequencia,
          descricao: et.descricao,
          centroProducaoId: et.centroProducaoId,
          tempoSetupMinutos: Number(et.tempoSetupMinutos),
          tempoOperacaoCalculado: Number(et.tempoOperacaoMinutos) * ex.qtd,
          tempoEsperaMinutos: Number(et.tempoEsperaMinutos),
          status: i < 2 ? 'EM_ANDAMENTO' : 'PENDENTE',
        })),
      })
    }

    console.log(`✓ OP #${ex.num} - ${ex.cliente} - ${ex.produto} (${ex.qtd} un)`)
  }

  console.log('\nPronto! 5 OPs de exemplo para programação.')
}

main().catch(console.error).finally(() => p.$disconnect())
