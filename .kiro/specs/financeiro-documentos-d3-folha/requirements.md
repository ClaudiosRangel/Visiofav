# Requirements Document

Central de Documentos Financeiros — Fase D3 (Folha de Pagamento)

## Introduction

A Fase D3 do programa Central de Documentos Financeiros adiciona ao Vizor ERP o
**lançamento financeiro do resultado da folha de pagamento**. O Vizor **não é um
software de cálculo de folha** (não calcula INSS/IRRF/FGTS/férias/rescisão) — esse
cálculo é feito por um sistema de folha/contabilidade externo (ou pelo contador).
O que o Vizor faz é **receber o resultado consolidado da folha de um período** e
transformá-lo em títulos financeiros (contas a pagar), com rastreabilidade por
funcionário e por encargo, respeitando o padrão de mercado (Totvs/Sankhya/Omie:
"integração de folha" que gera o contas a pagar do RH).

Para isso, a D3 também **enriquece o cadastro de funcionário** com os dados
trabalhistas mínimos (CPF, cargo, admissão, salário base, dados bancários),
mantendo o cadastro operacional de WMS existente intacto (extensão, não reescrita).

Uma **folha de pagamento** no Vizor é um lote mensal (competência) que agrupa:
- o **líquido a pagar de cada funcionário** (1 título por funcionário);
- as **guias de encargos** do período (INSS, FGTS, IRRF e outras), como títulos
  próprios com beneficiário órgão (União/Caixa) e vencimento legal.

O lançamento pode ser feito **manualmente** (o usuário digita os valores por
funcionário e os encargos) ou **por importação** (CSV/planilha vinda do sistema de
folha). Como toda operação financeira sensível do Vizor, a **efetivação** (geração
dos títulos no contas a pagar) exige **confirmação humana explícita** e é
**idempotente** por competência (não duplica títulos se reprocessada).

Esta fase estende o motor de inclusão de títulos da D1 (`incluirTitulo`) e reusa a
classificação por categoria/centro de custo já existente. Não há emissão fiscal
envolvida. Segue as regras do projeto: migração idempotente no mesmo commit,
isolamento multi-tenant por `empresaId`.

## Glossary

- **Folha (FolhaPagamento)**: lote de um período de competência (mês/ano) que
  consolida líquidos por funcionário e encargos, com status de ciclo de vida.
- **Competência**: mês/ano de referência da folha (ex.: 09/2026), distinto da data
  de pagamento/vencimento.
- **Item de folha (ItemFolha)**: uma linha da folha referente a um funcionário —
  guarda proventos, descontos e o líquido a pagar daquele funcionário no período.
- **Encargo (EncargoFolha)**: uma guia/obrigação do período paga a um órgão
  (INSS, FGTS, IRRF, contribuição sindical, etc.), com beneficiário e vencimento.
- **Líquido a pagar**: valor efetivamente creditado ao funcionário (proventos −
  descontos). É o valor do título de contas a pagar do funcionário.
- **Efetivação da folha**: ação que gera os títulos de contas a pagar (1 por
  funcionário + 1 por encargo) a partir da folha, marcando-a como efetivada.
- **Funcionário enriquecido**: o cadastro `Funcionario` acrescido de dados
  trabalhistas (CPF, cargo, data de admissão, salário base, dados bancários),
  preservando os campos operacionais de WMS já existentes.
- **incluirTitulo**: serviço da Fase D1 que cria contas a pagar/receber (com
  parcelas, categoria, parceiro), reusado aqui para materializar os títulos.

## Requirements

### Requirement 1: Enriquecimento do cadastro de funcionário

**User Story:** Como responsável pelo RH/financeiro, quero registrar os dados
trabalhistas do funcionário, para que a folha possa ser lançada e paga com
rastreabilidade e dados bancários corretos.

#### Acceptance Criteria

1. WHEN o usuário edita um funcionário THEN o sistema SHALL permitir informar CPF,
   cargo, data de admissão, salário base, e dados bancários (banco, agência, conta,
   tipo de conta ou chave PIX), todos opcionais e sem quebrar o cadastro
   operacional de WMS existente.
2. IF um CPF for informado THEN o sistema SHALL validar o dígito verificador e
   rejeitar CPF inválido, reusando a validação da Fase D1.
3. WHEN dois funcionários da mesma empresa recebem o mesmo CPF THEN o sistema SHALL
   rejeitar a duplicidade dentro da empresa (não impede CPFs iguais entre empresas
   distintas — multi-tenant).
4. WHERE os novos campos não são preenchidos THE sistema SHALL manter o
   funcionário utilizável normalmente no WMS (nenhum campo novo é obrigatório para
   o fluxo operacional).

### Requirement 2: Criação e composição da folha de um período

**User Story:** Como usuário do financeiro, quero criar a folha de uma competência
e lançar o líquido de cada funcionário e os encargos, para consolidar o resultado
do período antes de gerar os pagamentos.

#### Acceptance Criteria

1. WHEN o usuário cria uma folha THEN o sistema SHALL exigir a competência
   (mês/ano) e SHALL impedir a criação de uma segunda folha ABERTA para a mesma
   competência na mesma empresa.
2. WHEN o usuário adiciona um item de folha THEN o sistema SHALL registrar o
   funcionário, os proventos, os descontos e SHALL calcular o líquido como
   proventos − descontos, rejeitando líquido negativo.
3. WHEN o usuário adiciona um encargo THEN o sistema SHALL registrar o tipo
   (INSS, FGTS, IRRF, OUTRO), o valor, o beneficiário (nome/órgão) e a data de
   vencimento.
4. WHERE a folha está ABERTA THE sistema SHALL permitir adicionar, editar e
   remover itens e encargos; WHERE a folha está EFETIVADA THE sistema SHALL
   bloquear qualquer alteração de itens/encargos.
5. WHEN o usuário consulta a folha THEN o sistema SHALL apresentar o total de
   líquidos, o total de encargos e o total geral do período.

### Requirement 3: Importação do resultado da folha (CSV)

**User Story:** Como usuário do financeiro, quero importar o resultado da folha a
partir de uma planilha do sistema de folha, para não digitar funcionário por
funcionário.

#### Acceptance Criteria

1. WHEN o usuário importa um CSV de folha THEN o sistema SHALL interpretar as
   colunas de identificação do funcionário (CPF ou matrícula), proventos, descontos
   e líquido, e SHALL vincular cada linha a um funcionário cadastrado.
2. IF uma linha não corresponder a nenhum funcionário cadastrado THEN o sistema
   SHALL reportar a linha como pendente sem interromper a importação das demais.
3. WHEN o CSV informa líquido explicitamente E também proventos/descontos THEN o
   sistema SHALL usar o líquido informado e SHALL sinalizar divergência se
   proventos − descontos não bater com o líquido além de uma tolerância de R$ 0,01.
4. WHERE o CSV está malformado ou vazio THE sistema SHALL rejeitar a importação
   com mensagem explicando o formato esperado, sem criar folha parcial.

### Requirement 4: Efetivação da folha em contas a pagar

**User Story:** Como usuário do financeiro, quero efetivar a folha, para gerar
automaticamente os pagamentos dos funcionários e das guias no contas a pagar.

#### Acceptance Criteria

1. WHEN o usuário efetiva uma folha ABERTA THEN o sistema SHALL exigir confirmação
   explícita antes de gerar qualquer título.
2. WHEN a folha é efetivada THEN o sistema SHALL criar, via `incluirTitulo` (D1),
   um título de contas a pagar por item de funcionário (com o líquido, vencimento
   do pagamento e categoria de folha) e um título por encargo (com beneficiário e
   vencimento legal), todos vinculados à folha para rastreabilidade.
3. IF a folha já foi efetivada THEN o sistema SHALL recusar nova efetivação e NÃO
   SHALL criar títulos duplicados (idempotência por folha).
4. WHERE a efetivação falha no meio do processo THE sistema SHALL não deixar a
   folha parcialmente efetivada (transação atômica: ou gera todos os títulos e
   marca EFETIVADA, ou não gera nenhum e mantém ABERTA).
5. WHEN a folha é efetivada THEN o sistema SHALL registrar a competência na
   descrição dos títulos gerados, permitindo identificá-los como oriundos da folha.

### Requirement 5: Isolamento multi-tenant e integridade

**User Story:** Como administrador, quero garantir que folhas e funcionários de uma
empresa nunca sejam vistos ou alterados por outra, para preservar a segurança
multi-tenant do ERP.

#### Acceptance Criteria

1. WHEN qualquer operação de folha (criar, listar, consultar, efetivar) é
   executada THEN o sistema SHALL filtrar por `empresaId` da sessão e SHALL impedir
   acesso a folhas de outra empresa mesmo com id/uuid conhecido.
2. WHEN os títulos são gerados na efetivação THEN o sistema SHALL gravar o
   `empresaId` da folha (não simplesmente o do usuário que clicou), de forma
   consistente com o padrão do projeto para entidades de negócio.
3. WHEN o schema é alterado THEN a migração equivalente idempotente SHALL ser
   incluída no `migrate-prod.ts` no mesmo commit.

### Requirement 6: Lançamento de folha assistido pela Vizor AI

**User Story:** Como usuário, quero pedir à Vizor AI para lançar/consultar a folha
por linguagem natural, para agilizar a operação mantendo a confirmação humana.

#### Acceptance Criteria

1. WHEN o usuário pede à IA para lançar uma folha (por texto ou upload de planilha)
   THEN a IA SHALL resumir os totais (nº de funcionários, total líquido, total de
   encargos, competência) e SHALL pedir confirmação antes de efetivar.
2. WHEN o usuário confirma THEN a IA SHALL efetivar a folha através da mesma rota/
   serviço usado pela tela, sem duplicar títulos (idempotência preservada).
3. IF não houver folha ou funcionários compatíveis THEN a IA SHALL informar
   claramente o que falta em vez de criar registros vazios.
