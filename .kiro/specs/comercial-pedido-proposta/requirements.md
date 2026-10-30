# Requirements Document

## Introduction

Esta feature introduz o **Pedido/Proposta** (entidade nova e independente,
tabela `PedidoProposta`) como o ponto de entrada unificado do módulo Comercial
do Vizor ERP (Carton Wega — gráfica/embalagens). É o equivalente a um RFQ (Request
for Quote) / lead dos MIS gráficos (CERM, Label Traxx, Avanti) e CRMs
(Pipedrive, HubSpot): representa a **intenção comercial** de um cliente antes de
existir qualquer cálculo de orçamento.

Hoje o módulo já possui o `OrcamentoGrafico` (o cálculo/quote, com status
RASCUNHO→ENVIADO→APROVADO→CONVERTIDO/RECUSADO/VENCIDO e a sub-etapa de cálculo
`etapaCalculo`: AGUARDANDO→EM_CALCULO→VALIDAR→VALIDADO) e a
`SolicitacaoOrcamentoRep` (solicitação vinda do portal do representante). O
Pedido/Proposta é uma camada ANTERIOR e separada: nem toda proposta vira
orçamento — só quando um usuário decide ENCAMINHAR a proposta para orçamento é
que o `OrcamentoGrafico` é criado e vinculado, passando então a aparecer no menu
Orçamento.

O Pedido/Proposta é a **tela de gestão central** de pedidos/propostas de TODOS os
níveis e origens — representante, vendedor e venda interna/balcão — cobrindo
produtos existentes (repetição), mostruário e novos. Possui máquina de estados
própria (NOVO → EM_ANALISE → ENVIADO_ORCAMENTO → ORCADO → PROPOSTA_ENVIADA →
ACEITO | PERDIDO | CANCELADO), suporta até 5 imagens anexadas (armazenadas como
BYTEA no Postgres/Neon, servidas por rota dedicada), controle de amostra, e só
libera o fluxo para Produção (PCP) e Faturamento quando todas as fases exigidas
estiverem resolvidas.

### Escopo (incluído)

- Criação do Pedido/Proposta por origem (representante, vendedor, interna).
- Formulário com os campos da planilha de pedidos Carton Wega.
- Upload de até 5 imagens por proposta (BYTEA) + rota GET de leitura.
- Máquina de estados própria do RFQ com transições válidas e efeitos.
- Encaminhar para orçamento: criação do `OrcamentoGrafico` vinculado.
- Visualização somente-leitura da proposta (todos os campos + galeria) dentro
  do detalhe do `OrcamentoGrafico`.
- Controle de amostra (reusando `AprovacaoAmostra` quando possível).
- Liberação a PCP/Faturamento condicionada a todas as fases resolvidas.
- Isolamento multi-tenant obrigatório por `empresaId`.

### Fora de escopo

- Alteração do motor de cálculo calibrado (golden 15.235 ≤ 0,5%).
- Storage externo de arquivos (permanece BYTEA no Postgres/Neon).
- Edição do CEV decomposto.

## Glossary

- **Pedido_Proposta**: entidade nova (`PedidoProposta`) que representa um RFQ/lead
  comercial, independente do orçamento. Contém os dados comerciais do pedido e as
  imagens anexadas.
- **Orcamento_Grafico**: entidade existente (`OrcamentoGrafico`) que representa o
  cálculo/quote de um pedido. Criada somente ao encaminhar um Pedido_Proposta.
- **Origem**: classificação de quem originou o Pedido_Proposta —
  `REPRESENTANTE`, `VENDEDOR` ou `INTERNA`.
- **Anexo_Pedido_Proposta**: entidade nova (`AnexoPedidoProposta`) que armazena
  uma imagem anexada a um Pedido_Proposta, com os bytes da imagem em BYTEA.
- **Tipo_Pedido**: classificação do tipo de trabalho — `REPETICAO`, `MOSTRUARIO`
  ou `NOVO`.
- **Estado_RFQ**: estado da máquina de estados do Pedido_Proposta — `NOVO`,
  `EM_ANALISE`, `ENVIADO_ORCAMENTO`, `ORCADO`, `PROPOSTA_ENVIADA`, `ACEITO`,
  `PERDIDO`, `CANCELADO`.
- **Aprovacao_Amostra**: entidade existente (`AprovacaoAmostra`) que controla o
  envio e a aprovação de amostra física pelo cliente.
- **Representante**: usuário externo (portal do representante) que lança pedidos
  em nome de clientes, identificado por `representanteId`.
- **Vendedor**: usuário interno da área comercial, identificado por `vendedorId`.
- **Comercial_Interno**: usuário interno que opera o módulo Comercial (venda
  interna/balcão, análise e gestão de pedidos).
- **Calculista**: usuário responsável por calcular o `Orcamento_Grafico`.
- **Supervisor_Comercial**: usuário com perfil `ADMIN`, `SUPER_ADMIN` ou
  `SUPERVISOR`, autorizado a liberar o fluxo para PCP/Faturamento e validar
  etapas sensíveis.
- **empresaId**: identificador do tenant (empresa). Toda operação é isolada por
  este campo.
- **PCP**: módulo de Planejamento e Controle de Produção, que abre a Ordem de
  Produção (OP).
- **Faturamento**: processo de emissão fiscal (NF-e) da venda.
- **Fase_Exigida**: condição que deve estar resolvida para liberar a produção —
  orçado, aceite do cliente, cálculo conferido/validado e amostra aprovada
  (quando exigida).

## Requirements

### Requirement 1: Criação do Pedido/Proposta por origem

**User Story:** As a Comercial_Interno, I want criar um Pedido/Proposta informando
sua origem, so that qualquer canal de entrada (representante, vendedor ou venda
interna) seja registrado de forma unificada antes de orçar.

#### Acceptance Criteria

1. WHEN um usuário autenticado solicita a criação de um Pedido_Proposta, THE Pedido_Proposta SHALL ser gravado com o `empresaId` do usuário autenticado e o estado inicial `NOVO`.
2. WHEN um Pedido_Proposta é criado, THE Pedido_Proposta SHALL registrar uma `origem` igual a um dos valores `REPRESENTANTE`, `VENDEDOR` ou `INTERNA`.
3. IF a `origem` informada for `REPRESENTANTE` e nenhum `representanteId` for informado, THEN THE Pedido_Proposta SHALL rejeitar a criação com código de erro de validação e mensagem indicando o campo `representanteId` ausente.
4. IF a `origem` informada for `VENDEDOR` e nenhum `vendedorId` for informado, THEN THE Pedido_Proposta SHALL rejeitar a criação com código de erro de validação e mensagem indicando o campo `vendedorId` ausente.
5. WHERE a `origem` for `INTERNA`, THE Pedido_Proposta SHALL marcar o registro com a indicação de venda interna e dispensar `representanteId` e `vendedorId`.
6. IF a `origem` informada não for um dos valores `REPRESENTANTE`, `VENDEDOR` ou `INTERNA`, THEN THE Pedido_Proposta SHALL rejeitar a criação com código de erro de validação.
7. WHEN um Pedido_Proposta é criado, THE Pedido_Proposta SHALL registrar um `tipoPedido` igual a um dos valores `REPETICAO`, `MOSTRUARIO` ou `NOVO`.
8. IF o `tipoPedido` informado não for um dos valores `REPETICAO`, `MOSTRUARIO` ou `NOVO`, THEN THE Pedido_Proposta SHALL rejeitar a criação com código de erro de validação e mensagem indicando `tipoPedido` inválido.

### Requirement 2: Campos do formulário (planilha Carton Wega)

**User Story:** As a Representante, I want preencher os campos do pedido conforme
a planilha da Carton Wega, so that o setor de orçamento receba todos os dados
necessários para calcular a proposta com fidelidade.

#### Acceptance Criteria

1. WHEN um Pedido_Proposta é criado ou atualizado, THE Pedido_Proposta SHALL persistir os campos de identificação do cliente: `clienteId` (quando cliente existente), `clienteNome`, `clienteCpfCnpj`, e o indicador `jaCliente`.
2. WHEN o usuário informa um CNPJ no formulário, THE Pedido_Proposta SHALL permitir a consulta de CNPJ existente para autopreenchimento dos dados do cliente, reutilizando o serviço de consulta de CNPJ já existente no sistema.
3. WHEN um Pedido_Proposta é criado ou atualizado, THE Pedido_Proposta SHALL persistir os campos comerciais e técnicos: `mercado`, `ufOrigem`, `cidade`, `tipoEntrega` (`UNICA` ou `FRACIONADA`), `entregaFracionadaDias`, `prazoPagamento`, `produtoNome`, `tipoEmbalagem`, `quantidade`, `cartao`, `gramatura`, `medidasTexto` (Comprimento x Largura x Altura), `cartaoFsc`, `corteInternoVerso`, `passtime`, `acabamentos`, `matriz`, `acabamentoManual`, `quantidadePorVolume`, `variacoesArte`, `exportacao` (`COMUM` ou `EXPORTACAO`), `dataValidade`, `discriminacao` e `observacoes`.
4. IF o campo `mercado` não for informado na criação ou atualização, THEN THE Pedido_Proposta SHALL rejeitar a operação com código de erro de validação indicando que `mercado` é obrigatório.
5. IF `tipoEntrega` for `FRACIONADA` e `entregaFracionadaDias` não for informado, THEN THE Pedido_Proposta SHALL rejeitar a operação com código de erro de validação indicando que o intervalo de dias é obrigatório para entrega fracionada.
6. WHERE `tipoEntrega` for `UNICA`, THE Pedido_Proposta SHALL ignorar o campo `entregaFracionadaDias`.
7. WHEN um campo booleano do formulário (`jaCliente`, `cartaoFsc`, `corteInternoVerso`, `passtime`, `acabamentoManual`) não for informado, THE Pedido_Proposta SHALL assumir o valor `false` para esse campo.

### Requirement 3: Anexos de imagens (até 5, armazenadas como BYTEA)

**User Story:** As a Representante, I want anexar até 5 imagens de amostra/arte ao
pedido, so that o setor de orçamento visualize o material de referência junto com
os dados do pedido.

#### Acceptance Criteria

1. WHEN um usuário anexa uma imagem a um Pedido_Proposta, THE Anexo_Pedido_Proposta SHALL ser gravado com `pedidoPropostaId`, `nome`, `tipo` (mime), `tamanho` (bytes) e `dados` (conteúdo binário em BYTEA).
2. IF um Pedido_Proposta já possui 5 Anexo_Pedido_Proposta e um novo anexo é enviado, THEN THE Pedido_Proposta SHALL rejeitar o novo anexo com código de erro indicando que o limite de 5 imagens foi atingido.
3. IF o tipo mime do arquivo enviado não for de imagem, THEN THE Pedido_Proposta SHALL rejeitar o anexo com código de erro de validação indicando que apenas imagens são aceitas.
4. WHEN um usuário solicita a leitura de um Anexo_Pedido_Proposta por sua rota dedicada, THE Pedido_Proposta SHALL retornar o conteúdo binário da imagem com o cabeçalho de tipo mime correspondente ao `tipo` armazenado.
5. WHEN um usuário solicita a exclusão de um Anexo_Pedido_Proposta, THE Pedido_Proposta SHALL remover o anexo e liberar uma vaga dentro do limite de 5 imagens.
6. WHEN uma listagem ou consulta de Pedido_Proposta é retornada, THE Pedido_Proposta SHALL excluir o campo binário `dados` do resultado, retornando apenas os metadados dos anexos (`id`, `nome`, `tipo`, `tamanho`).

### Requirement 4: Máquina de estados do RFQ

**User Story:** As a Comercial_Interno, I want que o Pedido/Proposta siga uma
máquina de estados definida, so that o andamento de cada pedido seja rastreável e
transições inválidas sejam impedidas.

#### Acceptance Criteria

1. WHEN um Pedido_Proposta é criado, THE Pedido_Proposta SHALL assumir o estado `NOVO`.
2. WHEN o estado atual é `NOVO`, THE Pedido_Proposta SHALL permitir transição apenas para `EM_ANALISE` ou `CANCELADO`.
3. WHEN o estado atual é `EM_ANALISE`, THE Pedido_Proposta SHALL permitir transição apenas para `ENVIADO_ORCAMENTO`, `PERDIDO` ou `CANCELADO`.
4. WHEN o estado atual é `ENVIADO_ORCAMENTO`, THE Pedido_Proposta SHALL permitir transição apenas para `ORCADO`, `PERDIDO` ou `CANCELADO`.
5. WHEN o estado atual é `ORCADO`, THE Pedido_Proposta SHALL permitir transição apenas para `PROPOSTA_ENVIADA`, `PERDIDO` ou `CANCELADO`.
6. WHEN o estado atual é `PROPOSTA_ENVIADA`, THE Pedido_Proposta SHALL permitir transição apenas para `ACEITO`, `PERDIDO` ou `CANCELADO`.
7. WHILE o estado atual for `ACEITO`, `PERDIDO` ou `CANCELADO`, THE Pedido_Proposta SHALL recusar qualquer transição de estado adicional.
8. IF uma transição de estado solicitada não constar entre as transições permitidas para o estado atual, THEN THE Pedido_Proposta SHALL rejeitar a transição com código de erro indicando transição inválida.
9. WHEN uma transição de estado é efetivada, THE Pedido_Proposta SHALL registrar o estado anterior, o estado novo, o usuário responsável e a data/hora da transição.
10. WHEN o estado passa para `CANCELADO` ou `PERDIDO`, THE Pedido_Proposta SHALL exigir um motivo com no mínimo 5 caracteres.

### Requirement 5: Encaminhar para orçamento (criação do OrcamentoGrafico vinculado)

**User Story:** As a Comercial_Interno, I want encaminhar um Pedido/Proposta para
orçamento, so that o cálculo seja criado no menu Orçamento e vinculado à proposta
de origem.

#### Acceptance Criteria

1. WHEN um usuário encaminha um Pedido_Proposta para orçamento, THE Pedido_Proposta SHALL criar um Orcamento_Grafico vinculado ao Pedido_Proposta, com o mesmo `empresaId` do Pedido_Proposta.
2. WHEN o Orcamento_Grafico é criado pelo encaminhamento, THE Pedido_Proposta SHALL mapear para o Orcamento_Grafico os dados do pedido (cliente, tipo de embalagem, medidas, quantidade), seguindo o mapeamento usado pelo serviço existente de criação de orçamento a partir de solicitação.
3. WHEN o encaminhamento para orçamento é concluído com sucesso, THE Pedido_Proposta SHALL persistir o estado (`estado_atual`) como `ENVIADO_ORCAMENTO`, sendo esse o valor autoritativo pós-transição verificável em consultas subsequentes.
4. IF o estado atual do Pedido_Proposta não for `EM_ANALISE` no momento do encaminhamento, THEN THE Pedido_Proposta SHALL rejeitar o encaminhamento com código de erro indicando que o pedido não está apto a ser encaminhado.
5. WHEN o Orcamento_Grafico é criado pelo encaminhamento, THE Orcamento_Grafico SHALL registrar a referência ao Pedido_Proposta de origem (`pedidoPropostaId`).
6. IF a criação do Orcamento_Grafico falhar durante o encaminhamento, THEN THE Pedido_Proposta SHALL manter o estado anterior inalterado e não deixar Orcamento_Grafico órfão.
7. WHILE o Pedido_Proposta não tiver sido encaminhado para orçamento, THE Pedido_Proposta SHALL permanecer ausente do menu Orçamento.

### Requirement 6: Visualização da proposta e imagens dentro do orçamento

**User Story:** As a Calculista, I want visualizar a proposta de origem e suas
imagens a partir do detalhe do orçamento, so that eu calcule com base em todos os
dados preenchidos pelo setor de proposta.

#### Acceptance Criteria

1. WHEN o detalhe de um Orcamento_Grafico vinculado a um Pedido_Proposta é consultado, THE Orcamento_Grafico SHALL disponibilizar o acesso aos dados somente-leitura do Pedido_Proposta de origem.
2. WHEN um usuário aciona a visualização da proposta a partir do orçamento, THE Pedido_Proposta SHALL retornar todos os campos do formulário preenchidos (identificação do cliente, campos comerciais e técnicos, discriminação e observações).
3. WHEN a visualização da proposta é retornada, THE Pedido_Proposta SHALL incluir a lista de metadados das imagens anexadas, com uma referência de leitura (rota GET) para cada imagem.
4. IF o Orcamento_Grafico consultado não possuir Pedido_Proposta vinculado, THEN THE Orcamento_Grafico SHALL indicar a ausência de proposta de origem sem retornar erro.
5. WHEN a visualização da proposta é retornada ao usuário, THE Pedido_Proposta SHALL impedir a edição dos dados da proposta por meio dessa visualização (somente leitura).

### Requirement 7: Controle de amostra

**User Story:** As a Comercial_Interno, I want controlar o andamento da amostra do
pedido, so that eu acompanhe o envio e a aprovação da amostra pelo cliente antes
de liberar a produção.

#### Acceptance Criteria

1. WHERE um Pedido_Proposta exigir amostra, THE Pedido_Proposta SHALL registrar o controle de amostra reutilizando a entidade Aprovacao_Amostra existente, vinculada ao Pedido_Proposta.
2. WHEN a exigência de amostra de um Pedido_Proposta é definida, THE Pedido_Proposta SHALL registrar o indicador `exigeAmostra`.
3. WHEN a amostra é aprovada pelo cliente, THE Aprovacao_Amostra SHALL registrar o estado de aprovação, o responsável pela aprovação e a data/hora da aprovação.
4. WHEN o andamento de um Pedido_Proposta é consultado, THE Pedido_Proposta SHALL informar o estado atual da amostra (não exigida, pendente de envio, enviada, aprovada ou reprovada).
5. IF `exigeAmostra` for `true` e a Aprovacao_Amostra não estiver aprovada, THEN THE Pedido_Proposta SHALL manter a fase de amostra como não resolvida.

### Requirement 8: Liberação a PCP/Faturamento com todas as fases resolvidas

**User Story:** As a Supervisor_Comercial, I want liberar o pedido para Produção e
Faturamento somente quando todas as fases exigidas estiverem resolvidas, so that
nenhum pedido avance para a fábrica sem orçamento, aceite, cálculo conferido e
amostra aprovada.

#### Acceptance Criteria

1. WHEN um usuário solicita a liberação de um Pedido_Proposta para PCP e Faturamento, THE Pedido_Proposta SHALL verificar que o Orcamento_Grafico vinculado existe e está orçado.
2. WHEN a liberação é solicitada, THE Pedido_Proposta SHALL verificar que o Pedido_Proposta está no estado `ACEITO` (aceite do cliente registrado).
3. WHEN a liberação é solicitada, THE Pedido_Proposta SHALL verificar que o cálculo do Orcamento_Grafico vinculado está validado (`etapaCalculo` igual a `VALIDADO`).
4. WHERE o Pedido_Proposta exigir amostra, THE Pedido_Proposta SHALL verificar que a Aprovacao_Amostra está aprovada antes de permitir a liberação.
5. IF qualquer Fase_Exigida não estiver resolvida no momento da liberação, THEN THE Pedido_Proposta SHALL rejeitar a liberação com código de erro listando as fases pendentes.
6. WHEN todas as Fase_Exigida estiverem resolvidas e a liberação for confirmada, THE Pedido_Proposta SHALL liberar o fluxo para PCP (abertura de OP) e Faturamento.
7. IF o usuário que solicita a liberação não for um Supervisor_Comercial, THEN THE Pedido_Proposta SHALL rejeitar a liberação com código de erro de autorização.

### Requirement 9: Gestão central de pedidos/propostas

**User Story:** As a Comercial_Interno, I want uma tela central que liste todos os
pedidos/propostas de todas as origens e tipos, so that eu gerencie o funil
comercial inteiro em um único lugar.

#### Acceptance Criteria

1. WHEN um usuário consulta a listagem de Pedido_Proposta, THE Pedido_Proposta SHALL retornar os pedidos de todas as origens (`REPRESENTANTE`, `VENDEDOR`, `INTERNA`) e de todos os tipos (`REPETICAO`, `MOSTRUARIO`, `NOVO`) pertencentes ao `empresaId` do usuário.
2. WHEN a listagem de Pedido_Proposta é retornada, THE Pedido_Proposta SHALL informar, para cada pedido, o estado atual, a origem, o tipo de pedido e o estágio no funil (incluindo o andamento da amostra quando exigida).
3. WHEN o usuário aplica filtros de estado, origem ou tipo de pedido na listagem, THE Pedido_Proposta SHALL retornar apenas os pedidos que atendem aos filtros informados.
4. WHEN o usuário aplica um termo de busca textual na listagem, THE Pedido_Proposta SHALL retornar os pedidos cujo nome do cliente ou nome do produto contenha o termo informado, sem diferenciar maiúsculas de minúsculas.

### Requirement 10: Isolamento multi-tenant

**User Story:** As a Supervisor_Comercial, I want que todo acesso a
pedidos/propostas seja isolado por empresa, so that dados de uma empresa nunca
sejam acessados ou alterados por usuários de outra empresa.

#### Acceptance Criteria

1. WHEN qualquer consulta a Pedido_Proposta é executada, THE Pedido_Proposta SHALL filtrar explicitamente pelo `empresaId` do usuário autenticado, não dependendo apenas do mecanismo automático de tenant.
2. IF um usuário solicita um Pedido_Proposta cujo `empresaId` difere do `empresaId` do usuário autenticado, THEN THE Pedido_Proposta SHALL responder como recurso não encontrado, sem expor os dados.
3. WHEN um Anexo_Pedido_Proposta é lido, criado ou excluído, THE Pedido_Proposta SHALL validar que o Pedido_Proposta pai pertence ao `empresaId` do usuário autenticado antes de executar a operação.
4. WHEN um Orcamento_Grafico é criado pelo encaminhamento de um Pedido_Proposta, THE Orcamento_Grafico SHALL ser gravado com o `empresaId` do Pedido_Proposta de origem.
5. WHEN uma transição de estado ou liberação é executada sobre um Pedido_Proposta, THE Pedido_Proposta SHALL validar o `empresaId` do pedido antes de aplicar a alteração.
