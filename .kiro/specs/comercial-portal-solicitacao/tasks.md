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

## Fase B — Campos da planilha Wega + tipo de pedido (com schema) — AGUARDA LISTA

- [ ] 4. Schema + migração dos campos novos
  - Colunas aditivas em `SolicitacaoOrcamentoRep` (tipoPedido, mercado, ufOrigem,
    cidade, tipoEntrega, localEntrega, fracionado, prazoPagamento, produtoNome,
    gramatura, precisaAmostra, + a confirmar) + migrate-prod idempotente.
  - _Requirements: 3.4_

- [ ] 5. Backend — aceitar/persistir os campos novos
  - `criarSolicitacaoSchema` + `criarSolicitacao` com os campos opcionais.
  - _Requirements: 3.1, 3.2, 3.3_

- [ ] 6. Frontend — formulário rico + tipo de pedido
  - Campos da planilha + `SegmentedControl` Repetição/Mostruário/Novos;
    Repetição mostra seleção de produto.
  - _Requirements: 3_

- [ ] 7. Verificação e documentação
  - get_diagnostics + não-regressão do formulário básico + atualizar doc-mestre
    e backlog.
  - _Requirements: 4_
