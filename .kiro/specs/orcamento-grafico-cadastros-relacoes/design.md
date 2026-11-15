# Design — Orçamento Gráfico: Cadastros e Relações (Fase 1)

Status: **rascunho para aprovação do usuário.** Fluxo design-first (design → requirements → tasks).
Documentos-base: `docs/orcamento-planos-calcgraf-HANDOFF.md` (seções 3, 12 a 17) e
`docs/orcamento-planos-calcgraf-PROPOSTA.md` (seções 2 a 7). Este design não repete a análise; ele decide o que construir.

## 1. Objetivo e escopo

Dar ao Vizor os mesmos cadastros e relações que controlam a tela de orçamento do sistema legado, de forma
que a Fase 2 (tela mestre-detalhe do item e dos planos) tenha de onde ler:

1. Produto, Tipo de Plano e Defaults do produto por plano.
2. Uma **tabela genérica de relações** (aprovada pelo usuário).
3. **Material de acabamento influenciando o preço** já nesta fase, com parâmetro por tipo.
4. **Campos livres** configuráveis por proprietário (Solicitação e Pedido).
5. **Somente cadastro e visualização:** Ajuste de Produtividade (inclui Restrições Automáticas), Quebras,
   Limites de Montagem. Não alteram o motor nem o PCP nesta fase.
6. Importação idempotente a partir da base restaurada do legado.
7. **Telas** de cadastro e de visualização de tudo acima.

### Fora de escopo (Fase 2 ou posterior)
- Tela mestre-detalhe do item e dos planos, campos ricos do plano (3 blocos de suporte, sentido da onda etc.).
- Aplicar Ajustes de Produtividade, Quebras e Restrições Automáticas no motor ou no PCP.
- Dividir por plano o custo dos itens puxados do acervo (continua 0, custo ancorado).
- Linhas Editorial, Rótulo e as demais não usadas.
- Importar valores históricos de campos livres e a tabela 9 da `RelTabelas`.

## 2. O que já existe e será reaproveitado

| Já existe | Uso nesta fase |
|---|---|
| `LinhaProduto`, `CoberturaTinta`, `ProcessoImpressao` | Referenciados por Produto, Default e relações; ganham `codigoOrigem` |
| `AcabamentoGrafico` (já tem `planoProduto`, `materiais` Json informativo) | Atividade. Ganha `codigoOrigem`, `acondicionamento`, `caracteristicas`, `textoProposta` |
| `RestricaoAcabamento` | Restrição Manual. Ganha `codigoOrigem`, `exibirNaProposta`, `centroProducaoId` |
| `MaterialAcabamento` (`valorReferencia`) | Material de acabamento. Ganha tipo, unidade e parâmetros de cadastro |
| `SuporteGrafico`, `CentroProducao` | Alvos de relação (Suporte×Plano, Atividade×Centro) |
| `ItemOrcamentoGrafico.materiaisAcabamento` (Json) + `somarMateriaisComputados` + `aplicarMateriaisComputadosAoResultado` | **Caminho de preço do material já existente.** A seleção nova alimenta este mesmo caminho |
| `consumo-material-acabamento.ts` (`consumoVerniz`, `consumoCola`, `consumoCaixa`) | Fórmulas de consumo já validadas (cálculo 15.086) |
| `Parametro` (chave/valor por empresa, prefixos `pcp.`) | Parâmetros gerais do orçamento com prefixo `orc.` (sem tabela nova) |
| `ParametroPerda` | Continua; `QuebraGrafica` é cadastro paralelo, só visualização |

## 3. Arquitetura (alto nível)

```
Cadastros (esta fase)                          Consumidor (Fase 2 e motor)
─────────────────────                          ───────────────────────────
ProdutoGrafico ──┐
TipoPlanoGrafico ┼─► RelacaoCadastroGrafico ─►  GET /orcamento-grafico/catalogo/*  (leitura filtrada)
DefaultProdutoPlano┘   (origem × destino)        └─ "o que pode aparecer" para um produto/plano/atividade
AcabamentoGrafico/RestricaoAcabamento
MaterialAcabamento ──► SelecaoMaterialAcabamento ─► materiaisAcabamento (Json do item) ─► Material Direto
CampoLivre/CampoLivreOpcao
AjusteProdutividade | QuebraGrafica | LimiteMontagem   (só cadastro e visualização)
Importador (sqlcmd → JSON → script idempotente)
```

Princípios: `empresaId` explícito em toda query; enums como VARCHAR; sem alterar itens e planos existentes;
fórmulas puras em módulos próprios (sem importar hooks ou rotas), testáveis com Vitest e fast-check.

## 4. Modelo de dados (Prisma)

Todos os modelos têm `id uuid`, `empresaId`, `criadoEm`, `atualizadoEm` e `@@index([empresaId])`. A coluna
`codigoOrigem Int?` guarda o código do legado e tem `@@unique([empresaId, codigoOrigem])` onde fizer sentido
(índice parcial no `migrate-prod.ts`, como já feito em `calculo_grafico`).

### 4.1 Cadastros novos

**`ProdutoGrafico`** (`produto_grafico`)
`codigo`, `nome`, `linhaProdutoId` → `LinhaProduto`, `codigoOrigem`, `status`, `tributacao2026`, `tributacao2027?`,
`classificacaoFiscal?`, `fechamentoId?`, `baseUnidadePreco` (`UNITARIO` | `MILHEIRO`…), `unidadeId?`, `prazoProducaoDias`,
`faturamentoMinimo Boolean`, `valorFaturamentoMinimo Decimal?`, `tipoCartucho?`, `modoFormato`
(`TRES_DIMENSOES` | `DUAS_DIMENSOES` | `ABERTO_FECHADO` | `SANFONA_ABAS` | `PAGINA`), `formatoPadraoLargura?`,
`formatoPadraoAltura?`, `exibeRestricoes Boolean`, `exibeInformacoesComplementares Boolean`, `semImpressao Boolean`.
`@@unique([empresaId, codigo])`.

**`TipoPlanoGrafico`** (`tipo_plano_grafico`)
`codigo`, `nome`, `linhaProdutoId`, `codigoOrigem`, `fixo Boolean`, `status`, `miolo Boolean`,
`calculoAutomaticoFormato` (`SIM`|`NAO`|`OPCIONAL`), `primeiraMedida` (`LF`|`LFX2`|`LOMBADA`), `somarOrelhas`,
`somarLombada`, `ocorrencias` (`UMA`|`DUAS`|`LIVRE`), `quebraPadrao`, `corteDuploMin`, `suportePadraoId?`,
`gramaturaPadrao?`, `montagemId?`, `usarPinca`, `fibraDefault`, `frenteIgualVerso`, `caderno`, `margem1Mm`, `margem2Mm`,
`formato` (texto do modo de formato do plano). `@@unique([empresaId, codigo])`.

**`DefaultProdutoPlano`** (`default_produto_plano`)
`produtoId`, `tipoPlanoId`, `semImpressao`, `processoImpressaoId?`, `coberturaTintaId?`, `coresFrente`, `coresVerso`,
`areaTintaPerc`, `fabricanteSuporte?`, `atividadesPreMarcadas Json` (ids de `AcabamentoGrafico`).
`@@unique([produtoId, tipoPlanoId])`. Quando o produto tem plano fixo, `tipoPlanoId` aponta para o plano fixo da linha.

**`RelacaoCadastroGrafico`** (`relacao_cadastro_grafico`) — tabela genérica
`empresaId`, `tipoOrigem`, `idOrigem`, `tipoDestino`, `idDestino`, `ordem Int?`, `padrao Boolean` (marcação inicial).
`@@unique([empresaId, tipoOrigem, idOrigem, tipoDestino, idDestino])`, `@@index([empresaId, tipoOrigem, idOrigem])`,
`@@index([empresaId, tipoDestino, idDestino])`. Não guarda chave estrangeira; a integridade vem do serviço (seção 6.2).

Pares permitidos (lista fechada no código, em `relacoes-permitidas.ts`):

| Origem → Destino | Significado |
|---|---|
| PRODUTO → PLANO | tipos de plano permitidos do produto |
| PRODUTO → ATIVIDADE | atividades de produto exibidas |
| PRODUTO → ACONDICIONAMENTO | Caixa Padrão e Embalar do produto (atividades 39 e 53) |
| PRODUTO → ITEM_DIVERSO | itens diversos do produto |
| PLANO → ATIVIDADE | atividades do plano (a lista muda por tipo de plano) |
| PLANO → COBERTURA_TINTA | coberturas permitidas |
| PLANO → ITEM_DIVERSO | itens diversos automáticos |
| PLANO → SUPORTE | suportes permitidos |
| ATIVIDADE → MATERIAL | materiais selecionáveis (Cola Branca, Cola Quente, BOPP…) |
| ATIVIDADE → CENTRO | centros que executam a atividade |
| ATIVIDADE → LINHA | atividade disponível na linha |
| ATIVIDADE → TINTA | tintas de um processo (ex.: Pantone → Offset Plana) |
| MATRIZ → ATIVIDADE, MATRIZ → CENTRO | matrizes por atividade e centro |
| SUPORTE → ATIVIDADE | suporte por atividade |
| ITEM_DIVERSO → ATIVIDADE | "vínculo com atividades" do item diverso |

**`ItemDiversoGrafico`** (`item_diverso_grafico`) — catálogo dos itens que não são material de acabamento
`codigoOrigem`, `nome`, `origem` (`CENTRO_DE_CUSTO`|`SERVICO_EXTERNO`|`PRE_IMPRESSAO`|`TINTA`|`MATRIZ_IMPRESSAO`),
`automatico Boolean`, `tipoCalculo` (`TIRAGEM`…), `aplicadoSobre` (`ACABADO`…), `quantidadeAceite`, `quantidadePorUnidade`,
`quantidadeMinima`, `porCaderno`, `custoInformado`, `calculoPorQtdCores`, `acompanhaMontImpressao`, `itemRevenda`,
`quebraPerc`, `textoProposta`, `sigla`, `pendenciaAutomaticaPcp`.
Os itens de origem `MAT.ACABAMENTO` (40) **não** entram aqui: vão para `MaterialAcabamento`. Tintas e matrizes
continuam nos seus cadastros atuais e entram nas relações por `codigoOrigem`.

**`CampoLivre`** / **`CampoLivreOpcao`**
`CampoLivre`: `proprietario` (`SOLICITACAO`|`PEDIDO`|`RECUSA`|`INSUMO`), `codigoOrigem`, `nome`, `tipo` (`TEXTO`|`LISTA`),
`obrigatorio`, `ordem`, `status`, `copiaParaPedidoCampoId?`. `CampoLivreOpcao`: `campoLivreId`, `valor`, `padrao`, `ordem`.
Só definições; sem tabela de valores nesta fase.

**`AjusteProdutividade`** (`ajuste_produtividade`) — só cadastro e visualização
`acabamentoId`, `centroProducaoId?`, `dadoAjustar` (`ACERTO`|`PRODUCAO_HORA`|`CONSUMO_MATERIAL`|`INCONDICIONAL`),
`funcao` (`RESTRICAO_MANUAL`|`ATIVIDADE`|`FORMATO_PROCESSO`), `operador`, `valor`, `fator Decimal`, `fatorPositivo`,
`impedeMontagemCadernos`, `restricaoId?`. As duas linhas `INCONDICIONAL` formam a visão **Restrições Automáticas**
(tipo de restrição: Incompatível, condição "Formato Processo menor que 390 x 500").

**`QuebraGrafica`** / **`QuebraGraficaLimite`**
Quebra: `codigoOrigem`, `nome`, `tipoAtividade` (`IMPRESSAO`|`ACABAMENTO`), `pedacosPorAcerto`, `pedacosPorPlano`,
`pedacosPorTipoPlano`, `pedacosOcorrencias`, `pedacosMinimoPerc`, `interpolar`, `status`. Limite: `quebraId`, `tiragemAte`,
`quebraPerc`.

**`LimiteMontagem`** (`limite_montagem`): `formatoFinalLargura`, `formatoFinalAltura`, `minimo`, `maximo`.

**Parâmetros gerais:** chaves em `Parametro` com prefixo `orc.` (ex.: `orc.refileFolhaInteira`, `orc.contraPinca`,
`orc.refileFinal`, `orc.corteDuplo`, `orc.partidaTintaGramas`, `orc.jurosAplicacaoMes`, `orc.jurosBancariosMes`,
`orc.prazoMedioProducaoDias`, `orc.diasRecusado`). Leitura por `lerParametrosOrcamento(empresaId)` com valores padrão
iguais ao legado. O motor atual continua com os valores que já usa; a troca para leitura da configuração é só na Fase 2.

### 4.2 Alterações aditivas em tabelas existentes
- `AcabamentoGrafico`: `codigoOrigem`, `acondicionamento Boolean`, `caracteristicas Json`, `textoProposta`, `exibirNomePlano`.
- `RestricaoAcabamento`: `codigoOrigem`, `exibirNaProposta`, `centroProducaoId?`.
- `MaterialAcabamento`: `codigoOrigem`, `tipoMaterial` (`ACONDICIONAMENTO`|`COLA`|`FITA`|`PROPORCIONAL_TIRAGEM`|`REVESTIMENTO_KG`|`OUTRO`),
  `unidadeCusto` (`KG`|`M2`|`UN`|`M`), `usoObrigatorio`, `medidaLinear`, `conteudoRoloMetros?`, `consumoMinimo?`, `textoProposta`.
- `ItemOrcamentoGrafico`: `produtoGraficoId?`. `PlanoCalculoGrafico`: `tipoPlanoId?`. Ambos opcionais e sem backfill nesta fase.
- `LinhaProduto`, `CoberturaTinta`, `ProcessoImpressao`, `CentroProducao`, `SuporteGrafico`: `codigoOrigem Int?` onde ainda não houver.

### 4.3 Seleção de material por atividade (preço)

**`SelecaoMaterialAcabamento`** (`selecao_material_acabamento`)
`itemId`, `planoId?`, `acabamentoId`, `materialId`, `restricaoId?`, `tipoParam` (0 a 4), `param1 Decimal?`, `param2 Decimal?`,
`consumo Decimal?`, `unidadeConsumo`, `valorUnitario Decimal?`, `custo Decimal?`, `aplicaNoPreco Boolean`,
`situacaoParametro` (`VALIDADO` | `A_VERIFICAR`), `criadoEm`. `@@index([empresaId, itemId])`.
É a fonte estruturada. Ao salvar, o serviço **reflete** a seleção no Json `materiaisAcabamento` do item (mesmo formato já
aceito: `materialAcabamentoId`, `nome`, `computarCusto`, `valorUnitario`, `quantidade`), que o motor atual já soma ao Material
Direto. Assim o caminho de preço não muda e os 14/14 testes de decomposição STC continuam válidos.

## 5. Preço do material (regra pura)

Arquivo novo `src/modules/orcamento-grafico/material-selecao.service.ts` (puro, sem Prisma). Entrada: tipo do parâmetro,
`param1`, `param2`, tiragem, área impressa m², peças por caixa e preço do material. Saída: consumo, unidade, custo e `situacao`.

| `tipoParam` | Fórmula | Aplica no preço? | Reuso |
|---|---|---|---|
| 0 | caixa: `ceil(tiragem / pecasPorCaixa)` × preço; kraft/embalar: por unidade de embalagem | Sim | `consumoCaixa` |
| 1 | `areaImpressaM2 × (param1 + param2)/100` (frente + verso) × preço por m² (BOPP) ou × gramatura do verniz (kg/m²) × preço por kg | Sim | `consumoVerniz` |
| 4 | `param1 × tiragem` × preço unitário (botão, ilhós, velcro) | Sim | novo, trivial |
| 3 | `tiragem × param1 (mm) × fator` × preço por kg (cola, fita, alça) | **Não (informativo)** | `consumoCola` (validado só para cola; fica **A_VERIFICAR**) |
| 2 | dimensões em mm (hot stamping, acetato) | **Não (informativo)** | — |

**Pontos a verificar o funcionamento exato (registrados, não bloqueiam):** `param2` quando `tipoParam = 3` (Fita Dupla Face
de 0 a 6, Colagem Manual de 0 a 100); fórmula dos tipos 2 e 3; unidade do preço (R$/kg x R$/m²) por material;
gramatura de cada verniz. O dado `situacaoParametro = A_VERIFICAR` aparece na tela como aviso discreto e **nunca** altera o total.

Regras de coerência (o que "tudo alinhado" significa):
1. O material só pode ser escolhido se existir relação `ATIVIDADE → MATERIAL`; o serviço valida e devolve 422 com a lista permitida.
2. Itens puxados do acervo (`calculoGraficoOrigemId` preenchido): a seleção é gravada, mas `aplicaNoPreco = false` e o total
   continua ancorado. Itens novos ou recalculados: `aplicaNoPreco = true` nos tipos 0, 1 e 4.
3. Preço do material = `MaterialAcabamento.valorReferencia` (já atualizável no cadastro). Se faltar preço, `custo = 0` e `situacao = A_VERIFICAR`.
4. Itens nos quais o usuário já informou `materiaisAcabamento` manualmente (Json) não são sobrescritos: a seleção nova só substitui as
   linhas que ela mesma criou (marcadas com `origem: 'SELECAO'` dentro do Json).
5. Nos itens novos, o custo do plano é a soma dos materiais e atividades do plano; o total do item é a soma dos planos.
   Nos itens puxados, o custo dos planos continua 0.

## 6. Serviços e API

### 6.1 Módulos novos (back, em `src/modules/orcamento-grafico/cadastros-graficos/`)
`produto-grafico.routes.ts`, `tipo-plano-grafico.routes.ts`, `relacao-cadastro.routes.ts`, `item-diverso.routes.ts`,
`campo-livre.routes.ts`, `ajuste-produtividade.routes.ts`, `quebra-grafica.routes.ts`, `limite-montagem.routes.ts`,
`parametros-orcamento.routes.ts`, `catalogo.routes.ts` (leitura para o orçamento), e os serviços puros:
`relacoes-permitidas.ts`, `catalogo.service.ts`, `material-selecao.service.ts`. Registro em `server.ts` sob `/api/orcamento-grafico/cadastros/*`.
Autorização: `authenticate` + mesmo guarda dos cadastros atuais de orçamento gráfico (permissão de cadastro). Leitura do catálogo: qualquer
usuário com acesso ao orçamento. Validação com Zod; erros 400 legíveis (`formatarErroZod`).

### 6.2 Relações
- `GET /relacoes?origem=PRODUTO:{id}` e `?destino=...` lista; `PUT /relacoes` recebe `{ tipoOrigem, idOrigem, tipoDestino, ids[] }` e
  **substitui o conjunto** (transação). `relacoes-permitidas.ts` rejeita par não listado (400) e confere que cada id existe **na mesma
  empresa** (422 com ids inválidos). Operação idempotente.
- `GET /catalogo/produto/:id` → tipos de plano, atividades de produto, acondicionamento, itens diversos e defaults.
  `GET /catalogo/plano/:id?produtoId=` → atividades (com restrições e materiais), coberturas, suportes e itens diversos automáticos.
  Ordem: `Roteiros` (campo `ordem`) quando existir; senão alfabética. Esta é a API que a Fase 2 consome.

### 6.3 Demais rotas
CRUD padrão (`GET` lista com filtro e paginação, `GET /:id`, `POST`, `PATCH /:id`, `DELETE` lógico por `status`) para Produto, Tipo de
Plano, Item Diverso, Campo Livre (+ opções), Ajuste de Produtividade, Quebra (+ limites) e Limite de Montagem.
`PUT /selecao-material` (`itemId`, `planoId?`, lista de seleções) e `GET /selecao-material?itemId=`.
`GET/PUT /parametros-orcamento`.
Ajuste de Produtividade, Quebra e Limite: **somente leitura de uso**; nenhuma rota do motor ou do PCP os consulta.

## 7. Importação

Script `scripts/importar-cadastros-orcamento.ts` (versionado, não `_tmp-`). Exportador `scripts/exportar-cadastros-orcamento.mjs`
(somente leitura, `sqlcmd -u` UTF-16 para UTF-8) grava `cartoon/export/CadastrosOrcamento.json` (ignorado pelo git).

Opções: `--empresa <id>` (obrigatória), `--dry-run`, `--arquivo`, `--fase <nome>`. **Idempotente** por `(empresaId, codigoOrigem)`;
nunca apaga; só preenche campo vazio de registro existente; relatório final com criados, atualizados, ignorados e **não casados**.

Ordem das fases e fonte:

| Fase | Fonte | Destino | Observação |
|---|---|---|---|
| `catalogos` | `Unidades`, `Fechamento`, `TributacaoVenda`, `CoberturasTinta` | catálogos do produto, `CoberturaTinta` | casar por nome |
| `produtos` | `Produtos` (12) | `ProdutoGrafico` | ignora o produto 10 (TESTE, cancelado) |
| `planos` | `Planos` (14), `_CaracteristicasPlano` | `TipoPlanoGrafico` | junta os campos de `_CaracteristicasPlano` |
| `atividades` | `Atividades` (68), `RestricoesManuais` (59) | `AcabamentoGrafico`, `RestricaoAcabamento` | casar atividade existente por nome normalizado, depois criar |
| `materiais` | `ItensDiversos` origem `MAT.ACABAMENTO` (40) + `Itc` | `MaterialAcabamento` | preço de `TabelasCustoDetalhe` tabela vigente, coluna 1 |
| `itens-diversos` | `ItensDiversos` demais origens (22) | `ItemDiversoGrafico` | |
| `relacoes` | `RelTabelas` (tabelas 0, 1, 2, 3, 4, 5, 6, 8, 10, 11, 12, 13) | `RelacaoCadastroGrafico` | **tradução código a código**; ignora tabela 9 |
| `roteiros` | `Roteiros` (422) | `ordem` das relações PLANO→ATIVIDADE e PRODUTO→ATIVIDADE | lista divergências com a `RelTabelas` |
| `defaults` | `ProdutosxPlanos`, `ProdutosxAtividades` | `DefaultProdutoPlano` | |
| `campos-livres` | `ParamCl`, `ParamClLista`, `ParamClRelacionamentos` | `CampoLivre`, `CampoLivreOpcao` | **sem** `ConteudoCl` |
| `ajustes` | `AjustesProdutividade` (59) | `AjusteProdutividade` | |
| `quebras` | `Quebras`, `QuebrasxLimites`, `LimiteMontagem` | `QuebraGrafica`, `LimiteMontagem` | |
| `parametros` | `Parametros` (tipos CÁLCULO, FECHAMENTO, CALCULO) | `Parametro` com prefixo `orc.` | só a lista fechada de chaves |

Mapa de tradução de códigos de tabela: `0 Suportes, 1 Itens Diversos, 2 Planos, 3 Coberturas de Tinta, 4 Atividades, 5 Linhas,
6 Acondicionamento por produto, 8 Centros de Produção, 10 Produtos, 11 Tintas, 12 Matrizes, 13 Materiais de Acabamento`.
Tabelas 1 e 3 já têm destino; a **9 é descartada**. Código sem equivalente no Vizor entra no relatório "não casados" (nunca é inventado).

Execução em produção (Neon, `DATABASE_URL_PROD` por variável de ambiente, nunca em arquivo): só depois de dry-run revisado e autorização
explícita. Rodar duas vezes para provar idempotência.

## 8. Telas (front, `src/app/(interna)/orcamento-grafico/cadastros/`)

Padrão do projeto: Next 15, Mantine 7, `react-query`, grade padronizada. Itens novos no menu Orçamento Gráfico → Cadastros.
Não aparece a palavra do sistema legado em nenhum texto.

| Rota | Conteúdo |
|---|---|
| `/cadastros/produtos` | lista e formulário (abas: Dados, Tributação, Defaults por plano, Relações) |
| `/cadastros/tipos-plano` | lista e formulário dos parâmetros do plano |
| `/cadastros/relacoes` | **matriz de marcação**: escolhe o par (ex.: Plano → Atividade), o item de origem e marca os destinos; salvar substitui o conjunto |
| `/cadastros/itens-diversos` | lista e formulário, com vínculo de atividades |
| `/cadastros/campos-livres` | campos por proprietário e suas opções |
| `/cadastros/ajustes-produtividade` | grade com filtros (atividade, centro, dado, função) e aba "Restrições Automáticas"; **somente cadastro e visualização** |
| `/cadastros/quebras` | quebras e tabela de limites |
| `/cadastros/limites-montagem` | grade simples |
| `/cadastros/parametros` | parâmetros gerais do orçamento |

Ajustes na tela já existente de Acabamentos (`/cadastros/acabamentos`): abas **Restrições** e **Materiais** (usa a relação
ATIVIDADE→MATERIAL e mostra o tipo de parâmetro de cada material) e indicação "Acondicionamento".
Na tela de Materiais de Acabamento: tipo, unidade, medida linear, rolo e consumo mínimo.
Todas as telas: `empresaId` vem da sessão, mensagens de erro legíveis, estados de carregamento e vazio, e tema claro e escuro (tokens
`*-light`, nunca cores fixas de fundo).

## 9. Como a Fase 2 consome

A tela mestre-detalhe chama `GET /catalogo/produto/:id` ao escolher o produto e `GET /catalogo/plano/:id?produtoId=` ao escolher o tipo de
plano. Marcar uma atividade abre as restrições e os materiais já embutidos na resposta. Salvar a seleção usa `PUT /selecao-material`.
Os campos ricos do plano e a leitura dos parâmetros gerais pelo motor também entram na Fase 2. Plano fixo (Cartucho, Lâmina Simples,
Sacola) abre sem grade, usando o plano fixo do catálogo.

## 10. Testes

- **Puros (Vitest + fast-check):** `material-selecao.service` (tipos 0, 1, 4 e neutralidade dos tipos 2 e 3); `relacoes-permitidas`
  (par inválido); tradução de códigos do importador; ordenação por `Roteiros`.
- **Propriedades:** o total de um item puxado do acervo **não muda** ao gravar seleção de material; a seleção é idempotente
  (gravar duas vezes dá o mesmo resultado); `PUT /relacoes` com o mesmo conjunto não altera nada.
- **Rotas (com mocks de Prisma):** isolamento por `empresaId` (ids de outra empresa dão 422), pares fora da lista dão 400,
  CRUD e filtros.
- **Importador:** `--dry-run` não grava; duas execuções seguidas dão zero criados na segunda; relatório lista "não casados".
- **Regressão:** suíte do módulo `orcamento-grafico` inteira (hoje 242 testes) e os 14/14 de `decomposicao-stc.service.test.ts` continuam verdes.
- `get_diagnostics` nos arquivos tocados. Não rodar `tsc` inteiro nem `next build`.

## 11. Migração de schema

`schema.prisma` e `prisma/migrate-prod.ts` no **mesmo commit**: `CREATE TABLE IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`,
`CREATE [UNIQUE] INDEX IF NOT EXISTS`, índice único parcial `WHERE codigo_origem IS NOT NULL`, FK em `try/catch`. Rodar
`npx tsx prisma/migrate-prod.ts` duas vezes no banco local e `npx prisma generate`. Nenhuma coluna é removida ou tem tipo alterado.

## 12. Riscos e pontos em aberto

| Item | Tratamento |
|---|---|
| `param2` com `tipoParam = 3` e fórmula dos tipos 2 e 3 | **Ponto a verificar o funcionamento exato.** Gravados e exibidos; não afetam o preço |
| Tabelas 1, 3 e 9 da `RelTabelas` | 1 e 3 identificadas e tratadas; 9 descartada |
| Relação sem chave estrangeira | Integridade pelo serviço; rotina `GET /relacoes/verificar` lista órfãos |
| Material com preço ausente ou unidade incerta | `custo = 0` e `situacao = A_VERIFICAR`, sem erro |
| Mudança de preço de material alterar itens antigos | Seleção grava `valorUnitario` no momento; itens puxados continuam ancorados |
| Duplicidade de cadastros existentes (atividades, materiais, suportes) | Casamento por nome normalizado; ambíguo vira "não casado", nunca mescla |
| Linhas Editorial e Rótulo | Fora de escopo; entram só se o usuário passar as telas |
| Influência no PCP de Ajustes e Quebras | Spec futura; hoje só cadastro e visualização |
