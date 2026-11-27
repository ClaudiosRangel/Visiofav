# Estudo — Editor do Cálculo, Tipos de Plano × Planos do Cálculo e Status do item (Calcgraf)

Estudo feito sobre o banco restaurado `CalcgrafCartonWega` (somente leitura), a partir dos prints do
orçamento 5619 (Cervejaria Cidade Imperial, cálculo 15650). O 5619 não está no banco restaurado; o
mesmo comportamento foi reproduzido com o orçamento **5306** (mesmo cliente 149, mesma caixa
"Império Gold 210ml", cálculos 15061 / 15169 / 15171) e com os cálculos 15168, 15174 e 15187.

## 1. Três camadas (e não duas)

| Camada | Tela no Calcgraf | Tabela no banco | O que guarda |
|---|---|---|---|
| Orçamento | "Orçamentos" (lista de itens + Fechamento) | `Solicitacao` (série/número, cliente principal, status) | cabeçalho; cada item é um CÁLCULO |
| Item = Cálculo | janela do produto ("CARTUCHO COMPOSTO") | `CalculoHeader` (+ `CalculoAcabados`, `CalculoTiragens`) | dados do produto; ligação `CodSolicitacao` + `OrdemItemSol` (nº do item) |
| **Tipos de Plano** (entrada resumida) | grid "Tipos de Plano" da janela do produto + "Alteração de Tipo de Plano" | `Especialista<Linha>xTiposPlano` (ex.: `EspecialistaCartuchoCompostoxTiposPlano`) + `Especialista<Linha>` (dimensões do produto) | o que o usuário informa: nome, tipo de plano (`codTipoPlano`/`CodPlanoCad`), cores F×V, processo, suporte/gramatura da capa externa, formato aberto |
| **Planos do Cálculo** (engenharia real) | **Editor** (botão "Editor") → grid "Planos" → janela "Planos" | `CalculoPlanos` (+ `CalculoAtividades`, `CalculoAtvImpressao`, `CalculoTintas`, `CalculoEstrutura`) | os planos que o motor calcula de fato: suporte, formato da folha, aproveitamento, quebras, refiles, atividades por plano, tintas por plano, custo do plano |

Ou seja: cada item tem UM cálculo; dentro dele há a lista curta de **Tipos de Plano** (o que o vendedor
preenche) e a lista expandida de **Planos do Cálculo** (o que o motor custeia). O Editor trabalha na
segunda.

## 2. Por que 1 Tipo de Plano vira 2 (ou 3) planos no Editor

A expansão acontece quando o Tipo de Plano tem microondulado e/ou capa interna. Confirmado no banco:

- **15061 / 15169 / 15171** (o mesmo caso do print): 1 Tipo de Plano "Cartão" →
  2 planos: `Cartão` (capa externa, suporte 8 = Stora Enzo, 290 g) e `Cartão` com `FlagMicro = -1`
  (suporte 1034 = Micro Pardo, 245 g). O Editor exibe o segundo como **"Cartão (M)"**; no banco o nome é
  o mesmo, quem marca é `FlagMicro`.
- **15168**: 1 Tipo de Plano → 3 planos: capa externa, micro (`FlagMicro`) e **capa interna**
  (`FlagCapaMicro = -1`).
- **15174**: 3 Tipos de Plano (TAMPA, CAIXA, BOLSA) → 5 planos (TAMPA + TAMPA micro, CAIXA + CAIXA micro, BOLSA).

Regra deduzida:
```
para cada Tipo de Plano:
  plano 1 = capa externa (suporte da capa, cores/processo do tipo, formato aberto)
  se tem suporte microondulado  → plano 2 = micro   (FlagMicro,     suporte micro, sem impressão)
  se tem suporte de capa interna → plano 3 = capa interna (FlagCapaMicro, cores/processo da capa interna)
todos herdam: CodTipoPlano, codPlanoCad, tiragem, ocorrências, dimensões do produto
```
Os três planos gerados ficam ligados ao mesmo `CodTipoPlano` (é assim que o Calcgraf sabe que vieram do
mesmo Tipo de Plano).

## 3. Atividades distribuídas por plano

`CalculoAtividades.codPlanoAcabado` diz em qual plano a atividade roda (`tipo`: I = impressão,
A = acabamento, M = material/verniz). Exemplo 15061:

| Plano | Atividades |
|---|---|
| 1 (capa) | Offset Plana (I), Cortadeira (Grande), Guilhotina maior, Verniz (M), Bobst E, Destacar |
| 2 (micro) | Mazola (acoplagem) |

No 15187 (capa interna) o plano 2 recebe Cortadeira, Guilhotina e Jato (acoplagem): cada folha gerada tem
o seu próprio preparo (corte), e a **acoplagem fica no plano que é colado** (micro ou capa interna).
No Tipo de Plano o usuário marca uma lista única de atividades; na expansão o sistema reparte: impressão,
verniz, corte e vinco e destaque vão para a capa; acoplagem vai para o micro/capa interna; o corte inicial
(cortadeira/guilhotina) vai para cada folha.

Tintas também são por plano (`CalculoTintas.codPlano`), com cobertura (`areaTinta`) e complemento.

## 4. O que o Editor permite (janela "Planos")

Por plano, editável: tipo/nome, tiragem, formato (A), ocorrências, fibra; suporte (tipo/gramatura, formato
da folha (C), aproveitamento B/C e A/C, "NC" = suporte não cadastrado com custo/kg, ICMS/IPI de crédito);
quebras fixa/variável/total e apara; flags **Não calcular plano**, **Não cobrar impressão**, **Não exibir
na proposta**; grade de atividades (repetições, formato (B), centro de produção, cores, tira/retira,
entradas); **Permitir tira/retira**, **Considerar pinça**, refile folha/final, contra-pinça, corte duplo;
impressão em até 3 processos (abas 1/2/3): cores, processo, CTP/fotolito/contatos/montagem, cobertura e
lista de tintas; e o **Custo do Plano** recalculado na hora.

Botões do Editor: incluir, copiar, excluir e reordenar planos. Plano incluído pelo Editor nasce vazio com os
padrões de folha (tira/retira e pinça ligados, refile folha 2, refile final 1, contra-pinça 8).

Campos `man*` (`manTiragem`, `manDimPlano`, `manFormSuporte`, `manQuebraPlanoFix`, `manCodCpr`,
`manDimCorte`, ...) marcam o que o usuário digitou à mão no Editor e que o recálculo NÃO deve sobrescrever.
`CalculoPlanos.FlagAlteradoEditorxExpressa = -1` marca o plano mexido no Editor de forma que já não bate com
o Tipo de Plano (1.379 planos no banco). Na prática: o Tipo de Plano gera os planos; o Editor refina; se o
usuário voltar ao Tipo de Plano e regenerar, os campos manuais são preservados (por isso o `codPlano` dos
planos do 15174 vai de 14 a 18: foram regenerados várias vezes).

## 5. "Gerado a partir do cálculo" e itens que repetem

`CalculoHeader.CodCalculoOrigemLer` = cálculo de onde este foi copiado (o texto "Gerado a partir do
cálculo: 15341" do Editor). No orçamento 5306: item 1 (15061) veio do 14790; itens 2 e 3 (15169, 15171)
vieram do item 1 (15061), com outra tiragem e outro suporte. É o mesmo padrão do 5619 (4 itens do mesmo
produto em tiragens diferentes).

"Sigla Acabado |vários|" = o item tem lista de acabados em `CalculoAcabadosEstoque` (produto 3231, quantidade
por acabado).

## 6. Status do item (coluna Status)

`CalculoHeader.Status` (contagem no banco): `OP` 6.125, `LB` 2.383 (liberado), `PR` 1.443 (proposta),
`PA` 1.018 (pedido), `NC` 23, vazio/NULL 569.

- **OP: N** — ao emitir a OP o Calcgraf **copia o cálculo** (novo `Codigo`, mesmo `NumCalculo`,
  `CodSolicitacao = -1`) e liga a cópia à OP por `CodOpItemEstrutura` → `OpItemEstrutura` → `OpHeader.Numero`.
  Ex.: 15169 → cópia 15173 → OP 3132; 15171 → cópia 15175 → OP 3134. A cópia é a "foto" usada pela OP:
  editar o orçamento depois não muda a OP.
- **Ped: N** — item com status `PA`. Conferido: o 15061 (234.000 × R$ 3,219) corresponde ao pedido **2904**
  (item com o acabado 3231, 234.000 un a 3,219, mesma data do orçamento). Não achei a coluna que grava esse
  vínculo (provavelmente fica no código do Calcgraf ou por acabado + quantidade); para o Vizor isso não
  importa, porque o nosso pedido já guarda o orçamento/item de origem.
- Ao abrir o status (duplo clique) o Calcgraf leva ao pedido ou à OP daquele item.

## 7. Comparação com o Vizor hoje

| Calcgraf | Vizor hoje |
|---|---|
| Item = 1 cálculo | `ItemOrcamentoGrafico` (ok) |
| Tipos de Plano (entrada resumida, grid do item) | `PlanoCalculoGrafico` (cada linha do grid = 1 plano) |
| Planos do Cálculo (expansão capa/micro/capa interna) | **não existe**: cada Tipo de Plano é calculado como 1 plano só; micro e capa interna entram como campos do mesmo plano |
| Editor (refinar plano a plano, incluir/copiar/excluir planos, custo por plano, campos manuais) | **não existe** |
| Atividades por plano (`codPlanoAcabado`) | acabamentos do plano (`acabamentosRicos`) — sem repartição capa/micro |
| Cópia do cálculo ao emitir OP | OP gerada do pedido; sem foto do cálculo por OP |
| Status por item (Ped/OP com link) | status no orçamento/pedido; não por item |

## 7.1 Quais linhas expandem planos (verificado no banco)

Planos por linha de produto (`CalculoPlanos` × `CalculoHeader.CodLinhaProduto`):

| Linha | Cálculos | Planos | Micro (`FlagMicro`) | Capa interna (`FlagCapaMicro`) | Planos mexidos no Editor |
|---|---|---|---|---|---|
| CARTUCHO COMPOSTO (15) | 2.555 | 5.819 | 2.370 | 331 | 820 |
| CARTUCHO (5) | 6.894 | 7.169 | 0 | 0 | 257 |
| LÂMINAS (1) | 1.004 | 1.072 | 0 | 0 | 236 |
| LÂMINA SIMPLES (3) | 374 | 376 | 0 | 0 | 2 |
| SACOLA (11) | 234 | 272 | 0 | 0 | 62 |

- **A expansão capa / micro / capa interna só existe no Cartucho Composto.**
- **Lâminas** é multi-plano, mas 1 Tipo de Plano = 1 plano do cálculo (cada plano com seu `CodTipoPlano`:
  ex. 14649 MONT01..MONT05; 13993 três lâminas de tempero). Sem micro.
- **Cartucho e Lâmina Simples** (plano único no item) também usam o Editor: há cálculos com um plano a mais
  incluído no Editor no mesmo tipo de plano (ex. 15113/15114 CARTUCHO + BERÇO; 15102 FRUTAS + CHOCOLATE).
  Ou seja, o Editor vale para todas as linhas; a expansão automática é só do Cartucho Composto.

## 7.2 Atividade "Aplicado sobre" e "Detalhes..." (informação do usuário, confirmada no banco)

- **Aplicado sobre** = em quais planos do cálculo a atividade roda. Cada plano marcado vira uma linha em
  `CalculoAtividades` com `codPlanoAcabado` = aquele plano. Ex. 15174: Bimac (Acoplagem) tem uma linha no
  plano 16 (TAMPA (M)) e outra no 18 (CAIXA (M)); Cortadeira, Corte e Vinco e Destacar têm uma linha por
  folha. `codPlanoAcabado = -1` = atividade do PRODUTO (ex.: Seladora Bolsa, Fechadora de Caixa).
  Acoplagem (Mazola, Jato ou Bimac) é marcada nos planos (M), que são os que se colam à capa.
- **Detalhes...** abre a janela da atividade por plano ("Acabamento: Laminação maior", "HotStamping"):
  tiragem, produção/hora, entradas, repetições (ex. 2x2), tempo do 1º acerto, quantidade de acertos,
  tempo por acerto, quebra fixa % e variável %, formato de corte, centro de produção e restrições. No banco:
  as mesmas colunas de `CalculoAtividades` (`producaoHora`, `entradas`, `manRepeticoes`,
  `tempoPrimeiroAcerto`, `quantAcertos`, `tempoPorAcerto`, `quebraFixa`, `quebraVariavel`, `dimCorte1/2`,
  `codCentroCusto`, `codRestricao0..9`) com os `man*` marcando o que foi digitado.
- **Materiais da atividade** (ex. BOPP Brilho/Fosco/Holográfico na laminação; Filme Hot Stamping com a
  medida 50x100): `CalculoMatAcabamento` por (atividade `codAtvAcabamento`, plano `codPlanoAcabado`,
  material), com `ParamAcab1/2` = **área de cobertura % frente/verso** (ex. 100 / 0; Bimac 60).
- **Informação complementar por atividade**: `CalculoAtvAcabamento.InfoComplementar` (ex.
  "Matriz: 2570B - Caixa (Faca Nova) / 2477B - Tampa / 2478B - Bolsa", "Segue obs de impressão").

## 7.3 O que configura o Cartucho Composto a expandir (verificado no banco)

Não há uma flag "expandir micro" em tabela. O comportamento vem da **Expressa** (o modelo de tela e de
regra) que cada Linha de Produto usa:

`_LinhasProduto.IdExpressa`:

| Linha | Expressa |
|---|---|
| LÂMINAS, EDITORIAL, TAMPA/FUNDO, DISPLAY, CARDS | EDITORIAL (multi-plano, 1 tipo = 1 plano; tabela `EspecialistaEditorialxTiposPlano`) |
| LÂMINA SIMPLES, CARTUCHO, RÓTULO, SACOLA | SIMPLES (plano único + planos adicionais; `EspecialistaSimples`, `EspecialistaSimplesPlanosAdicionais`) |
| CONTÍNUO, BLOCADO | BLOCADO |
| CARTUCHO COMPOSTO | **CARTUCHO COMPOSTO** (capa + micro + capa interna; `EspecialistaCartuchoCompostoxTiposPlano`) |
| PRÉ-IMPRESSÃO, FLEXÍVEL, ETIQUETA FLEXO, REVENDA | expressas próprias |

Ou seja: a regra (gerar capa/micro/capa interna) está no código da expressa CARTUCHO COMPOSTO; a
CONFIGURAÇÃO é qual expressa cada linha usa. Mais duas tabelas de configuração participam:

- `Planos` = Tipos de Plano por linha. Cartucho Composto: Cartão (8), Microondulado (9), Berço (10),
  Invólucros (11), todos "3 dimensões". Cartucho: CARTUCHO (FIXO). Lâminas: Envelope, Base, Impressos.
- `_CaracteristicasPlano` (linha × tipo de plano × campo × valor): `Plano Miolo`, `Tipo Ocorrencia`
  (todas as linhas); `Cálc.Autom.Formato`, `Dist. atividade N`, `Cód.ativ.dist. N`, `Somar lombada`,
  `Somar orelhas`, `Tipo Largura`, `Dist. entre páginas` (Lâminas e Editorial).

Micro e capa interna são OPCIONAIS por Tipo de Plano: só são gerados quando o suporte correspondente é
informado. No Cartucho Composto: 2.988 planos de capa sem acompanhamento, 2.360 micro, 319 capa interna
(tipo Cartão); Invólucros e Microondulado também aparecem com micro/capa interna.

No Vizor, `LinhaProduto` não tem o campo equivalente à Expressa. Para não fixar nomes no código, a
implementação precisa de um campo de configuração na Linha de Produto (modelo: SIMPLES | EDITORIAL |
CARTUCHO_COMPOSTO | ...) e, se quisermos paridade, das características por tipo de plano.

## 8. Proposta de implementação (para aprovar antes de codar)

1. **Planos do Cálculo como entidade filha do Tipo de Plano.** Nova tabela `plano_calculo_folha` (nome a
   definir) ligada ao `PlanoCalculoGrafico` (= Tipo de Plano), com `papel` = CAPA | MICRO | CAPA_INTERNA |
   AVULSO, suporte, formato da folha, aproveitamento, quebras, refiles, flags (não calcular/não cobrar
   impressão/não exibir), impressão (até 3 processos), tintas, atividades e `campos_manuais` (lista do que
   foi digitado no Editor). Schema + `migrate-prod.ts` no mesmo commit.
2. **Expansão automática** ao salvar o Tipo de Plano (regra da seção 2), repartindo as atividades
   (seção 3). Regenerar preserva os campos manuais e marca "alterado no Editor" quando divergir.
3. **Tela Editor do Cálculo** no item: grid Produto/Tiragem/Acabamento + grid dos Planos do Cálculo
   (Tiragem, Suporte, Formato, Pré-Impressão, Impressão, Acabamento), incluir/copiar/excluir/reordenar,
   janela "Planos" com os campos da seção 4 e o Custo do Plano ao vivo.
4. **Motor**: o custo do item passa a ser a soma dos Planos do Cálculo (hoje soma dos Tipos de Plano). O
   `calcularOrcamentoGrafico` NÃO muda (é chamado por folha); a ancoragem dos itens puxados continua igual.
5. **Status por item** na grade do orçamento: "Ped: N" / "OP: N" com link, a partir do pedido de venda e
   das OPs geradas do item.
6. (Opcional) Foto do cálculo ao emitir a OP, como o Calcgraf.

Decisões do usuário (27/11/2026): expansão e repartição só no Cartucho Composto (confirmado no banco,
seção 7.1); planos incluídos à mão no Editor aparecem também no grid de Tipos de Plano. Incluir no Editor:
"Aplicado sobre" por atividade, janela "Detalhes..." por atividade/plano e materiais com área de cobertura
(seção 7.2). O usuário vai passar mais recursos antes da implementação.
