# Requirements Document

Financeiro — Onda 2: Cobrança Bancária (Boleto/CNAB/PIX/Régua) — Vizor ERP

## Introduction

Onda 2 do programa "Financeiro nível de mercado". Depois da Onda 1 (operação
diária completa), esta onda conecta o financeiro aos meios de cobrança reais:
**boleto registrado + CNAB 240 (remessa/retorno), PIX cobrança (QR dinâmico +
webhook) e régua de cobrança automática**. Assim o dinheiro real passa pelo
sistema, não por fora.

### Decisão de produto (importante)
Boleto/CNAB/PIX dependem de **convênio bancário e credenciais de PSP** que são
do cliente. O sistema é construído em modo **"pronto para integrar"**: todo o
motor (geração de arquivo CNAB, layout de boleto com linha digitável/código de
barras, montagem do payload/QR PIX, parsing de retorno, baixa automática) é
funcional e testável **sem depender de banco**; a transmissão real e a
homologação acontecem quando o cliente cadastra as credenciais do seu convênio.
É o mesmo modelo de Omie/Bling: motor genérico, credencial do cliente.

Reaproveita infraestrutura existente (confirmada no código): `nodemailer` +
`ConfigSmtp` por empresa; criptografia AES-256-GCM (`encryptSenha`/`decryptSenha`
de `certificado-crypto.ts`); `Notificacao`/`NotificacaoDestinatario`; padrão de
scheduler diário (`recalculo-financeiro.scheduler.ts`); `pdfkit` e `bwip-js`
(code128/interleaved2of5/qrcode). Estende os títulos do F1/Onda 1.

Padrões do projeto: migração idempotente no mesmo commit
(`database-migrations.md`), isolamento multi-tenant
(`ATENCAO-pontos-verificar.md`), Zod, Fastify, Prisma, Mantine 7, QA
Python+Playwright (`qa-automatizado.md`).

## Glossary

- **Convênio bancário**: acordo do beneficiário com o banco para emitir boletos (carteira, código de cedente/beneficiário, código do convênio).
- **CNAB 240**: layout FEBRABAN de arquivo de remessa (títulos enviados ao banco) e retorno (baixas/ocorrências).
- **Remessa**: arquivo gerado pelo ERP e enviado ao banco com os títulos a registrar.
- **Retorno**: arquivo do banco processado pelo ERP para dar baixa/registrar ocorrências.
- **Nosso número**: identificador do título no banco.
- **Linha digitável / código de barras**: representação numérica do boleto.
- **PIX cobrança (cob)**: cobrança dinâmica com `txid`, QR Code e copia-e-cola, confirmada por webhook.
- **Régua de cobrança**: envio automático de avisos (e-mail) antes/depois do vencimento.

## Requirements

### Requisito 1 — Convênio bancário (cadastro de credenciais de cobrança)

**User Story:** Como responsável financeiro, quero cadastrar o convênio de cobrança do meu banco, para emitir boletos e PIX com minhas credenciais.

#### Acceptance Criteria
1. QUANDO o usuário cadastra um convênio ENTÃO o sistema DEVE persistir banco (código FEBRABAN), agência, conta, código do beneficiário/cedente, carteira, código do convênio, e a faixa/sequencial de "nosso número", isolados por `empresaId` e vinculados a uma `ContaFinanceira`.
2. QUANDO credenciais sensíveis (tokens de API PIX, client_secret) são salvas ENTÃO o sistema DEVE armazená-las criptografadas (AES-256-GCM), nunca em texto plano, e nunca retorná-las em respostas de listagem/detalhe.
3. QUANDO um convênio é do tipo PIX ENTÃO o sistema DEVE aceitar chave PIX, PSP, client_id/secret e (quando aplicável) certificado mTLS.
4. QUANDO o convênio pertence a outra empresa ENTÃO o acesso DEVE responder 404.

### Requisito 2 — Emissão de boleto

**User Story:** Como operador, quero emitir um boleto a partir de uma conta a receber, para cobrar o cliente.

#### Acceptance Criteria
1. QUANDO o usuário emite boleto de um título ABERTA ENTÃO o sistema DEVE gerar "nosso número" sequencial do convênio, calcular a linha digitável e o código de barras (padrão FEBRABAN), e persistir um registro de boleto vinculado ao título.
2. QUANDO o boleto é gerado ENTÃO o sistema DEVE produzir um PDF com os dados do beneficiário, pagador, valor, vencimento, linha digitável e código de barras (interleaved2of5).
3. QUANDO o título já possui boleto ativo ENTÃO o sistema NÃO DEVE duplicar (idempotência por título).
4. QUANDO o título não tem cliente/pagador com dados suficientes ENTÃO o sistema DEVE rejeitar com mensagem clara (422).
5. QUANDO o cálculo da linha digitável/código de barras é feito ENTÃO o resultado DEVE seguir o algoritmo FEBRABAN (módulo 10/11, fator de vencimento) e ser determinístico.

### Requisito 3 — CNAB 240 (remessa e retorno)

**User Story:** Como operador, quero gerar o arquivo de remessa e processar o retorno do banco, para registrar e baixar títulos.

#### Acceptance Criteria
1. QUANDO o usuário gera a remessa de N boletos de um convênio ENTÃO o sistema DEVE produzir um arquivo CNAB 240 válido (header de arquivo/lote, segmentos P/Q, trailers), com sequenciais corretos.
2. QUANDO o usuário importa um arquivo de retorno CNAB 240 ENTÃO o sistema DEVE parsear as ocorrências e, para títulos liquidados, dar baixa automática na conta a receber correspondente (reusando a baixa do F1/Onda 1), de forma idempotente (reimportar o mesmo retorno não baixa duas vezes).
3. QUANDO uma ocorrência de retorno não casa com nenhum título ENTÃO o sistema DEVE registrá-la como pendência, sem falhar o processamento das demais.
4. QUANDO a remessa é gerada ENTÃO os boletos incluídos DEVEM mudar de estado (ex.: REGISTRADO/ENVIADO) e o arquivo ficar disponível para download.

### Requisito 4 — PIX cobrança

**User Story:** Como operador, quero gerar uma cobrança PIX (QR Code) de um título, para o cliente pagar na hora.

#### Acceptance Criteria
1. QUANDO o usuário gera um PIX de um título ENTÃO o sistema DEVE montar o payload de cobrança (txid, valor, chave, expiração) e produzir o "copia-e-cola" (BR Code EMV) e o QR Code (imagem), persistindo o registro vinculado ao título.
2. QUANDO o BR Code é montado ENTÃO ele DEVE seguir o padrão EMV do BACEN (campos, CRC16) e ser determinístico para os mesmos dados.
3. QUANDO chega uma confirmação de pagamento (webhook do PSP) ENTÃO o sistema DEVE validar o `txid`, dar baixa no título correspondente e marcar a cobrança como paga, de forma idempotente.
4. QUANDO o webhook recebe um `txid` desconhecido ou já pago ENTÃO o sistema DEVE responder sem erro e não baixar duas vezes.
5. QUANDO o PSP exige mTLS ENTÃO o sistema DEVE usar o certificado configurado no convênio (reuso do padrão `https.Agent` com pfx).

### Requisito 5 — Régua de cobrança

**User Story:** Como gestor, quero avisos automáticos de cobrança por e-mail, para reduzir inadimplência sem trabalho manual.

#### Acceptance Criteria
1. QUANDO o usuário configura a régua ENTÃO o sistema DEVE aceitar N eventos (ex.: 3 dias antes do vencimento, no vencimento, 3/7/15 dias após), cada um com um template de mensagem, por empresa.
2. QUANDO o job diário roda ENTÃO o sistema DEVE, para cada título a receber em aberto que atinge um evento configurado, enviar e-mail ao cliente (via SMTP da empresa) e registrar o envio.
3. QUANDO um evento já foi enviado para um título no dia ENTÃO o sistema NÃO DEVE reenviar (idempotência diária, mesmo padrão do alerta de cobrança do Financeiro Vizor).
4. QUANDO o cliente não tem e-mail ou a empresa não tem SMTP ENTÃO o sistema DEVE pular o envio e registrar o motivo, sem falhar os demais.
5. QUANDO o título é pago/cancelado ENTÃO a régua NÃO DEVE mais disparar para ele.

### Requisito 6 — Frontend

**User Story:** Como operador, quero telas para tudo isso.

#### Acceptance Criteria
1. QUANDO acesso o menu Financeiro ENTÃO DEVE haver: cadastro de Convênios Bancários, tela de Boletos (emitir, baixar PDF, gerar remessa, importar retorno), tela de PIX (gerar QR, ver status), e configuração da Régua de Cobrança.
2. QUANDO emito um boleto/PIX a partir de um título ENTÃO a ação DEVE estar disponível na tela de Contas a Receber.
3. QUANDO uma ação de sucesso/erro ocorre ENTÃO o sistema DEVE notificar (verde/vermelho) com Mantine 7 e tokens de tema.

### Requisito 7 — QA automatizado

#### Acceptance Criteria
1. QUANDO a suíte QA roda ENTÃO DEVE existir `test_44_cobranca_bancaria.py` cobrindo: cadastro de convênio (credencial não vaza), emissão de boleto (linha digitável válida), geração de remessa CNAB, processamento de retorno (baixa idempotente), geração de PIX (BR Code válido/CRC), webhook (baixa idempotente) e régua (evento não duplica no dia).
2. QUANDO um recurso é criado por uma empresa ENTÃO o teste DEVE validar isolamento (outra empresa não vê).
3. QUANDO a validação depende de banco real ENTÃO o teste DEVE validar a GERAÇÃO/PARSING dos artefatos (não a transmissão), com massa sintética.

### Requisito 8 — Núcleo determinístico, isolamento, validação e migração

#### Acceptance Criteria
1. QUANDO linha digitável, código de barras, CNAB e BR Code PIX são gerados ENTÃO a lógica DEVE ser pura e determinística (testável por property-based: mesmo input → mesmo output; dígitos verificadores válidos).
2. QUANDO qualquer query é executada ENTÃO DEVE filtrar por `empresaId`.
3. QUANDO uma entrada inválida chega ENTÃO Zod rejeita (422, "campo: motivo").
4. QUANDO o schema muda ENTÃO o mesmo commit atualiza `prisma/migrate-prod.ts` idempotente, testado 2x local.
5. QUANDO credenciais são persistidas ENTÃO DEVEM ser criptografadas e nunca retornadas em texto.
