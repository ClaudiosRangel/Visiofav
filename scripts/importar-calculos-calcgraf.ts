/**
 * Importador do ACERVO de cálculos do Calcgraf → Biblioteca de Cálculos
 * Gráficos (`CalculoGrafico`).
 *
 * Spec: biblioteca-calculos-graficos (Task 9.2; Req 6.1, 6.3, 6.4, 6.5, 6.6).
 *
 * O QUE FAZ
 *   Lê um arquivo JSON já exportado do acervo Calcgraf
 *   (`cartoon/export/<arquivo>.json`, default `CalculosAcervo`), mapeia cada
 *   registro bruto para o shape `LinhaAcervoCalcgraf` e chama o service
 *   `importarAcervo({ empresaId, linhas, dryRun })` em LOTES. A idempotência, o
 *   mapeamento e a preservação da FOTO (não recalcula) ficam no service — este
 *   script é responsável só pelo TRANSPORTE: leitura do JSON, corte/filtro,
 *   batch e retry de reconexão.
 *
 * FONTE DO JSON (extração — regra do steering migracao-calcgraf-carton-wega)
 *   O acervo (CalculoHeader + CalculoAtividades + CalculoPlanos + CalculoTintas
 *   + CalculoMatAcabamento) vem do banco SQL Server restaurado localmente
 *   (`CalcgrafCartonWega`). A extração por `FOR JSON` padrão do SQL Server
 *   CORROMPE acentos (vira `�`/U+FFFD). Por isso o exportador que gera o
 *   `cartoon/export/<arquivo>.json` DEVE usar `sqlcmd -u` (saída UTF-16 LE),
 *   ler o arquivo em Node como `utf16le` e converter para UTF-8 — nunca o modo
 *   `FOR JSON` default. Este script apenas CONSOME o JSON já exportado desse
 *   jeito (dados sensíveis ficam fora do git, em `cartoon/`).
 *
 * DESTINO
 *   Banco apontado pelo `DATABASE_URL` do `.env` (LOCAL de dev por padrão).
 *   Produção (Neon) SÓ com confirmação explícita — este script não embute
 *   connection string; usa o que estiver no ambiente.
 *
 * IDEMPOTENTE / FOTO CONGELADA
 *   `importarAcervo` não duplica (idempotência por `(empresaId, numeroCalcgraf)`)
 *   e NÃO recalcula — grava a foto agregada da origem como está.
 *
 * USO
 *   npx tsx scripts/importar-calculos-calcgraf.ts --empresa <id> \
 *     [--arquivo CalculosAcervo] [--desde-numero N] [--desde-ano AAAA] [--dry-run]
 *
 *   Sem `--empresa`, acha a Carton Wega por CNPJ 23.787.041/0001-75 (EXIGE que
 *   a empresa já exista — este script NÃO cria empresa).
 *
 * MAPEAMENTO DE CAMPOS — ATENÇÃO
 *   O shape EXATO do export ainda não é conhecido (o arquivo real só existe
 *   quando o exportador do acervo for escrito/rodado). Por isso `brutoParaLinha`
 *   é TOLERANTE: tenta várias chaves por campo (PascalCase do SQL Server,
 *   camelCase, etc.). Quando o export real existir, revisar/ajustar os nomes de
 *   coluna aqui.
 */
import { PrismaClient } from '@prisma/client'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  importarAcervo,
  type LinhaAcervoCalcgraf,
  type ResumoImportacao,
  type RelatorioImportacao,
} from '../src/modules/orcamento-grafico/calculo-grafico/calculo-grafico-import.service'

const prisma = new PrismaClient()
const EXPORT_DIR = join('cartoon', 'export')
const CNPJ_WEGA = '23.787.041/0001-75'

/** Tamanho do lote enviado a `importarAcervo` por vez. */
const TAMANHO_LOTE = 500

// ============================================================================
// HELPERS DE CLI (mesmo padrão de scripts/importar-calcgraf.ts)
// ============================================================================

/** Lê o valor de uma flag `--nome <valor>` de process.argv. */
function arg(nome: string): string | undefined {
  const i = process.argv.indexOf(`--${nome}`)
  return i >= 0 ? process.argv[i + 1] : undefined
}

/** Lê uma flag booleana `--nome` de process.argv. */
function flag(nome: string): boolean {
  return process.argv.includes(`--${nome}`)
}

/** Lê e parseia `cartoon/export/<nome>.json` como um array de registros. */
function lerJson<T = Record<string, unknown>>(nome: string): T[] {
  const raw = readFileSync(join(EXPORT_DIR, `${nome}.json`), 'utf8')
  const parsed = JSON.parse(raw)
  // A origem pode entregar um array direto ou um objeto { data: [...] }.
  if (Array.isArray(parsed)) return parsed as T[]
  if (parsed && Array.isArray((parsed as { data?: unknown }).data)) {
    return (parsed as { data: T[] }).data
  }
  throw new Error(
    `Arquivo ${nome}.json não contém um array de registros (nem { data: [] }).`,
  )
}

// ============================================================================
// EMPRESA — EXIGE que exista (NÃO cria, diferente do importar-calcgraf.ts)
// ============================================================================

/**
 * Resolve o `empresaId` alvo. Se `--empresa <id>` for dado, valida que existe.
 * Caso contrário, acha a Carton Wega por CNPJ. Em ambos os casos, se não
 * encontrar, LANÇA erro claro — este script NUNCA cria empresa.
 */
async function garantirEmpresaId(): Promise<string> {
  const idArg = arg('empresa')
  if (idArg) {
    const e = await prisma.empresa.findUnique({ where: { id: idArg } })
    if (!e) {
      throw new Error(
        `Empresa ${idArg} não encontrada. Informe um --empresa <id> válido.`,
      )
    }
    console.log(`Empresa alvo: ${e.razaoSocial} (${e.id})`)
    return e.id
  }

  const emp = await prisma.empresa.findFirst({ where: { cnpj: CNPJ_WEGA } })
  if (!emp) {
    throw new Error(
      `Carton Wega (CNPJ ${CNPJ_WEGA}) não encontrada no banco apontado por ` +
        `DATABASE_URL. Este script NÃO cria empresa — crie/selecione a empresa ` +
        `antes, ou passe --empresa <id>.`,
    )
  }
  console.log(`Empresa alvo (Carton Wega): ${emp.razaoSocial} (${emp.id})`)
  return emp.id
}

// ============================================================================
// MAPEAMENTO BRUTO → LinhaAcervoCalcgraf (tolerante)
// ============================================================================

/** Pega a primeira chave presente (não `undefined`) de um registro bruto. */
function pegar(raw: Record<string, unknown>, ...chaves: string[]): unknown {
  for (const k of chaves) {
    if (raw[k] !== undefined && raw[k] !== null) return raw[k]
  }
  return null
}

/** Converte valor heterogêneo para number, ou null. */
function num(v: unknown): number | null {
  if (v == null) return null
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : null
}

/** Converte valor heterogêneo para array, ou null (tolerante). */
function arr<T = unknown>(v: unknown): T[] | null {
  return Array.isArray(v) ? (v as T[]) : null
}

/**
 * Converte UM registro bruto do export em `LinhaAcervoCalcgraf`. TOLERANTE:
 * tenta várias grafias por campo (o shape exato do export ainda é incerto).
 * O mapeamento fino (cores/acabamentos/planos → shapes da engenharia) fica no
 * service; aqui só repassamos os arrays como vieram quando existirem.
 *
 * ATENÇÃO: ajustar os nomes de coluna quando o export real existir.
 */
function brutoParaLinha(raw: Record<string, unknown>): LinhaAcervoCalcgraf {
  return {
    // ── Cabeçalho (CalculoHeader) ──
    numCalculo: num(pegar(raw, 'NumCalculo', 'numCalculo', 'numero', 'Numero')),
    cliente: (pegar(raw, 'Cliente', 'cliente', 'NomeCliente', 'nomeCliente') ??
      null) as string | null,
    clienteDoc: (pegar(raw, 'ClienteDoc', 'clienteDoc', 'Cnpj', 'cnpj') ??
      null) as string | null,
    linhaProduto: (pegar(raw, 'LinhaProduto', 'linhaProduto', 'Linha') ??
      null) as string | null,
    produto: (pegar(raw, 'Produto', 'produto', 'DescricaoProduto') ??
      null) as string | null,
    descricao: (pegar(raw, 'Descricao', 'descricao', 'Descritivo') ??
      null) as string | null,
    siglaAcabado: (pegar(raw, 'SiglaAcabado', 'siglaAcabado', 'Sigla') ??
      null) as string | null,
    tiragem: num(pegar(raw, 'Tiragem', 'tiragem', 'Quantidade', 'quantidade')),

    // ── Geometria / produto ──
    tipoEmbalagemId: (pegar(
      raw,
      'TipoEmbalagemId',
      'tipoEmbalagemId',
      'tipoEmbalagem',
    ) ?? null) as string | null,
    medidas: (pegar(raw, 'Medidas', 'medidas') ?? null) as Record<
      string,
      number
    > | null,

    // ── Papel / suporte ──
    papelId: (pegar(raw, 'PapelId', 'papelId') ?? null) as string | null,
    papelDescricao: (pegar(raw, 'PapelDescricao', 'papelDescricao', 'Suporte') ??
      null) as string | null,
    suporteId: (pegar(raw, 'SuporteId', 'suporteId') ?? null) as string | null,
    gramatura: num(pegar(raw, 'Gramatura', 'gramatura')),

    // ── Impressão ──
    numCores: num(pegar(raw, 'NumCores', 'numCores', 'Cores')),
    cores: arr(pegar(raw, 'cores', 'Cores', 'tintas', 'Tintas')),
    maquinaId: (pegar(raw, 'MaquinaId', 'maquinaId') ?? null) as string | null,

    // ── Matriz / tinta ──
    matrizQuantidade: num(pegar(raw, 'MatrizQuantidade', 'matrizQuantidade')),
    matrizPrecoUnitario: num(
      pegar(raw, 'MatrizPrecoUnitario', 'matrizPrecoUnitario'),
    ),

    // ── Acabamentos / planos ──
    acabamentos: arr(
      pegar(raw, 'acabamentos', 'Acabamentos', 'matAcabamento', 'MatAcabamento'),
    ),
    planos: arr(pegar(raw, 'planos', 'Planos')),
    aproveitamentoManual: num(
      pegar(raw, 'AproveitamentoManual', 'aproveitamentoManual', 'Aproveitamento'),
    ),

    // ── FOTO / totais agregados DA ORIGEM (não recalcular) ──
    resultadoCalculo: pegar(raw, 'resultadoCalculo', 'ResultadoCalculo') ?? null,
    custoProducao: num(
      pegar(raw, 'CustoProducao', 'custoProducao', 'CustoProd'),
    ),
    valorTotal: num(pegar(raw, 'ValorTotal', 'valorTotal', 'Total')),
  }
}

// ============================================================================
// CORTE / FILTRO (antes de montar as linhas) — --desde-numero / --desde-ano
// ============================================================================

/**
 * Extrai o ANO de um registro bruto, tolerante às várias grafias de campo de
 * data. Retorna `null` quando não houver data reconhecível (nesse caso o
 * filtro `--desde-ano` NÃO descarta a linha — não dá para afirmar o ano).
 */
function anoDoBruto(raw: Record<string, unknown>): number | null {
  const direto = num(pegar(raw, 'Ano', 'ano'))
  if (direto != null) return direto
  const data = pegar(
    raw,
    'DataCalculo',
    'dataCalculo',
    'Data',
    'data',
    'DataEmissao',
    'dataEmissao',
  )
  if (data == null) return null
  const d = new Date(String(data))
  const ano = d.getFullYear()
  return Number.isFinite(ano) ? ano : null
}

/** Aplica os cortes `--desde-numero` e `--desde-ano` sobre os registros brutos. */
function aplicarCorte(
  brutos: Record<string, unknown>[],
  desdeNumero: number | null,
  desdeAno: number | null,
): Record<string, unknown>[] {
  let filtrados = brutos
  if (desdeNumero != null) {
    filtrados = filtrados.filter((raw) => {
      const n = num(pegar(raw, 'NumCalculo', 'numCalculo', 'numero', 'Numero'))
      return n != null && n >= desdeNumero
    })
  }
  if (desdeAno != null) {
    filtrados = filtrados.filter((raw) => {
      const ano = anoDoBruto(raw)
      // Sem ano reconhecível → não descarta (não há como afirmar o ano).
      return ano == null || ano >= desdeAno
    })
  }
  return filtrados
}

// ============================================================================
// RETRY DE RECONEXÃO (pooler Neon derruba conexão em loop longo)
// ============================================================================

/**
 * Executa `fn` com até `tentativas` tentativas, aguardando ~1s entre elas em
 * erro de conexão. Padrão do steering (o pooler do Neon derruba a conexão em
 * loops longos). Erros que não são de conexão ainda são retentados até o limite
 * (conservador), mas a mensagem é logada para diagnóstico.
 */
async function comRetry<T>(fn: () => Promise<T>, tentativas = 3): Promise<T> {
  let ultimoErro: unknown
  for (let i = 1; i <= tentativas; i++) {
    try {
      return await fn()
    } catch (err) {
      ultimoErro = err
      const msg = err instanceof Error ? err.message : String(err)
      console.warn(
        `  ⚠ tentativa ${i}/${tentativas} falhou: ${msg}` +
          (i < tentativas ? ' — aguardando 1s e re-tentando…' : ''),
      )
      if (i < tentativas) {
        await new Promise((r) => setTimeout(r, 1000))
      }
    }
  }
  throw ultimoErro
}

// ============================================================================
// MAIN
// ============================================================================

async function main() {
  const empresaId = await garantirEmpresaId()

  const nomeArquivo = arg('arquivo') ?? 'CalculosAcervo'
  const dryRun = flag('dry-run')
  const desdeNumero = num(arg('desde-numero') ?? null)
  const desdeAno = num(arg('desde-ano') ?? null)

  console.log(`Lendo acervo de cartoon/export/${nomeArquivo}.json …`)
  const brutos = lerJson<Record<string, unknown>>(nomeArquivo)
  console.log(`Registros brutos lidos: ${brutos.length}`)

  // Corte ANTES de montar as linhas (economiza trabalho/memória).
  const recortados = aplicarCorte(brutos, desdeNumero, desdeAno)
  if (desdeNumero != null) console.log(`Filtro --desde-numero ${desdeNumero}`)
  if (desdeAno != null) console.log(`Filtro --desde-ano ${desdeAno}`)
  console.log(`Registros após corte: ${recortados.length}`)

  const linhas: LinhaAcervoCalcgraf[] = recortados.map(brutoParaLinha)

  if (dryRun) {
    console.log('*** DRY-RUN: nada será gravado no banco. ***')
  }

  // Acumuladores do resultado de TODOS os lotes.
  const total: ResumoImportacao = {
    importados: 0,
    atualizados: 0,
    ignorados: 0,
    erros: 0,
    relatorio: [],
  }

  const numLotes = Math.ceil(linhas.length / TAMANHO_LOTE) || 0
  for (let inicio = 0, lote = 1; inicio < linhas.length; inicio += TAMANHO_LOTE, lote++) {
    const fatia = linhas.slice(inicio, inicio + TAMANHO_LOTE)
    console.log(
      `Lote ${lote}/${numLotes} — ${fatia.length} linhas ` +
        `(${inicio + 1}..${inicio + fatia.length})`,
    )

    const resumo = await comRetry(() =>
      importarAcervo({ empresaId, linhas: fatia, dryRun }),
    )

    total.importados += resumo.importados
    total.atualizados += resumo.atualizados
    total.ignorados += resumo.ignorados
    total.erros += resumo.erros
    total.relatorio.push(...resumo.relatorio)
  }

  // ── Resumo final ──
  console.log('\n===== RESUMO DA IMPORTAÇÃO =====')
  console.log(
    JSON.stringify(
      {
        importados: total.importados,
        atualizados: total.atualizados,
        ignorados: total.ignorados,
        erros: total.erros,
      },
      null,
      2,
    ),
  )

  if (total.relatorio.length > 0) {
    const amostra: RelatorioImportacao[] = total.relatorio.slice(0, 20)
    console.log(
      `\nRelatório de erros (primeiras ${amostra.length} de ${total.relatorio.length}):`,
    )
    for (const r of amostra) {
      console.log(`  • Calcgraf ${r.numeroCalcgraf ?? '(sem número)'}: ${r.motivo}`)
    }
  }

  await prisma.$disconnect()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
