# Requirements Document

Calibração do Orçamento Gráfico ao Calcgraf (golden 15.086)

## Glossary

- **Golden 15.086**: cálculo real do Calcgraf usado como referência de paridade.
- **SPANKS**: fórmula clássica da indústria para consumo de tinta.
- **CT**: Custo de Transformação (máquinas/acabamento). **MD**: Material Direto.
- **CEV**: Custos e Encargos de Venda.
- **Motor**: `orcamento-grafico-calculo.service.ts` (cálculo puro, 148 testes).

## Introduction

O módulo de Orçamento Gráfico do Vizor já gera cálculo/orçamento/OP/relatório
nativos (specs `orcamento-grafico-multi-item-gcad` e
`orcamento-grafico-op-relatorio-paridade`). Falta a **paridade numérica**: o
cálculo precisa reproduzir o Calcgraf componente a componente, com desvio
≤ 0,5%, usando o cálculo real **15.086** (Cartucho CIMED Super Fresh, ICEFRESH
903, tiragem 100.000) como golden case. Os parâmetros reais foram extraídos do
backup SQL Server do Calcgraf e estão em
`docs/calcgraf-golden-15086-parametros.md` (fonte de verdade).

Além da calibração, há dois bugs de UI que impedem a conferência na tela (Select
de Suporte vazio; tela de detalhe do orçamento em branco) e um pedido de
funcionalidade: **reutilizar um cálculo em outros orçamentos**, como o Calcgraf.

Estado atual (produção, orçamento 5316): Custo Produção R$ 10.181,90 vs alvo
R$ 14.803,11 (−31%). Papel já calibrado (−2,1%); Tinta +166%, Impressão −49%,
Acabamento −40%, Material de Acabamento −100%.

Regra-mestre: o motor puro `orcamento-grafico-calculo.service.ts` é alterado com
cuidado cirúrgico, preservando os 148 testes congelados (não-regressão por fase).

## Requirements

### Requisito 1 — Bug: Select de Suporte não exibe o suporte selecionado

**User Story:** Como orçamentista, quero ver o suporte selecionado no passo
Papel do wizard, para conferir que o papel correto está vinculado ao item.

#### Acceptance Criteria
1. QUANDO o item tem `suporteId` preenchido ENTÃO o Select de Suporte no passo
   Papel DEVE exibir o nome do suporte selecionado (não vazio).
2. QUANDO o item tem `papelId`/`precoKgPapel` ENTÃO o campo "Preço do Papel /
   Gramatura" DEVE exibir o valor correspondente.
3. A correção NÃO deve alterar o cálculo nem a persistência — é só hidratação de
   exibição do frontend.

### Requisito 2 — Bug: tela de detalhe do orçamento em branco

**User Story:** Como orçamentista, quero abrir a tela de detalhe do orçamento
sem erro, para ver itens, planos e totais.

#### Acceptance Criteria
1. QUANDO acesso `/orcamento-grafico/{id}` de um orçamento válido ENTÃO a página
   DEVE renderizar (não ficar em branco).
2. SE houver erro de dados (campo ausente/nulo) ENTÃO a página DEVE tratar com
   fallback seguro em vez de quebrar o render.
3. A correção DEVE preservar o comportamento das telas que já funcionam.

### Requisito 3 — Calibração da TINTA (bater R$ 259,33 ≤ 0,5%)

**User Story:** Como orçamentista, quero que o custo de tinta reproduza o
Calcgraf, para o Material Direto bater.

#### Acceptance Criteria
1. QUANDO calculo o 15.086 com cobertura agregada 60% (Escala/CMYK) + 5%
   (Pantone 01), coefSuporte 1,5, preços 44,00 e 71,50 /kg ENTÃO o custo de
   tinta DEVE ficar ≤ 0,5% de R$ 259,33 (Escala ~220,00 + Pantone ~39,33).
2. O modelo de consumo DEVE seguir o SPANKS do Calcgraf (fator stock, offset,
   partida de consumo), documentado em `docs/calcgraf-consumo-tinta.md`.
3. A mudança NÃO deve regredir os golden cases existentes de tinta.

### Requisito 4 — Calibração do MATERIAL DE ACABAMENTO (bater R$ 1.739,83)

**User Story:** Como orçamentista, quero que Cola, Vernizes e Caixa Padrão
tenham seu consumo calculado, para o Material Direto bater.

#### Acceptance Criteria
1. QUANDO o item tem acabamentos de material (Cola Branca, Verniz Primer, Verniz
   UV, Caixa Padrão) com preços 29,15 / 17,49 / 57,20 /kg e 7,70 /un ENTÃO o
   motor DEVE calcular a QUANTIDADE consumida (não subtotal 0).
2. O custo total de MAT.ACABAMENTO DEVE ficar ≤ 0,5% de R$ 1.739,83.
3. A fórmula de consumo de cada material (área×cobertura p/ verniz; kg/colagem;
   un por tiragem p/ caixa) DEVE ser documentada e testada.

### Requisito 5 — Calibração da IMPRESSÃO (bater R$ 3.466,58)

**User Story:** Como orçamentista, quero que o tempo/custo de impressão
reproduza o Calcgraf.

#### Acceptance Criteria
1. QUANDO calculo o 15.086 com HEID-CD7 (custo-hora 550, producaoHora 4.233,
   acerto 18 min/cor, setup 30 min, 5 cores) ENTÃO o custo de impressão DEVE
   ficar ≤ 0,5% de R$ 3.466,58.
2. A base de tempo (folhas, passagens por cor, retiro) DEVE reproduzir o
   Calcgraf (acerto fixo = 5×18+30 = 120 min; operação variável conforme a
   regra identificada).

### Requisito 6 — Calibração do ACABAMENTO/CT (bater R$ 2.459,92)

**User Story:** Como orçamentista, quero que o custo de transformação do
acabamento reproduza o Calcgraf.

#### Acceptance Criteria
1. QUANDO calculo o 15.086 com os acabamentos reais (Cortadeira, Dayuan,
   Destacar, AFT70, Verniz UV Total) e seus custos-hora/producaoHora ENTÃO o
   custo de acabamento DEVE ficar ≤ 0,5% de R$ 2.459,92.
2. A base de cada atividade (folhas vs peças) DEVE ser alinhada ao Calcgraf.

### Requisito 7 — Fechamento golden 15.086 ≤ 0,5%

**User Story:** Como responsável pela migração, quero o golden 15.086 validando
componente a componente, para garantir a paridade.

#### Acceptance Criteria
1. QUANDO os componentes (papel, tinta, impressão, acabamento, mat.acabamento)
   estão calibrados ENTÃO o teste `golden-15086` DEVE confrontar cada um com o
   alvo real exigindo ≤ 0,5% (não só coerência interna).
2. O Custo de Produção total DEVE ficar ≤ 0,5% de R$ 14.803,11.
3. A suíte `orcamento-grafico` DEVE permanecer verde (não-regressão).

### Requisito 8 — Reutilização de cálculo entre orçamentos (como o Calcgraf)

**User Story:** Como orçamentista, quero reaproveitar um cálculo existente em um
novo orçamento (outro cliente/pedido), como o Calcgraf faz, para não refazer
tudo.

#### Acceptance Criteria
1. É um ESTUDO + proposta: analisar como o Calcgraf clona `CalculoHeader` e suas
   filhas para um novo orçamento (relação cálculo↔orçamento N:N ou clonagem).
2. O resultado DEVE ser uma decisão de design documentada (relação de reuso vs
   clonagem) e, se aprovado, uma funcionalidade "Reaproveitar cálculo" que cria
   um novo item/orçamento a partir de um cálculo existente, ajustando só o que
   muda (cliente, pedido, tiragem).
3. NÃO quebra o fluxo atual de copiar orçamento (nova versão do mesmo número).
