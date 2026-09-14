# Requirements Document

## Introduction

Este documento define os requisitos para alterar a forma como a **data de validade**
é validada na conferência de entrada do WMS. Atualmente, a validade digitada pelo
conferente é comparada com a validade declarada na NF-e (`ItemNotaEntrada.validade`,
extraída do bloco `<rastro><dVal>` do XML), e qualquer diferença gera divergência e
segunda conferência obrigatória. Como a validade da NF-e é frequentemente ausente ou
incorreta, essa comparação produz divergências falsas e não protege contra o risco
real (produto vencido ou com validade curta).

A mudança troca o critério de validação: a validade passa a ser avaliada
**exclusivamente** contra referências objetivas do produto físico — **não vencido**
(validade não pode ser menor ou igual à data atual) e **shelf life mínimo**
(`Produto.shelfLifeMinimo`). A regra é idêntica nos três canais de conferência
(individual, em lote e por código de barras/coletor), e a conferência cega reforça
o comportamento ao ocultar a validade da NF-e, forçando a leitura do produto.

Os requisitos abaixo foram derivados do documento de design
(`design.md`, workflow design-first).

## Glossary

- **Validade digitada**: data de validade informada pelo conferente, lida do produto físico.
- **Validade da NF-e**: `ItemNotaEntrada.validade`, capturada do XML da nota (pode ser nula/incorreta).
- **Shelf life mínimo**: `Produto.shelfLifeMinimo`, número mínimo de dias de validade exigidos no recebimento.
- **Produto vencido**: item cuja validade digitada é menor ou igual à data atual.
- **exigeLote**: flag `Produto.exigeLote` que torna lote e validade obrigatórios na conferência.
- **Conferência cega de lote**: `Empresa.conferenciaLoteCega`, oculta lote/validade da NF-e na tela.
- **Canais de conferência**: `POST /conferir-item` (individual), `POST /conferir-todos/:notaId` (lote), `POST /conferir-por-barras/:notaId` (coletor/app).

## Requirements

### Requirement 1: Validação de validade contra produto vencido e shelf life

**User Story:** Como conferente de recebimento, quero que a validade que eu informo
seja avaliada contra o vencimento e o shelf life mínimo do produto, para que produtos
vencidos ou com validade curta sejam bloqueados no recebimento.

#### Acceptance Criteria

1. WHEN a validade digitada é menor ou igual à data atual THEN o sistema SHALL bloquear a conferência do item com o código `PRODUTO_VENCIDO`, independentemente do valor de `shelfLifeMinimo`.
2. WHEN a validade digitada é maior que a data atual AND os dias restantes até a validade são menores que `shelfLifeMinimo` THEN o sistema SHALL bloquear a conferência do item com o código `SHELF_LIFE`.
3. WHEN a validade digitada é maior que a data atual AND os dias restantes são maiores ou iguais a `shelfLifeMinimo` (ou `shelfLifeMinimo` é nulo) THEN o sistema SHALL aprovar a validade do item.
4. WHEN a comparação de datas é feita THEN o sistema SHALL considerar apenas ano, mês e dia, ignorando a componente de horário.
5. WHERE a conferência é individual (`/conferir-item`) ou por código de barras (`/conferir-por-barras/:notaId`) IF a validade for reprovada THEN o sistema SHALL responder HTTP 422 com `message`, `bloqueio` (`PRODUTO_VENCIDO` ou `SHELF_LIFE`) e, para `SHELF_LIFE`, também `diasRestantes` e `dataMinima`.
6. WHERE a conferência é em lote (`/conferir-todos/:notaId`) IF a validade de um item for reprovada THEN o sistema SHALL incluir o item na lista `falhasShelfLife` da resposta, com mensagem que distingue produto vencido de shelf life insuficiente, sem interromper o processamento dos demais itens.

### Requirement 2: Remoção da divergência de validade contra a NF-e

**User Story:** Como gestor de recebimento, quero que a validade do produto não seja
mais comparada com a validade declarada na NF-e, para que divergências falsas deixem
de gerar segunda conferência desnecessária.

#### Acceptance Criteria

1. WHEN a primeira conferência em lote (`/conferir-todos/:notaId`) processa um item THEN o sistema SHALL NOT comparar a validade digitada com `ItemNotaEntrada.validade` para fins de divergência.
2. WHEN a primeira conferência processa um item THEN o sistema SHALL NOT gerar o tipo de divergência `VALIDADE_DIVERGENTE` nem marcar o item como pendente de segunda conferência por causa da validade.
3. WHEN um item é submetido à segunda conferência (`/segunda-conferencia/:notaId`) THEN o sistema SHALL avaliar a auto-resolução com base apenas em quantidade e lote, SHALL NOT reavaliar a validade contra a NF-e.
4. WHEN a validade é reinformada na segunda conferência THEN o sistema SHALL aplicar a mesma validação de produto vencido e shelf life definida no Requirement 1.
5. WHERE existem registros históricos de `DivergenciaConferencia` do tipo `VALIDADE_DIVERGENTE` ou `PendenciaCce` do tipo `VALIDADE` THEN o sistema SHALL continuar processando-os normalmente, preservando a retrocompatibilidade.
6. IF for necessário evoluir a estrutura de dados de divergência de validade THEN o sistema SHALL permitir a alteração de schema apenas acompanhada de migração idempotente que preserve o processamento dos registros existentes, conforme o processo obrigatório de migrations do projeto.

### Requirement 3: Comportamento uniforme entre canais e persistência da validade do produto

**User Story:** Como conferente usando coletor ou digitação manual, quero que a regra
de validade seja idêntica em qualquer canal e que a validade que eu li do produto seja
a que fica registrada no estoque, para garantir consistência e um FEFO confiável.

#### Acceptance Criteria

1. WHEN a validade digitada é nula THEN o sistema SHALL considerar a validação de validade aprovada, delegando a obrigatoriedade à regra de `exigeLote`.
2. WHERE o produto tem `exigeLote` igual a verdadeiro IF lote ou validade não forem informados THEN o sistema SHALL marcar o item como divergente com `LOTE_NAO_INFORMADO` ou `VALIDADE_NAO_INFORMADA`, conforme o campo ausente.
3. WHEN qualquer um dos três canais de conferência valida a validade THEN o sistema SHALL aplicar exatamente a mesma lógica (produto vencido seguido de shelf life), produzindo resultado idêntico para a mesma entrada.
4. WHEN um item é conferido sem reprovação de validade THEN o sistema SHALL persistir em `ItemNotaEntrada.validade` a validade digitada, com fallback para o valor da NF-e apenas quando nenhuma validade for digitada.
5. WHEN o item conferido é endereçado THEN o sistema SHALL gravar em `SaldoEndereco.validade` a validade persistida do item (originada do produto).
6. WHEN a validação de validade é executada THEN o sistema SHALL manter o isolamento multi-tenant já existente, consultando `Produto` filtrado por `empresaId`, sem introduzir leitura de dados de outra empresa.
7. IF o isolamento multi-tenant não puder ser garantido durante a validação THEN o sistema SHALL bloquear a validação por completo, sem prosseguir com a conferência do item.

### Requirement 4: Conferência cega alimentando a validação pelo produto

**User Story:** Como gestor de qualidade, quero que a conferência cega oculte a validade
da NF-e e force a leitura do produto, para que a validade registrada reflita o item físico.

#### Acceptance Criteria

1. WHILE a empresa está com `conferenciaLoteCega` ativa WHEN a tela de conferência é montada THEN o sistema SHALL ocultar lote e validade da NF-e dos itens retornados.
2. WHERE a conferência cega está ativa THEN o sistema SHALL manter a mesma validação de produto vencido e shelf life do Requirement 1, sem depender da validade da NF-e.
3. WHEN a conferência cega está inativa THEN o sistema SHALL exibir a validade da NF-e apenas como referência visual, sem usá-la como critério de bloqueio ou divergência.
4. IF o mecanismo de validação de validade estiver indisponível ou desabilitado durante a conferência cega THEN o sistema SHALL tratar a falha de forma controlada, sem interromper abruptamente a conferência nem registrar validade como aprovada silenciosamente.

### Requirement 5: Ajuste do frontend acoplado ao tipo de divergência de validade

**User Story:** Como usuário do sistema, quero que a interface reflita a nova regra de
validade, para não ver indicadores de divergência que não ocorrem mais.

#### Acceptance Criteria

1. WHEN o painel de segunda conferência é exibido THEN o sistema SHALL NOT depender do tipo `VALIDADE_DIVERGENTE` para renderizar indicadores de divergência de validade.
2. WHEN a tela de resultado da conferência exibe falhas de validade THEN o sistema SHALL continuar consumindo o campo `falhasShelfLife` da resposta, exibindo mensagens que distinguem produto vencido de shelf life insuficiente.
3. WHERE existia indicação visual específica de `VALIDADE_DIVERGENTE` THEN o sistema SHALL remover ou neutralizar essa indicação sem quebrar a renderização das demais divergências (quantidade e lote).
