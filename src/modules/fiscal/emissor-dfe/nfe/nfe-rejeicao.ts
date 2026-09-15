/**
 * Núcleo puro de mapeamento de rejeições da SEFAZ (NF-e / NFC-e).
 *
 * A SEFAZ devolve `cStat` (código numérico) + `xMotivo` (texto técnico) quando
 * rejeita um documento. Esse texto técnico raramente diz ao operador do ERP
 * o que fazer. Este módulo traduz os códigos de rejeição de negócio (2xx e
 * alguns 5xx) mais comuns em uma orientação amigável em pt-BR + uma "ação"
 * sugerida (onde corrigir), preservando sempre o texto técnico original.
 *
 * Sem I/O — função pura, determinística, testável.
 *
 * Requirements: 3.1
 */

/** Onde o operador deve agir para corrigir a rejeição. */
export type AcaoRejeicao =
  | 'CORRIGIR_CADASTRO' // dados do emitente/destinatário/empresa
  | 'CORRIGIR_ITEM' // dados de produto/NCM/CFOP/valores do item
  | 'CORRIGIR_FISCAL' // tributação, CST/CSOSN, regime, série/numeração
  | 'REVISAR' // revisar o documento como um todo / duplicidade
  | 'CONTINGENCIA' // problema de ambiente/serviço → tentar novamente/contingência

export interface RejeicaoMapeada {
  /** Código de status da SEFAZ. */
  cStat: number
  /** Texto técnico cru devolvido pela SEFAZ (xMotivo). */
  tecnico: string
  /** Orientação amigável em pt-BR sobre o que fazer. */
  amigavel: string
  /** Categoria da ação de correção sugerida. */
  acao: AcaoRejeicao
  /** true quando o código é conhecido (mapeado explicitamente). */
  conhecido: boolean
}

interface EntradaTabela {
  amigavel: string
  acao: AcaoRejeicao
}

/**
 * Tabela dos cStat de rejeição mais comuns em emissão de NF-e/NFC-e 4.00.
 * Cobre o núcleo prático (duplicidade, cadastro, schema, tributação,
 * numeração, certificado, ambiente). Códigos fora da tabela recebem
 * orientação genérica preservando o técnico.
 */
const TABELA_REJEICOES: Record<number, EntradaTabela> = {
  // --- Duplicidade / numeração / chave ---
  204: {
    amigavel:
      'Já existe uma NF-e autorizada com esses mesmos dados (duplicidade). Verifique se a nota não foi emitida antes de tentar novamente.',
    acao: 'REVISAR',
  },
  539: {
    amigavel:
      'A chave de acesso desta nota já foi usada por outra NF-e com dados diferentes. Gere uma nova numeração para emitir.',
    acao: 'CORRIGIR_FISCAL',
  },
  266: {
    amigavel:
      'A série ou o número da nota está fora da sequência esperada. Ajuste a numeração da série fiscal.',
    acao: 'CORRIGIR_FISCAL',
  },
  228: {
    amigavel:
      'A data/hora de emissão está muito distante da data atual (geralmente adiantada). Verifique o relógio/fuso e reemita.',
    acao: 'CORRIGIR_FISCAL',
  },

  // --- Emitente / destinatário / cadastro ---
  209: {
    amigavel:
      'A Inscrição Estadual do emitente é inválida. Corrija a IE no cadastro da empresa.',
    acao: 'CORRIGIR_CADASTRO',
  },
  210: {
    amigavel:
      'A Inscrição Estadual do substituto tributário é inválida. Corrija a IE ST no cadastro.',
    acao: 'CORRIGIR_CADASTRO',
  },
  211: {
    amigavel:
      'A Inscrição Estadual do destinatário é inválida. Corrija a IE no cadastro do cliente.',
    acao: 'CORRIGIR_CADASTRO',
  },
  213: {
    amigavel:
      'O CNPJ/CPF do destinatário não confere com o cadastro na SEFAZ. Verifique o documento do cliente.',
    acao: 'CORRIGIR_CADASTRO',
  },
  215: {
    amigavel:
      'O XML da nota está fora do padrão exigido (falha de schema). Verifique campos obrigatórios ausentes ou inválidos.',
    acao: 'REVISAR',
  },
  225: {
    amigavel:
      'A estrutura do XML da nota falhou na validação de schema. Algum campo obrigatório está ausente, vazio ou com formato inválido.',
    acao: 'REVISAR',
  },
  236: {
    amigavel:
      'A chave de acesso tem dígito verificador ou composição inválida. Regenerar a nota costuma resolver.',
    acao: 'CORRIGIR_FISCAL',
  },
  247: {
    amigavel:
      'A Sigla da UF do emitente diverge do cadastro na SEFAZ. Confira a UF da empresa emitente.',
    acao: 'CORRIGIR_CADASTRO',
  },
  252: {
    amigavel:
      'O ambiente informado na nota (produção/homologação) diverge do ambiente de recebimento. Verifique a configuração de ambiente da empresa.',
    acao: 'CORRIGIR_FISCAL',
  },

  // --- Município / endereço ---
  247247: {
    amigavel: 'Código de município inválido para a UF informada.',
    acao: 'CORRIGIR_CADASTRO',
  },
  272: {
    amigavel:
      'O código de município do emitente é inválido para a UF. Confira o município da empresa.',
    acao: 'CORRIGIR_CADASTRO',
  },
  273: {
    amigavel:
      'O código de município do destinatário é inválido para a UF. Confira o município do cliente.',
    acao: 'CORRIGIR_CADASTRO',
  },

  // --- Itens / produto / tributação ---
  527: {
    amigavel:
      'A operação (CFOP) informada é incompatível com o destino da nota (interna/interestadual). Ajuste o CFOP do item.',
    acao: 'CORRIGIR_ITEM',
  },
  610: {
    amigavel:
      'O valor total da nota não bate com a soma dos itens e tributos. Verifique valores, descontos e frete.',
    acao: 'CORRIGIR_ITEM',
  },
  611: {
    amigavel:
      'O código EAN/GTIN do produto é inválido. Corrija o código de barras no cadastro do produto (ou use SEM GTIN).',
    acao: 'CORRIGIR_ITEM',
  },
  778: {
    amigavel:
      'O NCM informado não existe na tabela oficial. Corrija o NCM do produto.',
    acao: 'CORRIGIR_ITEM',
  },
  806: {
    amigavel:
      'Este item exige o código CEST (produto sujeito a ST). Preencha o CEST no cadastro do produto.',
    acao: 'CORRIGIR_ITEM',
  },
  598: {
    amigavel:
      'O grupo de tributação (CST/CSOSN) informado é incompatível com o regime da empresa. Revise a tributação do item.',
    acao: 'CORRIGIR_FISCAL',
  },

  // --- Certificado / assinatura ---
  290: {
    amigavel:
      'O certificado digital foi revogado ou é inválido. Verifique o certificado A1 cadastrado.',
    acao: 'CORRIGIR_CADASTRO',
  },
  291: {
    amigavel:
      'O certificado digital está vencido. Atualize o certificado A1 da empresa.',
    acao: 'CORRIGIR_CADASTRO',
  },
  294: {
    amigavel:
      'A assinatura digital do XML é inválida. Verifique o certificado A1 e reemita.',
    acao: 'CORRIGIR_CADASTRO',
  },

  // --- Ambiente / serviço (tratar como transitório) ---
  108: {
    amigavel:
      'O serviço da SEFAZ está paralisado momentaneamente. Tente novamente em instantes ou use contingência.',
    acao: 'CONTINGENCIA',
  },
  109: {
    amigavel:
      'O serviço da SEFAZ está paralisado sem previsão. Emita em contingência.',
    acao: 'CONTINGENCIA',
  },
  999: {
    amigavel:
      'Erro não catalogado na SEFAZ. Tente novamente; se persistir, emita em contingência.',
    acao: 'CONTINGENCIA',
  },
}

/**
 * Mapeia um cStat + xMotivo da SEFAZ para uma orientação amigável.
 * Total (sempre retorna algo) e determinístico (mesma entrada → mesma saída).
 *
 * @param cStat código de status da SEFAZ
 * @param xMotivo texto técnico devolvido pela SEFAZ (pode ser vazio)
 */
export function mapearRejeicao(cStat: number, xMotivo: string): RejeicaoMapeada {
  const tecnico = (xMotivo ?? '').trim()
  const entrada = TABELA_REJEICOES[cStat]

  if (entrada) {
    return {
      cStat,
      tecnico,
      amigavel: entrada.amigavel,
      acao: entrada.acao,
      conhecido: true,
    }
  }

  // Fallback genérico por faixa de código, preservando o técnico.
  const acaoGenerica: AcaoRejeicao =
    cStat === 108 || cStat === 109 || cStat === 999 ? 'CONTINGENCIA' : 'REVISAR'

  const detalhe = tecnico ? ` Detalhe da SEFAZ: "${tecnico}".` : ''
  return {
    cStat,
    tecnico,
    amigavel:
      `A SEFAZ rejeitou a nota (código ${cStat}).${detalhe} ` +
      'Revise os dados do documento e tente novamente; se não souber corrigir, consulte o suporte fiscal.',
    acao: acaoGenerica,
    conhecido: false,
  }
}
