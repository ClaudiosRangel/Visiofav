# Plano de Ação — Migração Calcgraf/G-Print → Vizor (Carton Wega)

Base: levantamento em `docs/calcgraf-gprint-levantamento.md` (PDF de consultoria
+ relatórios RI-1..RI-7 + telas do sistema via RDP). Objetivo: o Vizor fazer
tudo que a Carton Wega usa hoje no Calcgraf, com **preço batendo** o do sistema
atual.

## Princípio norteador — DUAS CAMADAS

1. **Camada 2 — Orçamento/OP (desktop G-Print)**: o que a Wega OPERA no dia a dia.
   Consome custo-hora fixo (Tabela de Custos) + calcula o preço do trabalho.
   **OBRIGATÓRIO para migrar.**
2. **Camada 1 — Mapa de Custos RKW (WebGraf/consultoria)**: CALCULA o custo-hora.
   Hoje a Wega NÃO opera (recebe via consultoria paga). **DIFERENCIAL do Vizor.**

O Vizor já tem o módulo **Orçamento Gráfico** implementado (motor de encaixe,
papel, tinta, máquina×custo-hora, acabamento, preço, fluxo orçamento→pedido→OP).
O trabalho é **paridade + calibração + os módulos novos (RKW e gerencial)**.

---

## BLOCOS (ordem de prioridade)

### BLOCO 0 — Coleta de Golden Cases (PRÉ-REQUISITO, depende do usuário)
Combustível da calibração. Sem isso, o preço do Vizor não bate com o Calcgraf.
Coletar do Calcgraf (via RDP):
- [ ] **1-2 "Emissão de Pré-Cálculos"** (memória de cálculo completa: horas por
      máquina, consumo kg papel/tinta, valores parciais → total).
- [ ] **~10 orçamentos reais variados** (entrada + saída: total, unitário, margem,
      CM) — cartucho, invólucro/bobina, muitas cores, poucas cores, tiragens
      diferentes. Já temos 1: cálculo 15182 (Gerdau, R$ 17.140,96).
- [ ] Export da **Tabela de Custos → Valores** completa (todas as máquinas ×
      valor-hora) — se exportável em planilha.
- [ ] Preços de **Materiais** (papel/bobinas/tintas) atuais.
- [ ] Os relatórios do **Mapa de Custos** já temos (RI-1..RI-6) para o Bloco 2.

### BLOCO 1 — Paridade do Orçamento/OP (camada 2) — OBRIGATÓRIO
Ajustar o módulo Orçamento Gráfico existente para aderir ao modelo Calcgraf.
Escopo (gaps identificados no levantamento):
- **Tabela de Custos por Origem/Coluna**: máquina × valor-hora, agrupada por
  Origem (Centro de Custo, Tinta, Mat. Acabamento, Matriz Impressão,
  Pré-Impressão, Serviço Externo, Suporte) e por Coluna (variações de preço),
  com % de aplicação. Hoje o Vizor usa `CentroProducao.custoHora` (um valor).
- **Serviço Externo** como componente de custo (terceirização).
- **Itens Fornecidos** (material do cliente — não cobra material). NOVO no Vizor.
- **Itens Diversos** (custos avulsos no cálculo) — validar/adicionar.
- **Contribuição Marginal %** por item/tiragem (Custo Transformação + Lucro).
- **Orçamento multi-item** (1 orçamento agrupa N cálculos/itens do mesmo cliente).
- **Catálogo de Atividades de Acabamento** (checkbox por operação → máquina).
- **Variantes de tiragem** por cálculo (já existe simular-tiragens; alinhar).

### BLOCO 2 — Calibração e Validação do Motor (golden tests) — CRÍTICO
Como bater os valores (engenharia reversa por casos de referência):
1. Cadastrar no Vizor as MESMAS premissas dos golden cases (custos-hora, preços
   MP, perdas, margem).
2. Rodar cada golden case no motor do Vizor.
3. Comparar **componente a componente** (papel / tinta / máquina / acabamento /
   total / margem / CM), não só o total.
4. Ajustar fórmulas/parâmetros onde divergir (perda, aproveitamento, setup,
   velocidade) até **tolerância ≤ 0,5% no valor unitário**.
5. Congelar cada caso como **teste Vitest** (regressão). Padrão do projeto (o
   steering cita testes com dados reais das OPs da Wega).
Fallback: onde a fórmula Delphi for inacessível → calibração empírica (ajustar
parâmetros até os casos reais baterem; o que importa é o preço final igual).

### BLOCO 3 — Mapa de Custos RKW vivo (camada 1) — DIFERENCIAL
Implementar o Mapa de Localização de Custos como funcionalidade do Vizor (hoje a
Wega só tem via consultoria paga). Escopo (documentado em §2–§13, RI-1..RI-6):
- Cadastros: Centros (Produtivo/Auxiliar/Administração), Bens a Depreciar
  (Valor/Estado/Anos/Residual → depreciação mensal), Funcionários por centro
  (salário + Ajuda de Custo) + Funcionários Rateados, Despesas (com chave de
  rateio), Encargos Sociais (tabela CLT), Horas Produtivas por centro.
- **Motor de Rateio** com Chaves de Rateio reutilizáveis (peso manual OU
  automático por headcount/máquinas), rateio em 2 níveis (auxiliares+adm →
  produtivos).
- Cálculo do Custo/Hora por centro (Apurado / A Praticar com ajuste% / Praticado).
- Relatórios: Mapa Custos/Hora, Composição do Custo Hora, Distribuição do Custo
  Fixo, Taxa Administrativa vs benchmark.
- **Integração**: o Custo/Hora "A Praticar" gerado aqui ALIMENTA a Tabela de
  Custos do Bloco 1 (escreve o valor-hora que o orçamento consome).
- Validação: reproduzir os totais dos relatórios reais (Custo Fixo, custos-hora)
  como golden case — bate fácil (aritmética pura).

### BLOCO 4 — Camada Gerencial/Analítica (RKW) — DIFERENCIAL
- Contribuição Marginal (orçado × fechado, aproveitamento/conversão).
- Simulação de faturamento × cobertura de custo fixo (mês a mês).
- Ponto de Equilíbrio (break-even = Custo Fixo ÷ CM%).
- Pós-Cálculo (previsto × realizado de produção).
- Confronto com DRE Contábil.

---

## Sequência recomendada
0 (coleta, em paralelo) → 1 (paridade) + 2 (calibração, juntos) → 3 (RKW) → 4 (gerencial).

## Riscos
- **Maior risco**: preço do Vizor não bater o do Calcgraf → mitigado pelo Bloco 2
  (golden cases + tolerância + testes). Depende da coleta do Bloco 0.
- Fórmulas Delphi fechadas → calibração empírica como fallback.
- Múltiplos totais de Custo Fixo entre versões do mapa → usar uma "foto" oficial
  como referência.

## Próximos passos
1. Usuário coleta os golden cases (Bloco 0).
2. Transformar cada bloco em spec (.kiro/specs/): requirements → design → tasks.
   Sugestão de specs: `orcamento-grafico-paridade-calcgraf` (Blocos 1+2),
   `mapa-custos-rkw` (Bloco 3), `analise-gerencial-rkw` (Bloco 4).
