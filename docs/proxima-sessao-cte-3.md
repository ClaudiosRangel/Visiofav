# Próxima Sessão CT-e (3) — Melhorias de UX e DACTE

## Itens solicitados

### 1. Municípios por UF com código IBGE (frontend)

**O que fazer**: Trocar os TextInputs de município por Autocomplete/Select que:
- Ao selecionar a UF, carrega a lista de municípios daquela UF via API IBGE
- Ao selecionar o município, preenche automaticamente o código IBGE
- Funciona em: Origem, Destino, Remetente, Destinatário

**Backend**: Rota já existe (`GET /cte/municipios?uf=RJ`)
**Frontend**: Criar componente `MunicipioAutocomplete` reutilizável

### 2. Remetente/Destinatário com busca por nome (frontend)

**O que fazer**: Adicionar Autocomplete nos campos de Remetente e Destinatário
que busca no cadastro de Clientes/Fornecedores por nome/razão social (sem
precisar digitar CNPJ). Ao selecionar, preenche todos os campos.

**Backend**: Criar rota `GET /cte/buscar-participantes?q=HAVASA` que busca por
razão social em Clientes e Fornecedores (fuzzy/contains).

### 3. Observações/Info complementares cadastráveis (backend + frontend)

**O que fazer**: Criar uma "biblioteca de observações" que o usuário cadastra
uma vez e depois seleciona de uma lista ao emitir CT-e.

**Backend**: Modelo `ObservacaoPadraoCte` (empresaId, codigo, texto) + CRUD
**Frontend**: Na seção "Informações Complementares" da emissão, botão para
buscar/selecionar observação pré-cadastrada. Tela de cadastro em
Fiscal → Cadastros → Observações CT-e.

### 4. Consultar SEFAZ (backend + frontend)

**O que fazer**: No menu de ações (⋮) do CT-e, opção "Consultar SEFAZ" que
chama o webservice `CTeConsultaV4` com a chave de acesso e retorna o status
real do documento na SEFAZ.

**Backend**: Nova rota `POST /cte/:id/consultar-sefaz` que usa o
`sefaz-client.ts` para chamar o WS de consulta.
**Frontend**: Item de menu + modal com resultado (cStat, xMotivo, protocolo).

### 5. DACTE Modelo 1 em retrato (backend)

**O que fazer**: O modelo atual é paisagem. Criar versão retrato do mesmo
layout (mesmo conteúdo, só redistribuição dos quadros para caber em A4
retrato).

### 6. DACTE Modelo 2 — estilo ACBr (backend)

**O que fazer**: Criar um segundo modelo de DACTE inspirado no layout ACBr
(como na imagem fornecida): retrato por padrão, com canhoto no topo,
quadro do emitente com QR Code e code128, dados organizados em colunas.

Disponível em retrato E paisagem.

### 7. Configuração de preferência DACTE (backend + frontend)

**O que fazer**: Tela de configuração (em Fiscal → Configurações ou nos
defaults do CT-e) onde a empresa define:
- Modelo preferido: "Modelo 1" ou "Modelo 2 (ACBr)"
- Orientação preferida: "Paisagem" ou "Retrato"

Persistir como parâmetros (`cte.dacteModelo`, `cte.dacteOrientacao`).

---

## Prioridade de implementação

1. Item 1 — Municípios (impacto alto em UX)
2. Item 2 — Busca participantes por nome
3. Item 3 — Observações cadastráveis
4. Item 4 — Consultar SEFAZ
5. Item 5 — DACTE Modelo 1 retrato
6. Item 6 — DACTE Modelo 2 (ACBr)
7. Item 7 — Configuração preferência DACTE

## Status

- [ ] Item 1 — Municípios por UF
- [ ] Item 2 — Busca participantes
- [ ] Item 3 — Observações cadastráveis
- [ ] Item 4 — Consultar SEFAZ
- [ ] Item 5 — DACTE M1 retrato
- [ ] Item 6 — DACTE M2 (ACBr)
- [ ] Item 7 — Config preferência
