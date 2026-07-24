# Módulo PCP — Planejamento e Controle de Produção (VisioFab / Carton Wega)

O VisioFab é um ERP gráfico multi-tenant (multi-empresa) usado pela Carton Wega,
fabricante de embalagens de papelão/papel (caixas, cartuchos, cartões). O
módulo **PCP** controla todo o ciclo produtivo: desde a **importação de uma
Ordem de Produção (OP) a partir do PDF gerado pelo sistema legado GPrint/
Calcograf**, passando pelo **planejamento** (BOM/estrutura, roteiro, etapas),
pela **execução no chão de fábrica** (painel de programação, apontamentos de
operador), até a **conclusão da OP e integração automática com o WMS**
(gerando entrada de produto acabado em estoque).

Backend: Fastify + Prisma (schema em `VisioFab.Wms.Back/prisma/schema.prisma`).
Frontend: Next.js/Mantine (`VisioFab.Wms.Front/src/app/(interna)/pcp/`).

Este documento existe para que sessões futuras de IA entendam o módulo sem
precisar reler todo o código-fonte. Sempre que uma mudança estrutural for
feita no PCP (novo model, nova rota, novo padrão), **atualize este arquivo**.

---

## 1. Modelo de dados (Prisma)

A seção PCP do schema está delimitada pelo comentário
`// PCP — PLANEJAMENTO E CONTROLE DA PRODUÇÃO` (schema.prisma, por volta da
linha 2020) e por `// PCP — ATRIBUTOS GRÁFICOS (EXTENSÃO INDÚSTRIA GRÁFICA)`
logo depois. Há também `DeParaImportacao`, mais adiante no schema (~linha
3552), usado exclusivamente pelo fluxo de importação de PDF.

### 1.1 Cadastros base de capacidade

**`CentroProducao`** (`centro_producao`) — representa uma máquina/setor/linha
de produção (ex: "Cortadeira Coin", "Impressão Heidelberg CD", "Acabamento").
Campos-chave:
- `tipo`: `MAQUINA | SETOR | LINHA`
- `tipoMaquina`: `IMPRESSAO | ACABAMENTO | CORTADEIRA | COLAGEM | VERNIZ` — é
  este campo (não uma entidade "Grupo" separada) que define o agrupamento
  visual usado no painel de programação (abas Cortadeira/Impressão/Acabamento).
- `capacidadeHora`, `custoHora`, `posicao` (ordem de exibição), `status`
  (ativo/inativo).
- Relacionamentos: `recursos` (RecursoProducao), `etapasRoteiro`,
  `etapasOp` (EtapaOrdemProducao), `apontamentos`.

**`RecursoProducao`** (`recurso_producao`) — recurso vinculado a um centro:
operador, ferramenta, molde, faca. `tipo`: `OPERADOR | FERRAMENTA | MOLDE |
FACA | OUTRO`. Tem `custoHora` próprio, opcionalmente vinculado a um
`CentroProducao`.

**`TurnoProducao`** (`turno_producao`) — turno de trabalho: `horaInicio`,
`horaFim`, `diasSemana` (array de int, 1=segunda...), `duracaoMinutos`.

### 1.2 Estrutura de produto (BOM) e Roteiro

**`EstruturaProduto`** (`estrutura_produto`) — a BOM (lista de materiais) de
um produto, versionada (`produtoId` + `versao`, único por empresa). Tem
`rendimento` (fator de conversão entre quantidade da OP e quantidade da
estrutura) e `status`: `RASCUNHO | ATIVA | INATIVA`. Só estruturas `ATIVA`
são usadas na explosão automática de OP.

**`ItemEstrutura`** (`item_estrutura`) — item/componente da BOM. Além dos
campos genéricos (`quantidade`, `unidadeMedida`, `percentualPerda`,
`quantidadeLiquida = quantidade * (1 + perda/100)`), tem campos
**específicos da indústria gráfica**:
- `aproveitamento`: peças/impressos por folha ou puxada (imposição)
- `perdaFixaAcerto`: quantidade fixa gasta no setup/acerto de máquina,
  independente da tiragem
- `coberturaPercent`: % de cobertura de tinta/verniz/revestimento
- `tipoComponente`: `MATERIA_PRIMA | COMPONENTE | INSUMO | EMBALAGEM`

**`RoteiroProducao`** (`roteiro_producao`) — sequência de operações de um
produto, versionado como a estrutura. Só roteiros `ATIVO` são usados para
gerar as etapas de uma OP nova.

**`EtapaRoteiro`** (`etapa_roteiro`) — uma etapa do roteiro-modelo:
`sequencia`, `centroProducaoId`, `recursoId?`, tempos em minutos
(`tempoSetupMinutos`, `tempoOperacaoMinutos`, `tempoEsperaMinutos`,
`tempoTotalMinutos`). Ao criar uma OP, essas etapas são clonadas para
`EtapaOrdemProducao`, com o tempo de operação multiplicado pela quantidade da
OP (ver `gerarEtapasOp()` em `ordem-producao.service.ts`).

### 1.3 A Ordem de Produção e suas entidades filhas

**`OrdemProducao`** (`ordem_producao`) — entidade central do módulo.

| Campo | Observação |
|---|---|
| `numero` | Sequencial por empresa (`@@unique([empresaId, numero])`). Gerado por `proximoNumeroOp()`. |
| `status` | Ver máquina de estados na seção 2. |
| `produtoId`, `estruturaProdutoId` | Podem ser `null` em OPs importadas via PDF sem vínculo de cadastro. |
| `clienteId` | **Frequentemente `null`** em OPs importadas — o nome real do cliente fica na tag `[Cliente]` de `observacoes` (ver seção 9). |
| `quantidade`, `quantidadeProduzida`, `quantidadeRejeitada`, `quantidadeExcedente` | Controle de produção real vs planejada. |
| `prioridade` | `BAIXA \| NORMAL \| ALTA \| URGENTE` — editável clicando na célula no painel (cicla em sequência). |
| `dataEntregaPrevista`, `dataEntregaOriginal`, `vezesPostergada` | Ao postergar a entrega, a data original é preservada e o contador incrementado (rota `PATCH /pcp/programacao/postergar-entrega`). |
| `observacoes` (`Text`) | **Campo overloaded** — armazena texto livre E tags estruturadas extraídas do PDF (`[Cliente]`, `[Produto]`, `[Matriz]`, `[Formato]`, `[TipoOp]`, `[Cores]`, `[Montagem]`, `[Tiragem]`, `[Bobina]`). Ver seção 9, é o padrão mais importante e menos óbvio do módulo. |
| `referenciaExterna` | Número da OP no sistema de origem (ex: `"2870"`, `"4-101"`) ou `AV-N` para OPs avulsas. |
| `origemImportacao` | `PDF_GPRINT \| MANUAL \| AVULSA \| null`. |
| `pdfData` (`Bytes?`) | **PDF binário (BYTEA) guardado no próprio banco.** Nunca deve ser retornado em queries de listagem/detalhe sem necessidade explícita — ver seção 9 (regra de `select` vs `omit`). |
| `grupoOpId` | Campo existe no schema mas **não há model `GrupoOp` implementado** nem uso ativo encontrado no código — trate como legado/reservado. |

Relacionamentos: `itens` (ItemOrdemProducao), `etapas`
(EtapaOrdemProducao), `apontamentos` (ApontamentoProducao), `logs`
(LogOrdemProducao), `liberacoes` (LiberacaoMaterial), `variacoes`
(VariacaoOrdemProducao), `programacoesEntrega` (ProgramacaoEntrega).

**`VariacaoOrdemProducao`** (`variacao_ordem_producao`) — permite múltiplos
itens/cores dentro da mesma OP (ex: mesma caixa em 3 cores diferentes).

**`ProgramacaoEntrega`** (`programacao_entrega`) — entregas parciais
programadas (ex: "6.900 un em 04/05, 4.600 un em 10/05"), extraídas do PDF
na seção "Programação de Entrega". `status`: `PENDENTE | PRODUZIDO |
EXPEDIDO`.

**`ItemOrdemProducao`** (`item_ordem_producao`) — item de material da OP
(explodido da BOM ou extraído do PDF). Controla o ciclo de liberação/consumo:
`quantidadeLiberada`, `quantidadeConsumida`, `quantidadeDevolvida`,
`quantidadePerda`, `status`: `PENDENTE | PARCIAL | LIBERADO | CONSUMIDO`.
`tipoMaterial`: `PAPEL | TINTA | VERNIZ | COLA | FACA | OUTRO`.
**Importante**: `quantidadeLiberada > 0` ou `quantidadeConsumida > 0` é o
gatilho que bloqueia a reextração automática de materiais via PDF (seção 3).

**`EtapaOrdemProducao`** (`etapa_ordem_producao`) — a etapa real de produção
executada no chão de fábrica (clone da `EtapaRoteiro`, ou criada
manualmente/via desmembramento/OP avulsa). Campos operacionais importantes:
- `status`: `PENDENTE | EM_ANDAMENTO | CONCLUIDA | PAUSADA`
- `posicaoFila` — posição na fila do centro de produção; renumerada
  sequencialmente (1..N) a cada drag-and-drop no painel.
- `quantidadePrevista` — quando `> 0`, é o marcador de que a etapa é
  resultado de um **desmembramento** (usado para localizar etapas "irmãs" na
  reversão).
- `quantidadeProduzida` (mapeada para coluna `quantidade_produzida_etapa`),
  `quantidadePerda` (`quantidade_perda_etapa`) — acumulam os apontamentos.
- `observacaoOperador` — texto livre editável inline no painel.
- `dataInicioReal`/`dataFimReal` — usados para calcular `tempoRealMinutos`.

**`ApontamentoEtapa`** (`apontamento_etapa`) — registro granular de cada
apontamento do operador numa etapa: `tipo`: `PRODUCAO | PERDA | PARADA |
RETOMADA`. Para paradas, guarda `motivoParada` (`MANUTENCAO |
FALTA_MATERIAL | ACERTO_MAQUINA | TROCA_TURNO | OUTRO`) e
`tempoParadaMinutos`. Para perdas, `motivoPerda` (`ACERTO | REFUGO | DEFEITO
| APARA`).

**`ApontamentoProducao`** (`apontamento_producao`) — apontamento agregado a
nível de OP/centro (histórico mais antigo/macro, distinto do granular por
etapa).

**`LiberacaoMaterial`** (`liberacao_material`) + **`ItemLiberacao`**
(`item_liberacao`) — fluxo de requisição/separação de material para a
produção: `LiberacaoMaterial.status`: `PENDENTE | SEPARANDO | SEPARADA |
ENTREGUE | CANCELADA`. Cada `ItemLiberacao` referencia um
`ItemOrdemProducao` e controla `quantidadeSolicitada/Separada/Entregue`.

**`LogOrdemProducao`** (`log_ordem_producao`) — auditoria de toda transição
de status da OP (`statusAnterior`, `statusNovo`, `usuarioId`, `observacao`).

### 1.4 Atributos gráficos (extensão específica da indústria gráfica)

Cadastros auxiliares de parâmetros gráficos, todos com padrão
`@@unique([empresaId, codigo])`:
- **`TipoCartao`** — tipo de papel/cartão.
- **`TipoCor`** — cor com `codigoPantone` e `hexadecimal`.
- **`TipoFormato`** — formato de folha (`larguraMm` x `alturaMm`).
- **`TipoGramatura`** — gramatura em g/m² (`valorGm2`).
- **`TipoPolicromia`** — número de cores de impressão (`numeroCores`).
- **`TipoVerniz`** — `tipo`: `UV | AQUOSO | OLEOSO | NENHUM`.

**`AtributoGrafico`** (`atributo_grafico`) — associa um `Produto` a esses
cadastros (1:1 por `[empresaId, produtoId]`): `tipoCartaoId`,
`tipoFormatoId`, `tipoGramaturaId`, `tipoPolicromiaId`, `tipoVernizId`,
`tipoCoresIds` (array). É a fonte de parâmetros usada pelo **cálculo
automático de consumo gráfico** (seção 6.1) — sem gramatura e formato
cadastrados no `AtributoGrafico` do produto, o cálculo retorna
`NAO_APLICAVEL`.

### 1.5 Importação de PDF

**`DeParaImportacao`** (`de_para_importacao`) — mapeamento "de/para" entre
códigos do sistema externo (GPrint) e entidades internas (Cliente, Produto,
Material, CentroProducao), para acelerar importações futuras sem repetir o
vínculo manual. Único por `[empresaId, sistemaOrigem, tipoEntidade,
codigoExterno]`.

### 1.6 Padrão de tags em `observacoes` (não-óbvio, ler com atenção)

OPs importadas via PDF **não recebem `clienteId` nem sempre `produtoId`**
vinculados a cadastro formal — o dado real extraído do papel é gravado como
texto estruturado dentro de `observacoes`, uma tag por linha:

```
[Cliente] Nome Real Do Cliente Ltda
[Produto] Descrição do produto extraída do PDF
[Montagem] 21
[Tiragem] 2200000
[TipoOp] REPETIÇÃO
[Matriz] 2529B - COM BRAILLE
[Formato] 600 x 910
[Cores] 5x0 +V
[Bobina] Bobina Stora Enzo 222g - 72,0 cm em estoque (13.793,0 kg)
```

Essas tags são geradas na confirmação da importação
(`importacao-op.routes.ts`, rota `/importar-op-pdf/confirmar`) e consumidas
de volta por funções `extrairClienteObs()` / `extrairProdutoObs()` /
etc., **sempre com prioridade sobre o relacionamento formal**. O mesmo
padrão é usado para OPs Avulsas sem cadastro (`produtoNomeLivre` /
`clienteNomeLivre` viram tags `[Produto]`/`[Cliente]`).

---

## 2. Ciclo de vida / máquina de estados da OrdemProducao

Definido em `src/modules/ordem-producao/ordem-producao.service.ts`:

```ts
const TRANSICOES_VALIDAS: Record<string, string[]> = {
  RASCUNHO: ['PLANEJADA', 'CANCELADA'],
  PLANEJADA: ['PROGRAMADA', 'CANCELADA'],
  PROGRAMADA: ['LIBERADA', 'CANCELADA'],
  LIBERADA: ['EM_PRODUCAO', 'CANCELADA'],
  EM_PRODUCAO: ['CONCLUIDA'],
  CONCLUIDA: [],
  CANCELADA: [],
}
```

`validarTransicaoStatus(atual, novo)` checa se a transição é permitida;
`getTransicoesPermitidas(atual)` retorna as próximas opções válidas (usado
pelo frontend para desabilitar botões de transição inválida).

| Status | Significado | Pode ir para |
|---|---|---|
| `RASCUNHO` | OP criada mas não confirmada; permite reexplodir BOM manualmente | `PLANEJADA`, `CANCELADA` |
| `PLANEJADA` | BOM/etapas geradas; **exige ao menos 1 item** para avançar | `PROGRAMADA`, `CANCELADA` |
| `PROGRAMADA` | Entrou na fila de produção (aparece no painel) | `LIBERADA`, `CANCELADA` |
| `LIBERADA` | Material liberado para produção | `EM_PRODUCAO`, `CANCELADA` |
| `EM_PRODUCAO` | Em execução no chão de fábrica | `CONCLUIDA` (não pode mais cancelar) |
| `CONCLUIDA` | Terminal — todas as etapas concluídas, NotaEntrada gerada no WMS (se aplicável) | — |
| `CANCELADA` | Terminal — exige `motivoCancelamento` com no mínimo 10 caracteres | — |

Regras adicionais da rota `PATCH /:id/status`:
- Transição para `PLANEJADA` bloqueada se a OP não tiver `itemOrdemProducao`.
- Ao entrar em `EM_PRODUCAO`, seta `dataInicioReal` se ainda vazio.
- Ao entrar em `CONCLUIDA`, seta `dataFimReal`.
- Nota: a transição para `CONCLUIDA` também acontece **automaticamente**
  (fora dessa rota) quando a última etapa de uma OP é concluída no painel de
  programação — ver seção 7.

---

## 3. Importação de PDF (GPrint/Calcograf)

Fluxo em 3 componentes, todos em `src/modules/pcp/importacao-op/`:

### 3.1 Extração de texto preservando colunas (`pdf-extractor.service.ts`)

Usa `pdfjs-dist` (build legacy). O ponto crítico é `reconstruirTextoPagina()`:
`page.getTextContent()` retorna itens de texto **sem ordem geométrica
garantida e sem quebra de linha** — cada item tem `transform[4]` (posição X)
e `transform[5]` (posição Y). Um `.join(' ')` naive colaria colunas de
tabelas (ex: "Materiais") destruindo o alinhamento.

A solução: agrupa itens por posição Y (tolerância de 2px = mesma linha),
ordena por X dentro da linha, e insere **múltiplos espaços** (`'  '`) quando
o gap horizontal entre itens é maior que 8 (fronteira de coluna) — replicando
visualmente o espaçamento de colunas em texto puro, exatamente como os
regexes do parser (`\s{2,}`) esperam para diferenciar "nome da coluna A" de
"valor da coluna B" na mesma linha.

### 3.2 Parser GPrint (`parsers/gprint-parser.ts`, ~840 linhas)

`isGprintPdf(texto)` detecta o sistema pela presença de `"GPrint"` ou
`"Calcograf"`/`"Calcgraf"` no texto. `parseGprintPdf(texto)` é o parser
principal, todo baseado em **regex sobre o texto reconstruído**, e retorna
`DadosOpGprint` com:

- **`cabecalho`**: número da OP (`O.P.: 2.849 R` → número + revisão),
  cliente, código do cliente, produto, descrição, formato final, quantidade,
  excedente, pedido, código acabado, vendedor, cálculo, e
  `programacaoEntrega[]` (parseando formatos como `"1.200.000 para
  06/07/26, 1.000.000 para 02/08/26"`).
- **`materiais[]`**: papel, tinta (CMYK/Pantone com `%` de cobertura),
  verniz, cola, faca. Duas estratégias de parsing (tabular com nome+qtd+
  unidade na mesma linha; fallback separando blocos de nomes/quantidades/
  unidades quando o layout varia).
- **`etapas[]`**: impressão (máquina, tempo fixo/variável) e acabamentos
  (cortadeira, colagem, verniz) — trata linhas de continuação (detalhe que
  quebrou em mais de uma linha visual no PDF).
- **`cortadeira`**: linhas de corte (quantidade de folhas, gramatura,
  dimensões).
- **`montagem`**: aproveitamento e quantidade de imposição.
- **`tiragem`**: extraída da tabela "Plano" (heurística: primeiro número
  ≥1000 que não é parte de um formato `NxN`).
- **`observacoes`**: `tipoOp` (Novo/Repetição/Alteração/Piloto), `matriz`
  (código da faca/matriz de corte), `formatoPlano`, `coresPlano` (padrão
  `NxN` de policromia), `bobinas[]` (estoque/encomenda).
- **`confianca`** (0-100%): heurística de quantos dos 10 campos esperados
  foram encontrados — usado no preview de importação para alertar o usuário.
- **`avisos[]`**: mensagens de campos não encontrados.

### 3.3 Fluxo de importação (`importacao-op.routes.ts`)

Duas etapas (preview + confirmação), com um **cache em memória** (`Map`,
TTL 30 min) guardando os dados extraídos e o buffer do PDF entre as duas
chamadas:

1. `POST /pcp/importar-op-pdf` — upload multipart (máx 10MB), extrai texto,
   detecta sistema, faz parse, busca sugestões de vínculo (cliente/produto/
   materiais/centros via `DeParaImportacao` ou fuzzy match), detecta
   possível OP duplicada (mesma referência já existe), retorna
   `importacaoId` + dados extraídos + sugestões para o usuário revisar/
   corrigir no frontend.
2. `POST /pcp/importar-op-pdf/confirmar` — recebe `importacaoId` + overrides
   do usuário (vínculos corrigidos de cliente/produto/materiais/centros).
   Monta as tags de `observacoes` (`[Cliente]`, `[Produto]`, `[Montagem]`,
   `[Tiragem]`, `[TipoOp]`, `[Matriz]`, `[Formato]`, `[Cores]`, `[Bobina]`).
   **Se já existir OP com o mesmo número** extraído do PDF, faz
   **atualização** (limpa e recria itens/etapas/programação de entrega) em
   vez de criar OP nova — preservando heurística de "material já recebido"
   (se as observações antigas tinham "encomendado" e as novas não têm mais,
   não reintroduz a tag). Se não existir, cria OP nova com
   `origemImportacao: 'PDF_GPRINT'`. Salva o PDF em disco/storage
   (`salvarOpPdf`) e opcionalmente grava os vínculos como `DeParaImportacao`
   para próximas importações (`salvarDePara: true`).
3. `GET /pcp/op-pdf/:opId` — serve o PDF (aceita token via query param para
   abrir em nova aba do navegador sem depender do header Authorization).
4. Rotas de `DeParaImportacao`: `GET/POST /pcp/de-para-importacao`,
   `DELETE /pcp/de-para-importacao/:id`, `DELETE
   /pcp/de-para-importacao/limpar-centros` (limpa todos os mapeamentos de
   centro, forçando reimportação para recriá-los).

### 3.4 Reextração de PDF e proteção contra sobrescrita

`POST /pcp/programacao/reextrair-pdf` (em `etapa-operacional.routes.ts`)
existe para **corrigir dados capturados incorretamente do PDF** (ex: um
Pantone que uma versão antiga do parser não reconheceu), sem precisar
reimportar o arquivo do zero. Fluxo:

1. Carrega o PDF já salvo (`carregarOpPdf`), reextrai texto e reparseia.
2. Tags de cabeçalho (`[TipoOp]`, `[Matriz]`, `[Formato]`, `[Cores]`) são
   **sempre** removidas e reescritas — são só metadados de exibição.
3. **Materiais só são atualizados se nenhum item já tiver movimentação**:

```ts
const temMovimentacao = itensExistentes.some(
  (i) => Number(i.quantidadeLiberada) > 0 || Number(i.quantidadeConsumida) > 0,
)
if (temMovimentacao) {
  materiaisAvisos.push('Materiais não foram atualizados: já há liberação/consumo registrado para esta OP. Ajuste manualmente se necessário.')
} else {
  // apaga e recria ItemOrdemProducao a partir do PDF reparseado
}
```

**Motivo**: registros de `LiberacaoMaterial`/`ItemLiberacao` e apontamentos
de consumo real ficam vinculados ao `ItemOrdemProducao.id`. Um
`deleteMany` + recriação destruiria a rastreabilidade de uma OP que já
avançou no processo produtivo, mesmo que a nova lista tivesse descrições
parecidas. Quando a atualização é permitida, o vínculo `produtoComponenteId`
já feito manualmente é preservado por descrição (`Map` descrição →
produtoComponenteId) para não perder o de/para da importação original.

---

## 4. Painel de Programação

Frontend: `VisioFab.Wms.Front/src/app/(interna)/pcp/programacao/page.tsx`.
Backend: `src/modules/pcp/etapa-operacional.routes.ts` (prefixo `/api/pcp`).

### 4.1 Conceito de "grupos" (centros de produção)

Não existe uma entidade "Grupo" separada — o agrupamento é o próprio
`CentroProducao.tipoMaquina` (`IMPRESSAO | ACABAMENTO | CORTADEIRA | COLAGEM
| VERNIZ`). O frontend usa uma função `getCategoriaCentro` para mapear cada
centro numa das abas exibidas (Todos / Cortadeira / Impressão / Acabamento).

`GET /api/pcp/programacao/painel` monta o painel: busca todos os
`CentroProducao` ativos (ordenados por `posicao`, `codigo`), busca todas as
`EtapaOrdemProducao` ativas (status `PENDENTE`/`EM_ANDAMENTO`/`PAUSADA`, de
OPs `PROGRAMADA`/`LIBERADA`/`EM_PRODUCAO`) ordenadas por `posicaoFila` →
prioridade da OP → sequência, e agrupa por `centroProducaoId`. Retorna
também uma lista separada `aguardandoCartao`, sempre atribuída à categoria
`CORTADEIRA`, com OPs cujo material (bobina/cartão) está marcado como
"encomendado" (detectado via regex `/encomendad/i` nas observações/descrição
do item de papel) — exibida no frontend como um card amarelo destacado no
topo, fora das colunas normais.

### 4.2 UI: lista vertical de cards colapsáveis, não kanban horizontal

Cada centro é um `Card` Mantine colapsável (`Collapse`). Toda a página fica
dentro de um `DndContext` (dnd-kit) externo para **reordenar os próprios
centros** entre si (persistido via hook `useCentrosOrdenacao()`, com
atualização otimista + rollback em erro). Dentro de cada card, um segundo
`DndContext` permite arrastar as **linhas de etapa** (fila daquele centro)
via ícone de grip — ao soltar, chama `PATCH /pcp/etapas/reordenar` com
`{ centroProducaoId, etapaIds: novaOrdem }`; o backend renumera
`posicaoFila` de 1 a N na ordem recebida (sem cálculo fracionário).

### 4.3 Ações do operador

| Ação | Rota | Pré-condição | Efeito |
|---|---|---|---|
| Iniciar/Retomar | `PATCH /pcp/etapas/:id/iniciar` | status `PENDENTE`/`PAUSADA` | `status=EM_ANDAMENTO`, seta `dataInicioReal` (1ª vez), `funcionarioId`. Se vinha de pausa, cria `ApontamentoEtapa` tipo `RETOMADA`. |
| Pausar | `PATCH /pcp/etapas/:id/pausar` | status `EM_ANDAMENTO` | `status=PAUSADA` + `ApontamentoEtapa` tipo `PARADA` com motivo (enum) e observação. |
| Apontar | `POST /pcp/etapas/:id/apontar` | status `EM_ANDAMENTO`/`PAUSADA` | Cria `ApontamentoEtapa` (`PRODUCAO` ou `PERDA`), incrementa `quantidadeProduzida`/`quantidadePerda` via `{ increment }`. |
| Concluir | `PATCH /pcp/etapas/:id/concluir` | status `EM_ANDAMENTO`/`PAUSADA` | `status=CONCLUIDA`, `dataFimReal`. Se for a última etapa pendente da OP → integração com WMS (seção 7). |
| Editar observação | `PATCH /pcp/etapas/:id/observacao` | — | Edição inline da célula "Acompanhamento". |
| Alterar prioridade | `PATCH /ordens-producao/:opId` | — | Clique na célula cicla `BAIXA→NORMAL→ALTA→URGENTE`. |
| Postergar entrega | `PATCH /pcp/programacao/postergar-entrega` | — | Preserva `dataEntregaOriginal`, incrementa `vezesPostergada`. |

### 4.4 OP Avulsa (`AV-1`, `AV-2`, ...)

Rota única `POST /pcp/etapas/adicionar-avulsa`, com **dois modos** de
preenchimento controlados por quais campos o body traz:

- **Modo "a partir de uma OP existente"** (herdar): frontend busca a OP de
  origem por número (`GET /ordens-producao?numero=...`), exibe produto/
  cliente encontrados, usuário só informa `quantidade` (obrigatória) e
  `descricao` (opcional).
- **Modo "sem OP existente"** (livre): usuário digita/seleciona produto e
  cliente via `Autocomplete` (`produtoNomeLivre`/`clienteNomeLivre` viram
  texto livre se não corresponderem a um cadastro), mais `quantidade` e
  `descricao`.

Geração da referência sequencial:

```ts
const avulsasExistentes = await prisma.ordemProducao.findMany({
  where: { empresaId: user.empresaId, origemImportacao: 'AVULSA' },
  select: { referenciaExterna: true },
})
let maiorSeq = 0
for (const av of avulsasExistentes) {
  const m = av.referenciaExterna?.match(/^AV-(\d+)$/)
  if (m) maiorSeq = Math.max(maiorSeq, parseInt(m[1]))
}
const referenciaAvulsa = `AV-${maiorSeq + 1}`
```

Cria `OrdemProducao` (`origemImportacao='AVULSA'`, `status='PROGRAMADA'`) +
uma `EtapaOrdemProducao` já na fila do centro escolhido. Nomes sem cadastro
formal viram tags `[Produto]`/`[Cliente]` em `observacoes` (mesmo padrão da
importação de PDF). Exclusão em `DELETE /pcp/ordens-avulsas/:opId` — ver
regra de exclusão livre na seção 9.

### 4.5 Desmembramento de etapas entre máquinas

`POST /pcp/etapas/:id/desmembrar` — exige etapa `PENDENTE` e no mínimo 2
partes (`{ centroProducaoId, quantidade, observacao? }`), com validação de
que a soma das partes bate com a quantidade original (tolerância 0.01).
Deleta a etapa original e cria uma nova por parte:
- `sequencia = sequenciaOriginal * 10 + índice + 1`
- `tempoOperacaoCalculado` proporcional à fração da quantidade
- `quantidadePrevista = quantidade da parte` (esse campo > 0 marca a etapa
  como resultante de desmembramento)

Reversão via `DELETE /pcp/etapas/:id/reverter-parte` (ou
`/reverter-desmembramento`): localiza etapa "irmã" pendente com
`quantidadePrevista > 0`, soma a quantidade de volta nela, e remove a etapa
original.

### 4.6 Mover etapa entre centros

`PATCH /pcp/etapas/:id/mover` com `{ centroProducaoId }` — troca simples do
FK. **Não recalcula `posicaoFila`** — a etapa entra no centro destino
mantendo a posição que tinha (colisão só se resolve na próxima
reordenação manual daquele centro).

---

## 5. Cadastros base do PCP

- **`configuracao-pcp.routes.ts`** — flags booleanas por empresa,
  armazenadas na tabela genérica `Parametro` com prefixo `pcp.` (ex:
  `pcp.usaControleBobina`). `GET /pcp/configuracao` / `PATCH
  /pcp/configuracao` (só ADMIN/SUPER_ADMIN). Flags existentes:
  `usaControleBobina`, `usaLoteCorrespondencia`, `usaEstoqueTerceiro`,
  `usaPaletizacaoDinamica`, `usaControleApara`, `usaControleUmidade`,
  `usaZonaSegregada`.
- **`admin-pcp.routes.ts`** — operações administrativas destrutivas
  (`DELETE /limpar-dados` faz `TRUNCATE`-like por módulo incluindo todas
  as tabelas do PCP; `GET /backup` / `POST /restaurar` para backup/restore
  em JSON). Protegidas por perfil ADMIN. **Ação de alto risco** — sempre
  confirmar com o usuário antes de disparar limpeza de dados em produção.
- Centro/Recurso/Turno/Estrutura/Roteiro/AtributoGráfico **não têm arquivo
  de rotas dedicado próprio** identificado na pasta `pcp/` — os CRUDs desses
  cadastros (se existirem) provavelmente vivem em outro módulo/arquivo do
  backend (verificar `src/modules/` mais amplamente se precisar mapear essas
  rotas específicas; não confirmado neste levantamento).

---

## 6. Outras funcionalidades do módulo

### 6.1 `calculo-consumo-grafico.routes.ts` / `.service.ts`

Calcula o consumo teórico de papel a partir da tiragem, diferenciando dois
processos:
- **PLANA** (offset/digital): `FolhasPuras = QtdPedida / Aproveitamento`;
  `TotalFolhas = ceil(FolhasPuras * (1 + %Perda))`; peso em kg =
  `Largura(m) × Comprimento(m) × Gramatura(g/m²) × TotalFolhas / 1000`.
- **ROTATIVA** (flexo/rotogravura): `Puxadas = ceil(QtdPedida /
  ProdutosPorPuxada)`; `Metros = Puxadas × RepetiçãoCorte(mm)/1000 +
  MetrosAcertoFixo`; peso em kg = `LarguraBobina(m) × Metros ×
  Gramatura(g/m²) / 1000`.

O resultado é sempre convertido para **KG** (unidade usada pelo WMS para
reserva de estoque). Chamado automaticamente após a criação de uma OP
(`calcularConsumoAutomatico()` em `ordem-producao.service.ts`), usando os
parâmetros do `AtributoGrafico` do produto. Rotas: `POST
/pcp/calculo-consumo`, `GET /pcp/calculo-consumo/exemplos`.

### 6.2 `conversao-unidades.routes.ts` / `.service.ts`

Utilitário genérico de conversão entre unidades gráficas (kg ↔ m² ↔ metros
lineares ↔ folhas ↔ resmas), usando gramatura/dimensões/folhas-por-resma
como parâmetros. Rotas: `POST /pcp/conversao-unidades`, `GET
/pcp/conversoes-disponiveis`.

### 6.3 `controle-bobina.routes.ts`

Controle de bobinas de material em processo rotativo, com geração de
"bobina filha" ao registrar consumo parcial com sobra pesada na balança
(código rastreável `BOB-XXXX-XXXXX-R01`). **Atenção**: o model
`ControleBobina` ainda não existe no schema — a listagem (`GET
/pcp/bobinas`) hoje retorna sempre vazia; só o endpoint de consumo parcial
tem lógica implementada, sem persistência real ainda.

### 6.4 `paletizacao.routes.ts`

Calcula distribuição de itens em paletes (algoritmo greedy respeitando
limite de peso/altura por tipo: madeira 1000x1200, madeira 800x1200,
plástico, customizado). Rota: `POST /pcp/paletizacao/calcular`.

### 6.5 `dashboard-unificado.routes.ts`

`GET /pcp/dashboard` — indicadores de PCP puro (OPs por status, atrasadas,
produção do dia, liberações pendentes). `GET /pcp/dashboard/unificado` —
visão 360° cruzando PCP + WMS + Vendas + Financeiro.

### 6.6 `acompanhamento-cliente.routes.ts`

Portal público (sem autenticação) de rastreio de pedido via token:
`GET /acompanhamento/:token`. Cruza status do `PedidoVenda` com as
`OrdemProducao` vinculadas para montar uma timeline simplificada. **Nota de
segurança**: a implementação atual usa o próprio `id` (UUID) do pedido como
"token" — não há um token dedicado gerado, o que é aceitável dado que UUIDs
não são enumeráveis, mas vale considerar rotação/expiração se o link for
compartilhado amplamente.

### 6.7 `estoque-terceiros.routes.ts`

Preparado para consulta de estoque de terceiros (material de clientes
armazenado no CD), mas depende de um campo (`proprietarioTipo` em
`SaldoEndereco`) que ainda não existe no schema — ambos os endpoints
retornam listas vazias hoje.

---

## 7. Integração PCP → WMS

`pcp-wms-integration.service.ts` define `criarEntradaProducao()`, mas
**essa função não é chamada em nenhum lugar** — é código morto/preparado
para refatoração futura. A lógica real está **duplicada inline** dentro de
`etapa-operacional.routes.ts`, no handler `PATCH /pcp/etapas/:id/concluir`.

Fluxo real ao concluir uma etapa:

```ts
const todasEtapas = await prisma.etapaOrdemProducao.findMany({
  where: { ordemProducaoId: etapa.ordemProducaoId },
  select: { status: true },
})
const todasConcluidas = todasEtapas.every(e => e.status === 'CONCLUIDA')

if (todasConcluidas) {
  const empresa = await prisma.empresa.findUnique({ where: { id: user.empresaId } })
  if (empresa?.usaWms) {
    // cria NotaEntrada tipo PRODUCAO com status PENDENTE
    // atualiza OrdemProducao para CONCLUIDA + dataFimReal
    // grava LogOrdemProducao
  }
}
```

Detalhes da `NotaEntrada` criada:
- `serie: 'PRD'`, `fornecedor: 'PRODUÇÃO INTERNA'`, `fornecedorDoc` =
  primeiros 14 caracteres do `empresaId` (placeholder, não é CNPJ real).
- `tipo: 'PRODUCAO'`, `status: 'PENDENTE'` — entra no fluxo padrão de
  conferência/endereçamento do WMS como qualquer outra entrada.
- Item único com o produto acabado da OP e `quantidade =
  ordemProducao.quantidade` (**quantidade planejada, não a soma real
  apontada nas etapas** — atenção a esse detalhe se houver perdas).
- Numeração sequencial a partir de 900000 (para diferenciar visualmente de
  notas de compra normais).

**Se `empresa.usaWms` for falso**: nada é criado no WMS, e — importante —
a OP também **não** é marcada `CONCLUIDA` nesse fluxo (o `update` de status
está dentro do mesmo `if`). Isso significa que em empresas sem WMS
habilitado, a conclusão automática da OP ao terminar a última etapa
**não acontece** por esse caminho (precisaria da rota manual
`PATCH /ordens-producao/:id/status`).

Todo o bloco está em `try/catch`; falha na criação da nota só loga no
console e não interrompe a resposta — a etapa é marcada concluída mesmo
que a integração falhe silenciosamente, deixando a OP com todas etapas
`CONCLUIDA` mas sem nota gerada (exigiria reprocessamento manual).

---

## 8. Rotas da API — referência completa

### 8.1 `ordem-producao.routes.ts` (prefixo provável `/api/ordens-producao`)

| Método | Rota | Descrição |
|---|---|---|
| GET | `/` | Lista paginada com filtros (status, prioridade, produto, cliente, pedido, datas, número). |
| GET | `/clientes-distintos` | Nomes de clientes distintos (cadastro formal + tags `[Cliente]`), para autocomplete. |
| GET | `/:id` | Detalhe completo (itens, etapas, últimos 20 apontamentos, logs, liberações, `transicoesPermitidas`). |
| POST | `/` | Cria OP; explode BOM e gera etapas do roteiro opcionalmente; calcula consumo gráfico automático. |
| PATCH | `/:id/status` | Transição de status (validada pela máquina de estados). |
| GET | `/:id/verificar-materiais` | Compara necessidade vs estoque disponível/reservado por item. |
| POST | `/:id/explodir-bom` | Re-explosão manual da BOM (só se status `RASCUNHO`). |
| POST | `/gerar-de-pedido` | Gera OPs em lote a partir de um Pedido de Venda. |
| GET | `/kanban` | Visão Kanban por status (colunas fixas, exclui `CANCELADA`). |
| PATCH | `/:id` | Atualização parcial (bloqueada se `CONCLUIDA`/`CANCELADA`). |
| GET | `/:id/pdf` | Serve o PDF importado da OP. |
| POST | `/pdf-status` | Verifica em lote quais OPs (até 100 ids) têm PDF salvo. |
| PUT | `/:id/pdf` | Upload/substituição do PDF (máx 10MB). |
| DELETE | `/:id` | Exclui OP normal — bloqueada se `CONCLUIDA`, com apontamentos, ou com etapa iniciada/concluída. |

### 8.2 `etapa-operacional.routes.ts` (prefixo `/api/pcp`)

| Método | Rota | Descrição |
|---|---|---|
| PATCH | `/etapas/reordenar` | Renumera `posicaoFila` (1..N) para a fila de um centro. |
| PATCH | `/etapas/:id/iniciar` | Inicia/retoma etapa. |
| PATCH | `/etapas/:id/pausar` | Pausa etapa com motivo. |
| POST | `/etapas/:id/apontar` | Registra apontamento de produção/perda. |
| PATCH | `/etapas/:id/concluir` | Conclui etapa; dispara integração WMS se for a última da OP. |
| POST | `/etapas/:id/desmembrar` | Divide etapa em N partes/centros. |
| DELETE | `/etapas/:id/reverter-parte` | Reverte uma parte desmembrada. |
| GET | `/etapas/:id/apontamentos` | Histórico de apontamentos + totais agregados. |
| PATCH | `/etapas/:id/observacao` | Atualiza observação inline do operador. |
| DELETE | `/etapas/:id` | Exclui etapa manual/desmembrada (só `PENDENTE`). |
| DELETE | `/etapas/:id/reverter-desmembramento` | Reverte desmembramento somando na etapa irmã. |
| PATCH | `/programacao/postergar-entrega` | Posterga `dataEntregaPrevista`, preserva original. |
| POST | `/programacao/reextrair-pdf` | Reprocessa PDF já salvo (protegido contra sobrescrever materiais com movimentação). |
| PATCH | `/etapas/:id/mover` | Move etapa para outro centro (sem recalcular fila). |
| POST | `/etapas/adicionar-manual` | Adiciona etapa vinculada a OP existente na fila de um centro. |
| POST | `/etapas/adicionar-avulsa` | Cria OP avulsa (`AV-N`) + etapa na fila. |
| DELETE | `/ordens-avulsas/:opId` | Exclui OP avulsa e dependências (sem restrição de status). |
| GET | `/programacao/painel` | Painel completo: etapas por centro + aguardando cartão. |

### 8.3 `importacao-op.routes.ts` (prefixo `/api/pcp`)

| Método | Rota | Descrição |
|---|---|---|
| POST | `/importar-op-pdf` | Upload de PDF, extrai/parseia, retorna preview + sugestões de vínculo. |
| POST | `/importar-op-pdf/confirmar` | Confirma importação: cria ou atualiza a OP, itens, etapas, programação de entrega. |
| GET | `/op-pdf/:opId` | Serve o PDF original (aceita token via query param). |
| GET | `/de-para-importacao` | Lista mapeamentos de/para. |
| POST | `/de-para-importacao` | Cria mapeamento de/para. |
| DELETE | `/de-para-importacao/limpar-centros` | Remove todos os de/para de tipo `CENTRO_PRODUCAO`. |
| DELETE | `/de-para-importacao/:id` | Remove um mapeamento específico. |

### 8.4 Cadastros e configuração

| Arquivo | Método | Rota | Descrição |
|---|---|---|---|
| `configuracao-pcp.routes.ts` | GET | `/pcp/configuracao` | Retorna flags de configuração da empresa. |
| `configuracao-pcp.routes.ts` | PATCH | `/pcp/configuracao` | Atualiza flags (só ADMIN). |
| `admin-pcp.routes.ts` | DELETE | `/limpar-dados` | Limpeza destrutiva por módulo (inclui PCP). |
| `admin-pcp.routes.ts` | GET | `/backup` | Exporta dados da empresa em JSON. |
| `admin-pcp.routes.ts` | POST | `/restaurar` | Restaura dados a partir de backup JSON. |

### 8.5 Cálculo, conversão, bobina, paletização, dashboards

| Arquivo | Método | Rota | Descrição |
|---|---|---|---|
| `calculo-consumo-grafico.routes.ts` | POST | `/pcp/calculo-consumo` | Calcula consumo (folhas/metros) e peso em kg (PLANA/ROTATIVA). |
| `calculo-consumo-grafico.routes.ts` | GET | `/pcp/calculo-consumo/exemplos` | Exemplos de payload e fórmulas documentadas. |
| `conversao-unidades.routes.ts` | POST | `/pcp/conversao-unidades` | Converte valor entre unidades gráficas suportadas. |
| `conversao-unidades.routes.ts` | GET | `/pcp/conversoes-disponiveis` | Lista conversões suportadas e parâmetros exigidos. |
| `controle-bobina.routes.ts` | GET | `/pcp/bobinas` | Lista bobinas (hoje sempre vazio — model não implementado). |
| `controle-bobina.routes.ts` | POST | `/pcp/bobinas/:id/consumo-parcial` | Registra consumo parcial / gera bobina filha. |
| `paletizacao.routes.ts` | POST | `/pcp/paletizacao/calcular` | Calcula distribuição de itens em paletes. |
| `dashboard-unificado.routes.ts` | GET | `/pcp/dashboard` | Indicadores de PCP. |
| `dashboard-unificado.routes.ts` | GET | `/pcp/dashboard/unificado` | Indicadores cruzados PCP+WMS+Vendas+Financeiro. |
| `acompanhamento-cliente.routes.ts` | GET | `/acompanhamento/:token` | Rastreio público de pedido (sem autenticação). |
| `estoque-terceiros.routes.ts` | GET | `/pcp/estoque-terceiros` | Estoque de terceiros por cliente/produto (não implementado). |
| `estoque-terceiros.routes.ts` | GET | `/pcp/estoque-terceiros/resumo` | Resumo agregado (não implementado). |

---

## 9. Padrões de código importantes (armadilhas e convenções)

1. **SEMPRE usar `select` explícito, nunca `omit`, em queries de
   `OrdemProducao` que podem retornar para o cliente**, para excluir
   `pdfData` (`Bytes`/BYTEA). `select` é traduzido direto para a cláusula
   SQL `SELECT` — o campo nunca sai do banco. `omit` filtra só na
   serialização, depois do Prisma já ter materializado o BYTEA completo em
   memória. **Já causou 2 bugs reais de memória/performance no Render**
   (uma listagem paginada de 20 registros chegou a materializar ~15MB de
   PDFs; e cada troca de status ficava lenta pelo mesmo motivo). Padrão a
   seguir (visto em `GET /`, `GET /:id`, `PATCH /:id/status`):
   ```ts
   select: {
     id: true, empresaId: true, numero: true, /* ...todos os campos exceto pdfData... */
   }
   ```
   **Atenção a regressão conhecida**: a rota `GET /kanban` usa `omit: {
     pdfData: true }` em vez de `select` — inconsistente com o padrão
   documentado no resto do arquivo e um candidato a ter o mesmo problema de
   memória. Se for tocar nessa rota, corrija para `select` explícito.

2. **O nome real do cliente de OPs importadas via PDF fica na tag
   `[Cliente]` dentro de `observacoes`, não no relacionamento `clienteId`**
   (que é `null` na maioria dessas OPs). A função `extrairClienteObs()`
   está **duplicada** em `ordem-producao.routes.ts` (nível de módulo) e em
   `etapa-operacional.routes.ts` (dentro do handler do painel) — não há
   utilitário compartilhado, é duplicação proposital/comentada:
   ```ts
   function extrairClienteObs(obs: string | null): string | null {
     if (!obs) return null
     const m = obs.match(/\[Cliente\]\s*(.+?)(?:\n|$)/)
     return m ? m[1].trim() : null
   }
   ```
   **Sempre priorizar a tag sobre o relacionamento**: o padrão usado em
   todo o código é
   `extrairClienteObs(op.observacoes) || (op.clienteId && clienteMap.get(op.clienteId)) || null`.
   O mesmo padrão vale para `[Produto]` (via função equivalente
   `extrairProdutoObs`, mesma lógica). Se adicionar uma nova tela/rota que
   exibe cliente/produto de uma OP, replicar essa prioridade — não confiar
   apenas no relacionamento.

3. **OPs Avulsas (`referenciaExterna` no formato `AV-N`, `origemImportacao
   === 'AVULSA'`) podem ser excluídas livremente**, ao contrário de OPs
   normais. A rota dedicada `DELETE /pcp/ordens-avulsas/:opId` filtra
   explicitamente por `origemImportacao: 'AVULSA'` no `findFirst` (se não
   for avulsa, retorna 404 mesmo que o ID exista como OP normal) e exclui
   em cascata **sem checar status, apontamentos ou etapas em andamento**.
   Isso contrasta com `DELETE /ordens-producao/:id` (OP normal), que tem 3
   guardas sequenciais: bloqueia se `status === 'CONCLUIDA'`, se existir
   qualquer apontamento de produção (nível OP ou nível etapa), ou se
   alguma etapa estiver `EM_ANDAMENTO`/`CONCLUIDA`. Ao trabalhar em
   qualquer lógica de exclusão de OP, **não generalizar** as duas rotas —
   são regras de negócio deliberadamente diferentes.

4. **Sempre criar branch nova antes de comitar** — padrão geral do
   repositório (não específico do PCP), mas relevante para qualquer
   trabalho aqui: nunca commitar direto em `main`/`master`.

5. **Model `ControleBobina` e o campo `proprietarioTipo` em
   `SaldoEndereco` ainda não existem no schema** — `controle-bobina.routes.ts`
   e `estoque-terceiros.routes.ts` têm rotas "preparadas" que hoje retornam
   dados vazios ou incompletos. Não assumir que essas funcionalidades estão
   ativas em produção sem verificar o schema primeiro.

6. **`pcp-wms-integration.service.ts` tem uma função morta**
   (`criarEntradaProducao()`) que não é chamada por nenhuma rota — a lógica
   real de integração está duplicada inline em
   `etapa-operacional.routes.ts` (`PATCH /etapas/:id/concluir`). Se for
   refatorar a integração PCP→WMS, migrar a lógica inline para o service e
   atualizar a chamada, em vez de manter as duas versões divergentes (elas
   já divergem em pelo menos um detalhe: `serie: 'PRD'` vs `serie: 'INT'`).
