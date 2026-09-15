# Design Document

Central de Documentos Financeiros — Fase D1 — Vizor ERP

## Overview

Adiciona tipagem de documento, fornecedor PF/PJ (detecção automática),
formulário rico (fiando o `inclusao-titulo.service` existente) e contratos de
parcelamento consolidados. Estende `ContaPagar`/`ContaReceber` e `Fornecedor`
sem quebra; núcleo de validação de CPF/CNPJ puro e testável; migração
idempotente. Frontend reformula o modal de inclusão e adiciona tela de contratos.

## Architecture

```
Núcleo puro:
  documento-validacao.ts  → validarCpf, validarCnpj, detectarTipoPessoa, normalizarDoc
Backend (estende financeiro):
  inclusao-titulo.service.ts (JÁ EXISTE) → + tipoDocumento, parceiroNomeLivre/docLivre, campos de guia
  contrato-parcelamento.service.ts (novo) → criar contrato + gerar N títulos + saldo devedor
  conta-pagar.routes.ts / conta-receber.routes.ts → POST rico (usa incluirTitulo) + POST /interpretar-boleto
  financeiro.routes.ts → rotas de contrato (POST /contratos, GET /contratos, GET /contratos/:id)
Frontend:
  DocumentoFinanceiroForm (modal 4 blocos) reusado por contas-pagar e contas-receber
  ParceiroAutocomplete (busca fornecedor/cliente ou livre + CPF/CNPJ dinâmico)
  /financeiro/contratos (tela)
```

## Components and Interfaces

### 1. Núcleo puro — `documento-validacao.ts`
```ts
normalizarDoc(doc: string): string              // só dígitos
detectarTipoPessoa(doc: string): 'FISICA' | 'JURIDICA' | null  // 11 | 14 | null
validarCpf(cpf: string): boolean                // DV
validarCnpj(cnpj: string): boolean              // DV
validarDocumento(doc: string): { valido: boolean; tipoPessoa: 'FISICA'|'JURIDICA'|null }
```
Determinístico, sem I/O. Base dos property tests (DV correto, detecção por tamanho).

### 2. `inclusao-titulo.service.ts` (estender — já existe)
- Adicionar ao `InclusaoTituloInput`: `tipoDocumento`, `subtipo`, `parceiroNomeLivre`, `parceiroDocLivre`, e campos de guia de imposto (`codigoReceita`, `competenciaGuia`, `referenciaOrgao`) — todos opcionais.
- Ao incluir: gravar `tipoDocumento` (default OUTRO), e se `parceiroId` ausente mas nome livre presente, gravar nome/doc no título (campos novos) sem exigir cadastro.
- `interpretarLinhaDigitavel` já existe — expor via rota.

### 3. `contrato-parcelamento.service.ts` (novo)
```ts
criarContrato(prisma, empresaId, input): gera Contrato + N ContaPagar vinculadas (contratoId)
obterContrato(prisma, empresaId, id): { contrato, parcelas[], totalPago, saldoDevedor }
listarContratos(prisma, empresaId)
```
Saldo devedor = total − Σ parcelas pagas (derivado, sempre consistente).

### 4. Rotas
- `conta-pagar`/`conta-receber`: o `POST /` passa a aceitar o payload rico e delegar a `incluirTitulo` (já parcelava). Novo `POST /interpretar-boleto` (linha digitável → valor/vencimento).
- `financeiro.routes.ts`: `POST /contratos`, `GET /contratos`, `GET /contratos/:id`.

### 5. Frontend
- `DocumentoFinanceiroForm.tsx`: modal 4 blocos, reutilizado por contas a pagar/receber (prop `tipo`). Usa `ParceiroAutocomplete`.
- `ParceiroAutocomplete.tsx`: busca no cadastro (fornecedor/cliente) + permite livre; campo documento com máscara/validação dinâmica CPF/CNPJ.
- `/financeiro/contratos/page.tsx`: criar contrato + listar com saldo devedor.

## Data Models

Colunas aditivas (nullable) em `ContaPagar` e `ContaReceber`:
```prisma
tipoDocumento     String?  @map("tipo_documento") @db.VarChar(20)   // default lógico OUTRO
subtipoDocumento  String?  @map("subtipo_documento") @db.VarChar(60)
parceiroNomeLivre String?  @map("parceiro_nome_livre") @db.VarChar(200)
parceiroDocLivre  String?  @map("parceiro_doc_livre") @db.VarChar(20)
contratoId        String?  @map("contrato_id")
// guia de imposto (só tipo IMPOSTO)
codigoReceita     String?  @map("codigo_receita") @db.VarChar(20)
competenciaGuia   String?  @map("competencia_guia") @db.VarChar(7)
referenciaOrgao   String?  @map("referencia_orgao") @db.VarChar(60)
```

`Fornecedor` (+ aditivo): `tipoPessoa String? @map("tipo_pessoa") @db.VarChar(10)` (FISICA/JURIDICA, inferido; não altera o campo `cnpj` existente que já aceita CPF).

Model novo `ContratoParcelamento`:
```prisma
model ContratoParcelamento {
  id            String   @id @default(uuid())
  empresaId     String   @map("empresa_id")
  descricao     String   @db.VarChar(300)
  tipo          String   @db.VarChar(20)  // FINANCIAMENTO | IMPOSTO | OUTRO
  fornecedorId  String?  @map("fornecedor_id")
  parceiroNomeLivre String? @map("parceiro_nome_livre") @db.VarChar(200)
  valorTotal    Decimal  @map("valor_total") @db.Decimal(14,2)
  entrada       Decimal? @db.Decimal(14,2)
  numeroParcelas Int     @map("numero_parcelas")
  taxaJuros     Decimal? @map("taxa_juros") @db.Decimal(8,4)
  dataPrimeira  DateTime @map("data_primeira")
  status        String   @default("ATIVO") @db.VarChar(20)
  criadoEm      DateTime @default(now()) @map("criado_em")
  @@index([empresaId])
  @@map("contrato_parcelamento")
}
```

Migração idempotente no mesmo commit (`ADD COLUMN IF NOT EXISTS` nos títulos e fornecedor; `CREATE TABLE IF NOT EXISTS` contrato).

## Error Handling

| Situação | Resposta |
|----------|----------|
| Documento (CPF/CNPJ) inválido | 422 "documento: dígito verificador inválido" |
| Zod inválido | 422 "campo: motivo" |
| Parceiro/contrato de outra empresa | 404 |
| Contrato de outra empresa | 404 |
| Parcelas fora de 1..360 | 422 |

## Testing Strategy

- **Núcleo puro (fast-check + unit):** validarCpf/validarCnpj (DVs conhecidos + property: doc gerado válido passa, alterar 1 dígito reprova), detectarTipoPessoa (11→FISICA, 14→JURIDICA), determinismo.
- **Services (unit):** incluirTitulo com tipo/parceiro livre; contrato gera N títulos e saldo devedor decrescente ao pagar.
- **QA E2E:** `test_45_documentos_financeiros.py`.
- **Migração:** idempotente 2x.

## Correctness Properties

### Property 1: Validação de documento correta
Um CPF/CNPJ gerado válido passa; alterar um dígito qualquer reprova.
**Validates: Requirements 2.2, 2.4**

### Property 2: Detecção de tipo por tamanho
11 dígitos → FISICA, 14 → JURIDICA, outro tamanho → null.
**Validates: Requirements 2.1**

### Property 3: Parcelamento fecha
A soma das N parcelas geradas é igual ao valor total (tolerância 0,01).
**Validates: Requirements 4.3, 5.2**

### Property 4: Saldo devedor consistente
Saldo do contrato == total − Σ parcelas pagas, sempre.
**Validates: Requirements 5.3, 5.4**

### Property 5: Isolamento
Toda consulta/criação só afeta registros do `empresaId` pedido.
**Validates: Requirements 8.1**
