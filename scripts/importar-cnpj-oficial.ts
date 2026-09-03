/**
 * Importa a base oficial de CNPJ da Receita Federal para a tabela local
 * `estabelecimento_cnpj`, FILTRANDO por CNAE (e opcionalmente UF) para manter
 * o volume gerenciável (o dump inteiro tem dezenas de milhões de linhas).
 *
 * Fonte oficial (dados abertos, gratuitos):
 *   https://arquivos.receitafederal.gov.br/dados/cnpj/dados_abertos_cnpj/
 * Estrutura: por ano-mês, arquivos "Estabelecimentos0..9.zip" (CSV ; latin1),
 * "Empresas*.zip" (razão social + porte) e "Cnaes.zip" (código → descrição).
 *
 * Layout do CSV de Estabelecimentos (sem cabeçalho, separador ';', aspas '"'):
 *   0 cnpj_basico, 1 cnpj_ordem, 2 cnpj_dv, 3 matriz_filial, 4 nome_fantasia,
 *   5 situacao_cadastral (02=ATIVA), 6 data_situacao, 7 motivo,
 *   8 nome_cidade_exterior, 9 pais, 10 data_inicio, 11 cnae_principal,
 *   12 cnae_secundaria, 13 tipo_logradouro, 14 logradouro, 15 numero,
 *   16 complemento, 17 bairro, 18 cep, 19 uf, 20 municipio, 21 ddd1, 22 tel1,
 *   23 ddd2, 24 tel2, 25 ddd_fax, 26 fax, 27 email, ...
 *
 * USO (executar manualmente, NÃO roda no start do servidor):
 *   npx tsx scripts/importar-cnpj-oficial.ts --cnaes=2063100,2062200 --uf=SP
 *   npx tsx scripts/importar-cnpj-oficial.ts --arquivo=./Estabelecimentos0.csv --cnaes=2063100
 *
 * Parâmetros:
 *   --cnaes=CSV     (obrigatório) CNAEs a importar (7 dígitos).
 *   --uf=SP         (opcional) filtra por UF.
 *   --arquivo=PATH  (opcional) usa um CSV já baixado/descompactado localmente.
 *                   Se omitido, o script apenas explica como baixar (o download
 *                   automático dos ~5GB fica a critério do operador de infra).
 *
 * OBS: o download+descompactação de vários GB é responsabilidade do operador
 * (varia muito por ambiente). Este script foca no que é reutilizável: PARSEAR
 * um CSV de Estabelecimentos e gravar só as linhas que batem com o filtro.
 */
import { createReadStream, existsSync, mkdirSync, createWriteStream, readdirSync, rmSync } from 'node:fs'
import { createInterface } from 'node:readline'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { execFileSync } from 'node:child_process'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

const BASE_RECEITA = 'https://arquivos.receitafederal.gov.br/dados/cnpj/dados_abertos_cnpj'

function parseArgs() {
  const args = process.argv.slice(2)
  const get = (k: string) => {
    const a = args.find((x) => x.startsWith(`--${k}=`))
    return a ? a.split('=').slice(1).join('=') : undefined
  }
  const has = (k: string) => args.includes(`--${k}`)
  return {
    cnaes: (get('cnaes') || '').split(',').map((c) => c.replace(/\D/g, '')).filter(Boolean),
    uf: (get('uf') || '').toUpperCase() || undefined,
    arquivo: get('arquivo'),
    auto: has('auto'),
    mes: get('mes'), // AAAA-MM (opcional; se omitido no --auto, tenta descobrir o mais recente)
    tmp: get('tmp') || join(process.cwd(), '.cnpj-tmp'),
  }
}

function montarCnpj(basico: string, ordem: string, dv: string): string {
  return `${basico.padStart(8, '0')}${ordem.padStart(4, '0')}${dv.padStart(2, '0')}`
}

const SITUACAO: Record<string, string> = {
  '01': 'NULA', '02': 'ATIVA', '03': 'SUSPENSA', '04': 'INAPTA', '08': 'BAIXADA',
}

async function importarArquivo(caminho: string, cnaes: string[], uf?: string) {
  const cnaeSet = new Set(cnaes)
  const rl = createInterface({ input: createReadStream(caminho, { encoding: 'latin1' }), crlfDelay: Infinity })

  let lidas = 0
  let gravadas = 0
  let lote: any[] = []

  const flush = async () => {
    if (lote.length === 0) return
    // upsert em lote via createMany + skipDuplicates (chave única cnpj).
    // Para dados que já existem, atualizamos individualmente os poucos casos.
    const res = await prisma.estabelecimentoCnpj.createMany({ data: lote, skipDuplicates: true })
    gravadas += res.count
    lote = []
  }

  for await (const linha of rl) {
    lidas++
    const cols = linha.split(';').map((c) => c.replace(/^"|"$/g, '').trim())
    if (cols.length < 28) continue

    const cnaePrincipal = cols[11]
    if (cnaeSet.size > 0 && !cnaeSet.has(cnaePrincipal)) continue
    if (uf && cols[19] !== uf) continue

    const cnpj = montarCnpj(cols[0], cols[1], cols[2])
    const tel = cols[21] && cols[22] ? `${cols[21]}${cols[22]}` : null

    lote.push({
      cnpj,
      razaoSocial: cols[4] || `CNPJ ${cnpj}`, // nome fantasia como fallback de razão (razão vem do arquivo Empresas)
      nomeFantasia: cols[4] || null,
      cnaePrincipal,
      cnaeDescricao: null,
      situacao: SITUACAO[cols[5]] || cols[5] || null,
      porte: null,
      logradouro: [cols[13], cols[14]].filter(Boolean).join(' ') || null,
      numero: cols[15] || null,
      complemento: cols[16] || null,
      bairro: cols[17] || null,
      cidade: cols[20] || null,
      uf: cols[19] || null,
      cep: cols[18] || null,
      telefone: tel,
      email: cols[27] || null,
    })

    if (lote.length >= 1000) await flush()
  }
  await flush()
  console.log(`✅ ${caminho}: ${lidas} linhas lidas, ${gravadas} estabelecimentos gravados (filtro CNAE=[${cnaes.join(',')}] UF=${uf || 'todos'})`)
}

/** Descobre o ANO-MES mais recente disponível no portal (ex.: 2026-08). */
async function descobrirMesMaisRecente(): Promise<string | null> {
  try {
    const resp = await fetch(`${BASE_RECEITA}/`, { headers: { Accept: 'text/html' } })
    if (!resp.ok) return null
    const html = await resp.text()
    // Os diretórios aparecem como links "AAAA-MM/". Pega o maior.
    const meses = [...html.matchAll(/(\d{4}-\d{2})\//g)].map((m) => m[1])
    if (meses.length === 0) return null
    meses.sort()
    return meses[meses.length - 1]
  } catch {
    return null
  }
}

/** Baixa um arquivo remoto para o disco (streaming, sem carregar tudo em memória). */
async function baixarArquivo(url: string, destino: string): Promise<boolean> {
  try {
    const resp = await fetch(url)
    if (!resp.ok || !resp.body) {
      console.log(`   ⚠️ ${url} → HTTP ${resp.status}`)
      return false
    }
    await pipeline(Readable.fromWeb(resp.body as any), createWriteStream(destino))
    return true
  } catch (e: any) {
    console.log(`   ⚠️ Falha ao baixar ${url}: ${e.message}`)
    return false
  }
}

/** Descompacta um .zip usando Expand-Archive (Windows) ou unzip (Linux/Render). */
function descompactar(zipPath: string, destDir: string) {
  if (process.platform === 'win32') {
    execFileSync('powershell', ['-NoProfile', '-Command', `Expand-Archive -LiteralPath '${zipPath}' -DestinationPath '${destDir}' -Force`], { stdio: 'inherit' })
  } else {
    execFileSync('unzip', ['-o', zipPath, '-d', destDir], { stdio: 'inherit' })
  }
}

/** Modo automático: baixa os 10 arquivos de Estabelecimentos do mês, descompacta e importa. */
async function modoAuto(cnaes: string[], uf: string | undefined, mesArg: string | undefined, tmp: string) {
  const mes = mesArg || (await descobrirMesMaisRecente())
  if (!mes) {
    console.error('❌ Não foi possível descobrir o mês disponível. Informe manualmente com --mes=AAAA-MM')
    process.exit(1)
  }
  console.log(`🌐 Usando base da Receita de ${mes}`)
  mkdirSync(tmp, { recursive: true })

  for (let i = 0; i < 10; i++) {
    const nomeZip = `Estabelecimentos${i}.zip`
    const url = `${BASE_RECEITA}/${mes}/${nomeZip}`
    const zipPath = join(tmp, nomeZip)

    console.log(`\n📥 [${i + 1}/10] Baixando ${nomeZip}...`)
    const ok = await baixarArquivo(url, zipPath)
    if (!ok) continue

    console.log(`📦 Descompactando ${nomeZip}...`)
    try {
      descompactar(zipPath, tmp)
    } catch (e: any) {
      console.log(`   ⚠️ Falha ao descompactar: ${e.message}`); continue
    }

    // O CSV extraído tem nome variável (ex.: "K3241.K03200Y0.D50809.ESTABELE").
    // Importa todos os arquivos extraídos deste zip que não sejam o próprio zip.
    const extraidos = readdirSync(tmp).filter((f) => !f.endsWith('.zip') && f.toUpperCase().includes('ESTABELE'))
    for (const f of extraidos) {
      const caminho = join(tmp, f)
      console.log(`🔄 Importando ${f}...`)
      await importarArquivo(caminho, cnaes, uf)
      rmSync(caminho, { force: true }) // libera espaço logo após importar
    }
    rmSync(zipPath, { force: true }) // remove o zip depois de processar
  }

  // Limpa a pasta temporária
  try { rmSync(tmp, { recursive: true, force: true }) } catch { /* ignore */ }
}

async function main() {
  const { cnaes, uf, arquivo, auto, mes, tmp } = parseArgs()

  if (cnaes.length === 0) {
    console.error('❌ Informe ao menos um CNAE: --cnaes=2063100,2062200')
    process.exit(1)
  }

  // Modo automático: baixa + descompacta + importa tudo (recomendado).
  if (auto) {
    console.log(`🚀 Modo automático — CNAEs: ${cnaes.join(',')}, UF: ${uf || 'todas'}`)
    await modoAuto(cnaes, uf, mes, tmp)
    const total = await prisma.estabelecimentoCnpj.count()
    console.log(`\n📊 Total de estabelecimentos na base local agora: ${total}`)
    return
  }

  if (!arquivo) {
    console.log(`
ℹ️  Escolha um modo:

  ▶ AUTOMÁTICO (recomendado) — baixa, descompacta e importa tudo:
      npx tsx scripts/importar-cnpj-oficial.ts --auto --cnaes=${cnaes.join(',')}${uf ? ` --uf=${uf}` : ''}
    (opcional: --mes=AAAA-MM para fixar o mês; padrão = mais recente)

  ▶ MANUAL — importa um CSV de Estabelecimentos já baixado/descompactado:
      npx tsx scripts/importar-cnpj-oficial.ts --arquivo=./ESTABELE.csv --cnaes=${cnaes.join(',')}${uf ? ` --uf=${uf}` : ''}

Só as linhas que batem com o CNAE/UF são gravadas — o volume no banco fica
proporcional ao seu nicho, não à base inteira (~60M de empresas).
`)
    await prisma.$disconnect()
    return
  }

  if (!existsSync(arquivo)) {
    console.error(`❌ Arquivo não encontrado: ${arquivo}`)
    process.exit(1)
  }

  console.log(`🔄 Importando ${arquivo} (CNAEs: ${cnaes.join(',')}, UF: ${uf || 'todas'})...`)
  await importarArquivo(arquivo, cnaes, uf)
  const total = await prisma.estabelecimentoCnpj.count()
  console.log(`📊 Total de estabelecimentos na base local agora: ${total}`)
}

main()
  .catch((e) => { console.error('❌ Importação falhou:', e); process.exit(1) })
  .finally(() => prisma.$disconnect())
