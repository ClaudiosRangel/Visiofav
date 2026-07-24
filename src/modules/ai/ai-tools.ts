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
    name: 'consultar_notas_emitidas_contra_cnpj',
    description: 'Consulta na SEFAZ (Distribuição DFe) as NF-e/CT-e emitidas contra o CNPJ da empresa logada (notas de compra que fornecedores emitiram para a empresa) e baixa as novas encontradas para lançamento posterior. Requer certificado digital ativo cadastrado.',
    input_schema: { type: 'object', properties: {} },
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
    description: 'Cadastra um novo cliente. Se o usuário informar um CEP, use a tool consultar_cep primeiro para preencher logradouro/bairro/cidade/UF automaticamente.',
    input_schema: {
      type: 'object',
      properties: {
        razaoSocial: { type: 'string' },
        cpfCnpj: { type: 'string' },
        email: { type: 'string' },
        telefone: { type: 'string' },
        cep: { type: 'string', description: 'Apenas dígitos' },
        logradouro: { type: 'string' },
        numero: { type: 'string' },
        complemento: { type: 'string' },
        bairro: { type: 'string' },
        cidade: { type: 'string' },
        uf: { type: 'string' },
      },
      required: ['razaoSocial', 'cpfCnpj'],
    },
  },
  {
    name: 'buscar_dados_produto_web',
    description: 'Busca na internet (base de dados aberta Open Food Facts) informações de um produto pelo nome (ex: "Leite Moça", "Nescau", "Coca-Cola 2L") ou código de barras (EAN/GTIN). Retorna nome completo, marca, quantidade/peso da embalagem e código de barras. Use ANTES de criar_produto quando o usuário pedir para cadastrar um produto conhecido de mercado e não tiver informado todos os dados — assim você preenche peso e código de barras automaticamente ao invés de perguntar. Funciona melhor para alimentos/bebidas/produtos de consumo; pode não encontrar itens industriais ou muito específicos.',
    input_schema: {
      type: 'object',
      properties: {
        busca: { type: 'string', description: 'Nome do produto ou código de barras (EAN)' },
      },
      required: ['busca'],
    },
  },
  {
    name: 'criar_produto',
    description: 'Cadastra um novo produto. Se o usuário mencionar um produto de mercado conhecido (ex: Leite Moça, Nescau), use buscar_dados_produto_web primeiro para preencher cEAN e dados logísticos automaticamente.',
    input_schema: {
      type: 'object',
      properties: {
        nome: { type: 'string' },
        codigo: { type: 'string' },
        unidade: { type: 'string' },
        precoBase: { type: 'number' },
        ncm: { type: 'string' },
        cEAN: { type: 'string', description: 'Código de barras (EAN/GTIN), apenas dígitos' },
      },
      required: ['nome', 'codigo'],
    },
  },
  {
    name: 'criar_fornecedor',
    description: 'Cadastra um novo fornecedor. Se o usuário informar um CEP, use a tool consultar_cep primeiro para preencher logradouro/bairro/cidade/UF automaticamente.',
    input_schema: {
      type: 'object',
      properties: {
        razaoSocial: { type: 'string' },
        cnpj: { type: 'string' },
        email: { type: 'string' },
        telefone: { type: 'string' },
        cep: { type: 'string', description: 'Apenas dígitos' },
        logradouro: { type: 'string' },
        numero: { type: 'string' },
        complemento: { type: 'string' },
        bairro: { type: 'string' },
        cidade: { type: 'string' },
        uf: { type: 'string' },
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
    name: 'consultar_cep',
    description: 'Consulta um CEP e retorna logradouro, bairro, cidade e UF automaticamente (via ViaCEP). Use SEMPRE que o usuário informar um CEP durante o cadastro de empresa/cliente/fornecedor, para preencher o endereço sem precisar perguntar rua/bairro/cidade/estado manualmente. Depois pergunte apenas número e complemento.',
    input_schema: {
      type: 'object',
      properties: {
        cep: { type: 'string', description: 'CEP com 8 dígitos, apenas números' },
      },
      required: ['cep'],
    },
  },
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
  // PCP — Ordens de Produção, Programação e Apontamentos
  // ═══════════════════════════════════════════════════════════════════════════
  {
    name: 'consultar_ordem_producao',
    description: 'Consulta os detalhes completos de uma Ordem de Produção (OP): produto, cliente, status, quantidade produzida, percentual concluído e lista de etapas com seus status. Aceita o número da OP ou a referência de OP avulsa (ex: AV-3).',
    input_schema: {
      type: 'object',
      properties: {
        numeroOp: { type: 'string', description: 'Número da OP (ex: 2881) ou referência de OP avulsa (ex: AV-3)' },
      },
      required: ['numeroOp'],
    },
  },
  {
    name: 'listar_ordens_producao',
    description: 'Lista Ordens de Produção com filtros. Use para perguntas como "quais OPs estão atrasadas", "quais OPs estão em produção", "OPs do cliente X".',
    input_schema: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['RASCUNHO', 'PLANEJADA', 'PROGRAMADA', 'LIBERADA', 'EM_PRODUCAO', 'CONCLUIDA', 'CANCELADA'], description: 'Filtrar por status específico' },
        atrasadas: { type: 'boolean', description: 'Se true, lista apenas OPs com entrega prevista já vencida e não concluídas/canceladas' },
        clienteNome: { type: 'string', description: 'Filtrar por nome do cliente (considera cadastro formal e tag [Cliente] das OPs importadas via PDF)' },
      },
    },
  },
  {
    name: 'criar_ordem_producao',
    description: 'Cria uma nova Ordem de Produção para um produto já cadastrado com Estrutura (BOM) ativa. Explode automaticamente os materiais e gera as etapas a partir do roteiro cadastrado. Use quando o usuário pedir para "criar uma OP", "lançar uma ordem de produção".',
    input_schema: {
      type: 'object',
      properties: {
        produtoNome: { type: 'string', description: 'Nome ou código do produto' },
        quantidade: { type: 'number', description: 'Quantidade a produzir' },
        unidadeMedida: { type: 'string', description: 'Unidade de medida (default UN)' },
        dataEntregaPrevista: { type: 'string', description: 'YYYY-MM-DD (default: 7 dias a partir de hoje)' },
        clienteNome: { type: 'string', description: 'Nome do cliente, se houver (opcional)' },
        prioridade: { type: 'string', enum: ['BAIXA', 'NORMAL', 'ALTA', 'URGENTE'], description: 'Default: NORMAL' },
      },
      required: ['produtoNome', 'quantidade'],
    },
  },
  {
    name: 'alterar_status_ordem_producao',
    description: 'Altera o status de uma OP, respeitando a máquina de estados (RASCUNHO→PLANEJADA→PROGRAMADA→LIBERADA→EM_PRODUCAO→CONCLUIDA, ou CANCELADA a partir de qualquer status não-final). Use quando o usuário pedir para "planejar a OP X", "liberar a OP X", "cancelar a OP X".',
    input_schema: {
      type: 'object',
      properties: {
        numeroOp: { type: 'string', description: 'Número ou referência da OP' },
        novoStatus: { type: 'string', enum: ['PLANEJADA', 'PROGRAMADA', 'LIBERADA', 'EM_PRODUCAO', 'CONCLUIDA', 'CANCELADA'] },
        motivoCancelamento: { type: 'string', description: 'Obrigatório (mín. 10 caracteres) se novoStatus for CANCELADA' },
      },
      required: ['numeroOp', 'novoStatus'],
    },
  },
  {
    name: 'consultar_programacao_centro',
    description: 'Lista a fila de etapas pendentes/em andamento/pausadas de um centro de produção específico (ex: "Cortadeira Coin", "Impressão"). Use para perguntas como "o que tem pendente na Cortadeira Coin".',
    input_schema: {
      type: 'object',
      properties: {
        centroNome: { type: 'string', description: 'Nome ou parte do nome do centro de produção' },
      },
      required: ['centroNome'],
    },
  },
  {
    name: 'iniciar_etapa_producao',
    description: 'Inicia (ou retoma, se estava pausada) a etapa pendente de uma OP. Use quando o usuário pedir para "iniciar a etapa da OP X", "começar a produção da OP X".',
    input_schema: {
      type: 'object',
      properties: {
        numeroOp: { type: 'string', description: 'Número ou referência da OP' },
        centroNome: { type: 'string', description: 'Nome do centro de produção, se a OP tiver mais de uma etapa pendente em centros diferentes (opcional)' },
      },
      required: ['numeroOp'],
    },
  },
  {
    name: 'apontar_producao_etapa',
    description: 'Registra produção parcial (e opcionalmente perda) em uma etapa que já está em andamento ou pausada, sem concluí-la. Use quando o usuário disser "aponta X produzidas na OP Y" sem pedir para finalizar.',
    input_schema: {
      type: 'object',
      properties: {
        numeroOp: { type: 'string' },
        quantidadeProduzida: { type: 'number' },
        quantidadePerda: { type: 'number', description: 'Default 0' },
        motivoPerda: { type: 'string', enum: ['ACERTO', 'REFUGO', 'DEFEITO', 'APARA'] },
        centroNome: { type: 'string', description: 'Opcional, para desambiguar se houver múltiplas etapas ativas' },
      },
      required: ['numeroOp', 'quantidadeProduzida'],
    },
  },
  {
    name: 'concluir_etapa_producao',
    description: 'Conclui a etapa em andamento/pausada de uma OP, opcionalmente registrando a quantidade produzida final antes de concluir. Se for a última etapa pendente da OP, a OP inteira é marcada como CONCLUIDA automaticamente e a quantidade produzida é propagada. Use quando o usuário pedir para "finalizar a etapa da OP X", "concluir a produção da OP X".',
    input_schema: {
      type: 'object',
      properties: {
        numeroOp: { type: 'string' },
        quantidadeProduzida: { type: 'number', description: 'Quantidade produzida a registrar antes de concluir (opcional — se omitido, conclui sem registrar apontamento novo)' },
        centroNome: { type: 'string', description: 'Opcional, para desambiguar' },
      },
      required: ['numeroOp'],
    },
  },
  {
    name: 'pausar_etapa_producao',
    description: 'Pausa a etapa em andamento de uma OP, registrando o motivo da parada. Use quando o usuário pedir para "parar a etapa da OP X", "pausar a produção da OP X".',
    input_schema: {
      type: 'object',
      properties: {
        numeroOp: { type: 'string' },
        motivoParada: { type: 'string', enum: ['MANUTENCAO', 'FALTA_MATERIAL', 'ACERTO_MAQUINA', 'TROCA_TURNO', 'OUTRO'] },
        observacao: { type: 'string' },
        centroNome: { type: 'string' },
      },
      required: ['numeroOp', 'motivoParada'],
    },
  },
  {
    name: 'postergar_entrega_op',
    description: 'Altera a data de entrega prevista de uma OP, preservando a data original para histórico. Use quando o usuário pedir para "adiar a entrega da OP X", "postergar a OP X para o dia Y".',
    input_schema: {
      type: 'object',
      properties: {
        numeroOp: { type: 'string' },
        novaDataEntrega: { type: 'string', description: 'YYYY-MM-DD' },
      },
      required: ['numeroOp', 'novaDataEntrega'],
    },
  },
  {
    name: 'criar_op_avulsa',
    description: 'Cria uma OP avulsa (sem número de fábrica, gera referência AV-1, AV-2... automaticamente) diretamente na fila de um centro de produção. Use quando o usuário pedir para "lançar um avulso", "criar uma OP avulsa" — para trabalhos sem OP formal do sistema de origem.',
    input_schema: {
      type: 'object',
      properties: {
        centroNome: { type: 'string', description: 'Nome do centro de produção onde a etapa avulsa entrará na fila' },
        quantidade: { type: 'number' },
        produtoNomeLivre: { type: 'string', description: 'Descrição livre do produto (não precisa ser um produto cadastrado)' },
        clienteNomeLivre: { type: 'string', description: 'Nome livre do cliente (não precisa ser um cliente cadastrado)' },
        descricao: { type: 'string', description: 'Descrição da etapa/lançamento' },
      },
      required: ['centroNome', 'quantidade'],
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
