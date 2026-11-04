# Requirements Document

## Introduction

Esta spec é o item 1 ("Fundação") da ordem de execução da §20.4 de `docs/PROJETO-MODULO-COMERCIAL.md`. Ela substitui o modelo de estados linear do `PedidoProposta` (`NOVO → EM_ANALISE → ENVIADO_ORCAMENTO → ORCADO → PROPOSTA_ENVIADA → ACEITO`, mais `PERDIDO`/`CANCELADO`, implementado em `pedido-proposta-estado.service.ts`) por um modelo de **status fiel**.

Hoje o mesmo pedido percorre seis entidades com status próprio: Solicitação do Representante (`SolicitacaoOrcamentoRep`), `PedidoProposta`, `OrcamentoGrafico`, `AprovacaoAmostra`, `PedidoVenda` e `OrdemProducao`. Não existe uma resposta única para "onde está o pedido e com quem está a bola". O controle real vive no Monday.

A Fundação entrega:

1. As **respostas do lançamento** (cliente, faca, arte, referência e exigência de prova) e a **classificação derivada** delas: Repetição, Alteração (o "Novo Pedido" da Wega) ou Produto Novo. A classificação define quanto trabalho a pré-impressão faz. Cálculo gráfico e aprovação de arte pelo cliente são obrigatórios em todos os casos.
2. Um **status macro** (Recebido → Em Pré-Impressão → Em Orçamento → Em Aprovação → Aprovado → Em Produção → Faturado, mais Perdido e Cancelado), **derivado** da situação interna e das entidades ligadas, nunca digitado livremente.
3. O **setor responsável** ("com quem está a bola") e o tempo parado nesse setor.
4. **Retornos** explícitos ("devolver para …") com motivo obrigatório e contador de **rodada**. As transições de ida e de volta seguem regras, e o fluxo deixa de ser linear.
5. Uma **linha do tempo única e auditável** do pedido.
6. **Pontos de extensão** (registrar evento e solicitar transição) para os próximos pilares.

O código atual já possui o campo `PedidoProposta.tipoPedido` (`REPETICAO | MOSTRUARIO | NOVO`), o campo `estado` com 8 valores e a tabela `LogPedidoProposta` (`estadoAnterior`/`estadoNovo`/`usuarioId`/`motivo`). A Fundação **estende** esses elementos de forma aditiva e não descarta nenhum deles.

### Base empírica (planilha real de pedidos, 04/11/2026)

A planilha "Formulário sem título (respostas).xlsx" do projeto tem 383 pedidos reais lançados pelos representantes em 2025. Ela mostrou que:

- Não existe coluna de tipo de pedido. "Repetição" aparece em 1,3% dos pedidos, só em texto livre. "Mostruário" não aparece.
- O caminho real é decidido por três fatos que o representante já informa: se já é cliente (267 sim / 116 não), se a faca é nova ou da casa (~50% / ~43%) e quem tem a arte.
- 11,5% dos pedidos citam um cálculo, proposta ou orçamento anterior em texto livre ("Cálculo nº 8745", "igual ao cálculo 14.763, porém menor").
- "Variação de arte" é a quantidade de artes/SKUs no mesmo pedido (26% têm mais de uma), não alteração de arte.

Decisões do usuário (04/11/2026):

- Mesmo sendo Repetição, há aprovação de arte pelo cliente. Nenhum tipo dispensa a pré-impressão.
- Existe cálculo gráfico para todos os casos.
- "Mostruário" é a prova que o cliente aprova antes da tiragem. Não é um tipo de pedido.
- O rótulo único é substituído por perguntas objetivas, e o sistema deriva a classificação.

### Fora de escopo

Os itens abaixo são apenas dependentes desta spec e não são implementados aqui:

- Board da Pré-Impressão (Pilar 3), etapas Mockup/Arte/Padrão/Ficha Técnica/O.S., status configuráveis e SLA por etapa.
- Link de aprovação externa do cliente com código de acesso que expira (item 4 da §20.4).
- Central do Produto v2 (Pilar 2).
- Preparo fiscal e SPED (item 5 da §20.4).
- Migração do histórico do Monday (decisão 04/11: começa do zero no Vizor).
- Novos campos do formulário de lançamento além das Respostas_Pedido (quantidades escalonadas, itens com suas artes e quantidades, concorrente, preço-alvo, anexos no sistema): ficam para a spec do formulário. A Fundação só exige as Respostas_Pedido.

### Escopo de repositórios

O Back (`VisioFab.Wms.Back`) e o Front (`VisioFab.Wms.Front`) são repositórios separados. Os requisitos valem para os dois. O Requisito 12 trata da tela de Pedidos/Propostas do Front.

## Glossary

- **Sistema_Comercial**: o módulo Comercial do Vizor ERP, composto pelo Back (API Fastify/Prisma) e pelo Front (Next.js/Mantine).
- **Pedido**: registro `PedidoProposta` (RFQ) da empresa. É a intenção comercial que percorre o funil.
- **Tipo_Pedido**: classificação do Pedido, DERIVADA das Respostas_Pedido e corrigível pelo comercial. Valores: `REPETICAO`, `ALTERACAO`, `PRODUTO_NOVO`. Define o Caminho_Pre_Impressao.
- **Repeticao**: Tipo_Pedido de produto existente, com faca existente e arte existente sem alteração.
- **Alteracao**: Tipo_Pedido de produto existente com mudança na arte (o "Novo Pedido" da Wega).
- **Produto_Novo**: Tipo_Pedido com faca nova ou arte a criar.
- **Respostas_Pedido**: fatos informados no lançamento do Pedido: Situacao_Cliente, Situacao_Faca, Situacao_Arte, Referencia_Origem e Exige_Prova.
- **Situacao_Cliente**: `NOVO` ou `EXISTENTE` (pergunta "Já é cliente?").
- **Situacao_Faca**: `NOVA`, `EXISTENTE` (com número da matriz) ou `NAO_INFORMADA`.
- **Situacao_Arte**: `CRIAR`, `CLIENTE_ENVIA`, `EXISTENTE_SEM_ALTERACAO`, `EXISTENTE_COM_ALTERACAO` ou `NAO_INFORMADA`.
- **Referencia_Origem**: referência estruturada e pesquisável, opcional, a um cálculo, proposta, OP ou pedido anterior (tipo + número). Substitui as citações em texto livre.
- **Exige_Prova**: indicação de que o cliente precisa aprovar uma prova antes da tiragem. Corresponde ao antigo tipo `MOSTRUARIO` e usa `AprovacaoAmostra`.
- **Caminho_Pre_Impressao**: volume de trabalho da Pré-Impressão, derivado do Tipo_Pedido: `CONFERENCIA` (conferir a arte existente e submetê-la ao cliente), `PARCIAL` (refazer só o que mudou) ou `COMPLETA` (criar arte e faca). Nenhum valor dispensa a Pré-Impressão.
- **Aprovacao_Arte_Cliente**: aprovação da arte pelo cliente, obrigatória em todos os Tipo_Pedido, inclusive Repetição.
- **Calculo_Pedido**: cálculo gráfico/orçamento do Pedido, obrigatório em todos os Tipo_Pedido.
- **Variacao_Arte**: quantidade de artes/SKUs no mesmo Pedido (ex.: "6 artes, 5 mil de cada"). Não indica alteração de arte.
- **Classificacao_A_Confirmar**: sinal de que o Tipo_Pedido foi derivado com Respostas_Pedido incompletas ou convertido de valor legado, e precisa de revisão do comercial.
- **Status_Macro**: situação consolidada do Pedido. Valores: `RECEBIDO`, `EM_PRE_IMPRESSAO`, `EM_ORCAMENTO`, `EM_APROVACAO`, `APROVADO`, `EM_PRODUCAO`, `FATURADO`, `PERDIDO`, `CANCELADO`.
- **Situacao_Interna**: estado granular do Pedido dentro de um Status_Macro. Substitui o antigo `estado` e é a base para derivar o Status_Macro. Cada Situacao_Interna tem um Setor_Responsavel e pertence a exatamente um Status_Macro.
- **Estado_Legado**: um dos 8 valores atuais de `PedidoProposta.estado`: `NOVO`, `EM_ANALISE`, `ENVIADO_ORCAMENTO`, `ORCADO`, `PROPOSTA_ENVIADA`, `ACEITO`, `PERDIDO`, `CANCELADO`.
- **Setor_Responsavel**: setor com quem está a bola. Valores: `PRE_IMPRESSAO`, `ORCAMENTO`, `COMERCIAL`, `REPRESENTANTE`, `CLIENTE`.
- **Responsavel_Desde**: data/hora em que a Situacao_Interna atual passou a vigorar e o Setor_Responsavel passou a ser o atual.
- **Tempo_Parado**: tempo decorrido entre `Responsavel_Desde` e o instante da consulta.
- **Retorno**: ação explícita "devolver para <setor>" que faz o Pedido voltar a um Setor_Responsavel anterior no caminho.
- **Rodada**: contador inteiro do Pedido, iniciado em 1, incrementado a cada Retorno.
- **Motor_Status**: componente do Back que mantém a tabela de Situacao_Interna, Setor_Responsavel e Status_Macro, valida transições e deriva o Status_Macro.
- **Entidade_Ligada**: entidade do funil vinculada ao Pedido: `SolicitacaoOrcamentoRep`, `OrcamentoGrafico`, `AprovacaoAmostra`, `PedidoVenda`, `OrdemProducao`.
- **Linha_do_Tempo**: sequência cronológica, única e auditável, de eventos do Pedido, gravada em `LogPedidoProposta` estendido ou em tabela de eventos sucessora.
- **Evento_Pedido**: registro da Linha_do_Tempo, com tipo, usuário, data/hora, setor de origem, setor de destino, status/situação anterior e nova, e motivo.
- **Servico_Eventos**: interface interna do Back com as operações "registrar evento" e "solicitar transição", exposta aos módulos dependentes (Pré-Impressão e Aprovação externa).
- **Modulo_Dependente**: módulo futuro que consome o Servico_Eventos. Exemplos: Pré-Impressão (Pilar 3) e Aprovação externa do cliente.
- **Permissoes_Comercial**: controle de permissões do Comercial, em `Parametro` com chave `comercial.permissoes.<usuarioId>` (flags como `podeEnviarProposta`, `podeAprovarOrcamento`, `podeConverterPedido`). Perfis `ADMIN` e `SUPER_ADMIN` têm bypass.
- **Migracao_Prod**: script `prisma/migrate-prod.ts`, executado no start do container, idempotente. É o único mecanismo de migração em produção.
- **Tela_Pedidos**: tela de Pedidos/Propostas do Front.
- **Tela_Pipeline**: tela de Pipeline do Comercial do Front.
- **Empresa_Ativa**: `empresaId` da entidade de negócio real, passado explicitamente em toda query.

## Requirements

### Requirement 1: Respostas do lançamento e classificação derivada

**User Story:** Como representante ou comercial, quero informar fatos objetivos do pedido (cliente, faca, arte, referência e prova), para que o sistema classifique o pedido de forma consistente sem que eu precise escolher um rótulo.

#### Acceptance Criteria

1. WHEN um Pedido é criado, THE Sistema_Comercial SHALL registrar as Respostas_Pedido: Situacao_Cliente, Situacao_Faca (com o número da matriz quando `EXISTENTE`), Situacao_Arte, Referencia_Origem opcional e Exige_Prova.
2. IF algum valor das Respostas_Pedido não pertence aos valores permitidos, THEN THE Sistema_Comercial SHALL rejeitar a requisição com HTTP 400 e o código `RESPOSTA_PEDIDO_INVALIDA`, identificando o campo.
3. IF a Situacao_Faca é `EXISTENTE` e o número da matriz não é informado, THEN THE Sistema_Comercial SHALL aceitar o Pedido e exibir ao comercial a pendência "matriz a confirmar".
4. THE Motor_Status SHALL derivar o Tipo_Pedido pela regra, na ordem: (a) Situacao_Faca `NOVA` ou Situacao_Arte `CRIAR` resulta em `PRODUTO_NOVO`; (b) senão, Situacao_Arte `EXISTENTE_COM_ALTERACAO` ou `CLIENTE_ENVIA` resulta em `ALTERACAO`; (c) senão, Situacao_Faca `EXISTENTE` com Situacao_Arte `EXISTENTE_SEM_ALTERACAO` resulta em `REPETICAO`.
5. WHEN a Situacao_Faca ou a Situacao_Arte é `NAO_INFORMADA` e a regra do critério 4 não decide por `PRODUTO_NOVO`, THE Motor_Status SHALL derivar `PRODUTO_NOVO` e marcar o Pedido com Classificacao_A_Confirmar.
6. THE Motor_Status SHALL implementar a derivação do Tipo_Pedido como função pura e determinística, sem Prisma.
7. WHEN o comercial corrige o Tipo_Pedido derivado, THE Sistema_Comercial SHALL exigir motivo de 5 a 500 caracteres, gravar o valor corrigido marcado como manual, remover a Classificacao_A_Confirmar e registrar um Evento_Pedido com o valor derivado, o valor corrigido, o usuário e o motivo.
8. WHILE o Tipo_Pedido está marcado como manual, THE Motor_Status SHALL manter o valor corrigido quando as Respostas_Pedido mudam e SHALL sinalizar divergência ao comercial quando a nova derivação for diferente do valor manual.
9. THE Sistema_Comercial SHALL permitir alterar as Respostas_Pedido e o Tipo_Pedido somente enquanto o Status_Macro for `RECEBIDO`, `EM_PRE_IMPRESSAO` ou `EM_ORCAMENTO`.
10. IF as Respostas_Pedido ou o Tipo_Pedido são alterados fora dos Status_Macro permitidos, THEN THE Sistema_Comercial SHALL rejeitar a requisição com HTTP 409 e o código `TIPO_PEDIDO_BLOQUEADO`.
11. WHEN as Respostas_Pedido de um Pedido são alteradas, THE Sistema_Comercial SHALL registrar um Evento_Pedido com os valores anteriores, os valores novos e o usuário.
12. WHERE a Referencia_Origem é informada, THE Sistema_Comercial SHALL procurar o cálculo (inclusive pelo número do Calcgraf), a proposta, a OP ou o pedido referenciado na mesma Empresa_Ativa e, quando encontrado, gravar o vínculo.
13. IF a Referencia_Origem informada não é encontrada na Empresa_Ativa, THEN THE Sistema_Comercial SHALL aceitar o Pedido, guardar a referência como texto não vinculado e exibir ao comercial o sinal "referência não localizada".
14. THE Sistema_Comercial SHALL permitir pesquisar Pedidos pela Referencia_Origem (tipo e número).
15. THE Sistema_Comercial SHALL tratar a Variacao_Arte como quantidade de artes/SKUs do Pedido, sem efeito sobre o Tipo_Pedido.
16. FOR ALL combinações de Respostas_Pedido válidas, a derivação SHALL produzir exatamente um Tipo_Pedido (propriedade de totalidade).

### Requirement 2: Caminho do pedido definido pela classificação

**User Story:** Como gestor comercial, quero que a classificação do pedido determine quanto trabalho a pré-impressão faz, mantendo o cálculo e a aprovação de arte do cliente obrigatórios em todos os casos.

#### Acceptance Criteria

1. THE Motor_Status SHALL derivar o Caminho_Pre_Impressao a partir do Tipo_Pedido: `REPETICAO` resulta em `CONFERENCIA`, `ALTERACAO` resulta em `PARCIAL` e `PRODUTO_NOVO` resulta em `COMPLETA`.
2. THE Motor_Status SHALL exigir, para todo Pedido de qualquer Tipo_Pedido, a passagem por `EM_PRE_IMPRESSAO` e por `EM_ORCAMENTO` antes de `APROVADO`.
3. THE Motor_Status SHALL permitir que `EM_PRE_IMPRESSAO` e `EM_ORCAMENTO` ocorram em qualquer ordem a partir de `RECEBIDO`, inclusive com idas e voltas entre elas.
4. THE Motor_Status SHALL exigir o Calculo_Pedido concluído antes da transição para `EM_APROVACAO` por envio de proposta.
5. THE Motor_Status SHALL exigir a Aprovacao_Arte_Cliente registrada antes de `APROVADO`, para todo Pedido, inclusive `REPETICAO`.
6. WHERE Exige_Prova é verdadeiro, THE Motor_Status SHALL exigir também a prova aprovada pelo cliente (`AprovacaoAmostra` com status `APROVADA`) antes de `APROVADO`.
7. WHILE o módulo de Aprovação externa não está disponível, THE Sistema_Comercial SHALL permitir ao comercial registrar manualmente a Aprovacao_Arte_Cliente, com data, forma (representante, e-mail ou presencial) e observação, gravada como Evento_Pedido.
8. IF uma transição viola os critérios 2 a 6, THEN THE Motor_Status SHALL rejeitar a transição com HTTP 400 e o código `CAMINHO_TIPO_VIOLADO`, indicando a exigência pendente.
9. WHEN o Tipo_Pedido ou a Exige_Prova de um Pedido é alterado, THE Motor_Status SHALL recalcular o Caminho_Pre_Impressao e as exigências do Pedido e registrar os novos valores na Linha_do_Tempo.
10. IF a alteração do Tipo_Pedido ou da Exige_Prova deixaria o Pedido em Situacao_Interna incompatível com o novo caminho, THEN THE Motor_Status SHALL rejeitar a alteração com HTTP 409 e o código `CAMINHO_INCOMPATIVEL_COM_SITUACAO`.
11. THE Motor_Status SHALL manter a tabela de caminhos e as exigências em módulo de funções puras, sem dependência de Prisma.
12. FOR ALL Pedidos que chegam a `APROVADO`, existem o Calculo_Pedido concluído e a Aprovacao_Arte_Cliente registrada, independentemente do Tipo_Pedido (propriedade de invariante).

### Requirement 3: Status macro derivado

**User Story:** Como gestor comercial, quero um status macro único e confiável para cada pedido, para saber em que fase do funil ele está sem consultar seis telas.

#### Acceptance Criteria

1. THE Motor_Status SHALL expor o Status_Macro de cada Pedido com um dos valores `RECEBIDO`, `EM_PRE_IMPRESSAO`, `EM_ORCAMENTO`, `EM_APROVACAO`, `APROVADO`, `EM_PRODUCAO`, `FATURADO`, `PERDIDO` ou `CANCELADO`.
2. THE Motor_Status SHALL derivar o Status_Macro a partir da Situacao_Interna do Pedido e do estado das Entidades_Ligadas.
3. THE Sistema_Comercial SHALL rejeitar qualquer requisição que tente gravar o Status_Macro diretamente, com HTTP 400 e o código `STATUS_MACRO_NAO_EDITAVEL`.
4. WHEN a Situacao_Interna do Pedido muda, THE Motor_Status SHALL recalcular o Status_Macro na mesma transação.
5. WHEN uma Entidade_Ligada muda de estado de modo que altera o Status_Macro derivado, THE Motor_Status SHALL recalcular o Status_Macro e registrar um Evento_Pedido.
6. WHILE existe `OrdemProducao` ligada ao Pedido em status `EM_PRODUCAO`, THE Motor_Status SHALL manter o Status_Macro em `EM_PRODUCAO`, exceto quando o Pedido estiver `FATURADO`.
7. WHILE o `PedidoVenda` ligado ao Pedido está efetivado e faturado, THE Motor_Status SHALL manter o Status_Macro em `FATURADO`.
8. THE Motor_Status SHALL tratar `PERDIDO` e `CANCELADO` como Status_Macro terminais, sem transições de saída.
9. THE Motor_Status SHALL manter a função de derivação do Status_Macro como função pura, determinística, em que a mesma entrada produz sempre o mesmo resultado.
10. FOR ALL Pedidos, a aplicação da derivação do Status_Macro duas vezes consecutivas sobre os mesmos dados SHALL produzir o mesmo valor (propriedade de idempotência).

### Requirement 4: Mapeamento dos dados atuais para o novo modelo

**User Story:** Como administrador do sistema, quero que todos os pedidos existentes sejam convertidos para o novo modelo sem perda de dado, para que nada quebre na virada.

#### Acceptance Criteria

1. THE Motor_Status SHALL mapear cada Estado_Legado para uma Situacao_Interna e um Status_Macro conforme a tabela: `NOVO` → `RECEBIDO`; `EM_ANALISE` → `EM_PRE_IMPRESSAO`; `ENVIADO_ORCAMENTO` → `EM_ORCAMENTO`; `ORCADO` → `EM_ORCAMENTO`; `PROPOSTA_ENVIADA` → `EM_APROVACAO`; `ACEITO` → `APROVADO`; `PERDIDO` → `PERDIDO`; `CANCELADO` → `CANCELADO`.
2. WHEN o Estado_Legado do Pedido é `ACEITO` e existe `OrdemProducao` ou `PedidoVenda` ligados, THE Motor_Status SHALL derivar `EM_PRODUCAO` ou `FATURADO` conforme as Entidades_Ligadas, em vez de `APROVADO`.
3. THE Migracao_Prod SHALL converter o `tipoPedido` legado assim: `REPETICAO` → `REPETICAO`; `NOVO` → `PRODUTO_NOVO`; `MOSTRUARIO` → `PRODUTO_NOVO` com Exige_Prova verdadeiro; valor nulo → `PRODUTO_NOVO` com Classificacao_A_Confirmar.
4. THE Migracao_Prod SHALL gravar o Tipo_Pedido convertido como valor de origem legada, sem rederivá-lo das Respostas_Pedido, e marcar Classificacao_A_Confirmar quando as Respostas_Pedido estiverem incompletas.
5. THE Migracao_Prod SHALL preencher as Respostas_Pedido dos Pedidos existentes a partir dos dados disponíveis: Situacao_Cliente a partir de `jaCliente`; Situacao_Faca `NOVA` quando o texto de `matriz` indica faca nova, `EXISTENTE` (guardando o texto como número da matriz) quando indica matriz da casa, número ou repetição, e `NAO_INFORMADA` nos demais casos; Situacao_Arte como `NAO_INFORMADA`.
6. THE Migracao_Prod SHALL não aplicar retroativamente as exigências do Requisito 2 (Calculo_Pedido, Aprovacao_Arte_Cliente e prova) a Pedidos que já estão em `EM_APROVACAO` ou em Status_Macro posterior; esses Pedidos mantêm a situação migrada.
7. THE Migracao_Prod SHALL preencher a Situacao_Interna, o Status_Macro, o Setor_Responsavel, o Responsavel_Desde e a Rodada de todos os Pedidos existentes.
8. THE Migracao_Prod SHALL preservar o valor original de `PedidoProposta.estado`, o valor original de `tipoPedido` e todos os campos já existentes do Pedido.
9. THE Migracao_Prod SHALL definir `Rodada` como 1 e `Responsavel_Desde` como a data da última linha de `LogPedidoProposta` do Pedido, ou `criadoEm` quando não houver log.
10. THE Migracao_Prod SHALL converter cada linha existente de `LogPedidoProposta` em Evento_Pedido da Linha_do_Tempo, preservando usuário, data/hora e motivo.
11. THE Migracao_Prod SHALL ser idempotente: a segunda execução sobre o mesmo banco SHALL terminar sem erro, sem duplicar eventos e sem alterar valores já migrados.
12. IF o Pedido já possui Situacao_Interna preenchida, THEN THE Migracao_Prod SHALL ignorar o mapeamento daquele Pedido.
13. IF o Estado_Legado de um Pedido não pertence aos 8 valores conhecidos, THEN THE Migracao_Prod SHALL manter o Pedido em `RECEBIDO` e registrar um aviso no log de execução, sem interromper a migração dos demais Pedidos.
14. FOR ALL Pedidos existentes antes da migração, a contagem de Pedidos por empresa SHALL ser igual antes e depois da migração.

### Requirement 5: Setor responsável ("com quem está a bola")

**User Story:** Como gestor, quero ver com qual setor está cada pedido e há quanto tempo, para cobrar o setor certo e identificar gargalos.

#### Acceptance Criteria

1. THE Motor_Status SHALL associar a cada Situacao_Interna exatamente um Setor_Responsavel dentre `PRE_IMPRESSAO`, `ORCAMENTO`, `COMERCIAL`, `REPRESENTANTE` e `CLIENTE`.
2. THE Sistema_Comercial SHALL armazenar o Setor_Responsavel atual e o Responsavel_Desde de cada Pedido.
3. WHEN a Situacao_Interna do Pedido muda e o Setor_Responsavel muda, THE Sistema_Comercial SHALL atualizar o Responsavel_Desde para o instante da transição.
4. WHEN a Situacao_Interna do Pedido muda e o Setor_Responsavel permanece o mesmo, THE Sistema_Comercial SHALL manter o Responsavel_Desde inalterado.
5. THE Sistema_Comercial SHALL calcular o Tempo_Parado como a diferença entre o instante da consulta e o Responsavel_Desde, expresso em minutos inteiros.
6. WHEN o Status_Macro do Pedido é `FATURADO`, `PERDIDO` ou `CANCELADO`, THE Sistema_Comercial SHALL omitir o Tempo_Parado e retornar o Setor_Responsavel como nulo.
7. WHEN o Setor_Responsavel é alterado por troca explícita de responsável, THE Sistema_Comercial SHALL registrar um Evento_Pedido com o setor de origem, o setor de destino e o usuário.
8. THE Sistema_Comercial SHALL permitir filtrar a listagem de Pedidos por Setor_Responsavel.
9. THE Sistema_Comercial SHALL permitir ordenar a listagem de Pedidos por Tempo_Parado.

### Requirement 6: Transições de ida e de volta

**User Story:** Como comercial, quero que o pedido possa avançar e voltar conforme as regras do negócio, para refletir o que realmente acontece (ajustes, reprovações, novas rodadas).

#### Acceptance Criteria

1. THE Motor_Status SHALL manter uma tabela de transições permitidas entre Situacoes_Internas, na qual cada transição tem uma Situacao_Interna de origem, uma de destino e uma classificação AVANCO ou RETORNO.
2. WHEN um usuário solicita uma transição para um Pedido, THE Motor_Status SHALL aceitá-la somente se, simultaneamente, (a) o par origem/destino constar da tabela, (b) a origem for a Situacao_Interna atual do Pedido, (c) o destino for compatível com o Tipo_Pedido do Pedido e (d) o destino pertencer ao Caminho_Pre_Impressao (CONFERENCIA, PARCIAL ou COMPLETA) derivado desse Tipo_Pedido.
3. IF a transição solicitada não atende a qualquer condição de (a) a (d) do critério 2, incluindo destino igual à Situacao_Interna atual, THEN THE Motor_Status SHALL rejeitar a requisição com HTTP 400 e o código `ESTADO_TRANSICAO_INVALIDA`, mantendo o Pedido inalterado e sem gerar Evento_Pedido.
4. WHEN a transição é aceita, THE Motor_Status SHALL gravar, na mesma transação de banco, a nova Situacao_Interna, o Status_Macro e o Setor_Responsavel (ambos derivados da Situacao_Interna de destino), o Responsavel_Desde (instante da aceitação) e um Evento_Pedido contendo origem, destino, classificação (AVANCO ou RETORNO), usuário solicitante, instante e motivo (quando houver).
5. IF a gravação de qualquer parte da transição falha, THEN THE Motor_Status SHALL desfazer a transação inteira, manter o Pedido na Situacao_Interna anterior, sem Evento_Pedido gravado, e responder com erro de servidor indicando falha na transição.
6. IF um usuário solicita uma transição sobre um Pedido em Status_Macro terminal (PERDIDO ou CANCELADO), THEN THE Motor_Status SHALL rejeitar a requisição com HTTP 409 e o código `PEDIDO_TERMINAL`, mantendo o Pedido inalterado, e essa verificação SHALL ter precedência sobre a do critério 3.
7. WHEN a transição aceita tem destino `PERDIDO` ou `CANCELADO`, THE Motor_Status SHALL exigir um motivo com no mínimo 5 e no máximo 500 caracteres, contados após remover espaços no início e no fim, preservando a regra atual, e gravá-lo no Evento_Pedido.
8. IF o motivo exigido está ausente, é composto só de espaços, tem menos de 5 ou mais de 500 caracteres, THEN THE Motor_Status SHALL rejeitar a requisição com HTTP 400 e o código `MOTIVO_OBRIGATORIO`, mantendo o Pedido inalterado.
9. WHEN uma consulta de transições é feita para um Pedido, THE Motor_Status SHALL retornar duas listas separadas, avanço e retorno, com as Situacoes_Internas de destino permitidas a partir da Situacao_Interna atual, aplicando as mesmas condições (a) a (d) do critério 2, sendo ambas as listas vazias quando o Pedido está em Status_Macro terminal.
10. THE Motor_Status SHALL manter a tabela de transições e a função de validação em módulo de funções puras, sem dependência de Prisma, de acesso a banco, de relógio ou de qualquer outra E/S, retornando sempre o mesmo resultado para a mesma entrada.
11. IF um Pedido não existe ou pertence a outra empresa que não a do usuário solicitante, THEN THE Motor_Status SHALL rejeitar a requisição com HTTP 404, sem revelar a existência do Pedido e sem gravar alterações.
12. IF duas transições são solicitadas ao mesmo tempo para o mesmo Pedido, THEN THE Motor_Status SHALL aceitar no máximo uma delas a partir da Situacao_Interna lida e validar a outra contra a Situacao_Interna já atualizada, rejeitando-a conforme o critério 3 ou 6 quando não for mais válida.
13. FOR ALL Situacoes_Internas não terminais, e para cada Tipo_Pedido e Caminho_Pre_Impressao aplicáveis, existe ao menos uma transição de saída permitida e é possível alcançar ao menos um Status_Macro terminal por uma sequência de transições permitidas (propriedade de ausência de becos sem saída).
14. FOR ALL transições de avanço aceitas pelo Motor_Status, a Situacao_Interna de destino SHALL pertencer ao Caminho_Pre_Impressao do Tipo_Pedido do Pedido (propriedade de invariante).
15. FOR ALL Pedidos e Situacoes_Internas atuais, o conjunto de destinos retornado pelo critério 9 SHALL ser igual ao conjunto de destinos que o critério 2 aceita para esse Pedido, sem considerar o motivo (propriedade de consistência entre consulta e validação).

### Requirement 7: Retornos explícitos e rodadas

**User Story:** Como usuário de um setor, quero devolver o pedido a outro setor informando o motivo, para que o retrabalho fique registrado e contado.

#### Acceptance Criteria

1. THE Sistema_Comercial SHALL oferecer a ação "devolver para <setor>", que recebe o Pedido, o Setor_Responsavel de destino (um entre `PRE_IMPRESSAO`, `ORCAMENTO`, `COMERCIAL`, `REPRESENTANTE`, `CLIENTE`) e o motivo.
2. WHEN um usuário solicita um Retorno, THE Sistema_Comercial SHALL validar o motivo após remover espaços no início e no fim, exigindo entre 5 e 500 caracteres.
3. IF o motivo do Retorno está ausente ou tem menos de 5 caracteres após remover espaços no início e no fim, THEN THE Sistema_Comercial SHALL rejeitar a requisição com HTTP 400 e o código `MOTIVO_OBRIGATORIO`, sem alterar a Rodada, a Situacao_Interna nem a Linha_do_Tempo do Pedido.
4. IF o motivo do Retorno tem mais de 500 caracteres, THEN THE Sistema_Comercial SHALL rejeitar a requisição com HTTP 400 e o código `MOTIVO_OBRIGATORIO`, sem alterar a Rodada, a Situacao_Interna nem a Linha_do_Tempo do Pedido.
5. IF o setor de destino do Retorno não consta da tabela de retornos permitidos a partir da Situacao_Interna atual, ou é igual ao Setor_Responsavel atual, ou não é um dos 5 setores válidos, THEN THE Sistema_Comercial SHALL rejeitar a requisição com HTTP 400 e o código `RETORNO_INVALIDO`, sem alterar a Rodada, a Situacao_Interna nem a Linha_do_Tempo do Pedido.
6. IF um Retorno é solicitado sobre um Pedido em Status_Macro terminal, THEN THE Sistema_Comercial SHALL rejeitar a requisição com HTTP 409 e o código `PEDIDO_TERMINAL`, sem alterar a Rodada, a Situacao_Interna nem a Linha_do_Tempo do Pedido.
7. IF o Pedido informado não existe ou pertence a outra empresa, THEN THE Sistema_Comercial SHALL rejeitar a requisição com HTTP 404, sem revelar a existência do Pedido e sem alterar nenhum dado.
8. WHEN um Retorno é aceito, THE Sistema_Comercial SHALL incrementar a Rodada do Pedido em exatamente 1, na mesma transação que atualiza a Situacao_Interna, o Status_Macro, o Setor_Responsavel e o Responsavel_Desde conforme o setor de destino e registra o Evento_Pedido do item 9.
9. WHEN um Retorno é aceito, THE Sistema_Comercial SHALL registrar exatamente 1 Evento_Pedido do tipo `RETORNO` contendo o setor de origem, o setor de destino, o usuário solicitante, a data/hora do servidor e o motivo (com espaços das extremidades removidos), e SHALL retornar ao solicitante o Pedido atualizado com a nova Rodada.
10. IF a gravação da Rodada, da Situacao_Interna ou do Evento_Pedido falha durante um Retorno, THEN THE Sistema_Comercial SHALL desfazer todas as alterações do Retorno, retornar erro ao solicitante e manter o Pedido e a Linha_do_Tempo exatamente como estavam antes da requisição.
11. WHEN um Pedido novo é criado, THE Sistema_Comercial SHALL definir a Rodada do Pedido como 1.
12. THE Sistema_Comercial SHALL manter a Rodada de um Pedido como inteiro maior ou igual a 1 e maior ou igual ao seu valor anterior em qualquer instante, sem nenhuma operação que a decremente ou a redefina.
13. WHEN dois ou mais usuários solicitam Retornos simultâneos sobre o mesmo Pedido, THE Sistema_Comercial SHALL serializar as operações de modo que cada Retorno seja validado contra a Situacao_Interna resultante do anterior, que a Rodada final seja igual à Rodada inicial mais o número de Retornos aceitos, e que cada Retorno rejeitado por tabela de retornos permitidos, destino igual ao setor atual ou Status_Macro terminal resulte no erro correspondente (`RETORNO_INVALIDO` ou `PEDIDO_TERMINAL`) sem incrementar a Rodada.
14. FOR ALL sequências de transições aceitas, o valor final da Rodada menos 1 SHALL ser igual ao número de eventos do tipo `RETORNO` na Linha_do_Tempo do Pedido (propriedade de invariante).

### Requirement 8: Linha do tempo única e auditável

**User Story:** Como gestor ou auditor, quero uma linha do tempo única de tudo que aconteceu com o pedido, para saber quem fez o quê, quando e por quê.

#### Acceptance Criteria

1. THE Sistema_Comercial SHALL manter uma Linha_do_Tempo por Pedido, com Evento_Pedido em ordem cronológica.
2. THE Sistema_Comercial SHALL gravar um Evento_Pedido para cada mudança de Situacao_Interna, mudança de Status_Macro, Retorno, troca de Setor_Responsavel, mudança de Tipo_Pedido e vínculo ou desvínculo com `OrcamentoGrafico`, `AprovacaoAmostra`, `PedidoVenda` ou `OrdemProducao`.
3. THE Sistema_Comercial SHALL registrar em cada Evento_Pedido o tipo do evento, o usuário (ou a origem do sistema), a data/hora, o setor de origem, o setor de destino, o valor anterior, o valor novo e o motivo quando existir.
4. THE Sistema_Comercial SHALL tratar os Eventos_Pedido como somente-inserção: nenhuma rota SHALL permitir editar ou excluir um Evento_Pedido.
5. WHEN o Pedido é excluído, THE Sistema_Comercial SHALL excluir os Eventos_Pedido em cascata, preservando o comportamento atual de `LogPedidoProposta`.
6. THE Sistema_Comercial SHALL expor `GET` da Linha_do_Tempo de um Pedido, ordenada por data/hora crescente, com paginação.
7. WHEN o usuário solicita a Linha_do_Tempo de um Pedido de outra empresa, THE Sistema_Comercial SHALL responder com HTTP 404.
8. THE Sistema_Comercial SHALL gravar o Evento_Pedido na mesma transação da mudança que o originou.
9. THE Sistema_Comercial SHALL gravar o `empresaId` da entidade de negócio real, e não o da sessão, em cada Evento_Pedido.
10. FOR ALL Pedidos, o último Evento_Pedido de mudança de Situacao_Interna SHALL ter como valor novo a Situacao_Interna atual do Pedido (propriedade de consistência entre o log e o estado).

### Requirement 9: Vínculo com as entidades do funil

**User Story:** Como gestor, quero que o status do pedido acompanhe automaticamente o que acontece no orçamento, na amostra, no pedido de venda e na produção, para não depender de atualização manual.

#### Acceptance Criteria

1. THE Sistema_Comercial SHALL manter, para cada Pedido, o vínculo com as Entidades_Ligadas: `SolicitacaoOrcamentoRep`, `OrcamentoGrafico`, `AprovacaoAmostra`, `PedidoVenda` e `OrdemProducao`.
2. WHEN um `OrcamentoGrafico` é criado a partir do Pedido pelo encaminhamento, THE Sistema_Comercial SHALL transicionar o Pedido para a Situacao_Interna de orçamento em andamento e registrar o vínculo na Linha_do_Tempo.
3. WHEN o `OrcamentoGrafico` ligado ao Pedido é calculado e enviado como proposta, THE Sistema_Comercial SHALL transicionar o Pedido para `EM_APROVACAO`.
4. WHEN o `OrcamentoGrafico` ligado ao Pedido é aprovado, THE Sistema_Comercial SHALL transicionar o Pedido para `APROVADO`.
5. WHEN uma `AprovacaoAmostra` ligada ao Pedido é aberta ou reprovada, THE Sistema_Comercial SHALL manter ou levar o Pedido para `EM_APROVACAO` e registrar o evento na Linha_do_Tempo.
6. WHEN um `PedidoVenda` é gerado a partir do `OrcamentoGrafico` aprovado do Pedido, THE Sistema_Comercial SHALL registrar o vínculo na Linha_do_Tempo.
7. WHEN uma `OrdemProducao` é vinculada ao Pedido, THE Sistema_Comercial SHALL registrar o vínculo na Linha_do_Tempo e recalcular o Status_Macro.
8. WHEN o Pedido tem origem em `SolicitacaoOrcamentoRep` do portal, THE Sistema_Comercial SHALL preencher a origem `REPRESENTANTE` e registrar a Solicitação como Entidade_Ligada.
9. IF a atualização de status disparada por uma Entidade_Ligada falha, THEN THE Sistema_Comercial SHALL manter a operação original da Entidade_Ligada concluída e registrar o erro no log da aplicação, sem lançar exceção ao chamador.
10. THE Sistema_Comercial SHALL manter as regras atuais de cada Entidade_Ligada inalteradas; a Fundação apenas lê o estado delas e solicita transições do Pedido.

### Requirement 10: Pontos de extensão para os próximos pilares

**User Story:** Como desenvolvedor dos próximos pilares, quero uma interface estável para registrar eventos e solicitar transições do pedido, para integrar a Pré-Impressão e a Aprovação externa sem alterar a Fundação.

#### Acceptance Criteria

1. THE Servico_Eventos SHALL expor a operação interna "registrar evento", como função TypeScript invocável por outros módulos do backend, que recebe `empresaId`, o identificador do Pedido, o tipo do evento (texto de 1 a 60 caracteres), a origem (usuário ou módulo, identificada por texto de 1 a 60 caracteres), os dados do evento (objeto serializável com no máximo 64 KB), um motivo opcional (0 a 500 caracteres) e uma chave de idempotência de 1 a 100 caracteres, e que retorna o identificador do Evento_Pedido gravado e um indicador de que a chamada foi reaproveitada ou nova.
2. THE Servico_Eventos SHALL expor a operação interna "solicitar transição", como função TypeScript invocável por outros módulos do backend, que recebe `empresaId`, o identificador do Pedido, a Situacao_Interna ou o setor de destino, a origem (texto de 1 a 60 caracteres), o motivo (0 a 500 caracteres) e uma chave de idempotência de 1 a 100 caracteres, e que retorna a Situacao_Interna resultante, a Rodada vigente e o identificador do Evento_Pedido gerado.
3. WHEN um Modulo_Dependente chama "solicitar transição", THE Servico_Eventos SHALL aplicar as mesmas validações de tabela de transições, caminho do tipo e motivo obrigatório do Motor_Status, e SHALL gravar a mudança de Situacao_Interna e o Evento_Pedido correspondente na mesma operação atômica.
4. WHEN um Modulo_Dependente chama "registrar evento", THE Servico_Eventos SHALL gravar o Evento_Pedido na Linha_do_Tempo com a origem identificada como o módulo chamador, sem alterar a Situacao_Interna nem a Rodada do Pedido.
5. THE Servico_Eventos SHALL aceitar qualquer tipo de evento que atenda ao formato de 1 a 60 caracteres alfanuméricos maiúsculos e sublinhado, de modo que um novo Modulo_Dependente registre um novo tipo sem alteração de schema nem de código do Servico_Eventos.
6. WHEN um Modulo_Dependente chama "solicitar transição" com a intenção "devolver para <setor>", THE Servico_Eventos SHALL incrementar a Rodada do Pedido em exatamente 1, aplicar as validações do Motor_Status e gravar o Evento_Pedido com a origem identificada como o módulo chamador.
7. IF a chamada ao Servico_Eventos refere-se a Pedido inexistente ou pertencente a outra empresa, THEN THE Servico_Eventos SHALL rejeitar a chamada com um erro do tipo "não encontrado", SHALL manter o Pedido e a Linha_do_Tempo inalterados e SHALL tratar os dois casos de forma indistinguível para o chamador.
8. IF a chamada ao Servico_Eventos for inválida (campo obrigatório ausente, tamanho acima do limite, Situacao_Interna ou setor de destino desconhecido, transição não permitida pelo Motor_Status ou motivo obrigatório ausente), THEN THE Servico_Eventos SHALL rejeitar a chamada com um erro de validação que identifica o campo ou a regra violada, SHALL manter o Pedido, a Rodada e a Linha_do_Tempo inalterados e SHALL NOT registrar a chave de idempotência da chamada rejeitada.
9. WHEN o Servico_Eventos recebe uma chamada com chave de idempotência já usada com sucesso para a mesma `empresaId` e a mesma operação, THE Servico_Eventos SHALL retornar o resultado da primeira execução, sem gravar outro Evento_Pedido e sem incrementar a Rodada novamente, e SHALL manter a chave válida por no mínimo 24 horas.
10. IF o Servico_Eventos recebe uma chave de idempotência já usada com `empresaId`, Pedido ou parâmetros diferentes dos da primeira chamada, THEN THE Servico_Eventos SHALL rejeitar a chamada com um erro de conflito de idempotência e SHALL manter o estado do Pedido inalterado.
11. WHEN duas chamadas concorrentes chegam com a mesma chave de idempotência e a mesma `empresaId`, THE Servico_Eventos SHALL executar a operação uma única vez e SHALL devolver o mesmo resultado às duas chamadas.
12. THE Servico_Eventos SHALL documentar, no comentário de cabeçalho do módulo, os contratos de entrada e saída das duas operações, os erros possíveis e quais Situacoes_Internas a Pré-Impressão e a Aprovação externa usarão.
13. THE Sistema_Comercial SHALL reservar as Situacoes_Internas `EM_PRE_IMPRESSAO` e `EM_APROVACAO` para acionamento pelos Modulos_Dependentes via Servico_Eventos, sem implementar o board de Pré-Impressão, as etapas Mockup/Arte/Padrão/Ficha nem o link do cliente.
14. WHEN a Aprovação externa registra "Pedir ajuste" do cliente, THE Servico_Eventos SHALL aceitar a solicitação de retorno para `PRE_IMPRESSAO` com motivo obrigatório de 1 a 500 caracteres e SHALL abrir exatamente uma nova Rodada.

### Requirement 11: Isolamento multi-tenant

**User Story:** Como responsável pela segurança, quero que nenhum dado de status, evento ou transição vaze entre empresas, para manter o isolamento do ERP multi-empresa.

#### Acceptance Criteria

1. THE Sistema_Comercial SHALL incluir o `empresaId` explicitamente no `where` de toda query Prisma sobre Pedido, Evento_Pedido e Entidades_Ligadas feita pelo Motor_Status e pelo Servico_Eventos.
2. THE Sistema_Comercial SHALL manter o isolamento por `empresaId` explícito mesmo quando a rota usa `request.prismaScoped`, porque o perfil `SUPER_ADMIN` contorna o isolamento automático.
3. WHEN o Sistema_Comercial grava um Evento_Pedido, uma transição ou um vínculo, THE Sistema_Comercial SHALL usar o `empresaId` do Pedido real.
4. IF o usuário acessa um Pedido, uma Linha_do_Tempo ou uma transição de outra empresa, THEN THE Sistema_Comercial SHALL responder com HTTP 404.
5. WHEN o Motor_Status lê uma Entidade_Ligada para derivar o Status_Macro, THE Motor_Status SHALL filtrar a leitura pelo `empresaId` do Pedido.
6. THE Migracao_Prod SHALL aplicar a migração dos dados por empresa, usando o `empresa_id` de cada registro, sem cruzar dados entre empresas.
7. FOR ALL consultas de listagem de Pedidos com filtro de Status_Macro, Setor_Responsavel ou Tempo_Parado, o resultado SHALL conter somente Pedidos da Empresa_Ativa (propriedade de invariante).

### Requirement 12: Permissões das transições sensíveis

**User Story:** Como administrador, quero que transições sensíveis respeitem as permissões do Comercial, para que só quem pode envie proposta, aprove ou devolva pedidos.

#### Acceptance Criteria

1. WHEN uma transição tem destino `EM_APROVACAO` por envio de proposta, THE Sistema_Comercial SHALL exigir a permissão `podeEnviarProposta`.
2. WHEN uma transição tem destino `APROVADO`, THE Sistema_Comercial SHALL exigir a permissão `podeAprovarOrcamento`.
3. WHEN uma transição leva o Pedido para `EM_PRODUCAO` ou vincula `PedidoVenda`, THE Sistema_Comercial SHALL exigir a permissão `podeConverterPedido`.
4. WHEN uma transição tem destino `PERDIDO`, `CANCELADO`, ou é um Retorno, THE Sistema_Comercial SHALL exigir a permissão `podeVerComercial` e um usuário autenticado.
5. THE Sistema_Comercial SHALL consultar as permissões em `Parametro` com a chave `comercial.permissoes.<usuarioId>` para a Empresa_Ativa.
6. WHERE o perfil do usuário é `ADMIN` ou `SUPER_ADMIN`, THE Sistema_Comercial SHALL liberar a transição sem consultar as flags.
7. IF o usuário não possui a permissão exigida, THEN THE Sistema_Comercial SHALL rejeitar a requisição com HTTP 403 e o código `PERMISSAO_NEGADA`, sem gravar nada.
8. WHEN uma transição é solicitada por um Modulo_Dependente com origem de sistema (sem usuário), THE Servico_Eventos SHALL dispensar a verificação de permissão do usuário e exigir que o módulo chamador seja interno ao Back.
9. WHERE o `Parametro` de permissões do usuário não existe, THE Sistema_Comercial SHALL aplicar o default de tudo liberado, preservando a não-regressão.

### Requirement 13: Não-regressão e compatibilidade

**User Story:** Como usuário atual do módulo, quero que as telas e rotas de hoje continuem funcionando durante e depois da mudança, para não perder produtividade.

#### Acceptance Criteria

1. THE Sistema_Comercial SHALL manter as rotas atuais de `PedidoProposta` (criar, atualizar, obter, listar, transicionar, encaminhar, anexos) respondendo com os campos que respondem hoje, acrescidos dos campos novos de forma aditiva.
2. THE Sistema_Comercial SHALL manter o campo `PedidoProposta.estado` preenchido e coerente com a Situacao_Interna, mapeada para o Estado_Legado equivalente, enquanto houver consumidor do campo.
3. WHEN uma rota atual de transição recebe um Estado_Legado de destino, THE Sistema_Comercial SHALL traduzir o pedido para a transição equivalente do Motor_Status e aplicar as mesmas validações.
4. IF o Estado_Legado de destino não tem equivalente permitido para o Pedido, THEN THE Sistema_Comercial SHALL rejeitar a requisição com HTTP 400 e o código `ESTADO_TRANSICAO_INVALIDA`, como hoje.
5. THE Sistema_Comercial SHALL manter o funcionamento da Tela_Pedidos e da Tela_Pipeline sem exigir ação do usuário após a migração.
6. WHEN o Front antigo, sem os campos novos, consome a API, THE Sistema_Comercial SHALL responder normalmente.
7. THE Sistema_Comercial SHALL manter o comportamento atual de criação de `OrcamentoGrafico` a partir do Pedido (encaminhamento), incluindo a transferência da imagem da faca e dos anexos.
8. THE Sistema_Comercial SHALL cobrir com testes de regressão as transições do modelo linear atual, de modo que cada transição válida de hoje continue válida quando o Caminho_Pre_Impressao permitir.
9. FOR ALL Pedidos existentes, a listagem na Tela_Pipeline antes e depois da migração SHALL conter os mesmos Pedidos, cada um em uma coluna que corresponda ao seu Estado_Legado.
10. WHEN a rota atual de criação recebe o `tipoPedido` legado (`NOVO`, `REPETICAO` ou `MOSTRUARIO`) sem Respostas_Pedido, como faz hoje o portal do representante, THE Sistema_Comercial SHALL aceitar a requisição, converter o valor conforme o Requisito 4 e marcar o Pedido com Classificacao_A_Confirmar.

### Requirement 14: Mudança de schema e migração de produção

**User Story:** Como responsável pelo deploy, quero que o schema e a migração de produção evoluam juntos e de forma idempotente, para que o Render/Neon nunca fique dessincronizado.

#### Acceptance Criteria

1. THE Sistema_Comercial SHALL alterar `prisma/schema.prisma` e `prisma/migrate-prod.ts` no mesmo commit.
2. THE Migracao_Prod SHALL criar as colunas novas com `ADD COLUMN IF NOT EXISTS` e as tabelas novas com `CREATE TABLE IF NOT EXISTS`.
3. THE Migracao_Prod SHALL criar os índices novos com `CREATE INDEX IF NOT EXISTS`.
4. THE Migracao_Prod SHALL criar as chaves estrangeiras novas dentro de `try/catch` individual, porque o Postgres não oferece `ADD CONSTRAINT IF NOT EXISTS`.
5. THE Sistema_Comercial SHALL criar as novas colunas de `PedidoProposta` como opcionais ou com valor padrão, de modo que as linhas existentes continuem válidas durante a migração.
6. THE Migracao_Prod SHALL executar a migração de dados do Requisito 4 depois da criação das colunas e tabelas, na mesma execução de start.
7. THE Migracao_Prod SHALL não executar `DROP COLUMN` nem `DROP TABLE` sobre `estado` ou `log_pedido_proposta` nesta spec.
8. WHEN `npx tsx prisma/migrate-prod.ts` é executado duas vezes seguidas, THE Migracao_Prod SHALL concluir a segunda execução sem erro.
9. THE Sistema_Comercial SHALL executar `prisma generate` depois da alteração do schema, e o build SHALL passar sem novos erros de tipo em relação à baseline documentada.

### Requirement 15: Exibição no Front (Tela de Pedidos/Propostas)

**User Story:** Como usuário do comercial, quero ver na tela de Pedidos/Propostas o status macro, o responsável, o tempo parado, a rodada e a linha do tempo, para acompanhar o pedido sem sair da tela.

#### Acceptance Criteria

1. THE Tela_Pedidos SHALL exibir, para cada Pedido da listagem, o Status_Macro, o Setor_Responsavel, o Tempo_Parado, a Rodada e o Tipo_Pedido.
2. THE Tela_Pedidos SHALL exibir o Status_Macro como selo de cor, com legenda textual, sem depender só da cor para transmitir o significado.
3. THE Tela_Pedidos SHALL formatar o Tempo_Parado em unidade legível (minutos, horas ou dias).
4. THE Tela_Pedidos SHALL oferecer filtros por Status_Macro, Setor_Responsavel e Tipo_Pedido, e ordenação por Tempo_Parado.
5. WHEN o usuário abre o detalhe de um Pedido, THE Tela_Pedidos SHALL exibir a Linha_do_Tempo com tipo do evento, usuário, data/hora, setor de origem, setor de destino e motivo.
6. THE Tela_Pedidos SHALL oferecer a ação "Devolver para…" com seleção do setor de destino e campo de motivo obrigatório, e SHALL exibir a mensagem de erro do Back quando a ação for rejeitada.
7. THE Tela_Pedidos SHALL listar apenas as ações de transição permitidas informadas pelo Back para o Pedido.
8. WHEN o usuário não possui a permissão de uma ação, THE Tela_Pedidos SHALL ocultar ou desabilitar o botão da ação, usando as permissões do próprio usuário.
9. THE Tela_Pipeline SHALL continuar exibindo os Pedidos, usando o Status_Macro como critério de agrupamento em colunas, sem perder nenhum Pedido.
10. WHERE a resposta da API não traz os campos novos, THE Tela_Pedidos SHALL exibir os dados legados sem erro.
11. THE Tela_Pedidos SHALL permitir operar os controles (filtros, ação "Devolver", Linha_do_Tempo) por teclado e expor rótulos acessíveis nos controles.
12. THE Tela_Pedidos SHALL exibir as Respostas_Pedido e os sinais Classificacao_A_Confirmar, "matriz a confirmar" e "referência não localizada", e SHALL oferecer a correção do Tipo_Pedido com motivo e o registro manual da Aprovacao_Arte_Cliente.

### Requirement 16: Qualidade e verificabilidade

**User Story:** Como desenvolvedor, quero que a lógica de status seja testável de forma isolada, para evitar regressões silenciosas.

#### Acceptance Criteria

1. THE Motor_Status SHALL implementar a derivação do Status_Macro, a tabela de transições, a tabela de caminhos por tipo e o mapeamento de Estado_Legado como funções puras, sem Prisma.
2. THE Sistema_Comercial SHALL cobrir o Motor_Status com testes unitários e testes baseados em propriedades (Vitest e fast-check).
3. THE Sistema_Comercial SHALL incluir testes de propriedades para: idempotência da derivação do Status_Macro; ausência de becos sem saída; invariante `Rodada - 1 = número de Retornos`; invariante de que o último evento de situação reflete o estado atual; invariante de caminho por Tipo_Pedido; totalidade da derivação do Tipo_Pedido; invariante de que nenhum Pedido chega a `APROVADO` sem Calculo_Pedido e Aprovacao_Arte_Cliente.
4. THE Sistema_Comercial SHALL incluir um teste de mapeamento que verifique que cada um dos 8 Estado_Legado resulta em Situacao_Interna e Status_Macro definidos.
5. THE Sistema_Comercial SHALL incluir testes de integração com mocks de Prisma para o isolamento por `empresaId` do Servico_Eventos e das rotas de transição, retorno e Linha_do_Tempo.
6. THE Sistema_Comercial SHALL tratar o teste de idempotência da Migracao_Prod como teste de fumaça (executar duas vezes), e não como teste de propriedade, por ser configuração e infraestrutura.
