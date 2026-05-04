# Documento de Requisitos — ERP WMS Módulos

## Introdução

Este documento descreve os requisitos para a expansão do sistema VisioFab de um WMS dedicado para uma plataforma ERP multi-empresa completa. O sistema já possui autenticação JWT, multiempresa, e um WMS funcional (recebimento, conferência, endereçamento, picking, expedição, estoque, inventário). A expansão adiciona os módulos de **Compras**, **Vendas**, **Financeiro** e **CT-e**, além de integrar o WMS existente com os novos fluxos de compra e venda. O acesso pós-login passa a exigir seleção de empresa e exibição dos módulos disponíveis ao usuário.

---

## Glossário

- **Sistema**: A plataforma VisioFab ERP, composta por backend Fastify/Prisma e frontend Next.js.
- **Empresa**: Entidade multiempresa identificada por CNPJ, já existente no modelo `Empresa` do Prisma.
- **Usuario**: Usuário autenticado, já existente no modelo `Usuario`.
- **UsuarioEmpresa**: Vínculo entre usuário e empresa com campo `modulos` que lista os módulos autorizados (ex.: `"COMPRAS,VENDAS,WMS"` ou `"*"` para todos).
- **Modulo**: Área funcional do sistema. Valores possíveis: `COMPRAS`, `VENDAS`, `FINANCEIRO`, `WMS`, `CTE`, `PCP`.
- **Seletor_Empresa**: Tela exibida após login para que o usuário escolha a empresa que deseja operar.
- **Tela_Modulos**: Tela exibida após seleção de empresa, listando os módulos disponíveis para o usuário naquela empresa.
- **Pedido_Compra**: Documento de intenção de compra com itens, fornecedor e condições comerciais.
- **Compra_Efetivada**: Pedido de compra confirmado, com custos registrados e que gera obrigações financeiras.
- **Pedido_Venda**: Documento de intenção de venda com itens, cliente e condições comerciais.
- **Venda_Efetivada**: Pedido de venda confirmado, com NF-e emitida e que gera direitos financeiros.
- **Tabela_Preco**: Configuração de preços por forma de pagamento e parcelamento, vinculada à empresa.
- **Conta_Pagar**: Obrigação financeira gerada por compra ou lançamento manual.
- **Conta_Receber**: Direito financeiro gerado por venda ou lançamento manual.
- **NF_e**: Nota Fiscal Eletrônica, documento fiscal digital.
- **XML_NFe**: Arquivo XML de NF-e emitido por fornecedor, usado para importação de compras.
- **CT_e**: Conhecimento de Transporte Eletrônico, documento fiscal para transporte de cargas.
- **Agenda_WMS**: Calendário de recebimentos do WMS, vinculado a datas de entrega de pedidos de compra.
- **Vendedor**: Representante comercial vinculado à empresa, com percentual de comissão.
- **WMS**: Módulo de gerenciamento de armazém já existente no sistema.
- **Fornecedor**: Entidade já existente no modelo `Fornecedor` do Prisma.
- **Cliente**: Entidade já existente no modelo `Cliente` do Prisma.
- **Produto**: Entidade já existente no modelo `Produto` do Prisma.
- **SKU**: Unidade de manutenção de estoque, já existente no modelo `SKU` do Prisma.

---

## Requisitos

### Requisito 1: Seleção de Empresa Após Login

**User Story:** Como usuário autenticado, quero selecionar a empresa que desejo operar após o login, para que eu possa trabalhar no contexto correto em um ambiente multiempresa.

#### Critérios de Aceitação

1. WHEN o usuário conclui o login com sucesso, THE Sistema SHALL exibir a tela Seletor_Empresa listando todas as empresas vinculadas ao usuário com status ativo.
2. WHEN o usuário seleciona uma empresa na tela Seletor_Empresa, THE Sistema SHALL armazenar o contexto da empresa selecionada na sessão do usuário.
3. IF o usuário autenticado não possui nenhuma empresa ativa vinculada, THEN THE Sistema SHALL exibir uma mensagem informando que não há empresas disponíveis e impedir o acesso às demais telas.
4. THE Seletor_Empresa SHALL exibir razão social, nome fantasia e CNPJ de cada empresa disponível.
5. WHEN o usuário está operando em uma empresa e deseja trocar, THE Sistema SHALL permitir retornar à tela Seletor_Empresa sem necessidade de novo login.

---

### Requisito 2: Tela de Módulos Disponíveis

**User Story:** Como usuário, quero visualizar os módulos disponíveis para mim na empresa selecionada, para que eu possa navegar apenas pelas funcionalidades às quais tenho acesso.

#### Critérios de Aceitação

1. WHEN o usuário seleciona uma empresa, THE Sistema SHALL exibir a Tela_Modulos listando apenas os módulos presentes no campo `modulos` do registro UsuarioEmpresa correspondente.
2. WHERE o campo `modulos` do UsuarioEmpresa contém o valor `"*"`, THE Sistema SHALL exibir todos os módulos disponíveis na Tela_Modulos.
3. THE Tela_Modulos SHALL exibir os módulos: COMPRAS, VENDAS, FINANCEIRO, WMS, CTE e PCP, ocultando os que o usuário não possui acesso.
4. WHEN o usuário clica em um módulo na Tela_Modulos, THE Sistema SHALL navegar para a página inicial daquele módulo.
5. IF o usuário tenta acessar diretamente uma rota de um módulo sem ter acesso a ele, THEN THE Sistema SHALL redirecionar para a Tela_Modulos com mensagem de acesso negado.

---

### Requisito 3: Cadastro de Vendedores

**User Story:** Como gestor comercial, quero cadastrar vendedores com seus percentuais de comissão, para que eu possa controlar o comissionamento nas operações de compra e venda.

#### Critérios de Aceitação

1. THE Sistema SHALL permitir criar, editar, listar e inativar registros de Vendedor vinculados à empresa.
2. THE Sistema SHALL armazenar para cada Vendedor: nome (obrigatório, máximo 150 caracteres), CPF (obrigatório, único por empresa), percentual de comissão (obrigatório, valor decimal entre 0,00 e 100,00), e status ativo/inativo.
3. IF um CPF informado no cadastro de Vendedor já existir para outro Vendedor ativo na mesma empresa, THEN THE Sistema SHALL retornar erro de duplicidade sem salvar o registro.
4. WHEN um Vendedor é inativado, THE Sistema SHALL manter os vínculos históricos com pedidos e vendas já registrados.

---

### Requisito 4: Pedido de Compra

**User Story:** Como comprador, quero registrar pedidos de compra com itens e condições comerciais, para que eu possa formalizar a intenção de compra junto ao fornecedor.

#### Critérios de Aceitação

1. THE Sistema SHALL permitir criar um Pedido_Compra vinculado a uma empresa, fornecedor, vendedor (opcional) e data de entrega prevista.
2. THE Sistema SHALL permitir adicionar itens ao Pedido_Compra, onde cada item referencia um Produto ou SKU existente, com quantidade (maior que zero) e preço unitário (maior que zero).
3. THE Sistema SHALL classificar cada item do Pedido_Compra como `REVENDA` ou `MATERIA_PRIMA`.
4. THE Sistema SHALL calcular e armazenar o valor total do Pedido_Compra como a soma dos produtos de quantidade por preço unitário de todos os itens.
5. WHEN um Pedido_Compra é salvo, THE Sistema SHALL atribuir um número sequencial único por empresa ao pedido.
6. THE Sistema SHALL permitir os status de Pedido_Compra: `RASCUNHO`, `CONFIRMADO`, `RECEBIDO` e `CANCELADO`.
7. WHEN um Pedido_Compra é cancelado, THE Sistema SHALL exigir um motivo de cancelamento com no mínimo 10 caracteres.

---

### Requisito 5: Efetivação de Compra

**User Story:** Como comprador, quero efetivar um pedido de compra confirmado, para que os custos sejam registrados e as obrigações financeiras sejam geradas automaticamente.

#### Critérios de Aceitação

1. WHEN um Pedido_Compra com status `CONFIRMADO` é efetivado, THE Sistema SHALL criar um registro de Compra_Efetivada vinculado ao pedido, registrando data de efetivação e custos finais.
2. WHEN uma Compra_Efetivada é criada, THE Sistema SHALL gerar automaticamente registros de Conta_Pagar para a empresa, com base nas condições de pagamento informadas na efetivação.
3. WHEN uma Compra_Efetivada é criada e a empresa possui `usaWms = true`, THE Sistema SHALL criar um agendamento na Agenda_WMS com a data de entrega prevista do Pedido_Compra.
4. WHEN uma Compra_Efetivada é criada e a empresa possui `usaWms = false`, THE Sistema SHALL registrar a data de entrega diretamente no registro da Compra_Efetivada como data de entrega confirmada.
5. WHEN uma Compra_Efetivada é criada, THE Sistema SHALL alterar o status do Pedido_Compra vinculado para `RECEBIDO`.

---

### Requisito 6: Importação de Compra via XML de NF-e

**User Story:** Como comprador, quero importar uma NF-e em XML para registrar uma compra, para que o processo de entrada de notas seja automatizado sem redigitação manual.

#### Critérios de Aceitação

1. WHEN um arquivo XML_NFe válido é enviado ao Sistema, THE Sistema SHALL extrair os dados do emitente, itens, valores e condições de pagamento do XML.
2. WHEN o CNPJ do emitente extraído do XML_NFe não corresponde a nenhum Fornecedor cadastrado na empresa, THE Sistema SHALL criar automaticamente um novo Fornecedor com os dados do emitente.
3. WHEN um item do XML_NFe possui código de produto não cadastrado na empresa, THE Sistema SHALL criar automaticamente um novo Produto com os dados do item.
4. WHEN o XML_NFe é processado com sucesso, THE Sistema SHALL criar um Pedido_Compra com status `CONFIRMADO` e uma Compra_Efetivada vinculados, populados com os dados extraídos.
5. IF o XML_NFe enviado não for um arquivo de NF-e válido conforme o schema da SEFAZ, THEN THE Sistema SHALL retornar uma mensagem de erro descritiva sem criar nenhum registro.
6. THE Sistema SHALL armazenar o XML_NFe original vinculado à Compra_Efetivada para consulta futura.
7. FOR ALL XML_NFe importados com sucesso, o valor total calculado pelo Sistema SHALL ser igual ao valor total declarado no XML (propriedade de round-trip de valores fiscais).

---

### Requisito 7: Devolução de Compra

**User Story:** Como comprador, quero registrar a devolução de itens de uma compra efetivada, para que o estoque e as obrigações financeiras sejam ajustados corretamente.

#### Critérios de Aceitação

1. THE Sistema SHALL permitir registrar uma devolução parcial ou total de itens de uma Compra_Efetivada.
2. WHEN uma devolução de compra é registrada, THE Sistema SHALL gerar os dados necessários para emissão de NF_e de devolução vinculada à Compra_Efetivada original.
3. WHEN uma devolução de compra é registrada, THE Sistema SHALL criar um estorno proporcional nas Contas_Pagar geradas pela Compra_Efetivada original.
4. IF a quantidade devolvida de um item exceder a quantidade recebida na Compra_Efetivada, THEN THE Sistema SHALL retornar erro de validação sem registrar a devolução.

---

### Requisito 8: Transferência entre Empresas

**User Story:** Como gestor, quero registrar transferências de produtos entre empresas do grupo, para que o estoque e os documentos fiscais reflitam corretamente a movimentação.

#### Critérios de Aceitação

1. THE Sistema SHALL permitir registrar uma transferência de produtos de uma empresa de origem para uma empresa de destino, ambas cadastradas no sistema.
2. WHEN uma transferência entre empresas é confirmada, THE Sistema SHALL gerar os dados necessários para emissão de NF_e de transferência na empresa de origem.
3. WHEN uma transferência entre empresas é confirmada, THE Sistema SHALL registrar a entrada dos itens na empresa de destino como uma Compra_Efetivada de transferência.
4. IF a quantidade a transferir de um item exceder o saldo disponível na empresa de origem, THEN THE Sistema SHALL retornar erro de validação sem registrar a transferência.

---

### Requisito 9: Tabela de Preço

**User Story:** Como gestor comercial, quero configurar tabelas de preço por forma de pagamento e parcelamento, para que os preços de venda sejam calculados automaticamente conforme as condições comerciais.

#### Critérios de Aceitação

1. THE Sistema SHALL permitir criar e editar Tabelas_Preco vinculadas à empresa, com nome e status ativo/inativo.
2. THE Sistema SHALL permitir configurar em cada Tabela_Preco múltiplas condições de pagamento, onde cada condição define: forma de pagamento (ex.: `DINHEIRO`, `BOLETO`, `CARTAO_CREDITO`, `PIX`), número de parcelas (inteiro maior que zero) e percentual de acréscimo ou desconto (decimal entre -100,00 e 100,00).
3. WHEN uma Tabela_Preco é aplicada a um item de Pedido_Venda, THE Sistema SHALL calcular o preço final do item aplicando o percentual da condição de pagamento selecionada sobre o preço base do Produto.
4. IF uma Tabela_Preco é inativada, THEN THE Sistema SHALL impedir sua seleção em novos Pedidos_Venda sem afetar pedidos já existentes.

---

### Requisito 10: Pedido de Venda

**User Story:** Como vendedor, quero registrar pedidos de venda com itens, cliente e condições comerciais, para que a intenção de venda seja formalizada e o processo de entrega seja iniciado.

#### Critérios de Aceitação

1. THE Sistema SHALL permitir criar um Pedido_Venda vinculado a uma empresa, cliente, vendedor (opcional) e Tabela_Preco.
2. THE Sistema SHALL permitir adicionar itens ao Pedido_Venda, onde cada item referencia um Produto ou SKU existente, com quantidade (maior que zero) e preço unitário calculado conforme a Tabela_Preco selecionada.
3. THE Sistema SHALL calcular e armazenar o valor total do Pedido_Venda como a soma dos produtos de quantidade por preço unitário de todos os itens.
4. WHEN um Pedido_Venda é salvo, THE Sistema SHALL atribuir um número sequencial único por empresa ao pedido.
5. THE Sistema SHALL permitir os status de Pedido_Venda: `RASCUNHO`, `CONFIRMADO`, `EM_SEPARACAO`, `FATURADO` e `CANCELADO`.
6. WHEN um Pedido_Venda é cancelado, THE Sistema SHALL exigir um motivo de cancelamento com no mínimo 10 caracteres.

---

### Requisito 11: Efetivação de Venda e Emissão de NF-e

**User Story:** Como vendedor, quero efetivar um pedido de venda e emitir a NF-e correspondente, para que a venda seja formalizada fiscalmente e as contas a receber sejam geradas.

#### Critérios de Aceitação

1. WHEN um Pedido_Venda com status `CONFIRMADO` é efetivado, THE Sistema SHALL criar um registro de Venda_Efetivada vinculado ao pedido, registrando data de efetivação.
2. WHEN uma Venda_Efetivada é criada, THE Sistema SHALL gerar os dados necessários para emissão de NF_e de venda vinculada ao pedido.
3. WHEN uma Venda_Efetivada é criada, THE Sistema SHALL gerar automaticamente registros de Conta_Receber para a empresa, com base nas condições de pagamento da Tabela_Preco utilizada.
4. WHEN uma Venda_Efetivada é criada e a empresa possui `usaWms = true`, THE Sistema SHALL criar uma ordem de separação no WMS vinculada ao Pedido_Venda.
5. WHEN uma Venda_Efetivada é criada e a empresa possui `usaWms = false`, THE Sistema SHALL registrar o controle de entrega diretamente na Venda_Efetivada com status `PENDENTE`.
6. WHEN uma Venda_Efetivada é criada, THE Sistema SHALL calcular a comissão do Vendedor vinculado ao pedido com base no percentual cadastrado e armazenar o valor calculado.

---

### Requisito 12: Controle de Entrega de Vendas (sem WMS)

**User Story:** Como operador, quero controlar a entrega de pedidos de venda em empresas que não utilizam WMS, para que o status de entrega seja rastreado de forma simples.

#### Critérios de Aceitação

1. WHILE a empresa possui `usaWms = false`, THE Sistema SHALL exibir na Venda_Efetivada os status de entrega: `PENDENTE`, `EM_TRANSITO` e `ENTREGUE`.
2. WHEN o status de entrega de uma Venda_Efetivada é alterado para `ENTREGUE`, THE Sistema SHALL registrar a data e hora da confirmação de entrega.
3. IF uma Venda_Efetivada com status de entrega `ENTREGUE` tiver seu status alterado para `PENDENTE` ou `EM_TRANSITO`, THEN THE Sistema SHALL exigir um motivo de reversão com no mínimo 10 caracteres.

---

### Requisito 13: Integração WMS — Recebimento de Compras

**User Story:** Como operador de armazém, quero que os pedidos de compra com data de entrega apareçam na agenda do WMS, para que o recebimento seja planejado e rastreado.

#### Critérios de Aceitação

1. WHEN uma Compra_Efetivada é criada em empresa com `usaWms = true`, THE Sistema SHALL criar um agendamento na Agenda_WMS com: data prevista de entrega, fornecedor, número do Pedido_Compra e lista de itens esperados.
2. WHEN o recebimento de um agendamento da Agenda_WMS é concluído no WMS, THE Sistema SHALL atualizar o status do Pedido_Compra vinculado para `RECEBIDO`.
3. IF a data de entrega de um agendamento da Agenda_WMS for alterada no Pedido_Compra, THEN THE Sistema SHALL atualizar automaticamente a data no agendamento correspondente.

---

### Requisito 14: Integração WMS — Separação de Vendas

**User Story:** Como operador de armazém, quero que os pedidos de venda efetivados gerem ordens de separação no WMS, para que o processo de picking, embalagem e carregamento seja controlado pelo armazém.

#### Critérios de Aceitação

1. WHEN uma Venda_Efetivada é criada em empresa com `usaWms = true`, THE Sistema SHALL criar uma ordem de separação no WMS vinculada ao Pedido_Venda, com os itens e quantidades do pedido.
2. WHEN a ordem de separação no WMS é concluída, THE Sistema SHALL atualizar o status do Pedido_Venda vinculado para `EM_SEPARACAO`.
3. WHEN o carregamento da ordem de separação no WMS é concluído, THE Sistema SHALL atualizar o status do Pedido_Venda vinculado para `FATURADO`.

---

### Requisito 15: Contas a Pagar

**User Story:** Como financeiro, quero gerenciar as contas a pagar da empresa, para que os vencimentos e pagamentos sejam controlados de forma centralizada.

#### Critérios de Aceitação

1. THE Sistema SHALL permitir criar Contas_Pagar manualmente, vinculadas à empresa, com: descrição (obrigatório), valor (maior que zero), data de vencimento (obrigatório) e fornecedor (opcional).
2. THE Sistema SHALL exibir para cada Conta_Pagar os status: `ABERTA`, `PAGA` e `VENCIDA`.
3. WHEN a data atual ultrapassar a data de vencimento de uma Conta_Pagar com status `ABERTA`, THE Sistema SHALL exibir a Conta_Pagar com status `VENCIDA`.
4. WHEN um pagamento é registrado em uma Conta_Pagar, THE Sistema SHALL armazenar: data do pagamento, valor pago e forma de pagamento, e alterar o status para `PAGA`.
5. IF o valor pago registrado em uma Conta_Pagar for zero ou negativo, THEN THE Sistema SHALL retornar erro de validação sem registrar o pagamento.
6. THE Sistema SHALL permitir filtrar Contas_Pagar por status, fornecedor, período de vencimento e período de pagamento.

---

### Requisito 16: Contas a Receber

**User Story:** Como financeiro, quero gerenciar as contas a receber da empresa, para que os vencimentos e recebimentos sejam controlados de forma centralizada.

#### Critérios de Aceitação

1. THE Sistema SHALL permitir criar Contas_Receber manualmente, vinculadas à empresa, com: descrição (obrigatório), valor (maior que zero), data de vencimento (obrigatório) e cliente (opcional).
2. THE Sistema SHALL exibir para cada Conta_Receber os status: `ABERTA`, `RECEBIDA` e `VENCIDA`.
3. WHEN a data atual ultrapassar a data de vencimento de uma Conta_Receber com status `ABERTA`, THE Sistema SHALL exibir a Conta_Receber com status `VENCIDA`.
4. WHEN um recebimento é registrado em uma Conta_Receber, THE Sistema SHALL armazenar: data do recebimento, valor recebido e forma de pagamento, e alterar o status para `RECEBIDA`.
5. IF o valor recebido registrado em uma Conta_Receber for zero ou negativo, THEN THE Sistema SHALL retornar erro de validação sem registrar o recebimento.
6. THE Sistema SHALL permitir filtrar Contas_Receber por status, cliente, período de vencimento e período de recebimento.

---

### Requisito 17: Emissão de CT-e

**User Story:** Como operador de transporte, quero emitir Conhecimentos de Transporte Eletrônico para os transportes realizados, para que a documentação fiscal de transporte esteja em conformidade com a legislação.

#### Critérios de Aceitação

1. THE Sistema SHALL permitir criar um CT_e vinculado à empresa emitente, com: remetente, destinatário, transportadora, descrição da carga, valor da carga e valor do frete.
2. THE Sistema SHALL permitir vincular um CT_e a uma ou mais NF_e de referência.
3. WHEN os dados de um CT_e são preenchidos e validados, THE Sistema SHALL gerar o XML do CT_e conforme o layout definido pela SEFAZ para transmissão.
4. IF algum campo obrigatório do CT_e estiver ausente ou inválido, THEN THE Sistema SHALL retornar uma lista de erros de validação sem gerar o XML.
5. THE Sistema SHALL armazenar o XML do CT_e gerado e o protocolo de autorização recebido da SEFAZ vinculados ao registro do CT_e.

---

### Requisito 18: Controle de Acesso por Módulo

**User Story:** Como administrador, quero controlar quais módulos cada usuário pode acessar em cada empresa, para que o acesso às funcionalidades seja restrito conforme o perfil de cada colaborador.

#### Critérios de Aceitação

1. THE Sistema SHALL utilizar o campo `modulos` do registro UsuarioEmpresa para determinar quais módulos o usuário pode acessar na empresa selecionada.
2. WHEN um administrador edita o vínculo UsuarioEmpresa, THE Sistema SHALL permitir selecionar individualmente os módulos autorizados ou marcar acesso total (`"*"`).
3. IF um usuário tenta executar uma operação em um módulo não listado no campo `modulos` do seu UsuarioEmpresa, THEN THE Sistema SHALL retornar erro HTTP 403 sem executar a operação.
4. THE Sistema SHALL validar as permissões de módulo tanto no backend (middleware de autorização) quanto no frontend (ocultando rotas e elementos de UI não autorizados).


---

### Requisito 19: API REST Pública para Integração Externa

**User Story:** Como desenvolvedor de um sistema externo (ERP, e-commerce, TMS), quero acessar uma API REST documentada do WMS, para que eu possa integrar meu sistema com as operações de armazém sem intervenção manual.

#### Critérios de Aceitação

1. THE Sistema SHALL expor endpoints REST públicos sob o prefixo `/api/v1/integracao/` para operações de integração externa.
2. THE Sistema SHALL autenticar requisições de integração via API Key enviada no header `X-Api-Key`, vinculada a uma empresa específica.
3. THE Sistema SHALL permitir que administradores criem, listem, revoguem e regenerem API Keys por empresa, com nome descritivo e data de expiração opcional.
4. THE Sistema SHALL expor os seguintes recursos via API de integração:
   - `POST /api/v1/integracao/notas-entrada` — criar nota de entrada (recebimento)
   - `GET /api/v1/integracao/estoque` — consultar saldo de estoque por produto
   - `POST /api/v1/integracao/pedidos-separacao` — solicitar separação de pedido de venda
   - `GET /api/v1/integracao/pedidos-separacao/:id/status` — consultar status de separação
   - `GET /api/v1/integracao/notas-entrada/:id/status` — consultar status de recebimento
   - `POST /api/v1/integracao/produtos` — cadastrar ou atualizar produto
5. THE Sistema SHALL retornar respostas padronizadas em JSON com campos `success`, `data` e `error`, e códigos HTTP semânticos (200, 201, 400, 401, 404, 422).
6. THE Sistema SHALL registrar em log todas as chamadas à API de integração com: timestamp, API Key utilizada, endpoint, método HTTP, status da resposta e tempo de processamento.
7. THE Sistema SHALL aplicar rate limiting de 100 requisições por minuto por API Key para proteger contra abuso.
8. IF uma API Key expirada ou revogada for utilizada, THEN THE Sistema SHALL retornar HTTP 401 sem executar a operação.

---

### Requisito 20: Webhooks para Notificação de Eventos

**User Story:** Como desenvolvedor de um sistema externo, quero receber notificações automáticas quando eventos relevantes ocorrem no WMS, para que meu sistema possa reagir em tempo real sem precisar consultar periodicamente.

#### Critérios de Aceitação

1. THE Sistema SHALL permitir que administradores configurem URLs de webhook por empresa, associando cada URL a um ou mais tipos de evento.
2. THE Sistema SHALL suportar os seguintes tipos de evento para webhook:
   - `nota.recebida` — quando uma nota de entrada é conferida e aceita
   - `nota.divergente` — quando uma conferência detecta divergência
   - `separacao.iniciada` — quando a separação de um pedido é iniciada
   - `separacao.concluida` — quando a separação de um pedido é finalizada
   - `expedicao.carregada` — quando um carregamento é concluído
   - `estoque.atualizado` — quando o saldo de estoque de um produto é alterado
3. WHEN um evento configurado ocorre, THE Sistema SHALL enviar um POST HTTP para a URL do webhook com payload JSON contendo: tipo do evento, timestamp, dados do evento e assinatura HMAC-SHA256 para validação.
4. IF a URL do webhook retornar um código HTTP diferente de 2xx, THEN THE Sistema SHALL reenviá-lo até 3 vezes com intervalo exponencial (1min, 5min, 30min) antes de marcar como falho.
5. THE Sistema SHALL manter um log de entregas de webhook com: evento, URL, status HTTP da resposta, número de tentativas e timestamp de cada tentativa.
6. THE Sistema SHALL permitir que administradores visualizem o histórico de entregas de webhook e reenviem manualmente eventos falhos.

---

### Requisito 21: Importação de Arquivos para Integração Legada

**User Story:** Como operador que utiliza um sistema legado sem API, quero importar arquivos CSV ou XML para o WMS, para que eu possa integrar operações de recebimento e separação sem redigitação manual.

#### Critérios de Aceitação

1. THE Sistema SHALL permitir o upload de arquivos nos formatos CSV e XML para importação de dados de integração.
2. THE Sistema SHALL suportar importação dos seguintes tipos de arquivo:
   - Notas de entrada (recebimento) — com dados do fornecedor, itens, quantidades e data de entrega
   - Pedidos de separação (venda) — com dados do cliente, itens e quantidades
   - Cadastro de produtos — com código, descrição, unidade e dados fiscais
3. THE Sistema SHALL validar o formato e os dados do arquivo antes de processar, retornando uma lista de erros por linha quando houver problemas.
4. WHEN um arquivo é processado com sucesso, THE Sistema SHALL criar os registros correspondentes no WMS e retornar um relatório com o número de registros importados e eventuais avisos.
5. THE Sistema SHALL disponibilizar templates de arquivo CSV para download, com cabeçalhos e exemplos de preenchimento para cada tipo de importação.
6. IF um arquivo contiver linhas válidas e inválidas, THEN THE Sistema SHALL processar apenas as linhas válidas e retornar um relatório detalhando as linhas rejeitadas com o motivo de cada rejeição.
