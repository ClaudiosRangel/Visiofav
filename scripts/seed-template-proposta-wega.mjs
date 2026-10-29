/**
 * Seed do template "Padrão Carton Wega" (spec comercial-templates-proposta, B1,
 * task 6). Cria — se ainda não existir — um TemplateProposta com estilo WEGA
 * para a Carton Wega, como DEFAULT. Idempotente: se já existir um template com
 * esse nome na empresa, NÃO sobrescreve (respeita ajuste manual).
 *
 * Layout do estilo WEGA: docs/modelo-proposta-cliente-carton-wega.md.
 *
 * Uso (produção Neon — NUNCA commitar a string):
 *   $env:DATABASE_URL_PROD="postgres://...neon..."; node scripts/seed-template-proposta-wega.mjs
 * Recusa rodar contra localhost (produção é Neon).
 */
import pg from 'pg'

const CNPJ_WEGA = '23787041000175' // Carton Wega (só dígitos)
const NOME_TEMPLATE = 'Padrão Carton Wega'

const CONFIG_WEGA = {
  estilo: 'WEGA',
  cabecalho: {
    mostrarLogo: true,
    mostrarRazaoSocial: true,
    mostrarCnpj: false,
    mostrarTelefone: false,
    mostrarEmail: false,
  },
  textos: {
    cidadeData: 'Comendador Levy Gasp',
    // introducao/condicoes/rodape vazios → usam os textos fixos do estilo WEGA
    // (saudação e bloco IMPORTANTE padrão). Editáveis depois na tela.
  },
  blocos: {
    engenharia: true,
    decomposicaoCustos: false, // proposta ao cliente NÃO mostra custo, só preço
    variacoesTiragem: true,
    validade: true,
    observacoes: false,
  },
}

function resolverConnectionString() {
  const str = process.env.DATABASE_URL_PROD || process.env.DATABASE_URL
  if (!str) {
    throw new Error('Defina DATABASE_URL_PROD (ou DATABASE_URL) com a string do Neon de produção.')
  }
  if (/@localhost|@127\.0\.0\.1/.test(str)) {
    throw new Error('A connection string aponta para LOCALHOST. Este seed é para PRODUÇÃO (Neon).')
  }
  return str
}

async function main() {
  const connectionString = resolverConnectionString()
  const client = new pg.Client({ connectionString, ssl: { rejectUnauthorized: false } })
  await client.connect()
  try {
    const emp = await client.query(
      `SELECT id, razao_social FROM empresa
       WHERE regexp_replace(coalesce(cnpj,''), '\\D', '', 'g') = $1
       LIMIT 1`,
      [CNPJ_WEGA],
    )
    if (emp.rows.length === 0) {
      throw new Error(`Empresa com CNPJ ${CNPJ_WEGA} (Carton Wega) não encontrada em produção.`)
    }
    const empresaId = emp.rows[0].id
    console.log(`Empresa: ${emp.rows[0].razao_social} (${empresaId})`)

    // Já existe um template com esse nome? (idempotência)
    const existe = await client.query(
      'SELECT id, is_default FROM template_proposta WHERE empresa_id = $1 AND nome = $2 LIMIT 1',
      [empresaId, NOME_TEMPLATE],
    )
    if (existe.rows.length > 0) {
      console.log(`= Template "${NOME_TEMPLATE}" já existe (${existe.rows[0].id}) — não alterado.`)
      return
    }

    // Vira default: desmarca o default anterior da empresa.
    await client.query('UPDATE template_proposta SET is_default = false WHERE empresa_id = $1 AND is_default = true', [empresaId])

    const r = await client.query(
      `INSERT INTO template_proposta (id, empresa_id, nome, is_default, config, criado_em, atualizado_em)
       VALUES (gen_random_uuid(), $1, $2, true, $3::jsonb, now(), now())
       RETURNING id`,
      [empresaId, NOME_TEMPLATE, JSON.stringify(CONFIG_WEGA)],
    )
    console.log(`+ Template "${NOME_TEMPLATE}" criado como DEFAULT (${r.rows[0].id}).`)
  } finally {
    await client.end()
  }
}

main().catch((e) => {
  console.error('Erro no seed:', e.message)
  process.exit(1)
})
