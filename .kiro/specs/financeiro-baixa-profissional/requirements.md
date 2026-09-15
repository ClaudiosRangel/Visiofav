# Requirements Document

Baixa Profissional de Títulos (Liquidação) — Contas a Pagar e a Receber

## Introduction

A baixa (liquidação) atual do Vizor é simplória: registra apenas o valor pago e a
forma de pagamento. Os melhores ERPs do mercado tratam a liquidação como uma
operação rica, com **ajustes de valor** (juros/multa por atraso, descontos por
antecipação, tarifas bancárias), **conta bancária de origem/destino**, **data de
pagamento**, **comprovante anexável** e um **resumo de cálculo** que mostra como o
valor do título vira o valor líquido efetivamente pago/recebido.

Esta fase eleva a baixa ao padrão de mercado, para **Contas a Pagar** e **Contas a
Receber** (simétrico), tanto na baixa **individual** quanto em **lote**. O valor
líquido é sempre derivado deterministicamente: `líquido = valor do título +
juros + multa − desconto ± tarifa` (tarifa soma no pagar, é custo; no receber
reduz o recebido). A operação preserva a integridade do que já existe (estorno,
período fechado, contabilização automática da D4) e mantém isolamento
multi-tenant.

Segue as regras do projeto: extensão do motor de baixa existente
(`titulo.service.ts`), migração idempotente no mesmo commit, e sem quebrar os
fluxos que já chamam a baixa (importação de XML, folha, etc.).

## Glossary

- **Baixa / Liquidação**: registrar que um título foi pago (a pagar) ou recebido
  (a receber), mudando seu status para PAGA/RECEBIDA.
- **Valor do título**: o valor original em aberto do título.
- **Juros**: acréscimo por atraso proporcional ao tempo (informado na baixa).
- **Multa**: acréscimo fixo por atraso (informado na baixa).
- **Desconto**: redução concedida (ex.: antecipação, negociação).
- **Tarifa bancária**: custo da operação bancária (ex.: TED, boleto). No pagar,
  aumenta o desembolso; no receber, reduz o valor líquido recebido.
- **Valor líquido**: valor efetivamente movimentado no caixa/banco após ajustes.
- **Conta de origem/destino**: a `ContaFinanceira` (caixa/banco) de onde sai o
  pagamento ou onde entra o recebimento.
- **Comprovante**: arquivo (imagem/PDF) anexado à baixa como evidência.
- **Baixa em lote**: liquidar vários títulos numa única operação, com data, conta e
  forma comuns; cada título mantém seu próprio valor.

## Requirements

### Requirement 1: Ajustes de valor na baixa individual

**User Story:** Como usuário do financeiro, quero informar juros, multa, desconto
e tarifa ao dar baixa, para registrar o valor real pago/recebido, não só o valor
do título.

#### Acceptance Criteria

1. WHEN o usuário registra a baixa de um título THEN o sistema SHALL aceitar,
   além do valor, os campos opcionais juros, multa, desconto e tarifa (todos ≥ 0).
2. WHEN a baixa é calculada THEN o sistema SHALL derivar o valor líquido como
   `valor + juros + multa − desconto` para contas a pagar (a tarifa é registrada
   como custo adicional do desembolso) e como `valor + juros + multa − desconto −
   tarifa` para contas a receber (a tarifa reduz o recebido).
3. IF o desconto informado for maior que `valor + juros + multa` THEN o sistema
   SHALL rejeitar a baixa (líquido não pode ser negativo).
4. WHEN a baixa é persistida THEN o sistema SHALL guardar os componentes (juros,
   multa, desconto, tarifa) e o valor líquido, além da data e da conta de origem/
   destino, para auditoria e conciliação.

### Requirement 2: Conta de origem/destino, data e comprovante

**User Story:** Como usuário do financeiro, quero informar a conta bancária, a
data do pagamento e anexar o comprovante, para deixar a baixa rastreável e
conciliável.

#### Acceptance Criteria

1. WHEN o usuário registra a baixa THEN o sistema SHALL permitir escolher a
   `ContaFinanceira` de origem/destino e a data efetiva do pagamento/recebimento.
2. WHERE a data informada cai em um período contábil fechado THE sistema SHALL
   rejeitar a baixa (regra de período fechado já existente é preservada).
3. WHEN o usuário anexa um comprovante THEN o sistema SHALL armazenar o nome e o
   conteúdo do arquivo vinculados ao título.
4. WHERE nenhum comprovante é anexado THE sistema SHALL concluir a baixa
   normalmente (comprovante é opcional).

### Requirement 3: Resumo de cálculo em tempo real (frontend)

**User Story:** Como usuário, quero ver o resumo do cálculo enquanto preencho a
baixa, para confirmar o valor líquido antes de efetivar.

#### Acceptance Criteria

1. WHEN o usuário edita qualquer componente (valor, juros, multa, desconto,
   tarifa) THEN a interface SHALL recalcular e exibir o valor líquido
   imediatamente, sem chamada ao servidor.
2. WHEN a interface exibe o resumo THEN ela SHALL mostrar, discriminadamente, o
   valor do título, os acréscimos (juros + multa), os descontos, a tarifa e o
   valor líquido resultante.
3. WHERE o desconto torna o líquido negativo THE interface SHALL sinalizar o erro
   e impedir a confirmação.

### Requirement 4: Baixa em lote com os mesmos recursos

**User Story:** Como usuário, quero liquidar vários títulos de uma vez informando
data, conta e forma comuns, para agilizar o fechamento.

#### Acceptance Criteria

1. WHEN o usuário seleciona vários títulos e confirma a baixa em lote THEN o
   sistema SHALL liquidar cada título pelo seu próprio valor, com a data, conta e
   forma de pagamento comuns informadas.
2. WHEN a baixa em lote roda THEN o sistema SHALL particionar o resultado em
   sucesso e ignorados (com motivo), sem derrubar o lote inteiro por um título
   inválido (comportamento já existente preservado).
3. WHEN a interface exibe o lote THEN ela SHALL mostrar o total consolidado dos
   títulos selecionados antes da confirmação.

### Requirement 5: Compatibilidade e integridade

**User Story:** Como mantenedor, quero que a baixa enriquecida não quebre os
fluxos existentes que já dão baixa (importação de XML, folha, etc.).

#### Acceptance Criteria

1. WHEN um chamador existente registra baixa sem os novos campos THEN o sistema
   SHALL tratar juros/multa/desconto/tarifa como zero e liquidar pelo valor
   informado (retrocompatível).
2. WHEN a baixa enriquecida ocorre THEN o sistema SHALL continuar disparando a
   contabilização automática da liquidação (D4) de forma best-effort e
   não-bloqueante.
3. WHEN o estorno de uma baixa é executado THEN o sistema SHALL limpar os campos
   de liquidação (valor pago/recebido, data e os componentes) e voltar o título a
   ABERTA.
4. WHEN o schema é alterado THEN a migração equivalente idempotente SHALL ser
   incluída no `migrate-prod.ts` no mesmo commit.

### Requirement 6: Isolamento multi-tenant

**User Story:** Como administrador, quero que a baixa respeite o isolamento por
empresa.

#### Acceptance Criteria

1. WHEN qualquer baixa (individual ou lote) é executada THEN o sistema SHALL
   operar somente sobre títulos e contas financeiras da empresa da sessão.
2. WHEN um título ou conta de outra empresa é referenciado por id THEN o sistema
   SHALL tratá-lo como inexistente.
