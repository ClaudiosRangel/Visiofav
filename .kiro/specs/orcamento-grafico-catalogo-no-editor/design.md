# Design — Orçamento Gráfico: Catálogo no Editor do Item (Fase 2)

Status: **aprovado pelo usuário (15/11/2026)**, com as recomendações da seção 10: decisões 1 (adiar campos livres),
2 (passes automáticos), 3 (criar coluna `tipoParam`, com dry-run antes de produção), 4 (tipo de plano obrigatório),
5 (produto em item puxado), 6 (não nesta fase) e 7 (perguntar ao cancelar). Fluxo requirements → design → tasks.
Base: `docs/orcamento-planos-calcgraf-HANDOFF.md` (seções 12 a 18), spec da Fase 1
`orcamento-grafico-cadastros-relacoes` (entregue) e leitura do código atual do editor (seção 2).

## 1. Objetivo e escopo

Ligar o editor do item (`EditorItem`) ao catálogo da Fase 1 para que:

1. o orçamentista escolha o **Produto Gráfico** (filtrado pela Linha de Produto do orçamento);
2. os **planos** nasçam de um tipo de plano permitido, com os defaults do produto aplicados só em campo vazio;
3. os **acabamentos** mostrem só as atividades do produto e do plano, na ordem do roteiro, com acondicionamento
   separado, restrições, **materiais permitidos** (seleção por `PUT/DELETE /selecao-material`) e aviso A_VERIFICAR;
4. os **itens diversos automáticos** do plano sejam sugeridos;
5. fique decidido onde entram os **campos livres** (ARTE, PADRÃO) — seção 9.

Princípio: **o front faz quase tudo.** O back ganha três ajustes pequenos (seção 4). O motor, a
`ancorarCustoCalcgraf` e os testes de decomposição não são tocados.

Fora de escopo: Ajustes de Produtividade, Quebras e Limites de Montagem no motor ou no PCP; valores de campos
livres; wizard antigo (`ItemWizardModal`, `/novo`); linhas Editorial e Rótulo.

## 2. Estado atual (levantado no código)

### 2.1 Front (`VisioFab.Wms.Front/src/app/(interna)/orcamento-grafico/`)

| Arquivo | O que faz hoje | Impacto da fase |
|---|---|---|
| `[id]/EditorItem.tsx` | Página única com seções ancoradas. Estado em `WizardFormData` (de `novo/page.tsx`). Salva por `salvarItem` (POST/PUT). Carrega Linha de Produto, ficha master e KPIs ao vivo | Carrega o catálogo, guarda `produtoGraficoId`, orquestra o passe de seleções ao salvar |
| `[id]/editor/SecaoProduto.tsx` | Resumo + `StepTipo` + `StepMedidas` + `StepPapel`. Não pergunta Produto Gráfico | Ganha `SeletorProdutoGrafico` no topo |
| `[id]/editor/SecaoPlanos.tsx` | **Somente leitura** (tabela Nome, Suporte, Cores, Formato, Acabamento) | Ganha coluna "Tipo de plano" quando houver |
| `[id]/PlanosDoItem.tsx` | **Editor real dos planos** (modal novo/editar, POST/PUT/DELETE de planos, troca de suporte). Usado na página `[id]/page.tsx`, fora do `EditorItem` | Ganha seletor de tipo de plano, defaults e atividades do catálogo |
| `[id]/editor/SecaoAcabamentos.tsx` e `SecaoMateriaisAcabamento.tsx` | Envolvem `novo/StepAcabamentos.tsx` (`mostrar="acabamentos"` e `"materiais"`) | `StepAcabamentos` ganha prop opcional `catalogo`; o wizard `/novo` continua sem ela |
| `novo/StepAcabamentos.tsx` | Lista geral de 100 acabamentos (`GET /acabamentos`, limite 100), busca, filtro por natureza, restrições, materiais manuais (`materiaisAcabamento`) | Filtra e ordena pelo catálogo quando há produto; material por atividade |
| `[id]/editor/SecaoItensComplementares.tsx` | Envolve `StepItensDiversos` (itens diversos, fornecidos, campos livres) | Ganha bloco "Sugeridos pelo plano" |
| `[id]/itemFormShared.ts` | `INITIAL_ITEM`, `itemParaForm`, `montarPayloadItem`, `montarPayloadCalculo`, `salvarItem` | Campos novos; preservar `origem` e `selecaoId`; `salvarItem` passa a devolver o item |
| `[id]/editor/campos-por-linha.ts` | Campos condicionais por código da linha | Sem mudança |
| `[id]/editor/useCalculoAoVivo.ts` | KPIs com debounce; usa `montarPayloadCalculo` | Envia `materiaisAcabamento` só quando há produto |
| `[id]/page.tsx` | `abrirEditorPagina` monta o item com **subconjunto** de campos; usa `PlanosDoItem` | Passar `produtoGraficoId`, `materiaisAcabamento` e `planos[].tipoPlanoId` |
| `NovoOrcamentoModal.tsx` | Cabeçalho (cliente, vendedor, linha). Linha de produto já vem aqui | Sem mudança: o produto é escolhido no editor |
| `cadastros/_shared/cadastros-graficos.api.ts` | `produtosApi`, `catalogoApi`, `selecaoMaterialApi`, `camposLivresApi`… | Reaproveitar; acrescentar `selecaoMaterialApi.remover` |

### 2.2 Back (`VisioFab.Wms.Back/src/modules/orcamento-grafico/`)

| Ponto | Situação verificada |
|---|---|
| `ItemOrcamentoGrafico.produtoGraficoId` e `PlanoCalculoGrafico.tipoPlanoId` | **Existem no schema** (String? sem `@relation`, sem backfill) |
| `itemOrcamentoBodySchema` e `planoBodySchema` (`orcamento-grafico.routes.ts`) | **Não aceitam** os dois campos (Zod descarta). Nenhuma rota os grava ou devolve. **Vira tarefa de back pequena** |
| `dadosPersistenciaItem` e `dadosPersistenciaPlano` | Não gravam os campos. Precisam de gravação condicional (ausente = não altera) |
| `GET /orcamento-grafico/:id` | O select de itens (`~L3404`) já devolve `planos`; falta `produtoGraficoId` no item e `tipoPlanoId` no plano |
| `catalogo.routes.ts` / `catalogo.service.ts` | Prontos. Produto devolve `planos`, `atividades`, `acondicionamento`, `itensDiversos`, `defaults`. Plano devolve `atividades` (com `preMarcada`, `restricoes`, `materiais`), `coberturas`, `suportes`, `itensDiversosAutomaticos` |
| `selecao-material.routes.ts` | `PUT` e `GET` prontos. **Não há `DELETE`**. O `PUT` grava o Json `materiaisAcabamento` direto no item e **não recalcula** o `resultadoCalculo` |
| `MaterialAcabamento` | Tem `tipoMaterial`, `unidadeCusto`, `medidaLinear`. **Não tem `tipoParam`**. Pelo importador, `tipoMaterial` vem do tipo do cadastro legado e BOPP/plástico caem em `OUTRO` |
| Zod de `materiaisAcabamento` | Já aceita `origem` e `selecaoId` |
| Seleção e item puxado | `aplicaNoPreco = false` quando há `calculoGraficoOrigemId` (custo ancorado intacto) |

### 2.3 Armadilhas encontradas

1. `itemParaForm` e `montarPayloadItem` **descartam `origem` e `selecaoId`** e o payload só envia linhas com
   `computarCusto = true`. Salvar o item apagaria as linhas informativas de seleção (item puxado) do Json.
2. `montarPayloadCalculo` **não envia `materiaisAcabamento`**: os KPIs ao vivo ignoram materiais (manuais e de seleção).
3. `abrirEditorPagina` não passa `materiaisAcabamento`, `produtoGraficoId` nem `tipoPlanoId` ao editor.
4. O `PUT /selecao-material` exige que o item exista: item novo não consegue gravar seleção antes do primeiro salvar.
5. O plano fixo não tem linha de plano: para listar suas atividades é preciso descobrir o tipo de plano fixo pelo catálogo do produto.

## 3. Arquitetura

```
EditorItem
 ├─ useCatalogoItem(produtoGraficoId)  ── GET /catalogo/produto/:id  (1x) + GET /catalogo/plano/:id?produtoId= (sob demanda, cache)
 │        └─ { produto, planos, atividadesProduto, acondicionamento, defaults, planoFixo, porTipoPlano[...] }  | null (sem produto)
 ├─ SecaoProduto ─ SeletorProdutoGrafico ──► formData.produtoGraficoId  (+ defaults só em vazio)
 ├─ SecaoPlanos (leitura) ── coluna Tipo de plano
 ├─ SecaoAcabamentos ─ StepAcabamentos(catalogo) ─ lista filtrada/ordenada ─ SeletorMaterialAtividade ─ PUT/DELETE selecao-material
 ├─ SecaoMateriaisAcabamento ─ StepAcabamentos(mostrar="materiais") (manuais + linhas SELECAO somente leitura)
 ├─ SecaoItensComplementares ─ SugestaoItensDiversos (bloco novo)
 └─ salvar():  salvarItem → passe de seleções pendentes → regravar item (recálculo)

PlanosDoItem (fora do EditorItem, na página)
 └─ modal do plano: Select "Tipo de plano" (catálogo do produto) → defaults em vazio → atividades do catálogo do tipo → POST/PUT plano com tipoPlanoId
```

Camada pura (sem React, sem rede), testável com Vitest:
`src/app/(interna)/orcamento-grafico/[id]/editor/catalogo/catalogo-puro.ts`

| Função | Responsabilidade |
|---|---|
| `aplicarDefaultsEmVazios(form, default, tipoPlano)` | Preenche só campos vazios (processo, cobertura, fabricante; no plano: nome, cores, suporte, gramatura). Idempotente. Nunca toca `cores` do item |
| `planoFixoDoCatalogo(catalogoProduto)` | Id do tipo de plano fixo (`fixo = true`) ou do único tipo permitido; `null` quando há vários não fixos |
| `filtrarOrdenarAtividades(cadastro, catalogo)` | Casa o cadastro de acabamentos com as atividades do catálogo por `id`; devolve `{ planoProduto[], acondicionamento[], foraDoCatalogo[] }` na ordem do catálogo |
| `preMarcarAtividades(acabamentosRicos, preMarcadas, cadastro)` | Devolve as atividades a marcar, só se não há marcação prévia |
| `tipoParamDoMaterial(material)` | `material.tipoParam` quando existir; senão mapa provisório (seção 6.3) |
| `mesclarLinhasSelecao(existentes, selecoes)` | Reconstrói `materiaisAcabamento`: mantém linhas manuais, substitui as `origem: 'SELECAO'` (espelha `refletirSelecoesNoJson` do back) |
| `sugerirItensDiversos(automaticos, itensAtuais)` | Itens diversos sugeridos, sem duplicar por descrição normalizada |
| `deveAplicarDefaults(item)` | `false` para item puxado ou salvo com produto |

Hook: `useCatalogoItem.ts` (react-query ou estado local com `useRef` para cache), `SeletorProdutoGrafico.tsx`,
`SeletorMaterialAtividade.tsx`, `SugestaoItensDiversos.tsx`, `AvisoAVerificar.tsx` na mesma pasta `editor/catalogo/`.
Os testes ficam ao lado (`*.test.ts`), seguindo `ancoras.test.ts`.

## 4. Back mínimo

Todas as mudanças são aditivas, com `empresaId` explícito. Sem mudança de schema (exceto a decisão 3).

### 4.1 Aceitar e devolver `produtoGraficoId` e `tipoPlanoId` (Requisito 2)

- `itemOrcamentoBodySchema`: `produtoGraficoId: z.string().uuid().optional().nullable()`.
- `planoBodySchema`: `tipoPlanoId: z.string().uuid().optional().nullable()`.
- `dadosPersistenciaItem` e `dadosPersistenciaPlano`: gravação **condicional** —
  `...(body.produtoGraficoId !== undefined ? { produtoGraficoId: body.produtoGraficoId } : {})`. Ausente não altera;
  `null` limpa. Isso preserva as rotas que reutilizam o helper (`PUT`, `reaproveitar`, `de-calculo`).
- Validação nas rotas `POST/PUT /:id/itens` e `POST/PUT .../planos`: se o id vier preenchido, conferir
  `produtoGraficoId`/`tipoPlanoId` em `ProdutoGrafico`/`TipoPlanoGrafico` com `{ id, empresaId }`; inexistente → 422
  "Produto gráfico não encontrado nesta empresa." (mesmo padrão de mensagem legível).
- `GET /:id`: acrescentar `produtoGraficoId: true` ao select do item e `tipoPlanoId: true` ao select do plano.
- Teste de rota com Prisma mockado: aceita, devolve, 422 de outra empresa, ausente não altera, `null` limpa.
- **Não toca** `ancorarCustoCalcgraf`, `calcularItem`, `calcularPlano`, `decomposicao-stc` nem `preservarEngenhariaDoItem`.

### 4.2 `DELETE /cadastros/selecao-material` (Requisito 12)

Query `itemId`, `acabamentoId`, `planoId?`. Em uma transação: apaga a seleção do par, lê as restantes do item, reflete com
`refletirSelecoesNoJson` e atualiza `materiaisAcabamento` do item com `updateMany({ id, empresaId })`; devolve
`{ removidas, resumoCustos }` (mesma função `somarCustoPlanos` do `PUT`). Idempotente. 404 se o item não for da empresa.
Não recalcula `resultadoCalculo` (o passe de recálculo do front faz).

### 4.3 Coluna opcional `tipoParam` em `MaterialAcabamento` (Requisito 7.9 — **decisão 3**)

Coluna aditiva `tipo_param Int?` (schema + `migrate-prod.ts` idempotente, no mesmo commit). Exportador e importador da
Fase 1 ganham a fase `materiais-tipo-param`: moda de `CalculoMatAcabamento.TipoParamAcab` por `CodMaterial`
(37.047 linhas reais), só preenche campo vazio, com `--dry-run` e relatório. Sem a coluna, vale o mapa provisório do front.
O catálogo já devolve o material inteiro (`...m`), então o campo chega ao front sem mudar a rota.

## 5. Front — fluxos

### 5.1 Produto Gráfico (Requisitos 1, 3)

- `SeletorProdutoGrafico` usa `produtosApi.listar({ situacao: 'ativa', linhaProdutoId })`. Sem linha no orçamento, sem filtro.
- Estado novo em `WizardFormData`: `produtoGraficoId?: string | null`, `_produtoGraficoNome?: string | null`
  (exibição de produto inativo), `_selecoesPendentes?: SelecaoPendente[]`, `_catalogoAplicadoEm?: string | null`.
  `INITIAL_ITEM` deixa `produtoGraficoId` **indefinido** (indefinido = não enviar; `null` = limpar).
- `itemParaForm` hidrata `produtoGraficoId ?? undefined`; `montarPayloadItem` inclui o campo só quando definido.
  Assim o wizard antigo, que não conhece o campo, nunca limpa o produto de um item.
- `useCatalogoItem(produtoGraficoId)` chama `catalogoApi.produto(id)` uma vez, identifica o plano fixo com
  `planoFixoDoCatalogo` e chama `catalogoApi.plano(fixoId, produtoId)`. Tipos não fixos: `catalogoApi.plano` sob demanda com cache
  por `tipoPlanoId`. Erro → `{ erro }` e as seções caem no modo lista geral (Requisito 3.5).
- Trocar a Linha de Produto não limpa o produto; mostra aviso se `produto.linhaProdutoId` difere (Requisito 1.6).
- O Tipo de Embalagem continua escolhido pelo usuário (sem vínculo no cadastro; ponto a verificar).

### 5.2 Defaults só em campo vazio (Requisito 5)

Aplicados **uma vez**, no momento da escolha do produto em item novo (ou do tipo de plano no modal), por
`aplicarDefaultsEmVazios`. Mapeamento item (plano fixo):

| Default do produto×plano | Campo do item | Regra |
|---|---|---|
| `processoImpressaoId` | `processoImpressao` (texto) | nome do processo, se vazio |
| `coberturaTintaId` | `coberturaTintaTexto` | nome da cobertura, se vazio |
| `fabricanteSuporte` | `fabricante` | se vazio |
| `coresFrente`/`coresVerso`/`areaTintaPerc` | — | só exibidos como referência ("padrão do produto: 4x0, 100%") |
| `atividadesPreMarcadas` | `acabamentosRicos` | pré-marca só se a lista estiver vazia (item novo) |
| `semImpressao` | — | exibido; não altera `cores` |

Mapeamento plano (modal): `nome ← tipo.nome`, `numCores ← coresFrente + coresVerso` do default, `suporteId ← tipo.suportePadraoId`,
`gramatura ← tipo.gramaturaPadrao`; "vazio" no modal significa campo **não tocado** (`FORM_VAZIO` traz `numCores: 4`, então o
modal passa a guardar um conjunto `camposTocados` para não confundir padrão do formulário com escolha do usuário).
Item puxado e item salvo com produto: `deveAplicarDefaults` devolve `false`.

### 5.3 Planos com tipo de plano (Requisito 4)

`PlanosDoItem` recebe a prop opcional `produtoGraficoId`. Com ela, o modal exibe `Select` "Tipo de plano"
(`catalogo.planos` sem os fixos, na ordem) e envia `tipoPlanoId`. Sem a prop, o modal fica idêntico ao atual. O Select de
suporte pode ser restrito aos `suportes` do catálogo do tipo quando existirem (confirmar ids; ponto a verificar).
As atividades do tipo (catálogo do plano) aparecem no mesmo modal e vão em `acabamentosRicos` do plano (o `planoBodySchema` já aceita).
`SecaoPlanos` ganha a coluna "Tipo de plano" por `tipoPlanoId` + nome resolvido pelo catálogo.

### 5.4 Acabamentos do catálogo (Requisito 6)

`StepAcabamentos` recebe `catalogo?: CatalogoDoItem | null`. Com catálogo:
- a lista base passa de `cadastro` (100) para `filtrarOrdenarAtividades(cadastro, catalogo)`; três grupos: **Atividades**,
  **Acondicionamento** e **Fora do catálogo do produto** (só aparece se há marcada fora do catálogo);
- o filtro por natureza e a busca de texto continuam sobre o grupo exibido; selecionados primeiro dentro de cada grupo
  (como hoje) **sem quebrar a ordem do roteiro** entre os não selecionados;
- restrições vêm do catálogo; a regra "restrição obrigatória" (`exigeRestricao`) continua igual;
- custos, tempos, produção e acertos continuam do cadastro e editáveis (`toggle` e `patch` não mudam).
Sem catálogo: nenhum código novo roda, a lista é a atual (Requisito 11.1). O `StepAcabamentos` usado pelo wizard `/novo` não recebe a prop.

### 5.5 Material por atividade (Requisito 7)

`SeletorMaterialAtividade` aparece dentro da engrenagem (extras) da atividade marcada, ao lado da restrição:
Select de materiais permitidos (`atividade.materiais`, padrão pré-selecionado ao marcar), campos de parâmetro por `tipoParam`
(TipoParam 1: % frente e verso; 4: peças; 0: nenhum; 2 e 3: parâmetro livre, informativo), e linha de resumo com consumo,
unidade, custo e o selo `AvisoAVerificar` quando `situacaoParametro = A_VERIFICAR`.
Item puxado: selo "informativo, não altera o preço".

Gravação:
- **Item salvo (tem `id`)**: `selecaoMaterialApi.salvar` na hora; a resposta vira a linha `origem: 'SELECAO'` em
  `materiaisAcabamento` (via `mesclarLinhasSelecao`); desmarcar a atividade ou limpar o material chama o `DELETE`.
- **Item novo (sem `id`)**: a escolha vai para `_selecoesPendentes` (sem custo até o primeiro salvamento) e é aplicada no passe.

### 5.6 Salvar: passes (Requisito 8)

```
salvar()
 1. salvarItem(...)          → POST/PUT; devolve o item (id)           [rota atual, sem mudança de contrato]
 2. se há pendentes/remoções → para cada uma: PUT/DELETE selecao-material (usa o id do passo 1)
                              → mesclarLinhasSelecao(formData.materiaisAcabamento, respostas)
 3. se o passo 2 mudou algo  → salvarItem(...) de novo (PUT)          → recálculo com as linhas SELECAO no payload
 4. onSaved()
```
- O passo 3 usa a rota existente de edição; o motor e a ancoragem não mudam. Para item puxado, a ancoragem segue valendo e as
  linhas chegam com `computarCusto = false`.
- Falha no passo 2: o item já está salvo; o editor avisa "Item salvo, mas N escolhas de material não foram aplicadas" e mantém as
  pendentes visíveis para nova tentativa. Operação idempotente (`PUT` repetido dá o mesmo resultado).
- `montarPayloadItem`: envia `materiaisAcabamento` = linhas manuais com `computarCusto` **mais todas as linhas `SELECAO`**
  (inclusive `computarCusto = false`), preservando `origem` e `selecaoId`. Sem linhas `SELECAO` e sem produto o payload é idêntico ao atual.
- Cancelar com escolhas já gravadas e não aplicadas ao preço: o editor pergunta "Salvar o item para aplicar as escolhas ao preço?";
  sair sem salvar deixa as seleções gravadas e o preço atualiza no próximo salvamento (risco registrado na seção 11).

### 5.7 Itens diversos automáticos (Requisito 9)

`SugestaoItensDiversos` (dentro de `SecaoItensComplementares`, acima da lista atual) mostra `itensDiversosAutomaticos` do plano fixo e dos
tipos dos planos do item. Cada linha: nome, "Adicionar"; mais "Adicionar todos". Conversão para o formato atual:
`{ descricao: nome, quantidade: quantidadePorUnidade || 1, valor: custoInformado ?? 0, fixo: tipoCalculo !== 'TIRAGEM' }` (o
payload já normaliza `valor` mínimo 0,01; linha sem custo cadastrado vem com marca "informe o valor"). Dedupe por descrição normalizada.
Nada é adicionado sozinho.

## 6. Detalhes de regra

### 6.1 Atividade do catálogo × `AcabamentoGrafico`

O `id` de `atividades[]` do catálogo é o id de `AcabamentoGrafico`, o mesmo `acabamentoId` de `acabamentosRicos`. O casamento
é por `id`, sem nome. Atividades do catálogo ausentes da lista de 100 do cadastro são ignoradas com aviso no console de desenvolvimento
e contadas em "não exibidas" (ponto a verificar: limite de 100).

### 6.2 Plano fixo

`planoFixoDoCatalogo`: (1) tipo com `fixo = true`; (2) senão o único tipo do produto; (3) senão `null` (produto com vários tipos
não fixos, como Cartucho Composto: as atividades de plano aparecem no modal do plano, e a seção Acabamentos do item mostra só as
atividades de **produto** e o acondicionamento).

### 6.3 `tipoParam` do material

Ordem: (1) `material.tipoParam` (decisão 3); (2) mapa provisório por `tipoMaterial` e `unidadeCusto`:

| tipoMaterial / unidade | tipoParam provisório | Efeito no preço (back) |
|---|---|---|
| ACONDICIONAMENTO | 0 | calcula (caixa) |
| REVESTIMENTO_KG | 1 | calcula (verniz) |
| OUTRO com unidade M2 | 1 | calcula (BOPP, plástico) |
| PROPORCIONAL_TIRAGEM | 4 | calcula (peças por unidade) |
| COLA, FITA | 3 | informativo (A_VERIFICAR) |
| demais | 2 | informativo (A_VERIFICAR) |

O mapa é **provisório e conservador**: o que não for claro cai em informativo (custo zero). Conferir contra cálculos reais antes de confiar
no preço (ponto a verificar). Se a decisão 3 for aprovada, o mapa vira só reserva.

### 6.4 Isolamento e tema

Back: `empresaId` explícito em toda query nova. Front: nenhuma chamada envia `empresaId`. Componentes usam
`var(--mantine-color-default)`, `body`, `dimmed`, `*-light`; sem menção ao sistema legado em textos.

## 7. Não-regressão (resumo)

| Situação | Garantia |
|---|---|
| Item sem `produtoGraficoId` | `useCatalogoItem` devolve `null`; componentes seguem o ramo atual; payloads idênticos |
| Item puxado | Sem defaults, sem pré-marcação; seleção informativa; `ancorarCustoCalcgraf` intacta |
| Wizard `/novo` e `ItemWizardModal` | Não recebem props novas; `montarPayloadItem` só inclui campos novos quando definidos |
| `PlanosDoItem` sem `produtoGraficoId` | Modal idêntico |
| Back | Campos novos opcionais; gravação condicional; testes de decomposição verdes |

## 8. Telas e textos

Seletor "Produto Gráfico" (placeholder "Selecione o produto (opcional)"), grupo "Acondicionamento", grupo "Fora do catálogo do produto",
select "Material", aviso `AvisoAVerificar` (ícone de informação pequeno, tooltip "Parâmetro a verificar; não altera o preço"), selo
"Informativo, não altera o preço" no item puxado, bloco "Sugeridos pelo plano". Estados de carregamento (`Loader`/`Skeleton`), vazio
("Nenhuma atividade cadastrada para este produto") e erro (aviso com "Usar lista geral").

## 9. Campos livres da solicitação (ARTE, PADRÃO) — decisão: **ficam para a Fase 3**

**O que existe hoje.** A Fase 1 guarda só as **definições** (`CampoLivre`, `CampoLivreOpcao`): ARTE (Alteração, Novo, Repetição) e
PADRÃO (Amostra, Contratual, Pasta Padrão) como obrigatórios na Solicitação; equivalentes no Pedido, não obrigatórios, copiados da
Solicitação. Não há tabela de valores, e os valores históricos não foram importados (decisão da Fase 1).

**Onde ficam os valores no Vizor.** A Solicitação é `SolicitacaoOrcamentoRep` (Portal do Representante) e o pedido do módulo comercial é
`PedidoProposta`. Os dois são do fluxo comercial, com telas, estados (RFQ) e conversões próprias, **fora do editor do item**. Eles já têm
campos próximos, mas não iguais: `tipoPedido` (REPETICAO, MOSTRUARIO, NOVO) e `variacoesArte` (texto de até 60 caracteres). O item do
orçamento tem `arte` (texto, até 60) em Dados Técnicos e um Json `camposLivres` (rótulo e conteúdo) por item.

**Decisão e justificativa.**
1. Os valores de ARTE e PADRÃO pertencem à **Solicitação e ao Pedido**, não ao item. Gravá-los no item criaria uma segunda fonte de dado.
2. Entregá-los exige tabela nova de valores, telas no Portal do Representante e no Pedido-Proposta, regra de obrigatoriedade na criação da
   solicitação e **cópia Solicitação → Pedido** na conversão. É trabalho do módulo comercial, com testes e risco próprios, e não influencia o preço.
3. Esta fase é do editor do item e deve ficar pequena e segura. Misturar a mudança do fluxo comercial aumentaria o risco de regressão.
4. Nada se perde: as definições já estão no ar e o editor mantém o bloco atual de campos livres do item.

**Fase 3 (proposta, fora desta spec):** tabela `ValorCampoLivre` (empresa, proprietário, id do dono, campo, valor), uso no Portal e no
Pedido-Proposta, cópia SOL→PED, leitura no relatório do orçamento. **Opcional desta fase (tarefa `*`)**: sugerir no bloco de campos livres do
item os **rótulos** configurados (ARTE, PADRÃO) com a lista de opções, gravando no Json `camposLivres` já existente. Depende de aprovação do usuário
porque pode ser lida como duplicação do que será a Fase 3.

## 10. Decisões que precisam do usuário

| # | Decisão | Recomendação |
|---|---|---|
| 1 | Campos livres ARTE/PADRÃO: adiar para a Fase 3 (comercial) ou incluir sugestão de rótulos no item agora | **Adiar**; a sugestão de rótulos fica como tarefa opcional |
| 2 | Material no item novo: aplicar as escolhas depois do primeiro salvamento (passes, fluxo automático) ou bloquear o seletor até o item ser salvo | **Passes automáticos** (Cartucho, 60% do volume, sempre usa cola ou verniz) |
| 3 | Criar a coluna aditiva `tipoParam` em `MaterialAcabamento`, preenchida pela moda de `TipoParamAcab` do legado (importador com dry-run) | **Aprovar**; sem ela o preço depende de um mapa por `tipoMaterial` que não é confiável (BOPP vem como `OUTRO`) |
| 4 | Obrigar o tipo de plano ao criar plano quando o item tem produto | **Obrigar** (é o objetivo do catálogo); planos antigos seguem sem tipo |
| 5 | Item puxado pode escolher Produto Gráfico (só organização, sem defaults nem mudança de custo) | **Permitir** |
| 6 | Cálculo ao vivo passa a considerar `materiaisAcabamento` também em itens sem produto (hoje ignora) | **Não nesta fase** (não-regressão); decidir depois |
| 7 | Cancelar o editor com escolhas de material já gravadas e fora do preço: perguntar se quer salvar | **Perguntar** (seção 5.6) |

## 11. Riscos e pontos em aberto

| Item | Tratamento |
|---|---|
| `PUT /selecao-material` grava o Json do item sem recalcular | Passe de recálculo ao salvar; confirmar ao cancelar; documentado |
| Linhas `SELECAO` com `computarCusto = false` somem se o payload filtrar | `montarPayloadItem` envia todas as linhas `SELECAO`; teste de unidade e de rota |
| `tipoMaterial` não indica o `tipoParam` | Decisão 3; mapa provisório conservador (cai em informativo) |
| Catálogo vazio para um produto (relações não importadas ou 249 não casados) | Estado vazio com botão "Usar lista geral"; nunca esconder acabamentos já marcados |
| Atividade do catálogo fora dos 100 acabamentos carregados | Contar e avisar; confirmar se a empresa passa de 100 |
| `abrirEditorPagina` com subconjunto de campos | Incluir os campos novos e conferir os demais (ponto a verificar) |
| Plano fixo ausente no catálogo | `planoFixoDoCatalogo` devolve `null`; seção Acabamentos mostra só produto e acondicionamento |
| Produto de outra linha ou inativo em item salvo | Exibir como está, com aviso; não apagar |
| Ids de suporte do seletor do plano × relação PLANO→SUPORTE | Confirmar antes de restringir; se divergir, manter lista atual |
| Ajustes, Quebras e Limites | Continuam fora; nenhuma tela sugere que alteram o cálculo |

## 12. Estratégia de testes

- **Unidade (Vitest, front):** cada função de `catalogo-puro.ts`, `montarPayloadItem` com e sem linhas `SELECAO`, hidratação de `itemParaForm`
  (preserva `origem` e `selecaoId`), `montarPayloadCalculo` com e sem produto (idêntico ao atual sem produto).
- **Propriedades (fast-check, opcionais `*`):** `aplicarDefaultsEmVazios` idempotente e sem sobrescrita; `mesclarLinhasSelecao` preserva todas
  as linhas manuais e é idempotente; `sugerirItensDiversos` nunca devolve item já presente; ordem de `filtrarOrdenarAtividades` respeita a do catálogo.
- **Back (Vitest, Prisma mockado):** aceite e devolução de `produtoGraficoId` e `tipoPlanoId`, 422 de outra empresa, ausente não altera, `null` limpa;
  `DELETE /selecao-material` (remove, reflete, idempotente, 404, isolamento).
- **Regressão:** suíte do módulo `orcamento-grafico` e `decomposicao-stc.service.test.ts` verdes; testes de `editor/` no front com `--pool=threads`.
- **Manual (usuário):** (a) orçamento antigo abre e salva com o mesmo valor; (b) item puxado: escolher material não muda o custo; (c) item novo de
  Cartucho: produto, atividades pré-marcadas, cola e verniz, itens sugeridos, salvar; (d) plano de Cartucho Composto com tipo.
- Verificação por `get_diagnostics`; não rodar `tsc` inteiro nem `next build`. Comandos curtos (armadilha do PSReadLine).
