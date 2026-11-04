// Consolidação PURA (sem Prisma/IO) das 4 fontes em grupos determinísticos.
// Núcleo da feature — Properties 2, 3, 4, 5, 6.

import type {
  EntradasConsolidacao,
  GrupoResultado,
  ResultadoConsolidado,
} from './central-produto.types'

export const LIMITE_PADRAO = 100

/**
 * Consolida de-paras + produtos + cálculos + OPs(por tag) em grupos.
 *
 * Regras (determinísticas):
 * 1. Cada produtoId (de de-para OU de produto casado) vira UM grupo PRODUTO,
 *    nunca repetido; codigosAcabado = união ordenada e sem duplicatas dos
 *    codigoExterno dos de-paras daquele produto.
 * 2. Cálculo cujo siglaAcabado não aparece em nenhum de-para e que não resolve
 *    para um produto vira grupo ACABADO_SEM_PRODUTO (semProdutoCadastrado=true).
 * 3. Ordenação: PRODUTO (por codigo asc) antes de ACABADO_SEM_PRODUTO (por
 *    siglaAcabado asc); empate resolvido por chave asc.
 * 4. semResultado = lista vazia.
 * 5. detalheDireto = exatamente 1 grupo e é PRODUTO.
 * 6. limiteAplicado = total > limite (truncado após ordenar).
 */
export function consolidarResultados(
  e: EntradasConsolidacao,
  limite: number = LIMITE_PADRAO,
): ResultadoConsolidado {
  // Mapa de produtoId -> grupo PRODUTO (garante unicidade — regra 1).
  const porProduto = new Map<
    string,
    {
      produtoId: string
      codigo: string | null
      descricao: string | null
      codigos: Set<string>
    }
  >()

  const garantirGrupoProduto = (
    produtoId: string,
    codigo: string | null,
    descricao: string | null,
  ) => {
    let g = porProduto.get(produtoId)
    if (!g) {
      g = { produtoId, codigo, descricao, codigos: new Set<string>() }
      porProduto.set(produtoId, g)
    } else {
      // Completa identificação se veio primeiro de uma fonte sem código/descrição.
      if (g.codigo == null && codigo != null) g.codigo = codigo
      if (g.descricao == null && descricao != null) g.descricao = descricao
    }
    return g
  }

  // Índice de produtos casados diretamente (por nome/código).
  const produtoPorId = new Map(e.produtos.map((p) => [p.id, p]))

  // (b) produtos casados por nome/código → grupo PRODUTO.
  for (const p of e.produtos) {
    garantirGrupoProduto(p.id, p.codigo, p.descricao)
  }

  // (a) de-paras → grupo PRODUTO + acumula código acabado.
  // Conjunto de códigos de acabado que resolveram para algum produto (para o
  // fallback do cálculo saber o que já está coberto).
  const acabadosComProduto = new Set<string>()
  for (const dp of e.deParas) {
    const prod = produtoPorId.get(dp.produtoId)
    const g = garantirGrupoProduto(
      dp.produtoId,
      prod?.codigo ?? null,
      prod?.descricao ?? dp.nomeExterno ?? null,
    )
    g.codigos.add(dp.codigoExterno.trim())
    acabadosComProduto.add(dp.codigoExterno.trim().toLowerCase())
  }

  // (c) cálculos sem de-para/produto → grupo ACABADO_SEM_PRODUTO.
  // Chaveia por calculoId para não duplicar; evita cálculo cujo siglaAcabado já
  // está coberto por um de-para (regra 2).
  const gruposCalculo = new Map<string, GrupoResultado>()
  for (const c of e.calculos) {
    const sigla = (c.siglaAcabado ?? '').trim()
    if (sigla.length > 0 && acabadosComProduto.has(sigla.toLowerCase())) {
      continue // já representado por um grupo PRODUTO
    }
    const chave = `calc:${c.id}`
    if (gruposCalculo.has(chave)) continue
    gruposCalculo.set(chave, {
      tipo: 'ACABADO_SEM_PRODUTO',
      chave,
      produtoId: null,
      calculoId: c.id,
      codigo: null,
      descricao: c.descricao ?? c.produto ?? null,
      codigosAcabado: sigla.length > 0 ? [sigla] : [],
      semProdutoCadastrado: true,
    })
  }

  // Monta os grupos PRODUTO finais.
  const gruposProduto: GrupoResultado[] = [...porProduto.values()].map((g) => ({
    tipo: 'PRODUTO' as const,
    chave: g.produtoId,
    produtoId: g.produtoId,
    calculoId: null,
    codigo: g.codigo,
    descricao: g.descricao,
    codigosAcabado: [...g.codigos].sort((a, b) => a.localeCompare(b)),
    semProdutoCadastrado: false,
  }))

  // Ordenação determinística (regra 3).
  const cmp = (a: string | null, b: string | null) =>
    (a ?? '').localeCompare(b ?? '')

  gruposProduto.sort(
    (a, b) => cmp(a.codigo, b.codigo) || cmp(a.chave, b.chave),
  )

  const gruposAcabado = [...gruposCalculo.values()].sort(
    (a, b) =>
      cmp(a.codigosAcabado[0] ?? null, b.codigosAcabado[0] ?? null) ||
      cmp(a.chave, b.chave),
  )

  const ordenados: GrupoResultado[] = [...gruposProduto, ...gruposAcabado]

  const total = ordenados.length
  const limiteAplicado = total > limite
  const resultados = limiteAplicado ? ordenados.slice(0, limite) : ordenados

  return {
    resultados,
    semResultado: resultados.length === 0,
    detalheDireto:
      resultados.length === 1 && resultados[0].tipo === 'PRODUTO',
    limiteAplicado,
    termoBusca: e.termoNormalizado,
  }
}
