# Requirements Document

Financeiro Operacional Completo (Bloco F1) — Vizor ERP

## Introduction

Este spec cobre o **Bloco F1** da Frente Atual do roadmap
(`.kiro/steering/erp-roadmap.md`): transformar o Financeiro do Vizor de básico
(contas a pagar/receber + geração de parcelas na efetivação) em um **financeiro
operacional robusto**, no nível de Omie/Totvs/Sankhya, que:

- capta automaticamente os títulos originados de **Vendas (NF-e)**, **Compras**
  e **CT-e** (frete, já emitindo em produção);
- permite **lançamentos manuais de caixa**;
- controla **múltiplas contas bancárias** com saldo;
- faz **conciliação bancária** (importação de extrato) e **fechamentos**;
- classifica receitas/despesas por **plano de contas gerencial** e **centro de
  custo**, base para **DRE gerencial**, **fluxo de caixa** e alimentação futura
  do **SPED Contábil (F5)**.

O trabalho **estende** o que já existe (`ContaReceber`, `ContaPagar`,
`conta-receber.routes.ts`, integração `venda-fiscal.service.ts`), sem reescrever
a base. Segue os padrões do projeto: migração idempotente no mesmo commit
(`.kiro/steering/database-migrations.md`), isolamento multi-tenant
(`.kiro/steering/ATENCAO-pontos-verificar.md`), Zod, Fastify, Prisma.

### Fora de escopo (outros blocos)
- Boleto/CNAB/PIX/régua de cobrança → **F3**.
- Reforma Tributária → **F4**.
- Geração de SPED Fiscal/Contábil → **F5** (F1 apenas prepara os dados).
- NF-e ponta a ponta em todos os cenários de venda → **F2** (F1 consome os
  títulos gerados).

---

## Glossary

- **Título**: uma conta a receber ou a pagar (obrigação financeira com valor e vencimento).
- **Baixa**: ato de registrar o recebimento/pagamento de um título.
- **Conciliação**: casar linha de extrato bancário com título/lançamento do sistema.
- **DRE gerencial**: demonstrativo de resultado por categoria/competência (visão gerencial, não a ECF fiscal).
- **Aging**: relatório de títulos em aberto agrupados por faixa de atraso.
- **Competência**: mês de referência de um lançamento/fechamento.
- **CT-e**: Conhecimento de Transporte eletrônico (modelo 57), já emitido em produção; o valor do frete (`vPrest`) origina conta a receber.

## Requirements

### Requisito 1 — Contas bancárias (multi-conta)

**User Story:** Como responsável financeiro, quero cadastrar e gerir múltiplas
contas bancárias e caixa, para acompanhar o saldo de cada uma separadamente.

#### Acceptance Criteria
1. QUANDO o usuário cadastra uma conta financeira ENTÃO o sistema DEVE persistir tipo (`CAIXA` | `BANCO` | `APLICACAO`), nome, banco/agência/conta (opcionais para caixa) e saldo inicial, isolados por `empresaId`.
2. QUANDO uma conta é criada ENTÃO o saldo atual DEVE iniciar igual ao saldo inicial.
3. QUANDO existe movimento vinculado a uma conta ENTÃO o sistema NÃO DEVE permitir excluí-la (apenas inativar).
4. QUANDO o usuário lista contas ENTÃO o sistema DEVE retornar o saldo atual calculado (saldo inicial + entradas − saídas conciliadas/baixadas) por conta.
5. QUANDO o usuário registra uma transferência entre duas contas ENTÃO o sistema DEVE debitar a origem e creditar o destino atomicamente, sem gerar receita/despesa no resultado.

### Requisito 2 — Plano de contas gerencial e centro de custo

**User Story:** Como gestor, quero classificar cada título/lançamento por
categoria (plano de contas) e centro de custo, para analisar o resultado por
natureza e por área.

#### Acceptance Criteria
1. QUANDO o usuário cadastra uma categoria ENTÃO o sistema DEVE aceitar tipo (`RECEITA` | `DESPESA`), nome, código e categoria-pai opcional (hierarquia), isolados por `empresaId`.
2. QUANDO o usuário cadastra um centro de custo ENTÃO o sistema DEVE persistir nome/código e status, isolados por `empresaId`.
3. QUANDO um título ou lançamento é criado ENTÃO o sistema DEVE permitir associar categoria e centro de custo (opcionais na criação manual, exigíveis por configuração).
4. QUANDO um lançamento é rateado ENTÃO o sistema DEVE permitir dividir o valor entre múltiplos centros de custo, com a soma das partes igual ao valor total (tolerância 0,01).

### Requisito 3 — Lançamentos manuais de caixa

**User Story:** Como operador do financeiro, quero registrar entradas e saídas
manuais de caixa (não originadas de venda/compra), para refletir o movimento
real.

#### Acceptance Criteria
1. QUANDO o usuário cria um lançamento manual ENTÃO o sistema DEVE exigir conta financeira, tipo (`ENTRADA` | `SAIDA`), valor positivo, data e descrição.
2. QUANDO um lançamento manual é confirmado ENTÃO o sistema DEVE atualizar o saldo da conta correspondente.
3. QUANDO o usuário estorna um lançamento ENTÃO o sistema DEVE reverter o efeito no saldo, mantendo o registro original para auditoria.
4. QUANDO o valor informado é ≤ 0 ENTÃO o sistema DEVE rejeitar com mensagem de campo/motivo (HTTP 422), sem persistir.

### Requisito 4 — Captação automática de Vendas, Compras e CT-e

**User Story:** Como gestor, quero que os títulos de venda, compra e frete
sejam criados automaticamente no financeiro, para não redigitar.

#### Acceptance Criteria
1. QUANDO uma venda é efetivada (NF-e autorizada) ENTÃO o sistema DEVE gerar conta(s) a receber conforme as condições de pagamento, vinculadas ao cliente e ao documento fiscal (comportamento já existente — manter e enriquecer com categoria/centro).
2. QUANDO uma compra é efetivada ENTÃO o sistema DEVE gerar conta(s) a pagar vinculadas ao fornecedor e ao documento fiscal (comportamento já existente — manter e enriquecer).
3. QUANDO um **CT-e é autorizado** na SEFAZ ENTÃO o sistema DEVE gerar automaticamente **conta a receber** do valor do frete (`vPrest`), vinculada ao tomador/pagador do frete e ao CT-e, usando a mesma lógica de "documento fiscal autorizado → título".
4. QUANDO um documento que gerou título é cancelado/estornado ENTÃO o sistema DEVE cancelar/estornar os títulos correspondentes ainda em aberto.
5. QUANDO a geração automática de título falha ENTÃO a autorização do documento fiscal NÃO DEVE ser desfeita, e a falha DEVE ser registrada para reprocessamento (não perder o título silenciosamente).
6. QUANDO um título é gerado automaticamente ENTÃO o `empresaId` do título DEVE ser o da entidade de negócio (venda/compra/CT-e), não simplesmente o do usuário logado.

### Requisito 5 — Conciliação bancária

**User Story:** Como responsável financeiro, quero importar o extrato bancário e
conciliar com os títulos, para garantir que o sistema reflete o banco.

#### Acceptance Criteria
1. QUANDO o usuário importa um extrato (OFX) ENTÃO o sistema DEVE registrar as linhas do extrato (data, valor, descrição, tipo) vinculadas a uma conta bancária, ignorando linhas já importadas (idempotência por identificador da transação).
2. QUANDO há linha de extrato e título compatível (valor + data aproximada) ENTÃO o sistema DEVE sugerir o match automaticamente.
3. QUANDO o usuário confirma um match ENTÃO o sistema DEVE dar baixa no título e marcar a linha do extrato como conciliada, atualizando o saldo da conta.
4. QUANDO uma linha de extrato não tem título correspondente ENTÃO o sistema DEVE permitir criar um lançamento manual a partir dela.
5. QUANDO o usuário desfaz uma conciliação ENTÃO o sistema DEVE reverter a baixa e o saldo.

### Requisito 6 — Fluxo de caixa e DRE gerencial

**User Story:** Como gestor, quero ver o fluxo de caixa projetado e o resultado
por competência, para tomar decisões.

#### Acceptance Criteria
1. QUANDO o usuário consulta o fluxo de caixa por período ENTÃO o sistema DEVE apresentar saldo inicial, entradas e saídas previstas (títulos em aberto) e realizadas (baixados), com saldo projetado por dia/semana/mês.
2. QUANDO o usuário consulta o fluxo de caixa ENTÃO o sistema DEVE permitir filtrar por conta financeira e por período.
3. QUANDO o usuário consulta o DRE gerencial ENTÃO o sistema DEVE agrupar receitas e despesas por categoria (plano de contas) no período, com visão por competência.
4. QUANDO o usuário consulta o aging ENTÃO o sistema DEVE classificar títulos em aberto por faixa de atraso (a vencer, 1-30, 31-60, 61-90, 90+).

### Requisito 7 — Fechamento de período

**User Story:** Como responsável financeiro, quero fechar um período (mês), para
travar lançamentos retroativos e consolidar saldos.

#### Acceptance Criteria
1. QUANDO o usuário fecha um período ENTÃO o sistema DEVE registrar a competência fechada, o saldo consolidado por conta e o usuário/data do fechamento.
2. QUANDO um período está fechado ENTÃO o sistema NÃO DEVE permitir criar/editar/estornar lançamentos com data dentro desse período, exceto por reabertura explícita.
3. QUANDO o usuário reabre um período ENTÃO o sistema DEVE registrar a reabertura (usuário/data/motivo) para auditoria.

### Requisito 8 — Isolamento, validação e auditoria

**User Story:** Como operador de um ERP multi-tenant, quero que meus dados
financeiros sejam isolados e as operações auditadas.

#### Acceptance Criteria
1. QUANDO qualquer query financeira é executada ENTÃO o sistema DEVE filtrar por `empresaId` (via `prismaScoped` quando o modelo estiver em `ISOLATED_MODELS`, ou filtro manual explícito caso contrário).
2. QUANDO uma entidade filha não tem `empresaId` próprio ENTÃO o isolamento DEVE ser garantido pelo relacionamento com a entidade pai no `where`.
3. QUANDO uma entrada inválida é recebida ENTÃO o sistema DEVE rejeitar com Zod (HTTP 422, mensagem "campo: motivo"), sem persistir nada.
4. QUANDO uma operação altera saldo/baixa/estorno ENTÃO o sistema DEVE registrar auditoria (quem/quando/o quê).
5. QUANDO o schema Prisma for alterado ENTÃO o mesmo commit DEVE atualizar `prisma/migrate-prod.ts` de forma idempotente, testada 2x local.
