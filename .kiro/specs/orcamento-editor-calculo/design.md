# Design — Editor do Cálculo (Planos do Cálculo)

## 1. Decisão de modelo

Alternativas avaliadas:
- (A) Transformar `PlanoCalculoGrafico` em folha e criar uma tabela nova de Tipo de Plano. Exige migrar
  todos os planos e telas existentes de uma vez. Alto risco.
- (B) **Escolhida.** Manter `PlanoCalculoGrafico` (e o plano implícito do item) como Tipo de Plano, sem
  mudança, e criar a tabela filha `FolhaCalculoGrafico` (Planos do Cálculo). Item sem folhas = cálculo
  atual. Aditivo e reversível: apagar as folhas volta o item ao comportamento de hoje.

## 2. Schema (aditivo; `migrate-prod.ts` no mesmo commit)

`LinhaProduto.modelo` VARCHAR(30) default 'SIMPLES'.

`FolhaCalculoGrafico` (`folha_calculo_grafico`):
| Campo | Tipo | Nota |
|---|---|---|
| id, empresaId, itemId | uuid | `itemId` → item (cascade) |
| planoId | uuid? | Tipo de Plano de origem (`PlanoCalculoGrafico`); null = plano único do item ou incluída no Editor |
| papel | CAPA \| MICRO \| CAPA_INTERNA \| AVULSO | |
| sequencia | int | ordem no Editor (`@@unique([itemId, sequencia])`) |
| nome | varchar(60) | |
| tiragem | int? | null = tiragem do item |
| formatoLarguraMm/AlturaMm | decimal | formato (A) |
| ocorrencias | int default 1 | |
| fibra | varchar(20)? | |
| suporteId, gramatura | | suporte cadastrado (id de papel) |
| suporteNc | Json? | suporte não cadastrado (nome, gramatura, espessura, formato, custo/kg, frete/kg, créditos) |
| formatoFolhaLarguraMm/AlturaMm | decimal? | formato (C) |
| aproveitamento | int? | peças por folha (B/C) |
| quebraFixa, quebraVariavel, apara | decimal? | |
| impressao | Json? | até 3 processos `{ cores, processoId, maquinaId, pre, coberturaId, tintas[] }` |
| opcoes | Json? | naoCalcular, naoCobrarImpressao, naoExibirProposta, tiraRetira, pinca, refileFolha, refileFinal, contraPinca, corteDuplo |
| camposManuais | Json? | lista de campos digitados no Editor |
| alteradaNoEditor | boolean | |
| resultadoCalculo | Json? | resultado do motor da folha |
| custoTotal | decimal? | custo do plano |

`AtividadeFolhaGrafico` (`atividade_folha_grafico`):
| Campo | Nota |
|---|---|
| id, empresaId, itemId | |
| folhaId? | null = atividade do produto ("Aplicado sobre" vazio) |
| acabamentoId | `AcabamentoGrafico` |
| sequencia | |
| detalhes Json | tiragem, producaoHora, entradas, repeticoes, tempoPrimeiroAcerto, quantAcertos, tempoPorAcerto, quebraFixa, quebraVariavel, formatoCorte, centroProducaoId, restricaoIds |
| camposManuais Json | |
| materiais Json | `[{ materialAcabamentoId, medida, coberturaFrente, coberturaVerso }]` |
| infoComplementar text | |

Índices por `empresaId` e `itemId`. Todas as consultas filtram `empresaId` explícito.

## 3. Geração (`gerar-folhas.ts`, função pura + serviço)

Entrada: modelo da linha, Tipos de Plano do item (ou plano implícito), atividades marcadas, folhas
existentes. Saída: lista de folhas e atividades.

```
para cada Tipo de Plano (ordem):
  capa = folha(papel CAPA, suporte da capa, impressão do tipo, formato aberto)
  se modelo = CARTUCHO_COMPOSTO:
    se especificacao.microondulado.suporteId → folha MICRO (sem impressão, nome + " (M)" na tela)
    se especificacao.capaInterna.suporteId → folha CAPA_INTERNA (cores/processo/cobertura da capa interna)
  atividades marcadas:
    CARTUCHO_COMPOSTO: acoplagem → MICRO (senão CAPA_INTERNA, senão CAPA);
                       corte inicial (cortadeira/guilhotina) → cada folha;
                       demais → CAPA
    outros modelos: todas na CAPA
```
- A classificação "acoplagem" e "corte inicial" vem do cadastro da atividade (tipo de processo do centro:
  ACOPLAGEM / CORTADEIRA / GUILHOTINA) e não do nome. Se o cadastro não tiver a informação, cai na capa.
- Regerar: casa folha antiga × nova por (planoId, papel). Campos em `camposManuais` mantêm o valor antigo;
  se algum valor gerado diferir de um manual, `alteradaNoEditor = true`. Folhas AVULSO nunca são apagadas
  pela regeração.

## 4. Cálculo

`calcularItemPorFolhas(item)`: para cada folha sem `naoCalcular`, monta os params do motor como hoje
(`montarParamsDoPlano`) com os dados da folha (suporte, formato da folha, aproveitamento manual, impressão,
atividades da folha) e chama `calcularPlano`. Folha MICRO sem impressão: `numCores = 0`.
`naoCobrarImpressao` zera a impressão da folha. Soma = custo do item; tiragens usam o mesmo caminho
(`sincronizarTiragensDoItem` passa a usar folhas quando existirem). Atividades do produto entram uma vez.
Ancoragem: item com `calculoGraficoOrigemId` continua ancorado (não muda).
Camadas (`camadas-plano.ts`) desligadas quando o item tem folhas.

## 5. API (prefixo `/api/orcamento-grafico`)
- `GET /:id/itens/:itemId/editor` — cabeçalho + produto + folhas + atividades (+ custo por folha).
- `POST /:id/itens/:itemId/editor/gerar` — gera/regenera.
- `POST /:id/itens/:itemId/folhas`, `PUT/DELETE .../folhas/:folhaId`, `POST .../folhas/:folhaId/copiar`,
  `PATCH .../folhas/ordem`.
- `PUT .../atividades` (lista com aplicado-sobre), `PUT .../atividades/:atividadeId` (detalhes/materiais).
- `POST .../editor/calcular` — prévia do custo por folha sem gravar.
Todas sob a guarda do fluxo (setor ORÇAMENTO) e só em Rascunho para escrita.

## 6. Wireframe (texto) — APROVAR ANTES DE IMPLEMENTAR O FRONT

Tela do item (sem mudança) ganha o botão `[Editor]` ao lado de Calcular.

```
EDITOR DO CÁLCULO — Item 1 · Caixa Garrafa Império Gold          [Calcular] [Fechar]
Cálculo nº 15650 · Linha: Cartucho Composto · Tiragem [208.000 v] · Sigla: |vários|
Gerado a partir do cálculo 15341                                      [Gerar planos]
┌ Produto ─────────────────────────────────────────────────────────────────────────┐
│ Produto            Tiragem   Formato        Acabamento                           │
│ Cartucho Composto  208.000   207x164x333    (atividades do produto)               │
└──────────────────────────────────────────────────────────────────────────────────┘
┌ Planos do Cálculo ───────────────────────────────────────────────────────────────┐
│ Plano       Tiragem  Suporte              Formato  Pré   Impressão     Acab.  Custo│
│ Cartão      208.000  Stora Enzo 290       490x790  CTP   6x0 Offset   ...  291.172│
│ Cartão (M)  208.000  Micro Pardo 245      490x790   –    –            Bimac  ...  │
│                                     [+ Incluir] [Copiar] [Excluir] [↑] [↓]        │
└──────────────────────────────────────────────────────────────────────────────────┘
┌ Atividades de Acabamento ────────────────────────────┐┌ Aplicado sobre ───────────┐
│ [x] Cortadeira (Grande)  [ ] SG (Laminadora) ...     ││ [x] Cartão                │
│ [x] Guilhotina maior     [x] Bimac (Acoplagem) ...   ││ [ ] Cartão (M)            │
│ (lista do cadastro, filtrada pela linha)             ││ [Detalhes...]             │
└──────────────────────────────────────────────────────┘└───────────────────────────┘
Itens Diversos: PALETES                         Itens Fornecidos: —
```
Duplo clique numa linha de "Planos do Cálculo" abre a janela PLANOS (modal grande):
```
PLANOS — Cartão                                              Custo do Plano: R$ 291.172,68
┌ Plano ───────────────────────────┐ ┌ Impressão  [1] [2] [3] ───────────────────────┐
│ Tipo [Cartão v] Nome [Cartão]     │ │ Cores [6x0] Processo [Offset Plana v]          │
│ Tiragem [208000] Formato(A) 490x790│ │ [x] CTP  Fotolito [..] Contatos [..] Mont. [..]│
│ Ocorrências [1]/[1] Fibra [0]     │ │ Cobertura [Definição Manual v]                 │
├ Suporte ─────────────────────────┤ │ # Tinta      Compl.          Cob%              │
│ Tipo/gram. [Stora Enzo 290 v][NC] │ │ 1 Escala     CMYK            20                │
│ Formato(C) [815x520] Fibra [0]    │ │ 2 Pantone 01 CW0249 - OCRE   10        [+][-]  │
│ Aprov.(B/C) [1x1] (A/C) [1]       │ └────────────────────────────────────────────────┘
│ Quebra fixa% [] var% [] total% [] Apara% [8,7]                                       │
├ Opções ───────────────────────────────────────────────────────────────────────────┤
│ [ ] Não calcular plano  [ ] Não cobrar impressão  [ ] Não exibir na proposta       │
│ Atividade        Repet.  Formato(B)  Centro de Produção      Cores  T/R  Ent.       │
│ Offset Plana 6x0 1x1     520x810     Heidelberg CD 7cores    6x0    Não  1          │
│ Guilhotina maior 1x1     520x810     Guilhotina maior                               │
│ [ ] Permitir tira/retira  [ ] Considerar pinça  Refile folha [0] final [0]          │
│ Contra-pinça [0]  Corte duplo [0]                                        [Fechar]   │
└───────────────────────────────────────────────────────────────────────────────────┘
```
Campo digitado à mão aparece com destaque (cor de "manual") e um botão "voltar ao calculado".
"Detalhes..." abre a janela da atividade naquele plano (tiragem, produção/hora, entradas, repetições,
acertos, tempos, quebras, formato de corte, centro, restrições, materiais com cobertura frente/verso,
informação complementar).

Status por item na grade do orçamento: coluna Status mostra "Ped: N" / "OP: N" com link.

## 7. Testes
- Puro: geração (capa/micro/capa interna, repartição, regeração preservando manuais, AVULSO preservado),
  property: regerar 2× = mesmo resultado; item sem folhas = cálculo idêntico ao atual.
- Rotas: isolamento por empresa (404), Rascunho, guarda do fluxo.
- Front: Editor renderiza folhas, aplicado sobre, janela Planos.
