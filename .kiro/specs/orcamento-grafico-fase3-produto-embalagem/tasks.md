# Implementation Plan: Orçamento Gráfico — Produto × Embalagem e Acabamentos da Fase 3

## Overview

Plano de implementação da Fase 3, a partir de `requirements.md` e `design.md` desta pasta. A ordem segue o design: back primeiro (classificação de acondicionamento, `GET /acabamentos/por-ids`, `tipoEmbalagemId` no produto, `reaproveitar` em transação), depois os pontos de parada em produção, o checkpoint de deploy do back e, por fim, o front (funções puras, ProdutoModal, sugestões no editor, campos técnicos, falha de seleção, acabamentos paginados, modal de plano, campos livres).
Back em `c:\Source\VisioFab.Wms.Back` (`src/modules/orcamento-grafico/`) e front em `c:\Source\VisioFab.Wms.Front` (`src/app/(interna)/orcamento-grafico/`), repositórios separados. O back vai ao ar (Render) antes de o front usar qualquer campo ou rota nova.

## Decisões aprovadas

O usuário aprovou o design conforme as recomendações:

1. **Vínculo Produto × Tipo de Embalagem:** Opção A. Coluna opcional `tipoEmbalagemId` em `ProdutoGrafico`, sem `@relation`. `schema.prisma` e `migrate-prod.ts` idempotente no mesmo commit.
2. **Preenchimento inicial do vínculo:** pela convenção `CG-EMB-<n>` ↔ `codigoOrigem = n`, somente se a consulta 2 mostrar exatamente 1 candidato por produto, depois de dry-run e autorização.
3. **`de-calculo`:** Alternativa 3 (sem schema). Copia `produtoGraficoId` e `tipoPlanoId` só se o cálculo os tiver (hoje nenhum). Alternativa 1 apenas se a consulta 2 provar o casamento.
4. **Atomicidade de `reaproveitar`:** T1, transação interativa. Os helpers recebem parâmetro opcional `db = prisma`.
5. **Acondicionamento:** função única `classificarGrupoAtividade`, usada nas duas rotas do catálogo, e ajuste da flag do cadastro das atividades 39 e 53 por dry-run. A inclusão dos demais produtos afetados fica para depois do resultado da consulta 4 e de nova aprovação.
6. **Produção:** consultas `SELECT` 1 a 6 e qualquer dry-run ou gravação só com autorização explícita do usuário em cada passo. As tarefas de produção são pontos de parada.
7. **Contrato do `PUT` do item:** NÃO alterar. A correção dos campos técnicos fica só no front.
8. **Rota nova** `GET /orcamento-grafico/acabamentos/por-ids`.
9. **Campos livres:** proprietários SOLICITACAO e PEDIDO (duas chamadas), sem RECUSA e INSUMO.

## Convenções

- `empresaId` explícito (o da sessão) em toda consulta e gravação nova do back; nunca depender só de `prismaScoped`.
- Não alterar `ancorarCustoCalcgraf`, `decomposicao-stc.service.ts` nem os arquivos do motor (diff vazio). Wizard `/novo` e `ItemWizardModal` sem nenhuma linha alterada e sem a prop `catalogo`.
- Commits só quando o usuário pedir. No back, `schema.prisma` e `migrate-prod.ts` no mesmo commit.
- Comandos curtos no PowerShell (armadilha do PSReadLine); saída longa em arquivo.
- Vitest no front com `--pool=threads`; no back com `--reporter=dot`. Propriedades com fast-check, mínimo 100 execuções, comentário `Feature: orcamento-grafico-fase3-produto-embalagem, Property N: <texto>`.
- Validação por `get_diagnostics` nos arquivos tocados. Não rodar `tsc` inteiro nem `next build`.
- Textos visíveis em português do Brasil, sem "Calcgraf", "G-Print" ou "GPrint"; só tokens adaptativos do Mantine (sem hexadecimal, `white`, `black` nem nível `-0`).
- Tarefas marcadas com `*` são testes extras não exigidos pelos requisitos. Caminhos do front são relativos a `src/app/(interna)/orcamento-grafico/`; `editor/` é `[id]/editor/`.

## Tasks

- [x] 1. Back: classificação de acondicionamento (`classificarGrupoAtividade`)
  - [x] 1.1 Criar `classificarGrupoAtividade` e usá-la nas duas rotas do catálogo
    - Função pura em `catalogo.service.ts`: `{ flagAcondicionamento, temRelacaoAcondicionamento }` devolve "ACONDICIONAMENTO" ou "ATIVIDADES" (flag do cadastro OU relação `PRODUTO → ACONDICIONAMENTO`)
    - `obterCatalogoProduto` passa a usá-la; `obterCatalogoPlano` passa a separar o grupo com a mesma função
    - Não alterar nenhuma relação gravada nem o `acabamentoId` marcado nos itens
    - Arquivo: `src/modules/orcamento-grafico/cadastros-graficos/catalogo.service.ts`
    - _Requisitos: 6.4, 6.7, 6.9, 14.1_
  - [x] 1.2 Testes da classificação e do agrupamento
    - Unidade: entrada vazia (sem flag e sem relação) e preenchida; as duas rotas colocam a atividade no mesmo grupo
    - Comparação do agrupamento de todos os produtos antes e depois, com diferença só nos produtos corrigidos
    - **Property 12: Classificação de grupo é a mesma nas duas rotas do catálogo**
    - **Validates: Requirements 6.4, 6.7, 6.8, 6.9**
  - [x] 1.3 Script de correção da flag de acondicionamento com `--dry-run`
    - Script `scripts/corrigir-acondicionamento-orcamento.ts`: ajusta `acabamento_grafico.acondicionamento = true` para `codigo_origem` 39 e 53, só onde está `false`, só em atividades da empresa informada
    - `--dry-run` lista o que mudaria e grava 0 registros; segunda execução altera 0 registros; não cria nem remove relação
    - Conexão por variável de ambiente; recusa rodar sem `--empresa`. Não executar em produção nesta tarefa (ver tarefa 6)
    - _Requisitos: 6.2, 6.3, 6.5, 6.6_
  - [x] 1.4 Teste da decisão do script de correção
    - Função pura de decisão: só marca o que está `false`, idempotente, não toca relações
    - **Property 13: Correção de acondicionamento é idempotente e só cria**
    - **Validates: Requirements 6.2, 6.3, 6.5**

- [x] 2. Back: `GET /orcamento-grafico/acabamentos/por-ids`
  - [x] 2.1 Implementar a rota
    - `ids` separados por vírgula (uuid), máximo 50; `where: { id: { in }, empresaId }`; mesma forma de item da listagem
    - Sem filtro de `status` (atividade inativa citada pelo catálogo deve poder ser exibida); ids de outra empresa ou inexistentes não voltam
    - Registrar antes de qualquer rota paramétrica do prefixo `/acabamentos`
    - Arquivo: `src/modules/orcamento-grafico/orcamento-grafico.routes.ts`
    - _Requisitos: 11.3, 12.3_
  - [x] 2.2 Testes de rota (Prisma mockado)
    - Devolve só da empresa; mais de 50 ids responde 400; lista vazia; inativo incluído; `empresaId` explícito no `where`
    - Arquivo: `acabamentos-por-ids.routes.test.ts`
    - _Requisitos: 11.3, 12.3, 14.4_

- [x] 3. Back: `tipoEmbalagemId` em `ProdutoGrafico` (Opção A)
  - [x] 3.1 Schema e migração idempotente no mesmo commit
    - `schema.prisma`: `tipoEmbalagemId String? @map("tipo_embalagem_id")` em `ProdutoGrafico`, sem `@relation`
    - `prisma/migrate-prod.ts`: `ALTER TABLE produto_grafico ADD COLUMN IF NOT EXISTS tipo_embalagem_id VARCHAR(36)`, sem FK
    - Rodar `npx tsx prisma/migrate-prod.ts` duas vezes seguidas quando houver banco local (sem erro e sem alterar dados na segunda); `npx prisma generate`
    - _Requisitos: 1.9, 2.9, 12.4, 14.7_
  - [x] 3.2 Rotas de produto: gravar, limpar, validar e devolver o vínculo
    - `produtoInputSchema` aceita `tipoEmbalagemId` (uuid, nullable, opcional): ausente não altera, `null` limpa
    - `POST` e `PUT /produtos` validam `tipoEmbalagem.findFirst({ id, empresaId })` com o `empresaId` da sessão; inexistente ou de outra empresa responde 422 "Tipo de Embalagem inválido" sem gravar nada
    - `GET /produtos` e `GET /produtos/:id` e as respostas de `POST`/`PUT` devolvem `tipoEmbalagemId` (nulo quando vazio) na serialização de `produtoBase`
    - Arquivo: `src/modules/orcamento-grafico/cadastros-graficos/produtos-planos.routes.ts`
    - _Requisitos: 1.3, 1.4, 1.5, 1.7, 1.10_
  - [x] 3.3 Importador: decisão pura do vínculo e `--dry-run`
    - Função pura de decisão em `scripts/importar-cadastros-orcamento.ts`: preenche o vínculo só se vazio e com exatamente 1 candidato (`codigoOrigem` ou `CG-EMB-<n>`); vínculo preenchido nunca muda; 0 ou 2 ou mais candidatos entram no relatório de não casados com motivo
    - `--dry-run` grava 0 registros e imprime criados, atualizados, vínculos preenchidos e não casados; transação por produto, falha desfaz só aquele produto, continua e termina com código de saída diferente de zero
    - `codigoOrigem`, nome, linha e tributação dos produtos existentes ficam inalterados; segunda execução cria 0 e altera 0
    - Não executar em produção nesta tarefa (ver tarefa 6)
    - _Requisitos: 2.1, 2.2, 2.3, 2.4, 2.5, 2.7, 2.8_
  - [x] 3.4 Testes de rota do vínculo (Prisma mockado)
    - Gravar e ler de volta (listagem e detalhe); limpar; tipo inexistente ou de outra empresa responde 422 e não grava; `empresaId` da sessão em toda consulta e gravação
    - Arquivo: `produtos-planos.routes.test.ts`
    - **Property 1: Vínculo de embalagem faz ida e volta**
    - **Property 2: Tipo de embalagem inválido é rejeitado sem gravar e com empresa explícita**
    - **Validates: Requirements 1.3, 1.4, 1.5, 1.7, 1.10, 12.3, 14.4**
  - [x] 3.5 Teste da decisão do importador
    - Preenche só vazio com 1 candidato; preenchido mantém; 0 ou 2+ candidatos vão ao relatório com o motivo; aplicar duas vezes equivale a uma
    - **Property 3: Importação do vínculo é idempotente e nunca sobrescreve**
    - **Validates: Requirements 2.1, 2.2, 2.3, 2.4, 2.7**

- [x] 4. Back: `reaproveitar` em transação e cópia de produto e tipo de plano
  - [x] 4.1 Helpers com parâmetro opcional `db = prisma` e `resolverIdDaEmpresa`
    - `reconsolidar*`, `dadosPersistencia*` e as validações passam a aceitar `db` opcional (padrão `prisma`), sem mudar chamadas existentes
    - `resolverIdDaEmpresa(db, modelo, id, empresaId)` devolve o id ou `null` (consulta `{ id, empresaId }`)
    - `reconstruirBodyDoItem` passa a incluir `produtoGraficoId`; `reconstruirBodyDoPlano` e a cópia-espelho passam a incluir `tipoPlanoId`
    - Arquivo: `src/modules/orcamento-grafico/orcamento-grafico.routes.ts`. Não tocar em `ancorarCustoCalcgraf`
    - _Requisitos: 7.7, 7.8, 12.1, 12.3_
  - [x] 4.2 `POST /:id/reaproveitar` em `prisma.$transaction(async tx => …)`
    - Cabeçalho, itens, planos e reconsolidações na mesma transação (timeout elevado, cerca de 20 s)
    - Cópia de `produtoGraficoId` e `tipoPlanoId` validada por `{ id, empresaId }`; origem nula, inexistente ou de outra empresa grava `null` sem erro; sem defaults do produto e sem `SelecaoMaterialAcabamento`
    - Mantém 201, 403, 404 e 409 atuais; `custoProducao`, `resultadoCalculo` e consolidado idênticos aos de hoje
    - _Requisitos: 7.1, 7.2, 7.4, 7.6, 7.7, 7.8, 7.9, 7.10, 7.11_
  - [x] 4.3 `POST /de-calculo`: copiar produto e tipo de plano só se o cálculo tiver
    - A transação atual é mantida; copia `produtoGraficoId` e `tipoPlanoId` do `CalculoGrafico` apenas quando existirem (hoje nenhum, Alternativa 3), com a mesma validação por `{ id, empresaId }`
    - Alternativa 1 (convenção `CG-EMB-<n>`) NÃO entra aqui; só se a consulta 2 da tarefa 6 provar o casamento e o usuário aprovar
    - Sem mudança de valor, de `ancorarCustoCalcgraf` nem de status
    - _Requisitos: 7.3, 7.4, 7.5, 7.6, 7.7, 7.8, 7.10_
  - [x] 4.4 Testes de rota de `reaproveitar` e `de-calculo` (Prisma mockado)
    - Cópia dos dois campos; id de outra empresa e id inexistente geram item sem o campo e sem falha; todo `where` e `data` com `empresaId` explícito; falha injetada em cada etapa reverte tudo e mantém os status
    - Arquivo: `reaproveitar-de-calculo.routes.test.ts`
    - **Property 14: Cópia de produto e tipo de plano**
    - **Property 15: Reaproveitar é atômico**
    - **Validates: Requirements 7.1, 7.2, 7.3, 7.4, 7.6, 7.7, 7.8, 7.9, 7.10, 14.4**

- [x] 5. Back: regressão da suíte do módulo e da decomposição
  - [x] 5.1 Rodar a suíte do módulo `orcamento-grafico`
    - `npx vitest run src/modules/orcamento-grafico --reporter=dot` com saída em arquivo; 0 falhas e sem reduzir o número de testes de antes da fase
    - `get_diagnostics` em cada arquivo tocado do back, 0 erros
    - _Requisitos: 12.10, 14.5, 14.6_
  - [x] 5.2 Provar que o motor ficou intacto
    - `decomposicao-stc.service.test.ts` com 14 de 14 (reconfirmar a contagem); diff vazio em `ancorarCustoCalcgraf` e nos arquivos do motor
    - _Requisitos: 12.1, 12.9, 14.5_

- [x] 6. PONTO DE PARADA — consultas SELECT e dry-runs em produção (só com autorização explícita em cada passo)
  - [x] 6.1 Consultas `SELECT` 1 a 6 do `design.md` (somente leitura)
    - Pedir autorização antes de rodar, uma consulta ou grupo por vez; conexão por variável de ambiente; empresa Carton Wega `75848e24-742e-461d-b913-1642c5b83ae9`
    - Registrar os resultados no `design.md` (flag das atividades 39 e 53, casamento `CG-EMB-<n>`, relações do Cartucho Composto, produtos afetados, nº de acabamentos ativos e os que passam da posição 100, papéis duplicados)
    - Decidir com o usuário o caso do Req 6.1 (a, b ou c), a Alternativa 1 de `de-calculo` e a inclusão dos demais produtos afetados (nova aprovação)
    - _Requisitos: 6.1, 6.10, 11.2, 12.11_
  - [x] 6.2 Dry-runs em produção
    - Rodar `--dry-run` do script de acondicionamento (1.3) e do importador de vínculo (3.3) e apresentar o resultado ao usuário; gravar 0 registros
    - _Requisitos: 2.5, 2.6, 6.6, 12.11_
  - [x] 6.3 Gravação autorizada
    - Somente após dry-run revisado e autorização explícita: ajuste da flag das atividades 39 e 53 e preenchimento do vínculo `CG-EMB-<n>` (se a consulta 2 mostrar 1 candidato por produto); executar `migrate-prod.ts` no deploy antes de gravar o vínculo
    - Registrar no `design.md` o que foi gravado e conferir o Cartucho Composto no catálogo
    - _Requisitos: 2.6, 6.6, 6.9, 12.11_

- [x] 7. Checkpoint — commit e deploy do back
  - Back: tarefas 1 a 5 verdes e `get_diagnostics` limpo. Perguntar ao usuário se quer commit e deploy do back (schema e `migrate-prod.ts` no mesmo commit) e aguardar o Render antes de o front usar `tipoEmbalagemId`, `acabamentos/por-ids` e o catálogo corrigido. Ensure all tests pass, ask the user if questions arise.

- [x] 8. Front: funções puras e testes (sem React, rede ou banco)
  - [x] 8.1 `editor/sugestoes.ts`: sugestões de tipo, suporte, gramatura e preço
    - `sugerirTipoEmbalagem` (`APLICAR`, `AVISO_INATIVO` ou `NENHUM`), `sugerirSuporteGramatura`, `sugerirPrecoKg` (só com exatamente 1 candidato com preço maior que 0; `SEM_PAPEL` e `MAIS_DE_UM` viram aviso)
    - `aplicarTipoEmbalagem(form, tipo)`, o mesmo reinício de medidas da escolha manual do `StepTipo`, e `aplicarSugestoes(form, …)` idempotente
    - Campo vazio é `null`, `undefined` ou `''`; gramatura vazia inclui `0`; `NENHUM` para item puxado, item salvo ou item que não é novo
    - _Requisitos: 3.1, 3.2, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9, 3.10, 3.11, 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7_
  - [x] 8.2 `editor/validacao-obrigatorios.ts` e `editor/campos-livres-puro.ts`
    - `validarObrigatoriosParaSalvar(form)` devolve os nomes de Tipo de Embalagem, Gramatura (> 0) e Preço por kg (> 0) que faltam
    - `mesclarCamposLivres(cadastro, atuais)`: só SOLICITACAO e PEDIDO ativos, rótulos em ordem alfabética sem repetir, opções na ordem do cadastro com marca de padrão, obrigatórios; nunca adiciona par nem seleciona opção
    - `adicionarParCampoLivre(pares, par)`: rejeita o 21º par, rótulo acima de 50 e conteúdo acima de 500 caracteres, mantendo a lista
    - _Requisitos: 4.8, 5.1, 5.2, 5.3, 5.8, 5.9, 5.11, 5.13_
  - [x] 8.3 `editor/catalogo/passe-selecao-puro.ts`: resumo do passe de seleções
    - Tipos `ResultadoPasse`, `EstadoSelecao = 'PENDENTE' | 'GRAVADA' | 'NAO_GRAVADA'` e `resumirPasse(resultados)`: lista falhas com atividade e mensagem, indica se o recálculo pode rodar e quais seleções reenviar
    - _Requisitos: 10.1, 10.2, 10.4, 10.5, 10.6, 10.8_
  - [x] 8.4 Testes de unidade das funções puras
    - Cada função com ao menos um caso de entrada vazia e um de entrada preenchida; tipo inativo; preço com 0, 1 e 2 papéis; rótulos fora do cadastro preservados
    - Arquivos: `editor/sugestoes.test.ts`, `editor/validacao-obrigatorios.test.ts`, `editor/campos-livres-puro.test.ts`, `editor/catalogo/passe-selecao-puro.test.ts` (rodar com `--pool=threads`)
    - _Requisitos: 14.1_
  - [x] 8.5 Teste de propriedade: sugestão de tipo só em item novo e campo vazio
    - **Property 4: Sugestão de Tipo_Embalagem só ocorre em item novo e campo vazio**
    - **Validates: Requirements 3.1, 3.2, 3.4, 3.5, 3.6, 3.7, 3.8, 3.10**
  - [x] 8.6 Teste de propriedade: suporte e gramatura só preenchem vazios
    - **Property 5: Sugestão de suporte e gramatura só preenche vazios**
    - **Validates: Requirements 4.1, 4.2, 4.3, 4.7**
  - [x] 8.7 Teste de propriedade: preço por kg só vem de exatamente 1 papel com preço
    - **Property 6: Preço por kg só vem de exatamente 1 papel com preço**
    - **Validates: Requirements 4.4, 4.5**
  - [x] 8.8 Teste de propriedade: aplicar sugestões é idempotente
    - **Property 7: Aplicar sugestões é idempotente**
    - **Validates: Requirements 3.11, 4.6**
  - [x] 8.9 Teste de propriedade: sugerir o tipo equivale a escolhê-lo manualmente
    - **Property 8: Sugerir o tipo equivale a escolhê-lo manualmente**
    - **Validates: Requirements 3.9**
  - [x] 8.10 Teste de propriedade: validação prévia lista exatamente os campos faltantes
    - **Property 9: Validação prévia lista exatamente os campos faltantes**
    - **Validates: Requirements 4.8**
  - [x] 8.11 Teste de propriedade: mesclagem de rótulos e opções de campos livres
    - **Property 10: Mesclagem de rótulos e opções de campos livres**
    - **Validates: Requirements 5.1, 5.2, 5.3, 5.8, 5.9**
  - [x] 8.12 Teste de propriedade: campos livres preservam pares e respeitam limites
    - Inclui a verificação de que o payload de cálculo não contém `camposLivres`
    - **Property 11: Campos livres preservam pares e respeitam limites**
    - **Validates: Requirements 5.4, 5.5, 5.7, 5.11, 5.12, 5.13**

- [x] 9. Front: ProdutoModal com seletor "Tipo de Embalagem"
  - [x] 9.1 Seletor no formulário de produto
    - `cadastros/produtos/ProdutoModal.tsx`: `FormState` ganha `tipoEmbalagemId`; `Select` "Tipo de Embalagem" com `label`, `clearable` e `searchable`, alimentado por `GET /orcamento-grafico/tipos-embalagem` (ativos, por nome), pré-selecionado quando o produto tem vínculo
    - Tipo inativo já vinculado aparece com "(inativo)" e é preservado ao salvar sem alteração; não é oferecido a outros produtos
    - Limpar e salvar envia `null`; 422 mostra a `message` e mantém o formulário preenchido; indicador de carregamento, estado vazio e erro com nova tentativa
    - Tipo de produto com `tipoEmbalagemId` em `cadastros/_shared/cadastros-graficos.types.ts`; não enviar `empresaId`
    - _Requisitos: 1.1, 1.2, 1.4, 1.5, 1.6, 13.2, 13.3, 13.4, 13.6, 13.8, 13.9_
  - [ ]* 9.2 Testes de componente do ProdutoModal (Testing Library)
    - Vínculo ativo pré-selecionado, inativo marcado "(inativo)" e preservado, limpar envia `null`, 422 mantém o formulário
    - _Requisitos: 1.1, 1.4, 1.5, 1.6_

- [x] 10. Front: sugestões no EditorItem e validação prévia
  - [x] 10.1 Sugestões ao escolher o Produto Gráfico
    - `EditorItem` e `SecaoProduto`: busca o produto (`tipoEmbalagemId`), o catálogo (`planoFixo`, defaults) e `precos-mp` do tipo PAPEL; aplica `sugerirTipoEmbalagem`, `sugerirSuporteGramatura` e `sugerirPrecoKg` somente em item novo e campos vazios, chamando o mesmo manipulador da escolha manual do tipo
    - Marca `origemTipoEmbalagem = 'PRODUTO'` em estado local (fora do payload) para exibir "sugerido pelo produto"; troca ou limpeza do campo remove o texto; trocar o produto não altera o tipo já preenchido
    - Avisos discretos (`xs` ou `sm`, ícone e tooltip, sem modal): "tipo de embalagem do produto está inativo", "preço não encontrado", "mais de um papel encontrado"; falha de catálogo ou de preços exibe aviso e mantém vazios os campos dependentes
    - Item puxado e item salvo reaberto nunca recebem sugestão
    - _Requisitos: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9, 4.1, 4.2, 4.4, 4.5, 4.7, 4.10, 13.5_
  - [x] 10.2 Validação prévia ao salvar e erro 400 da API
    - O botão Salvar chama `validarObrigatoriosParaSalvar` antes de `salvarItem`; lista não vazia não envia, exibe "Faltam: …" e mantém o formulário
    - Resposta 400 por `tipoEmbalagemId`, `gramatura` ou `precoKg` mostra a `message` da API e mantém o editor aberto; sem `message`, mensagem genérica em português
    - _Requisitos: 4.8, 4.9, 13.6, 13.7_

- [x] 11. Front: `abrirEditorPagina` repassa todos os Campos_Tecnicos
  - [x] 11.1 Repassar e regravar os Campos_Tecnicos
    - `[id]/page.tsx` (`abrirEditorPagina`) e `itemFormShared.ts` (`itemParaForm`, `montarPayloadDadosTecnicos`): repassar `modeloFacaId`, `tintaModo`, `tintaConsumoKg`, `siglaAcabado`, `tributacao`, `processoImpressao`, `coberturaTintaTexto`, `fabricante`, `microondulado` e `materialMicroonduladoId`, `fornecido`, `arte`, `observacao` e `observacaoAreasOp`, medidas técnicas, `montagemLinhas`, `montagemColunas`, `formatoSup*`, `ajusteCorteMicroMm`, `acondicionamento` e `suporteProducaoId`
    - O payload envia o valor gravado, e `null` permanece `null`; o contrato do `PUT` do back NÃO muda; wizard `/novo` com o mesmo fluxo e payload
    - _Requisitos: 9.2, 9.3, 9.4, 9.5, 9.7_
  - [x] 11.2 Teste de propriedade de ida e volta do item
    - Item → formulário → payload com cada Campo_Tecnico estritamente igual ao do item, incluindo `null` (fast-check, mínimo 100 execuções)
    - **Property 18: Campos técnicos fazem ida e volta**
    - **Validates: Requirements 9.2, 9.4, 9.6, 14.2**
  - [x] 11.3 Teste de payload de referência
    - Formulário sem `produtoGraficoId` gera payload de salvar e de cálculo iguais aos de antes da fase
    - _Requisitos: 12.8, 9.7_

- [x] 12. Front: falha de seleção de material no primeiro salvamento
  - [x] 12.1 `useSelecaoMaterial`: resultado por atividade e timeout de 30 s
    - `aplicarPendentes(itemId, { timeoutMs: 30_000 })` com `AbortController` devolve `ResultadoPasse` (`gravadas` e `falhas` com chave `acabamentoId|planoId`, nome da atividade e mensagem da API ou "tempo esgotado")
    - Cada seleção ganha estado `PENDENTE`, `GRAVADA` ou `NAO_GRAVADA`; nova tentativa reenvia só as `NAO_GRAVADA`
    - Arquivo: `editor/catalogo/useSelecaoMaterial.ts`
    - _Requisitos: 10.1, 10.2, 10.5_
  - [x] 12.2 Componente `PainelSelecoesNaoGravadas`
    - Lista cada atividade afetada com a mensagem e o indicador "não gravada", botão "Tentar novamente" e permissão para trocar ou remover a escolha; só tokens adaptativos
    - Arquivo novo: `editor/catalogo/PainelSelecoesNaoGravadas.tsx`
    - _Requisitos: 10.2, 10.4, 13.1, 13.6_
  - [x] 12.3 `EditorItem`: `itemIdCriado`, retentativa e confirmação ao fechar
    - `itemIdCriado` definido logo após o `POST` do item e antes do passe; `isEditing = !!(item?.id ?? itemIdCriado)`, de modo que todo "Salvar" ou "Tentar novamente" seguinte faz `PUT` e nunca cria segundo item
    - Com alguma `NAO_GRAVADA`: editor aberto, formulário intacto e sem passe de recálculo; com todas gravadas: recálculo e fechamento como hoje
    - Fechar com `NAO_GRAVADA` pede confirmação ("o item foi salvo e N escolhas não foram gravadas"); Cancelar mantém aberto, Confirmar fecha sem excluir o item
    - Item sem seleções: fluxo, payload e fechamento idênticos aos atuais
    - _Requisitos: 10.1, 10.3, 10.4, 10.5, 10.6, 10.7, 10.8_
  - [x] 12.4 Teste de propriedade: passe com falha parcial e retentativa
    - **Property 19: Passe de seleções com falha parcial e retentativa**
    - **Validates: Requirements 10.1, 10.2, 10.4, 10.5, 10.6, 10.8**
  - [x] 12.5 Teste de propriedade: retentativas nunca criam item duplicado
    - **Property 20: Retentativas nunca criam item duplicado**
    - **Validates: Requirements 10.3**

- [x] 13. Front: `useTodosAcabamentos` e `acabamentosExternos` no StepAcabamentos
  - [x] 13.1 Hook `editor/useTodosAcabamentos.ts` e acúmulo puro de páginas
    - Pagina `GET /acabamentos` com `limit=100` em sequência até receber menos de 100 ou atingir `total`; com até 100 acabamentos faz exatamente 1 requisição e 0 buscas por id
    - Com produto escolhido, busca em lote por `GET /acabamentos/por-ids` (até 50 ids por requisição) as atividades do catálogo ausentes; deduplica por `id`
    - Falha de página ou de busca: aviso "a lista de acabamentos pode estar incompleta" com a `message` da API, "Tentar novamente", mantendo o carregado
    - _Requisitos: 11.1, 11.3, 11.4, 11.5, 11.6_
  - [x] 13.2 `StepAcabamentos` com prop opcional `acabamentosExternos` e uso no EditorItem
    - Quando a prop vem, o `useEffect` de carga própria é ignorado; o wizard `/novo` e o `ItemWizardModal` não recebem a prop (diff vazio nesses arquivos)
    - `EditorItem` usa o hook e repassa a lista
    - _Requisitos: 11.1, 11.7, 12.7_
  - [x] 13.3 Teste de propriedade: carga paginada traz todos os acabamentos uma vez
    - **Property 21: Carga paginada traz todos os acabamentos uma vez**
    - **Validates: Requirements 11.1, 11.5, 11.6**

- [x] 14. Front: seletor de material no modal de plano (cache compartilhado e pendentes por plano)
  - [x] 14.1 Funções puras de seleção por plano
    - `editor/catalogo/selecoes-por-plano-puro.ts`: `deveExibirSeletorNoPlano` (só atividade marcada com ao menos um material; nada sem produto) e `mesclarSelecoesPorPlano` (escolher, remover, desmarcar e salvar plano, chave `acabamentoId|planoId`, preservando `origem` e `selecaoId`)
    - _Requisitos: 8.1, 8.2, 8.4, 8.6, 8.11, 8.13_
  - [x] 14.2 Teste de propriedade: seletor do plano só onde cabe
    - **Property 16: Seletor de material do plano aparece só onde cabe**
    - **Validates: Requirements 8.1, 8.2, 8.12, 8.13**
  - [x] 14.3 Teste de propriedade: seleções de material por plano são preservadas
    - **Property 17: Seleções de material por plano são preservadas**
    - **Validates: Requirements 8.3, 8.4, 8.6, 8.11**
  - [x] 14.4 `PlanosDoItem`: seletor de material com cache compartilhado
    - Prop opcional `catalogoCompartilhado` (sem ela o componente cria o seu como hoje); cada atividade marcada com material no catálogo exibe `SeletorMaterialAtividade` com as mesmas regras de `tipoParam`, A_VERIFICAR e custo do Plano_Fixo
    - Plano sem `id` guarda a seleção como `PENDENTE` e grava com o `planoId` novo após o `POST`; no `PUT` grava após o sucesso; falha mantém o modal aberto com a atividade "não gravada" e sem plano duplicado; desmarcar ou remover chama `DELETE /selecao-material`
    - Erro 422 mostra os materiais permitidos e mantém a seleção anterior; item puxado grava com `aplicaNoPreco = false` e selo "informativo, não altera o preço"; falha do catálogo mostra aviso e oculta os seletores; sem produto, modal idêntico ao atual
    - _Requisitos: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7, 8.8, 8.9, 8.10, 8.12, 8.13, 8.14, 13.2, 13.4_
  - [x] 14.5 Sugestões do Tipo_Plano no modal de plano
    - `aplicarDefaultsEmPlano` usa `sugerirSuporteGramatura` e `sugerirPrecoKg`: preenche só suporte, gramatura e `precoKg` vazios do plano; aviso discreto quando o preço não é encontrado ou é ambíguo
    - _Requisitos: 4.3, 4.4, 4.5, 4.6_
  - [x] 14.6 `EditorItem` entrega `catalogoCompartilhado` ao `PlanosDoItem`
    - Uma única instância de `useCatalogoItem` por sessão do editor, com chave `produtoGraficoId + tipoPlanoId`
    - _Requisitos: 8.7_

- [x] 15. Front: campos livres com sugestão no StepItensDiversos
  - [x] 15.1 Hook `useCamposLivresSugestao`
    - Duas chamadas a `GET /cadastros/campos-livres` (`proprietario=SOLICITACAO` e `PEDIDO`, ativos, com `opcoes`), uma vez por sessão do Editor; falha devolve aviso legível com a `message` da API e não bloqueia o salvamento
    - _Requisitos: 5.1, 5.9, 5.10, 13.2, 13.4_
  - [x] 15.2 `StepItensDiversos` com props opcionais
    - Props `sugestoesRotulos`, `opcoesPorRotulo` e `obrigatorios`; rótulo e conteúdo viram `Autocomplete` com digitação livre; opção padrão só com o indicador "padrão", sem selecionar; ícone com tooltip "obrigatório" sem bloquear o salvamento; limite de 20 pares, 50 e 500 caracteres com mensagem legível
    - Sem as props (wizard) o componente se comporta como hoje
    - _Requisitos: 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8, 5.11, 5.13, 5.14, 12.7_
  - [x] 15.3 `EditorItem` liga o hook ao bloco de campos livres
    - Passa as props ao `StepItensDiversos`; `camposLivres` não entra no payload de cálculo e não muda `resultadoCalculo` nem o consolidado
    - _Requisitos: 5.1, 5.4, 5.12_
  - [ ]* 15.4 Testes de componente do bloco de campos livres
    - Rótulos sugeridos em ordem, opções LISTA com "padrão", digitação livre, aviso em falha de carga, limite de 20 pares
    - _Requisitos: 5.2, 5.3, 5.10, 5.13_

- [ ] 16. Front: revisão transversal
  - [x] 16.1 Revisão dos arquivos tocados
    - Tokens adaptativos do Mantine (sem hexadecimal, `white`, `black` nem nível `-0`); textos em português sem "Calcgraf", "G-Print" nem "GPrint"; nenhum texto sugere que Ajustes, Quebras ou Limites alteram preço, cálculo ou PCP
    - Estados de carregamento, vazio e erro nos seletores novos; `label` visível e uso só pelo teclado; nenhuma chamada nova envia `empresaId`
    - Wizard `/novo` e `ItemWizardModal` intactos; `get_diagnostics` em cada arquivo tocado do front, 0 erros
    - _Requisitos: 12.5, 12.6, 12.7, 13.1, 13.2, 13.3, 13.4, 13.5, 13.8, 13.9, 13.10, 14.6_
  - [ ]* 16.2 Teste automatizado de busca textual
    - Falha se strings exibidas dos arquivos tocados contiverem "Calcgraf", "G-Print" ou "GPrint"
    - _Requisitos: 12.5_

- [ ] 17. Documentação e checkpoint final
  - [x] 17.1 Seção 21 do `docs/orcamento-planos-calcgraf-HANDOFF.md`
    - Registrar decisões aprovadas, resultado das consultas da tarefa 6, o que foi gravado em produção, a tabela do Req 9.1 e pendências
    - _Requisitos: 6.1, 6.10, 9.1, 11.2_
  - [x] 17.2 Resumo no steering
    - Resumo curto da Fase 3 em `.kiro/steering/migracao-calcgraf-carton-wega.md`
    - _Requisitos: 12.1_
  - [ ] 17.3 Checkpoint final e conferência manual dos oito cenários
    - Suítes do back e do front verdes (`editor/` com `--pool=threads`), `decomposicao-stc` 14 de 14, `get_diagnostics` limpo
    - Lista com aprovado ou reprovado para: (a) item sem produto igual ao de antes; (b) produto com vínculo sugere o tipo e mantém o valor do usuário; (c) produto sem vínculo como hoje; (d) item puxado sem sugestão e 12992 = R$ 5.192,05 ao abrir, editar e salvar; (e) Cartucho Composto com "Caixa Padrão" e "Embalar" em "Acondicionamento"; (f) produto sem plano fixo grava material no modal de plano; (g) campo livre LISTA oferece opções e grava o par; (h) falha forçada de seleção mantém o editor aberto e "Tentar novamente" não cria segundo item
    - Perguntar ao usuário sobre commit e deploy do front. Ensure all tests pass, ask the user if questions arise.
    - _Requisitos: 14.5, 14.6, 14.8, 14.9_

## Notes

- Tarefas com `*` são testes extras não exigidos pelos requisitos; os testes de propriedade e de rota exigidos não são opcionais.
- As tarefas 6.1 a 6.3 são pontos de parada: nada roda em produção sem autorização explícita do usuário em cada passo.
- Back antes do front: o front só usa `tipoEmbalagemId`, `acabamentos/por-ids` e o catálogo corrigido depois do deploy do back (checkpoint 7).
- Cada propriedade do design tem um único teste com mínimo de 100 execuções.
- `ancorarCustoCalcgraf`, o motor, o wizard `/novo` e o contrato do `PUT` do item não mudam.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "2.1", "3.1", "8.1", "8.2", "8.3", "11.1", "13.1", "14.1", "15.1"] },
    { "id": 1, "tasks": ["1.2", "1.3", "2.2", "3.2", "4.1", "8.4", "8.5", "8.6", "8.7", "8.8", "8.9", "8.10", "8.11", "8.12", "11.2", "11.3", "12.1", "12.2", "13.3", "14.2", "14.3", "15.2"] },
    { "id": 2, "tasks": ["1.4", "3.3", "3.4", "4.2", "9.1", "10.1"] },
    { "id": 3, "tasks": ["3.5", "4.3", "9.2", "10.2", "14.4", "15.4"] },
    { "id": 4, "tasks": ["4.4", "12.3", "14.5"] },
    { "id": 5, "tasks": ["5.1", "5.2", "12.4", "12.5", "13.2"] },
    { "id": 6, "tasks": ["6.1", "14.6"] },
    { "id": 7, "tasks": ["6.2", "15.3"] },
    { "id": 8, "tasks": ["6.3", "16.1", "16.2"] },
    { "id": 9, "tasks": ["17.1", "17.2"] },
    { "id": 10, "tasks": ["17.3"] }
  ]
}
```
