# Implementation Plan: Operações Outbound WMS (Dual-Mode)

## Overview

Implementação incremental do módulo de operações outbound dual-mode (Manual + Coletor) para o VisioFab WMS. O plano segue a ordem: modelos de dados → serviços backend → rotas API → componentes frontend → páginas → integração final. Cada tarefa estende o stack existente (Fastify + Prisma + PostgreSQL, Next.js 15 + Mantine UI) sem alterar a arquitetura atual.

## Tasks

- [x] 1. Criar model FichaOperacional e estender OrdemServicoWms no Prisma
  - [x] 1.1 Adicionar model `FichaOperacional` ao `prisma/schema.prisma` com campos: id, empresaId, tipo (SEPARACAO/EMBALAGEM/CARREGAMENTO/ENDERECAMENTO/CONFERENCIA), referenciaId, ordemServicoId, codigoBarras (unique), status (GERADA/IMPRESSA/DIGITALIZADA/CONFIRMADA), dadosOcr (JSON text), origemDados (MANUAL/OCR/SCANNER), criadoEm, atualizadoEm. Incluir indexes em [empresaId, tipo] e [referenciaId]
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6_
  - [x] 1.2 Estender model `OrdemServicoWms` adicionando campos opcionais `ondaSeparacaoId` e `carregamentoId` com relações para `OndaSeparacao` e `Carregamento`
    - _Requirements: 8.1, 8.2, 8.3_
  - [x] 1.3 Adicionar novas chaves de parâmetro ao seed ou documentação: `WMS_MODO_OPERACAO` (MANUAL/COLETOR/AMBOS), `WMS_OCR_PROVIDER` (MOCK/GOOGLE_VISION), `WMS_OCR_API_KEY`
    - _Requirements: 1.1, 1.2, 1.3, 1.4_
  - [x] 1.4 Gerar e aplicar a migration Prisma (`npx prisma migrate dev --name add-ficha-operacional-and-os-extensions`)
    - _Requirements: 3.1, 8.1_

- [x] 2. Implementar serviços backend core (OsAutoCreateService, ValidacaoLocalizacaoService)
  - [x] 2.1 Criar `src/modules/ordem-servico-wms/os-auto-create.service.ts` com métodos `criarOsSeparacao`, `criarOsEmbalagem`, `criarOsCarregamento`. Cada método cria uma `OrdemServicoWms` com tipo SAIDA, operação correspondente, e vincula ondaSeparacaoId ou carregamentoId. Gerar número sequencial por empresa
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5_
  - [x] 2.2 Criar `src/modules/scanner/validacao-localizacao.service.ts` com método `validar(barcodeEscaneado, enderecoEsperadoId, ordemServicoId, empresaId, usuarioId)`. Buscar endereço pelo barcode, comparar com esperado, registrar no AuditLog com entidade VALIDACAO_LOCALIZACAO incluindo endereço esperado, escaneado e resultado
    - _Requirements: 2.1, 2.2, 2.3, 2.5_
  - [ ]* 2.3 Escrever testes unitários para `OsAutoCreateService` — testar criação de OS para cada tipo de operação, geração de número sequencial, e vinculação correta de ondaSeparacaoId/carregamentoId
    - _Requirements: 8.1, 8.2, 8.3_
  - [ ]* 2.4 Escrever testes unitários para `ValidacaoLocalizacaoService` — testar validação com barcode correto, barcode incorreto, e registro de auditoria
    - _Requirements: 2.1, 2.2, 2.3, 2.5_

- [x] 3. Implementar serviço OCR (interface abstrata + mock)
  - [x] 3.1 Criar `src/modules/ocr/ocr.interface.ts` com interface `IOcrService` definindo método `processarImagem(imagem: Buffer, formato: 'JPEG' | 'PNG' | 'PDF'): Promise<OcrCampo[]>` e tipo `OcrCampo` com campos nome, valor, confianca, boundingBox opcional
    - _Requirements: 4.1_
  - [x] 3.2 Criar `src/modules/ocr/mock-ocr.service.ts` implementando `IOcrService` — retorna array vazio de campos para preenchimento manual
    - _Requirements: 4.1, 4.2_
  - [x] 3.3 Criar `src/modules/ocr/ocr.factory.ts` que lê o parâmetro `WMS_OCR_PROVIDER` da empresa e retorna a implementação correta (MockOcrService por padrão)
    - _Requirements: 4.1_

- [x] 4. Implementar FichaService para geração de fichas HTML e ZPL
  - [x] 4.1 Criar `src/modules/ficha-operacional/ficha.service.ts` com métodos: `gerarHtmlSeparacao(onda)`, `gerarHtmlEmbalagem(onda)`, `gerarHtmlCarregamento(carregamento)`, `gerarHtmlEnderecamento(nota)`, `gerarHtmlConferencia(conferencia)`. Cada método gera HTML com dados da operação, campos em branco para preenchimento manual, e código de barras identificador único
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6_
  - [x] 4.2 Adicionar método `gerarZplFicha(ficha)` ao `FichaService` para gerar ZPL compatível com impressoras térmicas Zebra
    - _Requirements: 3.5_
  - [x] 4.3 Adicionar métodos `gerarRomaneioHtml(carregamento)` e `gerarRomaneioPdf(carregamento)` ao `FichaService` — romaneio contendo dados do veículo, transportadora, doca, lista de volumes com sequência, peso total e quantidade total
    - _Requirements: 7.6, 13.2, 13.4_
  - [ ]* 4.4 Escrever testes unitários para `FichaService` — testar geração de HTML para cada tipo de ficha, inclusão de código de barras, e campos em branco
    - _Requirements: 3.1, 3.2, 3.3, 3.4_

- [x] 5. Checkpoint — Verificar modelos e serviços backend
  - Ensure all tests pass, ask the user if questions arise.

- [x] 6. Criar rotas de Fichas Operacionais e OCR
  - [x] 6.1 Criar `src/modules/ficha-operacional/ficha-operacional.routes.ts` com rotas: `POST /` (gerar ficha), `GET /:id` (dados da ficha com status OCR), `GET /:id/html` (HTML para impressão), `GET /:id/zpl` (ZPL para térmica), `PATCH /:id/confirmar` (confirmar dados pós-OCR). Usar schemas Zod para validação. Registrar no `server.ts` com prefix `/api/fichas-operacionais`
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 4.4, 4.5_
  - [x] 6.2 Criar `src/modules/ocr/ocr.routes.ts` com rotas: `POST /processar` (recebe imagem base64, fichaOperacionalId e formato; processa via OcrFactory; retorna campos com confiança), `GET /resultado/:fichaId` (retorna resultado OCR de uma ficha). Registrar no `server.ts` com prefix `/api/ocr`
    - _Requirements: 4.1, 4.2, 4.3, 4.5, 4.6_

- [x] 7. Criar rotas do Scanner (validação de localização e produto)
  - [x] 7.1 Criar `src/modules/scanner/scanner.routes.ts` com rotas: `POST /validar-localizacao` (valida barcode de endereço vs esperado usando ValidacaoLocalizacaoService), `POST /validar-produto` (valida barcode de produto vs item esperado buscando por EAN/código no Sku/Produto). Registrar no `server.ts` com prefix `/api/scanner`
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 5.3, 5.4_
  - [x] 7.2 Adicionar rotas de confirmação ao scanner: `POST /confirmar-separacao` (confirma item separado via scanner com validação de produto e atualização de quantidadeSeparada), `POST /confirmar-embalagem` (vincula item ao volume via scanner), `POST /confirmar-carregamento` (confirma volume carregado via scanner com validação de pertencimento e registro de timestamp)
    - _Requirements: 5.3, 5.4, 5.5, 6.3, 7.3, 7.4_
  - [ ]* 7.3 Escrever testes unitários para rotas do scanner — testar validação de localização correta/incorreta, validação de produto correto/incorreto, confirmação de separação com atualização de quantidade
    - _Requirements: 2.1, 2.2, 2.3, 5.3, 5.4_

- [x] 8. Estender rotas existentes de Ondas de Separação e Itens de Separação
  - [x] 8.1 Adicionar rota `GET /:id/rota-coleta` ao módulo `onda-separacao` — retorna itens da onda ordenados por rota otimizada de coleta (rua → prédio → nível do endereço de origem), selecionando endereço por FEFO/FIFO conforme dados logísticos do produto
    - _Requirements: 5.1, 5.2_
  - [x] 8.2 Adicionar rota `POST /:id/gerar-ficha` ao módulo `onda-separacao` — gera FichaOperacional de separação usando FichaService e cria registro no banco
    - _Requirements: 3.1, 5.9_
  - [x] 8.3 Adicionar rota `POST /:id/confirmar-scanner` ao módulo `item-separacao` — confirma separação de item via scanner com validação de produto, atualização de quantidadeSeparada e timestamp. Quando quantidade < solicitada, exigir motivo de divergência (PRODUTO_NAO_ENCONTRADO, QUANTIDADE_INSUFICIENTE, AVARIA)
    - _Requirements: 5.3, 5.4, 5.5, 5.6, 12.1, 12.2, 12.3_
  - [x] 8.4 Adicionar rota `GET /:id/enderecos-alternativos` ao módulo `item-separacao` — quando saldo insuficiente no endereço de origem, sugere endereços alternativos com saldo disponível do mesmo produto
    - _Requirements: 12.5_
  - [x] 8.5 Adicionar lógica de conclusão de OrdemSeparacao: quando todos itens de uma ordem forem separados, atualizar status para CONCLUIDA. Quando houver divergências, manter como SEPARADO_PARCIAL e notificar gestor
    - _Requirements: 5.7, 12.4_

- [x] 9. Estender rotas de Conferência de Saída
  - [x] 9.1 Adicionar rota `POST /:id/conferir-scanner` ao módulo `conferencia-saida` — confere item via scanner no modo coletor: escaneia Produto_Barcode, registra quantidade conferida, compara com quantidade separada. Quando divergente, registra resultado como DIVERGENTE com tipo (FALTA, EXCESSO, PRODUTO_ERRADO)
    - _Requirements: 10.1, 10.2, 10.3_
  - [x] 9.2 Adicionar rota `POST /:id/gerar-ficha` ao módulo `conferencia-saida` — gera FichaOperacional de conferência com itens e campos em branco para quantidade conferida
    - _Requirements: 10.4_
  - [x] 9.3 Adicionar lógica de conclusão de conferência: quando todos itens conferidos e aprovados, atualizar status da OndaSeparacao para CONFERIDA
    - _Requirements: 10.5_

- [x] 10. Estender rotas de Volumes e Embalagem
  - [x] 10.1 Adicionar rota `POST /:id/embalar-scanner` ao módulo `volume` — vincula item ao volume via scanner: escaneia Produto_Barcode, valida que item pertence à OndaSeparacao do volume, atualiza quantidade embalada. Rejeitar se item não pertence à onda
    - _Requirements: 6.2, 6.3, 6.4_
  - [x] 10.2 Adicionar rota `GET /pendentes-embalagem/:ondaId` ao módulo `volume` — lista itens separados pendentes de embalagem agrupados por pedido de venda
    - _Requirements: 6.8_
  - [x] 10.3 Adicionar validação de peso/dimensões positivos ao registrar volume e lógica de finalização: gerar etiqueta HTML e ZPL contendo código de barras, tipo, peso e quantidade de itens
    - _Requirements: 6.5, 6.6_
  - [x] 10.4 Adicionar lógica de conclusão de embalagem: quando todos itens separados de uma onda forem embalados, atualizar status da OndaSeparacao para EMBALADA
    - _Requirements: 6.7_

- [x] 11. Estender rotas de Carregamento
  - [x] 11.1 Adicionar rota `POST /:id/carregar-scanner` ao módulo `carregamento` — confirma volume carregado via scanner: valida que volume pertence ao carregamento, registra timestamp de carregamento. Se volume não pertence, rejeitar com alerta. Se fora de sequência, retornar aviso com sequência correta
    - _Requirements: 7.3, 7.4, 7.5, 7.8_
  - [x] 11.2 Adicionar rotas de romaneio ao módulo `carregamento`: `GET /:id/romaneio` (dados completos), `GET /:id/romaneio/html` (HTML para impressão), `GET /:id/romaneio/pdf` (PDF para envio digital). Usar FichaService para geração
    - _Requirements: 7.6, 13.2, 13.4_
  - [x] 11.3 Adicionar lógica de conclusão de carregamento: quando todos volumes confirmados, atualizar status para CONCLUIDO com timestamp. Atualizar status dos volumes para CARREGADO
    - _Requirements: 7.7, 7.8_

- [x] 12. Estender rotas de Etiquetas
  - [x] 12.1 Adicionar rotas `GET /volume/:id/html` e `GET /volume/:id/zpl` ao módulo `etiqueta` — gerar etiqueta de volume contendo código de barras, tipo (CAIXA/PALETE/FARDO), peso, quantidade de itens e número do pedido de venda
    - _Requirements: 13.1, 13.3_

- [x] 13. Integrar criação automática de OS nas operações outbound
  - [x] 13.1 Integrar `OsAutoCreateService` na rota de iniciar onda (`PATCH /ondas-separacao/:id/iniciar`) — criar OS tipo SAIDA operação SEPARACAO automaticamente
    - _Requirements: 8.1_
  - [x] 13.2 Integrar `OsAutoCreateService` no início do processo de embalagem — criar OS tipo SAIDA operação EMBALAGEM quando embalagem iniciar para uma onda
    - _Requirements: 8.2_
  - [x] 13.3 Integrar `OsAutoCreateService` na criação de carregamento (`POST /carregamentos`) — criar OS tipo SAIDA operação CARREGAMENTO automaticamente
    - _Requirements: 8.3_
  - [x] 13.4 Adicionar lógica de assumir OS: quando operador assumir, registrar funcionário, hora de início e status EXECUTANDO. Na conclusão, registrar hora de fim e calcular tempo total em minutos
    - _Requirements: 8.4, 8.5, 8.6_

- [x] 14. Checkpoint — Verificar todas as rotas backend e integrações
  - Ensure all tests pass, ask the user if questions arise.

- [x] 15. Criar componentes frontend reutilizáveis (BarcodeScannerInput, ScanFeedback)
  - [x] 15.1 Criar componente `VisioFab.Web/src/components/shared/BarcodeScannerInput.tsx` — campo TextInput Mantine com autoFocus, detecção de leitura de scanner por velocidade de digitação (< 50ms entre caracteres), disparo de callback `onScan` ao detectar Enter ou timeout, limpeza automática do campo, e retorno de foco após cada operação
    - _Requirements: 1.3, 11.4_
  - [x] 15.2 Criar componente `VisioFab.Web/src/components/shared/ScanFeedback.tsx` — feedback sensorial com Web Audio API: sucesso (flash verde + beep 800Hz 150ms), erro (flash vermelho + buzz 300Hz 300ms + mensagem), aviso (flash amarelo + ding 600Hz 200ms + mensagem). Usar CSS @keyframes para animações de flash
    - _Requirements: 11.1, 11.2, 11.3_
  - [ ]* 15.3 Escrever testes unitários para `BarcodeScannerInput` — testar detecção de scanner vs digitação manual, disparo de onScan, limpeza de campo e retorno de foco
    - _Requirements: 1.3, 11.4_

- [x] 16. Criar componentes frontend de Fichas e OCR
  - [x] 16.1 Criar componente `VisioFab.Web/src/components/shared/FichaOperacionalViewer.tsx` — visualizador de ficha operacional com botão de impressão (abre HTML em nova aba) e botão de download ZPL
    - _Requirements: 3.5, 3.6_
  - [x] 16.2 Criar componente `VisioFab.Web/src/components/shared/OcrUploadDialog.tsx` — modal Mantine para upload de imagem (JPEG, PNG, PDF), preview da imagem, chamada à API `/api/ocr/processar`, exibição de campos extraídos com indicador de confiança (campos < 80% destacados em amarelo), e botão de confirmação
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.6_

- [x] 17. Criar hooks TanStack Query para as novas APIs
  - [x] 17.1 Criar `VisioFab.Web/src/data/fichas-operacionais/` com hooks: `useGerarFicha`, `useFicha`, `useFichaHtml`, `useConfirmarFicha`
    - _Requirements: 3.1, 3.2, 3.3, 3.4_
  - [x] 17.2 Criar `VisioFab.Web/src/data/scanner/` com hooks: `useValidarLocalizacao`, `useValidarProduto`, `useConfirmarSeparacao`, `useConfirmarEmbalagem`, `useConfirmarCarregamento`
    - _Requirements: 2.1, 5.3, 6.3, 7.3_
  - [x] 17.3 Criar `VisioFab.Web/src/data/ocr/` com hooks: `useProcessarOcr`, `useResultadoOcr`
    - _Requirements: 4.1, 4.2_
  - [x] 17.4 Estender hooks existentes em `VisioFab.Web/src/data/` para as novas rotas: `useRotaColeta`, `useEnderecosAlternativos`, `useConferirScanner`, `useEmbalarScanner`, `usePendentesEmbalagem`, `useCarregarScanner`, `useRomaneio`, `useEtiquetaVolume`
    - _Requirements: 5.1, 5.2, 10.1, 10.2, 6.3, 6.8, 7.3, 7.6, 13.1_

- [x] 18. Criar página de Picking Modo Coletor
  - [x] 18.1 Criar página `VisioFab.Web/src/app/(interna)/picking/[ondaId]/coletor/page.tsx` — layout fullscreen otimizado para mobile/coletor com: header (número da onda, progresso X/Y itens, timer), corpo (item atual com endereço de origem, produto, quantidade), `<BarcodeScannerInput>` para validação de localização e produto, `<ScanFeedback>` para feedback visual/sonoro, footer com botões de divergência e navegação
    - _Requirements: 1.3, 2.1, 2.2, 2.3, 2.4, 5.2, 5.3, 5.4, 5.5, 5.6, 11.1, 11.2, 11.3, 11.4_
  - [x] 18.2 Implementar fluxo de validação de localização na página: ao mudar de endereço, exigir scan do Endereco_Barcode antes de permitir ações sobre itens. Bloquear operação se barcode não corresponder
    - _Requirements: 2.1, 2.2, 2.3, 2.4_
  - [x] 18.3 Implementar fluxo de divergência na página: quando quantidade separada < solicitada, exibir modal para selecionar motivo (PRODUTO_NAO_ENCONTRADO, QUANTIDADE_INSUFICIENTE, AVARIA). Quando AVARIA, gerar alerta para gestor
    - _Requirements: 5.6, 12.1, 12.2, 12.3, 12.4_

- [x] 19. Criar página de Picking Modo Manual
  - [x] 19.1 Criar página `VisioFab.Web/src/app/(interna)/picking/[ondaId]/manual/page.tsx` — lista de itens com campos editáveis para quantidade separada, botão "Imprimir Ficha" (abre HTML em nova aba via `<FichaOperacionalViewer>`), botão "Digitalizar Ficha" (abre `<OcrUploadDialog>`), campos pré-preenchidos pelo OCR com indicadores de confiança
    - _Requirements: 1.2, 3.1, 4.2, 4.3, 4.4, 5.9_

- [x] 20. Criar seletor de modo de operação
  - [x] 20.1 Criar componente `VisioFab.Web/src/components/shared/ModoOperacaoSelector.tsx` — lê parâmetro `WMS_MODO_OPERACAO` da empresa. Se MANUAL, redireciona para modo manual. Se COLETOR, redireciona para modo coletor. Se AMBOS, exibe seletor para o operador escolher. Aplicar para Separação, Conferência, Endereçamento, Embalagem e Carregamento
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5_

- [x] 21. Checkpoint — Verificar páginas de picking e componentes reutilizáveis
  - Ensure all tests pass, ask the user if questions arise.

- [x] 22. Criar página de Conferência de Saída dual-mode
  - [x] 22.1 Criar página `VisioFab.Web/src/app/(interna)/conferencia-saida/[ondaId]/page.tsx` — modo coletor: lista de itens separados com foco automático no campo de leitura, scan de Produto_Barcode registra quantidade conferida e compara com separada. Modo manual: impressão de ficha de conferência e upload OCR. Quando divergente, registrar tipo (FALTA, EXCESSO, PRODUTO_ERRADO)
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5_

- [x] 23. Criar página de Estação de Embalagem
  - [x] 23.1 Criar página `VisioFab.Web/src/app/(interna)/expedicao/embalagem/[ondaId]/page.tsx` — painel esquerdo: lista de itens pendentes de embalagem agrupados por pedido. Painel direito: volume ativo com itens vinculados. `<BarcodeScannerInput>` para vincular itens ao volume. Formulário de peso/dimensões com validação de valores positivos. Botão "Finalizar Volume" gera etiqueta. Botão "Novo Volume" cria volume com código sequencial
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 6.8_

- [x] 24. Criar página de Doca de Carregamento
  - [x] 24.1 Criar página `VisioFab.Web/src/app/(interna)/expedicao/carregamento/[carregamentoId]/page.tsx` — header com dados do veículo, doca e progresso. Lista de volumes com sequência e status (carregado/pendente). `<BarcodeScannerInput>` para confirmar volumes. Aviso amarelo quando volume fora de sequência. Botão "Imprimir Romaneio". Botão "Concluir Carregamento"
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7, 7.8_

- [x] 25. Criar página de Gestão de Fichas Operacionais
  - [x] 25.1 Criar página `VisioFab.Web/src/app/(interna)/wms/fichas-operacionais/page.tsx` — tabela de fichas com filtros (tipo, status, data), ações: imprimir (abre HTML), digitalizar (abre OcrUploadDialog), ver resultado OCR
    - _Requirements: 3.1, 3.5, 3.6, 4.1, 4.4_

- [x] 26. Integrar endereçamento dual-mode
  - [x] 26.1 Estender módulo `enderecamento-wms` no backend: adicionar validação de localização por barcode no modo coletor, validação de Produto_Barcode contra item da nota de entrada, e registro de movimento no LogMovimentacao com tipo ENDERECAMENTO
    - _Requirements: 9.1, 9.2, 9.5_
  - [x] 26.2 Adicionar suporte a ficha de endereçamento no backend: rota para gerar ficha com campos em branco para endereço de destino e processamento OCR dos endereços preenchidos
    - _Requirements: 9.3, 9.4_

- [x] 27. Registrar todas as novas rotas no server.ts
  - [x] 27.1 Importar e registrar no `src/server.ts`: `fichaOperacionalRoutes` com prefix `/api/fichas-operacionais`, `ocrRoutes` com prefix `/api/ocr`, `scannerRoutes` com prefix `/api/scanner`
    - _Requirements: 1.1, 2.1, 3.1, 4.1_

- [x] 28. Final checkpoint — Verificar integração completa
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- The design has no Correctness Properties section, so property-based tests are not included
- The OCR service starts with a mock implementation — real OCR (Google Vision) can be swapped in later via the `WMS_OCR_PROVIDER` parameter
- All new routes follow the existing Fastify + Zod + Prisma pattern established in the codebase
- Frontend pages follow the Next.js 15 App Router pattern with `(interna)` layout group
