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
| B1 | **Templates de Proposta PDF** (modelo Carton Wega + editor de formato + default) | Não | ✅ FEITO (espinha + cadastro + estilo WEGA + seed + task 8: proposta PDF/seletor no detalhe) |
| B2 | **Portal — Formulário de Solicitação** (campos da planilha Wega + cadastro de cliente novo + **consulta CNPJ Receita** + Repetição/Mostruário/Novos) | Não | ✅ FEITO (Fase A: CNPJ+cliente novo; Fase B: 23 campos da planilha + tipo de pedido) |
| B3 | **Menu Propostas / painel de status unificado** ponta a ponta | Não | ✅ FEITO (tela Pipeline com régua de estágios + rota de listagem; task 8 do B1 — proposta PDF no detalhe — fechada) |
| B4 | **Hand-off / Conversão completa** (status CONVERTIDO; pedido nasce com itens; `NotificacaoComercial`) | Não | ✅ FEITO (`handoff-comercial/converter-orcamento.service.ts`) |
| B5 | **Aprovação de Amostra/Modelo** (`AprovacaoAmostra`; rodadas; bloqueia conversão) | Não | ✅ FEITO (telas interno+portal-rep; model+rotas) |
| B6 | **Envio de Proposta + aceite do cliente + assinatura/senha do setor** | Não | ✅ FEITO (assinatura por senha do usuário na liberação ao PCP; envio de proposta no B1; aceite via portal já existia) |
| B7 | **Gate de margem** na conversão (alçada de desconto/margem) | Não | ✅ FEITO (backend já plugado com RegraAprovacao/SolicitacaoAprovacao; front: desconto no modal de conversão + tratamento MARGEM_PENDENTE) |
| B8 | **Elo PCP completo + gatilho de faturamento** | Não | ✅ FEITO (gatilho OP→pedido EFETIVADO+notificação já existia; sino adicionado ao Pipeline) |
| B9 | **P17 — Fechamento EDITÁVEL (4 abas) com recálculo por orçamento** | **SIM — ALTO RISCO** | ✅ FEITO (Fase 1: 4 abas; Fase 2: edição de margem/desconto reaplica o PREÇO sobre o custo salvo — engenharia calibrada intacta; golden preservado) |

**Lacunas reais a atacar (ordem):** B1 (templates) → B2 (form do portal + CNPJ) →
B3 (painel unificado + menu Propostas) → B6 (envio/aceite/assinatura) → B7 (fechar
o gate) → B8 (elo PCP/faturamento) → **B9 (Fechamento editável, por último — mexe
na formação de preço calibrada contra o Calcgraf, golden 15.235 ≤0,5%; faseado,
com golden travando a paridade ANTES de expor a edição)** → **B10 (permissões —
DEPOIS do B9, ver abaixo)**.

### B10 — Controle de Permissões do Comercial (acordado 29/10/2026, FAZER POR ÚLTIMO)

O usuário pediu que o módulo Comercial tenha controle de permissões **igual ao
PCP**. Decisão: fazer **depois** de finalizar B8 e B9 (permissões protegem telas
que ainda serão criadas). **Padrão a replicar = PCP** (`permissoes-pcp.routes.ts`):
- Permissões por USUÁRIO/empresa na tabela `Parametro`, chave
  `comercial.permissoes.<usuarioId>` (JSON). Sem schema novo.
- ADMIN/SUPER_ADMIN bypass. Default = TUDO LIBERADO (não-regressão).
- Tela **Comercial → Permissões** (só ADMIN) espelhando a do PCP
  (`pcp/permissoes/page.tsx`): lista usuários + switches por ação/menu.
- `GET /permissoes/minha` (front oculta botões) + `GET/PUT /permissoes[/:usuarioId]`.
- **Ações aprovadas pelo usuário** (flags): `podeVerComercial`, `podeCriarOrcamento`,
  `podeEnviarProposta`, `podeAprovarOrcamento`, `podeConverterPedido`,
  `podeAplicarDesconto`, `podeLiberarPcp`, `podeGerenciarAmostras`,
  `podeEditarCadastros`. + **acesso por menu** (habilitar/ocultar cada tela).
- Enforcement nas rotas sensíveis (criar/enviar/aprovar/converter/liberar-pcp/
  amostras/cadastros) com bypass admin, igual ao PCP.

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
- **29/10/2026 (5)** — B1 estilo WEGA + seed. As imagens do modelo de proposta
  Carton Wega chegaram (2 modelos: 1 item e multi-item "aprovação de cálculo").
  Registradas em `docs/modelo-proposta-cliente-carton-wega.md`. Implementado:
  campo `estilo: 'PADRAO' | 'WEGA'` + `textos.cidadeData` na config; renderizador
  `renderWega` no PDF service (cabeçalho Carton Wega + Proposta/Cálculo nº + À
  cliente + saudação + dados do produto + tabela de preços 1-item ou multi-item
  com quebra de página + condições + bloco IMPORTANTE + assinatura do cliente);
  `vendedorNome` populado nas rotas de PDF; tela de cadastro ganhou seletor de
  estilo + campo cidade; seed `scripts/seed-template-proposta-wega.mjs`
  (idempotente, cria o default WEGA p/ a Wega — rodar em produção é passo do
  usuário). Verificação: suíte **284 passed/0 falhas** (golden intacto) +
  get_diagnostics limpo + teste do service 7/7. CNPJ na Receita (B2): usuário
  autorizou reaproveitar o do módulo `prospeccao` (BrasilAPI/CNPJá Open).
  **Único resto do B1:** task 8 (seletor de template + botões baixar/enviar
  proposta no detalhe `[id]`) — será feita junto do B3. Próximo: B2.
- **29/10/2026 (6)** — Passo operacional: seed do template "Padrão Carton Wega"
  rodado em produção (Neon) — reportou que o template JÁ EXISTE (tabela
  `template_proposta` criada pelo deploy + template default WEGA presente). B1
  100% operacional em produção (resta só a task 8 de UI junto do B3).
- **29/10/2026 (7)** — B2 Fase A (sem schema). Spec
  `.kiro/specs/comercial-portal-solicitacao/`. Consulta de CNPJ exposta ao portal
  (`GET /clientes/cnpj/:cnpj`, reaproveita `enriquecerCnpj` BrasilAPI/CNPJá Open)
  + autopreenchimento no cadastro de cliente novo do portal (o `POST /clientes`
  já existia). Front: fluxo "Cadastrar cliente novo" no formulário de nova
  solicitação (CNPJ → Buscar na Receita → campos → Salvar e selecionar). Hooks
  `useConsultarCnpj`/`useCriarCliente`. get_diagnostics limpo.
  **FASE B do B2 (aguarda usuário):** campos da planilha Carton Wega
  (mercado/UF/cidade/entrega/fracionado/prazo pgto/gramatura/precisa amostra) +
  tipo de pedido (Repetição/Mostruário/Novos) em `SolicitacaoOrcamentoRep` —
  precisa da LISTA FINAL de campos. Próximo: B3 (painel unificado + menu
  Propostas + fechar task 8 do B1).
- **29/10/2026 (8)** — B2 Fase B (campos da planilha). Planilha de pedidos Carton
  Wega recebida (3 imagens, 30 colunas) → `docs/planilha-pedidos-carton-wega.md`.
  Schema: 23 colunas aditivas/nullable em `SolicitacaoOrcamentoRep` + migrate-prod
  idempotente (ADD COLUMN IF NOT EXISTS em loop). Backend: Zod + service +
  SOLICITACAO_SELECT estendidos. Front: formulário do portal ganhou Card "Tipo de
  pedido" (Novo/Repetição/Mostruário) + Card "Detalhes do pedido" com todos os
  campos (mercado, UF/cidade, entrega única/fracionada + dias, exportação,
  variações de arte, cartão, gramatura, medidas, FSC, corte interno, passtime,
  acabamento manual, matriz, validade, qtd por volume, anexos, discriminação).
  Verificação: get_diagnostics limpo (back+front) + prisma generate OK; campos
  nullable = não-regressão. **B2 COMPLETO.** Commits a seguir.
  Próximo: B3 (painel unificado + menu Propostas + task 8 do B1 — botões/seletor
  de proposta no detalhe).
- **29/10/2026 (9)** — B3 (painel unificado) + task 8 do B1. Spec
  `.kiro/specs/comercial-pipeline-propostas/`. Backend: `jornada-lista.service.ts`
  (`listarPainelJornadas` — agrega pedidos comerciais + orçamentos + amostras +
  OPs sem N+1, reusa `montarEstagios`, empresaId explícito) + rota
  `GET /orcamento-grafico/pedidos/jornadas` (filtros status/busca). Front: tela
  `/orcamento-grafico/pipeline` (régua de estágios Orçamento→Amostra→Pedido→
  Produção→Faturamento com badges por estado + progresso de OPs + filtros) + item
  "Pipeline (Status)" no menu. **Task 8 do B1 FECHADA:** detalhe do orçamento
  ganhou Menu "Proposta" (Baixar PDF / Enviar por e-mail) com `Select` de template
  (default pré-selecionado) + modal de e-mail — usa `/:id/proposta-pdf?templateId`
  e `/:id/enviar-email`. Verificação: get_diagnostics limpo (back+front) + suíte.
  **B1, B2 e B3 COMPLETOS.** Próximo: B6 (envio/aceite/assinatura do setor) → B7
  (gate de margem) → B8 (elo PCP/faturamento) → B9 (Fechamento editável — P17).
- **29/10/2026 (10)** — B6 (assinatura do setor na liberação ao PCP). Spec
  `.kiro/specs/comercial-assinatura-liberacao/`. Decisão: senha do PRÓPRIO usuário
  + perfil permitido (ADMIN/SUPER_ADMIN/SUPERVISOR), auditável. Backend:
  `exigeAssinaturaLiberacao` (Parametro `comercial.exigir-assinatura-liberacao`,
  default true) + `validarAssinaturaSetor` (bcrypt; 401 senha/403 perfil/
  ASSINATURA_REQUERIDA) em `liberar-pedido-pcp.service.ts`; `liberarPedidoParaPcp`
  recebe `{ senha }`; rota `liberar-pcp` aceita senha + `GET/PUT
  /comercial/config-assinatura`. Front: `vendas/pedidos/[id]` abre modal de
  `PasswordInput` quando o backend pede assinatura; "Assinar e liberar" reenvia.
  Verificação: get_diagnostics limpo + suíte sem regressão. Envio de proposta
  (e-mail) já foi no B1; aceite do cliente via portal (`aprovadaClientePor/Em`)
  já existia. **B6 COMPLETO.** Próximo: B7 (gate de margem) → B8 → B9.
- **29/10/2026 (11)** — B7 (gate de margem). Backend JÁ ESTAVA pronto
  (`gate-margem.puro.ts` + `converter-orcamento.service` busca RegraAprovacao
  tipo DESCONTO, abre SolicitacaoAprovacao, retorna MARGEM_PENDENTE). Faltava só
  o front: tela `a-converter` — o botão "Converter" agora abre um modal com
  `NumberInput` de desconto (%); envia `descontoPercent`; `MARGEM_PENDENTE` vira
  aviso "aprovação aberta" (não converte); dentro da alçada converte normal.
  Spec `.kiro/specs/comercial-gate-margem/`. get_diagnostics limpo; backend
  intocado (não-regressão). **B7 COMPLETO.** Restam: B8 (elo PCP/faturamento) e
  B9 (Fechamento editável — P17, alto risco).
- **29/10/2026 (12)** — B8 (elo PCP + gatilho de faturamento). Descoberto que o
  gatilho JÁ ESTAVA no `concluirEtapa` (etapa-operacional.service.ts): OP de
  orçamento gráfico, ao concluir todas as etapas, marca o pedido EFETIVADO +
  cria NotificacaoComercial "pronto para faturar" (best-effort, empresaId da OP).
  O sino `NotificacoesComercialBell` já existia na tela a-converter. Fechamento:
  sino adicionado ao cabeçalho do Pipeline (onde o comercial acompanha). Spec
  `.kiro/specs/comercial-elo-pcp-faturamento/`. get_diagnostics limpo; backend
  intocado. **B8 COMPLETO.** Restam: **B9 (Fechamento editável — P17, alto
  risco)** e, por último, **B10 (permissões do Comercial)**.
- **29/10/2026 (13)** — B9 Fase 1 (Fechamento, 4 abas SÓ LEITURA). Descoberto que
  o `resultadoCalculo` do orçamento já expõe toda a decomposição (MD/CT/SE,
  custoProducao, cevPerc/cevValor, cev{icms/juros/pisCofins/comissoes},
  margem{...}, CM) — então a Fase 1 é 100% FRONTEND, risco zero, sem tocar motor
  nem schema. Componente `[id]/FechamentoOrcamento.tsx` (abas Preço de Venda /
  Taxas de Produção / Custos Diretos de Venda com CEV decomposto / Diversos) +
  botão "Fechamento" no detalhe do orçamento (modal). Spec
  `.kiro/specs/comercial-fechamento-editavel/`. get_diagnostics limpo.
  **FASE 2 (edição + recálculo por orçamento) PENDENTE** — alto risco (mexe no
  motor calibrado, golden 15.235). O usuário pediu para REVISAR o conjunto do
  Controle de Proposta ANTES de fazer a Fase 2. Pendências em aberto para a
  revisão: (a) quais campos editáveis na Fase 2; (b) B10 permissões do Comercial;
  (c) consulta de CNPJ/cadastro de cliente novo também no Novo Orçamento interno
  (hoje só no portal); (d) páginas órfãs de menu (dashboard/importar).

- **29/10/2026 (14)** — Leva de pendências: (3) consulta de CNPJ + cadastro de
  cliente novo também no Novo Orçamento interno (`GET /orcamento-grafico/
  consulta-cnpj/:cnpj` + bloco no StepCliente, reusa `POST /clientes`); (4)
  páginas órfãs no menu (Dashboard + Importar Preços CSV adicionados ao menu
  Comercial). Commits back `9d530b523`, front `66a7734`.
- **29/10/2026 (15)** — B10 (Permissões do Comercial) FEITO. Padrão do PCP:
  `permissoes-comercial.routes.ts` (Parametro `comercial.permissoes.<usuarioId>`,
  ADMIN bypass, default tudo liberado) + enforcement nas rotas sensíveis (criar/
  aprovar/converter/desconto/liberar-pcp/amostras) + tela
  `/orcamento-grafico/permissoes` (ADMIN) + item no menu. 9 flags conforme
  aprovado. Spec `.kiro/specs/comercial-permissoes/`. Follow-up cosmético:
  ocultar botões no front via `permissoes/minha` (o backend já bloqueia 403).

- **29/10/2026 (16)** — B9 Fase 2 (Fechamento EDITÁVEL). Abordagem de MENOR RISCO
  confirmada: editar margem/comissão/impostos/despAdm/desconto NÃO recalcula os
  CUSTOS (engenharia calibrada MD/CT/SE intacta) — só reaplica a FÓRMULA DE PREÇO
  (gross-up) sobre o custo já salvo. Backend: `OrcamentoGrafico.fechamentoOverride`
  (Json, migrate idempotente) + `ItemOrcamentoInput.margemOverride` (aplicado em
  `montarParamsDoItem`, ausente=idêntico) + service PURO
  `handoff-comercial/fechamento-preco.service.ts` (`mesclarMargem`/`reaplicarPreco`)
  + rota `GET/PUT /:id/fechamento` (persiste override + reaplica preço; bloqueia
  CONVERTIDO/RECUSADO; desconto exige permissão B10). Front: aba "Preço de Venda"
  do Fechamento com campos editáveis + "Salvar e recalcular". Testes:
  `fechamento-preco.service.test.ts` 7/7 (golden gross-up + desconto + erro ≥100%
  + 2 property) + suíte orcamento-grafico sem regressão (golden 15.235 intacto).
  **B9 COMPLETO. TODOS OS BLOCOS B0–B10 DO PROJETO COMERCIAL ENTREGUES.**

## ✅ STATUS FINAL (29/10/2026): B0..B10 todos ✅

Pendências MENORES para a revisão do usuário (relacionar divergências):
- Ocultar botões no front conforme `comercial/permissoes/minha` (cosmético — o
  backend já bloqueia com 403).
- Fase 2 do Fechamento: hoje edita margem/comissão/impostos/despAdm/desconto
  (reaplica preço). Se o usuário quiser editar CEV decomposto (ICMS/PIS/juros
  separados) ou prazos com recálculo, é um incremento.
- Passos operacionais de produção: deploy Render roda as migrações novas
  (`template_proposta` já estava; `solicitacao_orcamento_rep` campos da planilha;
  `orcamento_grafico.fechamento_override`). Seed do template Wega já rodado.