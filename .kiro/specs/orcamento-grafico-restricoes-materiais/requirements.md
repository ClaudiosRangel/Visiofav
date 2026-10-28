# Requirements Document

Restrições e Materiais por Atividade de Acabamento (informativos) — P16

## Introduction

Na tela "CARTUCHO" do Calcgraf, a seção Acabamento tem três listas acopladas:
**Atividades** (ex.: "AFT70 (Coladeira)", "Bobst E (Corte e Vinco)"), e —
dependentes da atividade marcada — **Restrições** (sub-opções: ex. "Acerto
Acoplado Colagem Lateral", "Fundo Automático", "Normal Repetição", "Onda B
Acoplado Novo") e **Materiais** (ex.: "Cola Branca", "Cola Quente") com um campo
"Medida em mm".

**Decisão central (confirmada com o usuário + verificação nas duas bases):**
Restrições e Materiais por atividade são **INFORMATIVOS — não alteram o cálculo
de custo/preço**. Evidência:
- Calcgraf (base restaurada): tabelas de restrição (`PcpTiposRestricao`,
  `RestricoesManuais`, `ProdutosxRestricoes`, `WebCalculoRestricoes`) têm só
  colunas descritivas/vínculo (`Nome`, `Ativo`, `Tipo`, `CodAtividade`,
  `flagExibirProposta`, `CodRestricao`) — nenhuma de preço/custo/tempo. O
  `flagExibirProposta` indica uso em proposta/descrição.
- Vizor: o model `RestricaoAcabamento` já existe (com campos `tempoAcertoMin`/
  `tempoOperacaoMin`), mas está vazio e o motor não o usa.

Portanto esta spec **NÃO toca o motor de cálculo** (o golden 15.235 permanece
intacto). É cadastro + seleção no orçamento + exibição no relatório/OP. Os
campos de tempo do model existente **são preservados como estão** (não
removidos, não alimentados por esta spec).

Backend `VisioFab.Wms.Back`, frontend `VisioFab.Wms.Front` (repos separados).

## Glossary

- **Atividade_Acabamento**: registro `AcabamentoGrafico` (cadastro de acabamento,
  ex.: coladeira, corte e vinco).
- **Restricao**: sub-opção textual vinculada a uma Atividade_Acabamento (ex.:
  "Fundo Automático"). Model `RestricaoAcabamento` já existe no schema.
- **Material_Atividade**: material textual vinculado a uma Atividade_Acabamento
  (ex.: "Cola Branca"), com um campo opcional "Medida em mm". NÃO existe hoje.
- **Item_Acabamento_Selecionado**: a escolha, no orçamento, de uma atividade +
  (opcional) uma restrição + (opcional) um material + medida — persistida em
  `ItemOrcamentoGrafico.acabamentosRicos` (Json) como TEXTO/referência, sem
  efeito de custo.
- **StepAcabamentos**: passo do wizard de item
  (`.../orcamento-grafico/novo/StepAcabamentos.tsx`) que lista as atividades.
- **Motor_Calculo**: `orcamento-grafico-calculo.service.ts` /
  `orcamento-grafico-item.service.ts` — NÃO é alterado por esta spec.

## Requirements

### Requirement 1: Cadastrar restrições por atividade de acabamento

**User Story:** Como cadastrador, quero vincular sub-opções (restrições) a uma
atividade de acabamento, para que o orçamentista possa escolhê-las como
descrição no orçamento.

#### Acceptance Criteria

1. THE cadastro de Atividade_Acabamento SHALL permitir gerenciar uma lista de Restricao vinculadas (nome textual), reaproveitando o model `RestricaoAcabamento` existente.
2. WHEN uma Restricao é criada/editada/removida, THE sistema SHALL persistir a alteração isolada por `empresaId` da atividade.
3. THE cadastro SHALL NOT exigir nem usar valores de custo/tempo para a Restricao (campos de tempo do model permanecem opcionais e não usados no cálculo).

### Requirement 2: Cadastrar materiais por atividade de acabamento

**User Story:** Como cadastrador, quero vincular materiais (ex.: Cola Branca,
Cola Quente) a uma atividade, para que apareçam como opção informativa no
orçamento.

#### Acceptance Criteria

1. THE cadastro de Atividade_Acabamento SHALL permitir gerenciar uma lista de Material_Atividade (nome textual), isolada por `empresaId`.
2. THE Material_Atividade SHALL ser puramente descritivo (sem preço/consumo que afete o cálculo).
3. WHERE a solução de menor risco for um campo Json no próprio `AcabamentoGrafico` (ex.: `materiais: string[]`) em vez de tabela nova, THE design SHALL registrar essa escolha e seguir a regra de `database-migrations` se criar coluna/tabela.

### Requirement 3: Selecionar restrição e material no orçamento

**User Story:** Como orçamentista, ao marcar uma atividade de acabamento no item,
quero escolher (opcionalmente) uma restrição, um material e informar a medida em
mm, para descrever o acabamento como no Calcgraf.

#### Acceptance Criteria

1. WHEN o usuário marca uma Atividade_Acabamento no StepAcabamentos, THE StepAcabamentos SHALL exibir as Restricao e os Material_Atividade cadastrados para aquela atividade.
2. THE StepAcabamentos SHALL permitir escolher no máximo uma Restricao e os materiais aplicáveis, e informar um valor de "Medida em mm" opcional.
3. WHEN o item é salvo, THE Orcamento_Grafico SHALL persistir a seleção (restrição/material/medida) dentro de `acabamentosRicos` do item, como texto/referência.
4. THE seleção de restrição/material SHALL NOT alterar o Custo de Produção nem o preço do item (resultado idêntico ao de hoje — não-regressão do golden).
5. IF a atividade não possui restrições/materiais cadastrados, THEN THE StepAcabamentos SHALL ocultar essas sub-listas para aquela atividade.

### Requirement 4: Exibir restrição e material no relatório/OP

**User Story:** Como usuário, quero ver a restrição e o material escolhidos no
relatório do orçamento e na OP, para registrar como o acabamento deve ser feito.

#### Acceptance Criteria

1. WHERE um Item_Acabamento_Selecionado possui restrição/material/medida, THE relatório do orçamento SHALL exibi-los junto do acabamento.
2. THE exibição SHALL ser textual/descritiva, sem coluna de custo para a restrição/material.

### Requirement 5: Não-regressão do cálculo

**User Story:** Como mantenedor, quero garantir que adicionar restrições/materiais
não muda nenhum valor calculado, para preservar a paridade com o Calcgraf.

#### Acceptance Criteria

1. THE Motor_Calculo SHALL permanecer inalterado por esta spec.
2. THE suíte `orcamento-grafico` (incluindo o golden 15.235) SHALL continuar passando sem alteração de valores.
3. WHERE um orçamento não usa restrição/material, THE resultado SHALL ser idêntico ao atual (bit a bit no cálculo).
