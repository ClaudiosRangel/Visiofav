# Design — Várias tiragens por item (substitui `orcamento-grafico-varias-tiragens`)

Status: APROVADO pelo usuário em 19/11/2026. Execução pela ordem do tasks.md.

## 1. Evidência (Calcgraf real + banco restaurado, 19/11/2026)

- O campo "Tiragens" do item aceita lista separada por vírgula (ex.: `2.000,4.000,6.000,8.000,10.000,15.000`).
  Vale para TODOS os planos do item (item multi-plano ou plano único).
- A listagem de orçamentos mostra todas as tiragens do orçamento (5639/1: 6 tiragens, status Liberado).
  O orçamento já pedido (5640/1, Ped: 3042) mostra uma tiragem (12.000).
- Aprovação: o usuário confirmou que o Calcgraf **aprova todas** as tiragens.
- O grid "Tipos de Plano" NÃO mostra custo nem valor por plano. O total fica no Fechamento do orçamento,
  uma linha por tiragem, somando os planos (e os itens).
- Frequência (8.062 cálculos do backup): 2.448 têm várias tiragens (30%); 820 multi-plano e 1.628 plano único.
- Tabelas do Calcgraf:
  - `CalculoTiragens`: 1 linha por tiragem. Guarda `ItemMargem` (0/1/2 = faixa escolhida), `ValorTotalVenda`,
    `AliqMargem`, `ValorContMarginal` e `FlagValorInformado`.
  - `FlagValorInformado = -1` em 12.800 de 16.183 linhas (79%): o usuário DIGITOU o valor total e a margem é
    calculada de volta (ex.: 15168 → 57.000 / 104.000 / 190.000 com margens 23,96% / 23,51% / 20,83%).
    Nos demais 21% ele escolheu uma das 3 faixas (10% / média / 30%), por tiragem (`CalculoMargens.ItemTiragem`).
  - `CalculoResAgrupamento`: custo = `CustoFixo + CustoUnitario × tiragem` por agrupamento. Calculável para
    qualquer tiragem.
  - `CalculoPlanos.tiragem` é informativa (no 15168 é 23.333 = média das 3 tiragens). Não é override por plano.

## 2. Decisões

D1. Lista de tiragens é do ITEM; vale para todos os planos. O campo Tiragem do plano continua "(padrão)".
D2. O item guarda UMA linha por tiragem (tabela nova). `ItemOrcamentoGrafico.quantidade/custoProducao/valorTotal`
    seguem existindo e espelham a **tiragem de referência** (a primeira da lista). Assim pedido, relatórios e
    ancoragem existentes continuam funcionando sem mudança. Item sem linhas na tabela nova = comportamento de hoje.
D3. Custo de cada tiragem = soma dos planos calculados naquela tiragem (`somaPlanos`), motor chamado 1× por
    plano e por tiragem. `calcularOrcamentoGrafico` e `ancorarCustoCalcgraf` NÃO mudam.
D4. Margem por tiragem: o usuário digita o valor total (margem calculada de volta pelo gross-up de
    `formarPrecoVenda`) OU escolhe uma das faixas de margem. Guarda-se `valorInformado`.
D5. Fechamento do orçamento: uma linha por tiragem. Cada linha soma os itens que têm aquela tiragem.
D6. Aprovação (APROVADA em 19/11/2026, evidência no banco restaurado: 418 de 418 cálculos multi-tiragem que viraram OP geraram 1 único lote de OP, com UMA das tiragens do cálculo + 10% de excedente): o orçamento guarda todas as tiragens até a aprovação; ao aprovar com mais de uma tiragem, a escolha da tiragem é OBRIGATÓRIA e o PedidoVenda recebe só ela. Um item com 1 tiragem aprova como hoje.
D7. Cálculos migrados (7.951): não mudam. Backfill das demais tiragens a partir de `CalculoTiragens` +
    `CalculoResAgrupamento` fica como fase posterior opcional (custo ancorado por tiragem = fixo + unit × tiragem).

## 3. Schema (aditivo)

Tabela `item_tiragem_orcamento_grafico`:
`id, empresaId, itemId (FK cascade), ordem, quantidade, custoProducao, materialDireto, custoTransformacao,
servicoExterno, margemPerc Decimal(9,4), valorTotal, valorInformado Boolean, cmValor, cmPerc,
@@unique([itemId, quantidade]), @@index([empresaId, itemId])`.
`migrate-prod.ts`: `CREATE TABLE IF NOT EXISTS` + índices, idempotente, testado 2×, no mesmo commit do schema.
`margemSelecionada` do item hoje é Decimal(5,2); a margem de retorno exige 4 casas, por isso `margemPerc` própria.

## 4. Back
- `tiragens-item.service.ts` (puro + persistência): calcula todas as tiragens do item (plano único = item achatado;
  multi-plano = soma dos planos), grava linhas, espelha a de referência no item. `empresaId` explícito em toda query.
- Rotas: PUT do item aceita `tiragens: number[]` (1..20, positivos, sem repetição); GET do item devolve `tiragens[]`.
  `PUT /:id/itens/:itemId/tiragens/:quantidade` grava `valorTotal` informado OU `margemPerc`.
- `reconsolidarItemComPlanos` passa a recalcular as linhas de tiragem quando houver. Sem linhas, caminho legado.
- `fechamento-totalizador`: lê as linhas de tiragem (e o item sem linhas como uma tiragem virtual).

## 5. Front
- `TelaItem`: campo "Tiragens" (texto com vírgulas, `parseFaixasTiragem`) nos dois tipos de item. Remove a leitura
  das tiragens a partir das observações do orçamento.
- `AbaFechamento`: grid Tiragem | Margem | C.Marg. | Valor Unitário | Valor Total, editável (digitar valor ou faixa).
- `GridPlanos`: sem mudança (sem custo por plano, como no Calcgraf).

## 6. Decisões fechadas
P1 (resolvida): o PedidoVenda recebe uma única tiragem, escolhida na aprovação. A conferir na implementação: o excedente de 10% da OP (fixo ou parâmetro) e a quantidade do PedidoItem, que o join do banco restaurado não retornou.

## 7. Pendências conhecidas
- Margem de volta do Calcgraf: no cálculo 15168 o AliqMargem gravado difere em ~3 pontos da margem que sai da fórmula do motor com o CEV conhecido (ICMS 3 + PIS/Cofins 9,25 + comissão 3 + juros 2 = 17,25%). O CEV implícito varia por tiragem (20,45 / 20,54 / 20,65). Há componente de CEV ainda não decifrado. O VALOR total digitado vale; só a margem exibida pode divergir do Calcgraf. Tratar na tarefa 6 ou depois.
- Item ancorado (puxado de cálculo): calcularNaTiragem deve devolver o custo ancorado na quantidade de origem, para o espelho não sobrescrever o valor real.
- A baseline do 	sc --noEmit hoje é de 139 erros (regra citava 65); nenhum nos arquivos desta spec.
- Coluna contexto (JSON) na tabela de tiragens: guarda margem, CEV, créditos e encargo usados no cálculo, para refazer o valor de uma tiragem (valor digitado ou margem) sem reconstruir o item.
- Copiar item (item-copia.service) ainda NÃO copia as linhas de tiragem. Tratar na tarefa 5 ou 6.
- Recalcular tiragens a partir das rotas de PLANO reconstrói o input do item pelo persistido (mesma limitação já existente nas rotas de plano): margemOverride e 	abelaMargemId do Fechamento editável não são reaplicados. O recálculo pelo PUT/POST do item usa o input completo do corpo.
- Item multi-plano: o valor de cada tiragem passa a ser formado pelo preço do motor (custo / (1 − margem − CEV)), e o espelho no item substitui o valor derivado da proporção antiga de econsolidarItemComPlanos.
- Outras tiragens de item ancorado usam o motor (~5% abaixo do Calcgraf, como no recálculo do zero); o backfill por CalculoSTC (tarefa 8) corrige isso.
