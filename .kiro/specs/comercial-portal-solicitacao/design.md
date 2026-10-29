# Design — Portal: Formulário de Solicitação + CNPJ (Bloco B2)

## Overview

Duas fases. A **Fase A** (consulta de CNPJ + cadastro de cliente novo pelo
portal) não toca schema e será implementada já. A **Fase B** (campos da planilha
Wega + tipo de pedido) adiciona colunas a `SolicitacaoOrcamentoRep` e depende da
lista final de campos — fica especificada, implementada quando o usuário
confirmar os campos.

Reaproveita `enriquecerCnpj` (módulo `prospeccao`, BrasilAPI/CNPJá Open — grátis,
já em produção). Não reimplementa consulta de CNPJ.

## Fase A — Consulta de CNPJ + cliente novo (sem schema)

### Backend

**1. Rota de consulta de CNPJ no portal** (`portal-rep-solicitacao.routes.ts` ou
um arquivo irmão no portal), protegida por `portalRepAuth`:
- `GET /portal-rep/cnpj/:cnpj` → valida 14 dígitos; chama `enriquecerCnpj`;
  retorna `{ cnpj, razaoSocial, nomeFantasia, logradouro, numero, bairro, cidade,
  uf, cep, telefone, email }` ou 422 com aviso se não encontrar. NÃO grava nada.

**2. Cadastro de cliente novo pelo portal** — rota autenticada pelo portal:
- `POST /portal-rep/clientes` com `{ cnpj, razaoSocial, nomeFantasia?, endereço }`.
  Resolve por CNPJ (só dígitos) dentro da `empresaId` do token:
  - Se já existe → retorna o existente (não duplica — Req 2.2).
  - Senão → cria `Cliente` na empresa do token com os campos mínimos exigidos
    pelo cadastro atual de `Cliente` (reusar o service de criação de cliente
    existente, não escrever direto). Associa à carteira do representante se o
    modelo exigir.
- Isolamento: `empresaId`/`vendedorId` do token; nunca aceitar empresaId do body.

### Frontend (portal-rep)

- No formulário de nova solicitação (`portal-rep/orcamentos/novo`), quando o
  representante não achar o cliente na lista, abrir um fluxo "Cadastrar cliente
  novo": campo CNPJ → botão "Buscar na Receita" (chama `GET /portal-rep/cnpj/:cnpj`)
  → preenche razão/fantasia/endereço (editáveis) → "Salvar cliente"
  (`POST /portal-rep/clientes`) → seleciona o cliente recém-criado.

## Fase B — Campos da planilha Wega + tipo de pedido (com schema)

> Depende da LISTA FINAL de campos (usuário vai confirmar). Especificação
> preliminar abaixo.

### Schema (`SolicitacaoOrcamentoRep`, aditivo/idempotente)

Colunas novas nullable (null = legado, não-regressão):
- `tipoPedido` VARCHAR(12) — REPETICAO | MOSTRUARIO | NOVO (default null).
- `mercado` VARCHAR(120) — segmento/ramo do cliente.
- `ufOrigem` VARCHAR(2), `cidade` VARCHAR(120).
- `tipoEntrega` VARCHAR(60), `localEntrega` VARCHAR(200).
- `fracionado` BOOLEAN.
- `prazoPagamento` VARCHAR(60).
- `produtoNome` VARCHAR(200) — nome do produto (texto livre quando não há cadastro).
- `gramatura` DECIMAL(10,2).
- `precisaAmostra` BOOLEAN.
- (demais a confirmar contra a planilha.)

`migrate-prod.ts` no mesmo commit: `ALTER TABLE solicitacao_orcamento_rep ADD
COLUMN IF NOT EXISTS ...` para cada coluna (idempotente). Postgres local off →
roda no deploy.

### Backend
- `criarSolicitacaoSchema` + `criarSolicitacao` aceitam os campos novos (todos
  opcionais). Persistem em `SolicitacaoOrcamentoRep`.
- O comercial (ao assumir/precificar) enxerga os campos novos (já lê a solicitação).

### Frontend
- Formulário do portal ganha os campos + `SegmentedControl` de tipo de pedido.
  Repetição → mostra seleção de produto/cálculo (reusa `produtoId`).

## Error Handling
- CNPJ inválido → 400 sem chamar API externa.
- API pública indisponível → 422 com aviso (fluxo manual preservado).
- Cliente duplicado por CNPJ → retorna o existente (não erro).

## Testing Strategy
- Fase A: a validação de CNPJ (14 dígitos, só dígitos) é função pura testável.
  `enriquecerCnpj` já existe (não retestar a API externa). Teste de resolução de
  cliente por CNPJ (existente vs novo). Verificação: `get_diagnostics` +
  conferência manual no portal.
- Fase B: migração idempotente testada; não-regressão do formulário básico.
