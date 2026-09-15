# Design Document

Financeiro — Onda 2: Cobrança Bancária — Vizor ERP

## Overview

Adiciona cobrança bancária ao financeiro: convênio bancário (credenciais
criptografadas), boleto (nosso número + linha digitável + código de barras +
PDF), CNAB 240 (remessa/retorno com baixa automática), PIX cobrança (BR Code +
QR + webhook) e régua de cobrança (e-mail diário). Núcleo de cálculo puro e
determinístico (FEBRABAN, CRC16 EMV), testável sem banco. Transmissão real fica
parametrizada por convênio (modo "pronto para integrar").

Reaproveita: `encryptSenha`/`decryptSenha` (AES-256-GCM), `ConfigSmtp`+nodemailer,
`Notificacao`, scheduler diário (`recalculo-financeiro.scheduler.ts`), `pdfkit`,
`bwip-js`, `https.Agent` mTLS. Estende os títulos do F1/Onda 1 (baixa reusa
`titulo.service`).

## Architecture

```
src/modules/financeiro-cobranca/
  cobranca-calculo.ts        (PURO) módulo10/11, fator vencimento, linha
                              digitável, código de barras, CRC16, BR Code EMV
  convenio.service.ts        CRUD convênio (credenciais via encryptSenha)
  boleto.service.ts          emitir (nosso número, linha digitável), estados
  boleto-pdf.service.ts      PDF (pdfkit + bwip-js interleaved2of5)
  cnab240.service.ts         gerarRemessa / processarRetorno (baixa via titulo.service)
  pix-cobranca.service.ts    gerarCobranca (BR Code), processarWebhook (baixa)
  regua-cobranca.service.ts  eventos + envio e-mail (reusa ConfigSmtp)
  regua-cobranca.scheduler.ts  job diário (padrão recalculo-financeiro)
  financeiro-cobranca.routes.ts  rotas /api/financeiro-cobranca
  pix-webhook.routes.ts      /api/pix-webhook/:empresaId (sem auth JWT; valida por txid/assinatura PSP)
  cobranca.schemas.ts / .types.ts
```

## Components and Interfaces

### 1. Núcleo puro (`cobranca-calculo.ts`) — o coração testável

```ts
modulo10(campo: string): number
modulo11(campo: string, base?: number): number
fatorVencimento(vencimento: Date): string   // dias desde 07/10/1997, 4 dígitos
montarCodigoBarras(p: DadosBoleto): string   // 44 posições
montarLinhaDigitavel(codigoBarras: string): string  // 47 posições com DVs
crc16(payload: string): string              // CRC-CCITT (PIX EMV)
montarBrCodePix(p: DadosPix): string         // EMV com CRC16 no fim
```
Determinísticas, sem I/O. Base dos property tests (DVs válidos, CRC estável).

### 2. `convenio.service.ts`
- `criarConvenio`, `listarConvenios` (sem credenciais), `obterConvenio` (sem credenciais), `atualizar`, `inativar`.
- Credenciais (tokens/secret) via `encryptSenha` antes de persistir; `decryptSenha` só no uso interno (nunca em resposta HTTP).

### 3. `boleto.service.ts` + `boleto-pdf.service.ts`
- `emitirBoleto(empresaId, tituloId, convenioId)`: valida título ABERTA + pagador; gera nosso número sequencial (transação no convênio); usa núcleo puro p/ linha digitável/código de barras; cria `Boleto` (idempotente por título). Estados: `GERADO → REGISTRADO(remessa) → LIQUIDADO(retorno)/BAIXADO`.
- PDF via pdfkit + bwip-js (`interleaved2of5` no código de barras, layout ficha de compensação).

### 4. `cnab240.service.ts`
- `gerarRemessa(empresaId, convenioId, boletoIds[])`: header arquivo + header lote + N × (segmento P + Q) + trailers; numera sequenciais; marca boletos `REGISTRADO`. Retorna conteúdo do arquivo (string) + nome.
- `processarRetorno(empresaId, conteudo)`: parseia segmentos T/U (liquidação), casa por nosso número, baixa título via `titulo.service.baixarTitulo`, idempotente (registro `RetornoCnabProcessado` por hash+ocorrência). Ocorrência órfã → `PendenciaCobranca`.

### 5. `pix-cobranca.service.ts` + `pix-webhook.routes.ts`
- `gerarCobranca(empresaId, tituloId, convenioId)`: monta txid, BR Code (núcleo puro), QR (bwip-js qrcode), persiste `PixCobranca` (status ATIVA).
- `processarWebhook(empresaId, payload)`: valida txid, baixa título, marca PAGA. Idempotente. Rota **sem authenticate JWT** (é o PSP que chama) — validação por `txid` existente + (opcional) assinatura/segredo do convênio; prefixo próprio, fora do `moduloGuard`.

### 6. `regua-cobranca.service.ts` + scheduler
- Config: `ReguaCobranca` (empresa) + `ReguaEvento[]` (offset em dias, template).
- Job diário: para cada título a receber ABERTA, verifica eventos atingidos (venc + offset == hoje), envia e-mail (SMTP da empresa), registra `ReguaEnvio` (idempotência diária por [tituloId, eventoId, dia], padrão `alerta-cobranca`). Pago/cancelado não dispara.
- Scheduler idêntico ao `recalculo-financeiro.scheduler.ts`, registrado no `server.ts`.

## Data Models

Novos (todos com `empresaId`, isolados; entram em `ISOLATED_MODELS` quando via prismaScoped):

```prisma
model ConvenioBancario {
  id            String   @id @default(uuid())
  empresaId     String   @map("empresa_id")
  contaFinanceiraId String @map("conta_financeira_id")
  tipo          String   @db.VarChar(10)  // BOLETO | PIX | AMBOS
  banco         String   @db.VarChar(5)   // código FEBRABAN
  agencia       String   @db.VarChar(10)
  conta         String   @db.VarChar(15)
  beneficiario  String   @db.VarChar(120)
  carteira      String?  @db.VarChar(5)
  codigoConvenio String? @map("codigo_convenio") @db.VarChar(20)
  proxNossoNumero BigInt @default(1) @map("prox_nosso_numero")
  // PIX
  chavePix      String?  @map("chave_pix") @db.VarChar(80)
  psp           String?  @db.VarChar(30)
  clientId      String?  @map("client_id") @db.VarChar(200)
  clientSecretCriptografado String? @map("client_secret_cripto") @db.Text
  certificadoPixCriptografado String? @map("cert_pix_cripto") @db.Text
  webhookSecret String?  @map("webhook_secret") @db.VarChar(200)
  status        Boolean  @default(true)
  criadoEm      DateTime @default(now()) @map("criado_em")
  @@index([empresaId])
  @@map("convenio_bancario")
}

model Boleto {
  id            String   @id @default(uuid())
  empresaId     String   @map("empresa_id")
  convenioId    String   @map("convenio_id")
  contaReceberId String  @map("conta_receber_id")
  nossoNumero   String   @map("nosso_numero") @db.VarChar(20)
  linhaDigitavel String  @map("linha_digitavel") @db.VarChar(60)
  codigoBarras  String   @map("codigo_barras") @db.VarChar(44)
  valor         Decimal  @db.Decimal(14,2)
  vencimento    DateTime
  status        String   @default("GERADO") @db.VarChar(20) // GERADO|REGISTRADO|LIQUIDADO|BAIXADO
  criadoEm      DateTime @default(now()) @map("criado_em")
  @@unique([convenioId, nossoNumero])
  @@index([empresaId])
  @@map("boleto")
}

model RemessaCnab {
  id         String @id @default(uuid())
  empresaId  String @map("empresa_id")
  convenioId String @map("convenio_id")
  sequencial Int
  conteudo   String @db.Text
  criadoEm   DateTime @default(now()) @map("criado_em")
  @@map("remessa_cnab")
}

model RetornoCnabProcessado {   // idempotência de retorno
  id         String @id @default(uuid())
  empresaId  String @map("empresa_id")
  hashArquivo String @map("hash_arquivo") @db.VarChar(64)
  criadoEm   DateTime @default(now()) @map("criado_em")
  @@unique([empresaId, hashArquivo])
  @@map("retorno_cnab_processado")
}

model PixCobranca {
  id            String @id @default(uuid())
  empresaId     String @map("empresa_id")
  convenioId    String @map("convenio_id")
  contaReceberId String @map("conta_receber_id")
  txid          String @db.VarChar(35)
  brcode        String @db.Text
  valor         Decimal @db.Decimal(14,2)
  status        String @default("ATIVA") @db.VarChar(20) // ATIVA|PAGA|EXPIRADA
  pagoEm        DateTime? @map("pago_em")
  criadoEm      DateTime @default(now()) @map("criado_em")
  @@unique([empresaId, txid])
  @@map("pix_cobranca")
}

model ReguaCobranca {
  id        String  @id @default(uuid())
  empresaId String  @unique @map("empresa_id")
  ativa     Boolean @default(true)
  eventos   ReguaEvento[]
  @@map("regua_cobranca")
}

model ReguaEvento {
  id            String @id @default(uuid())
  reguaId       String @map("regua_id")
  offsetDias    Int    @map("offset_dias") // negativo=antes, 0=venc, positivo=depois
  assunto       String @db.VarChar(200)
  template      String @db.Text
  regua ReguaCobranca @relation(fields: [reguaId], references: [id], onDelete: Cascade)
  @@map("regua_evento")
}

model ReguaEnvio {   // idempotência diária
  id         String @id @default(uuid())
  empresaId  String @map("empresa_id")
  contaReceberId String @map("conta_receber_id")
  eventoId   String @map("evento_id")
  dia        String @db.VarChar(10) // YYYY-MM-DD
  criadoEm   DateTime @default(now()) @map("criado_em")
  @@unique([contaReceberId, eventoId, dia])
  @@map("regua_envio")
}

model PendenciaCobranca {
  id         String @id @default(uuid())
  empresaId  String @map("empresa_id")
  tipo       String @db.VarChar(20) // RETORNO_ORFAO | WEBHOOK_ORFAO
  detalhe    String @db.Text
  resolvido  Boolean @default(false)
  criadoEm   DateTime @default(now()) @map("criado_em")
  @@map("pendencia_cobranca")
}
```

Migração idempotente no mesmo commit (`migrate-prod.ts`): `CREATE TABLE IF NOT
EXISTS` para as 9 tabelas + índices/uniques; FKs em try/catch.

## Error Handling

| Situação | Resposta |
|----------|----------|
| Zod inválido | 422 "campo: motivo" |
| Convênio/boleto de outra empresa | 404 |
| Boleto de título já com boleto | 409 (retorna o existente) |
| Título sem pagador | 422 |
| Retorno reimportado | 200, nada baixado de novo |
| Webhook txid desconhecido/pago | 200, sem baixa dupla |
| Credencial em resposta | nunca (omitida) |

## Testing Strategy

- **Núcleo puro (fast-check + unit):** módulo 10/11 (DV 0–9/0–1), fator de vencimento (data conhecida → valor conhecido), linha digitável (47 pos, DVs válidos), CRC16 (vetor conhecido do BACEN), BR Code (CRC no fim, determinístico).
- **Services (unit):** boleto idempotente; retorno idempotente (mesmo hash não baixa 2x); webhook idempotente; régua não duplica no dia; credencial nunca retornada.
- **QA E2E:** `test_44_cobranca_bancaria.py` com massa sintética (sem banco real).
- **Migração:** `migrate-prod.ts` 2x.

## Correctness Properties

### Property 1: Dígitos verificadores válidos
Linha digitável e código de barras gerados têm DVs (módulo 10/11) consistentes com o próprio conteúdo.
**Validates: Requirements 2.5, 8.1**

### Property 2: CRC16 do BR Code correto
O BR Code PIX termina com o CRC16-CCITT correto dos dados que o precedem; recalcular valida.
**Validates: Requirements 4.2, 8.1**

### Property 3: Geração determinística
Mesmos dados de entrada produzem exatamente a mesma linha digitável / mesmo BR Code.
**Validates: Requirements 2.5, 4.2, 8.1**

### Property 4: Retorno idempotente
Processar o mesmo arquivo de retorno duas vezes baixa cada título no máximo uma vez.
**Validates: Requirements 3.2**

### Property 5: Webhook idempotente
Processar o mesmo `txid` pago duas vezes baixa o título no máximo uma vez.
**Validates: Requirements 4.3, 4.4**

### Property 6: Régua não duplica no dia
Rodar o job duas vezes no mesmo dia envia no máximo um e-mail por (título, evento).
**Validates: Requirements 5.3**

### Property 7: Isolamento
Toda consulta/baixa só afeta registros do `empresaId` pedido.
**Validates: Requirements 8.2**

### Property 8: Credencial protegida
Nenhuma resposta HTTP de convênio inclui secret/token/certificado em texto.
**Validates: Requirements 1.2, 8.5**
