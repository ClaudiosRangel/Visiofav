// Servico_Copia — núcleo transacional da cópia de Cálculo Padrão.
//
// Spec: orcamento-grafico-paridade-fluxo-legado (tarefa 3.1; design "Servico_Copia").
//
// Um único serviço atende três usos:
//   - 'ITEM'   → "Usar"/"Copiar": cria um CalculoGrafico NOVO + ItemOrcamentoGrafico
//                no orçamento, vinculados (calculoGraficoId + calculoGraficoOrigemId);
//   - 'PADRAO' → "Copiar" no Menu Cálculo Padrão: cria só o CalculoGrafico novo;
//   - 'EDICAO' → "Editar" cálculo migrado/ancorado: cria cópia RASCUNHO, origem VIZOR.
//
// Garantias:
//   - UMA `prisma.$transaction`; qualquer falha reverte tudo e NÃO consome número
//     (número = max+1, não sequence);
//   - `pg_advisory_xact_lock(hashtext(empresaId))` antes de calcular o número;
//   - P2002 em (empresaId, numero): repete 1 vez; depois 409;
//   - guarda de empresa: 404 (não existe) × 403 (outra empresa), sem devolver campos
//     da origem; todo registro criado recebe o `empresaId` do cálculo de ORIGEM;
//     toda query filtra `empresaId` explicitamente;
//   - a cópia NÃO chama o motor (`calcularOrcamentoGrafico`) nem altera
//     `ancorarCustoCalcgraf`. A engenharia do item vem de `copiarCalculoParaItem`
//     (routes), reaproveitada sem mudança de comportamento.
//
// TAREFA 3.2 (NÃO implementada aqui) — pontos de extensão marcados com `EXT-3.2`.

import { Prisma } from '@prisma/client'
import { prisma } from '../../../lib/prisma'
import type { ResultadoOrcamento } from '../orcamento-grafico-calculo.service'
import { aplicarDecomposicaoStc, normalizarCustosStc } from './decomposicao-stc.service'
import type { FotoRicaCalculo } from './foto-rica.types'
import {
  montarPlanoBase,
  planoBaseParaGravar,
  resolverSigla,
  type CalculoParaPlanoBase,
  type PlanoBaseParaGravar,
} from './plano-base.service'
import { projetarFoto } from './projecao-foto.service'
import { resolverProdutoGrafico, resolverTipoPlano } from './resolucao-catalogo.service'

export type ModoCopia = 'ITEM' | 'PADRAO' | 'EDICAO'

export interface CopiarCalculoParams {
  /** Empresa da sessão. */
  empresaId: string
  usuarioId: string
  /** Cálculo Padrão de origem. */
  origemId: string
  modo: ModoCopia
  /** Obrigatório quando `modo = 'ITEM'`. */
  orcamentoId?: string
  novaQuantidade?: number
}

export type AvisoCopia =
  | { codigo: 'PRODUTO_NAO_RESOLVIDO' | 'TIPO_PLANO_NAO_RESOLVIDO'; campo: 'produtoGraficoId' | 'tipoPlanoId' }
  | { codigo: 'FOTO_SEM_CAMPOS'; campos: Array<'margemSelecionada' | 'margem' | 'cm' | 'cev'> }
  | { codigo: 'DECOMPOSICAO_INDISPONIVEL' }
  | { codigo: 'PLANO_BASE_NAO_PREENCHIDO' }

export interface CopiarCalculoResultado {
  calculoId: string
  numeroCalculo: number
  /** Só no modo 'ITEM'. */
  itemId?: string
  avisos: AvisoCopia[]
}

/** Erro de regra de negócio da cópia (a rota traduz `statusCode`). */
export class CopiaCalculoError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number = 400,
  ) {
    super(message)
    this.name = 'CopiaCalculoError'
  }
}

/** Funções de `orcamento-grafico.routes.ts` reaproveitadas (injetáveis em teste). */
export interface CopiaDeps {
  copiarCalculoParaItem: (calc: any, novaQuantidade?: number) => { dadosItem: Record<string, any> }
  resolverMaquinaDeOrigem: (empresaId: string, calc: any) => Promise<string | null>
}

/**
 * Carga tardia das funções da rota: evita ciclo de import estático
 * (routes → copia.service → routes). Só é usada em runtime, na 1ª chamada.
 */
async function depsPadrao(): Promise<CopiaDeps> {
  const mod = await import('../orcamento-grafico.routes')
  return {
    copiarCalculoParaItem: mod.copiarCalculoParaItem as unknown as CopiaDeps['copiarCalculoParaItem'],
    resolverMaquinaDeOrigem: mod.resolverMaquinaDeOrigem as unknown as CopiaDeps['resolverMaquinaDeOrigem'],
  }
}

type Tx = Prisma.TransactionClient

/** Json? nulo precisa de `Prisma.DbNull` no create; valor presente passa direto. */
function json(v: unknown): Prisma.InputJsonValue | typeof Prisma.DbNull {
  return v == null ? Prisma.DbNull : (v as Prisma.InputJsonValue)
}

/** Trava por empresa + `max(numero)+1` (filtrado por empresa). Rollback devolve o número. */
async function proximoNumeroCalculo(tx: Tx, empresaId: string): Promise<number> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${empresaId}))`
  const maior = await tx.calculoGrafico.findFirst({
    where: { empresaId },
    orderBy: { numero: 'desc' },
    select: { numero: true },
  })
  return (maior?.numero ?? 0) + 1
}

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100

function ehColisaoNumero(err: unknown): boolean {
  const e = err as { code?: string; meta?: { target?: unknown } } | null
  if (e?.code !== 'P2002') return false
  const alvo = e.meta?.target
  // Sem `target` informado, assume a única unique relevante da operação.
  if (alvo == null) return true
  const texto = Array.isArray(alvo) ? alvo.join(',') : String(alvo)
  return texto.includes('numero') && texto.includes('empresa')
}

/**
 * Copia um Cálculo Padrão conforme o `modo`. Ver cabeçalho do arquivo.
 *
 * @param deps injeção opcional (testes); por padrão usa as funções da rota.
 */
export async function copiarCalculo(
  params: CopiarCalculoParams,
  deps?: CopiaDeps,
): Promise<CopiarCalculoResultado> {
  const { empresaId, usuarioId, origemId, modo, orcamentoId, novaQuantidade } = params

  if (modo === 'ITEM' && !orcamentoId) {
    throw new CopiaCalculoError('orcamentoId é obrigatório para cópia em item de orçamento', 400)
  }

  // ── Guarda de empresa ─────────────────────────────────────────────────────
  // `findUnique({id})` apenas para separar 404 de 403; nenhum campo da origem é devolvido.
  const guarda = await prisma.calculoGrafico.findUnique({
    where: { id: origemId },
    select: { empresaId: true },
  })
  if (!guarda) throw new CopiaCalculoError('Cálculo não encontrado', 404)
  if (guarda.empresaId !== empresaId) {
    throw new CopiaCalculoError('Acesso negado: cálculo de outra empresa', 403)
  }

  // Empresa DONA do cálculo de origem: todo registro criado recebe este valor.
  const empresaOrigem = guarda.empresaId

  // Origem completa (empresaId explícito).
  const origem = await prisma.calculoGrafico.findFirst({ where: { id: origemId, empresaId: empresaOrigem } })
  if (!origem) throw new CopiaCalculoError('Cálculo não encontrado', 404)

  // Orçamento de destino (modo ITEM) precisa ser da mesma empresa.
  let orcamentoDestino: { id: string; serie: string | null; dataOrcamento: Date | null } | null = null
  if (modo === 'ITEM') {
    orcamentoDestino = await prisma.orcamentoGrafico.findFirst({
      where: { id: orcamentoId, empresaId: empresaOrigem },
      select: { id: true, serie: true, dataOrcamento: true },
    })
    if (!orcamentoDestino) throw new CopiaCalculoError('Orçamento não encontrado', 404)
  }

  const d = deps ?? (await depsPadrao())

  // Engenharia do item (modo ITEM): helper existente da rota, SEM recálculo pelo motor.
  let dadosItem: Record<string, any> | null = null
  if (modo === 'ITEM') {
    dadosItem = d.copiarCalculoParaItem(origem, novaQuantidade).dadosItem
    // Mesma regra das rotas de-calculo: migrado sem máquina → deriva do STC.
    if (dadosItem.maquinaId == null) {
      const maquinaId = await d.resolverMaquinaDeOrigem(empresaOrigem, origem)
      if (maquinaId) dadosItem.maquinaId = maquinaId
    }
  }

  const avisos: AvisoCopia[] = []

  // ── Tarefa 3.2 (modo ITEM): tudo calculado ANTES da transação (leituras de catálogo
  // sempre filtradas por empresaId; o motor NÃO é chamado). ─────────────────────
  let fotoCusto = 0
  let planoBase: PlanoBaseParaGravar | null = null
  let planoBaseGramatura: number | null = null
  let planoBaseNumCores = 0
  let planoBaseFormato: { larguraMm: number; alturaMm: number } | null = null

  if (modo === 'ITEM' && dadosItem) {
    const foto = (origem.resultadoCalculo ?? null) as FotoRicaCalculo | null

    // Resolução de Produto Gráfico e Tipo de Plano (6.1–6.3).
    const produtosAtivos = await prisma.produtoGrafico.findMany({
      where: { empresaId: empresaOrigem, status: true },
      select: { id: true, nome: true, tipoEmbalagemId: true, status: true },
    })
    const resProduto = resolverProdutoGrafico(
      { tipoEmbalagemId: origem.tipoEmbalagemId, produto: origem.produto },
      produtosAtivos,
    )
    let tipoPlanoId: string | null = null
    if (resProduto.id) {
      const defaults = await prisma.defaultProdutoPlano.findMany({
        where: { empresaId: empresaOrigem, produtoId: resProduto.id },
        select: { produtoId: true, tipoPlanoId: true },
      })
      const tipos = await prisma.tipoPlanoGrafico.findMany({
        where: { empresaId: empresaOrigem, id: { in: defaults.map((x) => x.tipoPlanoId) } },
        select: { id: true, fixo: true, status: true },
      })
      tipoPlanoId = resolverTipoPlano({ id: resProduto.id }, defaults, tipos).id
    }
    if (!resProduto.id) avisos.push({ codigo: 'PRODUTO_NAO_RESOLVIDO', campo: 'produtoGraficoId' })
    if (!tipoPlanoId) avisos.push({ codigo: 'TIPO_PLANO_NAO_RESOLVIDO', campo: 'tipoPlanoId' })

    // Custo da Foto (mesma regra de `copiarCalculoParaItem`): é a referência da validação.
    fotoCusto = Number(
      foto?.custos?.custoProducao ?? origem.custoProducao ?? (foto as { custoProducao?: number } | null)?.custoProducao ?? 0,
    )

    // Resultado do item: cópia da Foto + projeções (sem motor).
    const resultado = JSON.parse(JSON.stringify(dadosItem.resultadoCalculo ?? {})) as ResultadoOrcamento &
      Record<string, unknown>
    const custoItem = Number(dadosItem.custoProducao ?? 0)

    // Margem / CM / CEV (6.4, 6.5).
    const proj = projetarFoto(foto)
    if (proj.faltantes.length > 0) avisos.push({ codigo: 'FOTO_SEM_CAMPOS', campos: proj.faltantes })
    // CM/CEV não têm coluna no item: ficam no resultadoCalculo (como a ancoragem faz com os totais).
    if (proj.cmPerc !== null) {
      resultado.contribuicaoMarginalPerc = proj.cmPerc
      // O Fechamento lê `contribuicaoMarginalValor` (R$). A Foto só guarda o %: deriva-se de
      // % × valorTotal da margem selecionada (fallback: valorTotal do item). Sem base, não inventa.
      const baseValor = Number(proj.margemSelecionada?.valorTotal ?? dadosItem.valorTotal ?? 0)
      if (Number.isFinite(baseValor) && baseValor > 0) {
        resultado.contribuicaoMarginalValor = Math.round(((proj.cmPerc / 100) * baseValor) * 100) / 100
      }
    }
    if (proj.cevPerc !== null) resultado.cevPerc = proj.cevPerc

    // Decomposição STC (6.6, 6.7): só aplica se MD+CT+SE fechar com o custo da Foto (±0,01).
    const stc = normalizarCustosStc(origem.custosCalcgraf)
    if (stc && Math.abs(stc.materialDireto + stc.custoTransformacao - fotoCusto) <= 0.01) {
      aplicarDecomposicaoStc(resultado, origem.custosCalcgraf)
      // Mantém exatamente o custo da Foto no item (a soma dos componentes pode diferir em centavos).
      resultado.custoProducao = custoItem
      ;(resultado as { custoTotal?: number }).custoTotal = custoItem
    } else {
      avisos.push({ codigo: 'DECOMPOSICAO_INDISPONIVEL' })
    }

    // Série e data do cabeçalho do orçamento: o item não tem colunas próprias para isso.
    resultado.cabecalhoOrcamento = {
      serie: orcamentoDestino?.serie ?? null,
      dataOrcamento: orcamentoDestino?.dataOrcamento ? orcamentoDestino.dataOrcamento.toISOString() : null,
    }

    // Sigla (regra "(vários)") e Modelos = 1.
    const sigla = resolverSigla([origem.siglaAcabado, foto?.cabecalho?.siglaAcabado])

    dadosItem = {
      ...dadosItem,
      resultadoCalculo: resultado,
      ...(proj.margemPerc !== null ? { margemSelecionada: proj.margemPerc } : {}),
      qtdModelos: 1,
      siglaAcabado: sigla ?? dadosItem.siglaAcabado ?? null,
      produtoGraficoId: resProduto.id,
      tipoPlanoId,
    }

    // Plano_Base (gravado por último, dentro da transação).
    const pb = montarPlanoBase(origem as unknown as CalculoParaPlanoBase, foto)
    planoBase = planoBaseParaGravar(pb)
    planoBaseGramatura = pb.suporte?.gramatura ?? null
    planoBaseNumCores = pb.cores.length
    planoBaseFormato = pb.formatoCorte
  }

  const executar = () =>
    prisma.$transaction(
      async (tx) => {
        const avisosTx: AvisoCopia[] = []
        const novo = await criarCalculoCopiaTx(tx, origem, { empresaId: empresaOrigem, usuarioId, modo })

        let itemId: string | undefined

        if (modo === 'ITEM' && dadosItem) {
          const ultimo = await tx.itemOrcamentoGrafico.findFirst({
            where: { orcamentoId, empresaId: empresaOrigem },
            orderBy: { sequencia: 'desc' },
            select: { sequencia: true },
          })

          const item = await tx.itemOrcamentoGrafico.create({
            data: {
              orcamentoId: orcamentoId!,
              empresaId: empresaOrigem,
              sequencia: (ultimo?.sequencia ?? 0) + 1,
              ...(dadosItem as object),
              // Vínculo com o cálculo PRÓPRIO do item e com o Cálculo Padrão de origem
              // (este último é a chave da ancoragem — não alterar a semântica).
              calculoGraficoId: novo.id,
              calculoGraficoOrigemId: origem.id,
            } as Prisma.ItemOrcamentoGraficoUncheckedCreateInput,
            select: { id: true, custoProducao: true },
          })
          itemId = item.id

          // aproveitamento_manual real (mesma regra das rotas de-calculo); sem isso o motor
          // recalcula o encaixe geométrico.
          if (origem.aproveitamentoManual != null && Number(origem.aproveitamentoManual) > 0) {
            await tx.$executeRaw`UPDATE item_orcamento_grafico SET aproveitamento_manual = ${Number(origem.aproveitamentoManual)} WHERE id = ${item.id} AND empresa_id = ${empresaOrigem}`
          }

          // Custo do item == custo da Foto (2 casas). Divergência reverte tudo (422).
          if (r2(Number(item.custoProducao ?? 0)) !== r2(fotoCusto)) {
            throw new CopiaCalculoError('Divergência de custo na cópia', 422)
          }

          // Plano_Base POR ÚLTIMO, isolado por SAVEPOINT: se falhar, o item fica sem Plano_Base.
          if (planoBase) {
            await tx.$executeRaw`SAVEPOINT plano_base_copia`
            try {
              await tx.planoCalculoGrafico.create({
                data: {
                  itemId: item.id,
                  empresaId: empresaOrigem,
                  sequencia: 1,
                  nome: planoBase.nome,
                  gramatura: planoBaseGramatura,
                  // Colunas NOT NULL > 0: o formato real fica em `especificacao`; ausente usa 0,01
                  // (mesmo fallback dos planos espelho da Foto).
                  formatoLarguraMm: planoBaseFormato && planoBaseFormato.larguraMm > 0 ? planoBaseFormato.larguraMm : 0.01,
                  formatoAlturaMm: planoBaseFormato && planoBaseFormato.alturaMm > 0 ? planoBaseFormato.alturaMm : 0.01,
                  numCores: planoBaseNumCores,
                  especificacao: planoBase.especificacao as unknown as Prisma.InputJsonValue,
                },
                select: { id: true },
              })
              await tx.$executeRaw`RELEASE SAVEPOINT plano_base_copia`
            } catch {
              await tx.$executeRaw`ROLLBACK TO SAVEPOINT plano_base_copia`
              avisosTx.push({ codigo: 'PLANO_BASE_NAO_PREENCHIDO' })
            }
          }
        }

        return { calculoId: novo.id, numeroCalculo: novo.numero, itemId, avisosTx }
      },
      { timeout: 30000, maxWait: 10000 },
    )

  // P2002 em (empresaId, numero): 1 repetição; depois 409.
  let resultado: Awaited<ReturnType<typeof executar>>
  try {
    resultado = await executar()
  } catch (err) {
    if (!ehColisaoNumero(err)) throw err
    try {
      resultado = await executar()
    } catch (err2) {
      if (ehColisaoNumero(err2)) {
        throw new CopiaCalculoError('Número de cálculo já existe para esta empresa', 409)
      }
      throw err2
    }
  }

  const { avisosTx, ...base } = resultado
  return { ...base, avisos: [...avisos, ...avisosTx] }
}

/**
 * Cria, DENTRO da transação `tx` do chamador, o CalculoGrafico novo copiado de `origem`
 * (número = max+1 da empresa sob `pg_advisory_xact_lock`; origemCopiaId = origem.id).
 * Não abre transação própria: falha do chamador reverte o cálculo e devolve o número.
 * Usado por `copiarCalculo` e por `item-copia.service` (cópia de item).
 */
export async function criarCalculoCopiaTx(
  tx: Tx,
  origem: Prisma.CalculoGraficoGetPayload<object>,
  opts: { empresaId: string; usuarioId: string | null; modo: ModoCopia },
): Promise<{ id: string; numero: number }> {
  const { empresaId: empresaOrigem, usuarioId, modo } = opts
  const numero = await proximoNumeroCalculo(tx, empresaOrigem)
  {
        const novo = await tx.calculoGrafico.create({
          data: {
            empresaId: empresaOrigem,
            numero,
            numeroCalcgraf: null, // único por empresa; a cópia nunca herda
            origem: 'VIZOR',
            status: modo === 'EDICAO' ? 'RASCUNHO' : 'ATIVO',
            origemCopiaId: origem.id,
            cancelado: false,

            clienteId: origem.clienteId,
            clienteNome: origem.clienteNome,
            clienteDoc: origem.clienteDoc,
            clienteCodigo: origem.clienteCodigo,
            linhaProduto: origem.linhaProduto,
            produto: origem.produto,
            descricao: origem.descricao,
            siglaAcabado: origem.siglaAcabado,

            engenhariaCompleta: origem.engenhariaCompleta,
            engenhariaPendentes: json(origem.engenhariaPendentes),

            tipoEmbalagemId: origem.tipoEmbalagemId,
            medidas: json(origem.medidas) as Prisma.InputJsonValue,

            papelId: origem.papelId,
            papelDescricao: origem.papelDescricao,
            suporteId: origem.suporteId,
            gramatura: origem.gramatura,

            numCores: origem.numCores,
            cores: json(origem.cores),
            maquinaId: origem.maquinaId,

            matrizQuantidade: origem.matrizQuantidade,
            matrizPrecoUnitario: origem.matrizPrecoUnitario,
            tintaModo: origem.tintaModo,
            tintaConsumoKg: origem.tintaConsumoKg,

            acabamentosRicos: json(origem.acabamentosRicos),
            modeloFacaId: origem.modeloFacaId,
            aproveitamentoManual: origem.aproveitamentoManual,
            montagemLinhas: origem.montagemLinhas,
            montagemColunas: origem.montagemColunas,
            formatoCorteLarguraMm: origem.formatoCorteLarguraMm,
            formatoCorteAlturaMm: origem.formatoCorteAlturaMm,

            itensDiversos: json(origem.itensDiversos),
            itensFornecidos: json(origem.itensFornecidos),
            camposLivres: json(origem.camposLivres),
            custosCalcgraf: json(origem.custosCalcgraf),

            quantidade: origem.quantidade,
            // Foto e totais copiados como estão (sem motor). `fotosAnteriores` é histórico
            // da origem e NÃO é herdado.
            resultadoCalculo: json(origem.resultadoCalculo),
            custoProducao: origem.custoProducao,
            valorTotal: origem.valorTotal,
            margemSelecionada: origem.margemSelecionada,

            criadoPorId: usuarioId ?? undefined,
          },
          select: { id: true, numero: true },
        })
        return novo
  }
}

