# Requirements Document

Central de Documentos Financeiros — Fase D4 (Contabilidade / Partidas Dobradas)

## Introduction

A Fase D4 conecta o financeiro do Vizor à **contabilidade** por meio de um
**plano de contas contábil** e da geração de **lançamentos contábeis em partidas
dobradas**. Hoje o Vizor tem apenas o plano de contas *gerencial*
(`CategoriaFinanceira`, RECEITA/DESPESA hierárquico); a contabilidade é
greenfield.

O objetivo é permitir que a empresa (ou seu contador) mantenha um **plano de
contas contábil** (padrão de mercado: contas hierárquicas com código legal,
natureza devedora/credora e grupo Ativo/Passivo/PL/Receita/Despesa), configure
um **de/para** entre cada categoria financeira e as contas contábeis de débito e
crédito, e obtenha **lançamentos contábeis** gerados automaticamente a partir dos
eventos financeiros (um título a pagar gerado, um título baixado/pago, um
recebimento), sempre respeitando a regra fundamental da contabilidade: **em todo
lançamento, a soma dos débitos é igual à soma dos créditos**.

Esta fase é a base para a D5 (exportação ECD/SPED Contábil e para software de
contabilidade). Não faz apuração de impostos nem DRE contábil completa — entrega
o **registro** contábil correto e rastreável. A geração automática é **opcional e
não-bloqueante**: se o de/para de uma categoria não estiver configurado, o evento
financeiro acontece normalmente e o lançamento contábil fica **pendente de
classificação** (não trava a operação financeira).

Segue as regras do projeto: extensão do que existe (reusa `CategoriaFinanceira`,
contas a pagar/receber, o motor de baixa), migração idempotente no mesmo commit,
isolamento multi-tenant por `empresaId`, e confirmação humana onde há efeito
relevante.

## Glossary

- **Plano de contas contábil (ContaContabil)**: árvore de contas contábeis da
  empresa, cada uma com código legal (ex.: 1.1.01.001), nome, natureza
  (DEVEDORA/CREDORA), grupo (ATIVO/PASSIVO/PATRIMONIO/RECEITA/DESPESA) e um
  indicador de conta **analítica** (aceita lançamento) vs **sintética** (só
  agrupa).
- **Conta analítica**: conta folha que recebe lançamentos. Só contas analíticas
  podem ser debitadas/creditadas.
- **Conta sintética**: conta de agrupamento (tem filhas), não recebe lançamento
  direto.
- **De/para contábil (MapeamentoContabil)**: associação entre uma
  `CategoriaFinanceira` e as contas contábeis usadas no débito e no crédito de um
  tipo de evento (provisão de despesa, pagamento, provisão de receita,
  recebimento).
- **Lançamento contábil (LancamentoContabil)**: um registro contábil de uma data,
  com histórico e um conjunto de **partidas**; a soma dos débitos deve igualar a
  soma dos créditos.
- **Partida (PartidaContabil)**: uma linha do lançamento — uma conta analítica,
  um valor e o tipo (DEBITO ou CREDITO).
- **Evento contabilizável**: um fato financeiro que gera lançamento — provisão de
  um título a pagar/receber, baixa (pagamento/recebimento).
- **Lançamento pendente**: lançamento gerado sem de/para configurado, marcado como
  PENDENTE para classificação posterior (não afeta o financeiro).

## Requirements

### Requirement 1: Plano de contas contábil

**User Story:** Como contador/responsável financeiro, quero manter o plano de
contas contábil da empresa, para registrar os fatos conforme a estrutura contábil
legal.

#### Acceptance Criteria

1. WHEN o usuário cria uma conta contábil THEN o sistema SHALL exigir código,
   nome, natureza (DEVEDORA/CREDORA) e grupo (ATIVO/PASSIVO/PATRIMONIO/RECEITA/
   DESPESA), e SHALL permitir indicar a conta pai (para hierarquia) e se é
   analítica.
2. WHEN duas contas da mesma empresa recebem o mesmo código THEN o sistema SHALL
   rejeitar a duplicidade dentro da empresa.
3. IF uma conta é sintética (tem filhas) THEN o sistema SHALL impedir que ela seja
   usada como conta de débito/crédito em partidas (apenas analíticas lançam).
4. WHEN o usuário lista o plano de contas THEN o sistema SHALL retornar as contas
   isoladas por empresa, permitindo montar a árvore por conta pai.

### Requirement 2: De/para categoria financeira → conta contábil

**User Story:** Como contador, quero configurar quais contas contábeis
correspondem a cada categoria financeira, para que os lançamentos automáticos
usem as contas certas.

#### Acceptance Criteria

1. WHEN o usuário configura o de/para de uma categoria THEN o sistema SHALL
   permitir informar a conta de débito e a conta de crédito para a provisão e
   para a liquidação (pagamento/recebimento) daquele tipo de categoria.
2. WHERE uma conta informada no de/para não é analítica THE sistema SHALL rejeitar
   a configuração (só contas analíticas lançam).
3. WHEN o de/para é consultado para uma categoria THEN o sistema SHALL retornar as
   contas configuradas, isoladas por empresa.
4. IF uma categoria não tem de/para configurado THEN o sistema SHALL permitir a
   operação financeira normalmente e marcar o lançamento contábil resultante como
   PENDENTE (Requirement 4.4).

### Requirement 3: Lançamento contábil manual em partidas dobradas

**User Story:** Como contador, quero lançar manualmente um fato contábil em
partidas dobradas, para registrar ajustes e fatos não originados do financeiro.

#### Acceptance Criteria

1. WHEN o usuário cria um lançamento contábil THEN o sistema SHALL exigir data,
   histórico e ao menos duas partidas (ao menos um débito e ao menos um crédito).
2. WHEN o lançamento é salvo THEN o sistema SHALL rejeitar se a soma dos débitos
   for diferente da soma dos créditos (tolerância R$ 0,01).
3. WHEN uma partida referencia uma conta THEN o sistema SHALL rejeitar se a conta
   não for analítica ou não pertencer à empresa.
4. WHEN o usuário consulta lançamentos THEN o sistema SHALL retornar os
   lançamentos com suas partidas, isolados por empresa, filtráveis por período.

### Requirement 4: Geração automática a partir de eventos financeiros

**User Story:** Como usuário do financeiro, quero que os lançamentos contábeis
sejam gerados automaticamente quando um título é provisionado ou pago, para não
lançar contabilidade manualmente a cada evento.

#### Acceptance Criteria

1. WHEN um título a pagar/receber é gerado com categoria que tem de/para de
   provisão THEN o sistema SHALL gerar um lançamento contábil de provisão
   (débito/crédito conforme o de/para) equilibrado.
2. WHEN um título é baixado (pago/recebido) e a categoria tem de/para de
   liquidação THEN o sistema SHALL gerar o lançamento contábil de liquidação
   equilibrado, referenciando o título de origem.
3. WHEN um lançamento automático é gerado THEN o sistema SHALL garantir que a soma
   dos débitos é igual à soma dos créditos (mesma invariante do lançamento
   manual).
4. IF a categoria do evento não tem de/para configurado THEN o sistema SHALL
   registrar o lançamento como PENDENTE (com o valor e a referência ao evento) sem
   partidas balanceadas, e NÃO SHALL bloquear nem desfazer a operação financeira.
5. WHERE a geração automática falha por qualquer motivo THE sistema SHALL não
   impedir a operação financeira de origem (a contabilização é best-effort e
   auditável, nunca bloqueante).

### Requirement 5: Isolamento multi-tenant e integridade

**User Story:** Como administrador, quero garantir que plano de contas,
de/para e lançamentos de uma empresa nunca sejam vistos ou usados por outra.

#### Acceptance Criteria

1. WHEN qualquer operação contábil (conta, de/para, lançamento) é executada THEN o
   sistema SHALL filtrar por `empresaId` da sessão e SHALL impedir acesso a
   registros de outra empresa mesmo com id conhecido.
2. WHEN um lançamento automático é gerado THEN o sistema SHALL usar o `empresaId`
   da entidade de negócio (título/folha), não simplesmente o do usuário.
3. WHEN o schema é alterado THEN a migração equivalente idempotente SHALL ser
   incluída no `migrate-prod.ts` no mesmo commit.

### Requirement 6: Consulta contábil (razão e balancete)

**User Story:** Como contador, quero consultar o razão de uma conta e um
balancete por período, para conferir os saldos contábeis.

#### Acceptance Criteria

1. WHEN o usuário consulta o razão de uma conta analítica em um período THEN o
   sistema SHALL retornar as partidas da conta (débitos e créditos) e o saldo,
   respeitando a natureza da conta.
2. WHEN o usuário consulta o balancete de um período THEN o sistema SHALL retornar,
   por conta, o total de débitos, o total de créditos e o saldo, e o total geral de
   débitos SHALL igualar o total geral de créditos (tolerância R$ 0,01).
3. WHEN não há lançamentos no período THEN o sistema SHALL retornar listas vazias
   sem erro.
