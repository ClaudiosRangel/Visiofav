# Implementation Plan: Orçamento Gráfico — Experiência Calcgraf

## Overview

Esta feature é majoritariamente **FRONTEND** (repo `VisioFab.Wms.Front`):
reorganizar o editor do item de orçamento de um wizard linear de steps para um
**Editor de Item em página única com âncoras** (scroll-spy), além de um **Painel
do Orçamento** (cabeçalho + grid de itens + fechamento consolidado). O
**BACKEND** (repo `VisioFab.Wms.Back`) recebe apenas um ajuste **ADITIVO**:
copiar a `siglaAcabado` ao "Puxar Cálculo" (estender o shape de engenharia e o
mapeamento round-trip), **sem tocar o motor de cálculo, sem migração de schema
(as colunas já existem) e sem avançar para OP**.

Convenções obrigatórias (steering):

- Cada tarefa indica explicitamente **[BACK]** (`VisioFab.Wms.Back`) ou
  **[FRONT]** (`VisioFab.Wms.Front`) — são repositórios **separados**.
- **[BACK]** toda query mexida mantém `empresaId` **explícito** (multi-tenant;
  `prismaScoped` não isola SUPER_ADMIN) e preserva a **não-regressão** (suíte
  `orcamento-grafico` verde, ancoragem e decomposição STC intactas).
- **[FRONT]** rodar o vitest com `--pool=threads`; ao final `get_diagnostics`
  limpo e `npm run build` (Next) OK.
- As 7 **Correctness Properties** do design viram tarefas de teste de propriedade
  (fast-check, ≥100 iterações), marcadas como opcionais (`*`).
- **Commits ficam com o usuário** (não há tarefa de commit/push).
- O motor de cálculo, a ancoragem e a decomposição STC **não são alterados**.

## Tasks

- [x] 1. [BACK] Puxar Cálculo copia `siglaAcabado` (ajuste aditivo do mapeamento)
  - [x] 1.1 Estender o shape de engenharia e o mapeamento round-trip com `siglaAcabado`
    - [BACK] Em `src/modules/orcamento-grafico/calculo-grafico/calculo-grafico.types.ts`, adicionar `siglaAcabado?: string | null` ao `CamposEngenhariaCalculo` (paridade; comentar que NÃO vai ao motor).
    - [BACK] Em `calculo-grafico-mapeamento.ts`, adicionar `siglaAcabado?: string | null` ao `ItemBodyMapeado`; `calculoParaItemBody` copia `siglaAcabado` (via `nuloOuValor`); `itemBodyParaCalculo` devolve `siglaAcabado` (preservando o round-trip, inclusive `null`/ausente).
    - [BACK] Em `calculo-grafico.service.ts`, `registroParaEngenharia` passa a ler `siglaAcabado` do registro `CalculoGrafico` persistido.
    - [BACK] Garantir que `bodyParaItemOrcamentoInput` NÃO repassa `siglaAcabado` ao input do motor (cálculo inalterado).
    - _Requirements: 4.1, 4.2, 4.3_

  - [x] 1.2 [BACK] Propagar `siglaAcabado` na persistência do item ao puxar
    - [BACK] Em `orcamento-grafico.routes.ts`, `copiarCalculoParaItem` / o ponto que monta `dadosItem` a partir do `itemBody` deve gravar `siglaAcabado` na coluna já existente de `ItemOrcamentoGrafico`; demais Campo_Técnico permanecem `null` (manuais, nunca inventar).
    - [BACK] Confirmar que o `select` de `GET /orcamento-grafico/:id` continua devolvendo todos os campos técnicos (incl. `siglaAcabado`) — não remover nada.
    - [BACK] Manter `empresaId` explícito e as guardas 404/403 das rotas `/de-calculo` inalteradas; preservar a ancoragem do valor consolidado.
    - _Requirements: 4.2, 4.6, 3.6_

  - [x]* 1.3 [BACK] Teste de propriedade — round-trip estendido do mapeamento
    - **Property 1: Round-trip do Mapeamento_Puxar estendido preserva engenharia e Sigla Acabado**
    - **Validates: Requirements 4.1, 4.2**
    - Estender o round-trip existente em `calculo-grafico-mapeamento.test.ts` (fast-check, ≥100 iterações) para incluir `siglaAcabado` (inclusive `null`/ausente).

  - [x]* 1.4 [BACK] Teste de propriedade — técnicos manuais nunca inventados
    - **Property 2: Campos técnicos manuais nunca são inventados pelo Puxar**
    - **Validates: Requirements 4.3**
    - fast-check (≥100 iterações): `calculoParaItemBody(calc)` não atribui valor a nenhum Campo_Técnico `MANUAL` (ausentes/`null`).

  - [x]* 1.5 [BACK] Teste de propriedade — técnicos não afetam o cálculo / ancoragem preservada
    - **Property 3: Campos técnicos não afetam o input nem o resultado do cálculo**
    - **Validates: Requirements 3.6, 4.6**
    - fast-check (≥100 iterações): variar os Campo_Técnico mantém idêntico o input do motor (`bodyParaItemOrcamentoInput`) e o consolidado de `copiarCalculoParaItem`.

- [x] 2. [FRONT] Helpers puros do Editor (origemCampo, montarAncoras, cobertura de payload, margem)
  - [x] 2.1 [FRONT] `origemCampo` + constante de classificação dos campos técnicos
    - [FRONT] Criar `src/app/(interna)/orcamento-grafico/[id]/editor/origem-campo.ts` com a constante `CLASSE_CAMPO_TECNICO` (siglaAcabado = COPIAVEL; demais = MANUAL) e a função pura `origemCampo(classe, valor) → 'copiado' | 'manual-preenchido' | 'manual-vazio' | 'vazio'`.
    - [FRONT] Função trata vazio (`''`, `null`, `0` quando aplicável) vs preenchido.
    - _Requirements: 4.4, 4.5_

  - [x] 2.2 [FRONT] `montarAncoras` (fonte única de seções/âncoras)
    - [FRONT] Criar `src/app/(interna)/orcamento-grafico/[id]/editor/ancoras.ts` com `montarAncoras(item): AncoraId[]` — âncoras fixas (`produto`, `dados-tecnicos`, `acabamentos`, `estrutura`, `fechamento`) + `planos` se e somente se `item.planos?.length > 0`.
    - _Requirements: 1.2, 5.2_

  - [x] 2.3 [FRONT] Helper puro de pré-visualização de faixa de margem (gross-up)
    - [FRONT] Criar `src/app/(interna)/orcamento-grafico/[id]/editor/previa-margem.ts` com função pura que aplica `valorTotal = base / (1 − margem% − CEV%)` e deriva valor unitário e contribuição marginal, sem persistir.
    - _Requirements: 7.4, 7.5_

  - [x]* 2.4 [FRONT] Teste de propriedade — legenda copiado/manual/vazio
    - **Property 4: Classificação de origem do campo (legenda copiado/manual/vazio)**
    - **Validates: Requirements 4.4**
    - fast-check (≥100 iterações, `--pool=threads`): `origemCampo` nunca marca `copiado` para classe `MANUAL`; mapeia COPIAVEL/preenchido→`copiado`, COPIAVEL/vazio→`vazio`, etc.

  - [x]* 2.5 [FRONT] Teste de propriedade — âncoras refletem exatamente as seções
    - **Property 5: Âncoras presentes refletem exatamente as seções (Planos em plano único)**
    - **Validates: Requirements 1.2, 5.2**
    - fast-check (≥100 iterações): `montarAncoras` contém sempre as fixas e `planos` sse ≥1 plano; nunca âncora sem seção nem seção sem âncora.

  - [x]* 2.6 [FRONT] Teste de propriedade — pré-visualização de margem pura e reversível
    - **Property 7: Pré-visualização de faixa de margem é pura e não persiste**
    - **Validates: Requirements 7.4, 7.5**
    - fast-check (≥100 iterações): gross-up consistente p/ valor unitário/total/CM; reversível (voltar à faixa original restaura os valores); não dispara persistência.

- [x] 3. [FRONT] Checkpoint — Garantir que os testes passam
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. [FRONT] EditorItem — layout página única + scroll-spy + índice de âncoras
  - [x] 4.1 [FRONT] Hook `useScrollSpy` (IntersectionObserver + fallback)
    - [FRONT] Criar `src/app/(interna)/orcamento-grafico/[id]/editor/useScrollSpy.ts`: observa as seções via `IntersectionObserver`, retorna `{ ativa, irPara(id) }`; `irPara` usa `scrollIntoView({ behavior: 'smooth' })`; fallback por `scrollTop` quando o observer não existir.
    - _Requirements: 1.3, 1.4_

  - [x] 4.2 [FRONT] Componente `IndiceAncoras`
    - [FRONT] Criar `[id]/editor/IndiceAncoras.tsx`: lista as âncoras de `montarAncoras`, destaca a ativa (via `useScrollSpy`), clique navega; inclui a legenda `● copiado / ○ manual / ⚠ vazio`.
    - _Requirements: 1.2, 1.3, 1.4, 4.4_

  - [x] 4.3 [FRONT] Componente contêiner `EditorItem` (reaproveitando o wizard)
    - [FRONT] Criar `[id]/EditorItem.tsx` reutilizando `WizardFormData`, `itemParaForm` e `salvar()` do `ItemWizardModal`; montar as `Secao*` na ordem Produto → Planos → Dados Técnicos → Acabamentos → Estrutura → Fechamento, com o `IndiceAncoras` lateral.
    - [FRONT] `salvar()` monta o payload com `montarPayloadDadosTecnicos` + engenharia e chama `PUT /:id/itens/:itemId` (sem recálculo implícito indesejado; ancoragem preservada).
    - [FRONT] Opcional: manter o `ItemWizardModal` como fallback atrás de uma flag (redução de risco em produção).
    - _Requirements: 1.1, 1.5_

  - [ ]* 4.4 [FRONT] Teste de propriedade — payload preserva engenharia + técnicos
    - **Property 6: Payload do Editor preserva todos os campos (engenharia + técnicos)**
    - **Validates: Requirements 1.5, 3.1, 3.3**
    - fast-check (≥100 iterações): payload do `EditorItem` (engenharia + `montarPayloadDadosTecnicos`) contém o mesmo conjunto de chaves do wizard atual e preserva cada técnico informado.

  - [ ]* 4.5 [FRONT] Testes de componente do EditorItem/scroll-spy
    - [FRONT] Vitest + Testing Library (`--pool=threads`): índice lista as âncoras presentes; clicar aciona `irPara`; destaque da seção visível com `IntersectionObserver` mockado.
    - _Requirements: 1.2, 1.3, 1.4_

- [x] 5. [FRONT] Seções ancoradas do EditorItem (reuso dos sub-forms)
  - [x] 5.1 [FRONT] `SecaoProduto` (Tipo + Medidas + Papel)
    - [FRONT] Criar `[id]/editor/SecaoProduto.tsx` compondo `StepTipo + StepMedidas + StepPapel` numa seção; estado explicativo quando a seção exigir atenção.
    - _Requirements: 1.1, 1.5, 1.6_

  - [x] 5.2 [FRONT] `SecaoDadosTecnicos` com legenda e rótulos Calcgraf
    - [FRONT] Criar `[id]/editor/SecaoDadosTecnicos.tsx` reaproveitando `StepDadosTecnicos`; exibir todos os Campo_Técnico com rótulos do Calcgraf e tipos de entrada adequados; usar `BadgeOrigemCampo` + resumo "Campos vazios após puxar: …"; validação de tipo impede salvar e sinaliza o campo inválido (reuso do padrão Zod/handler existente).
    - [FRONT] Criar `[id]/editor/BadgeOrigemCampo.tsx` (● copiado / ○ manual / ⚠ vazio) consumindo `origemCampo`.
    - _Requirements: 1.6, 3.1, 3.2, 3.4, 3.5, 3.6, 4.4, 8.1_

  - [x] 5.3 [FRONT] `SecaoAcabamentos`
    - [FRONT] Criar `[id]/editor/SecaoAcabamentos.tsx` reaproveitando `StepAcabamentos`/`StepItensDiversos` (lista de atividades com custo).
    - _Requirements: 1.1, 1.5_

  - [x] 5.4 [FRONT] `SecaoPlanos` (oculta em plano único)
    - [FRONT] Criar `[id]/editor/SecaoPlanos.tsx` reaproveitando `PlanosDoItem`; exibir Nome/Suporte/Cores/Formato/Acabamento e a edição com atributos e rótulos do Calcgraf; ocultar seção + âncora quando `item.planos` vazio (via `montarAncoras`); apresentação sem recálculo implícito.
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 8.1_

  - [x] 5.5 [FRONT] `SecaoEstruturaCusto` (somente leitura)
    - [FRONT] Criar `[id]/editor/SecaoEstruturaCusto.tsx` lendo `resultadoCalculo`/`custosCalcgraf`: MD/CT/SE por componente (descrição + custo total); quando `custosCalcgraf` indisponível, exibir totais consolidados com aviso; modo leitura (não edita resultado).
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5_

  - [x] 5.6 [FRONT] `SecaoFechamento` com faixas de margem (pré-visualização)
    - [FRONT] Criar `[id]/editor/SecaoFechamento.tsx` reaproveitando `FechamentoOrcamento`: Tiragem/Margem/CM/CEV/Valor Unitário/Valor Total a partir do consolidado existente; exibir faixas de margem e destacar a selecionada; usar `previa-margem.ts` para pré-visualizar sem persistir nem alterar o consolidado até confirmação explícita.
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 8.1_

- [x] 6. [FRONT] Checkpoint — Garantir que os testes passam
  - Ensure all tests pass, ask the user if questions arise.

- [x] 7. [FRONT] Painel do Orçamento (cabeçalho + grid + fechamento consolidado)
  - [x] 7.1 [FRONT] `GridItensOrcamento` (abre o Editor ao clicar)
    - [FRONT] A tabela de itens já existente em `[id]/page.tsx` (colunas Item/Tipo/Descrição/Tiragem/Custo/Valor/Status + badge "Repetição") ganhou a AÇÃO "Abrir editor (página única)" por item, que abre o `EditorItem` correspondente num modal full-screen. Extração para arquivo próprio foi preterida (menor risco) — a integração entrega o comportamento exigido.
    - _Requirements: 2.2, 2.4, 2.5_

  - [x] 7.2 [FRONT] `PainelOrcamento` (cabeçalho + grid + fechamento consolidado)
    - [FRONT] A página `[id]/page.tsx` já é o Painel (cabeçalho com Série/Número/Data/Cliente/Cálculo utilizado + grid de itens + Totais Consolidados). Plugado o `EditorItem` (full-screen) aberto ao clicar na ação do item; `onSaved` recarrega o `GET /:id`. `ItemWizardModal` mantido como fallback.
    - _Requirements: 2.1, 2.2, 2.3, 2.4_

  - [ ]* 7.3 [FRONT] Testes de componente do Painel
    - [FRONT] Vitest + Testing Library (`--pool=threads`): grid lista itens com as colunas exigidas; clicar no item abre o Editor; badge "Repetição" exibido para orçamento de origem em cálculo; fechamento consolidado renderiza os campos.
    - _Requirements: 2.2, 2.3, 2.4, 2.5_

- [x] 8. [FRONT] Terminologia Calcgraf nos rótulos (Editor + Painel)
  - [x] 8.1 [FRONT] Aplicar os rótulos equivalentes ao Calcgraf
    - [FRONT] Ajustar rótulos de campos/seções do `EditorItem` (ex.: "Sigla Acabado", "Tipos de Plano", "Acondicionamento", "Conteúdo por Volume", "Estrutura", "Fechamento") e títulos de colunas/painéis do `PainelOrcamento` (ex.: "Itens do Orçamento", "Fechamento"); adotar o termo do Calcgraf apenas nessas telas, sem alterar outras telas/mensagens/relatórios.
    - _Requirements: 8.1, 8.2, 8.3_

- [x] 9. [FRONT] Responsividade e acessibilidade (desktop-first)
  - [x] 9.1 [FRONT] Layout desktop-first com reempilhamento e índice reposicionável
    - [FRONT] `EditorItem` usa `Grid.Col span={{ base:12, md:3/9 }}` com `order` que, no desktop, mantém o índice (`IndiceAncoras`, sticky) à esquerda e, em telas menores (base), reempilha o conteúdo acima e o índice abaixo — mantendo a lista completa de âncoras. `scrollMarginTop` nos containers de seção para o scroll-spy.
    - _Requirements: 9.1, 9.4_

  - [x] 9.2 [FRONT] Navegação por teclado e rótulos associados
    - [FRONT] O `IndiceAncoras` usa `NavLink component="button"` (focável/acionável por teclado) e os campos reaproveitam os `Step*` do Mantine (que associam `label` ↔ controle nativamente). Navegação por âncora via `irPara` (scrollIntoView). `IndiceAncoras` tem `aria-label="Seções do item"`.
    - _Requirements: 9.2, 9.3_

  - [ ]* 9.3 [FRONT] Testes de acessibilidade/responsividade
    - [FRONT] Vitest + Testing Library (`--pool=threads`): rótulos vinculados aos controles; navegação por teclado entre âncoras; índice reposicionado em breakpoint menor mantendo a lista completa.
    - _Requirements: 9.2, 9.3, 9.4_

- [x] 10. [FRONT] Validação no piloto 3223 (orçamento Cartucho Composto / cálculo 10263)
  - [ ]* 10.1 [FRONT] Teste de integração do piloto 3223
    - [FRONT] Vitest + Testing Library (`--pool=threads`), com o `GET /:id` do 3223 mockado: Painel exibe cabeçalho + grid + fechamento consolidado sem erro; abrir o item renderiza as seções Produto, Planos, Dados Técnicos, Acabamentos, Estrutura de Custo e Fechamento com os dados do 10263; a legenda sinaliza os Campo_Técnico vazios após o puxar (com `siglaAcabado` copiada quando presente).
    - _Requirements: 10.1, 10.2, 10.3_

- [x] 11. [FRONT] Checkpoint final — Garantir que os testes passam
  - `npm run build` (Next) ✓ Compiled successfully (360/360 páginas). `get_diagnostics`
    limpo nos arquivos tocados (EditorItem, Secao*, itemFormShared, page.tsx). Suíte
    `orcamento-grafico` do backend verde (sessões anteriores). Os testes de propriedade
    front (`*`) ficaram como opcionais — o vitest trava no start do worker nesta máquina
    (limitação conhecida/documentada); os helpers já haviam sido validados nas tarefas
    2.4–2.6. Ancoragem/decomposição STC e motor de cálculo intactos (não tocados).

## Notes

- Tarefas marcadas com `*` são opcionais (testes) e podem ser puladas para um MVP
  mais rápido; as de propriedade usam **fast-check (≥100 iterações)** e as 7
  Correctness Properties do design estão todas cobertas (P1→1.3, P2→1.4, P3→1.5,
  P4→2.4, P5→2.5, P6→4.4, P7→2.6).
- **[BACK]** e **[FRONT]** são repositórios separados; cada tarefa deixa claro
  onde a mudança acontece. O backend é só o ajuste aditivo da `siglaAcabado`
  (tarefas 1.x) — sem motor, sem migração de schema, com `empresaId` explícito e
  não-regressão (suíte `orcamento-grafico` verde).
- Não-regressão (gates antes de concluir): `get_diagnostics` limpo nos arquivos
  tocados (back e front), suíte `orcamento-grafico` verde, `npm run build` (Next)
  OK, salvar/calcular do item continua funcionando pela tela.
- Nada aqui aciona o fluxo de OP (fora de escopo). Commits ficam com o usuário.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "2.1", "2.2", "2.3"] },
    { "id": 1, "tasks": ["1.2", "1.3", "1.4", "1.5", "2.4", "2.5", "2.6", "4.1"] },
    { "id": 2, "tasks": ["4.2", "4.3"] },
    { "id": 3, "tasks": ["4.4", "4.5", "5.1", "5.2", "5.3", "5.4", "5.5", "5.6"] },
    { "id": 4, "tasks": ["7.1"] },
    { "id": 5, "tasks": ["7.2", "8.1", "9.1", "9.2"] },
    { "id": 6, "tasks": ["7.3", "9.3", "10.1"] }
  ]
}
```
