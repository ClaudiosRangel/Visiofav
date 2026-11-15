# Plano de ImplementaÃ§Ã£o â€” OrÃ§amento GrÃ¡fico: CatÃ¡logo no Editor do Item (Fase 2)

ConvenÃ§Ãµes: back em `c:\Source\VisioFab.Wms.Back`, front em `c:\Source\VisioFab.Wms.Front` (repos separados). Commits sÃ³ quando o usuÃ¡rio pedir.
`empresaId` explÃ­cito em toda query nova do back. NÃ£o alterar `ancorarCustoCalcgraf`, o motor de cÃ¡lculo nem os testes de decomposiÃ§Ã£o.
ValidaÃ§Ã£o por `get_diagnostics` e Vitest (iniciar o processo, aguardar cerca de 40 s, ler a saÃ­da, parar; no front usar `--pool=threads`).
NÃ£o rodar `tsc` inteiro nem `next build`. Comandos curtos no PowerShell (armadilha do PSReadLine); saÃ­da em arquivo quando for longa.
Tarefas marcadas com `*` sÃ£o opcionais (testes extras ou itens que dependem de decisÃ£o do usuÃ¡rio).
Caminhos do front abaixo sÃ£o relativos a `src/app/(interna)/orcamento-grafico/`.

## Tarefas

- [ ] 1. Back mÃ­nimo (repo `VisioFab.Wms.Back`)
  - [x] 1.1 Aceitar e gravar `produtoGraficoId` e `tipoPlanoId`
    - `itemOrcamentoBodySchema` ganha `produtoGraficoId` (uuid, opcional, anulÃ¡vel); `planoBodySchema` ganha `tipoPlanoId`
    - `dadosPersistenciaItem` e `dadosPersistenciaPlano` gravam de forma condicional (ausente nÃ£o altera, `null` limpa)
    - Validar o id com `{ id, empresaId }` em `POST/PUT /:id/itens` e `POST/PUT .../planos`; inexistente na empresa responde 422 legÃ­vel
    - Arquivo: `src/modules/orcamento-grafico/orcamento-grafico.routes.ts`
    - _Requisitos: 2.1, 2.2, 2.3, 2.5, 2.6_
  - [x] 1.2 Devolver os campos no `GET /orcamento-grafico/:id`
    - `produtoGraficoId: true` no select do item e `tipoPlanoId: true` no select do plano (junto ao select de `planos` jÃ¡ existente)
    - _Requisitos: 2.4_
  - [x] 1.3 `DELETE /cadastros/selecao-material` (`itemId`, `acabamentoId`, `planoId?`)
    - TransaÃ§Ã£o: apaga a seleÃ§Ã£o, relÃª as restantes, reflete com `refletirSelecoesNoJson`, atualiza `materiaisAcabamento` com `updateMany({ id, empresaId })`
    - Resposta `{ removidas, resumoCustos }`; idempotente; 404 se o item nÃ£o for da empresa; nÃ£o recalcula `resultadoCalculo`
    - Arquivo: `src/modules/orcamento-grafico/cadastros-graficos/selecao-material.routes.ts`
    - _Requisitos: 12.1, 12.2, 12.3, 12.4, 12.5_
  - [x] 1.4 Testes de rota (Vitest, Prisma mockado)
    - Item e plano: aceita e devolve os campos; ausente nÃ£o altera; `null` limpa; id de outra empresa dÃ¡ 422; payload sem os campos igual ao atual
    - DELETE: remove, reflete, idempotente, 404, isolamento por empresa, linhas manuais preservadas
    - _Requisitos: 2.1, 2.2, 2.3, 12.2, 12.3, 12.4, 14.2_
  - [x] 1.5 RegressÃ£o do back
    - Rodar a suÃ­te do mÃ³dulo `orcamento-grafico` e `decomposicao-stc.service.test.ts` (14/14); `get_diagnostics` nos arquivos tocados
    - _Requisitos: 2.6, 11.3, 11.5, 14.3, 14.4_
  - [x] 1.6 Coluna `tipoParam` em `MaterialAcabamento` (decisÃ£o 3 aprovada)
    - `schema.prisma` (`tipoParam Int? @map("tipo_param")`) e `prisma/migrate-prod.ts` idempotente no mesmo commit; rodar 2x quando houver banco local
    - Exportador e importador da Fase 1 ganham a fase `materiais-tipo-param` (moda de `TipoParamAcab` por `CodMaterial`), sÃ³ preenche campo vazio, `--dry-run` e relatÃ³rio
    - ProduÃ§Ã£o somente depois de dry-run revisado e autorizaÃ§Ã£o explÃ­cita; conexÃ£o por variÃ¡vel de ambiente
    - _Requisitos: 7.9_
  - [ ]* 1.7 Teste da fase `materiais-tipo-param` com arquivo de amostra
    - `--dry-run` nÃ£o grava; segunda execuÃ§Ã£o cria zero; material sem linha no legado fica nulo
    - _Requisitos: 7.9, 14.1_

- [ ] 2. Camada pura e contratos do front (repo `VisioFab.Wms.Front`)
  - [x] 2.1 Tipos e estado do formulÃ¡rio
    - `novo/page.tsx` (`WizardFormData`): `produtoGraficoId?: string | null`, `_produtoGraficoNome?`, `_selecoesPendentes?`, `_catalogoAplicadoEm?`; `MaterialAcabamentoItem` ganha `origem?` e `selecaoId?`
    - `[id]/editor/catalogo/catalogo.types.ts`: `CatalogoDoItem`, `SelecaoPendente`
    - `INITIAL_ITEM` mantÃ©m `produtoGraficoId` indefinido
    - _Requisitos: 1.5, 8.2, 11.1_
  - [x] 2.2 `[id]/editor/catalogo/catalogo-puro.ts`: defaults
    - `aplicarDefaultsEmVazios` (item e plano) e `deveAplicarDefaults` (falso para item puxado ou salvo com produto)
    - _Requisitos: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7_
  - [x] 2.3 `catalogo-puro.ts`: atividades
    - `planoFixoDoCatalogo`, `filtrarOrdenarAtividades` (grupos atividades, acondicionamento e fora do catÃ¡logo) e `preMarcarAtividades`
    - _Requisitos: 3.2, 6.1, 6.2, 6.3, 6.4_
  - [x] 2.4 `catalogo-puro.ts`: material
    - `tipoParamDoMaterial` (campo do material, senÃ£o mapa provisÃ³rio conservador do design 6.3) e `mesclarLinhasSelecao` (espelha `refletirSelecoesNoJson`)
    - _Requisitos: 7.7, 7.9, 8.1, 8.6_
  - [x] 2.5 `catalogo-puro.ts`: itens diversos
    - `sugerirItensDiversos` (conversÃ£o para `{ descricao, quantidade, valor, fixo }`, dedupe por descriÃ§Ã£o normalizada, marca de "sem custo")
    - _Requisitos: 9.3, 9.4, 9.5_
  - [x] 2.6 `[id]/itemFormShared.ts`
    - `itemParaForm` hidrata `produtoGraficoId` e preserva `origem` e `selecaoId`; `montarPayloadItem` inclui `produtoGraficoId` sÃ³ quando definido e envia todas as linhas `SELECAO` (inclusive `computarCusto = false`) mais as manuais marcadas
    - `montarPayloadCalculo` envia `materiaisAcabamento` sÃ³ quando hÃ¡ produto; `salvarItem` passa a devolver o item salvo (compatÃ­vel com quem ignora o retorno)
    - _Requisitos: 1.5, 8.1, 8.2, 8.4, 8.7, 11.1_
  - [x] 2.7 `cadastros/_shared/cadastros-graficos.api.ts` e `.types.ts`
    - `selecaoMaterialApi.remover(itemId, acabamentoId, planoId?)`; tipo `tipoParam?: number | null` em `MaterialCatalogo`
    - _Requisitos: 7.6, 12.1_
  - [x] 2.8 Testes de unidade (Vitest) da camada pura e do `itemFormShared`
    - Defaults sem sobrescrita e idempotentes; ordem e grupos; plano fixo; `tipoParam`; mescla de linhas; sugestÃ£o sem duplicar; payload idÃªntico ao atual sem produto e sem `SELECAO`; hidrataÃ§Ã£o preserva `origem` e `selecaoId`
    - _Requisitos: 5.3, 6.2, 8.1, 8.2, 8.7, 11.1, 14.1_
  - [ ]* 2.9 Testes de propriedade (fast-check)
    - `aplicarDefaultsEmVazios` idempotente e nunca sobrescreve; `mesclarLinhasSelecao` preserva linhas manuais e Ã© idempotente; `sugerirItensDiversos` nunca repete; ordem do catÃ¡logo respeitada
    - _Requisitos: 5.3, 8.6, 9.3, 14.1_

- [~] 3. Checkpoint antes do front
  - Back: tarefas 1.1 a 1.5 verdes e deploy no Render confirmado (os campos novos precisam estar no ar antes do front usÃ¡-los). Front: tarefas 2.x verdes, `get_diagnostics` limpo. Perguntar ao usuÃ¡rio as decisÃµes 1 a 7 do `design.md` (seÃ§Ã£o 10) e se a coluna `tipoParam` (1.6) entra agora

- [ ] 4. Front â€” editor ligado ao catÃ¡logo
  - [x] 4.1 Hook `[id]/editor/catalogo/useCatalogoItem.ts`
    - Carrega `catalogoApi.produto` uma vez, descobre o plano fixo e carrega `catalogoApi.plano`; tipos nÃ£o fixos sob demanda com cache; estados carregando, vazio e erro; `null` sem produto
    - _Requisitos: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6_
  - [x] 4.2 `SeletorProdutoGrafico` e integraÃ§Ã£o em `SecaoProduto`
    - Filtra por `linhaProdutoId` do orÃ§amento, opcional e limpÃ¡vel; produto inativo exibido como inativo; aviso quando a linha trocada nÃ£o bate; aplica defaults em item novo
    - `EditorItem` chama o hook e repassa o catÃ¡logo Ã s seÃ§Ãµes
    - _Requisitos: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 5.1, 13.4_
  - [x] 4.3 `[id]/page.tsx`
    - `abrirEditorPagina` passa `produtoGraficoId`, `materiaisAcabamento` e `planos[].tipoPlanoId`; interface `ItemOrcamento` ganha os campos; `PlanosDoItem` recebe `produtoGraficoId`
    - Conferir quais outros campos tÃ©cnicos ficam de fora ao reabrir e registrar no handoff (ponto a verificar)
    - _Requisitos: 8.3, 4.3_
  - [x] 4.4 `novo/StepAcabamentos.tsx` com prop `catalogo`
    - Grupos Atividades, Acondicionamento e Fora do catÃ¡logo, na ordem do catÃ¡logo; busca e filtro por natureza mantidos; restriÃ§Ãµes do catÃ¡logo; prÃ©-marcaÃ§Ã£o sÃ³ em item novo sem marcaÃ§Ã£o
    - Sem catÃ¡logo: nenhum cÃ³digo novo executa; o wizard `/novo` nÃ£o recebe a prop
    - _Requisitos: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 6.9, 11.1, 11.6_
  - [x] 4.5 `SeletorMaterialAtividade` e `AvisoAVerificar`
    - Select com os materiais permitidos (padrÃ£o prÃ©-selecionado), parÃ¢metros por `tipoParam`, resumo de consumo, unidade e custo; selo A_VERIFICAR discreto; selo "informativo" em item puxado
    - _Requisitos: 7.1, 7.4, 7.5, 7.7, 7.8, 7.11, 13.5_
  - [x] 4.6 Fluxo de seleÃ§Ã£o no editor
    - Item salvo: `PUT` imediato e linha `SELECAO` no formulÃ¡rio; desmarcar atividade ou limpar material chama o `DELETE`; erro 422 mostra os permitidos sem alterar a seleÃ§Ã£o anterior
    - Item novo: guarda em `_selecoesPendentes`
    - _Requisitos: 7.2, 7.3, 7.6, 7.10, 8.6_
  - [x] 4.7 Salvar em passes e cancelar
    - `EditorItem.salvar`: salvar item, aplicar pendentes e remoÃ§Ãµes com o id devolvido, mesclar as linhas e regravar o item para recalcular; aviso quando alguma seleÃ§Ã£o falhar
    - Cancelar com escolhas gravadas e fora do preÃ§o: perguntar se quer salvar
    - _Requisitos: 7.10, 8.1, 8.5, 8.6_
  - [x] 4.8 `SecaoMateriaisAcabamento`
    - Exibir as linhas `SELECAO` como somente leitura, com o nome da atividade, e manter a lista manual atual intacta
    - _Requisitos: 7.8, 8.6, 11.1_
  - [x] 4.9 `PlanosDoItem`: tipo de plano, defaults e atividades
    - Prop `produtoGraficoId`; Select "Tipo de plano" (obrigatÃ³rio para plano novo quando hÃ¡ produto e catÃ¡logo com tipos); defaults sÃ³ em campo nÃ£o tocado; atividades do tipo em `acabamentosRicos`; `tipoPlanoId` no POST e no PUT
    - Sem a prop, modal idÃªntico ao atual; confirmar ids de suporte antes de restringir o seletor
    - _Requisitos: 4.1, 4.2, 4.3, 4.4, 4.5, 4.7, 5.2, 6.8_
  - [x] 4.10 `SecaoPlanos`: coluna "Tipo de plano"
    - SÃ³ quando houver `tipoPlanoId`; planos sem tipo ficam como hoje
    - _Requisitos: 4.6_
  - [x] 4.11 `SugestaoItensDiversos` em `SecaoItensComplementares`
    - Bloco "Sugeridos pelo plano" com "Adicionar" e "Adicionar todos"; nunca adiciona sozinho; marca linha sem custo cadastrado
    - _Requisitos: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6_
  - [x] 4.12 RevisÃ£o transversal
    - Estados de carregamento, vazio e erro; tokens adaptativos nos temas claro e escuro; nenhuma menÃ§Ã£o ao sistema legado; nenhum texto sugere que Ajustes, Quebras ou Limites alteram o cÃ¡lculo
    - _Requisitos: 13.2, 13.3, 13.4, 13.5, 13.6, 13.7_
  - [ ]* 4.13 Testes de componente (Testing Library) dos fluxos crÃ­ticos
    - Seletor de produto filtrado por linha; lista de acabamentos por catÃ¡logo; seleÃ§Ã£o de material com A_VERIFICAR
    - _Requisitos: 1.2, 6.2, 7.5_
  - [ ]* 4.14 SugestÃ£o de rÃ³tulos de campos livres no bloco do item (**sÃ³ se a decisÃ£o 1 aprovar**)
    - Lista os campos configurados (ARTE, PADRÃƒO) como sugestÃ£o de rÃ³tulo e de opÃ§Ãµes, gravando no Json `camposLivres` jÃ¡ existente
    - _Requisitos: 10.4_

- [ ] 5. DocumentaÃ§Ã£o e fechamento
  - [x] 5.1 Atualizar `docs/orcamento-planos-calcgraf-HANDOFF.md` (nova seÃ§Ã£o "19. Fase 2") e `.kiro/steering/migracao-calcgraf-carton-wega.md` com resumo curto
    - _Requisitos: 11.5_
  - [~] 5.2 Checkpoint final
    - Testes verdes nos dois repositÃ³rios, `get_diagnostics` limpo, conferÃªncia manual (design 12) com o usuÃ¡rio; perguntar sobre commit e deploy do front
    - _Requisitos: 11.2, 11.3, 11.5, 14.3, 14.5_

## Ordem e dependÃªncias

1 â†’ 2 (as tarefas 2.x nÃ£o dependem do back e podem comeÃ§ar em paralelo Ã  1) â†’ 3 (checkpoint) â†’ 4 â†’ 5.
Dentro da 4: 4.1 â†’ 4.2 â†’ 4.3; 4.4 depende de 4.1; 4.5 e 4.6 dependem de 4.4 e das tarefas 1.3 e 2.7; 4.7 depende de 4.6; 4.8 depende de 4.7;
4.9 depende de 4.1 e 1.1; 4.10 depende de 4.3; 4.11 depende de 4.1.
O front sÃ³ usa `produtoGraficoId`, `tipoPlanoId` e o `DELETE` depois do deploy do back (tarefa 3).

## Pontos a verificar o funcionamento exato (nÃ£o bloqueiam)

- VÃ­nculo entre Produto GrÃ¡fico e Tipo de Embalagem (hoje inexistente; os dois seletores ficam independentes).
- `tipoParam` de cada material e o mapa provisÃ³rio por `tipoMaterial`; fÃ³rmulas dos TipoParam 2 e 3 (informativos).
- Se os ids do seletor de suportes do plano sÃ£o os da relaÃ§Ã£o PLANOâ†’SUPORTE.
- Se a empresa tem mais de 100 acabamentos (limite de `StepAcabamentos`) e se o catÃ¡logo cabe.
- Quais campos tÃ©cnicos o `abrirEditorPagina` deixa de passar ao reabrir o item.
- Se `reaproveitar` e `de-calculo` devem copiar `produtoGraficoId` e `tipoPlanoId`.
- Efeito, no preÃ§o, de cancelar o editor depois de gravar seleÃ§Ãµes de material (seÃ§Ã£o 5.6 do design).
- Cobertura do catÃ¡logo da Wega com os 249 itens nÃ£o casados da importaÃ§Ã£o (centros, suportes, tintas e matrizes).
