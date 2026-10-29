# Projeto — Módulo COMERCIAL (Vizor / Carton Wega)

> **DOCUMENTO-MESTRE / FONTE DE VERDADE.** Este arquivo existe para que NENHUMA
> sessão do Kiro se perca no projeto de transformar o atual módulo "Orçamento
> Gráfico" num **módulo Comercial completo** (pedidos de representantes/
> vendedores → orçamento → proposta → aprovação do cliente → amostra → PCP →
> faturamento). Antes de trabalhar em qualquer bloco do Comercial, LEIA este
> documento + o blueprint de fluxo `fluxo-comercial-orcamento-pcp-faturamento.md`
> + o backlog `BACKLOG-orcamento-grafico-caio.md` (ponto P17).
>
> **Sempre atualize este documento** ao concluir um bloco/spec: marque status,
> data e resumo. O documento deve refletir a realidade do código.
>
> Criado: 29/10/2026. Origem: pedido de Caio (query 21, com 6 imagens — planilha
> de pedidos da Carton Wega + 2 modelos de proposta PDF).

---

## 0. Por que este projeto existe (pedido do usuário)

Caio (Carton Wega) pediu para **expandir o P17** (que era só "Fechamento do
orçamento") para um **módulo Comercial de ponta a ponta**. Em resumo, ele quer:

1. **Renomear** o módulo "Orçamento Gráfico" → **"Comercial"** (menu e títulos).
2. **Menu "Propostas"** para gerenciar os **pedidos que os representantes/
   vendedores lançam** (via Portal). O portal deve ter um **formulário baseado
   na planilha de pedidos da Carton Wega** (ver §3, campos das imagens). A tela
   de lançamento de pedido distingue **repetição / mostruário / novos**, permite
   **cadastrar cliente novo** com **consulta de CNPJ na Receita**.
3. **Menu de cálculo de orçamento** recebe os pedidos **LIBERADOS** pelo
   comercial; comunicação entre os menus. Fluxo completo: orçamento aprovado →
   **envia proposta** (e-mail/WhatsApp) → aguarda **aceite do cliente** →
   **validação por assinatura/senha do setor de orçamento** → encaminha ao
   **PCP (abre OP)** → **faturamento**. STATUS visível em TODAS as etapas,
   principalmente **AMOSTRA** (envio por correio/caminhão + retorno/aprovação).
   Pesquisar comportamento de mercado (Quote-to-Order / MIS gráfico).
4. **P17 original** — tela de **Fechamento** com 4 abas (Preço de Venda / Taxas
   de Produção / Custos Diretos de Venda / Diversos), **EDITÁVEL**, que
   **RECALCULA o preço SÓ desse orçamento** (override por orçamento, não muda
   cadastro global). Confirmado pelo usuário (queries 3, 4, 5).
5. **Templates de proposta em PDF** (modelo Carton Wega das imagens) com
   **editor de formato** + um **default**.

---

## 1. O que JÁ EXISTE no Vizor (não reinventar)

Levantado no blueprint. Reaproveitar ao máximo — o projeto é mais "ligar as
peças + preencher lacunas" do que construir do zero.

| Peça | Estado | Onde |
|------|--------|------|
| Portal do Representante (externo) | Existe | spec `portal-representante*`; `src/modules/portal-representante/` (back) + `src/components/portal-rep/` (front) |
| `SolicitacaoOrcamentoRep` (máquina de estado PENDENTE→PRECIFICADA→…) | Existe | portal-representante |
| `OrcamentoGrafico` (cálculo + proposta, status RASCUNHO→ENVIADO→APROVADO) | Existe | `orcamento-grafico.routes.ts` |
| Conversão orçamento→`PedidoVenda` (enviar/aprovar/gerar pedido) | Existe | `orcamento-grafico.routes.ts` (`/enviar`, `/aprovar`) |
| `PedidoVenda` (6 status RASCUNHO→…→FATURADO) | Existe | módulo Vendas |
| Geração de OP a partir do pedido | Existe | `POST /ordens-producao/gerar-de-pedido` |
| Integração PCP→WMS (PA ao concluir OP) | Existe | `etapa-operacional.routes.ts` |
| Faturamento NF-e (saída) | Existe | módulo Fiscal |
| Pipeline do representante (cruza PV+OP) | Existe | portal-representante |
| Puxar cálculo / biblioteca de cálculos (repetição) | Existe | `orcamento-grafico/calculo-grafico/` |
| Relatório/PDF do orçamento | Existe | `orcamento-grafico` PDF service |

**Peças NOVAS (do blueprint):** status `CONVERTIDO`; pedido nascer COM itens;
`AprovacaoAmostra`; `NotificacaoComercial`; `ConversaoOrcamentoLog`; gatilho de
faturamento; override de custos por orçamento (P17).

---

## 2. Blocos do projeto (ordem deliberada — risco crescente)

> Cada bloco = UMA spec em `.kiro/specs/`. A ordem reduz risco: primeiro o que
> NÃO toca o motor de preço calibrado (rename, propostas, status), depois o
> hand-off, e por último o Fechamento editável (que mexe na formação de preço).

> **⚠️ ATUALIZADO 29/10/2026 após mapeamento do código real.** Muita coisa já
> estava implementada em sessões anteriores (hand-off comercial completo). A
> tabela abaixo reflete o ESTADO REAL do código, não o plano inicial.

| # | Bloco | Spec (nome sugerido) | Toca motor de preço? | Status REAL |
|---|-------|----------------------|----------------------|-------------|
| B0 | **Rebranding** "Orçamento Gráfico" → "Comercial" (menu/títulos) | — | ✅ FEITO (sidebar `title:'Comercial'`) |
| B1 | **Templates de Proposta PDF** (modelo Carton Wega + editor de formato + default) | Não | 🟡 QUASE (espinha + cadastro feitos; falta seed Wega c/ imagens + seletor no detalhe) |
| B2 | **Portal — Formulário de Solicitação** (campos da planilha Wega + cadastro de cliente novo + **consulta CNPJ Receita** + Repetição/Mostruário/Novos) | Não | 🟡 PARCIAL (form básico existe; faltam campos da planilha, CNPJ, tipos de pedido) |
| B3 | **Menu Propostas / painel de status unificado** ponta a ponta | Não | 🟡 PARCIAL (dashboard + a-converter + solicitações existem; falta painel unificado + menu "Propostas" dedicado) |
| B4 | **Hand-off / Conversão completa** (status CONVERTIDO; pedido nasce com itens; `NotificacaoComercial`) | Não | ✅ FEITO (`handoff-comercial/converter-orcamento.service.ts`) |
| B5 | **Aprovação de Amostra/Modelo** (`AprovacaoAmostra`; rodadas; bloqueia conversão) | Não | ✅ FEITO (telas interno+portal-rep; model+rotas) |
| B6 | **Envio de Proposta + aceite do cliente + assinatura/senha do setor** | Não | ⬜ PENDENTE (há `/enviar-email` fixo; falta aceite+assinatura) |
| B7 | **Gate de margem** na conversão (alçada de desconto/margem) | Não | 🟡 PARCIAL (helper puro `gate-margem.puro.ts` + código MARGEM_PENDENTE; falta plugar `RegraAprovacao`/UI) |
| B8 | **Elo PCP completo + gatilho de faturamento** | Não | ⬜ PENDENTE |
| B9 | **P17 — Fechamento EDITÁVEL (4 abas) com recálculo por orçamento** | **SIM — ALTO RISCO** | ⬜ PENDENTE |

**Lacunas reais a atacar (ordem):** B1 (templates) → B2 (form do portal + CNPJ) →
B3 (painel unificado + menu Propostas) → B6 (envio/aceite/assinatura) → B7 (fechar
o gate) → B8 (elo PCP/faturamento) → **B9 (Fechamento editável, por último — mexe
na formação de preço calibrada contra o Calcgraf, golden 15.235 ≤0,5%; faseado,
com golden travando a paridade ANTES de expor a edição).**

**Achados do mapeamento a tratar:** (a) páginas órfãs de menu — `dashboard/` e
`importar/` existem mas não estão no sidebar; (b) duplicidade: `/:id/aprovar`
(legada, cria pedido SEM itens) vs `/:id/converter` (nova, cria pedido COM itens)
— o hand-off correto é o `/converter`.

---

## 3. Formulário de Solicitação — campos da planilha Carton Wega (B2)

> Transcrição dos campos vistos nas imagens da query 21 (planilha de pedidos).
> **A CONFIRMAR com o usuário** o conjunto final + obrigatoriedade. Registro
> inicial para não perder:

- É cliente? (sim/não) — se não, abre cadastro de cliente novo
- CNPJ / CPF (com **consulta à Receita** para autopreencher razão/fantasia/
  endereço)
- Mercado (segmento/ramo do cliente)
- Estado de origem / Cidade
- Tipo de entrega / Local de entrega
- Fracionado? (sim/não)
- Prazo de pagamento
- Nome do produto
- Acabamento
- Precisa de amostra? (sim/não)
- Quantidade (tiragem)
- Gramatura
- (demais campos a confirmar nas imagens: "gartidão"/garantia?, cores, formato…)

Tipos de pedido na tela de lançamento: **Repetição** (puxa cálculo existente) ·
**Mostruário** · **Novos**.

**Consulta CNPJ Receita:** pesquisar provedor (BrasilAPI `/cnpj/v1/{cnpj}` é
gratuito e sem chave; ReceitaWS tem limite). Definir no design do B2.

---

## 4. Templates de Proposta PDF (B1)

As 2 imagens de modelo de proposta (query 21) são o layout-alvo da Carton Wega.
Hoje já existe geração de PDF do orçamento (`orcamento-grafico` PDF service via
pdfkit). O B1 deve: (a) reproduzir o modelo Carton Wega como **template
default**; (b) permitir **editar o formato** (cabeçalho/logo/campos exibidos/
textos fixos/rodapé); (c) escolher o template ao enviar a proposta. Avaliar
tabela `TemplateProposta` (empresaId, nome, layoutJson, default) — decidir no
design. As imagens dos modelos devem ser salvas em `docs/` como referência (o
usuário anexou no chat; pedir reenvio se necessário para fidelidade do layout).

---

## 5. Decisões já tomadas (não reabrir sem motivo)

- **D1 (item→SKU, opção B):** na conversão, criar `Produto`/SKU de verdade sob
  demanda a partir do cálculo, com salvaguardas anti-colisão (nunca tocar
  `Produto` com OP/estrutura/estoque/pedido). Base: `docs/calcgraf-fase-produtos-plano.md`.
- **D2 (amostra):** exigência configurável — padrão da empresa
  (`comercial.exigir-amostra`: SEMPRE|NUNCA|QUANDO_MARCADO) + override por
  documento; sugestão automática quando `[TipoOp]` = NOVO/ALTERAÇÃO. Quando
  `exigeAmostra=true`, conversão/liberação ao PCP só após amostra APROVADA.
- **P17/B9 (confirmado queries 3-5):** as 4 abas do Fechamento estão ligadas ao
  **ORÇAMENTO** (não ao item). Edição **RECALCULA o preço SÓ desse orçamento**
  (override local, não muda cadastro global).
- **Restrições/Materiais (P16):** INFORMATIVOS, não entram no cálculo. (Já
  entregue/commitado — ver backlog.)

---

## 6. Regras de engenharia do projeto

- **NUNCA mexer no motor** (`orcamento-grafico-calculo.service.ts`) sem spec +
  golden/não-regressão. Paridade Calcgraf calibrada (golden 15.235 ≤0,5%). Isso
  trava especialmente o B9.
- **Back e front são repos separados.** No back, `schema.prisma` +
  `migrate-prod.ts` SEMPRE no mesmo commit (idempotente — Postgres local off,
  roda no deploy do Render).
- **Commit+push na `main`** nos dois repos (padrão real). `git push` retorna
  exit 1 com sucesso no PowerShell — confirmar a linha `xxx..yyy main -> main`.
- **Deixar FORA dos commits** 2 arquivos frontend não relacionados:
  `src/app/(interna)/configurador/produtos/page.tsx` e
  `src/data/hooks/useProduto.ts`.
- **Multi-tenant:** toda query filtra `empresaId` EXPLÍCITO (não confiar só no
  `prismaScoped` — bypass SUPER_ADMIN). Ver steering `ATENCAO-pontos-verificar`.
- Isolamento do portal externo: auth própria do representante (`portalAuth`),
  nunca o JWT interno.

---

## 7. Perguntas de escopo abertas (responder antes de cada bloco)

Registradas para não perder. (O usuário responderá por texto — `user_input` não
disponível nesta sessão.)

### Gerais
- G1. "Comercial" substitui o nome do menu em TODO lugar (sidebar, títulos,
  breadcrumbs) ou mantém "Orçamento Gráfico" como submenu dentro de "Comercial"?

### Portal/Solicitação (B2)
- G2. Lista COMPLETA e obrigatoriedade dos campos do formulário (confirmar §3
  contra as imagens).
- G3. Consulta CNPJ: pode usar BrasilAPI (grátis, sem chave)? Ou há provedor
  preferido/contratado?
- G4. "Mostruário" — é um tipo de pedido sem cobrança (amostra de catálogo) ou
  um pedido normal marcado como mostruário? Afeta preço?

### Propostas/Pipeline (B3)
- G5. Quem pode LIBERAR um pedido do representante para o cálculo (perfis)?
- G6. O painel de status unificado é uma tela nova no Comercial, ou estende o
  pipeline do representante que já existe?

### Envio/Aceite/Assinatura (B6)
- G7. "Assinatura/senha do setor de orçamento" = uma senha compartilhada do
  setor, OU a senha do próprio usuário com perfil de orçamento? (recomendo o 2º
  — auditável por usuário).
- G8. Aceite do cliente: por link no e-mail (clica "aceito"), ou o representante
  registra o aceite manualmente no portal? WhatsApp é só canal de envio do link?

### Fechamento editável (B9)
- G9. Quais abas/campos são realmente EDITÁVEIS e disparam recálculo (todas as 4,
  ou começar só por "Preço de Venda"/margem)?
- G10. O override por orçamento é PERSISTIDO (salvo no orçamento) e some ao
  recalcular do zero, ou é efêmero (só na tela)?

---

## 8. Histórico de execução (atualizar a cada rodada)

- **29/10/2026** — Documento-mestre criado. P1/P15/P16 confirmados commitados
  (`2bc3ab4`, `a590079`); backlog corrigido.
- **29/10/2026 (2)** — Mapeamento do código real (sub-agente). Descoberto que
  B0/B4/B5 JÁ ESTAVAM FEITOS e B3/B7 parciais (sessões anteriores já tinham
  construído o hand-off comercial completo). Tabela de blocos corrigida para o
  estado real. Próximo alvo: começar pelos pendentes puros na ordem B1 → B2 →
  B3 → B6 → B7 → B8 → B9.
- **29/10/2026 (3)** — B1 espinha dorsal implementada (backend): model
  `TemplateProposta` + migrate-prod idempotente; `template-proposta.service.ts`
  (CONFIG_DEFAULT_EMBUTIDA, normalizarConfig puro, obterConfigTemplate, CRUD +
  default único); `gerarPropostaPdf` agora dirigido por `config` (cabeçalho/
  textos/blocos; sem config = layout atual, não-regressão); rotas CRUD
  `/api/orcamento-grafico/templates-proposta`; `templateId` plugado no download
  e no envio por e-mail. Verificação: get_diagnostics limpo (6 arquivos) +
  suíte orcamento-grafico **283 passed / 0 falhas** (golden 15.235 intacto) +
  prisma generate OK. Commit back `8387c7817`.
- **29/10/2026 (4)** — B1 frontend: tela de cadastro de Templates de Proposta
  (`/orcamento-grafico/cadastros/templates-proposta`) + item no menu (grupo
  Cadastros). get_diagnostics limpo. Commit front `60f9840`.
  **FALTA do B1:** task 6 (seed "Padrão Carton Wega" — depende das IMAGENS do
  modelo de proposta) + task 8 (seletor de template + botões baixar/enviar no
  detalhe do orçamento `[id]` — hoje o front NÃO tem esses botões plugados; fazer
  junto do B3/painel). Spec: `.kiro/specs/comercial-templates-proposta/`.
  Próximo: B2 (formulário do portal + cadastro de cliente novo + consulta CNPJ).
