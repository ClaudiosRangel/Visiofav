# Requirements Document

## Introduction

Esta feature implementa a **camada gerencial/analítica (RKW)** do Vizor para a
Carton Wega — o **Bloco 4** do plano de ação (`docs/calcgraf-plano-de-acao.md`).
É a análise que cruza o que já existe no sistema: o **custo fixo mensal** apurado
pelo Mapa de Custos RKW (Bloco 3, `MapaCusto`) e o resultado dos **orçamentos
gráficos** (Bloco 1, `OrcamentoGrafico` com Contribuição Marginal). O objetivo é
dar ao gestor os indicadores de decisão que hoje ele só vê na consultoria paga:
Contribuição Marginal consolidada, Ponto de Equilíbrio, cobertura do custo fixo
pelo faturamento, pós-cálculo (previsto × realizado) e confronto com a DRE.

Referências de domínio: `docs/calcgraf-gprint-levantamento.md` (GAP 2 —
"Camada Gerencial/Analítica"). Depende do Bloco 3 (`MapaCusto`) e do Bloco 1
(motor de orçamento com CM). É leitura/agregação — **não** cria custeio novo nem
altera o motor de cálculo existente.

## Glossary

- **Contribuição Marginal (CM)**: Preço de Venda − Custos Variáveis. Em % = CM ÷ Preço. Já calculada por orçamento pelo motor do Bloco 1.
- **Custo Fixo (CF)**: total mensal apurado pelo Mapa de Custos RKW da competência (salários+encargos + depreciação + despesas).
- **Ponto de Equilíbrio (break-even)**: faturamento no qual a CM total cobre exatamente o CF. Em valor = CF ÷ CM% média.
- **Cobertura do Custo Fixo**: quanto da CM acumulada no período já cobriu o CF do mês.
- **Orçamento fechado/ganho**: `OrcamentoGrafico` com status que representa venda efetivada (APROVADO / convertido em `pedidoVendaId`).
- **Pós-cálculo**: comparação entre o previsto no orçamento e o realizado na produção (OP concluída).
- **DRE**: Demonstração de Resultado — confronto do resultado gerencial com o contábil.

## Requirements

### Requisito 1: Painel de Contribuição Marginal consolidada por período

**User Story:** Como gestor da gráfica, quero ver a Contribuição Marginal total
e média dos orçamentos de um período, para saber se o mix de vendas está saudável.

#### Critérios de Aceitação
1. QUANDO o usuário consulta o painel gerencial informando um intervalo de datas THE sistema SHALL agregar os orçamentos da empresa no período por status (orçado, fechado/ganho, recusado).
2. THE sistema SHALL calcular, para os orçamentos fechados/ganhos, a soma de Preço de Venda, a soma de CM (valor) e a CM% média ponderada pelo preço de venda.
3. THE sistema SHALL retornar também o número de orçamentos e a taxa de conversão (fechados ÷ total).
4. WHERE um orçamento não tem `resultadoCalculo`/CM persistida THE sistema SHALL usar `precoVenda − custoTotal` como CM de fallback e sinalizar que é aproximada.
5. THE sistema SHALL filtrar tudo por `empresaId` explícito (não confiar apenas no prismaScoped).

### Requisito 2: Ponto de Equilíbrio e cobertura do Custo Fixo

**User Story:** Como gestor, quero saber quanto preciso faturar no mês para
cobrir o custo fixo, e quanto do custo fixo o faturamento atual já cobriu.

#### Critérios de Aceitação
1. QUANDO o usuário informa uma competência (AAAA-MM) THE sistema SHALL buscar o `MapaCusto` FECHADO daquela competência para obter o Custo Fixo Total; SE não houver, usar o mapa mais recente disponível e sinalizar.
2. THE sistema SHALL calcular o Ponto de Equilíbrio em faturamento = Custo Fixo ÷ (CM% média ÷ 100), tratando CM% ≤ 0 como "indefinido" (sem divisão por zero).
3. THE sistema SHALL calcular a cobertura = CM acumulada no período ÷ Custo Fixo (em % e em valor faltante para o break-even).
4. THE sistema SHALL retornar o resultado do período = CM acumulada − Custo Fixo (lucro/prejuízo gerencial).
5. WHERE não houver mapa de custo nem orçamentos no período THE sistema SHALL responder com os campos zerados e um aviso claro, sem erro.

### Requisito 3: Simulação de faturamento × cobertura

**User Story:** Como gestor, quero simular diferentes níveis de faturamento e ver
o resultado gerencial, para planejar metas.

#### Critérios de Aceitação
1. QUANDO o usuário informa um faturamento hipotético e uma CM% (default = a CM% média do período) THE sistema SHALL retornar CM projetada, cobertura do custo fixo e resultado (lucro/prejuízo).
2. THE sistema SHALL aceitar uma lista de cenários (ex.: 80%, 100%, 120% da meta) e retornar o resultado de cada um.
3. THE cálculo SHALL ser puro (sem persistência), reutilizável e testável.

### Requisito 4: Pós-cálculo (previsto × realizado)

**User Story:** Como gestor, quero comparar o que foi orçado com o que a produção
realizou, para identificar desvios de custo/quantidade.

#### Critérios de Aceitação
1. QUANDO um orçamento gerou um pedido/OP THE sistema SHALL, quando os dados existirem, comparar quantidade prevista × produzida e custo previsto × realizado.
2. WHERE não houver OP concluída vinculada THE sistema SHALL marcar o item como "sem realizado" em vez de falhar.
3. THE sistema SHALL apresentar o desvio em valor e em % por item comparável.
4. Esta análise SHALL ser incremental: se os vínculos orçamento→pedido→OP não estiverem completos no dado real, o relatório mostra o que existe sem quebrar (não bloquear a entrega dos Req 1–3).

### Requisito 5: Confronto com a DRE / resultado contábil

**User Story:** Como controller, quero comparar o resultado gerencial (RKW) com o
resultado contábil (DRE), para conciliar as duas visões.

#### Critérios de Aceitação
1. WHERE o módulo Contábil/DRE do Vizor tiver dados de resultado do período THE sistema SHALL exibir lado a lado o resultado gerencial (CM − CF) e o contábil, com a diferença.
2. WHERE não houver dado contábil disponível THE sistema SHALL exibir só a coluna gerencial com aviso de que o contábil não está disponível.
3. Este requisito SHALL ser de menor prioridade (informativo) e não bloquear os demais.

### Requisito 6: Frontend — painel gerencial no módulo PCP/Custos

**User Story:** Como gestor, quero uma tela única com esses indicadores, para
tomar decisão sem exportar planilha.

#### Critérios de Aceitação
1. THE sistema SHALL ter uma página no módulo de Custos (junto ao Mapa de Custos) com seletor de período/competência.
2. THE tela SHALL exibir cards de CM total, CM% média, Custo Fixo, Ponto de Equilíbrio, cobertura e resultado do período.
3. THE tela SHALL exibir o simulador de faturamento (Req 3) com cenários.
4. THE tela SHALL respeitar o tema (claro/escuro) usando tokens Mantine, sem cores fixas.
5. THE acesso SHALL exigir autenticação e o `moduloGuard('PCP')`, consistente com o Mapa de Custos.
