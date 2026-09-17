/**
 * Plano de Contas GERENCIAL padrão (Brasil) — categorias de receita/despesa
 * para o DRE gerencial. Não existe um plano gerencial legalmente obrigatório
 * (o obrigatório é o contábil, tratado no módulo Contabilidade); este é o
 * modelo de mercado consolidado (Omie/Conta Azul/Sankhya), organizado em
 * grupos sintéticos (pai) e contas analíticas (filhas).
 *
 * Estrutura por código hierárquico "N.N": receitas em 1.x, deduções 2.x,
 * custos 3.x, despesas operacionais 4.x, despesas com pessoal 5.x, despesas
 * financeiras 6.x, impostos/tributos 7.x, investimentos/não operacionais 8.x.
 */
import type { PrismaClient } from '@prisma/client'
import type { TipoCategoria } from './financeiro.types'

interface NoPlano {
  codigo: string
  nome: string
  tipo: TipoCategoria
  filhos?: { codigo: string; nome: string }[]
}

/** Modelo padrão. Grupos (pai) + contas analíticas (filhas). */
export const PLANO_CONTAS_PADRAO: NoPlano[] = [
  {
    codigo: '1', nome: 'Receitas', tipo: 'RECEITA',
    filhos: [
      { codigo: '1.01', nome: 'Receita de Venda de Produtos' },
      { codigo: '1.02', nome: 'Receita de Venda de Mercadorias' },
      { codigo: '1.03', nome: 'Receita de Prestação de Serviços' },
      { codigo: '1.04', nome: 'Receita de Frete' },
      { codigo: '1.05', nome: 'Outras Receitas Operacionais' },
    ],
  },
  {
    codigo: '2', nome: 'Deduções da Receita', tipo: 'DESPESA',
    filhos: [
      { codigo: '2.01', nome: 'Devoluções de Vendas' },
      { codigo: '2.02', nome: 'Descontos Concedidos' },
      { codigo: '2.03', nome: 'Impostos sobre Vendas (ICMS/ISS/PIS/COFINS)' },
      { codigo: '2.04', nome: 'Simples Nacional (DAS)' },
    ],
  },
  {
    codigo: '3', nome: 'Custos', tipo: 'DESPESA',
    filhos: [
      { codigo: '3.01', nome: 'Custo das Mercadorias Vendidas (CMV)' },
      { codigo: '3.02', nome: 'Custo dos Produtos Vendidos (CPV)' },
      { codigo: '3.03', nome: 'Custo dos Serviços Prestados (CSP)' },
      { codigo: '3.04', nome: 'Matéria-Prima e Insumos' },
      { codigo: '3.05', nome: 'Fretes sobre Compras' },
    ],
  },
  {
    codigo: '4', nome: 'Despesas Operacionais', tipo: 'DESPESA',
    filhos: [
      { codigo: '4.01', nome: 'Aluguel e Condomínio' },
      { codigo: '4.02', nome: 'Energia Elétrica' },
      { codigo: '4.03', nome: 'Água e Esgoto' },
      { codigo: '4.04', nome: 'Telefone e Internet' },
      { codigo: '4.05', nome: 'Material de Escritório e Consumo' },
      { codigo: '4.06', nome: 'Manutenção e Reparos' },
      { codigo: '4.07', nome: 'Limpeza e Conservação' },
      { codigo: '4.08', nome: 'Seguros' },
      { codigo: '4.09', nome: 'Software e Assinaturas' },
      { codigo: '4.10', nome: 'Marketing e Publicidade' },
      { codigo: '4.11', nome: 'Viagens e Deslocamentos' },
      { codigo: '4.12', nome: 'Combustível e Frota' },
      { codigo: '4.13', nome: 'Serviços de Terceiros (PJ)' },
      { codigo: '4.14', nome: 'Honorários Contábeis' },
      { codigo: '4.15', nome: 'Despesas Legais e Jurídicas' },
      { codigo: '4.99', nome: 'Outras Despesas Administrativas' },
    ],
  },
  {
    codigo: '5', nome: 'Despesas com Pessoal', tipo: 'DESPESA',
    filhos: [
      { codigo: '5.01', nome: 'Salários e Ordenados' },
      { codigo: '5.02', nome: 'Pró-labore' },
      { codigo: '5.03', nome: 'Encargos Sociais (INSS/FGTS)' },
      { codigo: '5.04', nome: '13º Salário' },
      { codigo: '5.05', nome: 'Férias' },
      { codigo: '5.06', nome: 'Rescisões' },
      { codigo: '5.07', nome: 'Vale-Transporte' },
      { codigo: '5.08', nome: 'Vale-Alimentação/Refeição' },
      { codigo: '5.09', nome: 'Plano de Saúde' },
      { codigo: '5.10', nome: 'Comissões e Bonificações' },
      { codigo: '5.11', nome: 'Treinamento e Capacitação' },
    ],
  },
  {
    codigo: '6', nome: 'Despesas Financeiras', tipo: 'DESPESA',
    filhos: [
      { codigo: '6.01', nome: 'Juros e Multas Pagos' },
      { codigo: '6.02', nome: 'Tarifas Bancárias' },
      { codigo: '6.03', nome: 'IOF' },
      { codigo: '6.04', nome: 'Taxas de Cartão/Adquirente' },
      { codigo: '6.05', nome: 'Descontos Financeiros Concedidos' },
    ],
  },
  {
    codigo: '7', nome: 'Receitas Financeiras', tipo: 'RECEITA',
    filhos: [
      { codigo: '7.01', nome: 'Juros e Multas Recebidos' },
      { codigo: '7.02', nome: 'Rendimentos de Aplicações' },
      { codigo: '7.03', nome: 'Descontos Obtidos' },
    ],
  },
  {
    codigo: '8', nome: 'Tributos sobre o Lucro', tipo: 'DESPESA',
    filhos: [
      { codigo: '8.01', nome: 'IRPJ' },
      { codigo: '8.02', nome: 'CSLL' },
    ],
  },
  {
    codigo: '9', nome: 'Investimentos e Não Operacionais', tipo: 'DESPESA',
    filhos: [
      { codigo: '9.01', nome: 'Aquisição de Imobilizado' },
      { codigo: '9.02', nome: 'Empréstimos e Financiamentos' },
      { codigo: '9.03', nome: 'Distribuição de Lucros' },
      { codigo: '9.99', nome: 'Outras Despesas Não Operacionais' },
    ],
  },
]

export interface ResultadoPopular {
  criadas: number
  existentes: number
}

/**
 * Popula o plano de contas gerencial padrão para uma empresa. Idempotente:
 * só cria categorias cujo `codigo` ainda não existe (não duplica, não sobrescreve
 * o que o usuário já ajustou). Cria os grupos (pai) primeiro e vincula as
 * filhas via `paiId`.
 */
export async function popularPlanoContasPadrao(
  prisma: PrismaClient,
  empresaId: string,
): Promise<ResultadoPopular> {
  const existentes = await prisma.categoriaFinanceira.findMany({
    where: { empresaId },
    select: { id: true, codigo: true },
  })
  const mapaCodigo = new Map(existentes.map((c) => [c.codigo, c.id]))
  let criadas = 0

  for (const grupo of PLANO_CONTAS_PADRAO) {
    // Grupo (pai)
    let paiId = mapaCodigo.get(grupo.codigo)
    if (!paiId) {
      const pai = await prisma.categoriaFinanceira.create({
        data: { empresaId, tipo: grupo.tipo, codigo: grupo.codigo, nome: grupo.nome },
        select: { id: true },
      })
      paiId = pai.id
      mapaCodigo.set(grupo.codigo, paiId)
      criadas++
    }

    // Contas analíticas (filhas)
    for (const filho of grupo.filhos ?? []) {
      if (mapaCodigo.has(filho.codigo)) continue
      const nova = await prisma.categoriaFinanceira.create({
        data: { empresaId, tipo: grupo.tipo, codigo: filho.codigo, nome: filho.nome, paiId },
        select: { id: true },
      })
      mapaCodigo.set(filho.codigo, nova.id)
      criadas++
    }
  }

  const totalPadrao =
    PLANO_CONTAS_PADRAO.length +
    PLANO_CONTAS_PADRAO.reduce((s, g) => s + (g.filhos?.length ?? 0), 0)
  return { criadas, existentes: totalPadrao - criadas }
}


/**
 * Classificador automático: dado um texto (descrição/beneficiário/tipo do
 * documento), sugere o CÓDIGO da categoria do plano padrão mais provável.
 * Heurística por palavra-chave — usada pela IA ao lançar um documento quando
 * o usuário não informou a categoria. Retorna o código (ex.: '4.02') ou null.
 *
 * `tipo` ('pagar'|'receber') restringe o universo (despesa vs receita).
 */
export function sugerirCategoriaPorTexto(
  texto: string,
  tipo: 'pagar' | 'receber',
): string | null {
  const t = (texto || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  if (!t) return null

  if (tipo === 'receber') {
    if (/servic|consultoria|honorario/.test(t)) return '1.03'
    if (/frete/.test(t)) return '1.04'
    if (/juro|multa|rendiment/.test(t)) return '7.01'
    if (/venda|produto|mercadoria|nota fiscal|nf-?e/.test(t)) return '1.01'
    return null
  }

  // DESPESA — ordem importa (mais específico primeiro)
  const regras: Array<[RegExp, string]> = [
    [/energia|eletric|light|enel|cemig|copel|celesc|cpfl|neoenergia|equatorial/, '4.02'],
    [/agua|esgoto|saneament|sabesp|cedae|copasa|sanepar|caesb/, '4.03'],
    [/telefon|internet|celular|vivo|claro|tim|oi\b|net\b|banda larga/, '4.04'],
    [/aluguel|condominio|locacao de imovel/, '4.01'],
    [/darf|das\b|gps\b|inss|fgts|iss\b|icms|simples nacional|imposto|tributo|guia/, tipoImpostoParaCodigo(t)],
    [/combustivel|gasolina|diesel|etanol|posto|frota/, '4.12'],
    [/software|assinatura|saas|licenc|sistema|hospedagem|nuvem|cloud/, '4.09'],
    [/marketing|publicidade|anuncio|google ads|meta ads|propaganda/, '4.10'],
    [/contab|contador|escritorio contabil/, '4.14'],
    [/advogad|juridic|honorario advocatic/, '4.15'],
    [/salario|folha|ordenado/, '5.01'],
    [/pro-?labore|prolabore/, '5.02'],
    [/vale.?transporte|vt\b/, '5.07'],
    [/vale.?alimentac|vale.?refeic|va\b|vr\b|ticket|sodexo|alelo/, '5.08'],
    [/plano de saude|unimed|amil|bradesco saude|convenio medico/, '5.09'],
    [/comissao|bonificac/, '5.10'],
    [/tarifa bancaria|tarifa|manutencao de conta/, '6.02'],
    [/iof/, '6.03'],
    [/taxa de cartao|adquirente|cielo|rede\b|getnet|stone|pagseguro/, '6.04'],
    [/juro|multa|encargo/, '6.01'],
    [/seguro/, '4.08'],
    [/material de escritorio|papelaria|material de consumo/, '4.05'],
    [/manutencao|reparo|conserto/, '4.06'],
    [/limpeza|conservacao/, '4.07'],
    [/viagem|hotel|passagem|hospedagem|deslocament/, '4.11'],
    [/materia.?prima|insumo|papel|tinta|embalagem/, '3.04'],
    [/frete sobre compra|frete de compra/, '3.05'],
    [/emprestimo|financiamento/, '9.02'],
    [/imobilizado|maquina|equipamento|veiculo/, '9.01'],
  ]
  for (const [re, codigo] of regras) {
    if (re.test(t)) return codigo
  }
  return '4.99' // fallback: Outras Despesas Administrativas
}

/** Distingue impostos sobre venda (2.03/2.04) de tributos sobre lucro (8.x). */
function tipoImpostoParaCodigo(t: string): string {
  if (/irpj/.test(t)) return '8.01'
  if (/csll/.test(t)) return '8.02'
  if (/simples nacional|das\b/.test(t)) return '2.04'
  if (/icms|iss|pis|cofins/.test(t)) return '2.03'
  return '4.99'
}
