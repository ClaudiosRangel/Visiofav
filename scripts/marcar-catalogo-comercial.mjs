/**
 * Marca quais Tipos de Embalagem e Acabamentos aparecem na lista comercial
 * (Portal do Representante + Pedidos/Propostas) via coluna `exibir_comercial`.
 *
 * Não desativa nada: o orçamento e o PCP continuam enxergando todos os
 * cadastros. Só a lista comercial é filtrada.
 *
 * Uso (dry-run por padrão):
 *   DATABASE_URL=<conexão> node scripts/marcar-catalogo-comercial.mjs --empresa <uuid>
 *   DATABASE_URL=<conexão> node scripts/marcar-catalogo-comercial.mjs --empresa <uuid> --apply
 *
 * A conexão vem SEMPRE de variável de ambiente (nunca no arquivo).
 */
import pg from 'pg'

const args = process.argv.slice(2)
const empresa = args[args.indexOf('--empresa') + 1]
const apply = args.includes('--apply')
if (!empresa || empresa.startsWith('--')) { console.error('Informe --empresa <uuid>'); process.exit(1) }
if (!process.env.DATABASE_URL) { console.error('Defina DATABASE_URL'); process.exit(1) }

// Tipos de embalagem que o comercial usa (códigos do cadastro da Carton Wega).
const TIPOS_VISIVEIS = [
  'CG-EMB-5',     // Caixa
  'CAIXA-TAMPA',  // Caixa Tampa e Fundo (tampa)
  'CAIXA-FUNDO',  // Caixa Tampa e Fundo (fundo)
  'CARTUCHO',     // Cartucho Simples
  'CG-EMB-2',     // Cartucho Composto
  'CG-EMB-4',     // Cartelas
  'CG-EMB-9',     // Display
  'CG-EMB-8',     // Envelope
  'CG-EMB-3',     // Sacola
  'ROTULO',       // Rótulo / Envoltório
  'CG-EMB-7',     // Impressos
]

// Acabamentos do PRODUTO (não processos de máquina) + acondicionamentos.
const ACABAMENTOS_VISIVEIS = [
  /^verniz/i,
  /^hotstamping/i,
  /^relevo$/i,
  /^laminação (maior|menor)$/i,
  /^colagem manual$/i,
  /^envase$/i,
  /^colocação (de alça|ilhós|velcro)$/i,
  /^poliéster$/i,
  /^botão de pressão$/i,
]

const c = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } })
await c.connect()

const tipos = (await c.query(
  `select id, codigo, descricao from tipo_embalagem where empresa_id=$1 and status=true order by descricao`, [empresa])).rows
const acabs = (await c.query(
  `select id, codigo, nome, acondicionamento from acabamento_grafico where empresa_id=$1 and status=true order by nome`, [empresa])).rows

const tiposOn = tipos.filter((t) => TIPOS_VISIVEIS.includes(t.codigo))
const acabsOn = acabs.filter((a) => a.acondicionamento || ACABAMENTOS_VISIVEIS.some((rx) => rx.test(a.nome.trim())))

console.log(`Tipos de embalagem: ${tiposOn.length} visíveis de ${tipos.length}`)
tiposOn.forEach((t) => console.log(`  + ${t.codigo}  ${t.descricao}`))
console.log(`Acabamentos: ${acabsOn.length} visíveis de ${acabs.length}`)
acabsOn.forEach((a) => console.log(`  + ${a.nome}${a.acondicionamento ? '  (acondicionamento)' : ''}`))

if (!apply) { console.log('\nDRY-RUN: nada gravado. Use --apply para gravar.'); await c.end(); process.exit(0) }

await c.query('begin')
try {
  await c.query(`update tipo_embalagem set exibir_comercial = (id = any($2::text[])) where empresa_id=$1`,
    [empresa, tiposOn.map((t) => t.id)])
  await c.query(`update acabamento_grafico set exibir_comercial = (id = any($2::text[])) where empresa_id=$1`,
    [empresa, acabsOn.map((a) => a.id)])
  await c.query('commit')
  console.log('\nGRAVADO.')
} catch (e) {
  await c.query('rollback')
  console.error('Falha, revertido:', e.message)
  process.exit(1)
}
await c.end()
