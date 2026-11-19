# Implementation Plan: Orçamento Gráfico — paridade do fluxo legado

## Overview

Implementação em TypeScript, em dois repositórios separados:

- **Back:** `c:\Source\VisioFab.Wms.Back` (Fastify + Prisma, módulo `src/modules/orcamento-grafico/`).
- **Front:** `c:\Source\VisioFab.Wms.Front` (Next.js + Mantine, `src/app/(interna)/orcamento-grafico/`).

Ordem de entrega: **Fase 1** (back: schema, serviço de cópia, rotas; front: Telas 1–4), **Fase 2** (menu Cálculo Padrão, editar migrado gera cópia, Editor_Calculo por adaptador), **Fase 3** (Listagem de Cálculos e Pré-Cálculo em PDF), depois **Backfill do orçamento nº 3** (dry-run por padrão) e a verificação final.

Regras que valem para todas as tarefas:

- Não alterar `calcularOrcamentoGrafico` nem `ancorarCustoCalcgraf`. O `hierarquia/motor-guard.ts` deve continuar passando.
- Toda query Prisma filtra `empresaId` de forma explícita (nunca só `prismaScoped`).
- `schema.prisma` e `prisma/migrate-prod.ts` vão no mesmo commit, de forma idempotente.
- A cópia não chama o motor: custo, valor, margem, CM e CEV vêm da Foto.
- Front: sessão só via `authStorage`, cores só por tokens Mantine, sem nome fixo de produto ou linha no código, sem textos com o nome do sistema legado ou de seus fornecedores.
- Cada sub-tarefa de teste marcada com `*` é opcional. Os testes de regressão do cálculo 12992 e do Motor_Guard não são opcionais.
- Front e back têm commits separados. Os commits ficam com o usuário.

## Tasks

- [x] 1. Schema e migração de produção (Back)
  - [x] 1.1 Adicionar as colunas aditivas em `schema.prisma` e em `prisma/migrate-prod.ts` (mesmo commit)
    - `CalculoGrafico`: `origemCopiaId` (`origem_copia_id`, `String?`), `cancelado` (`Boolean @default(false)`), `statusAnterior` (`status_anterior`, `String? @db.VarChar(20)`), `@@index([empresaId, cancelado])`, `@@index([empresaId, origemCopiaId])`.
    - `ItemOrcamentoGrafico`: `calculoGraficoId` (`calculo_grafico_id`, `String?`). Conferir antes no schema se `tipoPlanoId` já existe no item; se não existir, adicionar como `String?` na mesma migração.
    - `migrate-prod.ts`: `ADD COLUMN IF NOT EXISTS` e `CREATE INDEX IF NOT EXISTS`, sem `ADD CONSTRAINT`. Todas as colunas nulas ou com `DEFAULT`, sem tocar `custoProducao`, `valorTotalConsolidado` nem `resultadoCalculo`.
    - Manter `@@unique([empresaId, numero])` de `CalculoGrafico`.
    - Rodar `npx prisma generate`.
    - _Requirements: 18.1, 18.2, 18.5, 18.6, 18.7_

  - [x]* 1.2 Escrever teste de fumaça da migração
    - Executar `migrate-prod.ts` duas vezes seguidas em banco de teste e confirmar que a segunda execução termina sem erro e sem duplicar nada.
    - Confirmar que inserir `(empresaId, numero)` repetido é rejeitado e que o mesmo `numero` em empresas diferentes é aceito.
    - Confirmar que os custos já gravados não mudam.
    - _Requirements: 18.3, 18.5, 18.6, 18.7_

- [x] 2. Funções puras do serviço de cópia (Back)
  - [x] 2.1 Criar `calculo-grafico/resolucao-catalogo.service.ts`
    - `resolverProdutoGrafico(calc, produtosAtivos)`: candidatos = `ProdutoGrafico` ativos da empresa com o mesmo `tipoEmbalagemId`; desempata pelo nome normalizado (sem acento, minúsculo) igual a `calc.produto`; resolvido só com exatamente 1 candidato.
    - `resolverTipoPlano(produto, defaults, tiposPlano)`: 1 candidato em `DefaultProdutoPlano` → ele; mais de 1 → filtra `TipoPlanoGrafico.fixo`; senão não resolvido.
    - Retornar `{ id: null, motivo: 'ZERO' | 'MULTIPLOS' }` quando não resolve. Sem nome de produto no código.
    - _Requirements: 6.1, 6.2, 6.3, 19.11_

  - [x]* 2.2 Escrever property test para a resolução de produto e tipo de plano
    - **Property 6: Resolução única de produto e tipo de plano**
    - Arquivo: `resolucao-catalogo.service.test.ts` (fast-check, mínimo de 100 iterações).
    - **Validates: Requirements 6.1, 6.2, 6.3**

  - [x] 2.3 Criar `calculo-grafico/projecao-foto.service.ts`
    - `projetarFoto(foto)` devolve `margemSelecionada`, `margemPerc`, `cmPerc`, `cevPerc` e `faltantes`.
    - Confirmar em `foto-rica.types.ts` os nomes exatos dos campos (faixa selecionada de `margens`, `valorContMarginal`/CM, `cev`).
    - Não arredondar. Campo ausente vira `null` e entra em `faltantes`.
    - _Requirements: 6.4, 6.5_

  - [x]* 2.4 Escrever property test para a projeção da Foto
    - **Property 7: Projeção da Foto sem alteração de valor**
    - Arquivo: `projecao-foto.service.test.ts`.
    - **Validates: Requirements 6.4, 6.5**

  - [x] 2.5 Criar `calculo-grafico/plano-base.service.ts` com a regra da sigla
    - `montarPlanoBase(calc, foto)`: nome "Base", suporte (nome e gramatura), formato de corte (largura x altura em mm), cores (nome e cobertura), cobertura de tinta, atividades de acabamento e custo do plano (R$ com 2 casas).
    - Campo ausente fica `null` ou lista vazia, sem default, sem zero e sem inferência.
    - `especificacao = { versao: 1, base: true, somenteExibicao: true, ... }`, `resultadoCalculo = null` e colunas `custo*` nulas.
    - `resolverSigla(siglas)`: devolve "(vários)" quando há mais de uma sigla distinta e a própria sigla quando há exatamente uma.
    - _Requirements: 4.9, 6.9, 6.10, 8.1, 8.2, 8.5_

  - [x]* 2.6 Escrever property test para a regra da sigla
    - **Property 9: Regra da sigla**
    - Arquivo: `plano-base.service.test.ts`.
    - **Validates: Requirements 4.9, 6.9, 6.10**

- [ ] 3. Servico_Copia (Back)
  - [x] 3.1 Criar `calculo-grafico/calculo-copia.service.ts` (núcleo transacional)
    - Interface `CopiarCalculoParams` / `CopiarCalculoResultado` / `AvisoCopia` conforme o design, com `ModoCopia = 'ITEM' | 'PADRAO' | 'EDICAO'`.
    - Uma única `prisma.$transaction`. Primeiro `SELECT pg_advisory_xact_lock(hashtext($empresaId))`, depois número = `max(numero) + 1` filtrado por `empresaId`. Em P2002 de `(empresaId, numero)`, repetir uma vez e depois devolver 409.
    - Guarda de empresa: `findUnique({ id })` só para separar 404 (não existe) de 403 (outra empresa), sem devolver campos da origem. Todo registro criado recebe o `empresaId` do cálculo de origem. Toda query filtra `empresaId`.
    - Reaproveitar `copiarCalculoParaItem` (sem mudar seu comportamento) como fonte da engenharia copiada. Gravar `origemCopiaId` no cálculo novo e, no modo `ITEM`, `calculoGraficoId` e `calculoGraficoOrigemId` no item.
    - Modo `PADRAO` cria um Calculo_Padrao novo sem item. Modo `EDICAO` cria cópia com status RASCUNHO e origem VIZOR.
    - Qualquer falha reverte tudo e não consome número.
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.7, 5.8, 5.9, 10.5, 10.6, 10.12, 11.1, 11.5, 11.6, 17.1, 17.3, 17.4_

  - [x] 3.2 Integrar resolução, Foto, STC, Plano_Base e validação de custo ao `Servico_Copia`
    - Chamar `resolucao-catalogo` e gravar `produtoGraficoId` e `tipoPlanoId`; não resolvido gera aviso `PRODUTO_NAO_RESOLVIDO` ou `TIPO_PLANO_NAO_RESOLVIDO`.
    - Chamar `projetarFoto` e gravar `margemSelecionada`, margem, CM e CEV; ausentes geram aviso `FOTO_SEM_CAMPOS`.
    - Chamar `aplicarDecomposicaoStc(resultado, custosCalcgraf)`; sem componentes gera aviso `DECOMPOSICAO_INDISPONIVEL` e mantém o custo total.
    - Gravar Modelos = 1, sigla via `resolverSigla` e série e data do cabeçalho do orçamento no item.
    - Gravar custo e valor do item iguais aos da Foto, sem invocar o motor. Se o custo do item divergir do custo da Foto, reverter tudo e devolver 422 `Divergência de custo na cópia`.
    - Gravar o Plano_Base por último, isolado por savepoint: se falhar, criar o item sem Plano_Base e devolver o aviso `PLANO_BASE_NAO_PREENCHIDO` com o valor ancorado intacto.
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 6.8, 6.9, 6.10, 6.11, 6.12, 6.13, 8.1, 8.5, 8.6, 9.6, 9.7_

  - [x] 3.3 Ignorar planos `somenteExibicao` na reconsolidação por `somaPlanos`
    - No trecho de `orcamento-grafico.routes.ts` que reconsolida o item pela soma dos planos (perto da linha 6509), filtrar planos com `especificacao.somenteExibicao === true`.
    - Conferir que a alteração fica fora de `calcularOrcamentoGrafico` e de `ancorarCustoCalcgraf` e que o `motor-guard` continua verde.
    - _Requirements: 8.2, 8.3, 9.1, 9.2_

  - [ ]* 3.4 Escrever property test para a numeração
    - **Property 1: Numeração por empresa é max+1 e sem repetição**
    - Arquivo: `calculo-copia.numeracao.test.ts`.
    - **Validates: Requirements 1.3, 1.10, 5.1, 5.3, 10.5**

  - [ ]* 3.5 Escrever property test para a fidelidade da cópia
    - **Property 2: A cópia é um cálculo novo e fiel**
    - Arquivo: `calculo-copia.fidelidade.test.ts`.
    - **Validates: Requirements 5.1, 5.2, 5.3, 10.6, 11.1, 11.5**

  - [ ]* 3.6 Escrever property test para a origem intacta
    - **Property 3: A origem permanece intacta**
    - Arquivo: `calculo-copia.origem-intacta.test.ts` (banco de teste). Cobre edição, salvamento e descarte da cópia.
    - **Validates: Requirements 5.6, 11.2, 20.2**

  - [ ]* 3.7 Escrever property test para a atomicidade
    - **Property 4: Atomicidade da criação**
    - Arquivo: `calculo-copia.atomicidade.test.ts`. Injetar falha em cada etapa (cálculo, item, Plano_Base de cópia) e conferir contagens e número não consumido.
    - **Validates: Requirements 5.4, 5.5, 6.13, 10.12, 11.6**

  - [ ]* 3.8 Escrever property test para a guarda de empresa
    - **Property 5: Guarda de empresa na cópia**
    - Arquivo: `calculo-copia.empresa.test.ts`. Cobre 403, 404 e `empresaId` da origem em todo registro criado.
    - **Validates: Requirements 5.7, 5.8, 17.3, 17.4, 20.5**

  - [ ]* 3.9 Estender o teste da Decomposição STC
    - **Property 8: Decomposição STC fecha com o custo**
    - Arquivo existente: `decomposicao-stc.service.test.ts`. `MD + CT + SE` difere do custo da Foto em no máximo R$ 0,01; sem componentes mantém o custo total.
    - **Validates: Requirements 6.6, 6.7**

  - [ ]* 3.10 Escrever property test para custo e valor iguais aos da Foto
    - **Property 10: Custo e valor do item são os da Foto**
    - Arquivo: `calculo-copia.custo-foto.test.ts`. Inclui divergência injetada (rollback + 422) e prova de que o motor não é chamado.
    - **Validates: Requirements 6.12, 9.6, 9.7, 20.3**

  - [ ]* 3.11 Estender o teste de ancoragem existente
    - **Property 11: Ancoragem preservada ao calcular e salvar**
    - Itens com `calculoGraficoOrigemId` válido mantêm o custo da origem (diferença R$ 0,00). Itens sem origem, ou com origem inexistente, usam o motor sem ancoragem e sem erro.
    - **Validates: Requirements 9.4, 9.5, 20.6**

  - [ ]* 3.12 Escrever property test para o Plano_Base
    - **Property 12: Plano_Base fiel, vazio onde falta, sem efeito no valor**
    - Arquivo: `plano-base.service.test.ts` (parte pura) e teste com banco: item com e sem Plano_Base têm o mesmo custo e valor após reconsolidar.
    - **Validates: Requirements 8.1, 8.2, 8.3, 8.4, 8.5**

  - [x] 3.13 Escrever o teste de regressão do cálculo 12992 e rodar o Motor_Guard
    - Puxar, editar e salvar o item e conferir custo R$ 5.192,05, valor R$ 15.084,04, Margem 47,62%, C.Marg. 55,01% e Valor Unitário 3,77101 nos três momentos, sem tolerância.
    - Rodar `hierarquia/motor-guard` e confirmar 0 falhas e que a quantidade de testes não diminuiu.
    - _Requirements: 7.5, 9.1, 9.2, 9.3, 20.4, 20.7_

- [ ] 4. Rotas do back da Fase 1
  - [-] 4.1 Criar `POST /orcamento-grafico/:id/itens/usar-calculo`
    - Chama o `Servico_Copia` no modo `ITEM`. Resposta 201 `{ itemId, calculoId, numeroCalculo, avisos }`; 403 outra empresa; 404 inexistente; 409 colisão persistente; 422 divergência de custo.
    - Manter `POST /orcamento-grafico/de-calculo` e `POST /:id/itens/de-calculo` como estão (compatibilidade).
    - Schema Zod com mensagens "campo: motivo".
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.7, 5.8, 17.2, 17.4_

  - [x] 4.2 Ajustar `POST /orcamento-grafico/:id/itens/:itemId/copiar` para criar também o cálculo próprio
    - Em `item-copia.service`, criar um `CalculoGrafico` novo por cópia do cálculo do item e vincular ao novo item, preservando o custo ancorado.
    - Falha em qualquer etapa desfaz tudo e mantém a grade inalterada.
    - _Requirements: 7.10, 7.11, 9.4_

  - [x] 4.3 Numeração do orçamento em `POST /orcamento-grafico/cabecalho`
    - Número = maior Nº da empresa e série + 1 (ou 1), dentro de transação com o mesmo advisory lock; série com 1 a 10 caracteres; `empresaId` sempre o da sessão.
    - Falha não deixa registro parcial.
    - _Requirements: 1.3, 1.5, 1.8, 1.9, 1.10_

  - [x] 4.4 Ampliar `GET /calculo-grafico` (busca do Seletor, Menu e Listagem)
    - Filtros: cliente (código e nome), `semCliente`, linha, produto, descrição, sigla, número do cálculo (valor exato) e `cancelado`. Texto por trecho, sem diferenciar caixa e acento; todos combinados com E.
    - Ordem por número decrescente; teto de 500 no Seletor com indicação de resultado limitado; paginação por `pageSize` (50 no Menu, 20 na Listagem) com total de registros.
    - Devolver a sigla como "(vários)" quando houver mais de uma distinta e a quantidade de cálculos.
    - Filtro `empresaId` explícito, inclusive para SUPER_ADMIN.
    - _Requirements: 4.3, 4.4, 4.5, 4.6, 4.7, 4.8, 4.9, 10.3, 10.9, 10.10, 14.2, 14.3, 14.4, 17.5, 17.6_

  - [x] 4.5 Garantir as rotas de apoio das Telas 1 e 2
    - Verificar se existem e, se faltar, criar: busca de clientes (código ou nome, máximo de 50, ordenada por nome, devolvendo a observação cadastrada) e listagem de `LinhaProduto` ativas da empresa em ordem alfabética.
    - Sempre com `empresaId` explícito.
    - _Requirements: 2.2, 2.3, 2.6, 2.7, 3.2, 3.3, 17.1_

  - [ ]* 4.6 Escrever property test para a busca de cálculos
    - **Property 13: Busca de cálculos (Seletor, Menu e Listagem)**
    - Arquivo: `busca-calculos.test.ts`. Inclui paginação de 50 e 20 sem repetir nem perder linhas.
    - **Validates: Requirements 4.3, 4.4, 4.5, 4.6, 4.7, 4.8, 10.2, 10.3, 10.9, 14.2, 14.4**

  - [ ]* 4.7 Escrever property test para o isolamento por empresa
    - **Property 14: Isolamento de consultas por empresa**
    - Arquivo: `busca-calculos.isolamento.test.ts`. Duas empresas com o mesmo número; leitura, busca e alteração por id da empresa A nunca tocam a B (404).
    - **Validates: Requirements 10.10, 10.11, 14.3, 17.1, 17.2, 17.5, 17.6**

  - [ ]* 4.8 Escrever testes de rota do `usar-calculo`
    - Casos: 201 com avisos, 403, 404, rollback sem cálculo órfão, dois "Usar" do mesmo padrão geram números distintos, orçamento em branco sem registros até salvar.
    - _Requirements: 1.2, 5.3, 5.5, 5.7, 5.8_

- [x] 5. Checkpoint — back da Fase 1
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 6. Front da Fase 1 (`c:\Source\VisioFab.Wms.Front`)
  - [x] 6.1 Criar `ClientePrincipalBusca.tsx` e `ObservacoesEmpresaModal.tsx`
    - Campos Código (até 20) e Nome (até 200) e botão "Pesquisar". Código e nome vazios mostram mensagem e não pesquisam; sem resultado mostra "nenhum cliente encontrado" e mantém o cliente anterior; erro mostra mensagem e permite nova tentativa.
    - Ao selecionar um cliente, preencher código e nome. Abrir o modal "Observações da Empresa" só se a observação tiver caractere não branco; texto completo com rolagem, botão "OK", modal bloqueando a tela. Texto sem menção ao sistema legado.
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 2.9, 2.10, 16.1_

  - [x] 6.2 Criar `DialogoLinhaProduto.tsx`
    - Título "Novo Item — Selecione a Linha de Produto", seleção única das linhas ativas em ordem alfabética, nomes exatamente como no cadastro, nenhuma pré-selecionada.
    - "Confirmar" desabilitado sem seleção, sem linhas ativas ou com falha de carga (timeout de 10 s); "Cancelar" sempre habilitado. Mensagens para sem linhas e para erro de carga.
    - "Confirmar" abre o seletor com a linha; "Cancelar" abre o seletor sem filtro de linha. Nenhum item é criado pelo diálogo.
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 16.1, 16.2_

  - [x] 6.3 Criar os componentes compartilhados de busca e o `SeletorCalculoPadrao`
    - `_calculo-padrao/FiltrosCalculo.tsx` e `_calculo-padrao/ColunasCalculo.tsx`, usados depois também pelo Menu e pela Listagem.
    - Filtros e limites conforme o requisito 4.1; "Sem cliente definido" desabilita código e nome; grade com Cliente, Linha, Produto, Descrição, Formato Final, Cód. Cálculo Acabado, Tiragem e Nº Cálculo; "Quantidade de cálculos: N"; mensagem "Nenhum cálculo encontrado"; aviso de resultado limitado a 500; erro de busca preserva filtros e grade anterior; "Usar" desabilitado sem seleção; "Sair" fecha sem efeito.
    - Transformar `[id]/BuscaCalculoModal.tsx` no `SeletorCalculoPadrao`; "Usar" chama `POST /:id/itens/usar-calculo`, exibe os avisos retornados e atualiza a grade.
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8, 4.9, 4.10, 4.11, 4.12, 4.13, 5.1, 5.2, 16.1, 16.2_

  - [x] 6.4 Orçamento em branco com rascunho em memória (`NovoOrcamentoModal.tsx` e tela do orçamento)
    - "Novo Orçamento" abre rascunho em memória: Série preenchida e editável (1 a 10 caracteres, comportamento atual mantido), Nº "auto" não editável, Data de hoje em America/Sao_Paulo, Cliente Principal vazio, grade com 0 linhas. Nenhuma chamada de API até salvar.
    - "Salvar" e "Incluir item" chamam `POST /cabecalho`; exibir o Nº atribuído no lugar de "auto"; "Incluir item" abre o `DialogoLinhaProduto` em até 2 s. Falha mantém o cabeçalho digitado, mostra erro e não abre o diálogo.
    - Sair sem salvar descarta o rascunho. Integrar `ClientePrincipalBusca`, `DialogoLinhaProduto` e `SeletorCalculoPadrao`.
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.9, 3.1_

  - [x] 6.5 Grade de itens, auto-seleção e `Painel_Dados_Item`
    - Grade com item (a partir de 1), Cálculo, Linha, Tipo, Tiragens (separador de milhar), Descrição e Status; atualiza em até 2 s após "Usar".
    - Ao passar de vazia para com itens, selecionar o de menor número com destaque visual.
    - Painel por hierarquia: plano único (Formato, Suporte, Cores, Acabamento, Itens Diversos) ou multi-plano (Especificações Gerais, Tipos de Plano, Acabamentos, Itens Diversos). Plano_Base exibido somente leitura. Decisão plano único × multi-plano vem do cadastro, sem nome de produto no código.
    - _Requirements: 7.1, 7.2, 7.3, 8.2, 19.11_

  - [x] 6.6 Fechamento e Comissões
    - Criar `fechamentoTotais.ts` e `formatacao.ts` (funções puras): Valor Total por tiragem somando todos os itens; Valor Unitário com 5 casas, Margem e C.Marg. com 2 casas, Valor Total em R$ com 2 casas.
    - Abas "Fechamento" e "Comissões" no nível do orçamento, visíveis mesmo sem item selecionado. Fechamento preenchido em até 2 s ao selecionar item.
    - _Requirements: 7.4, 7.5, 7.6, 7.7_

  - [x] 6.7 Ações da grade: "Incluir item", "Copiar", "Excluir" e duplo clique
    - "Incluir item" sempre habilitado; "Copiar" e "Excluir" desabilitados sem seleção.
    - "Copiar" chama `POST /:id/itens/:itemId/copiar`; novo item com número seguinte ao maior; erro mostra mensagem e mantém a grade.
    - "Excluir" pede confirmação, remove, recalcula o Fechamento e seleciona o menor item restante (ou limpa painel e Fechamento se a grade ficar vazia).
    - Duplo clique abre o editor de item atual do orçamento até o Editor_Calculo existir (Fase 2).
    - _Requirements: 7.8, 7.9, 7.10, 7.11, 7.12_

  - [x] 6.8 Troca de empresa e sessão nas telas novas
    - Token e empresa só por `authStorage`. Na troca de empresa: `queryClient.clear()`, limpar o rascunho em memória, recarregar listas e detalhes em até 2 s com o token novo, sem manter dados da empresa anterior.
    - Falha na recarga limpa a tela e mostra erro com "Tentar novamente". Duas abas com empresas diferentes não interferem entre si.
    - _Requirements: 16.4, 16.5, 16.6, 16.7, 16.8_

  - [ ]* 6.9 Escrever property test do Fechamento e da formatação
    - **Property 19: Totalizador do Fechamento e formatação**
    - Arquivos: `fechamentoTotais.test.ts` e `formatacao.test.ts` (padrão de `itemFormShared.roundtrip.test.ts`).
    - **Validates: Requirements 7.4, 7.6, 15.3, 15.4**

  - [ ]* 6.10 Escrever testes de exemplo das telas da Fase 1
    - Orçamento em branco: 0 chamadas de API até salvar, Nº "auto", data em America/Sao_Paulo.
    - Modal de observações: abre com texto não branco, não abre com vazio.
    - Diálogo de linha: sem linhas ativas, falha de carga, "Cancelar" abre o seletor sem filtro.
    - _Requirements: 1.1, 1.2, 2.6, 2.7, 3.5, 3.7, 3.8_

  - [x] 6.11 Estender os testes estáticos do front aos arquivos novos
    - Incluir os arquivos novos em `sem-cores-fixas.test.ts`, `sessao-sem-storage-direto.test.ts` e `texto-visivel-sem-marca-legada.test.ts`.
    - Adicionar verificação textual de ausência de nomes fixos de produto e linha nos arquivos da feature.
    - _Requirements: 16.1, 16.2, 16.4, 19.11_

  - [x] 6.12 Atualizar o QA E2E `tests/e2e-qa/test_03_orcamento_grafico.py` para o novo fluxo
    - Orçamento em branco → buscar cliente → Incluir item → linha → Seletor → Usar → conferir grade, painel e Fechamento.
    - _Requirements: 20.7_

- [x] 7. Checkpoint — Fase 1 completa
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 8. Back da Fase 2 (Cálculo Padrão)
  - [x] 8.1 Criar rotas e serviço de status do Cálculo Padrão
    - `calculo-status.service.ts` e rotas em `calculo-grafico.routes.ts`: `POST /calculo-grafico/:id/incluir` (Calculo_Padrao novo em branco, origem VIZOR, RASCUNHO), `POST /:id/copiar` (modo `PADRAO`), `POST /:id/editar`, `POST /:id/cancelar` e `POST /:id/reativar`.
    - `editar`: cria cópia (modo `EDICAO`) quando a origem é `MIGRADO_CALCGRAF` ou há custo ancorado; caso contrário devolve o próprio id sem copiar nem consumir número. Registrar a origem da cópia.
    - `cancelar` grava `statusAnterior`, `cancelado = true` e mantém o registro; `reativar` restaura o status e limpa a marcação.
    - 404 idêntico para inexistente e outra empresa; falha não consome número nem altera dados.
    - _Requirements: 10.4, 10.5, 10.6, 10.7, 10.8, 10.10, 10.11, 10.12, 11.1, 11.2, 11.3, 11.4, 11.5, 11.6, 17.2_

  - [ ]* 8.2 Escrever property tests do status e da decisão de edição
    - **Property 15: Cancelar e reativar é ida e volta; ações dependem do status**
    - **Property 16: Decisão de edição por origem**
    - Arquivo: `calculo-status.service.test.ts`.
    - **Validates: Requirements 10.4, 10.7, 10.8, 11.1, 11.4**

  - [ ]* 8.3 Escrever testes de rota do Cálculo Padrão
    - Casos: 404 entre empresas, atomicidade de incluir e copiar, número não consumido em falha, cópia de migrado devolve número novo e original intacto.
    - _Requirements: 10.11, 10.12, 11.2, 11.3, 11.6_

- [ ] 9. Front da Fase 2
  - [x] 9.1 Menu "Cálculo Padrão"
    - Renomear "Biblioteca de Cálculos" para "Cálculo Padrão" em Vendas → Orçamento no `ModuleSidebar` e remover o nome antigo de todo menu.
    - Página com os mesmos filtros e colunas do Seletor (reuso de `FiltrosCalculo` e `ColunasCalculo`), paginação de 50 e sem exigir cliente.
    - Ações "Incluir", "Editar", "Copiar" e "Cancelar" para não cancelados; "Reativar" e "Copiar" para cancelados. Mensagens para cálculo não encontrado e falha de gravação.
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.11, 10.12_

  - [x] 9.2 Criar `_calculo-padrao/camposDoProduto.ts`
    - Função pura que, dado o `ProdutoGrafico`, devolve campos visíveis e valores iniciais: plano fixo × multi-plano (`DefaultProdutoPlano` e `TipoPlanoGrafico.fixo`), `modoFormato`, `exibeRestricoes`, `exibeInformacoesComplementares`, `semImpressao`, `formatoPadraoLargura/Altura` e padrões de cores, processo, cobertura e atividades.
    - Sem comparar nome de produto ou de linha.
    - _Requirements: 12.7, 19.1, 19.2, 19.3, 19.4, 19.5, 19.6, 19.7, 19.11_

  - [~] 9.3 Criar `_calculo-padrao/adaptadorCalculo.ts`
    - Funções puras `calculoParaItemForm` e `itemFormParaCalculo`, reaproveitando `itemFormShared.ts`.
    - Repositório injetável (`salvar`, `carregarPlanos`, `salvarPlano`) apontando para `/calculo-grafico/:id/...`; quando aberto a partir de um item do orçamento, aponta para `item.calculoGraficoId` e nunca para o padrão de origem.
    - Validação: Tiragem inteira de 1 a 999.999.999, sigla até 60 caracteres, no máximo 20 planos, com erro por campo.
    - _Requirements: 12.1, 12.2, 12.8, 12.10_

  - [~] 9.4 Criar `_calculo-padrao/EditorCalculo.tsx`
    - Casca que reutiliza Item e Plano (`itens/[itemId]/_item/*`, `BlocoPlanoUnico`, TelaPlano) por meio do adaptador, sem criar telas novas de Item e Plano.
    - Cabeçalho: número (somente leitura), Linha (somente leitura), Tiragem e Sigla. Plano único com campos do plano na tela do item; multi-plano com grid (Nome, Suporte, Cores, Formato, Acabamento) e Incluir, Copiar, Excluir (com confirmação), Reordenar; Incluir e Copiar desabilitados com 20 planos. Plano_Base somente leitura.
    - Lista marcável de atividades e botões Itens Diversos, Itens Fornecidos, Campos Livres e Observação sem sair do editor.
    - Salvar mantém o custo ancorado (mesmo valor em 2 casas antes e depois); campos inválidos bloqueiam o salvamento com mensagem por campo; falha de rede mantém os dados digitados e informa que nada foi gravado. Modo consulta somente leitura para a Listagem (Fase 3).
    - _Requirements: 12.1, 12.2, 12.3, 12.4, 12.5, 12.6, 12.9, 12.10, 12.11, 8.2, 8.4_

  - [~] 9.5 Integrar o Editor_Calculo ao orçamento e ao Menu
    - Duplo clique no item abre o `EditorCalculo` sobre o cálculo do item (`item.calculoGraficoId`), substituindo o comportamento provisório da tarefa 6.7.
    - "Editar" no Menu chama `POST /:id/editar`; cópia de migrado ou ancorado mostra o número do cálculo novo e abre o editor em até 3 s; falha não abre o editor e informa que a cópia não foi criada.
    - _Requirements: 7.8, 11.1, 11.3, 11.4, 11.6, 12.8_

  - [~] 9.6 Troca de produto e erro de cadastro no editor
    - Reavaliar visibilidade e padrões em até 1 s, sem recarregar; se a troca ocultar campo já preenchido, pedir confirmação e manter produto e valor se o usuário cancelar.
    - Cadastro do produto inexistente, inativo ou com erro de rede: mensagem, bloqueio do salvamento e dados preservados.
    - _Requirements: 19.8, 19.9, 19.10_

  - [ ]* 9.7 Escrever property test do adaptador e da validação
    - **Property 17: Adaptador do Editor_Calculo e validação**
    - Arquivo: `adaptadorCalculo.test.ts`.
    - **Validates: Requirements 12.1, 12.2, 12.4, 12.10**

  - [ ]* 9.8 Escrever property test da visibilidade por cadastro
    - **Property 18: Visibilidade e padrões vêm do cadastro**
    - Arquivo: `camposDoProduto.test.ts`.
    - **Validates: Requirements 12.3, 12.7, 19.1, 19.2, 19.3, 19.4, 19.5, 19.6, 19.7, 19.8**

  - [~] 9.9 Estender os testes estáticos aos arquivos da Fase 2
    - Incluir `_calculo-padrao/*` e a página do Menu nos testes de cores fixas, sessão sem storage direto, texto sem marca legada e ausência de nomes fixos de produto.
    - _Requirements: 16.1, 16.2, 16.4, 19.11_

- [~] 10. Checkpoint — Fase 2 completa
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 11. Back da Fase 3
  - [x] 11.1 Criar `pre-calculo-pdf.service.ts` e `GET /calculo-grafico/:id/pre-calculo.pdf`
    - pdfkit, sem marca legada em texto, cabeçalho, rodapé, nomes de seção ou propriedades do arquivo (título, autor, assunto).
    - Seções Material Direto, Custo de Transformação, Custo de Produção e Margens, montadas da Foto e da Decomposição STC (fonte: `GET /calculo-grafico/:id/memoria-stc`). Valores com 2 casas, iguais aos da tela.
    - 404 para outra empresa ou inexistente, sem conteúdo do cálculo; sem Foto nem STC devolve "Cálculo sem memória de cálculo disponível" sem gerar arquivo; falha de geração devolve erro que permite tentar de novo. Geração em até 10 s. Token via query, como nos outros PDFs.
    - _Requirements: 15.2, 15.3, 15.4, 15.5, 15.6, 15.7, 17.2_

  - [ ]* 11.2 Escrever testes do PDF do Pré-Cálculo
    - Valores iguais aos da tela, ausência de marca legada nas propriedades do arquivo, 404 entre empresas, mensagem sem memória de cálculo, falha de geração sem alterar o cálculo.
    - _Requirements: 15.3, 15.4, 15.5, 15.6, 15.7_

- [ ] 12. Front da Fase 3
  - [~] 12.1 Criar `listagem-calculos/page.tsx`
    - Item de menu "Listagem de Cálculos" em Vendas → Orçamento, visível para quem tem acesso ao módulo.
    - Mesmos filtros e rótulos do Seletor (reuso de `FiltrosCalculo`), 20 por página com total e navegação, mensagem para nenhum resultado (mantém filtros) e para erro (mantém filtros e página anterior).
    - Clicar na linha abre o cálculo em modo de consulta (somente leitura); cálculo inexistente ou de outra empresa mostra mensagem e mantém filtros e página.
    - _Requirements: 14.1, 14.2, 14.4, 14.5, 14.6, 14.7, 14.8_

  - [~] 12.2 Criar `pre-calculo/page.tsx`
    - Item de menu "Emissão de Pré-Cálculo" em Vendas → Orçamento; ação "Emitir" abre ou baixa o PDF; mensagens para cálculo não encontrado, sem memória de cálculo e falha de emissão.
    - Incluir as páginas novas nos testes estáticos do front.
    - _Requirements: 15.1, 15.2, 15.5, 15.6, 15.7, 16.1, 16.2, 16.4_

- [~] 13. Checkpoint — Fase 3 completa
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 14. Backfill do orçamento nº 3 (Back)
  - [~] 14.1 Criar `scripts/backfill-orcamento-3.ts`
    - Parâmetros: `--empresa <id>` obrigatório e `--apply` para gravar; dry-run por padrão (exibe a quantidade de registros e, por campo, valor atual e valor novo; sai com código 0 sem gravar).
    - Connection string só por `DATABASE_URL_PROD`, nunca em arquivo versionado nem em log. Sem `--empresa` ou sem a variável: sair com código ≠ 0, com mensagem do parâmetro ausente, sem abrir conexão de escrita.
    - Reaproveitar `resolucao-catalogo`, `projecao-foto`, `plano-base` e `aplicarDecomposicaoStc`. Em uma transação: resolver `produtoGraficoId` e `tipoPlanoId`, copiar margem, CM e CEV da Foto, aplicar a Decomposição STC e preencher o Plano_Base, escrevendo só onde o campo difere (segunda execução altera 0 registros).
    - Reverter tudo e sair com código ≠ 0 (informando item e motivo) se a resolução falhar para algum item ou se o item do cálculo 12992 sair de R$ 5.192,05 / R$ 15.084,04. Toda query com `empresaId` explícito. Não executar contra produção sem autorização do usuário.
    - _Requirements: 13.1, 13.2, 13.3, 13.4, 13.5, 13.6, 13.7, 13.8, 13.9, 13.10, 13.11_

  - [ ]* 14.2 Escrever testes do backfill
    - Dry-run não grava; `--apply` duas vezes altera 0 registros na segunda; falha injetada reverte tudo e sai com código ≠ 0; ausência de `--empresa` ou da variável sai com código ≠ 0; o 12992 permanece em R$ 5.192,05 e R$ 15.084,04.
    - _Requirements: 13.2, 13.4, 13.6, 13.7, 13.10, 13.11_

- [~] 15. Checkpoint final
  - Rodar a suíte do módulo `orcamento-grafico` e o Motor_Guard no back, e `npm run test` no front, com 0 falhas.
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tarefas marcadas com `*` são opcionais e podem ser puladas para um MVP mais rápido.
- Cada tarefa cita os requisitos específicos para rastreabilidade.
- Os checkpoints validam cada fase antes da próxima.
- Property tests validam as 19 propriedades do design; testes de exemplo cobrem telas, bordas e o cálculo 12992.
- Antes de qualquer tela do orçamento, conferir o steering `orcamento-grafico-visao-front-calcgraf.md` (Orçamento → Item → Plano).
- Pontos a confirmar durante a implementação (listados no design): nomes dos campos de margem, CM e CEV em `foto-rica.types.ts`; existência de `tipoPlanoId` em `ItemOrcamentoGrafico`; ponto exato da reconsolidação por `somaPlanos`.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2", "2.1", "2.3", "2.5"] },
    { "id": 2, "tasks": ["2.2", "2.4", "2.6", "3.1", "4.4", "4.5"] },
    { "id": 3, "tasks": ["3.2", "3.3", "4.6", "6.1", "6.2", "6.3"] },
    { "id": 4, "tasks": ["3.4", "3.5", "3.6", "3.7", "3.8", "3.9", "3.10", "3.11", "3.12", "4.3", "4.7", "6.4"] },
    { "id": 5, "tasks": ["4.1", "6.5"] },
    { "id": 6, "tasks": ["4.2", "6.6"] },
    { "id": 7, "tasks": ["3.13", "4.8", "6.7", "8.1"] },
    { "id": 8, "tasks": ["6.8", "8.2", "8.3", "9.1", "9.2"] },
    { "id": 9, "tasks": ["6.9", "6.10", "6.11", "6.12", "9.3", "9.8"] },
    { "id": 10, "tasks": ["9.4", "9.7", "11.1", "12.1"] },
    { "id": 11, "tasks": ["9.5", "9.6", "11.2", "12.2", "14.1"] },
    { "id": 12, "tasks": ["9.9", "14.2"] }
  ]
}
```
