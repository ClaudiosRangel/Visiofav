# Requirements Document

Financeiro Operacional Completo — Onda 1 (Operação Diária) — Vizor ERP

## Introduction

O Financeiro do Vizor hoje tem base sólida (contas a pagar/receber, contas
bancárias, categorias, centros de custo, lançamentos, conciliação, fechamento,
fluxo de caixa, aging, DRE — ver `.kiro/specs/erp-financeiro-completo/`), mas
**não é operável no dia a dia** por faltar: dashboard, baixa em lote, edição/
cancelamento de títulos, extrato por conta, relatórios, e as telas de vários
recursos cujo backend já existe.

Esta é a **Onda 1** do programa "Financeiro nível de mercado" (Omie/Totvs/
Sankhya). Meta: o operador financeiro consegue fazer todo o trabalho diário
sem sair do sistema. Integração bancária (boleto/CNAB/PIX) é a Onda 2 (F3 do
roadmap); conciliação de cartões/contratos recorrentes é a Onda 3.

O trabalho **estende** o que existe. Segue os padrões do projeto: migração
idempotente no mesmo commit (`.kiro/steering/database-migrations.md`),
isolamento multi-tenant (`.kiro/steering/ATENCAO-pontos-verificar.md`), Zod,
Fastify, Prisma, Mantine 7, e QA E2E em Python+Playwright
(`.kiro/steering/qa-automatizado.md`).

## Glossary

- **Título**: conta a receber ou a pagar.
- **Baixa**: registrar recebimento/pagamento (individual ou em lote).
- **Extrato de conta**: movimentação (entradas/saídas/saldo corrente) de uma conta financeira.
- **Inadimplência**: títulos a receber vencidos e não recebidos.
- **DRE gerencial**: resultado por categoria/competência (gerencial, não fiscal).

## Requirements

### Requisito 1 — Dashboard financeiro

**User Story:** Como gestor financeiro, quero um painel com a saúde financeira ao abrir o módulo, para agir sem caçar dados em listas.

#### Acceptance Criteria
1. QUANDO o usuário abre o dashboard ENTÃO o sistema DEVE exibir saldo total consolidado das contas financeiras ativas.
2. QUANDO o dashboard carrega ENTÃO o sistema DEVE exibir total a receber e a pagar (em aberto), separando "vence hoje", "vencidos" e "a vencer".
3. QUANDO o dashboard carrega ENTÃO o sistema DEVE exibir o resultado do mês corrente (receitas − despesas realizadas) e uma projeção de fluxo dos próximos períodos.
4. QUANDO o dashboard carrega ENTÃO o sistema DEVE exibir os maiores devedores (top clientes com títulos vencidos) e as maiores despesas por categoria no período.
5. QUANDO todos os dados são consultados ENTÃO o sistema DEVE isolar por `empresaId`.

### Requisito 2 — Baixa em lote

**User Story:** Como operador, quero selecionar vários títulos e baixá-los de uma vez, porque baixar um a um é inviável.

#### Acceptance Criteria
1. QUANDO o usuário seleciona N títulos a receber e confirma a baixa em lote ENTÃO o sistema DEVE dar baixa em todos, com data, forma de pagamento e conta bancária informadas, de forma atômica por título (falha de um não impede os demais válidos, e o resultado reporta sucessos/erros).
2. QUANDO o usuário faz baixa em lote de títulos a pagar ENTÃO o sistema DEVE aplicar a mesma regra.
3. QUANDO um título selecionado já está baixado/cancelado ENTÃO o sistema DEVE ignorá-lo e reportá-lo no resultado, sem falhar o lote inteiro.
4. QUANDO a baixa em lote é aplicada ENTÃO o saldo da conta bancária escolhida DEVE refletir os valores baixados.

### Requisito 3 — Edição, cancelamento e estorno de títulos

**User Story:** Como operador, quero editar um título aberto, cancelá-lo ou estornar uma baixa equivocada, para corrigir erros.

#### Acceptance Criteria
1. QUANDO o usuário edita um título ABERTA ENTÃO o sistema DEVE permitir alterar descrição, valor, vencimento, categoria, centro de custo e conta financeira.
2. QUANDO o usuário tenta editar um título já baixado ENTÃO o sistema DEVE rejeitar (409).
3. QUANDO o usuário cancela um título ABERTA ENTÃO o sistema DEVE marcá-lo CANCELADA.
4. QUANDO o usuário estorna uma baixa ENTÃO o sistema DEVE retornar o título para ABERTA, limpar dados de pagamento/recebimento e reverter o efeito no saldo, respeitando período fechado.
5. QUANDO o título pertence a outra empresa ENTÃO o sistema DEVE responder 404.

### Requisito 4 — Baixa individual enriquecida

**User Story:** Como operador, quero que ao baixar um título eu informe a conta bancária, categoria e centro de custo, para o dado alimentar saldo, DRE e rateio.

#### Acceptance Criteria
1. QUANDO o usuário baixa um título (individual) ENTÃO o sistema DEVE aceitar `contaFinanceiraId`, `categoriaId` e `centroCustoId` (opcionais) além do valor/data/forma.
2. QUANDO uma conta financeira é informada na baixa ENTÃO o saldo dessa conta DEVE refletir o valor baixado.
3. QUANDO o título é baixado em período fechado ENTÃO o sistema DEVE rejeitar (409).

### Requisito 5 — Extrato por conta financeira

**User Story:** Como operador, quero ver a movimentação de uma conta (como um extrato bancário interno), para conferir o saldo.

#### Acceptance Criteria
1. QUANDO o usuário consulta o extrato de uma conta por período ENTÃO o sistema DEVE listar lançamentos de caixa, baixas de títulos e transferências que afetam a conta, ordenados por data, com saldo corrente acumulado.
2. QUANDO o extrato é consultado ENTÃO o sistema DEVE apresentar saldo inicial do período e saldo final.
3. QUANDO a conta pertence a outra empresa ENTÃO 404.

### Requisito 6 — Relatórios financeiros

**User Story:** Como gestor, quero relatórios de inadimplência e de contas a pagar/receber, exportáveis, para gestão e cobrança.

#### Acceptance Criteria
1. QUANDO o usuário gera o relatório de inadimplência ENTÃO o sistema DEVE listar títulos a receber vencidos por cliente, com valor, dias de atraso e total por cliente.
2. QUANDO o usuário gera o relatório de contas a pagar/receber por período ENTÃO o sistema DEVE permitir filtrar por status, cliente/fornecedor, categoria, centro de custo e datas.
3. QUANDO um relatório é exibido ENTÃO o sistema DEVE permitir exportação (CSV) no frontend.
4. QUANDO os relatórios são consultados ENTÃO o sistema DEVE isolar por `empresaId`.

### Requisito 7 — Telas completas (frontend)

**User Story:** Como operador, quero telas para tudo que já existe no backend, para não depender de API crua.

#### Acceptance Criteria
1. QUANDO acesso o menu Financeiro ENTÃO DEVE haver telas para: Dashboard, Categorias, Centros de Custo, Lançamentos de Caixa, Fechamento de Período, DRE, Extrato de Conta — além das existentes.
2. QUANDO uso as telas de Contas a Pagar/Receber ENTÃO DEVE haver seleção múltipla + baixa em lote, edição, cancelamento e estorno.
3. QUANDO a tela de Conciliação carrega ENTÃO DEVE mostrar detalhe das linhas do extrato (data, valor, descrição) e do título sugerido, não apenas IDs.
4. QUANDO uma ação de sucesso/erro ocorre ENTÃO o sistema DEVE notificar (verde/vermelho) e usar componentes Mantine 7 com tokens de tema.

### Requisito 8 — QA automatizado

**User Story:** Como responsável pela qualidade, quero a suíte E2E cobrindo o financeiro, para garantir que tudo funciona.

#### Acceptance Criteria
1. QUANDO a suíte QA roda ENTÃO DEVE existir `test_43_financeiro.py` cobrindo: criação/baixa/edição/cancelamento/estorno de títulos, baixa em lote, contas bancárias, lançamentos, conciliação (OFX), dashboard, extrato e relatórios.
2. QUANDO um recurso é criado por uma empresa ENTÃO o teste DEVE validar que outra empresa do mesmo usuário NÃO o vê (isolamento).
3. QUANDO estados dependem de dados fiscais reais ENTÃO o backend DEVE prover seed de QA restrito (mesmo padrão de `qa-seed`), sem depender de emissão à SEFAZ.

### Requisito 9 — Isolamento, validação, auditoria e migração

#### Acceptance Criteria
1. QUANDO qualquer query é executada ENTÃO DEVE filtrar por `empresaId`.
2. QUANDO uma entrada inválida chega ENTÃO Zod rejeita (422, "campo: motivo"), nada persistido.
3. QUANDO o schema muda ENTÃO o mesmo commit atualiza `prisma/migrate-prod.ts` idempotente, testado 2x local.
4. QUANDO uma baixa/estorno/cancelamento ocorre ENTÃO o estado do título e o saldo DEVEM ficar consistentes (sem baixa parcial órfã).
