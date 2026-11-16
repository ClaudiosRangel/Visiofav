/**
 * Corrige a flag `acabamento_grafico.acondicionamento` das atividades de
 * acondicionamento (Caixa Padrão = codigo_origem 39, Embalar = 53) da empresa
 * informada. Spec orcamento-grafico-fase3-produto-embalagem (tarefa 1.3, Req 6.2/6.3/6.5/6.6).
 *
 * Regras:
 *  - só marca `true` onde hoje está `false`; nunca desmarca;
 *  - só atividades da empresa informada e com codigo_origem 39 ou 53;
 *  - não cria nem remove nenhuma relação (RelacaoCadastroGrafico);
 *  - `--empresa <id>` é obrigatório;
 *  - `--dry-run` lista o que mudaria e grava 0 registros;
 *  - segunda execução altera 0 registros (idempotente);
 *  - conexão pela variável de ambiente DATABASE_URL (nunca no arquivo).
 *
 * Uso:
 *   $env:DATABASE_URL = "<conexão>"
 *   npx tsx scripts/corrigir-acondicionamento-orcamento.ts --empresa <uuid> --dry-run
 *   npx tsx scripts/corrigir-acondicionamento-orcamento.ts --empresa <uuid>
 *
 * A função pura `decidirCorrecaoAcondicionamento` não importa o Prisma (o cliente
 * só é carregado dentro de `main`), para poder ser testada sem conexão.
 */

export const CODIGOS_ACONDICIONAMENTO = [39, 53] as const

export interface AtividadeParaDecisao {
  id: string
  empresaId: string
  codigoOrigem: number | null
  acondicionamento: boolean
}

export interface DecisaoCorrecao {
  /** Ids a marcar `acondicionamento = true`. */
  marcar: string[]
  /** Já estavam `true` (nada a fazer). */
  jaMarcadas: string[]
}

/**
 * Decisão pura: quais atividades passam a `acondicionamento = true`.
 * Considera só a empresa informada e os códigos alvo; ignora o restante.
 * Não produz nenhuma instrução sobre relações.
 */
export function decidirCorrecaoAcondicionamento(
  atividades: readonly AtividadeParaDecisao[],
  empresaId: string,
  codigosAlvo: readonly number[] = CODIGOS_ACONDICIONAMENTO,
): DecisaoCorrecao {
  const alvo = new Set(codigosAlvo)
  const marcar: string[] = []
  const jaMarcadas: string[] = []
  for (const a of atividades) {
    if (a.empresaId !== empresaId) continue
    if (a.codigoOrigem === null || !alvo.has(a.codigoOrigem)) continue
    if (a.acondicionamento) jaMarcadas.push(a.id)
    else marcar.push(a.id)
  }
  return { marcar, jaMarcadas }
}

export interface OpcoesCli {
  empresaId: string | null
  dryRun: boolean
}

export function lerOpcoes(argv: readonly string[]): OpcoesCli {
  const i = argv.indexOf('--empresa')
  const valor = i >= 0 ? argv[i + 1] : undefined
  const empresaId = valor && !valor.startsWith('--') ? valor : null
  return { empresaId, dryRun: argv.includes('--dry-run') }
}

async function main(): Promise<number> {
  const { empresaId, dryRun } = lerOpcoes(process.argv.slice(2))
  if (!empresaId) {
    console.error('Informe --empresa <id>. Nada foi feito.')
    return 1
  }
  if (!process.env.DATABASE_URL) {
    console.error('Defina DATABASE_URL no ambiente. Nada foi feito.')
    return 1
  }

  const { PrismaClient } = await import('@prisma/client')
  const prisma = new PrismaClient()
  try {
    const atividades = await prisma.acabamentoGrafico.findMany({
      where: { empresaId, codigoOrigem: { in: [...CODIGOS_ACONDICIONAMENTO] } },
      select: { id: true, empresaId: true, codigoOrigem: true, acondicionamento: true, nome: true },
    })
    const { marcar, jaMarcadas } = decidirCorrecaoAcondicionamento(atividades, empresaId)
    const nomePorId = new Map(atividades.map((a) => [a.id, `${a.codigoOrigem} ${a.nome}`]))

    console.log(`${dryRun ? '[DRY-RUN] ' : ''}Empresa ${empresaId}`)
    console.log(`Atividades alvo encontradas: ${atividades.length}`)
    console.log(`Já com acondicionamento = true: ${jaMarcadas.length}`)
    console.log(`A marcar: ${marcar.length}`)
    for (const id of marcar) console.log(`  - ${nomePorId.get(id)} (${id})`)

    if (dryRun || marcar.length === 0) {
      console.log(`Registros alterados: 0${dryRun ? ' (dry-run)' : ''}`)
      return 0
    }

    const r = await prisma.acabamentoGrafico.updateMany({
      where: { id: { in: marcar }, empresaId, acondicionamento: false },
      data: { acondicionamento: true },
    })
    console.log(`Registros alterados: ${r.count}`)
    return 0
  } finally {
    await prisma.$disconnect()
  }
}

if (/corrigir-acondicionamento-orcamento\.ts$/.test(process.argv[1] ?? '')) {
  main().then(
    (code) => process.exit(code),
    (e) => {
      console.error(e)
      process.exit(1)
    },
  )
}
