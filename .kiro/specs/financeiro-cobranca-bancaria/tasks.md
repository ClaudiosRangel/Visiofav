# Implementation Plan: Financeiro — Onda 2 (Cobrança Bancária)

## Overview

Boleto/CNAB/PIX/régua em modo "pronto para integrar". Núcleo puro determinístico
(FEBRABAN/EMV) primeiro, depois services, rotas, frontend e QA. Estende títulos
do F1/Onda 1 (baixa via `titulo.service`). Reaproveita cripto, SMTP,
notificação, scheduler, pdfkit e bwip-js existentes. Migração idempotente no
mesmo commit.

## Tasks

- [x] 1. Schema + migração idempotente
  - 9 models criados; `migrate-prod.ts` idempotente testado 2x local; `prisma generate` OK; models isolados registrados em ISOLATED_MODELS.
  - _Requirements: 1.1, 8.4_

- [ ] 2. Núcleo puro (`cobranca-calculo.ts`)
  - [x] 2.1 módulo10, módulo11, fatorVencimento (com reciclagem FEBRABAN pós-2025), montarCodigoBarras, montarLinhaDigitavel, crc16, montarBrCodePix (sem I/O)
    - _Requirements: 2.5, 4.2, 8.1_
  - [x]* 2.2 Property tests (fast-check): 13 testes passando — DVs válidos (Property 1), CRC16 (Property 2), determinismo (Property 3)
    - **Validates: Requirements 2.5, 4.2, 8.1**

- [x] 3. Checkpoint — núcleo puro passa (13 testes)

- [ ] 4. Services de cadastro e boleto
  - [ ] 4.1 `convenio.service.ts` (CRUD; credenciais via encryptSenha; nunca retorna secret)
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 8.5_
  - [ ] 4.2 `boleto.service.ts` (emitir idempotente, nosso número sequencial, estados) + `boleto-pdf.service.ts` (pdfkit + bwip-js interleaved2of5)
    - _Requirements: 2.1, 2.2, 2.3, 2.4_
  - [ ]* 4.3 Testes unitários (boleto idempotente; credencial não retornada — Property 8)
    - **Validates: Requirements 2.3, 1.2, 8.5**

- [ ] 5. CNAB 240 (`cnab240.service.ts`)
  - [ ] 5.1 `gerarRemessa` (header/lote/segmentos P+Q/trailers) + `processarRetorno` (parse T/U, baixa via titulo.service, idempotente por hash, órfão→pendência)
    - _Requirements: 3.1, 3.2, 3.3, 3.4_
  - [ ]* 5.2 Testes (remessa válida; retorno idempotente — Property 4; órfão vira pendência)
    - **Validates: Requirements 3.2, 3.3**

- [ ] 6. PIX (`pix-cobranca.service.ts` + `pix-webhook.routes.ts`)
  - [ ] 6.1 `gerarCobranca` (txid, BR Code, QR) + `processarWebhook` (baixa idempotente); rota de webhook sem JWT, validada por txid/segredo
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5_
  - [ ]* 6.2 Testes (BR Code CRC — Property 2; webhook idempotente — Property 5)
    - **Validates: Requirements 4.2, 4.3, 4.4**

- [ ] 7. Régua de cobrança (`regua-cobranca.service.ts` + scheduler)
  - [ ] 7.1 Config eventos + envio diário (SMTP da empresa) + idempotência diária (`ReguaEnvio`); pago/cancelado não dispara; scheduler no padrão `recalculo-financeiro`, registrado no `server.ts`
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5_
  - [ ]* 7.2 Teste (não duplica no dia — Property 6; pago não dispara)
    - **Validates: Requirements 5.3, 5.5**

- [ ] 8. Rotas HTTP (`financeiro-cobranca.routes.ts`, prefixo `/api/financeiro-cobranca`)
  - Convênios (CRUD), boletos (emitir/pdf/remessa/retorno), PIX (gerar/status), régua (config). Zod + moduloGuard('FINANCEIRO'). Webhook em rota separada sem JWT.
  - _Requirements: 1.x, 2.x, 3.x, 4.x, 5.x, 8.2, 8.3_

- [ ] 9. Checkpoint backend — build + testes passam

- [ ] 10. Frontend
  - [ ] 10.1 Estender `useFinanceiroApi` (ou hook novo `useCobrancaApi`) com endpoints
  - [ ] 10.2 Telas: Convênios Bancários, Boletos (emitir/pdf/remessa/retorno), PIX (QR/status), Régua (config eventos); ações de boleto/PIX na tela de Contas a Receber; menu
    - _Requirements: 6.1, 6.2, 6.3_

- [ ] 11. Checkpoint frontend — build passa

- [ ] 12. QA E2E
  - [ ] 12.1 Helpers no `wms_api.py` (convênio, boleto, remessa, retorno, pix, webhook, régua)
  - [ ] 12.2 `test_44_cobranca_bancaria.py` (geração/parsing com massa sintética + isolamento)
  - [ ] 12.3 Rodar suíte e reportar
    - _Requirements: 7.1, 7.2, 7.3_

- [ ] 13. Documentação + roadmap + deploy
  - Doc da Onda 2, roadmap atualizado, steering QA; commit + push back e front para `main`; QA contra produção.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1"] },
    { "id": 1, "tasks": ["2.1"] },
    { "id": 2, "tasks": ["2.2"] },
    { "id": 3, "tasks": ["3"] },
    { "id": 4, "tasks": ["4.1", "4.2", "5.1", "6.1", "7.1"] },
    { "id": 5, "tasks": ["4.3", "5.2", "6.2", "7.2", "8"] },
    { "id": 6, "tasks": ["9"] },
    { "id": 7, "tasks": ["10.1", "10.2"] },
    { "id": 8, "tasks": ["11"] },
    { "id": 9, "tasks": ["12.1", "12.2", "12.3"] },
    { "id": 10, "tasks": ["13"] }
  ]
}
```

## Notes

- Modo "pronto para integrar": geração/parsing testável sem banco; transmissão real depende do convênio do cliente.
- Núcleo puro (FEBRABAN/EMV) é a base testável — property tests validam DVs/CRC.
- Webhook PIX é rota pública (o PSP chama) — validar por txid/segredo, nunca confiar cegamente.
- Migração idempotente no mesmo commit; credenciais sempre criptografadas.
