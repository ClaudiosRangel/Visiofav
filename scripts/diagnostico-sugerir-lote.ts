/**
 * Script de diagnóstico SOMENTE LEITURA — investiga por que GET
 * /enderecamento-wms/sugerir-lote não retornou sugestão de endereço para um
 * item de uma NotaEntrada específica.
 *
 * Não faz nenhuma escrita no banco (nenhum create/update/delete). Roda a
 * mesma lógica de resolução de produto/SKU/endereços usada na rota real,
 * mas imprime cada passo no console em vez de retornar HTTP, para expor
 * exatamente onde a cadeia para de encontrar dados.
 *
 * Uso (local, com DATABASE_URL de produção como variável de ambiente —
 * NÃO cole a senha no chat, apenas rode o comando e cole a SAÍDA aqui):
 *
 *   $env:DATABASE_URL="postgresql://...producao..."; npx tsx scripts/diagnostico-sugerir-lote.ts --notaNumero=1233
 *
 * ou, se souber o notaEntradaId (uuid):
 *
 *   npx tsx scripts/diagnostico-sugerir-lote.ts --notaId=<uuid>
 */

import { PrismaClient } from '@prisma/client'
import { selecionarSkuMaster, converterParaUnidadeMaster, type SkuInfo } from '../src/modules/enderecamento-inteligente/conversor-unidade.service'
import { calcularCapacidadePalete, calcularDistribuicao, type EnderecoComCapacidade } from '../src/modules/enderecamento-inteligente/motor-distribuicao.service'
import { ordenarPorProximidade, type EnderecoCandidate } from '../src/modules/enderecamento-inteligente/alocador-proximidade.service'

const prisma = new PrismaClient()

function parseArgs() {
  const args = process.argv.slice(2)
  const result: Record<string, string> = {}
  for (const arg of args) {
    const m = arg.match(/^--([^=]+)=(.*)$/)
    if (m) result[m[1]] = m[2]
  }
  return result
}

function linha() {
  console.log('─'.repeat(70))
}

async function main() {
  const { notaId, notaNumero } = parseArgs()

  if (!notaId && !notaNumero) {
    console.error('Uso: npx tsx scripts/diagnostico-sugerir-lote.ts --notaId=<uuid>  OU  --notaNumero=<numero>')
    process.exit(1)
  }

  linha()
  console.log('DIAGNÓSTICO — sugerir-lote (somente leitura, nenhuma escrita será feita)')
  linha()

  const nota = notaId
    ? await prisma.notaEntrada.findFirst({ where: { id: notaId }, include: { itens: true } })
    : await prisma.notaEntrada.findFirst({ where: { numero: Number(notaNumero) }, include: { itens: true }, orderBy: { criadoEm: 'desc' } })

  if (!nota) {
    console.error('❌ Nota de entrada não encontrada com esse filtro.')
    process.exit(1)
  }

  console.log(`Nota: numero=${nota.numero} status=${nota.status} empresaId=${nota.empresaId} fornecedor=${nota.fornecedor}`)
  console.log(`Itens: ${nota.itens.length}`)
  linha()

  if (nota.status !== 'CONFERIDA') {
    console.warn(`⚠️  Nota não está CONFERIDA (está ${nota.status}) — a rota real retornaria 422 antes de chegar na lógica de sugestão.`)
  }

  for (const item of nota.itens) {
    console.log(`\n### Item ${item.item} — ${item.descricao} (codigoProduto="${item.codigoProduto}")`)
    console.log(`    quantidade=${item.quantidade}  lote=${item.lote}  validade=${item.validade}`)

    if (!item.codigoProduto) {
      console.log('    ❌ item.codigoProduto está vazio — produto nunca será resolvido.')
      continue
    }

    const produto = await prisma.produto.findFirst({
      where: { codigo: item.codigoProduto, empresaId: nota.empresaId ?? undefined },
    })

    if (!produto) {
      console.log(`    ❌ Nenhum Produto encontrado com codigo="${item.codigoProduto}" e empresaId="${nota.empresaId}".`)
      console.log('       Verificando se existe em OUTRA empresa (para detectar mismatch de empresaId)...')
      const produtoOutraEmpresa = await prisma.produto.findFirst({ where: { codigo: item.codigoProduto } })
      if (produtoOutraEmpresa) {
        console.log(`       ⚠️  Encontrado em empresaId="${produtoOutraEmpresa.empresaId}" — MISMATCH de empresa é a causa raiz.`)
      } else {
        console.log('       Não encontrado em nenhuma empresa.')
      }
      continue
    }

    console.log(`    ✅ Produto resolvido: id=${produto.id} nome="${produto.nome}" empresaId=${produto.empresaId}`)

    const skusRaw = await prisma.sku.findMany({ where: { produtoId: produto.id }, orderBy: { sequencia: 'asc' } })
    console.log(`    SKUs cadastrados: ${skusRaw.length}`)
    for (const s of skusRaw) {
      console.log(`      seq=${s.sequencia} unidade=${s.unidade} qtdEmbalagem=${s.qtdEmbalagem} lastro=${s.lastro} camada=${s.camada} codigoBarra=${s.codigoBarra}`)
    }

    if (skusRaw.length === 0) {
      console.log('    ❌ Produto sem nenhum SKU cadastrado — motor novo vai lançar erro e cair no fallback legado.')
    }

    const skus: SkuInfo[] = skusRaw.map((s) => ({ id: s.id, sequencia: s.sequencia, qtdEmbalagem: s.qtdEmbalagem, lastro: s.lastro, camada: s.camada }))

    let skuMaster: SkuInfo | null = null
    try {
      skuMaster = selecionarSkuMaster(skus)
      console.log(`    ✅ SKU master selecionado: seq=${skuMaster.sequencia} lastro=${skuMaster.lastro} camada=${skuMaster.camada} qtdEmbalagem=${skuMaster.qtdEmbalagem}`)
    } catch (err) {
      console.log(`    ❌ selecionarSkuMaster falhou: ${err instanceof Error ? err.message : err}`)
      console.log('       → Motor novo cai no fallback legado (SugestaoEnderecoService).')
    }

    if (skuMaster) {
      const skuExpedicao = skus[0]
      console.log(`    SKU expedição (skus[0]): seq=${skuExpedicao.sequencia} qtdEmbalagem=${skuExpedicao.qtdEmbalagem}`)

      if (!skuExpedicao.qtdEmbalagem || !skuMaster.qtdEmbalagem) {
        console.log(`    ❌ qtdEmbalagem ausente/zero em skuExpedicao (${skuExpedicao.qtdEmbalagem}) ou skuMaster (${skuMaster.qtdEmbalagem}) — geraria NaN/Infinity na conversão.`)
      }

      const { quantidadeMaster, fatorConversao } = converterParaUnidadeMaster({
        quantidade: Number(item.quantidade),
        skuExpedicao,
        skuMaster,
      })
      console.log(`    Conversão: quantidade=${item.quantidade} × fator=${fatorConversao} = quantidadeMaster=${quantidadeMaster}`)
      if (!Number.isFinite(quantidadeMaster) || quantidadeMaster <= 0) {
        console.log(`    ❌ quantidadeMaster inválida (${quantidadeMaster}) — calcularDistribuicao não vai alocar nada, SEM lançar erro (não cai no fallback).`)
      }

      const capacidadePalete = calcularCapacidadePalete(skuMaster.lastro, skuMaster.camada, null)
      console.log(`    Capacidade por posição (lastro×camada): ${capacidadePalete}`)
      if (capacidadePalete <= 0) {
        console.log('    ❌ Capacidade calculada é 0 — nenhum endereço teria "disponível" > 0.')
      }

      const dadosArmazenagem = await prisma.dadosLogisticosArmazenagem.findFirst({ where: { produtoId: produto.id } })
      const dadosPicking = await prisma.dadosLogisticosPicking.findFirst({ where: { produtoId: produto.id } })
      console.log(`    DadosLogisticosArmazenagem: ${dadosArmazenagem ? JSON.stringify({ enderecoFixoId: dadosArmazenagem.enderecoFixoId, nivelMinPP: dadosArmazenagem.nivelMinPP, nivelMaxPP: dadosArmazenagem.nivelMaxPP }) : 'nenhum'}`)
      console.log(`    DadosLogisticosPicking: ${dadosPicking ? JSON.stringify({ enderecoPickingId: dadosPicking.enderecoPickingId }) : 'nenhum'}`)

      let nivelMin = dadosArmazenagem?.nivelMinPP ?? 1
      let nivelMax = dadosArmazenagem?.nivelMaxPP ?? 99
      if (nivelMin === 0) nivelMin = 1
      if (nivelMax === 0) nivelMax = 99
      console.log(`    Faixa de nível considerada: [${nivelMin}, ${nivelMax}]`)

      const enderecosCandidatos = await prisma.endereco.findMany({
        where: {
          tipo: { in: ['ARMAZENAGEM', 'LIVRE'] },
          status: true,
          OR: [{ empresaId: nota.empresaId ?? undefined }, { empresaId: null }],
          saldos: { none: { quantidade: { gt: 0 } } },
        },
        include: { estrutura: true, saldos: true },
      })
      console.log(`    Endereços livres candidatos (query real da rota): ${enderecosCandidatos.length}`)

      if (enderecosCandidatos.length === 0) {
        console.log('    ❌ Query de endereços livres retornou ZERO — verificando causa exata...')
        const todosEnderecosEmpresa = await prisma.endereco.findMany({
          where: { OR: [{ empresaId: nota.empresaId ?? undefined }, { empresaId: null }] },
          include: { saldos: true },
        })
        console.log(`       Total de endereços (qualquer tipo/status) para essa empresa/null: ${todosEnderecosEmpresa.length}`)
        for (const e of todosEnderecosEmpresa.slice(0, 20)) {
          const saldoTotal = e.saldos.reduce((acc, s) => acc + Number(s.quantidade), 0)
          console.log(`         ${e.enderecoCompleto}  tipo=${e.tipo}  status=${e.status}  empresaId=${e.empresaId}  saldoTotal=${saldoTotal}  estruturaId=${e.estruturaId}`)
        }
      } else {
        const candidatosProximidade: EnderecoCandidate[] = enderecosCandidatos.map((e) => ({
          id: e.id,
          rua: e.codigoRua ?? '',
          predio: parseInt(e.codigoPredio || '1', 10) || 1,
          nivel: parseInt(e.codigoNivel || '1', 10) || 1,
          apartamento: parseInt(e.codigoApto || '1', 10) || 1,
          enderecoCompleto: e.enderecoCompleto ?? '',
          estruturaId: e.estruturaId,
          classificacaoProdutoId: e.classificacaoProdutoId,
        }))

        const ordenados = ordenarPorProximidade({
          candidatos: candidatosProximidade,
          predioOrigem: 1,
          ruaOrigem: 'A',
          nivelMin,
          nivelMax,
        })
        console.log(`    Após filtro de nível [${nivelMin}, ${nivelMax}] e ordenação: ${ordenados.length} candidatos restantes.`)
        if (ordenados.length === 0 && enderecosCandidatos.length > 0) {
          console.log('    ❌ TODOS os candidatos foram filtrados pela faixa de nível! Níveis reais dos endereços:')
          for (const e of enderecosCandidatos.slice(0, 20)) {
            console.log(`         ${e.enderecoCompleto}  codigoNivel="${e.codigoNivel}"  parseInt=${parseInt(e.codigoNivel || '1', 10) || 1}`)
          }
        }

        const enderecosComCapacidade: EnderecoComCapacidade[] = []
        for (const candidato of ordenados) {
          const original = enderecosCandidatos.find((e) => e.id === candidato.id)!
          const capacidade = calcularCapacidadePalete(skuMaster.lastro, skuMaster.camada, original.estrutura?.capacidade ? Number(original.estrutura.capacidade) : null)
          if (capacidade > 0) {
            enderecosComCapacidade.push({
              id: candidato.id, enderecoCompleto: candidato.enderecoCompleto, rua: candidato.rua,
              predio: original.codigoPredio ?? '', nivel: original.codigoNivel ?? '', apartamento: original.codigoApto ?? '',
              capacidadePalete: capacidade, saldoAtual: 0, disponivel: capacidade,
            })
          }
        }
        console.log(`    Endereços com capacidade > 0 (prontos para alocação): ${enderecosComCapacidade.length}`)

        const distribuicao = calcularDistribuicao({ quantidade: quantidadeMaster, enderecosOrdenados: enderecosComCapacidade })
        console.log(`    RESULTADO calcularDistribuicao: alocacoes=${distribuicao.alocacoes.length} quantidadeAlocada=${distribuicao.quantidadeAlocada} quantidadeRestante=${distribuicao.quantidadeRestante} completa=${distribuicao.completa}`)
        if (distribuicao.alocacoes.length > 0) {
          console.log('    ✅ SUGESTÃO DEVERIA TER SIDO GERADA. Se a tela não mostrou, o problema é no fluxo/estado do frontend, não no backend.')
          for (const a of distribuicao.alocacoes) console.log(`         → ${a.enderecoCompleto}: ${a.quantidadeAlocada} un`)
        } else {
          console.log('    ❌ Nenhuma alocação gerada pelo motor novo — cai no bloco try/catch da rota real? NÃO, pois não houve exceção. A rota real retornaria distribuicao vazia (sugestao: null implícito) sem cair no fallback legado.')
        }
      }
    }

    linha()
  }

  await prisma.$disconnect()
}

main().catch(async (err) => {
  console.error('Erro inesperado no diagnóstico:', err)
  await prisma.$disconnect()
  process.exit(1)
})
