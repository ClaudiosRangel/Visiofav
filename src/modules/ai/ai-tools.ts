/**
 * Vizor AI — Definição de Tools (Function Calling)
 * TODAS as ações que a IA pode executar no sistema.
 * Cada tool = uma operação que o usuário faria manualmente.
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
  // ═══════════════════════════════════════════════════════════════════════════
  // NAVEGAÇÃO
  // ═══════════════════════════════════════════════════════════════════════════
  {
    name: 'navegar',
    description: 'Navega o usuário para qualquer tela do sistema. Use quando pedirem para abrir, mostrar, ver, ir para algo.',
    input_schema: {
      type: 'object',
      properties: {
        rota: { type: 'string', description: 'Rota do frontend. Ex: /vendas/pedidos, /vendas/relatorios, /compras/pedidos, /fiscal/nfe, /financeiro/contas-receber, /wms/dashboard, /estoque, /vendas/pdv, /vendas/orcamentos, /vendas/devolucoes, /vendas/campanhas, /vendas/metas, /vendas/bonificacoes, /configurador/clientes, /configurador/produtos, /configurador/fornecedores, /pcp/ordens-producao' },
        params: { type: 'object', description: 'Query params para filtros (ex: { dataInicio: "2026-07-01" })' },
      },
      required: ['rota'],
    },
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // VENDAS — Pedidos
  // ═══════════════════════════════════════════════════════════════════════════
  {
    name: 'criar_pedido_venda',
    description: 'Cria um pedido de venda. Use quando pedirem para lançar/criar/fazer um pedido de venda.',
    input_schema: {
      type: 'object',
      properties: {
        clienteNome: { type: 'string', description: 'Nome ou razão social do cliente' },
        itens: { type: 'array', items: { type: 'object', properties: { produtoNome: { type: 'string' }, quantidade: { type: 'number' }, precoUnitario: { type: 'number' } }, required: ['produtoNome', 'quantidade'] } },
        prioridade: { type: 'string', enum: ['NORMAL', 'URGENTE', 'BAIXA'] },
        observacao: { type: 'string' },
      },
      required: ['clienteNome', 'itens'],
    },
  },
  {
    name: 'confirmar_pedido_venda',
    description: 'Confirma um pedido de venda (muda status de RASCUNHO para CONFIRMADO).',
    input_schema: {
      type: 'object',
      properties: {
        numeroPedido: { type: 'number', description: 'Número do pedido' },
      },
      required: ['numeroPedido'],
    },
  },
  {
    name: 'cancelar_pedido_venda',
    description: 'Cancela um pedido de venda.',
    input_schema: {
      type: 'object',
      properties: {
        numeroPedido: { type: 'number', description: 'Número do pedido' },
        motivo: { type: 'string', description: 'Motivo do cancelamento (min 10 caracteres)' },
      },
      required: ['numeroPedido', 'motivo'],
    },
  },
  {
    name: 'consultar_pedido_venda',
    description: 'Consulta detalhes de um pedido de venda específico.',
    input_schema: {
      type: 'object',
      properties: {
        numeroPedido: { type: 'number' },
      },
      required: ['numeroPedido'],
    },
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // VENDAS — Orçamentos
  // ═══════════════════════════════════════════════════════════════════════════
  {
    name: 'criar_orcamento',
    description: 'Cria um orçamento/proposta comercial para um cliente.',
    input_schema: {
      type: 'object',
      properties: {
        clienteNome: { type: 'string' },
        validadeDias: { type: 'number', description: 'Dias de validade (default 30)' },
        itens: { type: 'array', items: { type: 'object', properties: { produtoNome: { type: 'string' }, quantidade: { type: 'number' }, precoUnitario: { type: 'number' } }, required: ['produtoNome', 'quantidade'] } },
        observacao: { type: 'string' },
      },
      required: ['clienteNome', 'itens'],
    },
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // VENDAS — Consultas e Relatórios
  // ═══════════════════════════════════════════════════════════════════════════
  {
    name: 'consultar_vendas',
    description: 'Consulta resumo de vendas (faturamento, ticket médio, quantidade de pedidos).',
    input_schema: {
      type: 'object',
      properties: {
        dataInicio: { type: 'string', description: 'YYYY-MM-DD' },
        dataFim: { type: 'string', description: 'YYYY-MM-DD' },
        vendedorNome: { type: 'string' },
      },
    },
  },
  {
    name: 'consultar_top_clientes',
    description: 'Mostra os clientes que mais compraram (ranking).',
    input_schema: {
      type: 'object',
      properties: {
        top: { type: 'number', description: 'Quantos clientes mostrar (default 5)' },
        dataInicio: { type: 'string' },
        dataFim: { type: 'string' },
      },
    },
  },
  {
    name: 'consultar_top_produtos',
    description: 'Mostra os produtos mais vendidos (curva ABC).',
    input_schema: {
      type: 'object',
      properties: {
        top: { type: 'number', description: 'Quantos produtos mostrar (default 10)' },
      },
    },
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // COMPRAS
  // ═══════════════════════════════════════════════════════════════════════════
  {
    name: 'criar_pedido_compra',
    description: 'Cria um pedido de compra para um fornecedor.',
    input_schema: {
      type: 'object',
      properties: {
        fornecedorNome: { type: 'string' },
        itens: { type: 'array', items: { type: 'object', properties: { produtoNome: { type: 'string' }, quantidade: { type: 'number' }, precoUnitario: { type: 'number' } }, required: ['produtoNome', 'quantidade'] } },
      },
      required: ['fornecedorNome', 'itens'],
    },
  },
  {
    name: 'consultar_compras_pendentes',
    description: 'Lista pedidos de compra com status CONFIRMADO (aguardando recebimento).',
    input_schema: { type: 'object', properties: {} },
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // ESTOQUE
  // ═══════════════════════════════════════════════════════════════════════════
  {
    name: 'consultar_estoque',
    description: 'Consulta estoque/saldo de um produto.',
    input_schema: {
      type: 'object',
      properties: {
        produtoNome: { type: 'string', description: 'Nome ou código do produto' },
      },
      required: ['produtoNome'],
    },
  },
  {
    name: 'consultar_produtos_sem_estoque',
    description: 'Lista produtos com estoque zerado ou abaixo do mínimo.',
    input_schema: { type: 'object', properties: {} },
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // FINANCEIRO
  // ═══════════════════════════════════════════════════════════════════════════
  {
    name: 'consultar_financeiro',
    description: 'Consulta contas a pagar, contas a receber, inadimplência, vencidos.',
    input_schema: {
      type: 'object',
      properties: {
        tipo: { type: 'string', enum: ['a_pagar', 'a_receber', 'vencidos', 'resumo'] },
      },
      required: ['tipo'],
    },
  },
  {
    name: 'criar_conta_pagar',
    description: 'Lança uma conta a pagar no financeiro.',
    input_schema: {
      type: 'object',
      properties: {
        fornecedorNome: { type: 'string' },
        descricao: { type: 'string' },
        valor: { type: 'number' },
        vencimento: { type: 'string', description: 'Data de vencimento YYYY-MM-DD' },
      },
      required: ['descricao', 'valor', 'vencimento'],
    },
  },
  {
    name: 'criar_conta_receber',
    description: 'Lança uma conta a receber no financeiro.',
    input_schema: {
      type: 'object',
      properties: {
        clienteNome: { type: 'string' },
        descricao: { type: 'string' },
        valor: { type: 'number' },
        vencimento: { type: 'string', description: 'Data de vencimento YYYY-MM-DD' },
      },
      required: ['descricao', 'valor', 'vencimento'],
    },
  },
  {
    name: 'baixar_titulo',
    description: 'Registra o pagamento/recebimento de um título financeiro.',
    input_schema: {
      type: 'object',
      properties: {
        tipo: { type: 'string', enum: ['pagar', 'receber'] },
        descricao: { type: 'string', description: 'Descrição ou parte do título para localizar' },
      },
      required: ['tipo', 'descricao'],
    },
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // FISCAL
  // ═══════════════════════════════════════════════════════════════════════════
  {
    name: 'consultar_nfe',
    description: 'Consulta NF-e emitidas (por período, status, número).',
    input_schema: {
      type: 'object',
      properties: {
        numero: { type: 'number' },
        status: { type: 'string', enum: ['AUTORIZADO', 'REJEITADO', 'CANCELADO', 'PENDENTE'] },
        dataInicio: { type: 'string' },
        dataFim: { type: 'string' },
      },
    },
  },
  {
    name: 'consultar_tributacao',
    description: 'Simula/consulta tributação de um produto (ICMS, IPI, PIS, COFINS).',
    input_schema: {
      type: 'object',
      properties: {
        produtoNome: { type: 'string' },
        ufDestino: { type: 'string', description: 'UF do destinatário (2 letras)' },
      },
      required: ['produtoNome'],
    },
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // CADASTROS
  // ═══════════════════════════════════════════════════════════════════════════
  {
    name: 'criar_cliente',
    description: 'Cadastra um novo cliente.',
    input_schema: {
      type: 'object',
      properties: {
        razaoSocial: { type: 'string' },
        cpfCnpj: { type: 'string' },
        email: { type: 'string' },
        telefone: { type: 'string' },
        cidade: { type: 'string' },
        uf: { type: 'string' },
      },
      required: ['razaoSocial', 'cpfCnpj'],
    },
  },
  {
    name: 'criar_produto',
    description: 'Cadastra um novo produto.',
    input_schema: {
      type: 'object',
      properties: {
        nome: { type: 'string' },
        codigo: { type: 'string' },
        unidade: { type: 'string' },
        precoBase: { type: 'number' },
        ncm: { type: 'string' },
      },
      required: ['nome', 'codigo'],
    },
  },
  {
    name: 'criar_fornecedor',
    description: 'Cadastra um novo fornecedor.',
    input_schema: {
      type: 'object',
      properties: {
        razaoSocial: { type: 'string' },
        cnpj: { type: 'string' },
        email: { type: 'string' },
        telefone: { type: 'string' },
      },
      required: ['razaoSocial', 'cnpj'],
    },
  },
  {
    name: 'consultar_cliente',
    description: 'Busca informações de um cliente pelo nome ou CNPJ.',
    input_schema: {
      type: 'object',
      properties: {
        busca: { type: 'string', description: 'Nome, razão social ou CPF/CNPJ' },
      },
      required: ['busca'],
    },
  },
  {
    name: 'consultar_produto',
    description: 'Busca informações de um produto pelo nome ou código.',
    input_schema: {
      type: 'object',
      properties: {
        busca: { type: 'string' },
      },
      required: ['busca'],
    },
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // WMS / ARMAZÉM
  // ═══════════════════════════════════════════════════════════════════════════
  {
    name: 'agendar_recebimento',
    description: 'Agenda recebimento de mercadoria na doca.',
    input_schema: {
      type: 'object',
      properties: {
        fornecedorNome: { type: 'string' },
        data: { type: 'string', description: 'YYYY-MM-DD' },
        horario: { type: 'string', description: 'HH:MM' },
        doca: { type: 'number' },
        observacao: { type: 'string' },
      },
      required: ['fornecedorNome', 'data', 'horario'],
    },
  },
  {
    name: 'consultar_agendamentos',
    description: 'Lista agendamentos de recebimento do dia ou período.',
    input_schema: {
      type: 'object',
      properties: {
        data: { type: 'string', description: 'YYYY-MM-DD (default hoje)' },
      },
    },
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // PDV
  // ═══════════════════════════════════════════════════════════════════════════
  {
    name: 'pdv_sangria',
    description: 'Registra sangria (retirada) do caixa PDV.',
    input_schema: {
      type: 'object',
      properties: { valor: { type: 'number' }, motivo: { type: 'string' } },
      required: ['valor', 'motivo'],
    },
  },
  {
    name: 'pdv_suprimento',
    description: 'Registra suprimento (entrada de dinheiro) no caixa PDV.',
    input_schema: {
      type: 'object',
      properties: { valor: { type: 'number' }, motivo: { type: 'string' } },
      required: ['valor', 'motivo'],
    },
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // CONFIGURAÇÃO
  // ═══════════════════════════════════════════════════════════════════════════
  {
    name: 'configurar_empresa',
    description: 'Configura parâmetros da empresa (regime tributário, módulos, segmento).',
    input_schema: {
      type: 'object',
      properties: {
        regimeTributario: { type: 'number', description: '1=Simples Nacional, 2=Lucro Presumido, 3=Lucro Real' },
        segmento: { type: 'string' },
      },
    },
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // DIAGNÓSTICO E PRÉ-REQUISITOS
  // ═══════════════════════════════════════════════════════════════════════════
  {
    name: 'diagnosticar_prerequisitos',
    description: 'Verifica se todos os pré-requisitos estão atendidos para uma operação. Use SEMPRE antes de executar ações complexas (criar pedido, efetivar venda, emitir NF-e, etc.).',
    input_schema: {
      type: 'object',
      properties: {
        operacao: {
          type: 'string',
          enum: ['criar_pedido_venda', 'efetivar_venda', 'emitir_nfe', 'importar_xml', 'usar_pdv', 'usar_wms', 'criar_ordem_producao', 'onboarding'],
          description: 'Operação a ser diagnosticada',
        },
      },
      required: ['operacao'],
    },
  },
  {
    name: 'verificar_configuracao_empresa',
    description: 'Verifica o estado atual de configuração da empresa (módulos ativos, certificado, cadastros). Use para entender o contexto.',
    input_schema: {
      type: 'object',
      properties: {},
    },
  },
]
