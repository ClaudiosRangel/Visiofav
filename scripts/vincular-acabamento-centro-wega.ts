/**
 * Vincula acabamentos HORA_MAQUINA ao CentroProducao correspondente (por nome),
 * para que herdem o custo-hora real do centro. SÓ toca acabamentos que:
 *   - são HORA_MAQUINA
 *   - ainda NÃO têm centro vinculado
 *   - casam o nome com a descrição de um centro por match SEGURO (ver abaixo)
 *
 * MATCH SEGURO (evita o bug "Cortadeira (Grande)" → "Cortadeira (Pequena)"):
 *   1) igualdade EXATA normalizada SEM remover o conteúdo dos parênteses
 *      (acentos/caixa/espaços ignorados, mas "(grande)" ≠ "(pequena)").
 *   Sem match exato → NÃO vincula (não arrisca de-para frouxo).
 *
 * Ao vincular, copia o custo_hora do centro para o acabamento quando o
 * acabamento estiver sem custo_hora (>0 preservado). NUNCA sobrescreve custo
 * já ajustado manualmente.
 *
 * Uso:  npx tsx scripts/vincular-acabamento-centro-wega.ts            (dry-run)
 *       npx tsx scripts/vincular-acabamento-centro-wega.ts --apply    (aplica)
 *
 * Conexão: usa DATABASE_URL do ambiente (produção Neon) — passar via env.
 */
import { PrismaClient } from '@prisma/client'

const EMPRESA = process.env.EMPRESA_WEGA || '75848e24-742e-461d-b913-1642c5b83ae9'
const APPLY = process.argv.includes('--apply')
const prisma = new PrismaClient()

/** Normaliza preservando o conteúdo dos parênteses (grande ≠ pequena). */
function norm(s: string | null | undefined): string {
  return (s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9()]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

async function main() {
  console.log(`Empresa ${EMPRESA} | modo ${APPLY ? 'APPLY' : 'DRY-RUN'}\n`)

  const acab = await prisma.acabamentoGrafico.findMany({
    where: { empresaId: EMPRESA, naturezaCusto: 'HORA_MAQUINA', centroProducaoId: null },
    select: { id: true, codigo: true, nome: true, custoHora: true },
  })
  const centros = await prisma.centroProducao.findMany({
    where: { empresaId: EMPRESA },
    select: { id: true, codigo: true, descricao: true, custoHora: true },
  })

  // Índice por descrição normalizada (exata). Se houver colisão, guarda o 1º.
  const porNome = new Map<string, (typeof centros)[number]>()
  for (const c of centros) {
    const k = norm(c.descricao)
    if (!porNome.has(k)) porNome.set(k, c)
  }

  const casados: Array<{ a: (typeof acab)[number]; c: (typeof centros)[number] }> = []
  const semMatch: (typeof acab)[number][] = []
  for (const a of acab) {
    const c = porNome.get(norm(a.nome))
    if (c) casados.push({ a, c })
    else semMatch.push(a)
  }

  console.log(`=== VÍNCULOS SEGUROS (${casados.length}) ===`)
  for (const { a, c } of casados) {
    const copiaCusto = Number(a.custoHora) <= 0 && Number(c.custoHora) > 0
    console.log(`  ${a.codigo} "${a.nome}" -> centro ${c.codigo} "${c.descricao}"` + (copiaCusto ? ` (copia custoH=${Number(c.custoHora)})` : ''))
  }
  console.log(`\n=== SEM MATCH EXATO — não vinculados (${semMatch.length}) ===`)
  console.log('  ' + semMatch.map((a) => a.codigo).join(', '))

  if (!APPLY) {
    console.log('\nDRY-RUN — nada gravado. Rode com --apply para efetivar.')
    await prisma.$disconnect()
    return
  }

  let ok = 0
  for (const { a, c } of casados) {
    const data: any = { centroProducaoId: c.id }
    if (Number(a.custoHora) <= 0 && Number(c.custoHora) > 0) data.custoHora = c.custoHora
    await prisma.acabamentoGrafico.update({ where: { id: a.id }, data })
    ok++
  }
  console.log(`\nVinculados: ${ok}`)
  await prisma.$disconnect()
}

main().catch((e) => { console.error('ERRO:', e.message); process.exit(1) })
