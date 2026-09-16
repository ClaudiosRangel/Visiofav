# Requirements — Orçamento Gráfico: materiais na OP + modo Repetição

## Introdução

Alinhar o Vizor ao modelo do Calcgraf: o orçamento gráfico gera a OP com
materiais em dois cenários — produto novo (materiais vindos do cálculo do
orçamento) e repetição/reimpressão (produto cadastrado com BOM). O vínculo do
produto é opcional e informado na origem (solicitação/orçamento do rep).

## Requirements

### Requisito 1 — Materiais da OP no orçamento por especificação (produto novo)

**User Story:** Como PCP, quero que a OP gerada de um orçamento por
especificação já traga os materiais calculados, para não ficar "sem materiais".

#### Acceptance Criteria
1. QUANDO a OP é gerada de um orçamento SEM produto vinculado, ENTÃO o sistema
   DEVE criar `ItemOrdemProducao` a partir do `resultadoCalculo`:
   papel (pesoKg), uma tinta por cor (consumoKg) e materiais de acabamento
   quando o cálculo indicar consumo.
2. Os itens gerados DEVEM ter `tipoMaterial` coerente (PAPEL, TINTA, VERNIZ,
   OUTRO) e unidade KG quando aplicável.
3. QUANDO o orçamento não tiver `resultadoCalculo`, ENTÃO a OP é criada sem
   materiais e o sistema DEVE registrar aviso.

### Requisito 2 — Modo Repetição (produto cadastrado)

**User Story:** Como representante, quero indicar que o orçamento é a repetição
de um produto já cadastrado, para a OP herdar a BOM e o roteiro dele.

#### Acceptance Criteria
1. O sistema DEVE permitir vincular OPCIONALMENTE um produto cadastrado na
   solicitação/orçamento (`produtoId`).
2. QUANDO há produto vinculado com EstruturaProduto ATIVA, ENTÃO a OP DEVE ser
   criada com esse `produtoId`/`estruturaProdutoId` e os materiais DEVEM vir da
   **BOM** (explosão da estrutura).
3. QUANDO há produto vinculado com Roteiro ATIVO, ENTÃO as etapas DEVEM vir do
   roteiro; senão, das etapas do `resultadoCalculo`.
4. QUANDO o produto vinculado NÃO tiver BOM ATIVA, ENTÃO o sistema DEVE cair
   para os materiais do cálculo (Requisito 1) e registrar aviso.

### Requisito 3 — Seleção do produto na origem (Opção 3)

**User Story:** Como representante/orçamentista, quero escolher o produto de
repetição no início (solicitação/orçamento), mantendo o vínculo até a OP.

#### Acceptance Criteria
1. O Portal do rep e o wizard interno DEVEM ter um campo OPCIONAL de produto
   ("Repetição de produto existente").
2. O `produtoId` escolhido DEVE propagar solicitação → orçamento → pedido → OP.
3. Vazio = produto novo por especificação (comportamento do Requisito 1).

### Requisito 4 — Momento da geração dos materiais

**User Story:** Como gestor, quero que os materiais sejam empenhados no momento
da emissão da OP (padrão Calcgraf), não antes.

#### Acceptance Criteria
1. A geração de `ItemOrdemProducao` DEVE ocorrer na emissão/geração da OP
   (Análise de Produção → Gerar OP / confirmar), não na criação do orçamento.
2. A geração DEVE ser idempotente (não duplicar itens ao reprocessar).

### Requisito 5 — Compatibilidade e migração

#### Acceptance Criteria
1. O campo `produtoId` em `SolicitacaoOrcamentoRep`/`OrcamentoGrafico` DEVE ser
   adicionado idempotentemente em `migrate-prod.ts`.
2. Orçamentos existentes (sem produto) DEVEM continuar funcionando pelo
   Cenário A.
