# Requirements Document

## Introduction

Evolução do módulo de Pedido de Venda do VisioFab ERP para torná-lo 100% competitivo com ERPs de mercado (Omie, Bling, Sankhya, Totvs). O módulo já possui CRUD básico, fluxo de status (RASCUNHO → CONFIRMADO → EFETIVADO / CANCELADO), integração fiscal (NF-e) e geração automática de contas a receber. Este documento especifica os novos campos de cabeçalho/itens, faturamento parcial, rateio de desconto/acréscimo, e demais funcionalidades necessárias para operação comercial completa.

## Glossary

- **Sistema_Pedido**: Módulo de Pedido de Venda do VisioFab ERP (backend Fastify + Prisma + PostgreSQL)
- **Pedido**: Registro de PedidoVenda no banco de dados
- **Item**: Registro de ItemPedidoVenda vinculado a um Pedido
- **Rateio**: Distribuição proporcional de valores (desconto, frete, seguro, despesas) entre itens do pedido, com base no peso de cada item sobre o valor total
- **Faturamento_Parcial**: Processo de efetivar apenas parte dos itens/quantidades de um pedido, mantendo saldo residual
- **Backorder**: Saldo remanescente de itens não faturados em um faturamento parcial
- **Modalidade_Frete**: Tipo de responsabilidade pelo frete conforme NF-e (0=CIF, 1=FOB, 2=Terceiros, 3=Próprio remetente, 4=Próprio destinatário, 9=Sem frete)
- **Endereco_Entrega**: Endereço alternativo de entrega diferente do endereço cadastral do cliente
- **Origem_Pedido**: Canal de entrada do pedido (MANUAL, ECOMMERCE, EDI, ORCAMENTO)
- **Prioridade**: Classificação de urgência do pedido (BAIXA, NORMAL, URGENTE)
- **Desconto_Geral**: Desconto aplicado sobre o total do pedido (percentual ou valor fixo), rateado entre os itens
- **Acrescimo_Geral**: Valor adicional (frete, seguro, despesas acessórias) aplicado ao total e rateado entre itens
- **Numero_Pedido_Cliente**: Número de referência do pedido de compra do cliente (PO number)

## Requirements

### Requisito 1: Campos Complementares de Cabeçalho

**User Story:** Como operador de vendas, eu quero registrar informações adicionais no pedido (data de entrega, observações, transportadora, modalidade de frete, endereço alternativo, origem, prioridade, validade e número PO do cliente), para que o pedido contenha todas as informações necessárias à operação logística e fiscal.

#### Critérios de Aceitação

1. WHEN um Pedido é criado ou editado, THE Sistema_Pedido SHALL aceitar e persistir os campos opcionais: dataEntrega (date), observacao (text, até 1000 caracteres), observacaoNota (text, até 2000 caracteres), transportadoraId (uuid), modalidadeFrete (enum 0-4,9), origemPedido (enum MANUAL/ECOMMERCE/EDI/ORCAMENTO), prioridade (enum BAIXA/NORMAL/URGENTE), dataValidade (date) e numeroPedidoCliente (string até 60 caracteres)
2. WHEN o campo modalidadeFrete é informado, THE Sistema_Pedido SHALL validar que o valor pertence ao conjunto de modalidades válidas (0, 1, 2, 3, 4, 9) conforme padrão NF-e
3. WHEN o campo transportadoraId é informado, THE Sistema_Pedido SHALL validar que a transportadora existe e pertence à mesma empresa do pedido
4. WHEN o campo origemPedido não é informado, THE Sistema_Pedido SHALL atribuir o valor padrão MANUAL
5. WHEN o campo prioridade não é informado, THE Sistema_Pedido SHALL atribuir o valor padrão NORMAL
6. WHEN o campo dataValidade é informado, THE Sistema_Pedido SHALL validar que a data é igual ou posterior à data atual do servidor (considerando apenas a data, sem hora)
7. IF a validação de modalidadeFrete, transportadoraId ou dataValidade falhar, THEN THE Sistema_Pedido SHALL rejeitar a operação retornando código HTTP 400 com mensagem de erro indicando o campo inválido e o motivo da rejeição, sem persistir nenhuma alteração do pedido
8. WHEN o campo dataEntrega é informado, THE Sistema_Pedido SHALL validar que a data é igual ou posterior à data atual do servidor (considerando apenas a data, sem hora)

### Requisito 2: Endereço de Entrega Alternativo

**User Story:** Como operador de vendas, eu quero informar um endereço de entrega diferente do endereço cadastral do cliente, para que a mercadoria seja enviada ao local correto quando o destino difere do endereço de faturamento.

#### Critérios de Aceitação

1. WHEN um Pedido é criado ou editado com enderecoEntrega, THE Sistema_Pedido SHALL persistir os campos: logradouro (até 200 caracteres), numero (até 20 caracteres), complemento (até 100 caracteres, opcional), bairro (até 100 caracteres), cidade (até 100 caracteres), uf (2 caracteres), cep (8 dígitos), e codigoIbge (7 dígitos, opcional)
2. IF o campo enderecoEntrega é informado e algum dos campos obrigatórios (logradouro, numero, bairro, cidade, uf, cep) está ausente ou vazio, THEN THE Sistema_Pedido SHALL rejeitar a operação com mensagem de erro indicando quais campos obrigatórios estão faltando
3. WHEN o campo enderecoEntrega não é informado, THE Sistema_Pedido SHALL utilizar o endereço cadastral do cliente na emissão da NF-e
4. WHEN o campo uf do enderecoEntrega é informado, THE Sistema_Pedido SHALL validar que possui exatamente 2 caracteres maiúsculos correspondentes a uma UF brasileira válida
5. WHEN o campo cep do enderecoEntrega é informado, THE Sistema_Pedido SHALL validar que possui exatamente 8 dígitos numéricos
6. IF o campo uf ou cep do enderecoEntrega não passa na validação de formato, THEN THE Sistema_Pedido SHALL rejeitar a operação com mensagem de erro indicando o campo inválido e o formato esperado
7. IF o campo enderecoEntrega não é informado e o cliente não possui endereço cadastral completo, THEN THE Sistema_Pedido SHALL rejeitar a efetivação com mensagem de erro indicando que o cliente não possui endereço cadastrado para emissão da NF-e

### Requisito 3: Desconto e Acréscimo Gerais com Rateio

**User Story:** Como operador de vendas, eu quero aplicar desconto ou acréscimo (frete, seguro, despesas) no total do pedido e ter esses valores distribuídos proporcionalmente entre os itens, para que a composição fiscal de cada item esteja correta na NF-e.

#### Critérios de Aceitação

1. WHEN um Pedido é criado ou editado com tipoDesconto e descontoGeral, THE Sistema_Pedido SHALL aceitar tipoDesconto como PERCENTUAL ou VALOR_FIXO e descontoGeral como valor decimal maior que zero com até 2 casas decimais, e aceitar acrescimoGeral como objeto contendo tipoAcrescimo (enum FRETE, SEGURO, OUTRAS_DESPESAS) e valor decimal maior que zero com até 2 casas decimais
2. WHEN tipoDesconto é PERCENTUAL, THE Sistema_Pedido SHALL validar que descontoGeral está no intervalo de 0.01 a 100.00 (inclusive)
3. WHEN descontoGeral é informado, THE Sistema_Pedido SHALL calcular o valor absoluto do desconto (para PERCENTUAL: subtotal × descontoGeral / 100; para VALOR_FIXO: o próprio valor) e ratear proporcionalmente entre todos os itens com base no valorTotal de cada item dividido pelo subtotal do pedido, arredondando cada parcela para 2 casas decimais
4. WHEN acrescimoGeral é informado, THE Sistema_Pedido SHALL ratear o valor proporcionalmente entre todos os itens, atribuindo a parcela rateada ao campo do item correspondente ao tipoAcrescimo informado (FRETE → campo frete, SEGURO → campo seguro, OUTRAS_DESPESAS → campo outrasDespesas)
5. WHEN o Rateio é calculado, THE Sistema_Pedido SHALL garantir que a soma dos valores rateados nos itens seja exatamente igual ao valor total de desconto ou acréscimo, ajustando a diferença de arredondamento no item de maior valorTotal do pedido
6. WHEN descontoGeral ou acrescimoGeral são alterados, THE Sistema_Pedido SHALL recalcular o valorTotal do pedido refletindo o novo desconto ou acréscimo
7. IF descontoGeral em valor fixo excede o subtotal dos itens, THEN THE Sistema_Pedido SHALL rejeitar a operação com mensagem de erro informando que o desconto não pode exceder o subtotal
8. IF tipoDesconto é informado sem descontoGeral, ou descontoGeral é informado sem tipoDesconto, THEN THE Sistema_Pedido SHALL rejeitar a operação com mensagem de erro indicando que ambos os campos são obrigatórios em conjunto
9. IF acrescimoGeral é informado sem tipoAcrescimo ou sem valor, THEN THE Sistema_Pedido SHALL rejeitar a operação com mensagem de erro indicando que tipoAcrescimo e valor são obrigatórios em conjunto

### Requisito 4: Campos Complementares de Item

**User Story:** Como operador de vendas, eu quero registrar desconto por valor fixo, frete, seguro, despesas, observação, data de entrega individual e percentual de comissão por item, para que cada item contenha informações fiscais e logísticas granulares.

#### Critérios de Aceitação

1. WHEN um Item é criado ou editado, THE Sistema_Pedido SHALL aceitar e persistir os campos opcionais: descontoValor (decimal >= 0, máximo 999.999.999,99), frete (decimal >= 0, máximo 999.999.999,99), seguro (decimal >= 0, máximo 999.999.999,99), outrasDespesas (decimal >= 0, máximo 999.999.999,99), observacaoItem (texto até 1000 caracteres), dataEntregaItem (date) e comissaoPercItem (decimal 0-100 com até 2 casas decimais)
2. WHEN descontoValor é informado em um Item, THE Sistema_Pedido SHALL aplicar o desconto absoluto após o desconto percentual no cálculo do precoFinal conforme a fórmula: precoFinal = (precoBase × (1 - desconto/100)) - descontoValor
3. WHEN frete, seguro ou outrasDespesas são informados manualmente em um Item, THE Sistema_Pedido SHALL somar esses valores ao valorTotal do item; WHEN o Rateio de acrescimoGeral é executado posteriormente, os valores rateados SHALL ser somados aos valores manuais já existentes nos campos frete, seguro ou outrasDespesas do item
4. WHEN o valorTotal do pedido é calculado, THE Sistema_Pedido SHALL considerar a soma de todos os itens incluindo frete, seguro e outrasDespesas de cada item (sejam valores manuais, rateados ou ambos)
5. IF descontoValor somado ao desconto percentual resulta em precoFinal menor que zero, THEN THE Sistema_Pedido SHALL rejeitar a operação com mensagem de erro indicando que o desconto total excede o preço do produto
6. WHEN dataEntregaItem é informada em um Item, THE Sistema_Pedido SHALL validar que a data é igual ou posterior à data atual

### Requisito 5: Cálculo de Preço Final do Item

**User Story:** Como operador de vendas, eu quero que o sistema calcule corretamente o preço final de cada item considerando desconto percentual, desconto por valor, e componentes fiscais, para que os valores do pedido e da NF-e estejam corretos.

#### Critérios de Aceitação

1. THE Sistema_Pedido SHALL calcular o precoFinal do item usando a fórmula: precoFinal = (precoBase × (1 - desconto/100)) - descontoValor, onde desconto está entre 0 e 100 e descontoValor é maior ou igual a 0, ambos assumindo valor 0 quando não informados
2. THE Sistema_Pedido SHALL calcular o valorTotal do item usando a fórmula: valorTotal = (precoFinal × quantidade) + frete + seguro + outrasDespesas, onde frete, seguro e outrasDespesas assumem valor 0 quando não informados
3. IF desconto/acréscimo gerais existem e não foram rateados nos itens, THEN THE Sistema_Pedido SHALL calcular o valorTotal do pedido usando a fórmula: valorTotal = soma(valorTotal de cada item) - descontoGeral_absoluto + acrescimoGeral
4. WHEN qualquer um dos campos precoBase, desconto, descontoValor, quantidade, frete, seguro, outrasDespesas, descontoGeral ou acrescimoGeral é alterado, THE Sistema_Pedido SHALL recalcular automaticamente precoFinal, valorTotal do item e valorTotal do pedido em no máximo 500 milissegundos
5. THE Sistema_Pedido SHALL armazenar valores monetários com precisão de 2 casas decimais para totais e 4 casas decimais para preços unitários, utilizando arredondamento half-up (arredondamento comercial) em todas as operações de truncamento
6. THE Sistema_Pedido SHALL executar os cálculos intermediários com precisão de 4 casas decimais e aplicar arredondamento para 2 casas decimais somente no resultado final de valorTotal do item e valorTotal do pedido

### Requisito 6: Faturamento Parcial (Backorder)

**User Story:** Como operador de vendas, eu quero efetivar apenas parte dos itens ou quantidades de um pedido, mantendo o saldo remanescente disponível para faturamento futuro, para que a empresa possa entregar parcialmente sem perder rastreabilidade do pedido original.

#### Critérios de Aceitação

1. WHEN o faturamento parcial é solicitado para um Pedido com status CONFIRMADO, THE Sistema_Pedido SHALL aceitar uma lista de itens com quantidades a faturar menores ou iguais ao saldo disponível de cada item, contendo no mínimo 1 item com quantidade maior que zero
2. WHEN o faturamento parcial é processado, THE Sistema_Pedido SHALL registrar para cada Item a quantidadeFaturada acumulada (quantidadeFaturada anterior + quantidade faturada nesta operação) e manter a quantidade original inalterada
3. WHEN o faturamento parcial é processado, THE Sistema_Pedido SHALL gerar uma VendaEfetivada contendo apenas os itens e quantidades informados, emitindo NF-e e gerando contas a receber proporcionais ao valor faturado
4. WHILE um Pedido possui itens com saldo não faturado (quantidade - quantidadeFaturada > 0), THE Sistema_Pedido SHALL manter o pedido com status CONFIRMADO permitindo novos faturamentos parciais
5. WHEN todos os itens de um Pedido atingem quantidadeFaturada igual à quantidade original, THE Sistema_Pedido SHALL alterar o status do pedido para EFETIVADO
6. IF a quantidade solicitada para faturamento excede o saldo disponível de um item, THEN THE Sistema_Pedido SHALL rejeitar a operação inteira (sem processar nenhum item) com mensagem de erro indicando o item e o saldo disponível
7. WHEN um faturamento parcial é processado, THE Sistema_Pedido SHALL registrar o vínculo entre o pedido original e cada VendaEfetivada gerada (pedidoVendaId na VendaEfetivada), permitindo que múltiplas VendaEfetivada referenciem o mesmo pedido

### Requisito 7: Integração Modalidade de Frete com NF-e

**User Story:** Como responsável fiscal, eu quero que a modalidade de frete e a transportadora informadas no pedido sejam automaticamente repassadas à NF-e na efetivação, para que o documento fiscal reflita corretamente as condições de transporte.

#### Critérios de Aceitação

1. WHEN um Pedido é efetivado (total ou parcial), THE Sistema_Pedido SHALL repassar o campo modalidadeFrete para o tag modFrete do XML da NF-e
2. WHEN um Pedido com transportadoraId é efetivado, THE Sistema_Pedido SHALL incluir os dados da transportadora (CNPJ, razão social, IE, endereço completo com logradouro, município e UF) no grupo transporta do XML da NF-e
3. IF modalidadeFrete não está preenchido no Pedido no momento da efetivação, THEN THE Sistema_Pedido SHALL utilizar o valor padrão 9 (sem frete) na NF-e
4. WHEN observacaoNota está preenchida no Pedido, THE Sistema_Pedido SHALL incluir o conteúdo no campo infCpl (informações complementares) da NF-e, truncando em 5000 caracteres caso o texto exceda esse limite
5. IF um Pedido com transportadoraId é efetivado e o cadastro da transportadora não possui CNPJ ou razão social preenchidos, THEN THE Sistema_Pedido SHALL rejeitar a efetivação com mensagem de erro indicando quais dados da transportadora estão incompletos

### Requisito 8: Rastreabilidade do Pedido do Cliente

**User Story:** Como operador de vendas, eu quero registrar o número do pedido de compra do cliente e utilizá-lo como filtro de busca, para que a equipe comercial localize pedidos facilmente usando a referência do cliente.

#### Critérios de Aceitação

1. WHEN um Pedido é criado ou editado com numeroPedidoCliente, THE Sistema_Pedido SHALL persistir o valor como texto livre de até 60 caracteres, rejeitando valores compostos apenas por espaços em branco
2. WHEN o numeroPedidoCliente está preenchido no Pedido e a NF-e é emitida, THE Sistema_Pedido SHALL incluir os primeiros 15 caracteres do valor no tag xPed do grupo de detalhamento de produto na NF-e, truncando silenciosamente caso o valor armazenado exceda 15 caracteres
3. WHEN a listagem de pedidos é consultada com filtro numeroPedidoCliente contendo ao menos 1 caractere não-branco, THE Sistema_Pedido SHALL retornar pedidos de qualquer status que contenham o texto informado (busca parcial, case-insensitive)
4. IF o filtro numeroPedidoCliente informado na busca contiver apenas espaços em branco ou estiver vazio, THEN THE Sistema_Pedido SHALL ignorar o filtro e retornar a listagem sem aplicar essa restrição

### Requisito 9: Gestão de Prioridade do Pedido

**User Story:** Como gerente de vendas, eu quero classificar pedidos por prioridade (Baixa, Normal, Urgente), para que a equipe de expedição e faturamento priorize entregas conforme a necessidade comercial.

#### Critérios de Aceitação

1. WHEN a listagem de pedidos é consultada com filtro prioridade, THE Sistema_Pedido SHALL retornar apenas pedidos com a prioridade informada, suportando um único valor do enum (BAIXA, NORMAL ou URGENTE)
2. WHEN a listagem de pedidos é ordenada por prioridade, THE Sistema_Pedido SHALL ordenar usando a hierarquia: URGENTE primeiro, depois NORMAL, depois BAIXA; dentro da mesma prioridade, SHALL ordenar por data de criação ascendente (pedidos mais antigos primeiro)
3. WHEN um Pedido com prioridade URGENTE é criado, THE Sistema_Pedido SHALL registrar e retornar na resposta o campo dataLimiteAtendimento calculado como data de criação + 24 horas, para controle de SLA
4. IF o filtro prioridade contém um valor que não pertence ao enum (BAIXA, NORMAL, URGENTE), THEN THE Sistema_Pedido SHALL rejeitar a consulta com mensagem de erro indicando os valores válidos aceitos

### Requisito 10: Validações de Integridade na Edição

**User Story:** Como operador de vendas, eu quero que o sistema impeça edições em pedidos que já foram parcialmente faturados ou estão em status inválido para edição, para que a integridade dos dados fiscais e financeiros seja preservada.

#### Critérios de Aceitação

1. WHILE um Pedido possui status RASCUNHO, THE Sistema_Pedido SHALL permitir edição de todos os campos de cabeçalho (clienteId, dataEntrega, observacao, observacaoNota, transportadoraId, modalidadeFrete, enderecoEntrega, origemPedido, prioridade, dataValidade, numeroPedidoCliente, tipoDesconto, descontoGeral, acrescimoGeral) e de itens (inclusão, alteração e remoção)
2. WHILE um Pedido possui status CONFIRMADO e não possui faturamentos parciais, THE Sistema_Pedido SHALL permitir edição apenas dos campos: observacao, observacaoNota, prioridade, dataEntrega, transportadoraId, modalidadeFrete e enderecoEntrega
3. IF um Pedido possui status CONFIRMADO sem faturamentos parciais e uma edição tenta alterar campos fora do conjunto permitido (clienteId, itens, descontoGeral, acrescimoGeral, origemPedido, dataValidade, numeroPedidoCliente), THEN THE Sistema_Pedido SHALL rejeitar a operação com mensagem indicando quais campos não são editáveis no status CONFIRMADO
4. WHILE um Pedido possui status CONFIRMADO e possui faturamentos parciais, THE Sistema_Pedido SHALL permitir edição dos campos de cabeçalho: observacao, observacaoNota, prioridade, dataEntrega, transportadoraId, modalidadeFrete e enderecoEntrega, e permitir edição apenas de itens cuja quantidadeFaturada seja igual a 0
5. WHILE um Pedido possui status CONFIRMADO e possui faturamentos parciais, THE Sistema_Pedido SHALL impedir edição e remoção de itens cuja quantidadeFaturada seja maior que 0
6. IF um Pedido possui status EFETIVADO ou CANCELADO, THEN THE Sistema_Pedido SHALL rejeitar qualquer tentativa de edição com mensagem informando o status atual do pedido que impede a alteração
7. IF uma edição é rejeitada por conter itens com faturamento parcial, THEN THE Sistema_Pedido SHALL retornar na resposta a lista dos itens bloqueados contendo o identificador do item, o nome do produto e a quantidadeFaturada de cada um

### Requisito 11: Campos de Auditoria e Origem

**User Story:** Como gerente comercial, eu quero identificar a origem de cada pedido (manual, e-commerce, EDI, orçamento convertido) e filtrar a listagem por origem, para que eu possa analisar a performance de cada canal de vendas.

#### Critérios de Aceitação

1. WHEN a listagem de pedidos é consultada com filtro origemPedido contendo um valor válido (MANUAL, ECOMMERCE, EDI, ORCAMENTO), THE Sistema_Pedido SHALL retornar apenas pedidos com a origem informada
2. WHEN um Pedido é criado com origemPedido ORCAMENTO e o campo orcamentoOrigemId é informado, THE Sistema_Pedido SHALL validar que o orçamento referenciado existe e pertence à mesma empresa do pedido antes de persistir o vínculo
3. WHEN a listagem de pedidos é consultada, THE Sistema_Pedido SHALL incluir o campo origemPedido na resposta para cada pedido
4. IF a listagem de pedidos é consultada com filtro origemPedido contendo um valor fora do conjunto válido (MANUAL, ECOMMERCE, EDI, ORCAMENTO), THEN THE Sistema_Pedido SHALL rejeitar a consulta com mensagem de erro indicando os valores aceitos
5. IF um Pedido é criado ou editado com orcamentoOrigemId e origemPedido diferente de ORCAMENTO, THEN THE Sistema_Pedido SHALL rejeitar a operação com mensagem de erro indicando que orcamentoOrigemId é aceito apenas para origem ORCAMENTO
6. WHILE um Pedido possui status diferente de RASCUNHO, THE Sistema_Pedido SHALL impedir alteração do campo origemPedido, preservando o canal de entrada original para fins de auditoria

### Requisito 12: Persistência e Migração de Schema

**User Story:** Como desenvolvedor, eu quero que os novos campos sejam adicionados ao schema Prisma e ao banco de dados via migration, para que a evolução do modelo seja rastreável e compatível com dados existentes.

#### Critérios de Aceitação

1. THE Sistema_Pedido SHALL adicionar ao modelo PedidoVenda no schema Prisma os campos: dataEntrega (DateTime?), observacao (Text?), observacaoNota (Text?), transportadoraId (String?), modalidadeFrete (String? @db.VarChar(1)), origemPedido (String @default("MANUAL") @db.VarChar(20)), prioridade (String @default("NORMAL") @db.VarChar(10)), dataValidade (DateTime?), numeroPedidoCliente (String? @db.VarChar(60)), tipoDesconto (String? @db.VarChar(15)), descontoGeral (Decimal @default(0) @db.Decimal(12,2)), acrescimoGeral (Decimal @default(0) @db.Decimal(12,2)), enderecoEntrega (Json?), e orcamentoOrigemId (String?), todos com default ou nullable para que registros existentes permaneçam válidos sem intervenção manual
2. THE Sistema_Pedido SHALL adicionar ao modelo ItemPedidoVenda no schema Prisma os campos: descontoValor (Decimal @default(0) @db.Decimal(12,4)), frete (Decimal @default(0) @db.Decimal(12,2)), seguro (Decimal @default(0) @db.Decimal(12,2)), outrasDespesas (Decimal @default(0) @db.Decimal(12,2)), observacaoItem (Text?), dataEntregaItem (DateTime?), comissaoPercItem (Decimal @default(0) @db.Decimal(5,2)), e quantidadeFaturada (Decimal @default(0) @db.Decimal(12,4)), todos com default 0 ou nullable para que registros existentes permaneçam válidos sem intervenção manual
3. THE Sistema_Pedido SHALL armazenar o enderecoEntrega como campo Json nullable no modelo PedidoVenda, contendo a estrutura: logradouro (string), numero (string), complemento (string opcional), bairro (string), cidade (string), uf (string 2 chars), cep (string 8 dígitos), codigoIbge (string 7 dígitos opcional)
4. WHEN a migration é executada em banco com dados existentes, THE Sistema_Pedido SHALL preservar todos os registros existentes de PedidoVenda e ItemPedidoVenda com contagem de registros idêntica antes e depois da migration, e os novos campos preenchidos com seus valores default (0, null ou "MANUAL"/"NORMAL" conforme definido)
5. WHEN a migration é executada, THE Sistema_Pedido SHALL completar sem erros em uma única transação atômica, garantindo que em caso de falha nenhuma alteração parcial seja aplicada ao banco
