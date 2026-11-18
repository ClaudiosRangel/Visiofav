// Medição SOMENTE-LEITURA para a tarefa 1.1 da spec orcamento-grafico-hierarquia-item-plano.
// Uso (PowerShell, senha nunca é impressa):
//   $env:BASELINE_DATABASE_URL = "<string de conexão>"   # use um usuário somente-leitura
//   node scripts/baseline-hierarquia-medir.mjs <empresaId>
//   Remove-Item Env:BASELINE_DATABASE_URL
// Executa apenas SELECT dentro de uma transação READ ONLY.
import pg from 'pg'

const empresaId = process.argv[2]
const url = process.env.BASELINE_DATABASE_URL
if (!empresaId || !url) {
  console.error('Informe <empresaId> e a env BASELINE_DATABASE_URL.')
  process.exit(1)
}

const c = new pg.Client({ connectionString: url, ssl: url.includes('localhost') ? undefined : { rejectUnauthorized: false } })
await c.connect()
await c.query('BEGIN READ ONLY')
try {
  // 1) T1..T4: cálculos migrados (valores já persistidos, nada é recalculado)
  const calc = await c.query(
    `select numero_calcgraf, quantidade, custo_producao, valor_total,
            resultado_calculo->'custos'->>'custoProducao' as foto_custo_producao,
            resultado_calculo->>'custoProducao' as raiz_custo_producao,
            resultado_calculo->>'precoVenda' as raiz_preco_venda
       from calculo_grafico
      where empresa_id = $1 and numero_calcgraf = any($2::int[])
      order by numero_calcgraf`,
    [empresaId, [12992, 13296, 11122, 12540]],
  )
  console.log('## Cálculos T1..T4')
  console.log(JSON.stringify(calc.rows, null, 2))

  // 2) P3: produtos ativos × tipos de plano permitidos (relação PRODUTO→PLANO)
  const prod = await c.query(
    `select p.codigo, p.nome, p.modo_formato,
            count(t.id)::int as tipos_permitidos,
            count(t.id) filter (where t.fixo)::int as tipos_fixos,
            coalesce(string_agg(t.nome, ', ' order by t.nome), '') as tipos
       from produto_grafico p
       left join relacao_cadastro_grafico r
              on r.empresa_id = p.empresa_id and r.tipo_origem = 'PRODUTO' and r.id_origem = p.id
             and r.tipo_destino = 'PLANO'
       left join tipo_plano_grafico t
              on t.id = r.id_destino and t.empresa_id = p.empresa_id and t.status = true
      where p.empresa_id = $1 and p.status = true
      group by p.id order by p.nome`,
    [empresaId],
  )
  console.log('## Produtos (regra nova = some(fixo); regra atual = some(fixo) OU único tipo permitido)')
  const linhas = prod.rows.map((r) => {
    const nova = r.tipos_fixos > 0 ? 'PLANO_UNICO' : 'MULTI_PLANO'
    const atual = r.tipos_fixos > 0 || r.tipos_permitidos === 1 ? 'PLANO_UNICO' : 'MULTI_PLANO'
    return { ...r, nova, atual, afetado: nova !== atual }
  })
  console.log(JSON.stringify(linhas, null, 2))
  console.log(`Afetados por P3: ${linhas.filter((l) => l.afetado).length} de ${linhas.length}`)
} finally {
  await c.query('ROLLBACK')
  await c.end()
}
