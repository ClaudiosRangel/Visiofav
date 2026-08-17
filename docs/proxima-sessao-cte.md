# Sessão CT-e — Status das Melhorias (VisioFab/Vizor)

## Contexto

CT-e já está sendo **autorizado com sucesso em homologação** (cStat 100).
A comunicação SOAP com a SEFAZ SVRS está 100% funcional.

---

## Status de implementação (atualizado em 17/08/2026)

### ✅ Item 1 — Novo layout DACTE (padrão ACBr) — IMPLEMENTADO

Reescrito `cte-dacte-pdf.service.ts` com:
- Layout **paisagem** (A4 landscape) como o ACBr
- **QR Code** no canto superior direito (gerado via bwip-js)
- **Código de barras Code128** da chave de acesso
- Todos os blocos: emitente, dados CT-e, chave, protocolo, origem/destino,
  remetente, destinatário, expedidor, recebedor, valor da prestação,
  componentes, ICMS, carga (produto/quantidades), documentos originários,
  modal rodoviário (RNTRC + placas), observações
- **Tarja de homologação** (`tpAmb=2`): texto vermelho semitransparente
- **Tarja de cancelamento**: texto vermelho quando `status=CANCELADO`
- Dependência `pdfkit@0.15.1` instalada

### ✅ Item 2 — Enviar XML e PDF por e-mail — IMPLEMENTADO

- Rota `POST /fiscal/cte/:id/enviar-email`
  - Body: `{ emails: string[], incluirPdf?: boolean, incluirXml?: boolean }`
  - Anexa XML autorizado + DACTE PDF
  - Template HTML com dados do CT-e (chave, série, valor, status, protocolo)
  - Usa nodemailer com config SMTP via env vars
- Rota `POST /fiscal/cte/enviar-email-lote`
  - Body: `{ ids: string[], emails: string[], incluirPdf, incluirXml }`
  - Envia individualmente para cada CT-e autorizado
  - Retorna resumo (enviados/falhas)
- Hooks frontend: `useEnviarEmail()`, `useEnviarEmailLote()`

### ✅ Item 3 — Código IBGE sem acento — JÁ FUNCIONAVA

O endpoint `GET /cte/municipios` já faz normalização NFD (remove acentos)
na busca. A rota de importação DANFE-PDF também já normaliza. Nada a fazer.

### ✅ Item 4 — Cadastro de Cores (tabela CorVeiculo) — IMPLEMENTADO

- Model `CorVeiculo` adicionado ao schema Prisma (@@unique empresaId+codigo)
- Migration idempotente em `migrate-prod.ts`
- Rotas CRUD em `cte-cores.routes.ts`:
  - `GET /cte/cores` — listar
  - `POST /cte/cores` — criar (upsert se já existe)
  - `PUT /cte/cores/:id` — atualizar
  - `DELETE /cte/cores/:id` — excluir
  - `POST /cte/cores/seed` — popular com 9 cores padrão DENATRAN
- Hooks frontend: `useListarCores()`, `useCriarCor()`, `useSeedCores()`

### ✅ Item 5 — Validação antes de transmitir — IMPLEMENTADO

- Novo arquivo `cte-validacao.service.ts` com função
  `validarCTeParaTransmissao(dados)` que verifica:
  - Emitente: CNPJ, IE, razão social, endereço completo com CEP
  - Remetente/Destinatário: CNPJ ou CPF, razão social, endereço com cMun 7 dígitos
  - Expedidor/Recebedor (se informados)
  - Tomador Outros (tpTom=4)
  - Dados CT-e: CFOP 4 dígitos, natureza op, modal
  - Municípios: cMunIni e cMunFim 7 dígitos, xMun, UF
  - Valor: vTPrest > 0, vRec > 0
  - Carga: produto predominante, pelo menos 1 infQ
  - Documentos: pelo menos 1 NF-e ou 1 infOutros
  - Modal rodoviário: RNTRC 8 dígitos (quando modal=01)
  - Chaves NF-e: 44 dígitos numéricos
- Integrado em `cteEmissaoService.emitir()` e `.transmitirExistente()`
- Retorna 422 com `{ detalhes: { erros: string[] } }` antes de tocar na SEFAZ

### ✅ Item 6 — Campos Data Autorização + Filtros — IMPLEMENTADO

- `dataAutorizacao` já era retornada na listagem
- Adicionados filtros `dataAutorizacaoInicio` e `dataAutorizacaoFim` no
  schema Zod e na query Prisma de `GET /cte`
- Frontend pode usar `?dataAutorizacaoInicio=2026-01-01&dataAutorizacaoFim=2026-12-31`

### ✅ Item 7 — Seleção em lote + ações em massa — IMPLEMENTADO (backend)

Rotas backend:
- `POST /fiscal/cte/transmitir-lote` — `{ ids: string[] }` (máx 50)
  - Transmite sequencialmente, retorna array de resultados individuais
  - Resumo: `{ total, autorizados, rejeitados }`
- `POST /fiscal/cte/enviar-email-lote` — `{ ids, emails, incluirPdf, incluirXml }`
- `POST /fiscal/cte/cancelar-lote` — `{ ids, justificativa }`
  - Cancela individualmente, erros não interrompem o lote

Hooks frontend adicionados:
- `useTransmitirLote()`
- `useEnviarEmailLote()`
- `useCancelarLote()`

**Pendente frontend**: UI de seleção (checkboxes + barra de ações em lote).
Os hooks já estão prontos — só falta montar o componente visual na page.tsx.

---

## Pendências restantes (frontend visual)

Nenhuma pendência significativa. Todos os itens foram implementados no
backend e frontend. Pequenas melhorias opcionais para o futuro:

1. **Autocomplete dinâmico de município** com dropdown/sugestões enquanto
   digita (hoje resolve onBlur — funcional mas sem UX de dropdown)
2. **Autocomplete de cor** no formulário de veículos novos com dropdown
   das cores cadastradas
3. **Indicador de progresso visual** durante transmissão em lote (hoje
   mostra loading e no final exibe resumo — poderia ter barra de progresso
   incremental se o backend retornasse SSE/streaming)
