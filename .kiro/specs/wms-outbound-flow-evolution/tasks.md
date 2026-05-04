# Implementation Tasks — WMS Outbound Flow Evolution

## Task 1: Create StockService with reservation and deduction methods

- [x] Create `src/modules/estoque/stock.service.ts` with the `StockService` class
- [x] Implement `reservarEstoqueOnda(empresaId, itens: {produtoId, quantidade}[], tx?)`: validates `Estoque.quantidade - Estoque.reservado >= requested qty` per product, then increments `Estoque.reservado`. Throws 422 with message `Estoque insuficiente para produto {codigo}` if insufficient. Throws 422 if product not found in Estoque table.
- [x] Implement `deduzirSaldoEndereco(empresaId, enderecoId, produtoId, quantidade, usuarioId, tx?)`: decrements `SaldoEndereco.quantidade`, validates result >= 0 (throws 422 if negative), creates `LogMovimentacao` entry with tipo `SEPARACAO` capturing `saldoAnterior` and `saldoNovo`. If SaldoEndereco reaches 0 and no other products at address, update Endereco.tipo to `LIVRE`.
- [x] Implement `deduzirEstoqueFinal(empresaId, itens: {produtoId, quantidade}[], tx?)`: decrements `Estoque.quantidade` and `Estoque.reservado` by total qty per product. Validates `Estoque.quantidade - deduction >= 0` (throws 422 if negative with message `Inconsistência de estoque`).
- [x] Implement `getVisaoEstoque(empresaId, produtoId)`: returns `{ quantidadeTotal, reservado, emTransito, disponivel }` where `emTransito` = SUM of `quantidadeSeparada` for all ItemSeparacao with status IN (SEPARADO, SEPARADO_PARCIAL) whose parent OndaSeparacao.status NOT IN (CONCLUIDA, CANCELADA), and `disponivel = quantidadeTotal - reservado - emTransito`.

**Requirements:** 10, 11, 12, 13
**Design:** Component 3 (StockService)

## Task 2: Refactor item-separacao.service.ts — Remove Estoque decrement at pick confirmation

- [x] Modify `confirmarItem` in `src/modules/item-separacao/item-separacao.service.ts`: remove the `tx.estoque.updateMany` call that decrements `Estoque.quantidade` and `Estoque.reservado` at pick confirmation (step 3 in current code)
- [x] Replace the direct `tx.saldoEndereco.updateMany` call with a call to `StockService.deduzirSaldoEndereco()` which also creates the `LogMovimentacao` entry with tipo `SEPARACAO`
- [x] Keep the existing logic for: updating ItemSeparacao status, checking if address is empty (Endereco → LIVRE), and checking if all items separated (Onda → SEPARADA)
- [x] Ensure the transaction context (`tx`) is passed through to StockService methods

**Requirements:** 11.1, 11.2, 11.3
**Design:** Component 3 (StockService), Section "Existing confirmarItem already handles stock"

## Task 3: Add stock reservation on wave initiation

- [x] Modify `PATCH /:id/iniciar` in `src/modules/onda-separacao/onda-separacao.routes.ts`: after calling `iniciarOnda()`, aggregate all ItemSeparacao quantities by produtoId across all OrdemSeparacao of the onda
- [x] Call `StockService.reservarEstoqueOnda(empresaId, aggregatedItems)` within the initiation flow
- [x] If reservation fails (insufficient stock), return 422 error and revert the onda status back to PENDENTE
- [x] Wrap the entire operation (iniciar + reserve) in a transaction to ensure atomicity

**Requirements:** 10.1, 10.2, 10.3, 10.4
**Design:** Component 3 (StockService), Request Flow — Stock Reservation

## Task 4: Add final stock deduction on carregamento confirmation

- [x] Modify `PATCH /:id/confirmar` in `src/modules/carregamento/carregamento.routes.ts`: after marking all volumes as loaded and before concluding the carregamento, collect all items across all loaded volumes with their quantities and produtoIds
- [x] Call `StockService.deduzirEstoqueFinal(empresaId, aggregatedItems)` within the existing `$transaction` block
- [x] If deduction fails (negative stock), return 422 error and do not conclude the carregamento
- [x] Also add final stock deduction in `POST /:id/carregar-scanner` when `carregamentoConcluido` is true (all volumes loaded via scanner)

**Requirements:** 12.1, 12.2, 12.3, 12.4
**Design:** Component 3 (StockService), Request Flow — Stock Reservation & Deduction Phase 3

## Task 5: Create stock view route

- [x] Create `src/modules/estoque/stock-view.routes.ts` with `stockViewRoutes` function
- [x] Implement `GET /:produtoId/visao` endpoint: calls `StockService.getVisaoEstoque(empresaId, produtoId)` and returns the stock breakdown JSON
- [x] Register the new route in `src/server.ts`: `app.register(stockViewRoutes, { prefix: '/estoque' })`
- [x] Add authentication and moduloGuard('WMS') hooks

**Requirements:** 13.1, 13.2, 13.3
**Design:** Component 5 (New Route Registrations)

## Task 6: Create MonitorService with progress methods

- [x] Create `src/modules/monitor/monitor.service.ts` with the `MonitorService` class
- [x] Implement `getProgressoSeparacao(ondaId)`: queries all ItemSeparacao for the onda, returns `{ ondaId, total, concluidos, pendentes, emAndamento, percentual, itens: [{id, produtoNome, enderecoOrigem, quantidadeSolicitada, quantidadeSeparada, status}], timestamp }`. Status mapping: PENDENTE→'Pendente', SEPARADO/SEPARADO_PARCIAL→'Concluído'. Enriches items with Produto.nome and Endereco.enderecoCompleto.
- [x] Implement `getProgressoEmbalagem(ondaId)`: queries separated items and their ItemVolume links, returns `{ ondaId, totalItensSeparados, itensEmbalados, itensPendentes, percentual, volumes: [{volumeId, codigo, tipo, totalItens, percentualConcluido}], timestamp }`
- [x] Implement `getProgressoCarregamento(carregamentoId)`: queries CarregamentoVolume records, returns `{ carregamentoId, totalVolumes, volumesCarregados, volumesPendentes, percentual, volumes: [{sequencia, volumeCodigo, tipo, pesoKg, status}], timestamp }`. Status: carregadoEm ? 'Concluído' : 'Pendente'.

**Requirements:** 4, 5, 6
**Design:** Component 2 (MonitorService)

## Task 7: Add monitoring endpoints to onda-separacao.routes.ts

- [x] Add `GET /:id/monitor/separacao` endpoint: validates onda exists and belongs to user's empresa (404 if not found), calls `MonitorService.getProgressoSeparacao(ondaId)`, returns JSON response
- [x] Add `GET /:id/monitor/embalagem` endpoint: validates onda exists and belongs to user's empresa (404 if not found), calls `MonitorService.getProgressoEmbalagem(ondaId)`, returns JSON response
- [x] Both endpoints return ISO 8601 timestamp for client-side 5s polling

**Requirements:** 4.1, 4.2, 4.3, 4.4, 5.1, 5.2, 5.3, 5.4
**Design:** Component 2 (MonitorService), Request Flow — Monitoring

## Task 8: Add monitoring endpoint to carregamento.routes.ts

- [x] Add `GET /:id/monitor` endpoint: validates carregamento exists and belongs to user's empresa (404 if not found), calls `MonitorService.getProgressoCarregamento(carregamentoId)`, returns JSON response
- [x] Endpoint returns ISO 8601 timestamp for client-side 5s polling

**Requirements:** 6.1, 6.2, 6.3, 6.4
**Design:** Component 2 (MonitorService)

## Task 9: Add tracking sheet methods to FichaService

- [x] Add `gerarHtmlFichaAcompanhamentoSeparacao(onda)` method to `FichaService`: generates HTML with header (onda number, date, employee name, total items), items ordered by collection route (codigoRua → codigoPredio → codigoNivel), each item with product code, name, barcode (from SKU codigoBarra), source address, quantity, unit, and checkbox column. Include barcode section.
- [x] Add `gerarHtmlFichaAcompanhamentoEmbalagem(onda)` method: generates HTML grouped by Volume (code, type CAIXA/PALETE/FARDO), each ItemVolume with product code, name, quantity, barcode. Editable fields for weight/dimensions per volume. "Pendentes de Embalagem" section for unassigned items.
- [x] Add `gerarHtmlFichaAcompanhamentoCarregamento(carregamento)` method: generates HTML with header (vehicle plate, dock, transportadora), volumes ordered by sequência with code, type, weight, dimensions, checkbox column. Footer with total weight and volume count.
- [x] Add necessary TypeScript interfaces: `ItemSeparacaoEnriquecido` (with codigoBarra from SKU), `OndaComItensEnriquecidos`, `OndaComVolumesEPendentes`, `CarregamentoComVolumesCompleto`

**Requirements:** 1, 2, 3
**Design:** Component 1 (FichaService — New Tracking Sheet Methods)

## Task 10: Add ficha-acompanhamento endpoints to onda-separacao.routes.ts

- [x] Add `GET /:id/ficha-acompanhamento/separacao` endpoint: fetches onda with all items enriched (Produto, Endereco, SKU codigoBarra), calls `FichaService.gerarHtmlFichaAcompanhamentoSeparacao()`, returns HTML with Content-Type text/html. Returns 422 if onda has no items.
- [x] Add `GET /:id/ficha-acompanhamento/embalagem` endpoint: fetches onda with volumes and pending items, calls `FichaService.gerarHtmlFichaAcompanhamentoEmbalagem()`, returns HTML. Returns 422 if no items.

**Requirements:** 1, 2
**Design:** Component 5 (New Route Registrations)

## Task 11: Add ficha-acompanhamento endpoint to carregamento.routes.ts

- [x] Add `GET /:id/ficha-acompanhamento` endpoint: fetches carregamento with all volumes (using existing `buscarCarregamentoCompleto`), calls `FichaService.gerarHtmlFichaAcompanhamentoCarregamento()`, returns HTML with Content-Type text/html. Returns 422 if carregamento has no volumes.

**Requirements:** 3
**Design:** Component 5 (New Route Registrations)

## Task 12: Add OS synchronization hooks — Separação

- [x] In `PATCH /:id/iniciar` (onda-separacao.routes.ts): after OS auto-creation, update the OS to status EXECUTANDO, set horaInicio to current timestamp, and record funcionarioId (if available from the onda's ordens)
- [x] In `confirmarItem` (item-separacao.service.ts): when all items reach SEPARADO/SEPARADO_PARCIAL (onda → SEPARADA), find the OS with operacao SEPARACAO linked to the onda, update to CONCLUIDO, set horaFim, calculate tempoTotal = round((horaFim - horaInicio) / 60000) minutes
- [x] OS sync is non-blocking: wrap in try/catch, log warnings on failure, never block the main operation

**Requirements:** 7.1, 7.2, 7.3
**Design:** Component 4 (OS Synchronization Hooks)

## Task 13: Add OS synchronization hooks — Embalagem

- [x] In `POST /` (volume.routes.ts): when first volume is created (isFirstVolume), after OS auto-creation, update the OS to status EXECUTANDO, set horaInicio, record funcionarioId
- [x] In `POST /:id/itens` (volume.routes.ts): when all items packed (onda → EMBALADA), find OS with operacao EMBALAGEM, update to CONCLUIDO, set horaFim, calculate tempoTotal
- [x] Also add the same completion check in `POST /:id/embalar-scanner` after `verificarConclusaoEmbalagem`
- [x] OS sync is non-blocking

**Requirements:** 8.1, 8.2, 8.3
**Design:** Component 4 (OS Synchronization Hooks)

## Task 14: Add OS synchronization hooks — Carregamento

- [x] In `POST /:id/carregar-scanner` (carregamento.routes.ts): when first volume is loaded (check if this is the first carregadoEm being set), find OS with operacao CARREGAMENTO, update to EXECUTANDO, set horaInicio, record funcionarioId
- [x] In `POST /:id/carregar-scanner`: when all volumes loaded (carregamentoConcluido), find OS with operacao CARREGAMENTO, update to CONCLUIDO, set horaFim, calculate tempoTotal
- [x] In `PATCH /:id/confirmar`: same CONCLUIDO logic for the manual confirmation path
- [x] OS sync is non-blocking

**Requirements:** 9.1, 9.2, 9.3
**Design:** Component 4 (OS Synchronization Hooks)

## Task 15: Frontend — Monitoring components for Separação

- [x] Create monitoring component in `VisioFab.Wms.Front/src/app/(interna)/wms/picking/monitor/page.tsx`: displays real-time progress of separação with 5s polling to `GET /ondas/:id/monitor/separacao`
- [x] Show progress bar (percentual), summary cards (total, concluídos, pendentes), and item-level table (produto, endereço, qtd solicitada, qtd separada, status with color indicators)
- [x] Add "Imprimir Ficha de Acompanhamento" button that fetches `GET /ondas/:id/ficha-acompanhamento/separacao` via API (with auth token) and opens in new tab using `window.open` + `document.write`
- [x] Set browser tab title: `VisioFab - Monitor Separação`

**Requirements:** 4, 1
**Design:** Request Flow — Monitoring

## Task 16: Frontend — Monitoring components for Embalagem

- [x] Create monitoring component in `VisioFab.Wms.Front/src/app/(interna)/wms/embalagem/monitor/page.tsx`: displays real-time progress of embalagem with 5s polling to `GET /ondas/:id/monitor/embalagem`
- [x] Show progress bar, summary cards (total separados, embalados, pendentes), and volume-level table (código, tipo, itens, percentual)
- [x] Add "Imprimir Ficha de Acompanhamento" button that fetches `GET /ondas/:id/ficha-acompanhamento/embalagem` via API and opens in new tab
- [x] Set browser tab title: `VisioFab - Monitor Embalagem`

**Requirements:** 5, 2
**Design:** Request Flow — Monitoring

## Task 17: Frontend — Monitoring components for Carregamento

- [x] Create monitoring component in `VisioFab.Wms.Front/src/app/(interna)/wms/carregamento/monitor/page.tsx`: displays real-time progress of carregamento with 5s polling to `GET /carregamentos/:id/monitor`
- [x] Show progress bar, summary cards (total volumes, carregados, pendentes), and volume-level table (sequência, código, tipo, peso, status with color indicators)
- [x] Add "Imprimir Ficha de Acompanhamento" button that fetches `GET /carregamentos/:id/ficha-acompanhamento` via API and opens in new tab
- [x] Set browser tab title: `VisioFab - Monitor Carregamento`

**Requirements:** 6, 3
**Design:** Request Flow — Monitoring

## Task 18: Frontend — Stock View page with status breakdown

- [x] Create stock view page in `VisioFab.Wms.Front/src/app/(interna)/wms/estoque-visao/page.tsx`: product search/select, then displays stock breakdown from `GET /estoque/:produtoId/visao`
- [x] Display 4 cards with distinct visual indicators: Quantidade Total (blue), Reservado (yellow/orange), Em Trânsito (purple), Disponível (green)
- [x] Add to WMS sidebar navigation
- [x] Set browser tab title: `VisioFab - Visão Estoque`

**Requirements:** 13.3
**Design:** Component 5 (New Route Registrations)
