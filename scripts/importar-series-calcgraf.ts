/**
 * Importa as SÉRIES do orçamento do sistema legado (export
 * `cartoon/export/Series.json`, gerado por scripts/exportar-series-calcgraf.mjs)
 * para o cadastro `SerieDocumento` (origem ORCAMENTO) de UMA empresa.
 *
 * - DRY-RUN por padrão (só mostra o que faria). `--apply` grava.
 * - `--empresa <id>` OBRIGATÓRIO (nunca assume empresa).
 * - Conexão SOMENTE por env `DATABASE_URL` (nunca hardcode).
 * - Upsert por (empresa, ORCAMENTO, nome). Série legada de nome vazio casa com a
 *   série padrão da empresa. Grava codigoLegado, ativo, descricao e
 *   proximoNumero = GREATEST(legado, atual) — nunca volta o contador.
 * - Idempotente: rodar de novo não duplica nem reduz o próximo número.
 *
 * Uso:
 *   npx tsx scripts/importar-series-calcgraf.ts --empresa <id> [--arquivo cartoon/export/Series.json] [--apply]
 */
import { readFileSync } from 'node:fs'
import { PrismaClient } from '@prisma/client'

const ORIGEM = 'ORCAMENTO'

interface SerieLegada {
  Codigo: number
  Ativo: boolean | number | null
  Origem: string
  Nome: string | null
  Descricao: string | null
  ProximoNumero: number | null
}

function arg(nome: string): string | undefined {
  const i = process.argv.indexOf(nome)
  return i >= 0 ? process.argv[i + 1] : undefined
}

function hostDaUrl(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return '(url inválida)'
  }
}

async function main() {
  const empresaId = arg('--empresa')
  const arquivo = arg('--arquivo') ?? 'cartoon/export/Series.json'
  const aplicar = process.argv.includes('--apply')
  if (!empresaId) throw new Error('Informe --empresa <id>')
  if (!process.env.DATABASE_URL) throw new Error('Defina a variável de ambiente DATABASE_URL')

  const pfx = aplicar ? '' : '[dry-run] '
  console.log(`${pfx}Banco: ${hostDaUrl(process.env.DATABASE_URL)} · empresa ${empresaId} · arquivo ${arquivo}`)

  const legadas = (JSON.parse(readFileSync(arquivo, 'utf8')) as SerieLegada[]).filter(
    (s) => (s.Origem ?? '').trim().toUpperCase() === 'SOL',
  )
  console.log(`${pfx}${legadas.length} série(s) legada(s) de orçamento`)

  const prisma = new PrismaClient()
  try {
    const empresa = await prisma.empresa.findUnique({ where: { id: empresaId }, select: { id: true } })
    if (!empresa) throw new Error(`Empresa ${empresaId} não encontrada`)

    let criadas = 0
    let atualizadas = 0
    for (const s of legadas) {
      const nome = (s.Nome ?? '').trim().slice(0, 10)
      const ativoLegado = s.Ativo === true || s.Ativo === 1
      const proximoLegado = Math.max(1, Number(s.ProximoNumero ?? 1) || 1)
      const descricao = (s.Descricao ?? '').trim().slice(0, 100) || null

      // Nome vazio = série padrão da empresa (padrao=true; senão a de nome '').
      const atual = nome
        ? await prisma.serieDocumento.findFirst({ where: { empresaId, origem: ORIGEM, nome } })
        : (await prisma.serieDocumento.findFirst({ where: { empresaId, origem: ORIGEM, padrao: true } })) ??
          (await prisma.serieDocumento.findFirst({ where: { empresaId, origem: ORIGEM, nome: '' } }))

      if (!atual) {
        console.log(`${pfx}CRIAR série "${nome || '(padrão sem nome)'}" · código ${s.Codigo} · ativo ${ativoLegado} · próximo ${proximoLegado}`)
        if (aplicar) {
          await prisma.serieDocumento.create({
            data: {
              empresaId,
              origem: ORIGEM,
              nome,
              descricao: descricao ?? (nome ? null : 'Série padrão'),
              ativo: nome ? ativoLegado : true,
              padrao: !nome && !(await prisma.serieDocumento.findFirst({ where: { empresaId, origem: ORIGEM, padrao: true } })),
              proximoNumero: proximoLegado,
              codigoLegado: s.Codigo,
            },
          })
        }
        criadas++
        continue
      }

      // Série padrão nunca é inativada pela importação (regra do cadastro).
      const ativo = atual.padrao ? true : ativoLegado
      if (atual.padrao && !ativoLegado) {
        console.log(`${pfx}  aviso: série legada ${s.Codigo} está inativa, mas casa com a padrão — mantida ativa`)
      }
      const proximoNumero = Math.max(proximoLegado, atual.proximoNumero)
      console.log(
        `${pfx}ATUALIZAR série "${atual.nome || '(padrão sem nome)'}" · código ${s.Codigo} · ativo ${ativo} · próximo ${atual.proximoNumero} → ${proximoNumero}`,
      )
      if (aplicar) {
        // GREATEST no próprio UPDATE: não reduz o contador mesmo com uso concorrente.
        await prisma.$executeRaw`
          UPDATE "serie_documento"
             SET "codigo_legado" = ${s.Codigo},
                 "ativo" = ${ativo},
                 "descricao" = COALESCE(${descricao}, "descricao"),
                 "proximo_numero" = GREATEST("proximo_numero", ${proximoLegado}),
                 "atualizado_em" = CURRENT_TIMESTAMP
           WHERE "id" = ${atual.id} AND "empresa_id" = ${empresaId}
        `
      }
      atualizadas++
    }
    console.log(`${pfx}Resumo: ${criadas} a criar, ${atualizadas} a atualizar${aplicar ? '' : ' (nada gravado — use --apply)'}`)
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((e) => {
  console.error('Falha:', e.message)
  process.exit(1)
})
