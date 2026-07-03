/**
 * Vizor AI — Definição de Tools (Function Calling)
 * Lista de todas as ações que a IA pode executar no sistema.
 */

export interface AITool {
  name: string
  description: string
  input_schema: {
    type: 'object'
    properties: Record<string, any>
    required?: string[]
  }
}

export const AI_TOOLS: AITool[] = [
  // === NAVEGAÇÃO ===
  {
    name: 'navegar',
    description: 'Navega o usuário para uma tela específica do sistema. Use quando o usuário pedir para abrir uma tela, ver um relatório, consultar algo, etc.',
    input_schema: {
      type: 'object',
      properties: {
        rota: { type: 'string', description: 'Rota do frontend. Ex: /vendas/pedidos, /vendas/relatorios, /fiscal/nfe, /compras/pedidos, /wms/dashboard, /financeiro/contas-receber' },
        params: { type: 'object', description: 'Query params opcionais para filtros. Ex: { dataInicio: "2026-07-01" }' },
      },
      required: ['rota'],
    },
  },

  // === VENDAS ===
  {
    name: 'criar_pedido_venda',
    description: 'Cria um novo pedido de venda. Use quando o usuário pedir para criar/lançar um pedido.',
    input_schema: {
      type: 'object',
      properties: {
        clienteNome: { type: 'string', description: 'Nome ou razão social do cliente (busca parcial)' },
        itens: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              produtoNome: { type: 'string', description: 'Nome ou código do produto' },
              quantidade: { type: 'number' },
              precoUnitario: { type: 'number', description: 'Preço unitário (opcional, usa precoBase se não informado)' },
            },
            required: ['produtoNome', 'quantidade'],
          },
        },
        observacao: { type: 'string' },
      },
      required: ['clienteNome', 'itens'],
    },
  },
  {
    name: 'consultar_estoque',
    description: 'Consulta o estoque/saldo de um produto.',
    input_schema: {
      type: 'object',
      properties: {
        produtoNome: { type: 'string', description: 'Nome ou código do produto para consultar estoque' },
      },
      required: ['produtoNome'],
    },
  },
  {
    name: 'consultar_vendas',
    description: 'Consulta resumo de vendas (faturamento, ticket médio, quantidade). Use quando perguntarem "quanto vendemos", "como estão as vendas", etc.',
    input_schema: {
      type: 'object',
      properties: {
        dataInicio: { type: 'string', description: 'Data início no formato YYYY-MM-DD' },
        dataFim: { type: 'string', description: 'Data fim no formato YYYY-MM-DD' },
      },
    },
  },

  // === COMPRAS ===
  {
    name: 'criar_pedido_compra',
    description: 'Cria um pedido de compra para um fornecedor.',
    input_schema: {
      type: 'object',
      properties: {
        fornecedorNome: { type: 'string', description: 'Nome ou CNPJ do fornecedor' },
        itens: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              produtoNome: { type: 'string' },
              quantidade: { type: 'number' },
              precoUnitario: { type: 'number' },
            },
            required: ['produtoNome', 'quantidade'],
          },
        },
      },
      required: ['fornecedorNome', 'itens'],
    },
  },

  // === AGENDA / WMS ===
  {
    name: 'agendar_recebimento',
    description: 'Agenda um recebimento de mercadoria na doca do armazém.',
    input_schema: {
      type: 'object',
      properties: {
        fornecedorNome: { type: 'string', description: 'Nome do fornecedor' },
        data: { type: 'string', description: 'Data no formato YYYY-MM-DD' },
        horario: { type: 'string', description: 'Horário no formato HH:MM' },
        docaNumero: { type: 'number', description: 'Número da doca (opcional)' },
      },
      required: ['fornecedorNome', 'data', 'horario'],
    },
  },

  // === FINANCEIRO ===
  {
    name: 'consultar_financeiro',
    description: 'Consulta informações financeiras: contas a pagar, contas a receber, inadimplência.',
    input_schema: {
      type: 'object',
      properties: {
        tipo: { type: 'string', enum: ['a_pagar', 'a_receber', 'resumo'], description: 'Tipo de consulta financeira' },
        status: { type: 'string', enum: ['ABERTA', 'PAGO', 'VENCIDA', 'todas'] },
      },
      required: ['tipo'],
    },
  },

  // === CADASTROS ===
  {
    name: 'criar_cliente',
    description: 'Cadastra um novo cliente no sistema.',
    input_schema: {
      type: 'object',
      properties: {
        razaoSocial: { type: 'string' },
        cpfCnpj: { type: 'string' },
        email: { type: 'string' },
        telefone: { type: 'string' },
      },
      required: ['razaoSocial', 'cpfCnpj'],
    },
  },
  {
    name: 'criar_produto',
    description: 'Cadastra um novo produto no sistema.',
    input_schema: {
      type: 'object',
      properties: {
        nome: { type: 'string' },
        codigo: { type: 'string' },
        unidade: { type: 'string', description: 'UN, KG, CX, etc.' },
        precoBase: { type: 'number' },
      },
      required: ['nome', 'codigo'],
    },
  },

  // === PDV ===
  {
    name: 'pdv_sangria',
    description: 'Realiza uma sangria (retirada de dinheiro) do caixa do PDV.',
    input_schema: {
      type: 'object',
      properties: {
        valor: { type: 'number' },
        motivo: { type: 'string' },
      },
      required: ['valor', 'motivo'],
    },
  },

  // === CONFIGURAÇÃO ===
  {
    name: 'configurar_empresa',
    description: 'Configura parâmetros da empresa (regime tributário, módulos, etc.). Use no wizard de configuração inicial.',
    input_schema: {
      type: 'object',
      properties: {
        regimeTributario: { type: 'number', description: '1=Simples Nacional, 2=Lucro Presumido, 3=Lucro Real' },
        segmento: { type: 'string', description: 'Segmento do negócio (industria, distribuicao, varejo, servicos)' },
      },
    },
  },
]

// Mapa de rotas para navegação contextual
export const ROTAS_SISTEMA: Record<string, string> = {
  'pedidos de venda': '/vendas/pedidos',
  'pedidos': '/vendas/pedidos',
  'orcamentos': '/vendas/orcamentos',
  'orçamentos': '/vendas/orcamentos',
  'pdv': '/vendas/pdv',
  'caixa': '/vendas/pdv',
  'relatorios de vendas': '/vendas/relatorios',
  'relatórios de vendas': '/vendas/relatorios',
  'relatorios vendas': '/vendas/relatorios',
  'curva abc': '/vendas/relatorios',
  'devolucoes': '/vendas/devolucoes',
  'devoluções': '/vendas/devolucoes',
  'campanhas': '/vendas/campanhas',
  'metas': '/vendas/metas',
  'comissoes': '/vendas/comissoes',
  'comissões': '/vendas/comissoes',
  'pedidos de compra': '/compras/pedidos',
  'compras': '/compras/pedidos',
  'importar xml': '/compras/importar-xml',
  'nfe': '/fiscal/nfe',
  'nf-e': '/fiscal/nfe',
  'nota fiscal': '/fiscal/nfe',
  'nfce': '/fiscal/nfce',
  'cte': '/fiscal/cte',
  'sped': '/fiscal/sped',
  'apuracao': '/fiscal/apuracao',
  'motor tributario': '/fiscal/motor-tributario',
  'contas a pagar': '/financeiro/contas-pagar',
  'contas a receber': '/financeiro/contas-receber',
  'estoque': '/estoque',
  'dashboard wms': '/wms/dashboard',
  'separacao': '/picking',
  'enderecamento': '/wms/enderecamento',
  'conferencia': '/wms/conferencia-entrada',
  'inventario': '/wms/inventario',
  'clientes': '/configurador/clientes',
  'vendedores': '/configurador/vendedores',
  'produtos': '/configurador/produtos',
  'fornecedores': '/configurador/fornecedores',
  'empresa': '/configurador/empresa',
}
