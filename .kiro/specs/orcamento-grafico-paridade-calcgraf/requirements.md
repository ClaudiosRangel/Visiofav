# Requirements Document

## Introduction

Ajustar o módulo de Orçamento Gráfico do Vizor para que o **preço de um trabalho
bata com o do Calcgraf/G-Print** (sistema atual da Carton Wega), permitindo a
migração sem que o cliente perca a referência de preço. É o Bloco 1+2 do plano
(`docs/calcgraf-plano-de-acao.md`). As fórmulas de referência já foram
decompostas e validadas em `docs/calcgraf-formulas-decompostas.md` (golden cases
15181 e 15185). O motor de cálculo existente já usa o método divisor (gross-up)
e cobre encaixe/papel/tinta/máquina/acabamento — esta feature estende esse motor
para: fórmula de preço com margem+CEV no divisor único, decomposição do custo
(Material Direto + Transformação + Serviço Externo), Itens Fornecidos, Itens
Diversos e Contribuição Marginal.

## Glossary

- **Custo de Produção**: Material Direto + Custo de Transformação + Serviço Externo.
- **Material Direto (MD)**: papel + tinta + matriz + material de acabamento + itens diversos, menos itens fornecidos pelo cliente.
- **Custo de Transformação (CT)**: soma de (horas × custo-hora) das máquinas/acabamentos.
- **Serviço Externo (SE)**: terceirização (acabamento fora, etc.).
- **CEV (Custos de Venda)**: ICMS + Juros + Pis/Cofins + Comissões (% aplicados sobre o preço).
- **Método divisor (gross-up)**: Preço = Custo / (1 − Margem% − CEV%).
- **Contribuição Marginal (CM)**: Preço menos custos variáveis; medida em $ e %.
- **Itens Fornecidos**: material fornecido pelo cliente — não entra no custo cobrado.

## Requirements

### Requirement 1: Fórmula de preço com divisor único (Margem + CEV)

**User Story:** Como orçamentista, quero que o preço seja formado pelo mesmo
método do Calcgraf, para que o valor final bata com o sistema atual.

#### Acceptance Criteria
1. WHEN o motor forma o preço THEN o sistema SHALL calcular Preço = Custo Total / (1 − (Margem% + CEV%)/100).
2. WHERE Margem% + CEV% ≥ 100% THEN o sistema SHALL rejeitar o cálculo com erro claro (divisor ≤ 0), sem retornar preço negativo.
3. WHEN comparado aos golden cases 15181 e 15185 THEN o preço unitário calculado SHALL bater com o relatório dentro de tolerância de 0,5%.

### Requirement 2: Decomposição do Custo de Produção

**User Story:** Como orçamentista, quero ver o custo separado em Material Direto,
Transformação e Serviço Externo, como no Calcgraf.

#### Acceptance Criteria
1. WHEN o cálculo termina THEN o sistema SHALL expor Material Direto, Custo de Transformação e Serviço Externo separadamente.
2. THE sistema SHALL calcular Custo de Produção = Material Direto + Custo de Transformação + Serviço Externo.
3. THE sistema SHALL calcular Custo Total = Custo de Produção − créditos fiscais + encargo financeiro.

### Requirement 3: Serviço Externo (terceirização)

**User Story:** Como orçamentista, quero incluir serviços terceirizados no
orçamento, para orçar trabalhos com acabamento externo.

#### Acceptance Criteria
1. WHEN o usuário informa serviços externos THEN o sistema SHALL somá-los no Serviço Externo do custo de produção.
2. WHERE não há serviço externo THEN o Serviço Externo SHALL ser zero e o resultado SHALL ser idêntico ao cálculo sem essa parcela.

### Requirement 4: Itens Fornecidos pelo cliente

**User Story:** Como orçamentista, quero marcar materiais fornecidos pelo cliente,
para não cobrá-los no orçamento.

#### Acceptance Criteria
1. WHEN um material é marcado como fornecido pelo cliente THEN o sistema SHALL excluí-lo do Material Direto.
2. THE redução do Material Direto SHALL ser exatamente igual ao valor do material fornecido.

### Requirement 5: Contribuição Marginal

**User Story:** Como orçamentista/gestor, quero ver a Contribuição Marginal do
orçamento, para avaliar a rentabilidade de cada trabalho.

#### Acceptance Criteria
1. WHEN o cálculo termina THEN o sistema SHALL expor Contribuição Marginal em valor ($) e percentual (%).
2. THE Contribuição Marginal % SHALL estar entre 0 e 100.
3. WHEN a margem aumenta THEN a Contribuição Marginal SHALL aumentar (monotonicidade).

### Requirement 6: Compatibilidade e não-regressão

**User Story:** Como mantenedor, quero que os orçamentos existentes continuem
calculando igual, para não quebrar o que já funciona.

#### Acceptance Criteria
1. WHEN um cálculo é feito sem serviço externo, itens fornecidos ou CEV detalhado THEN o Custo de Produção SHALL ser igual ao produzido pela versão atual.
2. THE suíte de testes existente do orçamento gráfico SHALL continuar passando.
3. THE novos campos de resultado SHALL ser aditivos (não remover nem renomear campos existentes do ResultadoOrcamento).

### Requirement 7: Exibição no frontend

**User Story:** Como orçamentista, quero ver as novas informações na tela de
resultado, para conferir a composição e a contribuição marginal.

#### Acceptance Criteria
1. THE tela de resultado do orçamento SHALL exibir Material Direto, Custo de Transformação, Serviço Externo e Custo de Produção.
2. THE tela SHALL exibir o CEV (%) e a Contribuição Marginal (% e valor).
