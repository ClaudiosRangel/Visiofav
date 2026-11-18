# Implementation Plan: Orçamento Gráfico — hierarquia Orçamento → Item → Plano

## Overview

Implementação em fases (0 a 4, mais o botão Propriedades/Preview) da reforma do front do Orçamento Gráfico, com apoio aditivo no back. Linguagem: **TypeScript** (Front Next.js 15 + Mantine 7; Back Fastify + Prisma + Zod). Testes: Vitest + fast-check.

Regras que valem para **todas** as tarefas:

- **Repositórios:** cada tarefa indica `[Back]` (`c:\Source\VisioFab.Wms.Back`) ou `[Front]` (`c:\Source\VisioFab.Wms.Front`, pasta `src\app\(interna)\orcamento-grafico\`). Tarefas com `[Back + Front]` tocam os dois repositórios.
- **Nenhuma tarefa altera** `calcularOrcamentoGrafico` nem `ancorarCustoCalcgraf` (R15.1). Nenhum campo novo entra no input do motor.
- **Nenhuma tarefa faz commit nem push** (R19.8). Os commits ficam com o usuário.
- **Wireframe antes de codar:** cada fase começa com a tarefa "confirmar wireframe da fase com o usuário". Sem confirmação explícita, nenhuma tarefa de código da fase começa (R19.7, R19.9).
- **Decisão antes de schema:** tarefas que tocam `schema.prisma` exigem `schema.prisma` + `prisma/migrate-prod.ts` idempotente **no mesmo commit** (steering `database-migrations`), rodando `npx tsx prisma/migrate-prod.ts` 2× sem erro, e só começam depois da tarefa "registrar decisão" correspondente (D1/D2/D3/G2/G3) ter sido concluída por escrito pelo usuário.
- **Fluxo existente intacto:** a cada fase, criar orçamento, puxar cálculo, editar item, calcular, salvar item, enviar proposta e aprovar (gerando Pedido de Venda) continuam funcionando com custo e preço iguais (R19.6, R19.10).
- Telas sem Marca_Legada nos textos visíveis, só tokens adaptativos do Mantine, sessão só via `@/lib/authStorage`, `empresaId` explícito em toda query nova no back (R16, R17, R18).
- Comandos de teste: Front `npx vitest run <arquivo> --pool=threads --maxWorkers=1`; Back `npx vitest run <arquivo> --reporter=dot`. Propriedades com `numRuns: 100` e comentário `Feature: orcamento-grafico-hierarquia-item-plano, Property N: <texto>`.

## Tasks

- [ ] 1. Fase 0 — Preparação (sem tela)
  - [x] 1.1 [Back] Gravar o baseline de custo de T1 a T5 ANTES de qualquer mudança
    - Criar `custo-baseline.fixture.ts` (em `src/modules/orcamento-grafico/hierarquia/`) com `custoProducao`, `precoVenda` e `valorTotal` por tiragem, mais `resultadoCalculo.custos.custoProducao`, de T1 (cálculo 12992), T2 (13296), T3 (11122), T4 (12540) e T5 (sintético multi-plano com 2+ `PlanoCalculoGrafico` e custo > 0)
    - Gerar os valores com o código atual, sem tocar nenhum arquivo de produção; conferir com os valores já validados (5.192,05; 357,14; 60.407,80; 9.236,32)
    - Classificar T2 a T4 por `TipoPlanoGrafico.fixo` e listar os produtos afetados pela regra de plano fixo (ponto P3); garantir ao menos 1 plano único e 1 multi-plano
    - Registrar a lista de P3 em `docs/` para o usuário confirmar
    - _Requirements: 15.8, 15.9_
  - [x] 1.2 [Front] Estender `texto-visivel-sem-marca-legada.test.ts` (existente, sem criar outro)
    - Regex passa a cobrir `calcgraf|calcograf|calcgraph|g[\s-]?print|phtech` após normalizar (minúsculas, sem acento, hífen e espaço tratados)
    - Informar caminho, linha e trecho de cada ocorrência; varrer `orcamento-grafico/` recursivamente; ignorar comentários e identificadores técnicos (`ancorarCustoCalcgraf`, `calculoGraficoOrigemId`)
    - Casos de fixture: "Calcograf", "PHTech", "G Print", "g-print", "CÁLCGRAF"
    - _Requirements: 17.1, 17.2, 17.3, 17.4_
  - [ ]* 1.3 [Front] Escrever property test do detector de marca legada
    - **Property 16: Texto visível sem marca legada**
    - **Validates: Requirements 17.1, 17.4**
  - [x] 1.4 [Front] Criar os testes estáticos `sem-cores-fixas.test.ts` e de sessão
    - Reprovar `#hex`, `rgb(`, `rgba(`, `white`, `black`, `dark-N`, `gray-N` em `style`, `bg`, `c`, `color`, `backgroundColor`, `borderColor`; aceitar `var(--mantine-color-*)`, `*-light`, `*-filled`, `*-light-color`
    - Teste estático que proíbe `localStorage`/`sessionStorage` diretos nas telas novas (somente `@/lib/authStorage`)
    - _Requirements: 18.1, 18.2, 16.7_
  - [ ]* 1.5 [Front] Escrever property test do detector de cores fixas
    - **Property 17: Sem cores fixas**
    - **Validates: Requirements 18.1, 18.2**
  - [x] 1.6 [Back] Extrair `ITEM_SELECT_HIDRATACAO` e `anexarAproveitamentoManual` para `src/modules/orcamento-grafico/hierarquia/item-select.ts`
    - Trocar apenas o `select` literal de itens do `GET /:id` em `orcamento-grafico.routes.ts` pela constante compartilhada, sem mudar contrato nem tocar motor/ancoragem
    - Manter o mapa "campo de engenharia → presente no select" que fará o teste de hidratação falhar se uma coluna de engenharia faltar
    - _Requirements: 20.2, 15.1_
  - [ ]* 1.7 [Back] Escrever property test de round-trip de item e plano
    - **Property 1: Round-trip de item e plano**
    - Cobrir `GET /:id` e a leitura do item, incluindo `aproveitamentoManual`, formato de corte e `papelId`; usar Prisma mock em memória ou transação revertida
    - **Validates: Requirements 20.1, 20.2, 20.5, 20.6, 14.5, 14.6**
  - [x] 1.8 [Back + Front] Criar `vetores-layout.json` compartilhado
    - Um arquivo em cada repositório com `entrada` e `saidaEsperada` (estrutura, campos de formato, campos do plano único, `restricoes`): 5 modos × `semImpressao` × `exibeRestricoes` × `exibeInformacoesComplementares`, modo ausente e desconhecido, padrão com um valor 0, flags G2 `true/false/null`
    - Teste de integridade que compara o hash dos dois arquivos
    - _Requirements: 20.3, 20.4, 7.9, 7.12_
  - [x] 1.9 [Back] Criar o teste de igualdade de custo (`custo-igualdade.test.ts`) e o guard de motor intacto
    - Protocolo por item T1 a T5: (a) abrir, (b) salvar sem alteração, (c) calcular, (d) gravar campos informativos, (e) copiar, (f) Fechamento; comparar em centavos inteiros com o baseline da tarefa 1.1
    - Em divergência, falhar informando item, passo, valor esperado e obtido
    - Guard que falha se o trecho de `calcularOrcamentoGrafico` ou `ancorarCustoCalcgraf` mudar (hash ou `git diff --stat`)
    - Registrar como medição, sem exigir igualdade, o resultado de "gravar plano em item ancorado" (R-ANC)
    - _Requirements: 15.1, 15.2, 15.7, 15.8, 15.9_
  - [x] 1.10 [Back] Criar `fluxo-existente.test.ts` (integração)
    - Criar orçamento, puxar cálculo, editar item, calcular, salvar item, enviar proposta, aprovar e gerar Pedido de Venda
    - Servir de base para os checkpoints de todas as fases
    - _Requirements: 19.6, 19.10_

- [x] 2. Checkpoint — Fase 0
  - Rodar os testes novos (marca legada, cores fixas, hidratação, vetores, igualdade de custo, fluxo existente) e `get_diagnostics` nos arquivos tocados
  - Conferir o fluxo existente (criar/puxar/editar/calcular/salvar/enviar/aprovar) e a igualdade de custo T1 a T5 com diferença 0,00
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 3. Fase 1 — Tela_Orcamento (itens-resumo, dados-item, fechamento-totalizador, comissões, copiar item, GridItens, PainelDadosItem, AbaFechamento, AbaComissoes, rota ponte)
  - [x] 3.1 [Back + Front] Confirmar o wireframe da Fase 1 com o usuário antes de codar
    - Apresentar em texto a Tela 1 a partir de `docs/orcamento-grafico-wireframe-hierarquia.md` e aguardar confirmação explícita
    - Resultado: confirmado pelo usuário em 17/11/2026. Tela 1 aprovada; P1 mantido (recorte da Fase 1: R1.1, R1.2, R1.6, R1.9 aqui; R1.3/1.4/1.5/1.7/1.8 nas Fases 2 e 3); P2 alterado (sem upload da faca; Preview da Ficha Master no orçamento, R21); P6 confirmado (fonte das comissões)
    - _Requirements: 19.1, 19.7, 19.9_
  - [x] 3.2 [Back] Criar o módulo `src/modules/orcamento-grafico/hierarquia/` com `hierarquia.routes.ts` e a rota `GET /:id/itens-resumo`
    - Registrar em `server.ts` com prefixo `/api/orcamento-grafico`; `authenticate` e `empresaId` explícito em todo `where`
    - DTO `ItemResumoDTO` sem `resultadoCalculo` (calculo = `numeroCalcgraf ?? numero`, `tiragens`, status já rotulado, `temCalculo`); ordenar por sequência crescente
    - 404 idêntico para id inexistente e de outra empresa, sem eco de campos
    - _Requirements: 2.3, 2.4, 16.1, 16.3, 16.6_
  - [x] 3.3 [Back] Implementar `dados-item.service.ts` e `GET /:id/itens/:itemId/dados-item`
    - `estrutura` pela regra `some(fixo)` validada contra `vetores-layout.json`; `planosPersistidos`; seções do Painel (multi-plano: 4 seções, uma linha por plano; plano único: 5 seções)
    - Linhas vazias para seção sem dado (o front mostra "Sem informação cadastrada.")
    - _Requirements: 3.2, 3.3, 3.5, 16.1, 16.3_
  - [x] 3.4 [Back] Implementar `fechamento-totalizador.service.ts` com a função pura `agregarFechamento` e `GET /:id/fechamento-totalizador`
    - Uma linha por tiragem distinta em ordem crescente; item "com custo" ⇔ `custoProducao` e `valorTotal` não nulos; demais em `itensSemCalculo`, fora de todas as linhas
    - Margem ponderada pelo preço, CM% lida de `resultado_calculo->>'contribuicaoMarginalValor'` por SQL parametrizado, `null` se algum item da linha não tem CM
    - Somente leitura do persistido: não chamar o motor nem `ancorarCustoCalcgraf`
    - _Requirements: 4.2, 4.3, 4.5, 4.6, 4.9, 16.6_
  - [ ]* 3.5 [Back] Escrever property test da soma do Fechamento
    - **Property 5: Soma do Fechamento por tiragem**
    - **Validates: Requirements 4.2, 4.3, 4.5, 4.6**
  - [ ]* 3.6 [Back] Escrever property test de "Fechamento é pura leitura"
    - **Property 6: Fechamento é pura leitura**
    - Mock do motor sem chamadas; colunas de itens e planos inalteradas; chamadas repetidas iguais
    - **Validates: Requirements 4.9**
  - [x] 3.7 [Back] Implementar `comissoes.service.ts` e `GET /:id/comissoes`
    - Fonte CONFIRMADA (P6, 17/11/2026): `Vendedor.comissao` × `valorTotalConsolidado`, 2 casas, calculado no back; sem vendedor ou percentual: `linhas: []`
    - Incluir teste de comissões: caso com vendedor e percentual, caso sem vendedor/percentual (`linhas: []`) e caso em que o vendedor é de outra empresa (não é lido; `empresaId` explícito)
    - _Requirements: 5.2, 5.3, 5.5, 5.6, 16.1_
  - [x] 3.8 [Back] Implementar `item-copia.service.ts`, `POST /:id/itens/:itemId/copiar` e `GET /:id/itens/:itemId`
    - Copiar em `$transaction`: novo item com `sequencia = max+1`, todas as colunas persistidas (inclusive `resultadoCalculo`, `custoProducao`, `valorTotal`, `margemSelecionada`, `calculoGraficoOrigemId`), `aproveitamento_manual` por SQL raw, planos com ids novos, `SelecaoMaterial` e `materiaisAcabamento` reescritos, cabeçalho reconsolidado com `consolidarOrcamento`; sem chamar o motor
    - `GET .../itens/:itemId` usa `ITEM_SELECT_HIDRATACAO`
    - Reverter tudo em falha; repetir a leitura do máximo uma vez em colisão P2002
    - _Requirements: 2.8, 2.10, 16.1, 16.5, 20.2_
  - [ ]* 3.9 [Back] Escrever property test de cópia de item
    - **Property 7: Cópia preserva valores e custo**
    - **Validates: Requirements 2.8, 9.5**
  - [x] 3.10 [Back] Escrever os testes unitários das rotas da Fase 1 (`hierarquia.routes.test.ts`, `fechamento-totalizador.service.test.ts`, `item-copia.service.test.ts`, `dados-item.service.test.ts`)
    - 200 do próprio, 404 idêntico (inexistente × outra empresa) inclusive com SUPER_ADMIN, listagens só da empresa da sessão
    - Fechamento: 1 item, 2 itens com tiragem igual, tiragens diferentes, item sem cálculo, nenhum item com cálculo, CM ausente
    - Cópia sem chamada ao motor; `sequencia = max+1`; `aproveitamento_manual` copiado
    - _Requirements: 4.5, 4.6, 16.3, 16.4, 16.6_
  - [ ]* 3.11 [Back] Escrever property test de isolamento por empresa (rotas da Fase 1)
    - **Property 13: Isolamento por empresa**
    - **Validates: Requirements 1.9, 16.1, 16.2, 16.3, 16.4, 16.6**
  - [x] 3.12 [Front] Criar os hooks `_hooks/useOrcamentoHierarquia`, `useFechamentoTotalizador`, `useComissoes` e `useDadosItem`
    - Padrão `useState/useEffect` + `api` devolvendo `{ dados, carregando, erro, recarregar }`
    - `useFechamentoTotalizador` mantém o último valor bom em erro e reexecuta em até 2 s após `notificarAlteracaoItem()`
    - `useComissoes` com `timeout: 10000`, separando `vazio` de `erro`
    - `useDadosItem` descarta respostas de seleções antigas (AbortController + contador) e limpa os dados em erro
    - _Requirements: 3.4, 3.7, 4.4, 4.7, 5.4, 5.7_
  - [x] 3.13 [Front] Criar `_orcamento/CabecalhoOrcamento` e `_orcamento/GridItens`
    - Cabeçalho: Série, Número, Data dd/mm/aaaa, Cliente Principal (código, nome, busca), checkbox "Reforma Tributária 2027"; edição pelo `EditarCabecalhoModal` existente
    - Grid: colunas item, Cálculo, Linha de Produto, Tipo de Produto, Tiragens (milhar, " / "), Descrição, Status; ações Incluir/Abrir/Copiar/Excluir habilitadas conforme seleção; duplo clique abre; confirmação Confirmar/Cancelar na exclusão; estado vazio; erro mantendo a lista; menu "Mais ações" com Relatório do item, Encaixe e Emitir OP (sem upload de imagem como ação de linha; o botão "Preview" fica fora do grid, tarefa 3.21)
    - Seguir `.kiro/specs/padronizacao-grids/requirements.md`; `router.push` com prefetch da rota do item
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 2.9, 2.10, 2.11, 2.12, 1.6_
  - [x] 3.14 [Front] Criar `_orcamento/PainelDadosItem`
    - Somente leitura; seções por estrutura; "Sem informação cadastrada." por seção vazia; mensagem sem seleção; erro com "Tentar novamente" e sem dados do item anterior
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7_
  - [x] 3.15 [Front] Criar `_orcamento/AbaFechamento`
    - Colunas Tiragem, Margem, C.Marg. (2 casas), Valor Unitário, Valor Total (R$, milhar, vírgula); lista e aviso dos itens sem cálculo; mensagem sem valores; erro mantendo valores com aviso e "Tentar novamente"
    - Manter em seção recolhida "Detalhe do fechamento" o `FechamentoOrcamento` atual (sub-abas e `PUT /:id/fechamento`)
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8_
  - [x] 3.16 [Front] Criar `_orcamento/AbaComissoes`
    - Uma linha por comissão com valores exatamente como vieram; indicador de carregamento até 10 s; vazio e erro distintos; "Tentar novamente"; nenhum cálculo no front
    - _Requirements: 5.2, 5.3, 5.4, 5.5, 5.6, 5.7_
  - [x] 3.17 [Front] Criar `_orcamento/AcoesOrcamento` movendo (sem mudar chamadas) proposta PDF/e-mail, enviar, aprovar, recusar, copiar versão, reaproveitar, amostras e conversão de `[id]/page.tsx`
    - _Requirements: 19.6_
  - [x] 3.18 [Front] Remontar `[id]/page.tsx` como Tela_Orcamento
    - Título "Orçamento {número}", cabeçalho, GridItens, PainelDadosItem, abas Fechamento e Comissões lado a lado (`keepMounted`, sem rolagem horizontal), `AcoesOrcamento`
    - Remover da tela `PlanosDoItemComCatalogo` expandido, `BreakdownBar` e detalhe por item (a remoção de `ProdutoEspecificacao` é a tarefa 3.22); guarda de 404 com `router.replace('/orcamento-grafico')` e "Registro não encontrado."; `notificarAlteracaoItem` ligado ao retorno da tela do item
    - _Requirements: 1.1, 1.2, 1.9, 5.1, 5.8_
  - [x] 3.19 [Front] Criar a rota ponte `itens/[itemId]/page.tsx`
    - Carrega `GET /:id/itens/:itemId` e hospeda o `EditorItem` atual dentro da página (antes modal); comentário `@deprecated ponte até a Fase 2`; 404 volta à origem com "Registro não encontrado."; nenhum comportamento de cálculo muda; título "Item — {produto}"
    - _Requirements: 1.6, 1.9, 19.6_
  - [ ]* 3.20 [Front] Escrever testes de componente da Fase 1
    - Título e migalhas, GridItens (vazio, habilitação, formato de tiragens), Painel (seções, vazio, erro), abas (estado preservado), Fechamento (aviso de itens sem cálculo), Comissões (vazio × erro)
    - _Requirements: 1.1, 2.3, 2.7, 3.5, 3.7, 4.5, 5.7, 5.8_
  - [x] 3.21 [Front] Criar `_orcamento/PreviewFichaMaster` e o hook `useFichaMaster(id, aberto)`
    - Botão "Preview" (ícone `IconPhoto`) no cabeçalho ou na barra de ações da Tela_Orcamento, habilitado em todo orçamento aberto e fora do Grid_Itens (não é ação de linha); abre um `Drawer` somente leitura, sem rota própria e sem depender da linha selecionada
    - Reutilizar a rota existente `GET /:id/ficha-master` e o `editor/PainelPreview.tsx`; exibir imagem de corte, arte aprovada mais recente, dados gráficos (cartão, gramatura, nº de cores, cores, acabamentos, matriz) e a origem (`PRODUTO`, `RASCUNHO`, `ORCAMENTO`, `VAZIO`)
    - Hook: só chama a rota quando `aberto` é verdadeiro, com `AbortController` e descarte de resposta antiga; arte por anexo via `${API_BASE}${arteUrl}?token=` com `getAuthToken` de `@/lib/authStorage` (sem `localStorage` direto)
    - Estado vazio (produto sem Ficha Master nem arte; mensagem informa que a Pré-Impressão cadastra) distinto do estado de erro (com "Tentar novamente"); em ambos o botão segue habilitado e a Tela_Orcamento segue utilizável
    - Sem upload, sem edição, sem gravação, sem recálculo e sem chamada ao motor; só tokens Mantine e texto sem marca legada
    - _Requirements: 21.1, 21.2, 21.3, 21.4, 21.5, 21.6, 17.1, 18.1_
  - [x] 3.22 [Front] Remover `ProdutoEspecificacao` (upload da imagem da faca) da Tela_Orcamento
    - Retirar o componente e seu uso em `[id]/page.tsx`; conferir por busca que nenhuma tela do orçamento o monta como ação de linha nem como bloco do item
    - Manter `PATCH /:id/imagem-faca` no back, sem uso na tela
    - _Requirements: 21.8, 1.2_
  - [x] 3.23 [Back] Escrever o teste de isolamento da rota `GET /:id/ficha-master` (`ficha-master.isolamento.test.ts`), sem alterar a rota
    - 404 com mensagem idêntica para orçamento inexistente e de outra empresa, inclusive com SUPER_ADMIN, sem eco de campos nem imagem no corpo
    - Ficha (`FichaGraficaProduto`), arte (`ArteRevisaoProduto`), pedido-proposta e anexo de outra empresa não vazam; só arte `APROVADA` é devolvida; origens `PRODUTO`, `RASCUNHO`, `ORCAMENTO` e `VAZIO` cobertas
    - Se o teste revelar consulta sem `empresaId` explícito, parar e informar o usuário antes de alterar a rota
    - **Property 13: Isolamento por empresa**
    - **Validates: Requirements 21.7, 16.3**
  - [ ]* 3.24 [Front] Escrever testes de componente do `PreviewFichaMaster`
    - Botão fora do Grid_Itens e habilitado; drawer abre sem chamar a rota antes do clique; estado vazio × erro distintos com "Tentar novamente"; somente leitura (sem upload nem edição); nenhuma gravação nem chamada ao motor; `ProdutoEspecificacao` ausente da Tela_Orcamento
    - _Requirements: 21.1, 21.2, 21.4, 21.5, 21.6, 21.8_

- [x] 4. Checkpoint — Fase 1
  - Rodar os testes da fase (back e front), incluindo o isolamento da ficha-master (3.23), os testes de comissões (3.7) e o teste do Preview (3.24), marca legada, cores fixas, igualdade de custo T1 a T5 (P-11) e isolamento (P-13); rodar `get_diagnostics` nos arquivos tocados
  - Conferir o fluxo existente (criar/puxar/editar/calcular/salvar/enviar/aprovar), que o Fechamento soma o persistido dos itens e que o Preview da Ficha Master (R21) abre somente leitura, sem upload da faca na Tela_Orcamento
  - Informar ao usuário qual critério de R1 fica para as Fases 2 e 3 (P1) e quais ações do fluxo, se alguma, falharam
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 5. Fase 2 — Tela_Item dirigida pelo cadastro, plano único, restrições e materiais (remoção do EditorItem só no fim)
  - [x] 5.1 [Back + Front] Confirmar o wireframe da Fase 2 (Tela 2) com o usuário antes de codar
    - Apresentar em texto Tela_Item (plano único e multi-plano) e os campos de formato por `modoFormato`; aguardar confirmação explícita
    - _Requirements: 19.2, 19.7, 19.9_
  - [x] 5.2 [Back + Front] Registrar por escrito a decisão D3 (e G1, G2, G4, P4, P5) antes de mexer em schema
    - D3: colunas novas em `ItemOrcamentoGrafico` (recomendada) ou chaves em `medidas` (prefixo `fmt_`); G2: flags `possuiAlturaTampa`, `prevCapaExterna`, `prevMicroondulado`, `prevCapaInterna`, `prevFibra`; G1: tiragens 1 a 10 ou 1 valor; G4: bloco "Margem do item"; P4: campos de `SANFONA_ABAS` e `PAGINA`; P5: faixas do ajuste micro
    - Sem D3/G2 registradas, não executar a tarefa 5.3; Altura da Tampa e formato fechado/aberto/final ficam fora
    - P3 confirmado em 17/11/2026 (R8.4): plano único só se algum `TipoPlanoGrafico` permitido é `fixo`. Ação pendente do usuário: se quiser preservar "Invólucros" (`CG-PROD-6`) como plano único, marcar o tipo "Invólucros" como `fixo` no cadastro ANTES de iniciar a Fase 2 (sem isso, `CG-PROD-6` abre como multi-plano)
    - P7 (aberto): T1 (cálculo 12992) está ligado a `CG-PROD-11` Impressos (multi-plano pela R8.4) e a foto tem 1 plano. O usuário decide entre (a) T1 abre como multi-plano com 1 plano ou (b) revincular ao `CG-PROD-7` Impressos (aberto/fechado, `LÂMINA SIMPLES` fixo). Decisão é pré-requisito da tarefa 5.20; o baseline de custo de T1 não depende dela
    - _Requirements: 14.2, 7.1, 7.2, 7.3, 7.4, 8.4_
  - [x] 5.3 [Back] Aplicar schema D3 + G2 conforme a decisão registrada (só após 5.2)
    - Alterar `prisma/schema.prisma` e `prisma/migrate-prod.ts` NO MESMO COMMIT, usando apenas `ADD COLUMN IF NOT EXISTS` (sem `DROP`, `RENAME` ou `SET NOT NULL`); conferir `@map` reais
    - Rodar `npx prisma generate` e `npx tsx prisma/migrate-prod.ts` duas vezes seguidas sem erro; nenhuma coluna nova lida pelo motor
    - Não commitar
    - _Requirements: 14.2, 14.3, 14.4, 14.5, 14.6_
  - [x] 5.4 [Back] Expor os campos novos nas leituras e gravações existentes (aditivo)
    - Incluir as colunas D3 em `ITEM_SELECT_HIDRATACAO`; aceitar os campos nos schemas Zod de item; devolver `null` quando sem valor; expor as flags G2 nos cadastros de Produto Gráfico e Tipo de Plano
    - Não alterar o motor nem a ancoragem; gravar `medidas` sempre com as duas convenções `{L, A, P, largura, altura}`
    - Re-rodar o teste de round-trip e o de igualdade de custo
    - _Requirements: 14.4, 14.5, 14.6, 14.7, 20.1, 20.2, 20.5_
  - [x] 5.5 [Back] Criar `GET /cadastros/catalogo/atividade/:id` (restrições e materiais com `tipoParam`)
    - Para atividade fora do catálogo do plano; `empresaId` explícito; 404 idêntico para inexistente e de outra empresa
    - _Requirements: 11.1, 11.2, 11.4, 16.1, 16.3_
  - [x] 5.6 [Front] Implementar `_layout/resolver-layout-item.ts` (função pura) com `resolverBlocosPlano` e `resolverPadroesIniciais`
    - Entrada sem `nome` nem `codigo`; listas em ordem canônica; tri-estado G2 (`null` = mostrar); `SANFONA_ABAS`/`PAGINA` com `formatoPendenteDeWireframe` até P4; reusar `aplicarDefaultsEmVazios` e `aplicarDefaultsEmPlano` de `catalogo-puro.ts`
    - Teste unitário `resolver-layout-item.test.ts` lendo `vetores-layout.json`
    - _Requirements: 1.7, 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7, 7.9, 7.10, 7.12, 8.4, 8.5, 20.3, 20.4_
  - [ ]* 5.7 [Front] Escrever property test de idempotência do layout
    - **Property 2: Idempotência da resolução de layout**
    - **Validates: Requirements 20.3, 1.3, 1.7, 8.4**
  - [ ]* 5.8 [Front] Escrever property test de independência de nome
    - **Property 3: Independência de nome no layout**
    - **Validates: Requirements 7.9, 20.4**
  - [ ]* 5.9 [Front] Escrever property test de campos exibidos e ocultos
    - **Property 4: Campos exibidos e ocultos nunca gravados**
    - **Validates: Requirements 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7, 7.8, 7.12, 8.5**
  - [x] 5.10 [Front] Implementar `_validacao/validar-faixa.ts` e `parseCores`
    - Trabalhar sobre a string digitada (vírgula ou ponto) sem aritmética de ponto flutuante para contar casas; presets `DIMENSAO_MM`, `AJUSTE_MICRO_ITEM`, `AJUSTE_MICRO_PLANO`, `PARAM_MATERIAL`, `COBERTURA_PERC`, `TIRAGEM` e os de NC
    - Teste unitário `validar-faixa.test.ts` com limites exatos (0, 0,01, 99.999,99, 100.000,00), 3 casas, vazio, texto, `-0`
    - _Requirements: 7.11, 8.9, 10.2, 10.3, 10.5, 11.5, 11.6_
  - [ ]* 5.11 [Front] Escrever property test dos validadores de faixa
    - **Property 14: Validadores de faixa**
    - **Validates: Requirements 7.11, 8.9, 10.2, 10.3, 10.5, 11.5, 11.6, 12.5, 12.6**
  - [x] 5.12 [Front] Implementar `_layout/reaplicar-layout.ts` e `camposParaGravar`
    - Ao trocar o produto: manter valores dos campos que continuam visíveis, preencher formato padrão só em campo de formato vazio, devolver `{ form, ocultos }`; `camposParaGravar` descarta os ocultos antes do payload
    - Teste unitário cobrindo troca de produto em até 500 ms (cálculo síncrono)
    - _Requirements: 7.5, 7.8_
  - [x] 5.13 [Front] Criar os hooks `useLayoutItem` e `useRestricoesMateriais`
    - `useLayoutItem(produtoGraficoId)` usa `catalogoApi.produto` e `resolverLayoutItem`, memoizado por atributos; `useRestricoesMateriais` usa o catálogo do plano ou `GET /cadastros/catalogo/atividade/:id`, com cache por atividade e "Tentar novamente"
    - _Requirements: 7.8, 11.2, 11.3_
  - [x] 5.14 [Front] Criar `itens/[itemId]/_item/BlocoComum` e `BlocoFormato`
    - BlocoComum: Produto (somente leitura, vira título), Tipo de Produto, Descrição (≤200), Sigla Acabado (≤60, com busca), Tributação, Tiragens, Modelos (1 a 999, padrão 1)
    - BlocoFormato: campos de `layout.formato.campos` validados com `DIMENSAO_MM`, erro no próprio campo; aviso de cadastro incompleto para modo ausente/desconhecido; preenchimento do formato padrão editável
    - Reaproveitar `SecaoProduto`; não alterar `itemFormShared.ts`
    - _Requirements: 6.1, 6.2, 7.1, 7.2, 7.3, 7.5, 7.11, 7.12_
  - [x] 5.15 [Front] Criar `_item/AcabamentosDeProduto`, `AcondicionamentoBloco` e `ComplementosDoItem`
    - Atividades do produto marcáveis (lista vazia indicada), Acondicionamento (duas listas + Conteúdo por volume 1 a 999.999), Itens Diversos, Itens Fornecidos, Campos Livres, Observação e Obs. Áreas de Op (≤2.000), com estado no pai para não perder edições ao abrir painéis; Informações Complementares (≤1.000) conforme o layout
    - Reaproveitar `SecaoAcabamentos` e `SecaoItensComplementares`
    - _Requirements: 6.3, 6.4, 6.5, 7.7_
  - [x] 5.16 [Front] Criar `_item/BlocoPlanoUnico`
    - Só quando `estrutura = PLANO_UNICO`: Cores, Processo (+ Pré e cadeado), Cobertura, Fabricante, Suporte (sem NC até a Fase 4), Fornecido, Microondulado, Fibra, Ajuste Corte Micro (0 a 100,00); Montagem e Formato de Corte somente leitura recalculados ao mudar Suporte, Cores ou medidas
    - Campos conforme `layout.planoUnico.campos`; usar os padrões do `DefaultProdutoPlano` em item novo; sem grid de planos
    - _Requirements: 6.10, 8.1, 8.2, 8.4, 8.5, 8.8, 8.9_
  - [x] 5.17 [Front] Criar `_item/BlocoAcabamento` e `RestricoesEMateriais`
    - Atividades marcáveis com pré-marcadas do cadastro; ao lado, Restrições e Materiais da atividade em foco com títulos próprios, estados vazios ("Nenhuma restrição cadastrada", "Nenhum material cadastrado"), texto de orientação sem atividade, erro com "Tentar novamente" sem perder seleções
    - Campo de parâmetro com rótulo do `tipoParam` e validação `PARAM_MATERIAL` (sem gravar valor inválido); Restrições recolhidas com título e contagem quando `exibeRestricoes` é falso; gravar pelas estruturas existentes (`selecao-material`) e restaurar o estado anterior se a gravação falhar
    - _Requirements: 8.3, 11.1, 11.2, 11.3, 11.4, 11.5, 11.6, 11.7, 11.8, 11.9, 11.10, 11.11, 11.12, 11.13_
  - [x] 5.18 [Front] Criar `_item/MargemDoItem`, bloco "Estrutura de custo" e aviso de planos legados
    - Margem do item compacta e recolhível reaproveitando `SecaoFechamento`/`previa-margem` (G4); sem upload de imagem da faca (a imagem de corte vem da Ficha Master, R21); `SecaoEstruturaCusto`/`ResumoKpis`; aviso "N plano(s) legado(s) mantido(s) sem uso na tela" em plano único com planos persistidos (R-LEG), sem apagar nem editar planos
    - _Requirements: 1.2, 6.6, 8.6, 15.6_
  - [x] 5.19 [Front] Criar `_item/BotaoPropriedades` conforme a decisão D2 (aprovada)
    - Botão "Propriedades/Preview" ao lado de Ajuste Corte Micro (mm); abre o `PreviewFichaMaster` existente (`[id]/_orcamento/PreviewFichaMaster.tsx`), somente leitura, lendo a ficha master por `useFichaMaster` com o `orcamentoId` recebido por prop (só consulta com o painel aberto); sem gravação, sem recálculo e sem alterar item, plano ou orçamento; fechar mantém todos os campos como estavam
    - Teste de componente: não consulta antes de abrir; abrir mostra a ficha (uma leitura `GET /:id/ficha-master`, nenhum POST/PUT/PATCH/DELETE); fechar mantém os campos intactos; erro de leitura mostra "Tentar novamente"
    - _Requirements: 13.1, 13.2, 13.3, 13.4, 13.5_
  - [x] 5.20 [Front] Montar `itens/[itemId]/page.tsx` como Tela_Item e implementar salvar
    - Substituir a ponte da Fase 1; título "Item — {produto}" e migalhas; ligar os blocos conforme `layout`; `dirty` com confirmação ao sair; salvar com `montarPayloadItem`/`salvarItem` de `itemFormShared.ts` sem alteração (mesmo conjunto de campos de engenharia, inclusive `aproveitamentoManual`, formato de corte e `papelId`); em plano único gravar nas colunas achatadas e nunca criar `PlanoCalculoGrafico`
    - Erro de validação ou de servidor: nada gravado, valores digitados mantidos, mensagem com campo e motivo; `Multi_Plano` mostra só o espaço do grid (preenchido na Fase 3) e nenhum campo de plano
    - Após salvar chamar `notificarAlteracaoItem()` da Tela_Orcamento
    - Registro (Front): `_item/TelaItem.tsx` + `_item/tela-item.ts` (puro). Payload = `montarPayloadItem` intocado + por fora `descricao`, `numCores` (= N+M das Cores `NxM`, só plano único; o item persiste só `numCores`) e os campos D3 visíveis e alterados. Campo não alterado vai igual ao `EditorItem`; campo oculto pelo layout nunca é gravado. Calcular usa `POST /:id/itens/:itemId/calcular` (item salvo). Formato vazio só bloqueia item novo (itens antigos têm as colunas D3 nulas). Sinal para a Tela_Orcamento em `_hooks/sinal-alteracao-item.ts`
    - _Requirements: 1.3, 1.7, 6.6, 6.7, 6.8, 6.9, 6.10, 8.6, 8.7, 15.3, 15.4, 15.6_
  - [x] 5.21 [Front] Redirecionar `?novoItem=1` para `/itens/novo` e criar item novo pela Tela_Item
    - `itemId = 'novo'` cria o item; manter funcionais o wizard `/novo`, o `ItemWizardModal` e o "Puxar Cálculo" da lista (só muda o destino pós-criação)
    - _Requirements: 8.4, 19.6_
  - [ ]* 5.22 [Back] Escrever property test "plano único nunca cria plano"
    - **Property 12: Plano único nunca cria plano**
    - **Validates: Requirements 8.6, 15.6**
  - [ ]* 5.23 [Front] Escrever testes de componente da Fase 2
    - Tela_Item para os 5 modos de formato, `semImpressao`, `exibeInformacoesComplementares`, `exibeRestricoes`, troca de produto, plano único × multi-plano, erros por campo
    - _Requirements: 6.8, 7.8, 7.11, 7.12, 8.2, 8.9_
  - [x] 5.24 [Front] Remover o `EditorItem` e seus auxiliares (SOMENTE depois de 5.20 e 5.21 verdes)
    - Remover `EditorItem.tsx`, `editor/ancoras.ts`, `editor/ancoras.test.ts`, `IndiceAncoras.tsx` e `useScrollSpy.ts`, sem perda de função: amostras, relatório, OP e encaixe permanecem no menu de ações
    - Conferir por busca que nenhuma rota do orçamento ainda importa os arquivos removidos
    - _Requirements: 1.5, 19.6_

- [x] 6. Checkpoint — Fase 2
  - Rodar os testes da fase, marca legada, cores fixas, igualdade de custo T1 a T5 nos passos (a) a (d), `Property 12` e isolamento; rodar `get_diagnostics` nos arquivos tocados
  - Conferir o fluxo existente (criar/puxar/editar/calcular/salvar/enviar/aprovar), que o plano único não cria `PlanoCalculoGrafico` e que `migrate-prod.ts` rodou 2× sem erro
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 7. Fase 3 — Grid_Planos, pilha de desfazer, copiar/reordenar plano e Tela_Plano (somente após D1)
  - [~] 7.1 [Back + Front] Confirmar o wireframe da Fase 3 (Tela 3) com o usuário antes de codar
    - Apresentar em texto Grid_Planos e Tela_Plano; aguardar confirmação explícita
    - _Requirements: 19.3, 19.7, 19.9_
  - [~] 7.2 [Back + Front] Registrar por escrito a decisão D1 (e a previsão de blocos G2 e a mitigação R-ANC) antes de mexer em schema
    - D1: Json `especificacao` versionado (`versao: 1`, recomendado) ou colunas novas em `PlanoCalculoGrafico`; confirmar flags G2 de previsão de blocos; aprovar ou recusar a opção de fazer `reconsolidarItemComPlanos` preservar o custo ancorado (não será feita sem aprovação)
    - Sem D1 registrada, não executar 7.3 e seguintes de plano
    - _Requirements: 14.1, 19.3_
  - [~] 7.3 [Back] Aplicar schema D1 conforme a decisão registrada (só após 7.2)
    - `schema.prisma` + `prisma/migrate-prod.ts` NO MESMO COMMIT, idempotente (`ADD COLUMN IF NOT EXISTS`), rodar 2× sem erro; motor não lê o campo; não commitar
    - _Requirements: 14.1, 14.3, 14.4, 14.5, 14.6_
  - [~] 7.4 [Back] Criar `GET /:id/itens/:itemId/planos` e `.../planos/:planoId` e aceitar `especificacao` nos schemas Zod de plano
    - Mesmo select de plano do `GET /:id` + `especificacao`; `where` aninhado por `item: { orcamentoId, empresaId }`; campos sem valor voltam `null`; 404 idêntico
    - _Requirements: 10.14, 14.5, 16.2, 16.3, 20.2, 20.5_
  - [~] 7.5 [Back] Estender `POST .../planos` com `posicaoApos?: uuid` e limite de 20 planos
    - Deslocar `sequencia` em duas fases dentro de `$transaction` (restrição única `[itemId, sequencia]`); `409 "Limite de 20 planos por item."`; `empresaId` do item pai na criação
    - Não alterar `reconsolidarItemComPlanos` sem aprovação registrada em 7.2
    - _Requirements: 9.3, 9.5, 9.12, 16.5_
  - [~] 7.6 [Back] Implementar `planos-ordem.service.ts` e `PATCH .../planos/reordenar`
    - Corpo `{ ordem: uuid[] }` deve ser permutação exata dos planos do item (senão 400 e nada gravado); sem reconsolidar custo; resposta `{ planos: [{ id, sequencia }] }`
    - Teste unitário `planos-ordem.service.test.ts`: permutação válida, id faltando, repetido, de outro item; `posicaoApos` sem violar a unicidade
    - _Requirements: 9.8, 16.2_
  - [ ]* 7.7 [Back] Escrever property test de reordenação
    - **Property 10: Reordenar é permutação e persiste**
    - **Validates: Requirements 9.8**
  - [~] 7.8 [Front] Implementar `_plano/pilha-desfazer.ts` (reducer puro)
    - Operações inversas `EXCLUIR_PLANO`, `RECRIAR_PLANO`, `RESTAURAR_ORDEM`; `LIMITE_DESFAZER = 20`; `empilhar`, `desempilhar`, `remapearId`
    - Teste unitário: 21 ações (a mais antiga sai), ordem inversa, `remapearId` após `RECRIAR_PLANO`
    - _Requirements: 9.7_
  - [ ]* 7.9 [Front] Escrever property test da pilha de desfazer
    - **Property 9: Desfazer é a inversa da operação e limitado a 20**
    - **Validates: Requirements 9.7**
  - [~] 7.10 [Front] Implementar `gerarNomeCopia`
    - "(Cópia)", "(Cópia 2)", …; comparação sem caixa nem acento; truncar o nome base, nunca o sufixo, em 60 caracteres
    - Teste unitário: nome de 60 caracteres, nome já terminado em "(Cópia)", maiúsculas e acento
    - _Requirements: 9.5_
  - [ ]* 7.11 [Front] Escrever property test do nome de cópia
    - **Property 8: Nome de cópia único e limitado a 60**
    - **Validates: Requirements 9.5**
  - [~] 7.12 [Front] Criar o hook `usePlanosDoItem`
    - `GET .../planos` + ações; aplica a ação otimista só depois da resposta de sucesso; em falha mantém o estado anterior e a ação disponível; integra a pilha de desfazer
    - _Requirements: 9.7, 9.11_
  - [~] 7.13 [Front] Criar `_item/GridPlanos`
    - Colunas Nome, Suporte, Cores, Formato, Acabamento (nomes por vírgula); ações Incluir (sempre), Copiar e Excluir (exatamente 1 selecionado), Trocar/Reordenar (2 ou mais), Desfazer (há ação a desfazer); confirmação na exclusão; estado vazio com Incluir; mensagem de limite de 20 planos; mensagem "operação não foi salva" em falha
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.8, 9.9, 9.10, 9.11, 9.12_
  - [~] 7.14 [Front] Criar `planos/[planoId]/page.tsx` (Tela_Plano)
    - Título "Plano — {nome}"; Tipo de Plano, Nome (1 a 100), Ocorrências (1 a 99), Tiragem (padrão = item); Montagem, Corte, Formato Aberto, Formato Final (0,00 a 99.999,99); Cores `NxM` (0 a 12), Processo (+ Pré e cadeado), Cobertura (0 a 100); OK e Cancelar
    - OK valida obrigatórios (Tipo, Nome, Tiragem e, por bloco exibido, Cores, Processo e Suporte), grava só os blocos exibidos, volta ao item em até 3 s; Cancelar descarta sem chamada à API; plano novo aplica `DefaultProdutoPlano` e plano existente nunca reaplica; erros por campo e erro de gravação mantêm o formulário; `planoId = 'novo'` cria; nenhum campo de Item
    - _Requirements: 1.4, 1.8, 10.1, 10.2, 10.3, 10.7, 10.9, 10.10, 10.11, 10.12, 10.13, 10.14_
  - [~] 7.15 [Front] Criar `_plano/BlocosPorTipoPlano`
    - Blocos capa externa, microondulado (Sentido da onda e Ajuste Corte Micro −99,99 a 99,99) e capa interna conforme `resolverBlocosPlano`; sem comparar nome de tipo; `null` na previsão ⇒ mostrar
    - _Requirements: 10.4, 10.5, 10.6, 10.8_
  - [~] 7.16 [Front] Exibir o aviso de custo ancorado antes da primeira alteração de plano em item com `calculoGraficoOrigemId`
    - Texto "O custo deste item vem de um cálculo anterior e pode mudar"; abrir e salvar sem mudança não chama a API de plano; reordenar usa a rota nova (sem reconsolidação)
    - _Requirements: 15.7, 15.2_
  - [~] 7.17 [Front] Trocar `PlanosDoItem.tsx` e `PlanosDoItemComCatalogo.tsx` (modal) por Grid_Planos + Tela_Plano na Tela_Item
    - Mover (não reescrever) defaults de catálogo, validação e troca de suporte; conferir por busca que não restam usos do modal
    - _Requirements: 1.3, 1.4, 1.5, 1.8, 9.10_
  - [~] 7.18 [Front] Adicionar o botão Propriedades/Preview (painel de aviso) à Tela_Plano ao lado de Ajuste Corte Micro
    - Reusar `BotaoPropriedades` da tarefa 5.19
    - _Requirements: 13.1, 13.2, 13.3, 13.4_
  - [ ]* 7.19 [Front] Escrever testes de componente da Fase 3
    - Habilitação dos botões, estado vazio, blocos por tipo, OK/Cancelar, erro de gravação, limite de 20
    - _Requirements: 9.2, 9.9, 9.12, 10.9, 10.10, 10.13_

- [~] 8. Checkpoint — Fase 3
  - Rodar os testes da fase (Properties 8, 9, 10), marca legada, cores fixas, igualdade de custo (T5 sem diferença; item ancorado coberto por medição) e isolamento; rodar `get_diagnostics` nos arquivos tocados
  - Conferir o fluxo existente (criar/puxar/editar/calcular/salvar/enviar/aprovar), que R1.3, R1.4, R1.5, R1.7 e R1.8 estão completos e que `migrate-prod.ts` rodou 2× sem erro
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 9. Fase 4 — Suporte Não Cadastrado (somente após G3)
  - [~] 9.1 [Back + Front] Confirmar o wireframe do formulário NC com o usuário antes de codar
    - _Requirements: 19.4, 19.7, 19.9_
  - [~] 9.2 [Back + Front] Registrar por escrito a decisão G3 antes de mexer em schema
    - Opção A (colunas novas em `SuporteGrafico` e `PrecoMateriaPrima`) ou B (Json descritivo + `provisorio`); confirmar que o motor não lê nenhum campo novo
    - Sem G3 registrada, não executar 9.3 e seguintes
    - _Requirements: 12.10, 19.4_
  - [~] 9.3 [Back] Aplicar schema G3 conforme a decisão registrada (só após 9.2)
    - `schema.prisma` + `prisma/migrate-prod.ts` NO MESMO COMMIT, idempotente (`BOOLEAN NOT NULL DEFAULT FALSE` para `provisorio`; `CREATE INDEX IF NOT EXISTS`), rodar 2× sem erro; não commitar
    - _Requirements: 12.3, 12.4, 12.10_
  - [~] 9.4 [Back] Implementar `suporte-nc.service.ts` e `POST /suportes-nao-cadastrados`
    - `$transaction` criando `SuporteGrafico` + `PrecoMateriaPrima` com `provisorio = true` e `empresaId` do registro pai; validar faixas (nome ≤120, gramatura 1 a 2.000, custo/kg 0,01 a 999.999,99, frete, créditos 0 a 100, espessura 0 a 10.000)
    - Duplicata (mesma empresa, mesmo nome sem caixa, mesma gramatura) devolve `DUPLICADO` sem criar; `confirmarExistente` usa o existente; rollback total em falha
    - Teste unitário `suporte-nc.service.test.ts`
    - _Requirements: 12.3, 12.4, 12.5, 12.6, 12.7, 12.8, 12.9, 16.5_
  - [ ]* 9.5 [Back] Escrever property test do Suporte NC
    - **Property 15: Suporte NC sem duplicata e com empresa do pai**
    - **Validates: Requirements 12.3, 12.4, 12.7, 12.8, 12.9, 16.5**
  - [~] 9.6 [Back] Ajustar `GET /precos-mp?provisorio=true` e `PUT /precos-mp/:id` (aceitar `provisorio: false` ao regularizar)
    - `empresaId` explícito; sem alterar o motor
    - _Requirements: 12.4, 16.1_
  - [~] 9.7 [Front] Criar o formulário Suporte Não Cadastrado (`_item/SuporteNcModal`)
    - Campos: Nome, Gramatura, Espessura G/, Espessura (micras), Formato, Fibra, Tira/Retira, Consumo de Tinta, Unidades, Custo por Kg, Frete por Kg, Pacotes com, Crédito ICMS % e IPI %; validação com os presets NC, destaque do campo e motivo, dados preservados; opção "usar existente" ou cancelar em `DUPLICADO`; orçamento intacto até confirmar
    - _Requirements: 12.2, 12.5, 12.6, 12.7, 12.8_
  - [~] 9.8 [Front] Integrar o botão NC ao lado de cada Suporte (plano único e blocos capa externa, microondulado e capa interna)
    - Ao confirmar, selecionar o novo suporte no campo de origem
    - _Requirements: 12.1, 12.3_
  - [ ]* 9.9 [Front] Escrever testes de componente do NC
    - Validação por campo, duplicata, erro de criação, seleção do suporte novo
    - _Requirements: 12.5, 12.6, 12.7, 12.8_

- [~] 10. Checkpoint — Fase 4
  - Rodar os testes da fase (Property 15), marca legada, cores fixas, igualdade de custo e isolamento; rodar `get_diagnostics` nos arquivos tocados
  - Conferir o fluxo existente (criar/puxar/editar/calcular/salvar/enviar/aprovar), que o suporte NC é consumido pelo motor como qualquer suporte e que `migrate-prod.ts` rodou 2× sem erro
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 11. Botão Propriedades/Preview — conteúdo (somente após D2)
  - [~] 11.1 [Back + Front] Registrar por escrito a decisão D2 e confirmar o wireframe do conteúdo com o usuário
    - Enquanto D2 estiver aberta, permanece apenas o painel de aviso das tarefas 5.19 e 7.18
    - D2 segue aberta (17/11/2026). Hipótese de trabalho, pendente de confirmação: o botão abrirá o mesmo `PreviewFichaMaster` da tarefa 3.21 (mesmo componente e rota). Só reutilizar após confirmação por escrito
    - _Requirements: 13.5, 19.5_
  - [~] 11.2 [Front] Implementar o conteúdo de Propriedades/Preview conforme D2 (só após 11.1)
    - Sem gravação, sem recálculo e sem alterar custo; igualdade de custo T1 a T5 mantida; se exigir dado novo no back, abrir tarefa própria com decisão registrada antes de schema
    - _Requirements: 13.1, 13.4, 19.5_

- [~] 12. Checkpoint final
  - Rodar toda a suíte da spec (back e front), `get_diagnostics` em todos os arquivos tocados, marca legada, cores fixas, igualdade de custo T1 a T5 e isolamento
  - Conferir o fluxo existente de ponta a ponta e que `calcularOrcamentoGrafico` e `ancorarCustoCalcgraf` estão intactos (guard da tarefa 1.9)
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tarefas marcadas com `*` são opcionais (testes de propriedade e de componente) e podem ser puladas para um MVP; os testes unitários que sustentam critérios de fase (sem `*`) devem ser feitos.
- Cada tarefa referencia requisitos específicos para rastreabilidade; propriedades citam o número da seção "Correctness Properties" do design.
- Checkpoints garantem validação incremental ao fim de cada fase.
- Tarefas de wireframe e de registro de decisão (D1/D2/D3/G2/G3) são pontos de parada com o usuário: não iniciar código nem schema da fase antes delas.
- Esta lista não contém commits nem push; o usuário decide quando commitar (no back, `schema.prisma` + `migrate-prod.ts` sempre juntos).

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2", "1.4", "1.6", "1.8"] },
    { "id": 1, "tasks": ["1.3", "1.5", "1.7", "1.9", "1.10"] },
    { "id": 2, "tasks": ["3.1"] },
    { "id": 3, "tasks": ["3.2", "3.12"] },
    { "id": 4, "tasks": ["3.3", "3.13"] },
    { "id": 5, "tasks": ["3.4", "3.14"] },
    { "id": 6, "tasks": ["3.7", "3.15"] },
    { "id": 7, "tasks": ["3.8", "3.16"] },
    { "id": 8, "tasks": ["3.5", "3.6", "3.9", "3.10", "3.17", "3.23"] },
    { "id": 9, "tasks": ["3.11", "3.18"] },
    { "id": 10, "tasks": ["3.19", "3.20", "3.21"] },
    { "id": 11, "tasks": ["3.22", "3.24"] },
    { "id": 12, "tasks": ["5.1"] },
    { "id": 13, "tasks": ["5.2"] },
    { "id": 14, "tasks": ["5.3", "5.5", "5.6", "5.10"] },
    { "id": 15, "tasks": ["5.4", "5.7", "5.8", "5.9", "5.11", "5.12"] },
    { "id": 16, "tasks": ["5.13", "5.14", "5.15"] },
    { "id": 17, "tasks": ["5.16", "5.17", "5.18", "5.19"] },
    { "id": 18, "tasks": ["5.20"] },
    { "id": 19, "tasks": ["5.21", "5.22", "5.23"] },
    { "id": 20, "tasks": ["5.24"] },
    { "id": 21, "tasks": ["7.1"] },
    { "id": 22, "tasks": ["7.2"] },
    { "id": 23, "tasks": ["7.3", "7.8", "7.10", "7.15"] },
    { "id": 24, "tasks": ["7.4", "7.9", "7.11", "7.12"] },
    { "id": 25, "tasks": ["7.5", "7.13"] },
    { "id": 26, "tasks": ["7.6", "7.14"] },
    { "id": 27, "tasks": ["7.7", "7.16", "7.18"] },
    { "id": 28, "tasks": ["7.17", "7.19"] },
    { "id": 29, "tasks": ["9.1"] },
    { "id": 30, "tasks": ["9.2"] },
    { "id": 31, "tasks": ["9.3"] },
    { "id": 32, "tasks": ["9.4", "9.6", "9.7"] },
    { "id": 33, "tasks": ["9.5", "9.8", "9.9"] },
    { "id": 34, "tasks": ["11.1"] },
    { "id": 35, "tasks": ["11.2"] }
  ]
}
```
