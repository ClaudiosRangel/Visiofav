# Requirements Document

## Introduction

O **Financeiro Vizor** é o módulo de controle financeiro do próprio SaaS Vizor
ERP (VisioFab), ou seja, a cobrança recorrente das empresas clientes que
contratam o sistema. Não confunde com o módulo FINANCEIRO que as empresas
usam internamente (contas a pagar/receber delas): este módulo é o *billing do
SaaS*, exclusivo do dono do Vizor (perfil SUPER_ADMIN).

O acesso se dá por um item de menu "Financeiro Vizor" na tela de seleção de
empresa (ao lado de "Meus Dados"), visível somente ao SUPER_ADMIN. A partir
dele, o dono do Vizor lista todas as empresas cadastradas com o status
financeiro de cada uma, abre o detalhe de cobrança de uma empresa (contrato,
preços por módulo, dia de vencimento, total a receber), gera vencimentos
mensais em lote, dá baixa em pagamentos e conduz o ciclo de inadimplência
(alerta aos 10 dias, modo somente-leitura aos 30 dias, inativação manual).

O modo somente-leitura é enforçado transversalmente em todos os módulos
operacionais da empresa devedora por um guard central no backend, que bloqueia
operações de escrita (POST/PUT/PATCH/DELETE) e libera consultas (GET).

Decisões de negócio tomadas na fase de levantamento (registradas para
rastreabilidade):

- Preço por módulo é **negociado por empresa** (cada empresa tem sua própria
  tabela de preços por módulo). — Req 3
- O estágio do ciclo de inadimplência é determinado pela **fatura vencida mais
  antiga** (maior atraso). — Req 6
- A reativação após o bloqueio de 30 dias é **manual pelo SUPER_ADMIN**, mesmo
  após o pagamento (a baixa registra o pagamento; o desbloqueio é uma ação
  explícita). — Req 8
- A detecção de avanço de estágio é feita por um **job diário** que recalcula o
  status financeiro de todas as empresas. — Req 6
- O modo somente-leitura bloqueia **toda escrita (POST/PUT/PATCH/DELETE)** e
  libera GET. — Req 7
- Autenticação, seleção de empresa, logout, o módulo Financeiro Vizor
  (SUPER_ADMIN), endpoints de perfil/troca de senha do próprio usuário e
  marcação de notificações como lidas ficam sempre liberados, mesmo em
  somente-leitura. — Req 7
- Geração de vencimentos: N faturas mensais no dia configurado, a partir de um
  mês/competência inicial escolhido (default próximo mês); valor de cada fatura
  = total dos módulos na data da geração; sem duplicar competências já
  existentes; se o dia não existir no mês, usa o último dia do mês. — Req 5
- Alertas aparecem como modal/banner ao logar + notificação no sino (reusando o
  módulo de notificação existente). — Req 6
- Novo campo dedicado `statusFinanceiro` na Empresa (enum), preservando o
  campo `status` boolean existente. — Req 2

## Glossary

- **Financeiro_Vizor**: Módulo de billing do SaaS Vizor. Controla a cobrança
  das empresas clientes pelo uso do sistema. Exclusivo do SUPER_ADMIN.
- **SUPER_ADMIN**: Perfil do dono do Vizor, com acesso a todas as empresas e ao
  módulo Financeiro_Vizor.
- **Administrador_Empresa**: Usuário de perfil ADMIN vinculado a uma empresa
  cliente; destinatário dos alertas e notificações de cobrança.
- **Empresa**: Empresa cliente que contrata o Vizor (model existente `Empresa`).
- **Status_Financeiro**: Estado de cobrança da empresa perante o Vizor. Valores:
  `ATIVO`, `SOMENTE_LEITURA`, `INATIVADO`. Campo dedicado na `Empresa`, distinto
  do campo `status` boolean já existente.
- **Modulo_Contratado**: Módulo do ERP contratado por uma empresa. Conjunto
  fixo: `COMPRAS`, `VENDAS`, `FINANCEIRO`, `FISCAL`, `WMS`, `PCP`.
- **Contrato_Cobranca**: Configuração de cobrança de uma empresa: data do
  contrato, dia de vencimento e preços por módulo contratado.
- **Preco_Modulo**: Valor mensal negociado de um `Modulo_Contratado` para uma
  empresa específica.
- **Total_Mensal**: Soma dos `Preco_Modulo` de todos os módulos contratados por
  uma empresa.
- **Fatura**: Vencimento mensal gerado para uma empresa. Possui competência
  (mês/ano de referência), data de vencimento, valor, status e data de
  pagamento. Status: `PENDENTE`, `PAGA`, `VENCIDA`, `CANCELADA`.
- **Competencia**: Mês/ano de referência de uma `Fatura` (ex.: 2026-03).
- **Dia_Vencimento**: Dia do mês (1 a 31) em que as faturas da empresa vencem.
- **Dias_Em_Atraso**: Número de dias corridos desde a data de vencimento da
  `Fatura` vencida mais antiga não paga até a data atual.
- **Baixa_Pagamento**: Operação manual do SUPER_ADMIN que marca uma `Fatura`
  como `PAGA` e registra a data de pagamento.
- **Guard_Somente_Leitura**: Mecanismo central do backend que, quando a empresa
  está em `SOMENTE_LEITURA`, bloqueia requisições de escrita
  (POST/PUT/PATCH/DELETE) aos módulos operacionais e libera consultas (GET).
- **Job_Recalculo_Financeiro**: Rotina agendada diária que recalcula
  `Dias_Em_Atraso` e o `Status_Financeiro` de todas as empresas.
- **Alerta_Cobranca**: Aviso exibido ao `Administrador_Empresa` ao logar
  (modal/banner) e registrado como notificação, referente a fatura vencida.

## Requirements

### Requirement 1: Acesso exclusivo ao módulo Financeiro Vizor

**User Story:** Como SUPER_ADMIN (dono do Vizor), quero um menu "Financeiro
Vizor" na tela de seleção de empresa, para acessar o controle de cobrança das
empresas clientes.

#### Acceptance Criteria

1. WHERE o usuário autenticado tem perfil SUPER_ADMIN, THE Financeiro_Vizor SHALL exibir o item de menu com o rótulo "Financeiro Vizor" na tela de seleção de empresa.
2. WHERE o usuário autenticado não tem perfil SUPER_ADMIN, THE Financeiro_Vizor SHALL ocultar o item de menu "Financeiro Vizor", de modo que ele não fique visível nem acionável na tela de seleção de empresa.
3. IF uma requisição a qualquer endpoint do Financeiro_Vizor é feita por usuário sem perfil SUPER_ADMIN, THEN THE Financeiro_Vizor SHALL negar o acesso, não retornar nenhum dado de cobrança no corpo da resposta e indicar ao chamador que o acesso foi negado por falta de autorização.
4. WHEN um endpoint do Financeiro_Vizor retorna dados de cobrança para um SUPER_ADMIN, THE Financeiro_Vizor SHALL restringir o conteúdo retornado exclusivamente às empresas informadas na requisição do SUPER_ADMIN.
5. IF uma requisição a um endpoint do Financeiro_Vizor não possui sessão autenticada com perfil SUPER_ADMIN válido no momento da requisição, THEN THE Financeiro_Vizor SHALL negar o acesso e não retornar dados de cobrança, sem depender do estado anterior da sessão.

### Requirement 2: Listagem de empresas com status financeiro

**User Story:** Como SUPER_ADMIN, quero listar todas as empresas cadastradas com
o respectivo status de uso, para acompanhar a situação de cobrança de cada uma.

#### Acceptance Criteria

1. WHEN o SUPER_ADMIN abre o Financeiro_Vizor, THE Financeiro_Vizor SHALL listar todas as empresas cadastradas, ordenadas pelo nome da empresa em ordem alfabética crescente.
2. IF não existe nenhuma empresa cadastrada, THEN THE Financeiro_Vizor SHALL retornar uma listagem vazia sem erro.
3. THE Financeiro_Vizor SHALL exibir para cada empresa o Status_Financeiro correspondente, com exatamente um dos valores `ATIVO`, `SOMENTE_LEITURA` ou `INATIVADO`.
4. THE Financeiro_Vizor SHALL exibir para cada empresa o Total_Mensal e o valor total vencido em aberto, ambos como valores monetários não negativos com duas casas decimais.
5. THE Financeiro_Vizor SHALL calcular o valor total vencido em aberto de cada empresa como a soma dos valores das Faturas com status `PENDENTE` ou `VENCIDA` cuja data de vencimento é anterior à data atual.
6. THE Empresa SHALL persistir o Status_Financeiro em campo dedicado, mantendo o campo `status` boolean existente inalterado.
7. WHERE uma empresa ainda não possui Contrato_Cobranca configurado, THE Financeiro_Vizor SHALL exibir a empresa na listagem com Status_Financeiro `ATIVO` e Total_Mensal igual a zero.
8. WHEN uma nova Empresa é cadastrada sem Contrato_Cobranca, THE Financeiro_Vizor SHALL definir o Status_Financeiro inicial como `ATIVO`.

### Requirement 3: Configuração de contrato e preços por módulo

**User Story:** Como SUPER_ADMIN, quero configurar o contrato de cobrança de uma
empresa com preços negociados por módulo, para definir quanto cada empresa paga.

#### Acceptance Criteria

1. WHEN o SUPER_ADMIN abre o detalhe de uma empresa, THE Financeiro_Vizor SHALL exibir a data do contrato, o Dia_Vencimento e o Preco_Modulo de cada um dos seis Modulo_Contratado do conjunto `COMPRAS`, `VENDAS`, `FINANCEIRO`, `FISCAL`, `WMS`, `PCP`, exibindo Preco_Modulo igual a zero para os módulos ainda não precificados.
2. THE Financeiro_Vizor SHALL permitir ao SUPER_ADMIN definir um Preco_Modulo específico por empresa para cada Modulo_Contratado do conjunto `COMPRAS`, `VENDAS`, `FINANCEIRO`, `FISCAL`, `WMS`, `PCP`, aceitando valor monetário de 0,00 a 999.999.999,99 com no máximo 2 casas decimais.
3. THE Financeiro_Vizor SHALL calcular o Total_Mensal como a soma dos Preco_Modulo de todos os Modulo_Contratado cujo Preco_Modulo definido seja maior que zero, resultando em zero quando nenhum módulo possui Preco_Modulo maior que zero.
4. WHEN o SUPER_ADMIN informa o Dia_Vencimento com valor inteiro entre 1 e 31, THE Financeiro_Vizor SHALL aceitar e persistir o valor informado.
5. IF o SUPER_ADMIN informa um Dia_Vencimento não inteiro ou fora do intervalo de 1 a 31, THEN THE Financeiro_Vizor SHALL rejeitar a operação, preservar o Dia_Vencimento anterior e retornar mensagem de erro indicando que o dia de vencimento deve ser um inteiro entre 1 e 31.
6. IF o SUPER_ADMIN informa um Preco_Modulo negativo ou com valor acima de 999.999.999,99, THEN THE Financeiro_Vizor SHALL rejeitar a operação, preservar os Preco_Modulo previamente configurados da empresa e retornar mensagem de erro indicando o intervalo permitido de valor.
7. WHEN o SUPER_ADMIN informa a data do contrato com valor de data válido não posterior à data atual, THE Financeiro_Vizor SHALL registrar a data do contrato informada.
8. IF o SUPER_ADMIN informa uma data do contrato inválida ou posterior à data atual, THEN THE Financeiro_Vizor SHALL rejeitar a operação, preservar a data do contrato anterior e retornar mensagem de erro indicando que a data do contrato deve ser uma data válida não futura.

### Requirement 4: Detalhe de cobrança da empresa

**User Story:** Como SUPER_ADMIN, quero abrir uma tela de detalhe ao clicar numa
empresa, para ver o resumo de cobrança e as faturas geradas.

#### Acceptance Criteria

1. WHEN o SUPER_ADMIN seleciona uma empresa na listagem, THE Financeiro_Vizor SHALL exibir, em até 3 segundos, a tela de detalhe contendo o Preco_Modulo de cada Modulo_Contratado, o Total_Mensal, o Dia_Vencimento e a data do contrato da empresa selecionada.
2. WHEN a tela de detalhe é aberta, THE Financeiro_Vizor SHALL exibir a lista de Faturas da empresa ordenada pela competência da mais recente para a mais antiga, apresentando para cada fatura a competência, a data de vencimento, o valor, o status e a data de pagamento.
3. IF a empresa selecionada não possui nenhuma Fatura, THEN THE Financeiro_Vizor SHALL exibir a tela de detalhe com a lista de Faturas vazia e uma indicação de que não há faturas geradas.
4. WHEN a tela de detalhe é aberta, THE Financeiro_Vizor SHALL exibir o total vencido em aberto, calculado como a soma dos valores das Faturas com status diferente de pago cuja data de vencimento é anterior à data atual, e o Dias_Em_Atraso da fatura vencida em aberto de data de vencimento mais antiga, calculado como o número inteiro de dias entre essa data de vencimento e a data atual.
5. IF a empresa selecionada não possui nenhuma Fatura vencida em aberto, THEN THE Financeiro_Vizor SHALL exibir o total vencido em aberto igual a zero e nenhum valor de Dias_Em_Atraso.
6. THE Financeiro_Vizor SHALL restringir todos os dados de cobrança exibidos na tela de detalhe à empresa selecionada, sem incluir dados de qualquer outra empresa.
7. IF o usuário autenticado não possui o perfil SUPER_ADMIN, THEN THE Financeiro_Vizor SHALL negar o acesso à tela de detalhe de cobrança e não exibir nenhum dado de cobrança.

### Requirement 5: Geração de vencimentos em lote

**User Story:** Como SUPER_ADMIN, quero gerar N vencimentos mensais a partir de
um botão "Gerar vencimentos", para criar as faturas recorrentes de uma empresa.

#### Acceptance Criteria

1. WHEN o SUPER_ADMIN aciona "Gerar vencimentos" informando um número de meses N entre 1 e 60, THE Financeiro_Vizor SHALL criar as Faturas mensais consecutivas para as competências ainda não existentes e retornar a quantidade de Faturas efetivamente criadas.
2. THE Financeiro_Vizor SHALL definir a data de vencimento de cada Fatura no Dia_Vencimento configurado da empresa, no mês correspondente à Competencia.
3. IF o Dia_Vencimento não existe no mês da Competencia, THEN THE Financeiro_Vizor SHALL usar o último dia daquele mês como data de vencimento.
4. THE Financeiro_Vizor SHALL definir o valor de cada Fatura gerada igual ao Total_Mensal calculado na data da geração.
5. IF o Total_Mensal da empresa é menor ou igual a zero no momento da geração, THEN THE Financeiro_Vizor SHALL rejeitar a operação, não criar nenhuma Fatura e retornar mensagem indicando que a empresa não possui preços de módulo configurados.
6. WHEN o SUPER_ADMIN não informa a Competencia inicial, THE Financeiro_Vizor SHALL iniciar a geração no mês seguinte ao mês corrente.
7. WHERE o SUPER_ADMIN informa uma Competencia inicial, THE Financeiro_Vizor SHALL iniciar a geração a partir dessa Competencia.
8. IF já existe uma Fatura não cancelada para uma Competencia dentro do intervalo solicitado, THEN THE Financeiro_Vizor SHALL não criar Fatura duplicada para essa Competencia e informar a lista de competências ignoradas identificadas por mês e ano.
9. WHEN uma Fatura é gerada, THE Financeiro_Vizor SHALL definir o status inicial como `PENDENTE`.
10. IF o número de meses N informado é menor que 1 ou maior que 60, THEN THE Financeiro_Vizor SHALL rejeitar a operação, não criar nenhuma Fatura e retornar mensagem de erro indicando o intervalo permitido.
11. IF a operação de geração é solicitada por usuário sem perfil SUPER_ADMIN, THEN THE Financeiro_Vizor SHALL negar o acesso e não criar nenhuma Fatura.

### Requirement 6: Ciclo de inadimplência — alerta e bloqueio

**User Story:** Como dono do Vizor, quero que o sistema alerte e depois bloqueie
automaticamente empresas inadimplentes, para incentivar o pagamento sem
intervenção manual constante.

#### Acceptance Criteria

1. THE Job_Recalculo_Financeiro SHALL executar uma vez por dia, dentro da janela entre 00:00 e 00:59, recalculando o Dias_Em_Atraso e o Status_Financeiro de todas as empresas em no máximo 10 minutos de execução.
2. IF a execução do Job_Recalculo_Financeiro falha, THEN THE Financeiro_Vizor SHALL preservar o Status_Financeiro vigente de todas as empresas e registrar a ocorrência da falha.
3. THE Financeiro_Vizor SHALL calcular o Dias_Em_Atraso de uma empresa como o número inteiro de dias corridos entre a data de vencimento da Fatura vencida mais antiga com status `PENDENTE` ou `VENCIDA` e a data atual, definindo o Dias_Em_Atraso como zero quando não houver Fatura nessa condição.
4. WHEN a data de vencimento de uma Fatura `PENDENTE` é ultrapassada, THE Financeiro_Vizor SHALL alterar o status dessa Fatura para `VENCIDA`.
5. WHILE o Dias_Em_Atraso de uma empresa `ATIVO` está entre 10 e 29 dias corridos, THE Financeiro_Vizor SHALL manter o Status_Financeiro `ATIVO` e sinalizar a empresa para exibição de Alerta_Cobranca.
6. WHEN o Dias_Em_Atraso de uma empresa atinge 10 dias corridos, THE Financeiro_Vizor SHALL enviar notificação ao Administrador_Empresa solicitando a quitação da fatura vencida para evitar bloqueio.
7. WHEN o Dias_Em_Atraso de uma empresa atinge 30 dias corridos, THE Financeiro_Vizor SHALL alterar o Status_Financeiro para `SOMENTE_LEITURA`.
8. WHILE uma empresa está em `SOMENTE_LEITURA`, THE Financeiro_Vizor SHALL enviar notificação ao Administrador_Empresa informando o modo somente-visualização e a necessidade de pagamento para retomar a operação.
9. WHILE uma empresa possui fatura vencida com Dias_Em_Atraso maior ou igual a 10 dias corridos, THE Financeiro_Vizor SHALL exibir um Alerta_Cobranca ao Administrador_Empresa ao logar, como modal/banner, e registrar a notificação correspondente no módulo de notificação.
10. THE Financeiro_Vizor SHALL enviar cada tipo de notificação de cobrança e exibir o Alerta_Cobranca no máximo uma vez por dia por empresa.
11. WHEN o Dias_Em_Atraso de uma empresa em `ATIVO` retorna a zero após quitação das faturas vencidas, THE Financeiro_Vizor SHALL manter o Status_Financeiro `ATIVO` e cessar a sinalização de Alerta_Cobranca.
12. WHERE uma empresa está com Status_Financeiro `INATIVADO`, THE Job_Recalculo_Financeiro SHALL manter o Status_Financeiro `INATIVADO` e não alterá-lo com base em Dias_Em_Atraso.

### Requirement 7: Enforcement do modo somente-leitura

**User Story:** Como dono do Vizor, quero que empresas em somente-leitura fiquem
impedidas de criar ou alterar dados nos módulos, para pressionar a
regularização sem apagar o acesso de consulta.

#### Acceptance Criteria

1. WHILE uma empresa está em `SOMENTE_LEITURA`, THE Guard_Somente_Leitura SHALL bloquear toda requisição cujo método HTTP seja POST, PUT, PATCH ou DELETE dirigida a qualquer endpoint dos Modulo_Contratado `COMPRAS`, `VENDAS`, `FINANCEIRO`, `FISCAL`, `WMS` ou `PCP`, não persistir nenhuma alteração de dados decorrente dessa requisição, e responder com HTTP 403.
2. WHILE uma empresa está em `SOMENTE_LEITURA`, THE Guard_Somente_Leitura SHALL permitir requisições cujo método HTTP seja GET aos endpoints dos Modulo_Contratado `COMPRAS`, `VENDAS`, `FINANCEIRO`, `FISCAL`, `WMS` e `PCP`, retornando os dados sem alteração de estado.
3. THE Guard_Somente_Leitura SHALL permitir, para qualquer valor de Status_Financeiro, as requisições de autenticação (login), seleção de empresa, logout, os endpoints do módulo Financeiro_Vizor, os endpoints de leitura e atualização de perfil e de troca de senha do próprio usuário autenticado, e a marcação de notificações como lidas, independentemente do método HTTP dessas requisições.
4. WHILE uma empresa está em `ATIVO`, THE Guard_Somente_Leitura SHALL permitir requisições de qualquer método HTTP (incluindo GET, POST, PUT, PATCH e DELETE) aos endpoints dos Modulo_Contratado `COMPRAS`, `VENDAS`, `FINANCEIRO`, `FISCAL`, `WMS` e `PCP`.
5. WHEN o Guard_Somente_Leitura bloqueia uma requisição de escrita, THE Guard_Somente_Leitura SHALL responder com HTTP 403, indicar ao chamador no corpo da resposta uma mensagem informando que a empresa está em modo somente-visualização por pendência financeira, e não retornar nenhum dado de negócio do módulo alvo.
6. WHEN o Status_Financeiro de uma empresa é alterado para `SOMENTE_LEITURA` ou de `SOMENTE_LEITURA` para `ATIVO`, THE Guard_Somente_Leitura SHALL aplicar o novo comportamento de bloqueio ou liberação a partir da requisição seguinte ao efetivo registro do novo Status_Financeiro.

### Requirement 8: Baixa de pagamento e reativação

**User Story:** Como SUPER_ADMIN, quero dar baixa em faturas pagas e reativar
manualmente empresas bloqueadas, para controlar quando a operação normal
retorna.

#### Acceptance Criteria

1. WHEN o SUPER_ADMIN dá Baixa_Pagamento em uma Fatura com status `PENDENTE` ou `VENCIDA`, THE Financeiro_Vizor SHALL alterar o status dessa Fatura para `PAGA` e registrar a data de pagamento com a data atual.
2. IF a Baixa_Pagamento é solicitada por usuário sem perfil SUPER_ADMIN, THEN THE Financeiro_Vizor SHALL negar o acesso, não alterar o status nem a data de pagamento da Fatura e indicar ao chamador que o acesso foi negado por falta de autorização.
3. IF o SUPER_ADMIN tenta dar Baixa_Pagamento em uma Fatura já `PAGA` ou `CANCELADA`, THEN THE Financeiro_Vizor SHALL rejeitar a operação, preservar o status e a data de pagamento atuais da Fatura e retornar mensagem de erro indicando que só é possível dar baixa em Fatura `PENDENTE` ou `VENCIDA`.
4. IF a Fatura informada na Baixa_Pagamento não existe ou não pertence à empresa informada, THEN THE Financeiro_Vizor SHALL rejeitar a operação, não alterar nenhuma Fatura e retornar mensagem de erro indicando que a Fatura não foi encontrada.
5. WHEN uma Baixa_Pagamento é registrada, THE Financeiro_Vizor SHALL recalcular o Dias_Em_Atraso da empresa a partir da data de vencimento da Fatura vencida mais antiga com status `PENDENTE` ou `VENCIDA`, definindo o Dias_Em_Atraso como zero quando não restar nenhuma Fatura nessa condição.
6. WHILE uma empresa está em `SOMENTE_LEITURA`, THE Financeiro_Vizor SHALL manter o Status_Financeiro `SOMENTE_LEITURA` após uma Baixa_Pagamento até que o SUPER_ADMIN reative a empresa manualmente, independentemente do Dias_Em_Atraso resultante.
7. WHEN o SUPER_ADMIN reativa manualmente uma empresa com Status_Financeiro `SOMENTE_LEITURA`, THE Financeiro_Vizor SHALL alterar o Status_Financeiro para `ATIVO`.
8. IF a reativação manual é solicitada por usuário sem perfil SUPER_ADMIN, THEN THE Financeiro_Vizor SHALL negar o acesso, preservar o Status_Financeiro atual da empresa e indicar ao chamador que o acesso foi negado por falta de autorização.
9. WHEN o SUPER_ADMIN cancela uma Fatura com status `PENDENTE` ou `VENCIDA`, THE Financeiro_Vizor SHALL alterar o status dessa Fatura para `CANCELADA`.
10. IF o SUPER_ADMIN tenta cancelar uma Fatura já `PAGA` ou `CANCELADA`, THEN THE Financeiro_Vizor SHALL rejeitar a operação, preservar o status atual da Fatura e retornar mensagem de erro indicando que só é possível cancelar Fatura `PENDENTE` ou `VENCIDA`.

### Requirement 9: Inativação manual da empresa

**User Story:** Como SUPER_ADMIN, quero inativar manualmente uma empresa, para
impedir totalmente o acesso aos módulos quando decidir encerrar o atendimento.

#### Acceptance Criteria

1. WHEN o SUPER_ADMIN inativa manualmente uma empresa cujo Status_Financeiro é `ATIVO` ou `SOMENTE_LEITURA`, THE Financeiro_Vizor SHALL alterar o Status_Financeiro para `INATIVADO`.
2. WHILE uma empresa está em `INATIVADO`, THE Guard_Somente_Leitura SHALL bloquear as requisições de consulta e de escrita (GET, POST, PUT, PATCH, DELETE) aos módulos operacionais e responder com HTTP 403.
3. WHILE uma empresa está em `INATIVADO`, THE Guard_Somente_Leitura SHALL permitir, independentemente do Status_Financeiro, as operações de autenticação, seleção de empresa, logout, os endpoints do módulo Financeiro_Vizor, os endpoints de perfil e troca de senha do próprio usuário e a marcação de notificações como lidas.
4. WHEN o SUPER_ADMIN reativa uma empresa cujo Status_Financeiro é `INATIVADO`, THE Financeiro_Vizor SHALL alterar o Status_Financeiro para `ATIVO`.
5. WHEN o Status_Financeiro de uma empresa é alterado para `INATIVADO` por ação manual, THE Financeiro_Vizor SHALL registrar o identificador do usuário SUPER_ADMIN que executou a inativação e a data e hora da inativação.
6. WHEN o Status_Financeiro de uma empresa é alterado de `INATIVADO` para `ATIVO` por ação manual, THE Financeiro_Vizor SHALL registrar o identificador do usuário SUPER_ADMIN que executou a reativação e a data e hora da reativação.
7. WHEN o Guard_Somente_Leitura bloqueia uma requisição a uma empresa em `INATIVADO`, THE Guard_Somente_Leitura SHALL retornar mensagem informando que a empresa está inativada e o acesso aos módulos está impedido.
8. IF uma operação de inativação ou de reativação é solicitada por usuário sem perfil SUPER_ADMIN, THEN THE Financeiro_Vizor SHALL negar o acesso, não alterar o Status_Financeiro da empresa e indicar ao chamador que o acesso foi negado por falta de autorização.

### Requirement 10: Isolamento e segurança dos dados de cobrança

**User Story:** Como dono do Vizor, quero garantir que os dados de cobrança de
uma empresa nunca vazem para administradores de outra empresa, para preservar a
confidencialidade comercial.

#### Acceptance Criteria

1. THE Financeiro_Vizor SHALL permitir operações de leitura e de escrita sobre Contrato_Cobranca, Preco_Modulo e Fatura exclusivamente para requisições autenticadas cujo perfil seja SUPER_ADMIN.
2. IF uma requisição com perfil diferente de SUPER_ADMIN solicita a leitura de Contrato_Cobranca, Preco_Modulo ou Fatura de qualquer empresa, THEN THE Financeiro_Vizor SHALL rejeitar a operação, não retornar nenhum campo desses registros e responder com uma indicação de acesso negado.
3. IF uma requisição com perfil diferente de SUPER_ADMIN solicita a criação, alteração ou exclusão de Contrato_Cobranca, Preco_Modulo ou Fatura, THEN THE Financeiro_Vizor SHALL rejeitar a operação, não persistir nenhuma alteração nos dados e responder com uma indicação de acesso negado.
4. WHEN o Financeiro_Vizor envia um Alerta_Cobranca a um Administrador_Empresa, THE Financeiro_Vizor SHALL incluir somente dados cujo `empresaId` seja igual ao `empresaId` da empresa do usuário destinatário e SHALL omitir qualquer dado de cobrança associado a `empresaId` diferente.
5. THE Financeiro_Vizor SHALL associar cada Contrato_Cobranca e cada Fatura a exatamente um `empresaId`, não nulo, correspondente à empresa titular do registro.
6. WHEN o Financeiro_Vizor recebe uma requisição de leitura ou escrita sobre Contrato_Cobranca, Preco_Modulo ou Fatura, THE Financeiro_Vizor SHALL restringir o conjunto de registros acessíveis àqueles cujo `empresaId` corresponde à empresa da sessão autenticada.
