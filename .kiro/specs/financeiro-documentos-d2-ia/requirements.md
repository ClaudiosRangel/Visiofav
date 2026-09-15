# Requirements Document

Central de Documentos Financeiros — Fase D2: Vizor AI autônoma — Vizor ERP

## Introduction

Segunda fase do programa (`docs/PROGRAMA-DOCUMENTOS-FINANCEIROS.md`). Torna o
lançamento de documentos financeiros **assistido por IA**: o usuário envia um
boleto, fatura ou guia (PDF ou foto) no chat da Vizor AI, e a IA **extrai os
dados, sugere a classificação e prepara o lançamento**, pedindo confirmação
antes de gravar (padrão seguro já usado na importação de XML).

Estende o módulo `src/modules/ai/` existente (tools em `ai-tools.ts`, executor
`ai-executor.ts`, cache de arquivo `ai-xml-pendente.ts`, upload em
`ai.routes.ts`) e reaproveita o backend da D1 (`incluir-titulo.service`,
`interpretarLinhaDigitavel`, contratos). Usa a API multimodal do Claude (já
integrada via `@anthropic-ai/sdk`) para OCR de imagem, e extração de texto de
PDF para documentos digitais.

Fora de escopo: folha (D3), contábil (D4), exportação (D5).

## Glossary

- **Documento financeiro (entrada)**: boleto, fatura, DARF/guia de imposto, recibo — em PDF ou imagem.
- **Extração**: obter valor, vencimento, beneficiário, linha digitável, tipo, a partir do documento.
- **Classificação automática**: a IA sugere categoria (plano de contas) e centro de custo.
- **Lançamento assistido**: a IA prepara o título e pede confirmação; só grava após "sim".
- **OCR/visão**: leitura de imagem via modelo multimodal (foto de boleto).

## Requirements

### Requisito 1 — Upload de documento financeiro no chat

**User Story:** Como usuário, quero enviar um boleto/fatura (PDF ou foto) no chat da IA, para ela lançar pra mim.

#### Acceptance Criteria
1. QUANDO o usuário envia um arquivo no chat ENTÃO o sistema DEVE aceitar, além de XML, os formatos PDF e imagem (PNG/JPG).
2. QUANDO um PDF com texto é enviado ENTÃO o sistema DEVE extrair o texto e tentar identificar valor, vencimento, beneficiário e linha digitável de forma determinística.
3. QUANDO uma imagem ou PDF escaneado é enviado ENTÃO o sistema DEVE usar a visão multimodal do Claude para extrair os mesmos campos.
4. QUANDO o arquivo não é reconhecível como documento financeiro ENTÃO o sistema DEVE responder de forma clara, sem travar.
5. QUANDO os dados são extraídos ENTÃO o sistema DEVE guardá-los em cache por empresa (buffer de conversa, TTL curto) para a confirmação seguinte, no mesmo padrão do XML pendente.

### Requisito 2 — Extração e sugestão

**User Story:** Como usuário, quero que a IA me mostre o que entendeu e sugira a classificação antes de lançar.

#### Acceptance Criteria
1. QUANDO um documento é processado ENTÃO a IA DEVE apresentar um resumo (valor, vencimento, beneficiário/documento, tipo sugerido) para o usuário revisar.
2. QUANDO há linha digitável de boleto ENTÃO o sistema DEVE interpretá-la (via `interpretarLinhaDigitavel`) e usar valor/vencimento dela com prioridade.
3. QUANDO existe histórico de lançamentos do mesmo beneficiário/documento ENTÃO a IA DEVE sugerir a categoria e o centro de custo usados anteriormente.
4. QUANDO o beneficiário tem CNPJ/CPF que casa com um fornecedor cadastrado ENTÃO a IA DEVE vinculá-lo; caso contrário, sugerir lançamento como parceiro livre.

### Requisito 3 — Lançamento assistido com confirmação

**User Story:** Como usuário, quero confirmar antes de a IA gravar o título, para manter o controle.

#### Acceptance Criteria
1. QUANDO a IA prepara um lançamento ENTÃO ela NÃO DEVE gravar sem confirmação explícita do usuário ("sim", "pode lançar").
2. QUANDO o usuário confirma ENTÃO o sistema DEVE criar o(s) título(s) via `incluirTitulo` (reuso D1), com tipo, parceiro, categoria, centro de custo e parcelas inferidos, e reportar o resultado.
3. QUANDO o usuário pede parcelamento ("em 3x") ENTÃO o sistema DEVE gerar as parcelas.
4. QUANDO o usuário corrige um dado antes de confirmar ("o vencimento é dia 20") ENTÃO a IA DEVE ajustar antes de lançar.
5. QUANDO a confirmação chega mas o cache expirou ENTÃO o sistema DEVE pedir o reenvio do documento, sem erro.

### Requisito 4 — Lançamento por linguagem natural (sem arquivo)

**User Story:** Como usuário, quero lançar por texto ("lança um boleto de 1.500 pro João, vence dia 10, em 3x"), para agilidade.

#### Acceptance Criteria
1. QUANDO o usuário descreve um lançamento em texto ENTÃO a IA DEVE extrair valor, vencimento, parceiro, parcelas e tipo, preparar e pedir confirmação.
2. QUANDO o parceiro citado casa com cadastro ENTÃO vincular; senão, parceiro livre.

### Requisito 5 — Tools e integração

#### Acceptance Criteria
1. QUANDO a IA precisa lançar ENTÃO DEVE existir uma tool dedicada (ex: `lancar_documento_financeiro`) registrada em `ai-tools.ts` + case no `ai-executor.ts`, que chama `incluirTitulo`.
2. QUANDO um documento é enviado ENTÃO o `POST /upload` DEVE rotear PDF/imagem para o processador de documento financeiro, além do XML já existente.
3. QUANDO a tool executa ENTÃO DEVE isolar por `empresaId` (do usuário autenticado) e validar documento (CPF/CNPJ) via núcleo D1.

### Requisito 6 — Núcleo determinístico, isolamento e testes

#### Acceptance Criteria
1. QUANDO texto de PDF é interpretado ENTÃO a extração de valor/vencimento/linha digitável DEVE ser uma função pura, determinística e testável (property/unit), sem depender do LLM.
2. QUANDO qualquer criação ocorre ENTÃO DEVE filtrar/isolar por `empresaId`.
3. QUANDO a suíte QA roda ENTÃO DEVE existir cobertura E2E do fluxo de lançamento assistido (pelo menos por texto/linha digitável, que não exige imagem real), reusando os helpers da D1.
4. QUANDO o LLM não estiver disponível/configurado ENTÃO o caminho determinístico (texto/linha digitável) DEVE continuar funcionando.
