/**
 * Importador Calcgraf → Vizor (Carton Wega).
 *
 * Lê os JSONs exportados do SQL Server restaurado (cartoon/export/*.json,
 * gerados por scripts/_tmp-exportar-calcgraf.mjs) e grava no Vizor via Prisma.
 * Idempotente por empresa (limpa e recria o que importa).
 *
 * Uso:
 *   npx tsx scripts/importar-calcgraf.ts [--empresa <id>] [--fase precos|mapa|tipos-embalagem|tudo]
 * Sem --empresa: cria/usa a Carton Wega (CNPJ 23.787.041/0001-75) no banco
 * apontado pelo .env (LOCAL de dev por padrão — NÃO rodar contra produção sem
 * confirmação). Ver docs/calcgraf-mapeamento-importacao.md.
 */
import { PrismaClient } from '@prisma/client'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const prisma = new PrismaClient()
const EXPORT_DIR = join('cartoon', 'export')
const CNPJ_WEGA = '23.787.041/0001-75'

function lerJson<T = Record<string, unknown>>(nome: string): T[] {
  const raw = readFileSync(join(EXPORT_DIR, `${nome}.json`), 'utf8')
  return JSON.parse(raw) as T[]
}

function arg(nome: string): string | undefined {
  const i = process.argv.indexOf(`--${nome}`)
  return i >= 0 ? process.argv[i + 1] : undefined
}

async function garantirEmpresa(): Promise<string> {
  const idArg = arg('empresa')
  if (idArg) {
    const e = await prisma.empresa.findUnique({ where: { id: idArg } })
    if (!e) throw new Error(`Empresa ${idArg} não encontrada`)
    console.log(`Empresa alvo: ${e.razaoSocial} (${e.id})`)
    return e.id
  }
  let emp = await prisma.empresa.findFirst({ where: { cnpj: CNPJ_WEGA } })
  if (!emp) {
    emp = await prisma.empresa.create({
      data: {
        razaoSocial: 'CARTON WEGA INDUSTRIA DE EMBALAGENS SA',
        nomeFantasia: 'CARTON WEGA',
        cnpj: CNPJ_WEGA,
        usaWms: false,
      },
    })
    console.log(`Empresa Carton Wega CRIADA localmente: ${emp.id}`)
  } else {
    console.log(`Empresa Carton Wega já existe: ${emp.id}`)
  }
  return emp.id
}

// Mapeia a Origem do Itc (Calcgraf) para o `tipo` de PrecoMateriaPrima do Vizor.
function origemParaTipo(origem: string): string {
  switch ((origem || '').toUpperCase().trim()) {
    case 'TINTA': return 'TINTA'
    case 'SUPORTE': return 'PAPEL'
    case 'MAT.ACABAMENTO': return 'OUTRO'
    case 'MATRIZ IMPRESSÃO': return 'FACA'
    case 'SERVIÇO EXTERNO': return 'OUTRO'
    case 'CENTRO DE CUSTO': return 'OUTRO'
    default: return 'OUTRO'
  }
}

interface ItcRow { Codigo: number; Origem: string; Descritivo: string; Unidade: string; Ativo: string }
interface TcdRow { CodTabelaCusto: number; CodItc: number; Coluna: number; ValorTotal: number }

/**
 * Fase PREÇOS: importa Itc + TabelasCustoDetalhe → PrecoMateriaPrima.
 * Usa a tabela de custo padrão (menor CodTabelaCusto) e a coluna 1 (preço base),
 * pegando o maior ValorTotal>0 por item. Só materiais (exclui CENTRO DE CUSTO).
 */
async function importarPrecos(empresaId: string) {
  const itcs = lerJson<ItcRow>('Itc')
  const det = lerJson<TcdRow>('TabelasCustoDetalhe')
  const itcById = new Map(itcs.map((i) => [i.Codigo, i]))

  // preço por item: maior ValorTotal>0 (independente de tabela/coluna, p/ MVP)
  const precoPorItc = new Map<number, number>()
  for (const d of det) {
    if (!d.ValorTotal || d.ValorTotal <= 0) continue
    const atual = precoPorItc.get(d.CodItc) ?? 0
    if (d.ValorTotal > atual) precoPorItc.set(d.CodItc, d.ValorTotal)
  }

  const registros: Array<{ descricao: string; tipo: string; unidade: string; precoUnitario: number }> = []
  for (const [codItc, preco] of precoPorItc) {
    const itc = itcById.get(codItc)
    if (!itc) continue
    const origem = (itc.Origem || '').toUpperCase().trim()
    if (origem === 'CENTRO DE CUSTO' || origem === 'MATRIZ IMPRESSÃO') continue // custo-hora/faca não é MP de preço aqui
    registros.push({
      descricao: (itc.Descritivo || '').trim().slice(0, 200),
      tipo: origemParaTipo(itc.Origem),
      unidade: (itc.Unidade || 'UN').trim().slice(0, 6),
      precoUnitario: preco,
    })
  }

  // idempotente: remove os que foram importados antes (marca por descrição? usamos
  // deleteMany por empresa apenas dos importados nesta fase é arriscado; então
  // usamos upsert lógico por (empresaId, descricao, tipo) via find+update/create).
  let criados = 0
  let atualizados = 0
  for (const r of registros) {
    const existente = await prisma.precoMateriaPrima.findFirst({
      where: { empresaId, descricao: r.descricao, tipo: r.tipo } as never,
    })
    if (existente) {
      await prisma.precoMateriaPrima.update({ where: { id: (existente as { id: string }).id }, data: { precoUnitario: r.precoUnitario, unidade: r.unidade } as never })
      atualizados++
    } else {
      await prisma.precoMateriaPrima.create({ data: { empresaId, descricao: r.descricao, tipo: r.tipo, unidade: r.unidade, precoUnitario: r.precoUnitario } as never })
      criados++
    }
  }
  console.log(`Fase PREÇOS: ${criados} criados, ${atualizados} atualizados (${registros.length} itens de material com preço > 0).`)
}

// ═══════════════════════════════════════════════════════════════════════════
// FASE MAPA (RKW) — seed da "foto oficial" do Mapa de Custos da Carton Wega
// ═══════════════════════════════════════════════════════════════════════════
//
// IMPORTANTE — por que NÃO lemos os JSONs do Calcgraf aqui:
// Os exports em cartoon/export (GerCustoFixoMes, CentrosProducao,
// finRateiosCentrosCusto, ...) NÃO contêm a decomposição do Mapa RKW por
// funcionário/bem/despesa/chave — esses dados vivem no "Mapa de Custos RKW"
// da consultoria WebGraf, que a Wega não opera (só recebe o relatório
// impresso). `GerCustoFixoMes` traz apenas o TOTAL de custo fixo por
// competência (R$ 600.000). O motor RKW do Vizor precisa dos cadastros
// detalhados para calcular o custo/hora por centro.
//
// Por isso o seed reproduz a "foto oficial" impressa (relatórios RI-1..RI-6,
// emissão 03/11/2023, "Mapa: Carton Wega - Agosto 2023"), transcrita de
// docs/calcgraf-gprint-levantamento.md (§4–§12, RI-1..RI-6). Serve de golden
// case end-to-end: rodar POST /mapa-custo/:id/calcular e comparar os totais
// (Ativo Imobilizado 5.800.200, Depreciação ~34.043, Encargos 60%, etc.)
// com o relatório real. É a task 8.1 da spec mapa-custos-rkw.

const COMPETENCIA_REF = '2023-08'
const PERC_ENCARGOS_WEGA = 60 // §4 (Regime Normal)
const BHM = 150 // Base Horas Mês (§5)

// Centros do mapa (RI-2/RI-3/§5/§6). natureza + unidades/horas extras (produtivos).
// Nomes conforme relatórios; código curto estável para vínculo de chaves/funcionários.
interface CentroSeed {
  codigo: string
  descricao: string
  natureza: 'PRODUTIVO' | 'AUXILIAR' | 'ADMINISTRACAO'
  unidades?: number
  horasExtras?: number
  /** nome da chave de rateio usada para distribuir este centro (aux/adm). */
  chave?: string
}

const CENTROS: CentroSeed[] = [
  // Auxiliares (RI-2) — distribuídos nos produtivos por chave própria
  { codigo: 'AUX-FAB', descricao: 'Fábrica geral', natureza: 'AUXILIAR', chave: 'Fábrica' },
  { codigo: 'AUX-CI', descricao: 'Corte inicial', natureza: 'AUXILIAR', chave: 'Corte Inicial' },
  { codigo: 'AUX-PRE', descricao: 'Pré-impressão / CTP', natureza: 'AUXILIAR', chave: 'Pré-Impressão' },
  // Administração (§7 nota) — distribuída via chave "Administração-Distrib"
  { codigo: 'ADM', descricao: 'Administração', natureza: 'ADMINISTRACAO', chave: 'Administração-Distrib' },
  // Produtivos (§5 — horas = unidades×150 + extras)
  { codigo: 'ROLAND', descricao: 'Roland Ultra', natureza: 'PRODUTIVO', unidades: 1 },
  { codigo: 'SORMZ', descricao: 'Sormz - Verniz (Acabamento)', natureza: 'PRODUTIVO', unidades: 1 },
  { codigo: 'HEID-SM', descricao: 'Heidelberg SM', natureza: 'PRODUTIVO', unidades: 1 },
  { codigo: 'HEID-CD', descricao: 'Heidelberg CD', natureza: 'PRODUTIVO', unidades: 1, horasExtras: 75 },
  { codigo: 'KBA', descricao: 'KBA 6 cores', natureza: 'PRODUTIVO', unidades: 1, horasExtras: 75 },
  { codigo: 'CORTE-BOB', descricao: 'Corte de Bobina', natureza: 'PRODUTIVO', unidades: 2 },
  { codigo: 'COLAD', descricao: 'Coladeiras', natureza: 'PRODUTIVO', unidades: 2 },
  { codigo: 'PLAST', descricao: 'Plastificadoras', natureza: 'PRODUTIVO', unidades: 2 },
  { codigo: 'VINCO', descricao: 'Vincadeiras/(Corte/Vinco)', natureza: 'PRODUTIVO', unidades: 4 },
  { codigo: 'ACOPL', descricao: 'Acopladeiras', natureza: 'PRODUTIVO', unidades: 2 },
  { codigo: 'ACAB-GER', descricao: 'Acabamento Geral', natureza: 'PRODUTIVO', unidades: 1 },
]

const PRODUTIVOS = CENTROS.filter((c) => c.natureza === 'PRODUTIVO').map((c) => c.codigo)
const IMPRESSORAS = ['ROLAND', 'SORMZ', 'HEID-SM', 'HEID-CD', 'KBA']

// Bens a depreciar (RI-1/§7). anos + residual% + valor por centro.
// Total geral do ativo = 5.800.200 (rodapé do R1); as descrições são agregadas
// por centro quando o relatório não detalha bem a bem.
interface BemSeed { centro: string; grupo: string; descricao: string; valor: number; estado: 'OTIMO' | 'BOM' | 'REGULAR'; anos: number; residual: number }
const BENS: BemSeed[] = [
  { centro: 'AUX-FAB', grupo: 'Veículos', descricao: 'Frota (caminhões 3/4, Ford Cargo x2, Kpi, Fiorino) + Informática', valor: 623600, estado: 'BOM', anos: 5, residual: 60 },
  { centro: 'AUX-CI', grupo: 'Acabamento manual', descricao: 'Guilhotina Polar 150 + Guilhotina Tiger 130 DX', valor: 90000, estado: 'BOM', anos: 10, residual: 32 },
  { centro: 'AUX-PRE', grupo: 'Informática outros', descricao: 'CTP Screen + 4 computadores + Epson/Plotter/Servidor', valor: 169000, estado: 'BOM', anos: 10, residual: 30 },
  { centro: 'ROLAND', grupo: 'Impressoras', descricao: 'Roland Ultra', valor: 50000, estado: 'BOM', anos: 10, residual: 35 },
  { centro: 'SORMZ', grupo: 'Impressoras', descricao: 'Sormz - Verniz', valor: 85000, estado: 'BOM', anos: 10, residual: 35 },
  { centro: 'HEID-SM', grupo: 'Impressoras', descricao: 'Heidelberg SM', valor: 200000, estado: 'BOM', anos: 10, residual: 35 },
  { centro: 'HEID-CD', grupo: 'Impressoras', descricao: 'Heidelberg CD', valor: 800000, estado: 'BOM', anos: 10, residual: 35 },
  { centro: 'KBA', grupo: 'Impressoras', descricao: 'KBA 6 cores', valor: 1650000, estado: 'BOM', anos: 10, residual: 40 },
  { centro: 'CORTE-BOB', grupo: 'Acabamento autom.', descricao: 'Cortadeira Dellmark + Cortadeira Makpel', valor: 190000, estado: 'BOM', anos: 10, residual: 35 },
  { centro: 'COLAD', grupo: 'Acabamento autom.', descricao: 'Coladeira AFT 70 + Bobst Media 68', valor: 455000, estado: 'BOM', anos: 10, residual: 35 },
  { centro: 'PLAST', grupo: 'Acabamento autom.', descricao: 'Plastificadoras 80cm + 60cm', valor: 27000, estado: 'BOM', anos: 10, residual: 35 },
  { centro: 'VINCO', grupo: 'Acabamento autom.', descricao: 'Bobst E + Bobst S + Vinco Feva + Vinco Hot', valor: 1305000, estado: 'BOM', anos: 10, residual: 35 },
  { centro: 'ACOPL', grupo: 'Acabamento autom.', descricao: 'Acopladeira Jato + semi-automática', valor: 99000, estado: 'BOM', anos: 10, residual: 40 },
  { centro: 'ACAB-GER', grupo: 'Acabamento manual', descricao: 'Máquina de Destaque', valor: 3000, estado: 'BOM', anos: 10, residual: 35 },
  { centro: 'ADM', grupo: 'Informática outros', descricao: 'Computadores administrativos + Servidor VPS', valor: 53600, estado: 'BOM', anos: 3, residual: 0 },
]

// Funcionários por centro (RI-5/§8). Total salários por centro agregado quando o
// relatório não detalha pessoa a pessoa; os 3 rateados entram com flag rateado.
interface FuncSeed { centro: string | null; nome: string; cargo?: string; salario: number; ajuda?: number; rateado?: boolean }
const FUNCIONARIOS: FuncSeed[] = [
  { centro: 'AUX-FAB', nome: 'Equipe Fábrica geral (24)', cargo: 'Diversos', salario: 55819.10 },
  { centro: 'AUX-CI', nome: 'Equipe Corte inicial (3)', cargo: 'Operadores', salario: 6591.37 },
  { centro: 'AUX-PRE', nome: 'Equipe Pré-impressão/CTP (4)', cargo: 'Analistas/Arte-finalista', salario: 12705.48, ajuda: 628 },
  { centro: 'SORMZ', nome: 'Equipe Sormz-Verniz (2)', cargo: 'Operador/Aux', salario: 3401.06 },
  { centro: 'HEID-CD', nome: 'Equipe Heidelberg CD (3)', cargo: 'Impressores/Aux', salario: 10753.40, ajuda: 698 },
  { centro: 'KBA', nome: 'Equipe KBA 6 cores (2)', cargo: 'Impressores', salario: 7152.38 },
  { centro: 'CORTE-BOB', nome: 'Equipe Corte de Bobina (2)', cargo: 'Operadores', salario: 3547.91 },
  { centro: 'COLAD', nome: 'Equipe Coladeiras (9)', cargo: 'Operadores', salario: 20799.64, ajuda: 218 },
  { centro: 'PLAST', nome: 'Equipe Plastificadoras (5)', cargo: 'Operadores', salario: 8345.10 },
  { centro: 'VINCO', nome: 'Equipe Vincadeiras (7)', cargo: 'Operadores', salario: 19056.13, ajuda: 168 },
  { centro: 'ACOPL', nome: 'Equipe Acopladeiras (3)', cargo: 'Operadores', salario: 8500.00 },
  { centro: 'ACAB-GER', nome: 'Equipe Acabamento Geral (30)', cargo: 'Aux. produção', salario: 43484.67, ajuda: 218 },
  { centro: 'ADM', nome: 'Equipe Administração (11)', cargo: 'Adm/Comercial/RH', salario: 27941.52, ajuda: 3000 },
  // Rateados (§8.2 / RI-6b)
  { centro: null, nome: 'Fabio Eduardo Vidal Silva', cargo: 'Impressor offset PL2', salario: 4635.10, ajuda: 218, rateado: true },
  { centro: null, nome: 'Higor Lopes de Melo', cargo: 'Aux. produção JR01', salario: 1388.39, rateado: true },
  { centro: null, nome: 'Thiago Bordim', cargo: 'Gestão de Produção', salario: 11500.00, ajuda: 1750, rateado: true },
]

// Despesas mensais + chave de rateio (RI-4).
interface DespSeed { descricao: string; valor: number; chave: string }
const DESPESAS: DespSeed[] = [
  { descricao: 'Água e Esgoto', valor: 400, chave: 'Quant. funcionários' },
  { descricao: 'Aluguel e IPTU', valor: 8200, chave: 'Administração' },
  { descricao: 'Associações de Classe', valor: 500, chave: 'Administração' },
  { descricao: 'Comunicação (fone/internet)', valor: 2200, chave: 'Administração' },
  { descricao: 'Despesas Bancárias', valor: 3100, chave: 'Administração' },
  { descricao: 'Despesas com Manutenção (geral) - exceto máquinas', valor: 45000, chave: 'Administração' },
  { descricao: 'Despesas com Pessoal', valor: 59171.19, chave: 'Quant. funcionários' },
  { descricao: 'Despesas com Veículos', valor: 38270, chave: 'Administração' },
  { descricao: 'Energia Elétrica', valor: 23477.90, chave: 'Administração' },
  { descricao: 'Honorários Diretoria', valor: 30000, chave: 'Administração' },
  { descricao: 'Honorários esporádicos', valor: 6310, chave: 'Administração' },
  { descricao: 'Honorários Profissionais', valor: 13000, chave: 'Administração' },
  { descricao: 'Manutenção de Máquinas', valor: 72080.63, chave: 'Manutenção máquinas' },
  { descricao: 'Manutenção Predial', valor: 7000, chave: 'Administração' },
  { descricao: 'Material de Limpeza e Copa', valor: 3471.10, chave: 'Administração' },
  { descricao: 'Propagandas e Brindes', valor: 2800.94, chave: 'Administração' },
  { descricao: 'Seguro Imóvel/Equipamentos/Veículos', valor: 5066, chave: 'Administração' },
  { descricao: 'Suprimentos Administração', valor: 935.22, chave: 'Administração' },
  { descricao: 'Treinamentos e Consultorias', valor: 1000, chave: 'Administração' },
]

/**
 * Fase MAPA: cria (idempotente) o MapaCusto de referência 2023-08 com os
 * cadastros da foto oficial, e roda o cálculo. Se já existir mapa nessa
 * competência, apaga e recria (RASCUNHO) para refletir eventual ajuste do seed.
 */
async function importarMapa(empresaId: string) {
  const p = prisma as never as {
    mapaCusto: { findFirst: (a: unknown) => Promise<{ id: string; status: string } | null>; delete: (a: unknown) => Promise<unknown>; create: (a: unknown) => Promise<{ id: string }>; update: (a: unknown) => Promise<unknown> }
    mapaCentro: { create: (a: unknown) => Promise<{ id: string }> }
    bemDepreciar: { create: (a: unknown) => Promise<unknown> }
    funcionarioCusto: { create: (a: unknown) => Promise<{ id: string }> }
    despesaCusto: { create: (a: unknown) => Promise<unknown> }
    chaveRateio: { create: (a: unknown) => Promise<{ id: string }> }
  }

  const existente = await p.mapaCusto.findFirst({ where: { empresaId, competencia: COMPETENCIA_REF } })
  if (existente) {
    if (existente.status === 'FECHADO') {
      console.log(`Fase MAPA: já existe mapa FECHADO para ${COMPETENCIA_REF} — não sobrescrevo. Pule ou reabra manualmente.`)
      return
    }
    await p.mapaCusto.delete({ where: { id: existente.id } }) // cascade limpa filhos
    console.log(`Fase MAPA: mapa RASCUNHO ${COMPETENCIA_REF} anterior removido para recriação.`)
  }

  const mapa = await p.mapaCusto.create({
    data: {
      empresaId,
      competencia: COMPETENCIA_REF,
      descricao: 'Carton Wega — Agosto/2023 (seed dos relatórios RI-1..RI-6)',
      percEncargos: PERC_ENCARGOS_WEGA,
      horasProdutivasBase: BHM,
      ajustePraticarPerc: 0,
    },
  })
  const mapaId = mapa.id

  // 1) Centros
  const centroIdPorCodigo = new Map<string, string>()
  let pos = 0
  for (const c of CENTROS) {
    const horas = c.natureza === 'PRODUTIVO' ? (c.unidades ?? 1) * BHM + (c.horasExtras ?? 0) : null
    const created = await p.mapaCentro.create({
      data: {
        empresaId,
        mapaCustoId: mapaId,
        codigo: c.codigo,
        descricao: c.descricao,
        natureza: c.natureza,
        usoOrcamento: c.natureza === 'PRODUTIVO',
        unidadesProdutivas: c.unidades ?? 1,
        turnos: 1,
        horasExtras: c.horasExtras ?? 0,
        horasProdutivas: horas,
        posicao: pos++,
      },
    })
    centroIdPorCodigo.set(c.codigo, created.id)
  }
  const cid = (codigo: string) => centroIdPorCodigo.get(codigo)!

  // 2) Chaves de rateio (RI-6). Criadas ANTES de despesas/centros que as referenciam.
  const chaveIdPorNome = new Map<string, string>()
  async function criarChave(nome: string, tipo: string, destinos: Array<{ codigo: string; peso: number }>) {
    const k = await p.chaveRateio.create({
      data: {
        empresaId,
        mapaCustoId: mapaId,
        nome,
        tipo,
        destinos: { create: destinos.map((d) => ({ centroCustoId: cid(d.codigo), peso: d.peso })) },
      },
    })
    chaveIdPorNome.set(nome, k.id)
  }
  // Auxiliares
  await criarChave('Fábrica', 'MANUAL', PRODUTIVOS.map((codigo) => ({ codigo, peso: 1 }))) // 1/11 cada
  await criarChave('Corte Inicial', 'MANUAL', IMPRESSORAS.map((codigo) => ({ codigo, peso: 1 }))) // só impressoras
  await criarChave('Pré-Impressão', 'MANUAL', IMPRESSORAS.map((codigo) => ({ codigo, peso: 1 })))
  // Administração → distribui igualmente nos produtivos (destino do centro ADM)
  await criarChave('Administração-Distrib', 'MANUAL', PRODUTIVOS.map((codigo) => ({ codigo, peso: 1 })))
  // Despesas
  await criarChave('Administração', 'CENTRO', [{ codigo: 'ADM', peso: 1 }]) // 100% ao centro Administração
  await criarChave('Quant. funcionários', 'HEADCOUNT', CENTROS.map((c) => ({ codigo: c.codigo, peso: 1 }))) // peso automático = headcount
  await criarChave('Manutenção máquinas', 'ATIVO', PRODUTIVOS.map((codigo) => ({ codigo, peso: 1 }))) // peso automático = ativo do centro

  // 3) Bens
  for (const b of BENS) {
    const base = b.valor - (b.valor * b.residual) / 100
    const dep = base / (b.anos * 12)
    await p.bemDepreciar.create({
      data: {
        empresaId, mapaCustoId: mapaId, centroCustoId: cid(b.centro),
        grupo: b.grupo, descricao: b.descricao, valor: b.valor,
        estado: b.estado, anosVidaUtil: b.anos, residualPerc: b.residual,
        depreciacaoMensal: dep,
      },
    })
  }

  // 4) Funcionários
  const funcRateadoId = new Map<string, string>()
  for (const f of FUNCIONARIOS) {
    const created = await p.funcionarioCusto.create({
      data: {
        empresaId, mapaCustoId: mapaId,
        centroCustoId: f.centro ? cid(f.centro) : null,
        nome: f.nome, cargo: f.cargo ?? null,
        salario: f.salario, ajudaCusto: f.ajuda ?? 0, rateado: f.rateado ?? false,
      },
    })
    if (f.rateado) funcRateadoId.set(f.nome, created.id)
  }

  // 4b) Chaves de funcionários rateados (RI-6b)
  const thiago = funcRateadoId.get('Thiago Bordim')
  const fabio = funcRateadoId.get('Fabio Eduardo Vidal Silva')
  const higor = funcRateadoId.get('Higor Lopes de Melo')
  async function criarChaveFunc(nome: string, funcId: string | undefined, destinos: Array<{ codigo: string; peso: number }>) {
    if (!funcId) return
    await p.chaveRateio.create({
      data: {
        empresaId, mapaCustoId: mapaId, nome, tipo: 'FUNCIONARIO', funcionarioCustoId: funcId,
        destinos: { create: destinos.map((d) => ({ centroCustoId: cid(d.codigo), peso: d.peso })) },
      },
    })
  }
  // Thiago: 1 em cada produtivo (rateio igualitário) — usa os 11 produtivos.
  await criarChaveFunc('Rateio Thiago Bordim', thiago, PRODUTIVOS.map((codigo) => ({ codigo, peso: 1 })))
  // Fabio e Higor: 50/50 Roland x Heidelberg SM
  await criarChaveFunc('Rateio Fabio', fabio, [{ codigo: 'ROLAND', peso: 50 }, { codigo: 'HEID-SM', peso: 50 }])
  await criarChaveFunc('Rateio Higor', higor, [{ codigo: 'ROLAND', peso: 50 }, { codigo: 'HEID-SM', peso: 50 }])

  // 5) Despesas
  for (const d of DESPESAS) {
    const chaveId = chaveIdPorNome.get(d.chave)
    if (!chaveId) { console.warn(`  ! despesa "${d.descricao}" sem chave "${d.chave}" — pulada`); continue }
    await p.despesaCusto.create({
      data: { empresaId, mapaCustoId: mapaId, descricao: d.descricao, valor: d.valor, chaveRateioId: chaveId },
    })
  }

  const ativoTotal = BENS.reduce((s, b) => s + b.valor, 0)
  const depTotal = BENS.reduce((s, b) => s + (b.valor - (b.valor * b.residual) / 100) / (b.anos * 12), 0)
  const salarioTotal = FUNCIONARIOS.reduce((s, f) => s + f.salario, 0)
  console.log(`Fase MAPA: mapa ${COMPETENCIA_REF} criado (id ${mapaId}).`)
  console.log(`  Centros: ${CENTROS.length} | Bens: ${BENS.length} | Funcionários: ${FUNCIONARIOS.length} | Despesas: ${DESPESAS.length} | Chaves: ${chaveIdPorNome.size + 3}`)
  console.log(`  Conferência vs RI: Ativo Imobilizado R$ ${ativoTotal.toLocaleString('pt-BR')} (esperado 5.800.200)`) 
  console.log(`  Depreciação mensal ~R$ ${depTotal.toFixed(2)} (esperado ~34.043) | Σ salários R$ ${salarioTotal.toFixed(2)}`)
  console.log(`  Rode POST /api/pcp/mapa-custo/${mapaId}/calcular para gerar os ResultadoCentro e comparar com o R1.`)
}

// ═══════════════════════════════════════════════════════════════════════════
// FASE TIPOS-EMBALAGEM (BAIXO RISCO) — Produtos.json → TipoEmbalagem
// ═══════════════════════════════════════════════════════════════════════════
//
// DECISÃO DE ESCOPO (usuário, esta sessão): as OPs SEMPRE nascem por importação
// de PDF. Não importamos SKUs de clientes do Calcgraf → a sub-fase de alto risco
// (produtos-acabados que tocaria `Produto`/OP/programação) foi DESCARTADA.
//
// O export `Produtos.json` (12 registros) NÃO são produtos acabados — são TIPOS
// de embalagem (Cartuchos, Sacola, Caixa, Cartelas...) com flags de geometria/
// montagem. Mapeiam para `TipoEmbalagem` do Orçamento Gráfico, que NÃO tem
// relação com `Produto`/OP — logo, esta fase é SEGURA (não afeta produção).
//
// ATENÇÃO — fórmulas de planificação: o Calcgraf NÃO exporta as fórmulas
// (largura/altura planificadas — vivem no código Delphi fechado). O
// `TipoEmbalagem` do Vizor exige `formulaLargura`/`formulaAltura`. Por isso
// criamos cada tipo com uma FÓRMULA-BASE genérica por dimensionalidade (2D/3D),
// que é um PONTO DE CALIBRAÇÃO: o usuário ajusta as fórmulas reais depois na
// tela de Tipos de Embalagem. As flags do Calcgraf definem os processos
// obrigatórios (colagem/corte-vinco) e servem de dica para a fórmula.

interface ProdutoCalcgrafRow {
  Codigo: number
  Ativo: string
  Nome: string
  Formato: string // "2 dimensões" | "3 dimensões"
  flagFormulaColagemLateral?: number
  flagFormulaFundoAutomatico?: number
  FlagSanfona?: number
  flagSanfonaFundo?: number
  AbaColaLateral?: number
  AbaColaFundo?: number
}

// Fórmula-base por dimensionalidade. Variáveis do avaliador do Vizor:
// L (largura), A (altura), P (profundidade), ABA, SANGRIA, PINCA + parâmetros.
// 3 dimensões (caixa/cartucho): planificação = perímetro + aba de colagem.
// 2 dimensões (cartela/plano): planificação ≈ a própria medida + sangria.
function formulasBase(formato: string): { largura: string; altura: string; params3d: boolean } {
  const is3d = /3/.test(formato || '')
  if (is3d) {
    return {
      largura: '(L + P) * 2 + ABA + SANGRIA * 2',
      altura: 'A + P + SANGRIA * 2',
      params3d: true,
    }
  }
  return {
    largura: 'L + SANGRIA * 2',
    altura: 'A + SANGRIA * 2',
    params3d: false,
  }
}

function processosDoTipo(row: ProdutoCalcgrafRow): string[] {
  const proc = ['IMPRESSAO', 'CORTE_VINCO']
  const colagem = row.flagFormulaColagemLateral || row.flagFormulaFundoAutomatico || row.AbaColaLateral || row.AbaColaFundo
  if (colagem) proc.push('COLAGEM')
  return proc
}

/**
 * Fase TIPOS-EMBALAGEM: cria/atualiza (idempotente por empresaId+codigo) os
 * TipoEmbalagem a partir dos 12 tipos do Calcgraf. NÃO toca `Produto`.
 * Preserva fórmulas já ajustadas manualmente: se o tipo já existe, só atualiza
 * descrição/processos, NÃO sobrescreve as fórmulas (evita apagar calibração).
 */
async function importarTiposEmbalagem(empresaId: string) {
  const produtos = lerJson<ProdutoCalcgrafRow>('Produtos')
  const p = prisma as never as {
    tipoEmbalagem: {
      findFirst: (a: unknown) => Promise<{ id: string } | null>
      create: (a: unknown) => Promise<unknown>
      update: (a: unknown) => Promise<unknown>
    }
  }

  let criados = 0
  let atualizados = 0
  for (const prod of produtos) {
    const codigo = `CG-EMB-${prod.Codigo}`.slice(0, 30)
    const descricao = (prod.Nome || '').trim().replace(/\s+/g, ' ').slice(0, 200)
    if (!descricao) continue
    const f = formulasBase(prod.Formato)
    const parametros = f.params3d
      ? [
          { nome: 'L', label: 'Largura', unidade: 'mm', obrigatorio: true, default: 0 },
          { nome: 'A', label: 'Altura', unidade: 'mm', obrigatorio: true, default: 0 },
          { nome: 'P', label: 'Profundidade', unidade: 'mm', obrigatorio: true, default: 0 },
        ]
      : [
          { nome: 'L', label: 'Largura', unidade: 'mm', obrigatorio: true, default: 0 },
          { nome: 'A', label: 'Altura', unidade: 'mm', obrigatorio: true, default: 0 },
        ]
    const processos = processosDoTipo(prod)

    const existente = await p.tipoEmbalagem.findFirst({ where: { empresaId, codigo } })
    if (existente) {
      // Não sobrescreve fórmulas (calibração manual) — só metadados.
      await p.tipoEmbalagem.update({
        where: { id: existente.id },
        data: { descricao, processosObrigatorios: processos, status: prod.Ativo === 'ATIVO' },
      })
      atualizados++
    } else {
      await p.tipoEmbalagem.create({
        data: {
          empresaId,
          codigo,
          descricao,
          formulaLargura: f.largura,
          formulaAltura: f.altura,
          parametros,
          processosObrigatorios: processos,
          status: prod.Ativo === 'ATIVO',
        },
      })
      criados++
    }
  }
  console.log(`Fase TIPOS-EMBALAGEM: ${criados} criados, ${atualizados} atualizados (${produtos.length} tipos do Calcgraf).`)
  console.log('  ⚠ Fórmulas de planificação são BASE genérica (2D/3D) — CALIBRAR na tela Tipos de Embalagem.')
  console.log('  Nenhum `Produto`/OP/programação foi tocado (fase segura).')
}

async function main() {
  const empresaId = await garantirEmpresa()
  const fase = arg('fase') ?? 'precos'
  console.log(`Fase: ${fase}`)
  if (fase === 'precos' || fase === 'tudo') {
    await importarPrecos(empresaId)
  }
  if (fase === 'mapa' || fase === 'tudo') {
    await importarMapa(empresaId)
  }
  if (fase === 'tipos-embalagem' || fase === 'tudo') {
    await importarTiposEmbalagem(empresaId)
  }
  console.log('Importação concluída.')
}

main()
  .catch((e) => { console.error('❌ Importação falhou:', e.message); process.exit(1) })
  .finally(() => prisma.$disconnect())
