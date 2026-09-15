# Financeiro — Onda 2: Cobrança Bancária (Boleto/CNAB/PIX/Régua)

**Spec:** `.kiro/specs/financeiro-cobranca-bancaria/`

Motor de cobrança bancária em modo **"pronto para integrar"**: toda a geração/
parsing funciona e é testável sem banco; a transmissão real e a homologação
dependem do convênio do cliente (credenciais parametrizáveis por empresa).

## Backend (`src/modules/financeiro-cobranca/`)

| Arquivo | Responsabilidade |
|---------|------------------|
| `cobranca-calculo.ts` | Núcleo puro: módulo 10/11, fator de vencimento (com reciclagem FEBRABAN pós-2025), código de barras (44), linha digitável (47), CRC16-CCITT, BR Code PIX EMV |
| `convenio.service.ts` | CRUD de convênio; credenciais criptografadas (AES-256-GCM); nunca retorna secret |
| `boleto.service.ts` | Emissão de boleto (nosso número sequencial, idempotente por título) |
| `boleto-pdf.service.ts` | PDF do boleto (pdfkit + bwip-js interleaved2of5) |
| `cnab240.service.ts` | Remessa CNAB 240 + processamento de retorno (baixa idempotente por hash) |
| `pix-cobranca.service.ts` | Gera BR Code/QR + webhook idempotente |
| `regua-cobranca.service.ts` | Config de eventos + envio de e-mail (SMTP da empresa), idempotente por dia |
| `regua-cobranca.scheduler.ts` | Job diário (08:00–08:59 Brasília, padrão `recalculo-financeiro`) |
| `financeiro-cobranca.routes.ts` | Rotas `/api/financeiro-cobranca` + webhook público `/api/pix-webhook/:empresaId` |

### Rotas
- **Convênios:** `GET/POST /convenios`, `GET /convenios/:id`, `PATCH /convenios/:id/inativar`
- **Boletos:** `GET /boletos`, `POST /boletos/emitir`, `GET /boletos/:id/pdf`
- **CNAB:** `POST /cnab/remessa`, `POST /cnab/retorno`
- **PIX:** `GET /pix`, `POST /pix/gerar`, `GET /pix/:id/qrcode`
- **Régua:** `GET /regua`, `PUT /regua`
- **Webhook PIX (público):** `POST /api/pix-webhook/:empresaId`

## Frontend (`src/app/(interna)/financeiro/`)
Telas: **Convênios Bancários**, **Boletos** (emitir/PDF/remessa/importar retorno),
**PIX** (QR + copia-e-cola), **Régua de Cobrança** (config de eventos). Ações de
"Emitir boleto" e "Gerar PIX" na tela de Contas a Receber. Menu com 4 entradas novas.

## Modelo de dados
9 tabelas: `convenio_bancario`, `boleto`, `remessa_cnab`, `retorno_cnab_processado`,
`pix_cobranca`, `regua_cobranca`, `regua_evento`, `regua_envio`, `pendencia_cobranca`.
Credenciais sensíveis criptografadas. Migração idempotente no `migrate-prod.ts`.

## Testes
- Backend: 18 testes Vitest (núcleo FEBRABAN/EMV property-based + services idempotentes).
- QA E2E: `tests/e2e-qa/test_44_cobranca_bancaria.py` (geração/parsing + webhook + isolamento).

## Para integrar com um banco real (próximo passo, quando houver convênio)
1. Cadastrar o convênio com as credenciais do banco/PSP.
2. Ajustar o campo livre do boleto e o layout CNAB às particularidades do banco (Itaú/Bradesco/BB/Sicoob divergem em posições específicas).
3. Configurar o endpoint de webhook PIX no painel do PSP apontando para `/api/pix-webhook/:empresaId`.
4. Homologar remessa/retorno com o banco.

## Bugs reais corrigidos (via property-based testing)
- Fator de vencimento FEBRABAN estourava 4 dígitos após fev/2025 (fator 9999 reciclado para 1000).
- DV do código de barras inserido em posição errada (gerava 45 em vez de 44 posições).
