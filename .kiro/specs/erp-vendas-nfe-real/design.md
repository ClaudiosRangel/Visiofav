# Design Document

Bloco F2 — Vendas com Emissão Real de NF-e (fluxo 100% ponta a ponta)

## Overview

O motor de emissão NF-e (`nfeEmissaoService.emitir`) já funciona. O F2 fecha o
fluxo ponta a ponta em quatro frentes, espelhando a maturidade do CT-e sem
copiá-lo:

1. **Ponto único pós-autorização** — criar `gerarTituloDeNfe` no
   `gerar-titulo-de-documento.service.ts` (irmão do `gerarTituloDeCte`), e uma
   função de baixa de estoque idempotente por documento. A autorização da NF-e
   passa a chamar esse ponto único, eliminando a geração inline duplicada de
   `ContaReceber` nas rotas.
2. **Cobertura dos fluxos** — plugar emissão no PDV (NFC-e), na encomenda e na
   consignação, reutilizando o mesmo motor.
3. **Rejeição + reprocessamento** — núcleo puro que mapeia cStat→mensagem
   amigável; endpoint para retransmitir NF-e rejeitada.
4. **Nivelamento ao CT-e** — ambiente derivado do documento (corrige risco do
   cStat 252), detalhe/XML/consulta-SEFAZ, e melhorias de frontend.

Princípios: estender (não reescrever) o motor existente; idempotência e proteção
na amarração; migração idempotente no mesmo commit; isolamento multi-tenant.

## Architecture

```
Fluxos de venda                         Motor fiscal (existente)
─────────────                           ────────────────────────
pedido /efetivar ───┐
faturamento parcial ─┼─► vendaFiscalService.emitirParaVenda ─► nfeEmissaoService.emitir
PDV finalizar ──────┼─► (novo) emissão NFC-e ────────────────►  │ (tributos→XML→XSD→assina
encomenda faturar ──┼─► emitirParaVenda ─────────────────────►  │  →SEFAZ→autoriza/rejeita)
consignada acerto ──┘                                           │
devolução (existente) ─► nfeEmissaoService.emitir direto        ▼
                                              processarRespostaSefaz (cStat 100)
                                                        │
                                     ┌──────────────────┴───────────────────┐
                                     ▼ (NOVO ponto único pós-autorização)     
                          amarrarPosAutorizacaoNfe(documentoFiscalId)
                            ├── gerarTituloDeNfe (idempotente, protegido)  → ContaReceber
                            └── baixarEstoqueDeNfe (idempotente, só sem WMS) → registrarMovimentacao
```

## Components and Interfaces

### 1. Núcleo puro — `nfe-rejeicao.ts` (mapeamento de rejeições)

```typescript
export interface RejeicaoMapeada {
  cStat: number
  tecnico: string          // xMotivo cru da SEFAZ
  amigavel: string         // orientação em pt-BR
  acao: 'CORRIGIR_CADASTRO' | 'CORRIGIR_ITEM' | 'CORRIGIR_FISCAL' | 'REVISAR' | 'CONTINGENCIA'
}
export function mapearRejeicao(cStat: number, xMotivo: string): RejeicaoMapeada
```

Tabela dos cStat 2xx mais comuns (ex.: 204 duplicidade, 209 IE inválida, 225
falha schema, 539 chave duplicada, etc.), cada um com orientação de correção.
Códigos não mapeados retornam uma orientação genérica preservando o técnico.
Sem I/O — testável.

### 2. Ponto único pós-autorização (`gerar-titulo-de-documento.service.ts`)

Estende o service que já tem `gerarTituloDeCte`. Adiciona:

```typescript
// Gera conta a receber de uma NF-e de venda AUTORIZADA. Idempotente por
// documentoFiscalId. empresaId do documento. Parcelas conforme condição
// (default 1). Retorna título(s) ou null se não deve gerar.
export async function gerarTituloDeNfe(prisma, documentoFiscalId, opcoes?): Promise<...>

// Wrapper protegido: falha registra PendenciaTituloFiscal, não propaga.
export async function gerarTituloDeNfeProtegido(prisma, documentoFiscalId, opcoes?)

// Baixa de estoque idempotente por documento (só empresa sem WMS).
export async function baixarEstoqueDeNfeProtegido(prisma, documentoFiscalId)

// Orquestrador chamado na autorização: título + estoque, ambos protegidos.
export async function amarrarPosAutorizacaoNfe(prisma, documentoFiscalId)

// Cancelamento: cancela títulos em aberto + reverte estoque se baixado.
export async function reverterPosAutorizacaoNfe(prisma, empresaId, documentoFiscalId)
```

Idempotência de estoque: registrar a movimentação com `origemId =
documentoFiscalId` e verificar existência antes de repetir (evita baixa dupla em
reprocesso/retransmissão). O título já é idempotente por `documentoFiscalId`
(padrão do CT-e).

Ponto de chamada: `nfeEmissaoService.processarRespostaSefaz`, no ramo cStat 100,
chama `amarrarPosAutorizacaoNfe(prisma, documentoFiscalId)` — **somente para
documentos de venda** (tipo NFE/NFCE com `vendaEfetivadaId`/origem de venda; a
NF-e de devolução, que é entrada, não gera conta a receber). A rota `/efetivar` e
o `faturamento-parcial` **param de gerar `ContaReceber` inline** — passam a
confiar no ponto único (removendo a duplicação apontada no levantamento).

### 3. Cobertura dos fluxos de venda

- **PDV (NFC-e)**: em `pdv.service.finalizarVenda`, após finalizar, montar
  `DadosNFCe` e chamar `nfceEmissaoService.emitir` (motor já existe, rota
  `/nfce/emitir` já existe). Gravar `nfceChave` na `VendaPdv`. A baixa de estoque
  do PDV passa a ser feita via `registrarMovimentacao` (unificando com o kardex),
  não `tx.estoque.updateMany` direto. Emissão de NFC-e é síncrona e o consumidor
  final normalmente não gera conta a receber (pagamento à vista no caixa) — o
  ponto único trata "gerar título" como no-op quando a venda é PDV à vista.
- **Encomenda**: no faturamento da encomenda, chamar
  `vendaFiscalService.emitirParaVenda` (mesmo caminho do pedido) e amarrar via
  ponto único.
- **Consignada**: emitir NF-e de remessa (CFOP 5917/6917) na saída e NF-e de
  venda no acerto do consumido; retorno (CFOP 1918/2918) no não-vendido. Reusa
  `montarDadosNFe` com CFOP/natureza próprios (parametrizados).

### 4. Reprocessamento de NF-e rejeitada

Nova rota `POST /nfe/:id/retransmitir`:
- Só aceita documento `REJEITADO` (senão 422).
- Reaproveita o registro; regera XML a partir dos dados atuais, reassina,
  retransmite. Se autorizado, aplica `amarrarPosAutorizacaoNfe`.
- Segue o padrão de `transmitirExistente` do CT-e.

### 5. Ambiente derivado do documento

Ajustar `nfeEmissaoService.obterAmbiente()` e `obterDependenciasEventos` para
receber/derivar o ambiente do documento (`dadosNFe.ambiente` /
`documento.ambiente`) em vez de `process.env.SEFAZ_AMBIENTE`. Mesma correção já
aplicada no CT-e (cStat 252). A env vira apenas fallback.

### 6. Detalhe, XML e consulta (rotas)

- `GET /nfe/:id` — detalhe (documento + itens + eventos), isolado por empresa.
- `GET /nfe/:id/xml` — XML autorizado (nfeProc) para download.
- `POST /nfe/:id/consultar-sefaz` — consulta situação por chave (reusa SEFAZ
  client, serviço de consulta protocolo).
- Frontend `fiscal/nfe`: botões DANFE (rota existente) e XML na listagem, ação de
  reprocessar para REJEITADA, e alinhamento dos rótulos de status
  (AUTORIZADA/AUTORIZADO etc.) entre filtro do front e valores do back.

## Data Models

Sem tabela nova. Ajustes possíveis em `DocumentoFiscal` (todos aditivos,
nullable, com migração idempotente):
- Reuso de `PendenciaTituloFiscal` (já existe) para falha de título de NF-e.
- Se necessário marcar baixa de estoque feita na emissão: um flag
  `estoqueBaixado Boolean @default(false)` em `DocumentoFiscal` para idempotência
  e reversão (avaliar na implementação; se `registrarMovimentacao` já permite
  detectar por `origemId`, o flag pode ser dispensado).

## Error Handling

- Rejeição de negócio → 422 com mensagem amigável + cStat técnico.
- Falha de infra → contingência (fluxo existente).
- Reprocessar documento não-REJEITADO → 409/422.
- Empresa sem certificado/dados → 422 com o que falta.
- Falha de título/estoque pós-autorização → não propaga; `PendenciaTituloFiscal`.
- Documento de outra empresa → 404.

## Testing Strategy

- **Unit** (`nfe-rejeicao.test.ts`): mapeamento de cStat conhecidos e
  desconhecidos; determinismo.
- **Unit** (`gerar-titulo-de-documento.service` — parte NF-e): idempotência do
  título (não duplica), empresaId do documento, no-op para PDV à vista, reversão
  no cancelamento.
- **QA E2E** (`test_51_nfe.py`): valida a amarração ponta a ponta usando a
  infraestrutura de seed/QA existente (sem transmitir à SEFAZ real): documento
  autorizado gera conta a receber uma única vez (idempotência), rejeição barra a
  efetivação, reprocessar rejeitada, isolamento.
- Checkpoint: `vitest run` dos núcleos + diagnostics + bundle esbuild do server
  (lição das fases anteriores: validar build antes do push).

## Correctness Properties

### Property 1: Idempotência do título de NF-e
Chamar `gerarTituloDeNfe` para o mesmo `documentoFiscalId` mais de uma vez cria
no máximo um conjunto de títulos; execuções seguintes retornam o existente.
**Validates: Requirements 2.1, 4.2**

### Property 2: Autorização não é desfeita por falha de amarração
Se a geração de título ou a baixa de estoque falha, o documento permanece
AUTORIZADO e uma `PendenciaTituloFiscal` é registrada; nenhuma exceção propaga
para o fluxo de emissão.
**Validates: Requirements 2.2**

### Property 3: empresaId do documento
O título e a movimentação de estoque gerados usam o `empresaId` do documento
fiscal, não o do usuário que disparou a ação.
**Validates: Requirements 2.1, 7.1**

### Property 4: Rejeição não efetiva a venda
Quando a SEFAZ rejeita (cStat de negócio), nenhum título e nenhuma baixa de
estoque são criados para aquele documento.
**Validates: Requirements 3.2**

### Property 5: Mapeamento de rejeição é total e determinístico
Para qualquer cStat, `mapearRejeicao` retorna sempre uma orientação (mapeada ou
genérica), preservando o texto técnico; a mesma entrada produz sempre a mesma
saída.
**Validates: Requirements 3.1**

### Property 6: Ambiente consistente
O ambiente usado para resolver a URL da SEFAZ é igual ao `ambiente` do documento
transmitido (nunca diverge por env global).
**Validates: Requirements 5.1, 5.2**
