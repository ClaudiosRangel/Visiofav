# Design Document

Central de Documentos Financeiros — Fase D2: Vizor AI autônoma — Vizor ERP

## Overview

Adiciona ao chat da Vizor AI a capacidade de lançar documentos financeiros a
partir de: (a) PDF com texto (extração determinística), (b) imagem/PDF
escaneado (visão multimodal do Claude), (c) linguagem natural. Sempre com
confirmação humana antes de gravar. Reaproveita a D1 (`incluirTitulo`,
`interpretarLinhaDigitavel`, `validarDocumento`) e a infraestrutura da IA
(tools + executor + cache de pendente + upload).

## Architecture

```
POST /ai/upload (estendido)
  ├─ .xml            → fluxo XML existente (inalterado)
  ├─ .pdf (texto)    → extrator-documento.service (pdfjs-dist) → campos
  ├─ .pdf/.png/.jpg  → visão Claude (multimodal) → campos
  └─ salva "documento financeiro pendente" no cache (por empresa)

Chat (linguagem natural / confirmação)
  └─ tool `lancar_documento_financeiro` (ai-tools + ai-executor)
       → recupera pendente do cache OU usa dados do texto
       → incluirTitulo (D1) → confirma

Núcleo puro (testável):
  extrair-campos-documento.ts → interpreta texto de boleto/fatura/guia:
    valor, vencimento, linha digitável, beneficiário, doc, tipo sugerido
```

## Components and Interfaces

### 1. Núcleo puro — `extrair-campos-documento.ts`
```ts
extrairCamposDocumento(texto: string): {
  valor?: number
  vencimento?: Date
  linhaDigitavel?: string
  beneficiario?: string
  documento?: string        // CNPJ/CPF encontrado
  tipoSugerido?: TipoDocumento
  confianca: number         // 0..1 (heurística)
}
```
Determinístico. Regex/heurística sobre o texto: linha digitável (47 dígitos),
valores `R$ 1.234,56`, datas `dd/mm/aaaa`, CNPJ/CPF, palavras-chave (DARF/GPS →
IMPOSTO; "boleto" → BOLETO; "nota fiscal" → NF). Se achar linha digitável,
prioriza valor/vencimento dela (via `interpretarLinhaDigitavel` da D1).

### 2. `documento-financeiro-pendente.ts` (cache)
Espelha `ai-xml-pendente.ts`: `salvarDocPendente(empresaId, dados)`,
`obterDocPendente`, `limparDocPendente`. TTL 30 min. Guarda os campos extraídos
(não o arquivo bruto) + o texto/observação para a confirmação seguinte.

### 3. `extrator-documento.service.ts` (I/O)
- `extrairTextoPdf(buffer)`: reusa `pdfjs-dist` (mesmo do parser de OP) para PDF com texto.
- `extrairPorVisao(buffer, mime)`: envia a imagem/PDF ao Claude multimodal (base64) com prompt pedindo JSON dos campos. Só usado quando o texto do PDF vem vazio (escaneado) ou é imagem. Se `ANTHROPIC_API_KEY` ausente, retorna vazio (caminho determinístico continua).

### 4. Tool `lancar_documento_financeiro` (ai-tools + ai-executor)
```jsonc
{
  "name": "lancar_documento_financeiro",
  "description": "Lança um documento a pagar/receber (boleto, fatura, guia, despesa) a partir do documento enviado no chat OU dos dados informados. Use após o usuário confirmar. Isola por empresa.",
  "input_schema": {
    "tipo": "pagar|receber",
    "descricao": "string",
    "valor": "number",
    "vencimento": "YYYY-MM-DD",
    "parceiroNome": "string?",       // resolve fornecedor/cliente ou livre
    "parceiroDocumento": "string?",  // CPF/CNPJ (validado D1)
    "categoria": "string?",          // nome/código → resolve categoriaId
    "parcelas": "number?",
    "tipoDocumento": "NF|BOLETO|DESPESA|IMPOSTO|..."
  }
}
```
`executarLancarDocumentoFinanceiro(input, empresaId)`:
- resolve parceiro (busca por documento/nome; se não achar → parceiro livre)
- resolve categoria por nome/código
- chama `incluirTitulo` (D1)
- retorna resposta amigável (quantas parcelas, valor, parceiro).

### 5. `POST /ai/upload` (estendido)
Detecta extensão/mime: `.xml` → fluxo atual; `.pdf`/imagem → `extrator-documento`
→ `extrairCamposDocumento` → salva pendente → responde com resumo + pergunta de
confirmação. Reusa a mesma resposta conversacional do XML.

### 6. System prompt (ajuste)
Adicionar ao `ai-system-prompt.ts` a instrução: ao receber boleto/fatura/guia,
resumir os campos e pedir confirmação; nunca lançar sem "sim"; sugerir categoria
por histórico do beneficiário.

## Data Models

Nenhuma tabela nova. Reusa `ContaPagar`/`ContaReceber` (D1). O cache de pendente
é em memória (como o XML). Opcional: reaproveitar histórico consultando
lançamentos anteriores do mesmo `parceiroDocLivre`/fornecedor para sugerir
categoria (query, sem schema novo).

## Error Handling

| Situação | Resposta |
|----------|----------|
| Arquivo não reconhecível | mensagem clara no chat, sem travar |
| Cache expirado na confirmação | pede reenvio |
| Documento (CPF/CNPJ) inválido | 422 no lançamento; IA reporta e pede correção |
| LLM indisponível | cai no caminho determinístico (texto/linha digitável) |
| Confirmação sem dados | IA pergunta os campos faltantes |

## Testing Strategy

- **Núcleo puro (fast-check + unit):** `extrairCamposDocumento` — reconhece linha digitável, valores BRL, datas, CNPJ; prioriza linha digitável; determinístico.
- **Executor (unit):** `executarLancarDocumentoFinanceiro` resolve parceiro (cadastro/livre), categoria, chama incluirTitulo, isola por empresa.
- **QA E2E:** estende `test_45`/novo `test_46` — lançamento assistido por dados (sem imagem real) reusando helpers D1; valida que a tool cria o título.
- Sem migração de schema.

## Correctness Properties

### Property 1: Extração prioriza linha digitável
Quando há linha digitável válida no texto, valor/vencimento retornados são os dela.
**Validates: Requirements 2.2**

### Property 2: Extração determinística
Mesmo texto de entrada → mesmos campos extraídos.
**Validates: Requirements 6.1**

### Property 3: Documento inválido barra o lançamento
Lançar via IA com CPF/CNPJ inválido é rejeitado (reuso validação D1).
**Validates: Requirements 5.3**

### Property 4: Isolamento
A tool só cria/consulta registros do `empresaId` do usuário.
**Validates: Requirements 5.3, 6.2**

### Property 5: Sem confirmação, sem gravação
O caminho de upload apenas resume e guarda pendente; a gravação só ocorre pela tool após confirmação.
**Validates: Requirements 3.1**
