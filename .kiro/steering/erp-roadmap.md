---
inclusion: manual
---

# Vizor ERP (VisioFab) — Roadmap Único e Contexto do Projeto

> **Este é o documento-mestre / fonte única de verdade do roadmap do Vizor ERP.**
> Sempre que concluir um bloco, tarefa ou spec, **atualize este arquivo**
> (status, data, resumo). Ele deve refletir a realidade do código, não a
> intenção. Ao iniciar qualquer trabalho no ERP, consulte primeiro este
> roadmap para saber o bloco/fase atual antes de agir.

## Visão Geral

O Vizor ERP (VisioFab) está evoluindo de um WMS especializado para um **ERP
completo focado no mercado brasileiro**. Diferencial competitivo: **WMS nativo
sofisticado + ERP com UX moderna + Vizor AI + preço acessível**.

Existem três "trilhos" de trabalho que este documento consolida num plano só:

1. **Trilho ERP genérico** — tornar o Vizor um ERP brasileiro competitivo
   (Fiscal, Financeiro, Vendas, Compras, Contábil). **É a Frente Atual.**
2. **Trilho gráfico (Carton Wega)** — o fluxo representante → orçamento → PCP →
   WMS contratado pela Carton Wega, com fases pendentes de refino.
3. **Trilho SaaS/plataforma** — billing do próprio Vizor (Financeiro Vizor),
   multi-tenant, onboarding, Vizor AI.

## Stack

| Camada | Tecnologia |
|--------|-----------|
| Runtime | Node.js + tsx |
| Framework | Fastify |
| ORM | Prisma 6 |
| Banco | PostgreSQL (Neon serverless) |
| Validação | Zod |
| Linguagem | TypeScript 100% |
| Frontend | Next.js 15 + Mantine 7 + react-query + Axios |
| App Mobile | Expo / EAS Build |
| Deploy back | Render (push `main` → deploy automático) |
| Deploy front | Vercel (push `main` → deploy automático) |
| Testes | Vitest + fast-check (PBT) + Playwright (E2E) |

---

## ⭐ FRENTE ATUAL — Núcleo Financeiro-Fiscal Competitivo

**Objetivo:** um Financeiro operacional robusto (nível Omie/Totvs/Sankhya) que
capta automaticamente de Compras, Vendas e lançamentos manuais de caixa, com
fechamentos, e os desafios fiscais urgentes acoplados. **Ordem de ataque
definida: Financeiro robusto primeiro, depois os fiscais.**

Esta frente está detalhada nos blocos **F1 a F5** abaixo. Cada bloco vira um
spec próprio (`requirements → design → tasks`) quando for iniciado.

| Bloco | Tema | Status | Spec |
|-------|------|--------|------|
| **F1** | Financeiro Operacional Completo | ✅ Concluído (14/09/2026) | `erp-financeiro-completo` |
| **F2** | Vendas com Emissão Real de NF-e (100% no fluxo) | 🔄 Backend do núcleo em andamento (15/09/2026) | `erp-vendas-nfe-real` |
| **F3** | Boletos Bancários + CNAB + PIX + Régua | ✅ Motor concluído (pronto p/ integrar) | `financeiro-cobranca-bancaria` |
| **F4** | Reforma Tributária (IBS/CBS/IS) | 🔲 A iniciar (greenfield) | `erp-reforma-tributaria` (a criar) |
| **F5** | SPED Fiscal + Contábil (alimentação geral) | ⚠️ Fiscal parcial | `erp-sped-fiscal-contabil` (a criar) |

> **Programa paralelo — Central de Documentos Financeiros (D1–D5):** projeto
> dedicado ao lançamento profissional de documentos financeiros (tipagem,
> fornecedor PF/PJ, contratos parcelados, folha, IA autônoma, contabilidade).
> Documento-mestre: `docs/PROGRAMA-DOCUMENTOS-FINANCEIROS.md`. A fase D4/D5
> (contábil + ECD) converge com o F5 deste roadmap.

O detalhamento de cada bloco está na seção **"Frente Atual — Detalhamento"**
mais abaixo.

---

## Mapa Geral dos Módulos (estado consolidado)

### Prioridade 1 — Base de ERP brasileiro

| # | Módulo | Status | Observação |
|---|--------|--------|-----------|
| 1 | **Fiscal** | ✅ Emissores completos (NF-e e **CT-e em produção real**) / ⚠️ SPED e Reforma pendentes | NF-e, NFC-e, **CT-e (mod. 57 v4.00 — emitindo em produção)**, MDF-e, NFS-e, apuração, certificados, contingência, GNRE, Distribuição DFe. Falta: captação do CT-e no Financeiro (F1), SPED do movimento real (F5) e Reforma Tributária (F4). |
| 2 | **Financeiro** | ⚠️ Básico (contas a pagar/receber) | **Foco da Frente Atual (F1).** |
| 3 | **Cadastros Completos** | ⚠️ Parcial | Amadurecer junto com F1. |

### Prioridade 2 — Diferencial competitivo

| # | Módulo | Status | Observação |
|---|--------|--------|-----------|
| 4 | **Vendas** | ✅ Amplo / ⚠️ NF-e real a fechar no fluxo | Pedido, orçamento, devolução, PDV, campanhas, comissão, workflow, metas, e-commerce. Emissão real existe (`NFeEmissaoService.emitir`) — **F2 garante o fluxo ponta a ponta**. |
| 5 | **Compras** | ⚠️ Parcial | Pedido + efetivação + XML ok. Falta cotação, MRP, aprovação por alçada, NF-e de devolução ao fornecedor, relatórios. |
| 6 | **Devolução** | ✅ Completo | Compra + venda (NF-e finalidade=4) + estorno financeiro + reentrada estoque. |
| 7 | **Transferência** | ⚠️ Básico | Entre empresas ok. Falta NF-e de transferência (CFOP 5152/6152), remessa/retorno industrialização, entre depósitos. |
| 8 | **Vizor AI** | ✅ Implementado | Chat com function calling, 30+ tools, onboarding real, importação XML, Distribuição DFe. |

### Prioridade 3 — Amadurecimento

| # | Módulo | Status |
|---|--------|--------|
| 9 | Contábil (exportação Domínio/Fortes) | 🔲 (parte entra em F5) |
| 10 | Integrações (marketplaces, Open Finance) | ⚠️ Estrutura básica |
| 11 | CRM integrado | 🔲 |

### Trilho Gráfico — Carton Wega (proposta contratada)

Fluxo representante → orçamento → PCP → WMS: **12/12 etapas em produção**
(ver `docs/acompanhamento-fase1-cliente.md`). Fases de refino pendentes na
seção **"Trilho Gráfico"** abaixo (data de entrega, capacidade finita, custo
real vs orçado).

### Trilho SaaS / Plataforma

| Tema | Status | Spec |
|------|--------|------|
| Financeiro Vizor (billing do SaaS, SUPER_ADMIN) | ✅ Atende hoje / melhorias futuras | `financeiro-vizor` (back) + `financeiro-vizor-frontend` |
| Multi-tenant / isolamento | ✅ Em uso | `multi-tenant-isolation` |

> **Nota importante — não confundir:** "Financeiro **Vizor**" é o billing que
> *nós* cobramos das empresas-cliente do SaaS (pronto, atende hoje). O
> "Financeiro **operacional**" (Bloco F1) é o módulo que a empresa-cliente usa
> para gerir o próprio caixa/banco. São coisas diferentes com nome parecido.

---

## Frente Atual — Detalhamento (Blocos F1 a F5)

### F1 — Financeiro Operacional Completo ✅ (14/09/2026)

**Meta:** financeiro que capta automaticamente de Compras e Vendas, permite
lançamentos manuais de caixa, faz conciliação e fechamentos, e entrega gestão
no nível dos melhores do mercado.

**Onda 1 (operação diária) — concluída:** dashboard financeiro, baixa em lote
(pagar/receber), editar/cancelar/estornar títulos, extrato por conta,
relatórios (inadimplência + export CSV), e telas frontend completas
(Dashboard, Lançamentos, Extrato, DRE, Categorias, Centros de Custo,
Fechamento, Relatórios). QA E2E em `test_43_financeiro.py`. Spec:
`.kiro/specs/financeiro-operacional-completo/`. Próximas ondas: F3 (boleto/
CNAB/PIX) e amadurecimento (conciliação de cartões, contratos recorrentes).

**Entregue no F1 base:** contas bancárias multi-conta com saldo derivado +
transferência entre contas; plano de contas gerencial (categorias) + centro de
custo + rateio; lançamentos manuais de caixa com estorno; **captação automática
do CT-e** (autorizado → conta a receber do frete, idempotente, no ponto único
`gerar-titulo-de-documento.service.ts`, plugado em `cte-emissao.service.ts`);
conciliação bancária (import OFX + matching + baixa + desfazer); fluxo de caixa,
aging e DRE gerencial; fechamento/reabertura de período com trava de escrita.
Backend: `src/modules/financeiro/` (services + rotas `/api/financeiro`, núcleo
puro testado). Frontend: telas Contas Bancárias, Fluxo de Caixa (com aging) e
Conciliação em `financeiro/*` + menu. Migração idempotente em `migrate-prod.ts`.
Doc: `docs/financeiro-operacional-f1.md`.
**Consolidação futura:** repontar geração de título de venda/compra para o
service compartilhado (hoje o CT-e já nasce nele; venda/compra seguem na lógica
inline de efetivação, que já funciona em produção).

**O que JÁ existe (base):**
- Contas a receber (CRUD + recebimento) — `/api/conta-receber`
- Contas a pagar (CRUD + pagamento) — `/api/conta-pagar`
- Geração automática de parcelas na efetivação de vendas e compras
- Estorno por devolução (conta negativa)

**O que FALTA (escopo do bloco):**

| Item | Prioridade | Descrição |
|------|:---------:|-----------|
| Multi-conta bancária | Alta | Cadastro de contas, saldo por conta, transferência entre contas (pré-requisito de boleto/CNAB do F3) |
| Fluxo de caixa | Alta | Projeção por período, multi-conta, realizado vs. previsto |
| Conciliação bancária | Alta | Import OFX/extrato + match automático extrato × títulos, baixa em lote |
| Aging (análise de vencimento) | Alta | Faixas de atraso 30/60/90/120+ |
| Categorias / Plano de contas gerencial | Alta | Classificação de receitas/despesas (base para DRE gerencial e rateio) |
| Rateio por centro de custo/projeto | Média | Dividir despesa entre centros |
| DRE gerencial + dashboards | Alta | Visão de resultado por competência/caixa |
| Contratos recorrentes | Média | Mensalidade/aluguel — gera parcelas automaticamente |
| Conciliação de cartões | Média | Vendas de adquirentes, taxas, antecipação |
| Cheques | Baixa | Emissão, custódia, compensação, devolvido |
| Provisão | Baixa | Reconhecer despesa futura antes do pagamento |

**Integrações a garantir (captação automática):** todo `PedidoVenda` efetivado
e toda compra efetivada já geram títulos; o bloco garante que caixa, banco,
categorias e centro de custo sejam preenchidos de forma consistente para os
fechamentos e para alimentar o SPED Contábil (F5).

**Captação do CT-e (já em produção):** a emissão de CT-e (modelo 57 v4.00) já
está **em uso real em produção** (ver `.kiro/steering/cte-emissao.md`). A
receita de frete de cada CT-e autorizado deve gerar **conta a receber**
automaticamente no Financeiro (por tomador/remetente conforme o responsável
pelo pagamento), da mesma forma que a NF-e de venda gera título. Amarrar essa
integração `CT-e autorizado → conta a receber` é item obrigatório do F1.

| Item | Prioridade | Descrição |
|------|:---------:|-----------|
| Integração CT-e → conta a receber | Alta | CT-e autorizado gera título de frete no Financeiro (tomador/pagador), com categoria/centro de custo, alimentando fluxo de caixa e SPED |

---

### F2 — Vendas com Emissão Real de NF-e (fluxo 100%) ⚠️

**Meta:** garantir que a venda emite NF-e real na SEFAZ ponta a ponta, sem
lacunas, com contingência e retorno amarrado ao financeiro/estoque.

**O que JÁ existe:** `NFeEmissaoService.emitir()` (cálculo de tributos →
transmissão SEFAZ → processa resposta → contingência automática 3 falhas → fila
→ retransmissão), usado por `venda-fiscal.service.ts` e devolução. DANFE PDF,
cancelamento, CC-e, inutilização.

**O que FALTA / validar:** cobertura do fluxo em todos os cenários de venda
(PDV, pedido, encomenda, consignada), tratamento de rejeições de negócio
mapeadas para o usuário, reprocessamento, e conferir amarração com contas a
receber e baixa de estoque em cada caminho. Fechar como spec dedicado.

**Progresso da sessão de 15/09/2026 (backend do núcleo F2):**
- **Ponto único pós-autorização** (espelha o do CT-e): `gerarTituloDeNfe` +
  `gerarTituloDeNfeProtegido` + `baixarEstoqueDeNfeProtegido` +
  `amarrarPosAutorizacaoNfe` + `reverterPosAutorizacaoNfe` em
  `gerar-titulo-de-documento.service.ts`. Idempotente por `documentoFiscalId`
  (título) e por `origemId=documento` (estoque, `SAIDA_VENDA`); reversão via
  `ENTRADA_ESTORNO_VENDA`. `empresaId` sempre do documento. Testado (vitest).
- **Autorização liga ao ponto único**: `NFeEmissaoService.processarRespostaSefaz`
  (cStat 100) chama `amarrarPosAutorizacaoNfe`; o cancelamento chama
  `reverterPosAutorizacaoNfe`. `venda.routes /efetivar` e
  `faturamento-parcial.service` **deixaram de gerar ContaReceber/baixa inline**
  (confiam no ponto único, após vincular o documento à venda).
- **Núcleo de rejeição** `nfe-rejeicao.ts` (`mapearRejeicao`) — cStat→orientação
  amigável + ação; total e determinístico (property-based). Exposto no retorno
  da emissão e no detalhe da NF-e.
- **Ambiente derivado do documento** (corrige risco de cStat 252): `obterAmbiente`
  prioriza `dadosNFe.ambiente`; env vira fallback. `protNFe` extrai o `tpAmb` do
  próprio XML assinado.
- **Cobertura de tags obrigatórias (evitar rejeição)**: `cMunFG`/`emit.cMun`/
  `dest.cMun` agora lidos de `Empresa.codigoMunicipio`/`Cliente.codigoMunicipio`
  com **fallback IBGE por nome+UF** (reusa `buscarMunicipiosIBGE` do CT-e);
  grupo **pag/detPag** real (de/para forma livre → `tPag`, parcelas);
  **CSOSN** (grupos ICMSSN101/102/201/202/500/900) no builder para Simples;
  **infRespTec** (novos campos `resp_tec_*` em `Empresa` + migração idempotente
  testada 2x); **fmtDataHora** com ajuste de fuso -3h (mesmo bug 228 do CT-e);
  rota manual `POST /nfe/emitir` corrigida (`inscEstadual`/`cidade`).
- **Rotas novas**: `GET /nfe/:id` (detalhe + rejeição amigável),
  `GET /nfe/:id/xml`, `POST /nfe/:id/retransmitir` (só REJEITADO; reemite e
  amarra).

**Falta ainda no F2:** PDV emitir NFC-e (`pdv.service.finalizarVenda`),
encomenda/consignada, frontend NF-e (DANFE/XML/reprocessar/labels de status),
QA `test_51_nfe.py`, deploy.

**Nota (CT-e):** o CT-e já emite em produção; o padrão "documento fiscal
autorizado → título financeiro" agora é **consistente** entre NF-e (F2) e CT-e
(F1), reaproveitando o mesmo service de ponto único.

---

### F3 — Boletos Bancários + CNAB + PIX 🔲

**Meta:** cobrança bancária real. **Depende de F1 (multi-conta bancária).**

| Item | Prioridade | Descrição |
|------|:---------:|-----------|
| Boleto registrado | Alta | Geração PDF + registro bancário + baixa automática por retorno |
| CNAB 240/400 | Alta | Remessa/retorno (Itaú, Bradesco, BB, Santander, Sicoob) |
| PIX API | Alta | Cobrança QRCode estático/dinâmico + webhook de confirmação |
| Régua de cobrança | Alta | Notificações automáticas e-mail/SMS antes e após o vencimento |
| DDA | Média | Receber títulos a pagar do banco |
| Borderô | Média | Agrupar títulos para envio em lote |

---

### F4 — Reforma Tributária (IBS / CBS / IS) 🔲 (greenfield)

**Meta:** preparar o motor fiscal e os documentos para o novo modelo tributário
brasileiro. **Hoje NÃO há nada de IBS/CBS/IS no código** — é campo aberto.

| Item | Descrição |
|------|-----------|
| Motor de cálculo IBS/CBS/IS | Novos tributos convivendo com ICMS/ISS no período de transição |
| Layout NF-e/NFC-e/NFS-e novos grupos | Grupos de IBS/CBS conforme notas técnicas |
| Cadastros | Classificação tributária, alíquotas por ente, regras de crédito |
| Transição | Cálculo dual (modelo atual + novo) durante o período legal |
| Impacto no Financeiro | Novos tributos refletidos em títulos, apuração e SPED |

> **Ação:** acompanhar as Notas Técnicas oficiais (IBS/CBS) para dimensionar o
> spec — o cronograma legal define o "quando", não só a nossa priorização.

---

### F5 — SPED Fiscal + Contábil (alimentação a partir do movimento real) ⚠️

**Meta:** que o SPED seja gerado a partir do movimento real (documentos
fiscais, financeiro, estoque), não só o esqueleto do arquivo.

**O que JÁ existe:** geração de SPED (EFD ICMS/IPI, Contribuições) + histórico
no módulo Fiscal.

**O que FALTA:** alimentar os blocos com o movimento real do ERP (fiscal +
financeiro do F1 + estoque), SPED Contábil (ECD/ECF), exportação para Domínio/
Fortes, e validação cruzada (apuração × SPED × financeiro). Depende de F1
(plano de contas/categorias) e conversa com F4 (novos tributos).

---

## Trilho Gráfico — Carton Wega (refinos pendentes)

Fluxo em produção (12/12 etapas). Docs de referência: `docs/proposta-comercial-carton-wega.md`,
`docs/proposta-funcionalidades-discriminada.md`, `docs/acompanhamento-fase1-cliente.md`.
Steering do módulo: `.kiro/steering/pcp-modulo.md`.

> Nota de consistência: o `acompanhamento-fase1-cliente.md` (26/08) marca
> verificação de estoque, reserva automática e sugestão de compra como ✅ em
> produção, enquanto o `proposta-funcionalidades-discriminada.md` (25/08) ainda
> as listava como pendentes. Prevalece o acompanhamento (mais recente).
> **Confirmar no código antes de retrabalhar qualquer item marcado ✅.**

| Item | Status | Descrição |
|------|:------:|-----------|
| Verificação de estoque na programação | ✅ | Ao programar OP, compara BOM × saldo disponível (WMS+ERP−reservas) |
| Reserva automática de materiais | ✅ | Ao liberar OP, cria `ReservaProducao` (empenho) |
| Requisição de compra automática | ✅ | Falta de material → `SugestaoCompra` PENDENTE |
| Geração de OP a partir de Pedido de Venda | ✅ | `POST /gerar-de-pedido` |
| Cálculo automático de data de entrega | 🔲 | Backward scheduling por tempos do roteiro/turnos/calendário |
| Capacidade finita (fila de produção) | 🔲 | Considerar OPs já na fila de cada centro ao estimar prazo |
| Data de entrega no orçamento | 🔲 | Prazo = produção + fila + lead time de compra |
| Verificação/previsão de estoque no orçamento | 🔲 | Papel disponível? Se não, prazo de compra embutido |
| Integração CalcGraf → OP completa | 🔲 | OP com BOM completa + etapas + reserva + programação de entrega |
| Custo real vs orçado | 🔲 | Comparar consumo/horas reais × orçado; dashboard de rentabilidade |

---

## Backlog dos Demais Módulos (fora da Frente Atual)

### Compras (amadurecer para "completo")
Cotação/solicitação, MRP, workflow de aprovação por alçada, follow-up de
entregas, avaliação de fornecedor, acordo comercial, NF-e de devolução ao
fornecedor, recebimento parcial, relatórios de compras.

### Transferência (regularização fiscal)
NF-e de transferência (CFOP 5152/6152), remessa/retorno para industrialização
(5901/6901, 5902/6902), transferência entre depósitos, controle de filiais,
relatório de movimentação.

### Prioridade 3
Contábil (exportação Domínio/Fortes — parte em F5), integrações
(marketplaces, Open Finance), CRM integrado.

---

## Próximos Specs a Criar (ordem)

| Ordem | Spec | Bloco | Impacto |
|-------|------|-------|---------|
| 1 | `erp-financeiro-completo` | F1 | Financeiro robusto — base de tudo |
| 2 | `erp-vendas-nfe-real` | F2 | Fecha emissão real ponta a ponta |
| 3 | `erp-cobranca-bancaria` | F3 | Boleto/CNAB/PIX (depende de F1) |
| 4 | `erp-reforma-tributaria` | F4 | Compliance futura (segue calendário legal) |
| 5 | `erp-sped-fiscal-contabil` | F5 | Alimenta SPED do movimento real |

Depois da Frente Atual: `erp-compras-completo`, `erp-transferencia-fiscal`,
e os refinos do Trilho Gráfico.

---

## Padrões de Desenvolvimento

1. Cada módulo vive em `src/modules/{modulo}/`; rotas Fastify com prefixo `/api/{modulo}/`.
2. Validação com Zod em todas as rotas; `moduloGuard` para acesso por módulo.
3. `ALL_MODULOS` em `empresa-selector.routes.ts` atualizado ao adicionar módulo novo.
4. **Migração obrigatória no mesmo commit:** toda alteração em `prisma/schema.prisma`
   inclui o equivalente idempotente em `prisma/migrate-prod.ts`, testado 2x local
   (ver `.kiro/steering/database-migrations.md`). Produção NÃO usa `migrate deploy`.
5. **Isolamento multi-tenant:** `request.prismaScoped` para modelos em `ISOLATED_MODELS`;
   filtro manual por `empresaId` nos demais (ver `.kiro/steering/ATENCAO-pontos-verificar.md`).
6. Integração fiscal via services (`vendaFiscalService`, `compraFiscalService`, `nfeEmissaoService`).
7. XML builders como funções puras (testáveis isoladamente); contingência automática.
8. Testes: Vitest + fast-check (funções puras) + Playwright/pytest (E2E — ver `.kiro/steering/qa-automatizado.md` no front).
9. Nunca commitar direto em `main`/`master` — sempre branch nova.

## Regras de Continuidade entre Sessões

1. **Comece consultando este roadmap** para saber o bloco/fase atual.
2. **Atualize este roadmap** ao concluir bloco/tarefa/spec (status + data + resumo).
3. **Um spec por bloco** em `.kiro/specs/`, ciclo requirements → design → tasks.
4. Ordem da Frente Atual é deliberada (F1 → F5); não pular sem pedido explícito.
5. Este arquivo é a fonte única — se divergir dos docs de proposta, prevalece o
   estado confirmado no código.

## Referências

- Fiscal: `.kiro/specs/erp-modulo-fiscal/`, `.kiro/specs/erp-fiscal-completar/`
- Vendas: `.kiro/specs/erp-vendas-pedido-completo/`
- Financeiro básico: `src/modules/conta-pagar/`, `src/modules/conta-receber/`
- Emissão NF-e: `src/modules/fiscal/emissor-dfe/nfe/nfe-emissao.service.ts`
- Integração venda→fiscal: `src/modules/fiscal/integracao/venda-fiscal.service.ts`
- Financeiro Vizor (SaaS): `.kiro/specs/financeiro-vizor/`
- PCP: `.kiro/steering/pcp-modulo.md`
- Migrações: `.kiro/steering/database-migrations.md`
- Multi-tenant: `.kiro/steering/ATENCAO-pontos-verificar.md`
- CT-e: `.kiro/steering/cte-emissao.md`

---

*Vizor ERP — Desenvolvido por Claudio Rangel*
