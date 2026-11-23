/**
 * Corrige o cadastro das linhas de produto da Carton Wega conforme as telas do Calcgraf
 * (docs/orcamento-grafico-linhas-de-produto.md, seção 11).
 *
 * Altera SOMENTE:
 *   1. produto_grafico.modo_formato          Display, Envelope e Impressos (Lâminas) -> DUAS_DIMENSOES
 *      (no Calcgraf o Formato desses produtos é vazio e a tela mostra só "Formato Página").
 *   2. produto_grafico.possui_altura_tampa   Cartucho Composto, Caixa, Invólucros e Cartelas -> true
 *      (telas do Calcgraf mostram "Alt Tampa").
 *   3. tipo_plano_grafico.prev_*             Tipos de plano de Lâminas (Base, Envelope, Impressos): só o bloco
 *      de capa externa (suporte + fibra); sem microondulado nem capa interna.
 *
 * Segurança:
 *   - Dry-run por padrão: mostra o que mudaria e NÃO grava. Use --apply para gravar.
 *   - Idempotente: só atualiza onde o valor atual difere (segunda execução altera 0 linhas).
 *   - Backup do estado anterior em scripts/backups/ antes de gravar (--apply).
 *   - Uma transação; qualquer divergência inesperada (produto ou tipo não encontrado) aborta tudo.
 *   - empresa_id explícito em toda consulta.
 *   - A connection string vem só de DATABASE_URL_PROD (nunca em arquivo versionado).
 *
 * Uso:
 *   $env:DATABASE_URL_PROD='...'; node scripts/corrigir-cadastro-linhas-wega.mjs            # simulação
 *   $env:DATABASE_URL_PROD='...'; node scripts/corrigir-cadastro-linhas-wega.mjs --apply    # grava
 */
import pg from 'pg'
import { mkdirSync, writeFileSync } from 'node:fs'

const EMPRESA_WEGA = '75848e24-742e-461d-b913-1642c5b83ae9'
const APLICAR = process.argv.includes('--apply')
const url = process.env.DATABASE_URL_PROD
if (!url) {
  console.error('DATABASE_URL_PROD ausente. Nada foi feito.')
  process.exit(2)
}

// codigo_origem do Calcgraf (produto_grafico.codigo_origem / tipo_plano_grafico.codigo_origem).
const PRODUTOS_DUAS_DIMENSOES = [
  { origem: 8, nome: 'Envelope' },
  { origem: 9, nome: 'Display' },
  { origem: 11, nome: 'Impressos (Lâminas)' },
]
const PRODUTOS_ALTURA_TAMPA = [
  { origem: 2, nome: 'Cartucho Composto' },
  { origem: 4, nome: 'Cartelas' },
  { origem: 5, nome: 'Caixa' },
  { origem: 6, nome: 'Invólucros' },
]
const TIPOS_PLANO_LAMINAS = [
  { origem: 12, nome: 'Envelope' },
  { origem: 13, nome: 'Base' },
  { origem: 14, nome: 'Impressos' },
]

const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false }, statement_timeout: 60000 })
await client.connect()

const mudancas = []
const backup = { geradoEm: new Date().toISOString(), empresaId: EMPRESA_WEGA, produtos: [], tiposPlano: [] }

try {
  await client.query('BEGIN')

  async function produto(origem, nome) {
    const r = await client.query(
      'SELECT id, codigo, nome, modo_formato, possui_altura_tampa FROM produto_grafico WHERE empresa_id=$1 AND codigo_origem=$2',
      [EMPRESA_WEGA, origem],
    )
    if (r.rows.length !== 1) throw new Error(`Produto "${nome}" (origem ${origem}): esperava 1 registro, achei ${r.rows.length}`)
    return r.rows[0]
  }

  // 1. modo de formato
  for (const p of PRODUTOS_DUAS_DIMENSOES) {
    const atual = await produto(p.origem, p.nome)
    backup.produtos.push({ id: atual.id, codigo: atual.codigo, modo_formato: atual.modo_formato, possui_altura_tampa: atual.possui_altura_tampa })
    if (atual.modo_formato !== 'DUAS_DIMENSOES') {
      mudancas.push({ tabela: 'produto_grafico', id: atual.id, descricao: `${p.nome}: modo_formato ${atual.modo_formato} -> DUAS_DIMENSOES`,
        sql: 'UPDATE produto_grafico SET modo_formato=$1, atualizado_em=now() WHERE id=$2 AND empresa_id=$3', params: ['DUAS_DIMENSOES', atual.id, EMPRESA_WEGA] })
    }
  }
  // 2. altura da tampa
  for (const p of PRODUTOS_ALTURA_TAMPA) {
    const atual = await produto(p.origem, p.nome)
    if (!backup.produtos.some((b) => b.id === atual.id)) {
      backup.produtos.push({ id: atual.id, codigo: atual.codigo, modo_formato: atual.modo_formato, possui_altura_tampa: atual.possui_altura_tampa })
    }
    if (atual.possui_altura_tampa !== true) {
      mudancas.push({ tabela: 'produto_grafico', id: atual.id, descricao: `${p.nome}: possui_altura_tampa ${atual.possui_altura_tampa} -> true`,
        sql: 'UPDATE produto_grafico SET possui_altura_tampa=true, atualizado_em=now() WHERE id=$1 AND empresa_id=$2', params: [atual.id, EMPRESA_WEGA] })
    }
  }
  // 3. blocos dos tipos de plano de Lâminas
  for (const t of TIPOS_PLANO_LAMINAS) {
    const r = await client.query(
      'SELECT id, codigo, nome, prev_capa_externa, prev_microondulado, prev_capa_interna, prev_fibra FROM tipo_plano_grafico WHERE empresa_id=$1 AND codigo_origem=$2',
      [EMPRESA_WEGA, t.origem],
    )
    if (r.rows.length !== 1) throw new Error(`Tipo de plano "${t.nome}" (origem ${t.origem}): esperava 1 registro, achei ${r.rows.length}`)
    const a = r.rows[0]
    backup.tiposPlano.push({ id: a.id, codigo: a.codigo, prev_capa_externa: a.prev_capa_externa, prev_microondulado: a.prev_microondulado, prev_capa_interna: a.prev_capa_interna, prev_fibra: a.prev_fibra })
    const igual = a.prev_capa_externa === true && a.prev_microondulado === false && a.prev_capa_interna === false && a.prev_fibra === true
    if (!igual) {
      mudancas.push({ tabela: 'tipo_plano_grafico', id: a.id,
        descricao: `Plano ${t.nome}: capaExterna ${a.prev_capa_externa}->true, micro ${a.prev_microondulado}->false, capaInterna ${a.prev_capa_interna}->false, fibra ${a.prev_fibra}->true`,
        sql: 'UPDATE tipo_plano_grafico SET prev_capa_externa=true, prev_microondulado=false, prev_capa_interna=false, prev_fibra=true, atualizado_em=now() WHERE id=$1 AND empresa_id=$2',
        params: [a.id, EMPRESA_WEGA] })
    }
  }

  console.log(`\n${APLICAR ? 'APLICAR' : 'SIMULACAO (dry-run)'} - ${mudancas.length} alteracao(oes):`)
  for (const m of mudancas) console.log(` - ${m.descricao}`)
  if (mudancas.length === 0) console.log(' (nada a alterar: cadastro ja esta como esperado)')

  if (!APLICAR) {
    await client.query('ROLLBACK')
  } else if (mudancas.length > 0) {
    mkdirSync('scripts/backups', { recursive: true })
    const arquivo = `scripts/backups/cadastro-linhas-wega-${backup.geradoEm.replace(/[:.]/g, '-')}.json`
    writeFileSync(arquivo, JSON.stringify(backup, null, 2))
    console.log(`Backup do estado anterior: ${arquivo}`)
    for (const m of mudancas) {
      const r = await client.query(m.sql, m.params)
      if (r.rowCount !== 1) throw new Error(`UPDATE afetou ${r.rowCount} linhas (esperava 1): ${m.descricao}`)
    }
    await client.query('COMMIT')
    console.log('Gravado.')
  } else {
    await client.query('ROLLBACK')
  }
} catch (e) {
  await client.query('ROLLBACK').catch(() => {})
  console.error('ABORTADO, nada foi gravado:', e.message)
  process.exitCode = 1
} finally {
  await client.end()
}
