/**
 * Seed dos Códigos de Parada da Carton Wega (produção).
 *
 * Cadastra a lista de paradas de máquina (Impressão) enviada pelo Caio na tela
 * PCP → Gerencial → Códigos de Parada. Idempotente por (empresaId, codigo):
 * rodar de novo NÃO duplica (upsert). NÃO sobrescreve a descrição de um código
 * já existente que o usuário tenha editado — só cria o que falta.
 *
 * Uso:
 *   # usa a connection string de PRODUÇÃO (Neon) — NUNCA commitar a string.
 *   $env:DATABASE_URL_PROD="postgres://...neon..."; node scripts/seed-codigos-parada-wega.mjs
 *   # ou, se o DATABASE_URL do ambiente já for produção:
 *   node scripts/seed-codigos-parada-wega.mjs
 *
 * O script ACEITA tanto DATABASE_URL_PROD (preferido, explícito) quanto
 * DATABASE_URL, mas RECUSA rodar contra localhost (proteção — produção é Neon).
 */
import pg from 'pg'

const CNPJ_WEGA = '23787041000175' // Carton Wega (só dígitos)

// Lista do Caio (ordem = ordem de exibição). Código curto estável + descrição.
// `codigo` <= 20 chars; `descricao` <= 200.
const CODIGOS = [
  { codigo: 'AGUARD_CHAPA', descricao: 'Aguardando chapa' },
  { codigo: 'AGUARD_CARTAO', descricao: 'Aguardando cartão' },
  { codigo: 'AGUARD_APROV', descricao: 'Aguardando aprovação' },
  { codigo: 'ACERTO_SETUP', descricao: 'Acerto de máquina / setup' },
  { codigo: 'AGUARD_FIM_PROC', descricao: 'Aguardando fim do processo' },
  { codigo: 'AGUARD_APR_CLI', descricao: 'Aguardando aprovação do cliente' },
  { codigo: 'AGUARD_PRE_IMP', descricao: 'Aguardando pré-impressão' },
  { codigo: 'AGUARD_AMOSTRA', descricao: 'Aguardando amostra' },
  { codigo: 'AGUARD_QUALID', descricao: 'Aguardando liberação da qualidade' },
  { codigo: 'MP_DEFEITO', descricao: 'Matéria prima com defeito' },
  { codigo: 'FALTA_MP', descricao: 'Falta de matéria prima' },
  { codigo: 'MANUTENCAO', descricao: 'Manutenção' },
  { codigo: 'SERV_CANCELADO', descricao: 'Serviço cancelado' },
  { codigo: 'REUNIAO', descricao: 'Reunião' },
  { codigo: 'FALTA_ENERGIA', descricao: 'Falta de energia' },
  { codigo: 'OUTROS', descricao: 'Outros' },
]

function resolverConnectionString() {
  const str = process.env.DATABASE_URL_PROD || process.env.DATABASE_URL
  if (!str) {
    throw new Error('Defina DATABASE_URL_PROD (ou DATABASE_URL) com a string do Neon de produção.')
  }
  if (/@localhost|@127\.0\.0\.1/.test(str)) {
    throw new Error(
      'A connection string aponta para LOCALHOST. Este seed é para PRODUÇÃO (Neon).\n' +
        'Rode com: $env:DATABASE_URL_PROD="<string-do-neon>"; node scripts/seed-codigos-parada-wega.mjs',
    )
  }
  return str
}

async function main() {
  const connectionString = resolverConnectionString()
  const client = new pg.Client({ connectionString, ssl: { rejectUnauthorized: false } })
  await client.connect()
  try {
    // Resolve a empresa pelo CNPJ (só dígitos). A coluna pode ter máscara, então
    // comparamos removendo tudo que não é dígito.
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

    let criados = 0
    let jaExistiam = 0
    for (const c of CODIGOS) {
      // Idempotente: ON CONFLICT (empresa_id, codigo) NÃO altera o existente.
      const r = await client.query(
        `INSERT INTO codigo_parada (id, empresa_id, codigo, descricao, status, criado_em)
         VALUES (gen_random_uuid(), $1, $2, $3, true, now())
         ON CONFLICT (empresa_id, codigo) DO NOTHING`,
        [empresaId, c.codigo, c.descricao],
      )
      if (r.rowCount === 1) {
        criados++
        console.log(`  + ${c.codigo}  ${c.descricao}`)
      } else {
        jaExistiam++
        console.log(`  = ${c.codigo}  (já existia, não alterado)`)
      }
    }

    const total = await client.query(
      'SELECT count(*)::int AS n FROM codigo_parada WHERE empresa_id = $1',
      [empresaId],
    )
    console.log(`\nResultado: ${criados} criados, ${jaExistiam} já existiam.`)
    console.log(`Total de códigos de parada da empresa agora: ${total.rows[0].n}`)
  } finally {
    await client.end()
  }
}

main().catch((err) => {
  console.error('ERRO:', err.message)
  process.exit(1)
})
