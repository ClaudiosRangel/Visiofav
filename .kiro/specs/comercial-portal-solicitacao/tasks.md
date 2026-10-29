# Implementation Plan — Portal: Solicitação + CNPJ (Bloco B2)

## Fase A — Consulta de CNPJ + cliente novo (sem schema)

- [x] 1. Rota de consulta de CNPJ no portal
  - `GET /clientes/cnpj/:cnpj` (portalRepAuth) em `portal-rep-clientes.routes.ts`:
    valida 14 dígitos, chama `enriquecerCnpj`, mapeia p/ campos do cadastro de
    cliente, 422 com aviso se não encontrar. Não grava. get_diagnostics limpo.
  - _Requirements: 1_

- [x] 2. Rota de cadastro de cliente novo pelo portal
  - JÁ EXISTIA: `POST /clientes` (`cadastrarCliente`) no portal. A Fase A só
    precisou do CNPJ (task 1) para autopreencher. Isolamento empresaId/vendedorId
    já no service.
  - _Requirements: 2_

- [ ] 2.1 Teste da validação/resolução de CNPJ (unit) — OPCIONAL
  - Validação inline (14 dígitos). `enriquecerCnpj` já é testado no módulo
    prospecção; cadastrarCliente já existe. Baixo valor marginal — pular por ora.
  - _Requirements: 1.2, 2.2_

- [x] 3. Frontend do portal — cadastrar cliente novo com CNPJ
  - `portal-rep/orcamentos/novo`: botão "Cadastrar cliente novo" → CNPJ + "Buscar
    na Receita" (`useConsultarCnpj`) → preenche razão/fantasia/cidade/UF/tel/email
    (editáveis) → "Salvar e selecionar" (`useCriarCliente`) → seleciona o criado.
    get_diagnostics limpo.
  - _Requirements: 1, 2_

## Fase B — Campos da planilha Wega + tipo de pedido (com schema) — FEITA

Planilha completa recebida (29/10/2026): `docs/planilha-pedidos-carton-wega.md`
(30 colunas transcritas das 3 imagens).

- [x] 4. Schema + migração dos campos novos
  - 23 colunas aditivas/nullable em `SolicitacaoOrcamentoRep` (tipoPedido,
    jaCliente, mercado, ufOrigem, cidade, tipoEntrega, entregaFracionadaDias,
    prazoPagamento, produtoNome, dataValidade, variacoesArte, exportacao, cartao,
    gramaturaTexto, cartaoFsc, medidasTexto, corteInternoVerso, passtime, matriz,
    acabamentoManual, quantidadePorVolume, anexo1Url, anexo2Url, discriminacao) +
    migrate-prod idempotente (ADD COLUMN IF NOT EXISTS em loop). prisma generate OK.
  - _Requirements: 3.4_

- [x] 5. Backend — aceitar/persistir os campos novos
  - `criarSolicitacaoSchema` (Zod, enums p/ tipoPedido/tipoEntrega/exportacao) +
    `CriarSolicitacaoInput` + `criarSolicitacao` (grava os campos) +
    `SOLICITACAO_SELECT` (comercial enxerga). get_diagnostics limpo.
  - _Requirements: 3.1, 3.2, 3.3_

- [x] 6. Frontend — formulário rico + tipo de pedido
  - `portal-rep/orcamentos/novo`: Card "Tipo de pedido" (SegmentedControl
    Novo/Repetição/Mostruário) + Card "Detalhes do pedido" com todos os campos da
    planilha (mercado, UF/cidade, entrega única/fracionada, exportação, cartão,
    gramatura, medidas texto, switches FSC/corte/passtime/manual, matriz,
    validade, volume, anexos, discriminação). Payload só envia preenchidos.
    `CriarSolicitacaoPayload` estendido. get_diagnostics limpo.
  - _Requirements: 3_

- [x] 7. Verificação e documentação
  - get_diagnostics limpo (back+front) + prisma generate + não-regressão (campos
    nullable/opcionais). Doc-mestre e planilha documentados.
  - _Requirements: 4_
