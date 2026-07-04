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
    name: 'importar_xml_compras_real',
    description: 'Importa DE FATO o XML de NF-e de compra que o usuário enviou no chat: cadastra fornecedor automaticamente se não existir, cadastra produtos novos, cria o PedidoCompra + CompraEfetivada, gera o DocumentoFiscal de entrada e as Contas a Pagar. Use SOMENTE depois que o usuário confirmar explicitamente que quer importar (ex: "sim, importar", "pode importar"). O XML já foi enviado anteriormente via upload — não é necessário passar o conteúdo do XML aqui.',
    input_schema: {
      type: 'object',
      properties: {
        formaPagamento: { type: 'string', description: 'Forma de pagamento para a conta a pagar gerada (ex: BOLETO, PIX, TRANSFERENCIA). Default: BOLETO' },
        parcelas: { type: 'number', description: 'Número de parcelas para dividir o valor em contas a pagar. Default: 1' },
      },
    },
  },
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
  // WMS / ARMAZÉM — Agendamento de Recebimento
  // ═══════════════════════════════════════════════════════════════════════════
  {
    name: 'consultar_disponibilidade_docas',
    description: 'Verifica a disponibilidade real das docas para uma data e duração desejada. Use SEMPRE antes de agendar_recebimento_real, para mostrar ao usuário os horários livres. Se não houver horários no dia pedido, retorna sugestões de outros dias.',
    input_schema: {
      type: 'object',
      properties: {
        data: { type: 'string', description: 'YYYY-MM-DD — dia desejado para o agendamento' },
        duracaoMinutos: { type: 'number', description: 'Duração estimada da operação em minutos (default 60)' },
        docaId: { type: 'string', description: 'ID de uma doca específica (opcional). Se omitido, verifica todas as docas ativas.' },
      },
      required: ['data'],
    },
  },
  {
    name: 'agendar_recebimento_real',
    description: 'Cria de fato um agendamento de recebimento na doca (grava no banco). Use SOMENTE depois de consultar_disponibilidade_docas e o usuário confirmar dia/hora/doca desejados.',
    input_schema: {
      type: 'object',
      properties: {
        docaId: { type: 'string', description: 'ID da doca escolhida (retornado por consultar_disponibilidade_docas)' },
        data: { type: 'string', description: 'YYYY-MM-DD' },
        horaInicio: { type: 'string', description: 'HH:MM' },
        horaFim: { type: 'string', description: 'HH:MM' },
        fornecedorNome: { type: 'string', description: 'Nome do fornecedor que vai entregar (opcional)' },
        pedidoCompraNumero: { type: 'number', description: 'Número do pedido de compra relacionado (opcional)' },
        motorista: { type: 'string' },
        placa: { type: 'string' },
        observacao: { type: 'string' },
      },
      required: ['docaId', 'data', 'horaInicio', 'horaFim'],
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
    description: 'Configura parâmetros da empresa (regime tributário, módulos, segmento, se usa WMS).',
    input_schema: {
      type: 'object',
      properties: {
        regimeTributario: { type: 'number', description: '1=Simples Nacional, 2=Lucro Presumido, 3=Lucro Real' },
        segmento: { type: 'string' },
        usaWms: { type: 'boolean', description: 'Se a empresa vai usar o módulo WMS (armazém)' },
      },
    },
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // ONBOARDING — Configurar Nova Empresa do Zero
  // ═══════════════════════════════════════════════════════════════════════════
  {
    name: 'configurar_dados_empresa',
    description: 'Salva os dados cadastrais básicos da empresa: razão social, nome fantasia, CNPJ, endereço, telefone, email. Use durante o onboarding quando o usuário fornecer esses dados.',
    input_schema: {
      type: 'object',
      properties: {
        razaoSocial: { type: 'string' },
        nomeFantasia: { type: 'string' },
        cnpj: { type: 'string', description: 'Apenas dígitos, sem formatação' },
        inscEstadual: { type: 'string' },
        logradouro: { type: 'string' },
        numero: { type: 'string' },
        complemento: { type: 'string' },
        bairro: { type: 'string' },
        cidade: { type: 'string' },
        uf: { type: 'string', description: '2 letras' },
        cep: { type: 'string', description: 'Apenas dígitos, sem formatação' },
        telefone: { type: 'string', description: 'Apenas dígitos, sem formatação' },
        email: { type: 'string' },
      },
    },
  },
  {
    name: 'configurar_tributacao_inicial',
    description: 'Define o regime tributário da empresa e cria automaticamente as naturezas de operação padrão (Compra, Venda dentro do estado, Venda fora do estado, Transferência) com os CFOPs típicos, prontas para uso. Use depois que o usuário informar o regime tributário no onboarding. NÃO substitui a configuração fiscal completa (NCM/CST por produto ainda precisa ser feita no cadastro de produtos).',
    input_schema: {
      type: 'object',
      properties: {
        regimeTributario: { type: 'number', description: '1=Simples Nacional, 2=Lucro Presumido, 3=Lucro Real' },
      },
      required: ['regimeTributario'],
    },
  },
  {
    name: 'criar_centro_distribuicao',
    description: 'Cadastra um Centro de Distribuição (CD) ou galpão da empresa. Pré-requisito para configurar o WMS. Use uma vez para cada CD/galpão que o usuário informar.',
    input_schema: {
      type: 'object',
      properties: {
        nome: { type: 'string' },
        codigo: { type: 'string', description: 'Código curto do CD (ex: CD01). Se omitido, gera automaticamente.' },
      },
      required: ['nome'],
    },
  },
  {
    name: 'criar_deposito',
    description: 'Cadastra um Depósito dentro de um Centro de Distribuição. Pré-requisito para gerar endereços de armazenagem.',
    input_schema: {
      type: 'object',
      properties: {
        centroDistribuicaoNome: { type: 'string', description: 'Nome do CD já cadastrado' },
        descricao: { type: 'string' },
        cidade: { type: 'string' },
        uf: { type: 'string' },
      },
      required: ['centroDistribuicaoNome', 'descricao'],
    },
  },
  {
    name: 'criar_zona_wms',
    description: 'Cadastra uma Zona de armazenagem dentro de um Depósito (ex: Zona Seca, Zona Refrigerada, Picking).',
    input_schema: {
      type: 'object',
      properties: {
        depositoDescricao: { type: 'string', description: 'Descrição do depósito já cadastrado' },
        descricao: { type: 'string' },
      },
      required: ['depositoDescricao', 'descricao'],
    },
  },
  {
    name: 'criar_docas_wms',
    description: 'Cadastra docas de recebimento/expedição vinculadas a um Centro de Distribuição ou Depósito. Use quando o usuário informar quantas docas existem.',
    input_schema: {
      type: 'object',
      properties: {
        centroDistribuicaoNome: { type: 'string' },
        depositoDescricao: { type: 'string' },
        quantidade: { type: 'number', description: 'Quantidade de docas a criar' },
        tipo: { type: 'string', enum: ['ENTRADA', 'SAIDA', 'MISTA'], description: 'Default: MISTA' },
      },
      required: ['quantidade'],
    },
  },
  {
    name: 'gerar_enderecos_wms',
    description: 'Gera em lote os endereços de armazenagem (formato Depósito-Zona-Rua-Prédio-Nível-Apto) dentro de um depósito, a partir de quantidades simples informadas pelo usuário (quantas ruas, prédios, níveis e posições por nível). Use depois de já ter Centro de Distribuição e Depósito cadastrados.',
    input_schema: {
      type: 'object',
      properties: {
        depositoDescricao: { type: 'string', description: 'Descrição do depósito já cadastrado' },
        zonaDescricao: { type: 'string', description: 'Descrição da zona já cadastrada (opcional)' },
        codigoDeposito: { type: 'string', description: 'Código curto do depósito para compor o endereço (ex: 01). Default: 01' },
        codigoZona: { type: 'string', description: 'Código curto da zona para compor o endereço (ex: 01). Default: 01' },
        quantidadeRuas: { type: 'number', description: 'Quantidade de ruas/corredores' },
        quantidadePredios: { type: 'number', description: 'Quantidade de prédios/colunas por rua' },
        quantidadeNiveis: { type: 'number', description: 'Quantidade de níveis (andares) por prédio' },
        quantidadeAptos: { type: 'number', description: 'Quantidade de posições (apartamentos) por nível' },
      },
      required: ['depositoDescricao', 'quantidadeRuas', 'quantidadePredios', 'quantidadeNiveis', 'quantidadeAptos'],
    },
  },
  {
    name: 'criar_usuario_sistema',
    description: 'Cadastra um novo usuário de acesso ao sistema, com email, senha inicial e nível de acesso (perfil).',
    input_schema: {
      type: 'object',
      properties: {
        nome: { type: 'string' },
        email: { type: 'string' },
        senha: { type: 'string', description: 'Senha inicial, mínimo 6 caracteres' },
        perfil: { type: 'string', enum: ['ADMIN', 'SUPERVISOR', 'OPERADOR'], description: 'Nível de acesso. ADMIN vê tudo, SUPERVISOR gerencia operações, OPERADOR uso operacional do dia a dia.' },
        modulos: { type: 'array', items: { type: 'string', enum: ['WMS', 'COMPRAS', 'VENDAS', 'FINANCEIRO', 'FISCAL'] }, description: 'Módulos que o usuário pode acessar. Omitir para liberar todos.' },
      },
      required: ['nome', 'email', 'senha'],
    },
  },
  {
    name: 'criar_funcionario',
    description: 'Cadastra um funcionário do armazém/operação (nome, matrícula, função) e opcionalmente vincula a um usuário do sistema para habilitar login no coletor de dados.',
    input_schema: {
      type: 'object',
      properties: {
        nome: { type: 'string' },
        matricula: { type: 'string' },
        tipo: { type: 'string', enum: ['OPERADOR', 'CONFERENTE', 'SUPERVISOR', 'MOTORISTA'], description: 'Default: OPERADOR' },
        usaColetor: { type: 'boolean', description: 'Se este funcionário vai usar coletor de dados (scanner)' },
        vincularUsuarioEmail: { type: 'string', description: 'Email de um usuário do sistema já cadastrado, para vincular o login (necessário se usaColetor=true)' },
      },
      required: ['nome', 'matricula'],
    },
  },
  {
    name: 'configurar_integracao_erp',
    description: 'Configura a integração com outro ERP externo (quando a empresa já usa outro sistema e quer integrar com o WMS/Vizor).',
    input_schema: {
      type: 'object',
      properties: {
        integracaoAtiva: { type: 'boolean', description: 'Se a integração está ativa' },
        sistemaExterno: { type: 'string', description: 'Nome do ERP externo (ex: SAP, TOTVS, Sankhya, Senior, Bling)' },
      },
      required: ['integracaoAtiva'],
    },
  },
  {
    name: 'consultar_integracao_erp',
    description: 'Consulta o estado atual da configuração de integração com ERP externo.',
    input_schema: { type: 'object', properties: {} },
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
