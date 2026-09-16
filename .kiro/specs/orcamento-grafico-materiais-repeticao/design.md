# Design — Orçamento Gráfico: materiais na OP + modo Repetição (padrão Calcgraf)

## Visão geral

Hoje, quando um orçamento gráfico (ou a solicitação do representante) vira
Pedido de Venda → Ordem de Produção, a OP nasce **com etapas** (do
`resultadoCalculo`) mas **sem materiais** — o `gerarOpFromOrcamento` cria a OP
com `produtoId: null` e não popula `ItemOrdemProducao`. Resultado: a Análise de
Produção mostra "0 materiais".

Esta spec fecha essa lacuna seguindo o modelo do **Calcgraf** (referência do
setor gráfico), contemplando os dois cenários que ele oferece:

1. **Produto novo (orçamento por especificação)** — o caso mais comum. Não há
   produto cadastrado; o **próprio cálculo do orçamento** já sabe papel/tinta/
   cola/verniz pela especificação. Os materiais da OP são **gerados a partir
   do `resultadoCalculo`** (como o Calcgraf, que "empenha o material necessário
   ao trabalho após a emissão da ordem de produção").
2. **Repetição / Reimpressão (produto existente)** — quando o cliente repete um
   produto já cadastrado (com ficha técnica/BOM). O usuário **vincula o produto
   cadastrado** na origem (solicitação/orçamento), e a OP herda o `produtoId` +
   a BOM (EstruturaProduto ATIVA) do produto.

> Referência de mercado (Calcgraf, parafraseado para conformidade): o orçamento
> é feito por especificação/medidas via "especialistas" por segmento; há
> controles específicos para **reimpressão/reprodução** com reaproveitamento da
> ficha técnica; e o material é empenhado no estoque **após a emissão da OP**.

## Cenários e comportamento (espelhando o Calcgraf)

| Cenário | Origem do produto | Origem dos materiais da OP | Origem das etapas |
|---|---|---|---|
| A — Produto novo (especificação) | Sem produto (`produtoId` null) | **`resultadoCalculo`** do orçamento (papel + tintas + acabamentos) | `resultadoCalculo` (já existe) |
| B — Repetição (produto vinculado) | `produtoId` do produto escolhido | **BOM (EstruturaProduto ATIVA)** do produto; complementa com o cálculo se a BOM não cobrir | Roteiro ATIVO do produto se houver; senão, `resultadoCalculo` |

Em ambos, a geração de materiais acontece **na emissão da OP** (Análise de
Produção → Gerar OP / confirmar), não antes — igual ao Calcgraf.

## Modelo de dados

### `SolicitacaoOrcamentoRep` / `OrcamentoGrafico`
Adicionar vínculo opcional de repetição:
- `produtoId String?` — produto cadastrado quando é repetição. Opcional (null =
  produto novo por especificação).
- (Solicitação) `produtoId` propaga para o `OrcamentoGrafico` criado, e deste
  para o `PedidoVenda` (que já tem itens) e para a OP.

> Migração idempotente em `migrate-prod.ts` (regra do projeto).

### `OrcamentoGrafico`
Já tem `resultadoCalculo` (JSON) com `papel { pesoKg, custo }` e
`tinta.detalhePorCor[] { cor, consumoKg, custo }`. Esses são a fonte dos
materiais no Cenário A.

### `PedidoVenda` / `ItemPedidoVenda`
No Cenário B, o pedido passa a ter **item com o `produtoId`** real (hoje o
pedido gerado do orçamento não cria itens). No Cenário A, o pedido pode ter um
item "genérico" (produto null ou um produto-serviço), mantendo o valor.

## Componentes e mudanças

### 1. Geração de materiais a partir do cálculo (Cenário A) — backend
Em `orcamento-grafico-integracao.service.ts` (`gerarOpFromOrcamento`), após
criar a OP e as etapas, **gerar `ItemOrdemProducao`** a partir do
`resultadoCalculo`:
- **Papel**: 1 item `tipoMaterial='PAPEL'` com `quantidade = resultadoCalculo.papel.pesoKg`
  (unidade KG), descrição do papel (`papelDescricao`/gramatura).
- **Tintas**: 1 item por `resultadoCalculo.tinta.detalhePorCor[]`
  (`tipoMaterial='TINTA'`, `quantidade = consumoKg`).
- **Acabamentos com material** (verniz/laminação): item `VERNIZ`/`OUTRO` quando
  o cálculo indicar consumo de material.
- Sem BOM formal — são materiais "calculados", coerentes com o Calcgraf.
- Reaproveita o padrão de tags `[Cliente]`/`[Produto]` já existente.

### 2. Modo Repetição (Cenário B) — backend
Quando o orçamento/solicitação tem `produtoId`:
- A OP é criada com esse `produtoId` + `estruturaProdutoId` (BOM ATIVA).
- Materiais: explode a **BOM** (reaproveita `explodirBomParaOp`, já usado no
  caminho BOM+Roteiro da Análise de Produção).
- Etapas: usa o **Roteiro ATIVO** do produto se existir (`gerarEtapasOp`);
  senão, cai para as etapas do `resultadoCalculo`.
- Se a BOM não existir apesar do vínculo, faz fallback para o Cenário A
  (materiais do cálculo) com aviso.

### 3. Seleção do produto na origem (Opção 3) — frontend
- **Portal do rep** (solicitação) e **wizard interno** (orçamento): um campo
  **opcional** "Repetição de produto existente" (autocomplete de produtos
  cadastrados). Preenchido → modo repetição; vazio → especificação nova.
- No Calcgraf isso equivale ao fluxo de "reprodução" com ficha técnica.

### 4. Análise de Produção — exibição
- A OP passa a exibir os materiais (não mais "0 materiais") em ambos cenários.
- Sem mudança estrutural na tela; ela já lista `ItemOrdemProducao`.

## Tratamento de erros / bordas
- Cenário B com produto sem BOM ATIVA → fallback para materiais do cálculo +
  aviso "produto sem estrutura; materiais estimados pelo orçamento".
- Cálculo sem `resultadoCalculo` (orçamento não precificado) → OP sem materiais
  + aviso (já não deve ocorrer após a trava de "sem preço" já implementada).
- Idempotência preservada em `gerarOpFromOrcamento` (não duplica OP/itens).

## Estratégia de testes
- Unit: mapeamento `resultadoCalculo` → itens de material (papel/tintas/verniz).
- Serviço: Cenário A gera N itens do cálculo; Cenário B explode a BOM; fallback
  quando produto vinculado não tem BOM.
- E2E: solicitação do rep sem produto → OP com materiais do cálculo; solicitação
  com produto (repetição) → OP com materiais da BOM.

## Alinhamento com o Calcgraf (resumo)
- Orçar por especificação é o padrão (não exige produto) — ✅ mantido.
- Reimpressão/repetição reaproveita produto/ficha — ✅ Cenário B.
- Material empenhado após emissão da OP — ✅ geração de materiais no Gerar OP.
- Cálculo do orçamento já contém papel/tinta/cola — ✅ fonte dos materiais no
  Cenário A.
