# Implementation Plan: WMS Endereçamento Dual Mode

## Overview

Implementação incremental do módulo de endereçamento dual-mode (Manual + Acompanhamento Coletor) para o VisioFab WMS. O plano segue a ordem: serviço de sugestão de endereço → rotas backend → rotas de etiquetas → componentes frontend → integração na página de conferência de entrada → fix do seletor de funcionários. Cada tarefa estende o stack existente (Fastify + Prisma + PostgreSQL no backend, Next.js 15 + Mantine UI + TanStack Query no frontend) sem alterar a arquitetura atual.

## Tasks

- [x] 1. Criar SugestaoEnderecoService com lógica de prioridade
  - [x] 1.1 Criar `src/modules/enderecamento/sugestao-endereco.service.ts` com classe `SugestaoEnderecoService` contendo método `sugerir(input: SugestaoInput): Promise<SugestaoResultado | null>`. Implementar a cadeia de prioridade: (1) endereço fixo via `DadosLogisticosArmazenagem.enderecoFixoId`, (2) consolidação via `SaldoEndereco` com quantidade > 0 para o mesmo produto, (3) ordenação por norma FEFO (validade ASC) ou FIFO (atualizadoEm ASC), (4) primeiro endereço livre ordenado por rua, prédio, nível, apto. Retornar `null` se nenhum endereço disponível
    - Definir interfaces `SugestaoInput` e `SugestaoResultado` conforme design
    - Consultar `DadosLogisticosArmazenagem` para obter `enderecoFixoId` e `tipoNorma`
    - Consultar `SaldoEndereco` para consolidação (mesmo produto, quantidade > 0)
    - Consultar `Endereco` com tipo IN ['ARMAZENAGEM', 'LIVRE'] e status true para endereços livres
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6_

  - [x] 1.2 Adicionar método `sugerirLote(itens, empresaId): Promise<Map<string, SugestaoResultado | null>>` ao `SugestaoEnderecoService`. Iterar sobre os itens chamando `sugerir()` para cada um, mantendo um Set de endereços já sugeridos para evitar duplicatas em endereços livres
    - Garantir que dois itens diferentes não recebam o mesmo endereço livre como sugestão
    - _Requirements: 2.2, 3.1, 3.2, 3.3_

  - [ ]* 1.3 Escrever property test para cadeia de prioridade do SugestaoEnderecoService
    - **Property 1: Suggestion Engine Priority Chain** — Para qualquer produto com enderecoFixoId não-nulo e endereço ativo, o serviço DEVE retornar o endereço fixo independentemente de outros endereços disponíveis
    - **Validates: Requirements 3.1, 3.2, 3.3**

  - [ ]* 1.4 Escrever property test para fallback de consolidação
    - **Property 2: Consolidation Fallback** — Para qualquer produto sem endereço fixo mas com SaldoEndereco existente (quantidade > 0), o serviço DEVE retornar esse endereço com tipo CONSOLIDAR
    - **Validates: Requirements 3.2**

  - [ ]* 1.5 Escrever property test para ordenação por norma
    - **Property 3: Norm-Based Ordering** — Para produto com tipoNorma FEFO, preferir endereços com validade ASC. Para FIFO, preferir endereços com data de recebimento ASC
    - **Validates: Requirements 3.4, 3.5**

  - [ ]* 1.6 Escrever property test para ordenação de endereços livres
    - **Property 4: Free Address Sort Order** — Sem endereço fixo, consolidação ou norma, retornar primeiro endereço livre ordenado por codigoRua ASC, codigoPredio ASC, codigoNivel ASC, codigoApto ASC
    - **Validates: Requirements 3.3**

- [x] 2. Adicionar novas rotas ao enderecamento-wms.routes.ts
  - [x] 2.1 Adicionar rota `GET /sugerir-lote` ao `enderecamento-wms.routes.ts` — recebe `notaEntradaId` como query param, busca a nota com itens e produtos, chama `SugestaoEnderecoService.sugerirLote()`, retorna array de sugestões com itemId, produtoId, produtoCodigo, produtoNome, quantidade, lote, validade e sugestão
    - Validar que a nota existe e tem status CONFERIDA
    - Mapear `ItemNotaEntrada.codigoProduto` para `Produto.id` via `Produto.codigo`
    - _Requirements: 2.1, 2.2, 3.1, 3.2, 3.3_

  - [x] 2.2 Adicionar rota `POST /confirmar-lote` ao `enderecamento-wms.routes.ts` — recebe `notaEntradaId` e array de itens com `itemNotaEntradaId`, `produtoId`, `enderecoId`, `quantidade`, `lote`, `validade`. Executar em transação Prisma: (1) validar todos os endereços, (2) upsert `SaldoEndereco` para cada item, (3) upsert `Estoque` consolidado, (4) criar `LogMovimentacao` com tipo ENDERECAMENTO para cada item, (5) atualizar `NotaEntrada.status` para ENDERECADA, (6) fechar `OrdemServicoWms` (operacao=ENDERECAMENTO) com status CONCLUIDO e horaFim
    - Retornar dados de etiquetas para impressão em lote (enderecoCompleto, produtoNome, quantidade, lote, validade)
    - Rollback completo se qualquer item falhar
    - _Requirements: 2.3, 2.4, 10.1, 10.2, 10.3, 10.4_

  - [x] 2.3 Adicionar rota `GET /progresso/:notaEntradaId` ao `enderecamento-wms.routes.ts` — consultar itens da nota e verificar quais possuem `SaldoEndereco` correspondente. Retornar `totalItens`, `itensEnderecados`, `percentual`, e array de itens com status PENDENTE ou ENDERECADO
    - Computar progresso dinamicamente comparando ItemNotaEntrada com SaldoEndereco
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5_

  - [x] 2.4 Adicionar rota `POST /validar-endereco` ao `enderecamento-wms.routes.ts` — recebe `enderecoId`, verifica se o endereço existe, tem status true, e tipo IN ['ARMAZENAGEM', 'LIVRE']. Retornar `valido: boolean` com dados do endereço ou mensagem de erro
    - _Requirements: 2.3_

  - [ ]* 2.5 Escrever property test para validação de endereço
    - **Property 5: Address Validation** — Para qualquer enderecoId, retornar valido=true se e somente se o endereço existe, tem status true, e tipo IN ['ARMAZENAGEM', 'LIVRE']
    - **Validates: Requirements 2.3**

  - [ ]* 2.6 Escrever property test para criação de registros no confirmar-lote
    - **Property 6: Batch Addressing Record Creation** — Após confirmar-lote, cada item DEVE ter SaldoEndereco com produtoId, enderecoId e quantidade corretos, e Estoque incrementado pela quantidade do item
    - **Validates: Requirements 2.4, 10.1, 10.2, 10.3**

  - [ ]* 2.7 Escrever property test para transições de estado na conclusão
    - **Property 7: Addressing Completion State Transitions** — Quando todos os itens de uma nota são endereçados, o status da nota DEVE ser ENDERECADA, a OS DEVE ter status CONCLUIDO, e LogMovimentacao com tipo ENDERECAMENTO DEVE existir para cada item
    - **Validates: Requirements 10.1, 10.2, 10.3**

  - [ ]* 2.8 Escrever property test para cálculo de progresso
    - **Property 10: Progress Calculation** — Para nota com N itens totais e K endereçados (0 ≤ K ≤ N, N > 0), percentual DEVE ser (K/N)*100, totalItens DEVE ser N, itensEnderecados DEVE ser K
    - **Validates: Requirements 5.1**

- [x] 3. Checkpoint — Verificar serviço de sugestão e rotas backend
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. Adicionar rotas de etiquetas de endereçamento ao etiqueta.routes.ts
  - [x] 4.1 Adicionar rota `POST /gerar-enderecamento` ao `etiqueta.routes.ts` — recebe array de itens com `enderecoCompleto`, `produtoCodigo`, `produtoNome`, `quantidade`, `lote`, `validade` e `quantidade` (cópias). Gerar HTML com layout para A4 (múltiplas etiquetas por página), barcode Code128 do endereço no topo, código e nome do produto no meio, quantidade e lote/validade na parte inferior. Retornar text/html
    - Usar `bwip-js` já disponível no módulo para gerar barcode PNG inline (base64)
    - _Requirements: 6.1, 6.3, 6.4, 8.1, 8.2, 8.3_

  - [x] 4.2 Adicionar rota `POST /gerar-enderecamento-zpl` ao `etiqueta.routes.ts` — recebe mesmos dados + `larguraMm` (default 100) e `alturaMm` (default 50). Gerar ZPL II válido para cada etiqueta: `^XA` no início, `^XZ` no final, `^BC` Code128 com valor do endereço, `^PW` e `^LL` para 100mm×50mm a 8 dots/mm. Retornar text/plain
    - _Requirements: 6.5, 9.1, 9.2, 9.3, 9.4_

  - [ ]* 4.3 Escrever property test para completude dos dados da etiqueta
    - **Property 8: Label Data Completeness** — Para qualquer item endereçado, a etiqueta (HTML ou ZPL) DEVE conter: barcode do endereço, código do produto, nome do produto, quantidade, lote (se presente) e validade (se presente)
    - **Validates: Requirements 6.3, 8.3**

  - [ ]* 4.4 Escrever property test para validade do ZPL
    - **Property 9: ZPL Validity** — Para qualquer item, o ZPL DEVE iniciar com ^XA e terminar com ^XZ, conter comando ^BC Code128 com valor do barcode do endereço, e ter ^PW e ^LL correspondentes a 100mm×50mm a 8 dots/mm
    - **Validates: Requirements 9.1, 9.2, 9.3**

- [x] 5. Criar hooks TanStack Query para as novas APIs de endereçamento
  - [x] 5.1 Criar hooks em `VisioFab.Wms.Front/src/data/enderecamento/` (ou estender existente): `useSugerirLote(notaEntradaId)` — GET /enderecamento-wms/sugerir-lote, `useConfirmarLote()` — POST /enderecamento-wms/confirmar-lote (mutation), `useProgressoEnderecamento(notaEntradaId, enabled)` — GET /enderecamento-wms/progresso/:notaEntradaId com refetchInterval de 5000ms quando enabled=true, `useValidarEndereco()` — POST /enderecamento-wms/validar-endereco (mutation)
    - Seguir padrão existente de hooks com TanStack Query no projeto
    - _Requirements: 1.2, 1.3, 2.1, 2.2, 5.1, 5.2_

  - [x] 5.2 Criar hooks de etiquetas de endereçamento: `useGerarEtiquetaEnderecamento()` — POST /etiquetas/gerar-enderecamento (mutation, retorna HTML), `useGerarEtiquetaEnderecamentoZpl()` — POST /etiquetas/gerar-enderecamento-zpl (mutation, retorna text/plain)
    - _Requirements: 6.4, 6.5, 6.6_

- [x] 6. Implementar componente Mode Selector e Manual Mode View no frontend
  - [x] 6.1 Criar componente `ModoEnderecamentoSelector` em `VisioFab.Wms.Front/` — exibir duas opções: "📝 Manual" e "📱 Acompanhamento (Coletor)" usando SegmentedControl ou Cards do Mantine. Ao selecionar, renderizar a view correspondente. Receber `notaEntradaId` como prop
    - _Requirements: 1.1, 1.2, 1.3_

  - [x] 6.2 Criar componente `ManualModeView` — tabela Mantine com colunas: item, código produto, nome produto, quantidade, lote, validade, endereço sugerido, campo editável de endereço destino. Carregar sugestões via `useSugerirLote`. Botão "Aceitar Sugestões" preenche todos os campos destino com as sugestões. Botão "Confirmar Endereçamento" chama `useConfirmarLote` e após sucesso oferece impressão de etiquetas
    - Validar cada endereço destino via `useValidarEndereco` ao alterar
    - Exibir warning "Nenhum endereço disponível" quando sugestão retornar null
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 3.6, 6.1, 6.6_

  - [x] 6.3 Adicionar botões "Imprimir Ficha" e "Importar Ficha OCR" ao `ManualModeView` — "Imprimir Ficha" chama POST /enderecamento-wms/gerar-ficha e abre GET /enderecamento-wms/ficha/:id/html em nova aba. "Importar Ficha OCR" abre modal de upload que chama POST /ocr/extrair-pdf, exibe resultados com scores de confiança, e ao confirmar preenche os campos de endereço destino
    - Reutilizar fluxo OCR existente do módulo de conferência
    - Campos com confiança < 80% destacados em amarelo para revisão manual
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5_

- [x] 7. Implementar Collector Monitoring View no frontend
  - [x] 7.1 Criar componente `CollectorMonitoringView` — exibir barra de progresso (Progress do Mantine) com formato X/Y itens, tabela com colunas: item, código produto, nome produto, quantidade, endereço destino, status (Pendente/Endereçado com ícones ⏳/✅). Usar `useProgressoEnderecamento` com refetchInterval de 5000ms. Quando todos itens endereçados, exibir indicador de conclusão e habilitar botão "Finalizar Endereçamento"
    - Auto-refresh a cada 5 segundos via refetchInterval do TanStack Query
    - Botão "Finalizar" chama confirmar-lote ou apenas exibe opção de impressão de etiquetas
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5_

- [x] 8. Integrar dual-mode na página de conferência de entrada
  - [x] 8.1 Estender `VisioFab.Wms.Front/src/app/(interna)/wms/conferencia-entrada/page.tsx` — na aba de endereçamento (para notas com status CONFERIDA), substituir o botão "Endereçar Automático" pelo componente `ModoEnderecamentoSelector`. Manter compatibilidade com o fluxo existente de conferência
    - Renderizar `ModoEnderecamentoSelector` passando `notaEntradaId` da nota selecionada
    - _Requirements: 1.1, 1.2, 1.3_

- [x] 9. Checkpoint — Verificar frontend dual-mode e integração
  - Ensure all tests pass, ask the user if questions arise.

- [x] 10. Corrigir Employee Selector no modal de endereçamento
  - [x] 10.1 Corrigir o dropdown de seleção de funcionários no modal de endereçamento — garantir que o `useQuery` para funcionários use `enabled` vinculado ao estado de abertura do modal (ex: `enabled: !!modalAberto`). Formatar opções como `"{matricula} — {nome}"`. Em caso de erro na API, exibir notificação via `notifications.show()` do Mantine com opção de retry
    - Verificar query key específica para o contexto de endereçamento
    - _Requirements: 7.1, 7.2, 7.3, 7.4_

  - [ ]* 10.2 Escrever property test para formatação do Employee Selector
    - **Property 11: Employee Formatting** — Para qualquer funcionário com matricula e nome, o seletor DEVE exibir a opção formatada como "{matricula} — {nome}"
    - **Validates: Requirements 7.3**

- [x] 11. Adicionar geração de ficha de endereçamento com completude
  - [x] 11.1 Verificar e estender a rota `GET /enderecamento-wms/ficha/:id/html` para garantir que o HTML gerado contenha: número do item, código do produto, nome do produto, quantidade, lote, validade, campo em branco para endereço destino, e barcode identificador único da ficha. Ajustar `FichaService.gerarHtmlEnderecamento()` se necessário
    - _Requirements: 4.1, 4.2_

  - [ ]* 11.2 Escrever property test para completude da ficha de endereçamento
    - **Property 12: Addressing Sheet Completeness** — Para qualquer nota com itens, o HTML da ficha DEVE conter número do item, código do produto, nome do produto, quantidade, lote, campo em branco para endereço destino, e barcode identificador
    - **Validates: Requirements 4.1, 4.2**

- [x] 12. Final checkpoint — Verificar integração completa e todos os fluxos
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document using `fast-check`
- Unit tests validate specific examples and edge cases
- All new backend routes follow the existing Fastify + Zod + Prisma pattern in `enderecamento-wms.routes.ts` and `etiqueta.routes.ts`
- Frontend components follow the existing Mantine UI + TanStack Query pattern in `conferencia-entrada/page.tsx`
- The existing OCR flow from conferência is reused for the addressing sheet import
- The existing `FichaService` and `FichaOperacional` model are reused for addressing sheet generation
