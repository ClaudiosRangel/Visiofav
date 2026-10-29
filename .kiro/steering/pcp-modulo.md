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
- `tipoProcessoId` (FK **obrigatória**, `tipo_processo_id`) — referencia o
  cadastro `TipoProcesso` (ver abaixo). É este campo (não uma entidade
  "Grupo" separada) que define o agrupamento visual usado no painel de
  Programação: cada `TipoProcesso` ATIVO gera uma aba, na ordem de `posicao`
  definida no cadastro. Substitui o antigo enum fixo `tipoMaquina`
  (`IMPRESSAO | ACABAMENTO | CORTADEIRA | COLAGEM | VERNIZ`, hardcoded no
  código) — migrado em 30/07/2026, ver seção 1.1.1.
- `capacidadeHora`, `custoHora`, `posicao` (ordem de exibição dentro da
  própria aba), `status` (ativo/inativo).
- `modoContagem` (`modo_contagem`, VARCHAR(20), default `QUANTIDADE`) +
  `contadorZeraDiariamente` (`contador_zera_diariamente`, Boolean, default
  `false`) — modo de apontamento de produção do centro. Ver seção 11
  (Contagem por Contador de Máquina). O modo padrão (`QUANTIDADE`) é o
  comportamento legado inalterado.
- Relacionamentos: `recursos` (RecursoProducao), `etapasRoteiro`,
  `etapasOp` (EtapaOrdemProducao), `apontamentos`, `tipoProcesso`,
  `leiturasContador` (LeituraContador — só modo CONTADOR).

#### 1.1.1 `TipoProcesso` (`tipo_processo`) — cadastro dinâmico de processo produtivo

Cadastro em **PCP → Cadastros → Tipo de Processo**
(`/pcp/cadastros/tipos-processo`), com CRUD completo (`código`, `descrição`,
`status` ativo/inativo) e reordenação por drag-and-drop (`posicao`, mesmo
padrão de `PATCH /centros-producao/ordenar`, agora replicado em
`PATCH /tipos-processo/ordenar`). Toda `CentroProducao` deve obrigatoriamente
apontar para um `TipoProcesso` — não existe mais centro "sem classificação"
(a antiga aba "Outros" do painel deixou de existir por esse motivo).

A migração de produção (`prisma/migrate-prod.ts`) populou, para cada
empresa, os 5 tipos que antes eram fixos no código
(`CORTADEIRA`, `IMPRESSAO`, `ACABAMENTO`, `COLAGEM`, `VERNIZ`, nessa ordem de
`posicao`), e migrou o valor antigo de `tipo_maquina` de cada centro
existente para o `tipo_processo_id` correspondente (fallback para
`ACABAMENTO` quando o centro não tinha classificação — ex.: o centro "Ebox",
reclassificado manualmente pelo usuário antes da migração).

**Importante — mudança de comportamento**: antes, `COLAGEM` e `VERNIZ`
caíam juntos com `ACABAMENTO` numa única aba "Acabamento" (regra fixa no
código). Agora, como cada `TipoProcesso` ativo gera sua própria aba, os 5
tipos padrão geram 5 abas separadas (Cortadeira/Impressão/Acabamento/
Colagem/Verniz) a menos que o usuário inative manualmente `COLAGEM`/`VERNIZ`
como tipos distintos e reclassifique os centros correspondentes como
`ACABAMENTO`.

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
- `tipoColagem` (`tipo_colagem`, VARCHAR(100)) — texto EXATO extraído do PDF
  na linha da coladeira (o trecho após a `/`, ex.: "Colagem Lateral", "Fundo
  Automático"). Preenchido só para etapas de centros do tipo de processo
  `COLAGEM`. É **somente leitura** (não editável pelo operador). Exibido como
  coluna "Tipo Colagem" no painel de Programação, visível apenas nos cards de
  centros COLAGEM (`centro.tipoProcesso.codigo === 'COLAGEM'`). Origem: o
  parser GPrint já separa `nome / detalhe` de cada etapa de acabamento; para
  etapas COLAGEM o `detalhe` (ou o próprio nome como fallback) vira o
  `tipoColagem`. Gravado na confirmação da importação e também retroativamente
  via `POST /pcp/programacao/reextrair-pdf` (que preenche o campo nas etapas de
  colagem já existentes sem recriar a etapa — preserva apontamentos/fila).
- `dataInicioReal`/`dataFimReal` — usados para calcular `tempoRealMinutos`.
- `enviadoDepositoId` (FK → `Deposito`) + `enviadoQuantidade` (Decimal) — envio
  de material da **Cortadeira** para um depósito do WMS. Editável na coluna
  "Enviado" do painel (só cards CORTADEIRA), via `PATCH /pcp/etapas/:id/enviar`.
  Exibido como "DEP-001 1500" (código do depósito + quantidade). **Atenção**: o
  código `DEP-NNN` **NÃO é persistido** no `Deposito` — é derivado da ordem por
  `descricao asc` (helpers `mapaCodigosDeposito`/`codigoDeposito` em
  `deposito.routes.ts`, mesma numeração de `GET /depositos`). Logo, se a
  descrição de um depósito mudar a ponto de reordenar a lista, o código exibido
  do que já foi enviado muda junto (o vínculo real preservado é o
  `enviadoDepositoId`, não o texto). O painel monta o mapa depositoId→código
  uma vez por request (sem N+1).

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

### 1.7 Requisições de Compra (SugestaoCompra) e visibilidade de reserva

Os botões "Reservar Materiais" e "Gerar Requisições de Compra" da Análise de
Produção criam, respectivamente, `ReservaProducao` (ATIVA) e `SugestaoCompra`
(PENDENTE). Antes esses registros ficavam invisíveis no frontend; agora:

- **Requisições de Compra** têm tela dedicada no módulo **Compras**
  (`/compras/requisicoes`), consumindo `GET /pcp/analise-producao/sugestoes-compra`
  (com filtros status/fornecedor/busca). O comprador seleciona requisições
  PENDENTES e converte em Pedido de Compra via
  `POST /pcp/analise-producao/sugestoes-compra/converter`
  (`conversao-compra.service.ts` — cria 1 PedidoCompra RASCUNHO com 1 item por
  requisição, preço 0, marca sugestões CONVERTIDA + preenche `pedidoCompraId`).
  Edição/cancelamento via `PATCH`/`DELETE /pcp/analise-producao/sugestoes-compra/:id`.
- **Reserva/Disponível** aparece na Consulta de Saldos do WMS (`/estoque`,
  aba "Por Produto"), consumindo `GET /api/saldos/consolidado`
  (`saldo-consolidado.service.ts`). Consolida por produto respeitando as DUAS
  formas de estoque: se há `SaldoEndereco` (WMS) > 0, origem = WMS (com
  endereços expansíveis); senão cai para `Estoque` global (ERP, sem endereço).
  `Reservado = Estoque.reservado (venda) + Σ ReservaProducao ATIVA (produção)`;
  `Disponível = Físico − Reservado`. Mesma regra de origem que o PCP usa em
  `verificacao-estoque.service.ts` (`calcularSaldo`), para não divergir.

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
`CentroProducao.tipoProcessoId`, que referencia o cadastro dinâmico
`TipoProcesso` (ver seção 1.1.1). O frontend usa uma função
`getCategoriaCentro(tipoProcessoCodigo)` que simplesmente normaliza o código
do tipo em minúsculas para usar como chave da aba — as abas exibidas são
geradas dinamicamente a partir dos `TipoProcesso` ATIVOS da empresa, na
ordem de `posicao` (não existe mais lista fixa nem aba "Todos"/"Outros": todo
centro é obrigatoriamente classificado).

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
| PATCH | `/etapas/:id/enviar` | Registra envio da Cortadeira para um depósito do WMS (coluna "Enviado"): grava `enviadoDepositoId`+`enviadoQuantidade`; retorna código `DEP-NNN` + display "DEP-001 1500". `depositoId=null` limpa. Reusa a permissão `podeEditarObservacao`. |
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
| `tipo-processo.routes.ts` | GET | `/tipos-processo` | Lista tipos de processo, ordenados por posição. |
| `tipo-processo.routes.ts` | POST | `/tipos-processo` | Cria tipo de processo. |
| `tipo-processo.routes.ts` | PUT | `/tipos-processo/:id` | Atualiza tipo de processo. |
| `tipo-processo.routes.ts` | PATCH | `/tipos-processo/ordenar` | Reordena em lote (drag-and-drop, define ordem das abas no painel). |
| `tipo-processo.routes.ts` | PATCH | `/tipos-processo/:id/ativar` \| `/:id/inativar` | Ativa/inativa (só tipos ATIVOS geram aba no painel). |

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

---

## 10. Planos de Produção, Frente/Costa e Requisição de Corte (RC)

Spec: `.kiro/specs/pcp-planos-frente-costa-rc/`. Três ajustes pedidos pela
Carton Wega para o painel refletir a estrutura real da OS gráfica do GPrint.

### 10.1 Planos de Produção (`PlanoOrdemProducao`)

Uma OS pode ter vários **planos/componentes** (ex.: TAMPA, CAIXA, BOLSA),
cada um com formato/cores/tiragem e **roteiro de acabamento próprios**. Model
`PlanoOrdemProducao` (tabela `plano_ordem_producao`): `nome`, `tipo`
(`COMPONENTE | FACE`), `formato`, `cores`, `tiragem`, `montagem`, `faceDeId`
(auto-FK p/ frente/costa), `sequencia`. FK para `OrdemProducao` (Cascade).

`EtapaOrdemProducao` ganhou `planoId` (**nullable**, `onDelete: SetNull`).
**REGRA DE COMPATIBILIDADE CRÍTICA**: `planoId = NULL` significa "plano único
/ sem plano" e é o comportamento legado — toda etapa antiga continua
funcionando igual. NUNCA exigir plano em query/lógica. OPs antigas só ganham
planos se forem **reimportadas** (não há migração automática).

### 10.2 Frente/Costa (planos tipo FACE)

Impressão em retiração (tira-retira): a mesma folha passa 2× na máquina.
Detectado no parser quando a coluna Cores é `NxM` com N>0 e M>0 (ex.: `7x5`),
tipicamente com tiragem `qtd x 2`. Gera **2 planos FACE** (FRENTE/COSTA) na
MESMA OP (número único — NÃO duplica a OP), a COSTA com `faceDeId` → FRENTE.
A tiragem base é `qtd` (o `x 2` indica as 2 passagens, não dobra a quantidade).

### 10.3 Parser (`gprint-parser.ts`)

`extrairPlanos(texto)` (função pura, aditiva) lê a tabela de processo
(`Plano/Formato/Mont./Tiragem/Cores/.../Acabamento`) e retorna `PlanoOp[]`.
**Só retorna planos quando há 2+** — para OS de plano único devolve `[]` e o
fluxo atual (`etapas[]` achatado) é usado (NÃO-REGRESSÃO garantida; validado
por `scripts/testar-todos-pdfs-op.ts` antes/depois + testes em
`gprint-parser.test.ts`). As etapas de cada plano vêm da coluna Acabamento
(split por vírgula respeitando parênteses). ATENÇÃO: a regex de cores/montagem
usa lookbehind/lookahead `(?<![\d.])...(?![\d.])` para não confundir a tiragem
`8.250 x 2` com cores `0x2`.

### 10.4 Confirmação da importação (`importacao-op.routes.ts`)

Após criar as etapas pelo fluxo normal (intocado), se `dados.planos.length
>= 2`, cria os `PlanoOrdemProducao` e vincula cada etapa ao plano por
**correspondência de descrição normalizada**. Planos FACE: acabamento comum
fica na FRENTE (default). Na reimportação (substituição total), os planos são
apagados (`planoOrdemProducao.deleteMany`) e recriados do novo PDF — todas as
travas de confirmação (CONCLUIDA/CANCELADA bloqueado, apontamento descartado
com aviso) permanecem inalteradas.

### 10.5 Painel (`etapa-operacional.routes.ts` + `programacao/page.tsx`)

O painel inclui `plano: { id, nome, tipo }` em cada etapa (via `select`, sem
N+1). O frontend exibe um badge: `cyan` para COMPONENTE, `violet` para FACE
(ex.: "OP 3.133 · TAMPA"). Etapa sem plano = render legado inalterado. A
conclusão da OP (`todasEtapas.every(CONCLUIDA)`) já abrange todos os planos.

### 10.6 Requisição de Corte — RC (`RequisicaoCorte`)

Formulário FO-002/PCP. É uma **"OP avulsa de corte"**: aparece como linha na
MESMA fila ordenável das OSs (id dnd `rc:<id>`), arrastável.

**MUDANÇA 12/10/2026 (pedido do usuário):** a RC agora segue os **status da OP**
e é **criada no menu Ordem de Produção**, não mais na Programação.
- **Status**: `RASCUNHO → PLANEJADA → PROGRAMADA → LIBERADA → EM_PRODUCAO →
  CONCLUIDA` (+ `CANCELADA`). Os status antigos de corte (`ABERTA/EM_CORTE/
  CORTADA/EM_GUILHOTINA`) foram REMOVIDOS. Migração de dados no `migrate-prod.ts`
  (idempotente): `ABERTA→LIBERADA`, `EM_CORTE/CORTADA/EM_GUILHOTINA→EM_PRODUCAO`.
- **Criação**: tela nova `pcp/ordens-producao/requisicoes-corte/page.tsx` (menu
  PCP → "Requisições de Corte", sob Ordens de Produção). Nasce em RASCUNHO; o
  usuário seleciona a **Cortadeira** (centro) que vai entrar. O botão "RC" dos
  cards CORTADEIRA da Programação foi REMOVIDO.
- **Fila da Programação**: a RC só aparece quando `LIBERADA`/`EM_PRODUCAO`
  (antes era `ABERTA/EM_CORTE/EM_GUILHOTINA`). A transição administrativa é
  `PATCH /requisicoes-corte/:id/status` (RASCUNHO→...→LIBERADA; ao LIBERAR,
  recebe `posicaoFila` do centro; qualquer status não-LIBERADA tira da fila).
- **Funcionamento de chão IDÊNTICO**: iniciar corte (`/iniciar` → EM_PRODUCAO,
  grava `dataInicioCorte`), concluir corte (`/concluir` → vai p/ guilhotina
  destino OU CONCLUIDA), guilhotina (`/iniciar-guilhotina`, `/concluir-guilhotina`
  → CONCLUIDA). O **ESTÁGIO** corte vs guilhotina NÃO é mais um status: é
  derivado das DATAS (`dataFimCorte` + `guilhotinaDestinoId` + guilhotina sem
  fim = estágio GUILHOTINA). O painel (`etapa-operacional.routes.ts`) expõe
  `estagio: 'CORTE'|'GUILHOTINA'` em cada RC; o front usa esse campo para as
  ações/badges (fallback para o status antigo por compat.).

`posicaoFila` COMPARTILHADA com as etapas no centro — reordenação combinada via
`PATCH /pcp/programacao/reordenar-fila-cortadeira`. Rotas em
`requisicao-corte.routes.ts` (CRUD + status + iniciar/concluir/reabrir/reordenar
+ PDF em `requisicao-corte-pdf.service.ts`). Numeração `NN/AAAA` por empresa/ano.
Isolamento por `empresaId` explícito. Helper `proximaPosicaoFila(empresaId,
centroId)` + `STATUS_NA_FILA = ['LIBERADA','EM_PRODUCAO']`.

### 10.7 RC no Checkout (chão de fábrica) — 14/10/2026

A RC também aparece no **Checkout** (app `VisioFab.Checkout`), na fila do centro
do terminal, igual às etapas de OP. Implementação em `checkout.service.ts` +
`checkout.routes.ts` (prefixo do checkout, auth do terminal `checkoutAuth`):
- `GET /checkout/rcs` → `listarRcsDoCheckout(checkoutUser)`: lista as RCs
  `LIBERADA`/`EM_PRODUCAO` cujo centro da fila **do estágio atual** bate com o
  `centroProducaoId` da sessão do terminal. O **estágio** (`CORTE`|`GUILHOTINA`)
  é derivado das datas (mesma regra do painel do PCP: `dataFimCorte` +
  `guilhotinaDestinoId` + guilhotina sem fim ⇒ GUILHOTINA). Em CORTE a RC está na
  fila da Cortadeira (`centroProducaoId`); em GUILHOTINA, na fila do
  `guilhotinaDestinoId`. Cada RC traz `contagem` (base **TIRAGEM** = folhas) para
  seguir a regra da seção 12, e `numeroExibicao` = `formatarNumeroRc(numero)`
  (RC-NNN).
- Ações por estágio (todas via `checkoutAuth`, isolam `empresaId` da RC real):
  `PATCH /checkout/rcs/:id/iniciar-corte` (→ EM_PRODUCAO, grava `dataInicioCorte`),
  `/concluir-corte` (recebe `qtdFolhasCortadeira`; vai p/ guilhotina destino OU
  CONCLUIDA), `/iniciar-guilhotina`, `/concluir-guilhotina` (recebe
  `qtdFolhasGuilhotina`; → CONCLUIDA). Funções: `iniciarCorteRc`,
  `concluirCorteRc`, `iniciarGuilhotinaRc`, `concluirGuilhotinaRc`,
  `buscarRcDoTerminal`, `proximaPosicaoFilaCheckout` em `checkout.service.ts`.
- **Máquina da sessão**: `GET /checkout/sessao` (`dadosDaSessaoCheckout`) retorna
  o centro do terminal; o painel do checkout exibe "Máquina: COD - Descrição
  (Tipo)" no cabeçalho, para o operador saber em qual máquina está apontando.
- Front: `VisioFab.Checkout/src/app/painel/page.tsx` renderiza os cards de RC com
  botões por estágio e pede a quantidade de folhas na conclusão.

---

## 11. Contagem por Contador de Máquina (Checkout)

Spec: `.kiro/specs/checkout-contagem-por-contador/`. Recurso **aditivo**: o
modo padrão continua `QUANTIDADE` (não-regressão garantida). Permite apontar a
produção de um Centro pelo **contador/odômetro acumulativo** da máquina —
quantidade = `leituraFinal − leituraInicial` (padrão MES de mercado:
Sepasoft/Vorne). A inicial é **derivada no backend** (a última leitura final
vira a próxima inicial); nunca aceita do cliente.

### 11.1 Modelo de dados

- **`CentroProducao`** ganhou `modoContagem` (`QUANTIDADE | CONTADOR`, default
  `QUANTIDADE`) e `contadorZeraDiariamente` (Boolean, default `false`). O
  reset diário só é relevante em `CONTADOR`: no 1º apontamento de cada dia
  civil local (America/Sao_Paulo, offset -3h) a leitura inicial assume `0`.
- **`LeituraContador`** (`leitura_contador`) — uma leitura por apontamento de
  Produção em centro CONTADOR: `centroProducaoId`, `etapaOrdemProducaoId`,
  `apontamentoEtapaId?`, `leituraInicial`/`leituraFinal`/`quantidade`
  (Decimal 14,2; `quantidade = final − inicial >= 0`), `resetDoDia`,
  `funcionarioId?`, `dataHora`. **Isolamento por `empresaId` da OP/centro
  real** (gravado no apontamento do terminal, não o do usuário logado).
- **`LogLeituraContador`** (`log_leitura_contador`) — auditoria de correção de
  leitura: `leituraContadorId`, `campo` (`leituraInicial`|`leituraFinal`),
  `valorAnterior`, `valorNovo`, `usuarioId?`.

### 11.2 Motor puro (sem Prisma)

`src/modules/checkout/contador-maquina.service.ts` — funções puras testadas em
`contador-maquina.service.test.ts` (vitest + fast-check, **14/14**):
- `derivarInicial({ ultimaLeituraFinalDoCentro, zeraDiariamente,
  jaTemLeituraHoje })` → `{ leituraInicial, resetDoDia }`.
- `calcularQuantidade(inicial, final)` → `final − inicial`; lança
  `ContadorError` 400 se `final < inicial` (sem rollover).
- `validarCadeia(leituras[])` → inconsistências com o `valorEsperado`
  (inicial de uma leitura deve casar com a final anterior, salvo `resetDoDia`).
- `dataCivilBrasilia(date)` → data civil local `-3h` (base do reset diário).

### 11.3 Endpoints novos

| Método | Rota | Lado | Descrição |
|---|---|---|---|
| GET | `/checkout/etapas/:id/contador` | Terminal (operador) | Retorna `{ modo, leituraInicial, zeraDiariamente }`. Em `CONTADOR`, a inicial já vem derivada. Isolamento via `buscarEtapaDoTerminal` (sessão do terminal). |
| POST | `/checkout/etapas/:id/apontar` (estendido) | Terminal | Para PRODUCAO em centro CONTADOR, aceita `leituraFinal`; o backend deriva a inicial, calcula a quantidade, cria `ApontamentoEtapa` + `LeituraContador` e atualiza `quantidadeProduzida` da etapa. **PERDA/RETRABALHO e modo QUANTIDADE inalterados.** |
| GET | `/api/pcp/centros/:id/contador/historico` | ERP/PCP (supervisor) | Lista cronológica (asc) das `LeituraContador` do centro (inicial/final/qtd/operador/data), isolada por `empresaId`. Centro de outra empresa → 404. |
| PATCH | `/api/pcp/contador/leituras/:id` | ERP/PCP (supervisor) | Corrige `leituraInicial`/`leituraFinal`: valida a cadeia, grava `LogLeituraContador`, recalcula a quantidade da leitura e o total da etapa. Quando a correção quebra a consistência, retorna **409 com o valor esperado**. |

Rotas de terminal em `checkout.routes.ts`/`checkout.service.ts`
(auth do terminal). Rotas de ERP em `contador-pcp.routes.ts`/
`contador-pcp.service.ts` (`authenticate` + `moduloGuard('PCP')`, prefixo
`/api/pcp`) — correção fica no ERP (supervisor/PCP), **não** no terminal. A
leitura inicial é travada no apontamento; só o histórico (perfil PCP) corrige,
com log e validação de consistência.

### 11.4 PENDÊNCIA / DÍVIDA conhecida — logs de correção não têm endpoint de leitura

O backend **grava** `LogLeituraContador` na correção (dois `create` por campo
alterado em `contador-pcp.service.ts`), mas **ainda NÃO existe endpoint que
exponha esses logs persistidos para leitura**. O `GET
/api/pcp/centros/:id/contador/historico` retorna apenas as `LeituraContador`
(não os logs). O front do bloco 7 (histórico/correção no PCP) mostra só as
**correções da sessão atual** (resposta do PATCH) + marca visualmente as
leituras que foram corrigidas — não lê o histórico persistido de auditoria.
Para expor o trilho de auditoria completo (quem/quando/valor anterior→novo de
cada correção passada), falta criar a rota de leitura de `LogLeituraContador`
(ex.: `GET /api/pcp/contador/leituras/:id/logs` ou embutir os logs no
histórico do centro) + o consumo no frontend. Tratar quando o usuário pedir
rastreabilidade de correções.

---

## 12. Base de Contagem por Tipo de Processo (Tiragem vs Unidade)

Spec: `.kiro/specs/base-contagem-por-tipo-processo/`. Padroniza, em TODAS as
superfícies que exibem progresso/meta de produção, a **base de contagem**
derivada do Tipo de Processo do centro.

### Regra (travada)
- **COLAGEM** (`TipoProcesso.codigo === 'COLAGEM'`) → base **UNIDADE** (peças montadas).
- **Qualquer outro** tipo (Cortadeira, Impressão, Acabamento, Acoplagem, Corte
  Vinco, Verniz, …) → base **TIRAGEM** (folhas/passagens).

Acoplagem/Corte Vinco NÃO são códigos próprios de `TipoProcesso` (máquinas assim
entram como `ACABAMENTO`), então a regra "demais → Tiragem" já os cobre. A função
só testa "é COLAGEM?".

### Fonte única (backend)
`src/modules/pcp/base-contagem.service.ts` (funções PURAS, testadas com fast-check
em `base-contagem.service.test.ts`, 13 testes / 9 Correctness Properties):
- `baseContagem(codigo) → 'UNIDADE' | 'TIRAGEM'`.
- `resolverPlanejadoDaEtapa(etapa, plano, op) → { base, planejado, apontado, progresso }`.
  - base pela regra; plano implícito quando `plano == null` (usa `op.quantidade`);
    UNIDADE usa `plano.unidade` senão `op.quantidade`; TIRAGEM usa `plano.tiragem`
    senão fallback de NÃO-REGRESSÃO (`quantidadePrevista>0 ? quantidadePrevista :
    op.quantidade`); desmembramento (`quantidadePrevista>0`) sobrepõe; `apontado =
    quantidadeProduzida` **bruto, nunca convertido** (R3); `progresso` 0..100.
- `exigirEmpresaId(empresaId)` lança `BaseContagemError` (400) se escopo ausente (R14.3).

### Como as superfícies consomem
Cada rota de backend **anexa o campo derivado `contagem`** ao payload (aditivo —
os campos legados `quantidade/quantidadeProduzida/percentual/tiragem` continuam).
O **frontend só renderiza `contagem.*`** — NÃO reimplementa a regra:
- `GET /pcp/programacao/painel` (etapa-operacional.routes.ts) → `etapa.contagem`.
- `GET /pcp/quadro-producao` → `etapaAtual.contagem`.
- `GET /pcp/etapas/:id/apontamentos` → `contagem` (planejado/base da etapa).
- `GET /pcp/dashboard/indicadores` (dashboard-unificado.routes.ts) → `producaoDiaria[].base`
  (rótulo de unidade por Tipo de Processo; OEE/Pareto usam o bruto, inalterados).
- Checkout `listarPainelCheckout` (checkout.service.ts, `GET /checkout/painel`) → `contagem`.
- Painel de Produção (TV) reusa `GET /programacao/painel`.
Front: `pcp/programacao/page.tsx` (totalizador + rótulo do modal via `contagem.base`;
a antiga `unidadeContagem` agora recebe a `base` do payload), `pcp/painel-producao`,
`pcp/quadro-producao`, e `VisioFab.Checkout/src/app/painel/page.tsx`.

### Decisões (D1/D2)
- **D1**: Unidade = `OrdemProducao.quantidade` (colagem opera no produto final /
  plano único). Não há "peças por plano" persistido no schema.
- **D2**: a base é derivada do Tipo de Processo **ATUAL** (sem persistir a base no
  apontamento, SEM mudança de schema, SEM migração). O apontamento bruto nunca é
  alterado. Reclassificar o tipo de um centro é raro/administrativo; se um dia for
  exigido congelamento histórico por apontamento, persistir base/planejado no
  `ApontamentoEtapa` (tocaria schema + migrate-prod).

### Multi-tenant
Toda agregação filtra `empresaId` explícito da OP real (nunca só `prismaScoped` —
bypass SUPER_ADMIN). O `GET /etapas/:id/apontamentos` resolve a etapa com
`ordemProducao: { empresaId: user.empresaId }`.

### NÃO toca o apontamento
`POST /checkout/etapas/:id/apontar` e `POST /pcp/etapas/:id/apontar` permanecem
inalterados — gravam o dado bruto. A base só muda EXIBIÇÃO/meta/progresso.

---

## 13. ✅ ENTREGUE (18/10/2026) — filtro de centros + reformulação dos Apontamentos

**STATUS: CONCLUÍDO e no ar** (back `5510ff267` + `81dc1c7c2`; front `bd6234d`).

### Tema 1 — filtro de centros (feito)
`disponivelProgramacao: true` adicionado ao `where` de `centroProducao.findMany`
em `GET /pcp/quadro-producao` + dropdown de máquina (etapa-operacional.routes.ts)
e `GET /pcp/dashboard/indicadores` (dashboard-unificado.routes.ts). O painel de
Programação já filtrava. Agora todos os quadros/dashboards só exibem centros
ATIVOS e disponíveis para programação.

### Tema 2 — módulo Apontamentos BI (feito)
Spec `pcp-apontamentos-dashboards-relatorios`. Reformulação total sobre
`ApontamentoEtapa` (fonte real), modo B (metas + valorização R$):
- **Schema**: model `MetaProducaoCentro` (`meta_producao_centro`) +
  migrate-prod.ts idempotente (CREATE TABLE/INDEX IF NOT EXISTS). Migração local
  não rodou (Postgres local off); roda no deploy do Render.
- **Backend** (`src/modules/pcp/apontamentos-bi/`): motor puro
  `apontamentos-valorizacao.service.ts` (valorizar/percentualAtingido/
  mesCivilBrasilia — 10/10 testes); agregação `apontamentos-bi.service.ts`
  (dashboard por centro+série diária, produtividade operador/máquina por mês,
  histórico paginado — 7/7 testes com mocks); PDFs `apontamentos-bi-pdf.service.ts`
  (relatório diário + totais por centro, pdfkit); rotas `apontamentos-bi.routes.ts`
  (prefixo /api/pcp, authenticate, isolamento empresaId explícito).
  Endpoints: `GET /apontamentos-bi/dashboard|produtividade|historico`,
  `GET /apontamentos-bi/relatorio-diario.pdf|dashboard.pdf`, CRUD
  `/apontamentos-bi/metas`.
- **Valorização**: `valorUnitario × qtd` (quando houver) OU `custoHora × horas
  produtivas` (proxy = `tempoRealMinutos` da etapa, senão `setupDuracaoMinutos`).
  Sem base → R$ 0 (nunca erro).
- **Frontend**: `pcp/apontamentos/page.tsx` reformulada (abas Dashboard /
  Produtividade / Histórico / Relatórios / Metas; seletor de período + centro;
  PDFs abrem via token na query). Não usa mais `GET /apontamentos-producao`.
  Build Next OK (rota 12.6 kB).

### Pendências/limitações conscientes
- A valorização por `custoHora × horas` depende de `tempoRealMinutos`/
  `setupDuracaoMinutos` estarem preenchidos nos apontamentos; se o chão não
  preencher tempo, o R$ por custoHora fica 0 — nesses casos cadastrar
  `valorUnitario` (hoje não há campo de valorUnitario por centro no schema; a
  valorização unitária está prevista no motor mas sem cadastro — adicionar
  campo `valorUnitarioProducao` em CentroProducao se o usuário quiser R$ por
  peça/folha em vez de por hora).
- Gráficos de barra por dia: o backend já entrega `serieDiaria`; o front hoje
  mostra tabelas + cards + barras de meta. Se quiser os gráficos de barras
  idênticos às planilhas (recharts), é um incremento visual aditivo.

<!-- Histórico do levantamento original abaixo (mantido para referência). -->

### (levantamento original) Pedido do usuário:

1. **Filtro de centros** em TODOS os quadros/dashboards/menus que listam centros
   de produção: exibir só os **ATIVOS** (`CentroProducao.status === true`) **E**
   os que NÃO estão "fora de programação" (`disponivelProgramacao === true`,
   coluna `disponivel_programacao`).
2. **Menu Apontamentos** — reformular TOTAL: dashboards, relatórios,
   totalizadores por centro produtivo ativo/disponível, histórico completo por
   período, consultas com impressão (PDF).

### Levantamento (não reinvestigar)

**TEMA 1 (rápido — fazer primeiro):** `GET /pcp/programacao/painel` JÁ filtra
`{ status: true, disponivelProgramacao: true }` (correto). FALTA adicionar
`disponivelProgramacao: true` ao `where` de `centroProducao.findMany` em DOIS
pontos:
- `GET /pcp/quadro-producao` em `etapa-operacional.routes.ts` (~linha 1614) —
  hoje só `{ empresaId, status: true }`.
- `GET /pcp/dashboard/indicadores` em `dashboard-unificado.routes.ts` (~linha
  173) — hoje só `{ empresaId, status: true }`.
Depois: `git grep` por outros `centroProducao.findMany` sem o filtro; conferir
telas front (quadro-producao, painel-producao, dashboard de indicadores).

**TEMA 2 (grande):** a tela atual `pcp/apontamentos/page.tsx` (hoje VAZIA/removida
do disco) listava `ApontamentoProducao` via `GET /apontamentos-producao` —
**fonte ERRADA** (quase sempre vazia: o chão de fábrica grava em
`ApontamentoEtapa`, não em `ApontamentoProducao`).
- **Fonte de verdade = `ApontamentoEtapa`** (schema ~linha 3530): `tipo`
  (PRODUCAO|PERDA|PARADA|RETOMADA), `quantidadeProduzida`, `quantidadePerda`,
  `quantidadeRetrabalho`, `motivoPerda`, `motivoParada`, `tempoParadaMinutos`,
  `observacao`, `fotoUrl`, `dataHora`, `funcionarioId`, `fonteApontamento`,
  `setupInicio/Fim/DuracaoMinutos`, `etapaOrdemProducaoId`. Índice
  `(empresaId, dataHora)`. Relação `etapaOrdemProducao → ordemProducao +
  centroProducao`.
- Rotas existentes: `POST /pcp/etapas/:id/apontar`, `GET /pcp/etapas/:id/apontamentos`
  (por etapa). `GET /pcp/dashboard/indicadores` já agrega `apontamentoEtapa.findMany`
  (OEE/Pareto). NÃO existe listagem/relatório consolidado a nível de menu nem PDF.
- PDF: lib **pdfkit** (`import PDFDocument from 'pdfkit'`, ver
  `op-pdf-gerado.service.ts` como padrão). Sidebar: `ModuleSidebar.tsx` ~linha
  436 (`{ label: 'Apontamentos', href: '/pcp/apontamentos' }`).
- Multi-tenant: filtrar `empresaId` EXPLÍCITO da OP real (não só `prismaScoped` —
  bypass SUPER_ADMIN; ver steering ATENCAO-pontos-verificar §2.1).

### Decisão de processo
Dado o tamanho (dashboards + relatórios + PDF), o Tema 2 merece UMA spec nova
(requirements→design→tasks). O Tema 1 é cirúrgico (2 `where`), pode ir direto.
NADA desta pendência toca o agente Calcgraf. **Confirmar escopo do Tema 2 com o
usuário antes de implementar** (houve retrabalho prévio por ambiguidade).

---

## 14. Menu Gerencial + Relatório Mensal de Produção (18/10/2026 — ENTREGUE)

Spec `pcp-relatorio-gerencial-producao`. Novo menu **Gerencial** no PCP
agrupando: Relatório Mensal de Produção (novo), Mapa de Custos (RKW), Análise
Gerencial (RKW) e Códigos de Parada. Replica as planilhas gerenciais da Carton
Wega. Valorização SOMENTE por custo. Back `0ddee25a3`+`e8eefe29c`+`3ecd8153e`;
front `dc83921`.

### Schema novo (migrate-prod idempotente, roda no deploy)
- `MetaProducaoProcesso` (`meta_producao_processo`) — meta diária por tipo de
  processo (coexiste com `MetaProducaoCentro`).
- `CodigoParada` (`codigo_parada`) — código de parada customizável por empresa
  (`@@unique([empresaId, codigo])`), usado no Pareto.
- `ApontamentoEtapa.codigoParadaId` (nullable, aditivo) — enum `motivoParada`
  mantido por compat.

### Backend (`src/modules/pcp/gerencial/`)
- `gerencial-cadastros.routes.ts` — CRUD `/pcp/gerencial/metas-processo` e
  `/pcp/gerencial/codigos-parada` (isolamento empresaId, 409 em código duplicado).
- `relatorio-producao.service.ts` — agregação do mês: `resumoPorProcesso`
  (base de contagem por processo + valor custo + meta/%), `serieDiariaConsolidada`
  (pico/2º/3º/média/menor), `dadosDiariosPorCentro` (matriz data×centro),
  `paretoParadas` (código cadastrado, fallback motivoParada), `opsEmitidasPorMes`
  (comparativo anual por `criadoEm`), `trabalhosEmMaquina` (OPs/clientes do dia,
  cliente via tag [Cliente]). `intervaloMes(ano,mes)` em BRT (-3h).
- `relatorio-producao.routes.ts` — `GET /pcp/gerencial/producao-mensal`
  (resumo+diaria+pareto), `/dados-por-centro`, `/produtividade` (reusa
  `agregarProdutividade`), `/ops-emitidas`, `/pareto-paradas`,
  `/trabalhos-em-maquina`, `/producao-mensal.pdf` (token via query).
- `relatorio-producao-pdf.service.ts` — PDF pdfkit (resumo+diária+pareto).
- Testes: `relatorio-producao.service.test.ts` 6/6; valorização
  `horasPorVelocidade` em apontamentos-valorizacao (20/20 no módulo apontamentos-bi).

### Valorização por custo (importante)
`valorRs = custoHora × horas`, com `horas = produção ÷ velocidade` (campo
`CentroProducao.velocidade`) e fallback no `tempoOperacaoCalculado` da etapa /
`setupDuracaoMinutos`. Sem custoHora/velocidade → R$ 0 (só quantidade).
**Custo-hora/velocidade dos centros da Carton Wega estão PARCIALMENTE preenchidos**:
`scripts/popular-custo-velocidade-centros.ts <empresaId> [--apply]` populou 11
centros automaticamente (de-para por nome normalizado com os exports do Calcgraf
em `cartoon/export/`); os ~60 restantes têm nome divergente Vizor↔Calcgraf e
devem ser preenchidos manualmente na tela PCP → Cadastros → Centros (campos
Custo/Hora e Velocidade já existem). O script só preenche campos nulos/0 (nunca
sobrescreve ajuste manual).

### Frontend
- `ModuleSidebar.tsx` — grupo "Gerencial" (os itens RKW saíram de soltos para
  dentro dele).
- `pcp/gerencial/producao-mensal/page.tsx` — seletor mês/ano + abas
  (Resumo por Processo / Produção Diária / Pareto) + botão PDF.
- `pcp/gerencial/codigos-parada/page.tsx` — CRUD de códigos de parada.

### COMPLETADO (18/10/2026 — 2ª leva, "faça completo")
- **Tela Relatório Mensal COMPLETA** (front `1216330`): 7 abas — Resumo (gráfico
  de barras por processo), Produção Diária (linha + ReferenceLine da média),
  Metas por Processo (linha diária + ReferenceLine meta/média), Dados por Centro
  (matriz data×centro com meta), Produtividade (barras + tabela mês×operador/
  máquina), OPs Emitidas (barras comparativo 3 anos + tabela), Pareto (barras +
  tabela). Gráficos com **recharts** (3.10.0, já no projeto). PDF mantido.
- **Código de parada no apontamento** (back `b5ef95fea`, front `1216330`): a
  pausa de etapa (`PATCH /pcp/etapas/:id/pausar`) agora aceita `codigoParadaId`
  opcional (aditivo; `pausarEtapa` grava no ApontamentoEtapa). O modal "Pausar
  Etapa" da Programação mostra um Select de Código de Parada (carregado de
  `/pcp/gerencial/codigos-parada`, só quando há códigos cadastrados). O Pareto do
  relatório usa o código quando presente, senão cai no enum `motivoParada`.

### COMPLETADO (18/10/2026 — 3ª leva)
- **Custo-hora populado**: além dos 11 automáticos, mais **35 centros** via de-para
  MANUAL conferido 1-a-1 (`scripts/depara-custo-manual-wega.ts`, aplicado em
  produção). Total **46 centros com custo-hora** — todos os principais das
  planilhas cobertos (CD5=440, CD7=550, KBA=480, Bobst E/S=300/280, Cortadeiras=
  113.21, Guilhotinas=77.69, etc.). O script só preenche nulo/0 (idempotente).
  Centros restantes (serviços manuais raros) ficam para a tela quando precisar.
- **Aba "Trabalhos em Máquina"** no Relatório Mensal (front `87cc50b`): seletor de
  dia (sugere o pico do mês) → lista OP/cliente/máquina apontados no dia, via
  `GET /pcp/gerencial/trabalhos-em-maquina`. Replica as planilhas "trabalhos que
  estavam em máquina nos dias que batemos a meta".

### Estado final: módulo gerencial 100% das imagens entregue.
Nada pendente das planilhas da reunião. Evoluções futuras só se o usuário pedir.

---

## 15. Melhorias no Gantt de Produção (spec pcp-gantt-melhorias)

Spec `.kiro/specs/pcp-gantt-melhorias/`. Evolução **ADITIVA e NÃO-REGRESSIVA**
do Gantt `/pcp/gantt` ao padrão de APS/MES de mercado (Bryntum/DHTMLX stack
layout + event color + dependency lines; Preactor/Opcenter capacidade finita;
MS Project zoom ancorado/setas FS). Sem usar as features novas, motor e render
continuam idênticos aos de hoje. Backend e frontend são repos SEPARADOS.

### 15.1 Schema (`VisioFab.Wms.Back`)

`OrdemProducao` ganhou DOIS campos **dedicados ao Gantt** (NÃO confundir com o
campo existente `cor`, que é da impressão gráfica):
- `corGantt` (`cor_gantt`, VARCHAR(9), nullable) — cor hex da OP no Gantt.
- `statusGanttObs` (`status_gantt_obs`, VARCHAR(120), nullable) — observação de
  status exibida no Gantt.

`migrate-prod.ts` idempotente: dois `ALTER TABLE ordem_producao ADD COLUMN IF
NOT EXISTS ...`. Migração local NÃO rodou (Postgres local off) — roda no deploy
do Render (idempotência garantida por `IF NOT EXISTS`). Schema + migrate-prod
no MESMO commit (steering database-migrations).

### 15.2 Backend — motor no-overlap + rotas

- **Motor puro** `timeline-agenda.service.ts`: nova função `resolverNoOverlap`
  (capacidade finita = 1 operação por máquina por vez; etapas **travadas** =
  pontos fixos; etapas não-travadas empurradas para o 1º instante livre
  respeitando turno/exceções). Flag `noOverlap` em `calcularAgenda` (default
  `true` na rota). **NÃO-REGRESSÃO**: sem colisão, a saída é idêntica à atual
  (`max(inicio, cursorLivre) == inicio`). Testes `timeline-agenda.service.test.ts`
  = **31/31** verdes (Properties 1–4 do no-overlap via fast-check: sem colisão ⇒
  saída idêntica; nunca há sobreposição na mesma raia; travadas preservadas;
  determinismo).
- `GET /pcp/timeline` (`timeline-producao.routes.ts`): expõe `corGantt`/
  `statusObs` por OP (aditivo no `select` e no payload).
- Rota NOVA `PATCH /api/pcp/ordens-producao/:id/gantt` (body `{ corGantt?,
  statusGanttObs? }`): grava cor/status; cor validada por regex hex
  (`^#([0-9a-fA-F]{6}|[0-9a-fA-F]{8})$` ou null); permissão `podeMover`;
  isolamento `empresaId` EXPLÍCITO (`findFirst({ id, empresaId })` → 404 em
  cross-empresa); grava `LogOrdemProducao`.

### 15.3 Frontend (`/pcp/gantt/page.tsx` + novo `gantt-layout.ts`)

- **Helpers puros** `gantt-layout.ts`: `empilharBarras` (lane assignment /
  interval partitioning → `subLinha`/`maxSubLinhas`), `ocupacaoPorDia`,
  `minutosUteisDoDia`, `xInicio`, `xFim`. Testes **17/17** (vitest + fast-check).
  NOTA operacional: no front, rodar vitest com `--pool=threads` (o pool padrão
  "forks" dá timeout nesta máquina).
- **Req 2** — abre ancorado no "agora" (auto-scroll na 1ª carga via flag
  `jaAncorou` + botão **"Hoje"**) + zoom contínuo ancorado no centro (botões
  −/+; `pixelsPorMinuto` como estado contínuo). Auto-refresh 60s NÃO reseta
  scroll/zoom. (Ctrl+wheel ancorado no cursor ficou como follow-up — ver 15.4.)
- **Req 3** — cor única padrão (`COR_PADRAO = #4C6EF5`, substitui o antigo ciclo
  de 20 cores) + editor (Modal com `ColorInput` + status) por OP, aplicada a
  TODAS as barras da OP; status renderizado no tooltip + dot discreto no bloco.
- **Req 4** — empilhamento visual por sub-linhas (nunca sobrepõe barras na mesma
  raia) + empurrão automático (motor no-overlap) + botão **"Resolver conflitos"**
  (reaplica a fila via `PATCH /pcp/etapas/reordenar`).
- **Req 5** — filtros por máquina/processo/indicador (visual-only) + foco da OP
  (clicar realça, demais `opacity 0.25`) + setas de dependência reais (overlay
  SVG com bezier + marker, suporta dependência "para trás").
- **Req 6** — toggle **"Reagendar | Reordenar fila"**; em "Reordenar fila" o drag
  troca a ordem da fila (`PATCH /pcp/etapas/reordenar`), coexistindo com âncoras
  e com o drag temporal (não se anulam).
- **Req 7** — mini-faixa de ocupação/carga por máquina no rótulo da raia (média
  do período, via `ocupacaoPorDia`, sem query extra): verde <70% / âmbar 70–100%
  / vermelho >100%.
- **Req 8** — `/pcp/timeline/gantt` virou `redirect('/pcp/gantt')` (tela oficial
  única do Gantt); `/pcp/timeline` (lista) preservada como visão complementar e
  passou a apontar para `/pcp/gantt`.
- **Req 9** — virtualização vertical das raias (render só as visíveis + buffer de
  600px) para performance com muitos centros.

### 15.4 Verificação e pendências

- **Verificação**: backend **31/31** testes do motor + `get_diagnostics` limpo +
  `prisma generate` OK; frontend `get_diagnostics` limpo + `npm run build` (Next)
  ✓ Compiled (351 páginas geradas). Migração local não rodou (Postgres off) —
  roda no Render.
- **Follow-up conhecido**: Ctrl+wheel de zoom ancorado no cursor (a infra já está
  pronta em `aplicarZoom`; só faltou plugar o handler do wheel).
- **Commits**: ficam com o usuário (política do projeto — repos separados; no
  back, schema + migrate-prod no mesmo commit). Divisão: back = schema + migrate
  + motor + rotas; front = UI.

---

## 16. Correção de cores/tema do Gantt (spec pcp-gantt-tema-cores)

Spec `.kiro/specs/pcp-gantt-tema-cores/`. O cliente reclamou de "preto sobre
preto" no Gantt (`/pcp/gantt`): a tela tinha sido feita com cores de tema
ESCURO hardcoded (`var(--mantine-color-dark-7/6/5/4/3)`, `#fff`, `#555`,
`c="yellow"`, `red-9/red-7`), mas o ERP roda em tema CLARO para este cliente
(o app tem `ThemeProvider` com `forceColorScheme` — claro OU escuro).

Correção (PURAMENTE VISUAL, nenhuma lógica alterada): troca das cores fixas por
TOKENS ADAPTATIVOS do Mantine, que seguem o tema ativo — padrão de Gantts
claros de mercado (DHTMLX Material; RAG do Office Timeline):
- Fundos: `dark-7`→`--mantine-color-body`; faixa/cabeçalho de grupo
  `dark-6`→`--mantine-color-default`.
- Bordas/divisórias (`gray-5`/`dark-4/5`)→`--mantine-color-default-border`.
- Grade: virada de dia `gray-4` (solid), hora `gray-3` (dashed).
- Cabeçalho de grupo: `c="yellow"`→texto padrão (`--mantine-color-text`) fw700.
- Linha "agora" + triângulo de entrega → `red-6`.
- Pastilhas sobre a barra (passada/cadeado): fundo `#fff`→`body` (borda RAG
  preservada). Scrollbar `#555`→`gray-5`.
- Faixa de conflitos: `red-9`/`red-7`→`red-light`/`red-light-color`, textos
  `red.3`→`red.7` (vermelho CLARO legível no tema claro).
- `STATUS_BORDER` (RAG) migrado para tons Mantine nível 6 (red/orange/blue/
  green/teal/gray), harmônicos com o ERP.
- Texto DENTRO dos blocos permanece BRANCO (contraste sobre a cor saturada da
  OP — não segue o tema, de propósito).

Verificação: `get_diagnostics` limpo + `npm run build` (Next) OK. Validação
visual (claro e escuro) fica com o usuário ao subir em produção. Nenhuma outra
feature do Gantt foi tocada (seção 15).

---

## 17. Backlog do Gantt/PCP — pontos do Caio (decididos, fila)

Pontos levantados pelo cliente (Caio) após a 1ª leva de melhorias do Gantt.
Decisões já tomadas com o usuário; implementar na ordem/forma abaixo.

### 17.1 ✅ ENTREGUE — Gantt não lista máquina inativa/fora de programação
`GET /pcp/timeline` passou a filtrar as etapas por `centroProducao.status=true`
E `disponivelProgramacao=true` (commit back `070aa80a3`). Mesma regra do painel
de Programação. Era bug objetivo.

### 17.2 ✅ ENTREGUE — Desmembrar informando QUANTIDADE **e** TIRAGEM por parte
Spec `.kiro/specs/pcp-desmembrar-qtd-e-tiragem/` (4/4 tarefas). O cliente pode,
ao desmembrar entre máquinas, informar em CADA parte a sua quantidade E a sua
tiragem (podem ser diferentes entre as partes).
- **Schema**: `EtapaOrdemProducao` +`tiragemPrevista Decimal? @map("tiragem_prevista")
  @db.Decimal(12,4)` (nullable; null = base única/legado). migrate-prod idempotente
  (`ADD COLUMN IF NOT EXISTS`, roda no deploy — Postgres local off).
- **Rota** `POST /pcp/etapas/:id/desmembrar`: aceita `base: 'QTD_TIRAGEM'` com
  partes `{ centroProducaoId, quantidade, tiragem, observacao? }`; valida AS DUAS
  somas (Σqtd==qtdOp, Σtiragem==totalTiragem, tol. 0.01; 400 claro apontando qual
  soma falhou + 400 se parte sem tiragem); grava `quantidadePrevista` +
  `tiragemPrevista`; **rateio do tempo por tiragem** (dita o tempo de máquina;
  fallback quantidade se totalTiragem≤0); descrição "N un / M folhas";
  `LogOrdemProducao` com as duas bases. `totalTiragem` vem da MESMA
  `tiragemDaEtapa(...)` da Base de Contagem (seção 12). As bases únicas
  (`QUANTIDADE`/`TIRAGEM`) ficaram INTOCADAS — não-regressão.
- **Frontend** (`pcp/programacao/page.tsx`): 3ª opção "Qtd + Tiragem" no
  `SegmentedControl` do modal → por parte, DOIS `NumberInput` (qtd un + tiragem
  folhas) + centro; DUAS somas em tempo real (verde quando batem); botão
  habilita só quando AMBAS batem. As 2 abas existentes inalteradas. Build Next OK.
- **Commits**: back (schema+migrate+rota no mesmo commit) + front (modal) separados.

### 17.3 CONFIG (sem código) — "Pede login do admin ao finalizar OP em algumas máquinas"
NÃO é do Gantt; é do Checkout/Programação. A ação de concluir usa a permissão
`podeFinalizar` por tipo de processo (`permissoes-pcp.routes.ts`,
`PermissoesPorProcesso`). Em algumas máquinas o perfil do operador não tem
`podeFinalizar` → o sistema exige um usuário que tenha (admin). Decisão do
usuário: **ajustar máquina a máquina** (não liberar geral). Resolver em
**PCP → Permissões**: no perfil do operador, marcar `podeFinalizar` para os
tipos de processo daquelas máquinas (permissão granular por tipo de processo
sobrescreve a global). Nenhuma alteração de código.

### 17.4 ROADMAP (opcional) — Cascata de VÁRIAS OPs no Gantt
Manter o foco 1-a-1 como PADRÃO (clicar na OP → setas dela). Evolução OPCIONAL:
um modo "mostrar dependências de várias OPs" (todas ou as selecionadas), com
**setas FINAS e translúcidas** para não poluir, ligável só quando o usuário
quiser. Não implementar agora — fila.

---

## 18. Pedidos do Caio — 3ª leva (filtros + pausa de fim de turno)

### 18.1 ✅ ENTREGUE — Centros de Produção: ocultar inativos por padrão
Tela `pcp/cadastros/centros/page.tsx` agora lista **só os ATIVOS** por padrão
(padrão de mercado em cadastros) + toggle **"Mostrar inativos"** no cabeçalho
(traz os inativos para reativar/consultar). A rota `GET /centros-producao` já
aceitava `status=true|false`; o front passa `status='true'` por padrão e omite o
param quando o toggle liga. Front commit `bae96fe`. Nenhuma mudança de backend.

### 18.2 ✅ JÁ RESOLVIDO (reconfirmar deploy) — Gantt não listar máquina inativa/fora de prog.
É o mesmo bug da seção 17.1: `GET /pcp/timeline` filtra as etapas por
`centroProducao: { status: true, disponivelProgramacao: true }` (commit back
`070aa80a3`). O Gantt (`/pcp/gantt`) monta as raias SÓ a partir das etapas da
timeline — logo máquina inativa/fora de programação não vira raia. Se o cliente
ainda vê máquinas que considera "fora" (ex.: "Laminadora PL110", "Serviço
Terceirizado", "Sorzs"), as hipóteses são: (a) a tela foi vista ANTES do deploy
do `070aa80a3`, ou (b) esses centros estão de fato `status=true` +
`disponivelProgramacao=true` no cadastro (o cliente deve inativá-los ou
desmarcar "Disponível na Programação" na tela de Centros). NÃO é bug de código —
o filtro está correto e testado.

### 18.3 ✅ ENTREGUE — Pausa de fim de turno (cálculo esperto, não conta fora do turno)
Spec `.kiro/specs/pcp-pausa-fim-turno/` (requirements+design+tasks). Problema do
Caio: operador inicia produção, vai embora no fim do turno sem pausar, e o
sistema **contabiliza a noite toda** (infla duração/velocidade/alertas).

**Decisões do usuário**: (1) **cálculo esperto** (sem cron) — desconta o tempo
fora do turno no momento da leitura; (2) motivo "Fim de Turno" (para pausa
persistida futura); (3) aplicar onde influencia o controle; (4) ligado por
padrão — como deriva do Turno do centro, vale para todo centro com turno (24h =
corrido, não-regressão). Padrão de mercado (inmation/Epicor/MachineMetrics):
tempo fora do turno é "não-agendado" e não conta.

**Implementado** (sem schema/migração):
- Motor puro `src/modules/pcp/tempo-trabalhavel.service.ts` →
  `minutosDentroDoTurno(inicio, fim, turno|null)`: interseção dia-a-dia (BRT
  -3h) de [inicio,fim] com [horaInicio,horaFim]×diasSemana; suporta turno que
  cruza meia-noite; sem turno = corrido; nunca excede o corrido. Testes 9/9
  (vitest+fast-check), inclui o caso do Caio (16:30→07:00 = 30 min).
- Quadro de produção (`GET /pcp/quadro-producao`): `tempoNaEtapa` e
  `tempoParadaMinutos` agora via `minutosDentroDoTurno` (include do centro
  ganhou `turnoProducao`).
- Checkout alerta de parada prolongada (`listarEtapasEmAlertaParadaProlongada`):
  `minutosParada` via `minutosDentroDoTurno` (sem falso alerta pela madrugada).
- `GET /pcp/etapas/:id/apontamentos` NÃO precisou mudar: `tempoParadaTotal` soma
  `tempoParadaMinutos` JÁ gravados nas paradas fechadas (não é cálculo ao vivo).

### 18.4 ✅ ENTREGUE (backend) — Contador em OP que vira o dia (problema da 2ª imagem do Caio)
NÃO é o mesmo problema da 18.3 (aquele é TEMPO; este é CONTAGEM por CONTADOR de
máquina, seção 11). Caio: OP fecha o dia com contador 10.000; amanhã a inicial
derivada voltava a **0** (centro com "Zera diariamente" ligado) → quantidade do
dia 20.000−0=20.000, somando 30.000 em vez de 20.000; e o operador não conseguia
corrigir o 0.

**Causa raiz + correção (abordagem A, aprovada)**: o contador da Wega é
**acumulativo contínuo** (não zera fisicamente). Logo:
1. **"Zera diariamente" DESMARCADO** nesses centros → `derivarInicial` já usa a
   última final como inicial do dia seguinte (10.000) e a quantidade fica certa
   (20.000−10.000=10.000 → total 20.000). É CADASTRO, não código. ⚠️ AÇÃO
   pendente do usuário: conferir que os centros de contador da Wega estão com
   "Zera diariamente" DESMARCADO na tela de Centros.
2. **Edição manual da leitura inicial** (backend FEITO):
   `registrarApontamentoContador` (checkout.service) aceita `leituraInicialManual`
   opcional — valida 0 ≤ inicial ≤ final, usa no lugar da derivada,
   `resetDoDia=false`, e registra em `LogLeituraContador` (empresaId +
   anterior→novo) para auditoria. `POST /checkout/etapas/:id/apontar` repassa o
   campo; `GET /checkout/etapas/:id/contador` expõe `temLeituraAnterior` (a
   inicial é SUGESTÃO editável). A trava "nunca aceitar inicial do cliente"
   (seção 11) foi flexibilizada com validação+auditoria.
3. **Correção pelo ERP já existia**: `pcp/cadastros/centros/[id]/contador`
   corrige a inicial de qualquer leitura (preview + validação da cadeia 409).

**Front do Checkout (FEITO)**: o `VisioFab.Checkout` está DENTRO do repo do
backend (`VisioFab.Wms.Back/VisioFab.Checkout/`, sem git próprio). O apontar
produção em modo CONTADOR (`src/app/etapa/[id]/apontar/page.tsx`) agora tem o
campo "Leitura inicial" EDITÁVEL, pré-preenchido com a sugestão derivada; quando
`temLeituraAnterior`, mostra "Sugerida a partir da última leitura (N). Ajuste se
o contador continuou de ontem." e envia `leituraInicialManual` só quando o
operador altera. ⚠️ AÇÃO do usuário restante: deixar os centros de contador da
Wega com "Zera diariamente" DESMARCADO no cadastro.

### 18.5 ✅ Códigos de Parada da Wega cadastrados em produção (lista do Caio)
Seed `scripts/seed-codigos-parada-wega.mjs` (idempotente, `ON CONFLICT DO
NOTHING`) populou os **16 códigos de parada** da Carton Wega (empresa
`75848e24-...`) na tabela `codigo_parada` em produção (Neon), usados no Pareto
do Relatório Mensal e no modal "Pausar Etapa". Lista: Aguardando chapa / cartão /
aprovação / aprovação do cliente / fim do processo / pré-impressão / amostra /
liberação da qualidade, Acerto de máquina-setup, Matéria prima com defeito,
Falta de matéria prima, Manutenção, Serviço cancelado, Reunião, Falta de energia,
Outros. A connection string do Neon é passada por env (`DATABASE_URL_PROD`),
NUNCA no arquivo; o script RECUSA rodar contra localhost. Rodar de novo não
duplica (upsert por `empresaId,codigo`).

### 18.6 ✅ Códigos de Parada agora aparecem no CHECKOUT (terminal)
Antes os códigos de parada só apareciam no modal "Pausar Etapa" do painel do ERP.
Agora também no Checkout (`VisioFab.Checkout`, dentro do repo do backend):
- **Backend**: nova rota `GET /checkout/codigos-parada`
  (`listarCodigosParadaDoCheckout`, isolada por empresa do terminal, só ATIVOS).
  `PATCH /checkout/etapas/:id/pausar` e `pausarEtapaComMotivo` passaram a aceitar
  `codigoParadaId` opcional → repassado a `pausarEtapaOperacional` → gravado no
  `ApontamentoEtapa` (enum `motivoParada` segue obrigatório, compat.). O Pareto
  do relatório usa o código quando presente.
- **Frontend** (`src/app/etapa/[id]/pausar/page.tsx`): carrega os códigos no
  carregamento da tela e mostra um `<select>` "Código de parada (opcional)" —
  só aparece quando há códigos cadastrados; envia `codigoParadaId` no pausar.
  (`.select` adicionado ao `pausar.module.css`, estilo touch-friendly.)