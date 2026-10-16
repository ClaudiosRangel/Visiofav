# Design — Paridade do Importador Calcgraf com o Importador de PDF

## 1. Visão geral e motivação

Hoje existem **dois caminhos** que criam/atualizam uma `OrdemProducao` a partir
do mesmo sistema de origem (Calcgraf/GPrint):

1. **Importação de PDF** (`importacao-op.routes.ts`) — maduro, com muitas regras
   de negócio: de-para de centro, planos multi-componente, frente/costa
   (retiração), programação de entrega, tags estruturadas, vínculo manual de
   cliente/produto, proteções de reimportação.
2. **Agente Calcgraf** (`ingestao-op-calcgraf.service.ts` + reader do agente) —
   fluxo paralelo e **mais pobre**: traz cabeçalho + etapas + variações +
   materiais + tintas, mas **não aplica** a maioria das regras acima.

Como o PDF é **gerado a partir do Calcgraf**, os dois têm a MESMA informação de
origem. Ter dois fluxos divergentes causou os problemas reais já observados:
centros de produção criados errados (não batem com a operação), cliente "ACTUAL"
/ ausente, data de entrega em branco, sem planos/frente-verso.

**Objetivo:** fazer o agente Calcgraf produzir OPs **com a mesma qualidade** do
importador de PDF, unificando as regras de negócio numa **fonte única**.

### Princípio arquitetural central (decisão do usuário)

> **Regra de negócio mora na API. O agente é "burro": só lê dados crus do
> Calcgraf e envia.**

Isso minimiza reinstalações do agente no servidor da PHTech (processo caro via
RDP) e elimina a divergência de regras. O agente muda **uma vez** (para trazer
os dados crus que faltam); todo o resto é deploy de backend no Render.

### Nomenclatura: "Costa" → "Verso"

Decisão do usuário: na interface/labels, "frente/costa" passa a ser
**"frente/verso"**. O valor técnico do modelo (`PlanoOrdemProducao.tipo = 'FACE'`
e o par `faceDeId`) **NÃO muda** — só os textos exibidos. Isso evita migração de
dados e mantém compatibilidade.

---

## 2. Lição do incidente (requisito transversal de segurança)

Já ocorreu um incidente grave: a sync do agente antigo **zerou o roteiro de 61
OPs** e bagunçou a programação (perda de ordem de fila). Este design trata isso
como **requisito de primeira classe**, não como detalhe:

- **S1 — Nunca destruir o que não veio completo.** Se o payload não traz um
  bloco (etapas, planos, entregas), o bloco existente é **preservado**, não
  apagado. (O "cinto de segurança" já implementado em `atualizarOp` para etapas
  é estendido a planos/entregas.)
- **S2 — Nunca tocar OP com produção.** OP com apontamento/etapa em andamento →
  vira `AlteracaoOpPendente` (comportamento atual mantido e reforçado).
- **S3 — Preservar ordem de fila manual.** `posicaoFila`/`ordemManual = true`
  NUNCA são sobrescritos pela sincronização. Etapas novas entram no fim da fila.
- **S4 — Idempotência real.** Reenvio idêntico = `ignorada` (hash cobre os
  campos novos). Sem efeito colateral.
- **S5 — Rollout gradual + validação.** Toda regra nova é validada contra o
  backup local (golden cases) ANTES de ir a produção; a 1ª sync pós-deploy é
  monitorada.
- **S6 — Auditoria.** Toda ação de sincronização gera `LogOrdemProducao` claro
  (o que mudou, o que foi preservado e por quê).

---

## 3. Arquitetura de alto nível

```
┌───────────── Servidor PHTech ─────────────┐
│  SQL Calcgraf (CartonWega)                 │
│         │ (SOMENTE SELECT)                 │
│  Agente (reader) — "BURRO"                 │
│   lê e envia dados CRUS, sem regra:        │
│   • cabeçalho + etapas + variações         │
│   • NOVO: programação de entrega (todas)   │
│   • NOVO: planos + retiração (frente/verso)│
│   • NOVO: código do centro (p/ de-para)    │
│   • NOVO: cliente (código + CNPJ)          │
│   • NOVO: matriz/formato/bobina            │
└───────────────┬────────────────────────────┘
                │ HTTPS POST /api/pcp/ingest-op-calcgraf
                ▼
┌───────────── Vizor backend (Render) ───────────────────────────┐
│  ingestao-op-calcgraf.service.ts                                │
│    → chama o MOTOR UNIFICADO de regras de negócio:              │
│  ┌─────────────────────────────────────────────────────────┐  │
│  │  op-montagem.service.ts (NOVO — fonte única de regra)     │  │
│  │   • resolverCentro (de-para → reuso → criar) ...............│  ← mesma regra do PDF
│  │   • resolverCliente (código→CNPJ→cadastro) ................│  ← novo (determinístico)
│  │   • resolverProduto (best-effort/de-para) .................│  │
│  │   • montarPlanos + frente/verso (retiração) ...............│  ← mesma regra do PDF
│  │   • montarProgramacaoEntrega (todas as datas) .............│  ← mesma regra do PDF
│  │   • montarTags [Matriz][Formato][Cores][Bobina]... ........│  │
│  │   • aplicar cinto de segurança S1..S4 .....................│  │
│  └─────────────────────────────────────────────────────────┘  │
│  importacao-op.routes.ts (PDF) → passa a chamar o MESMO motor    │
└──────────────────────────────────────────────────────────────────┘
```

### Decisão: refatorar sem reescrever o PDF do zero

O importador de PDF **funciona e está estável**. Para não introduzir regressão
num fluxo crítico, a estratégia é **extração incremental**, não reescrita:

1. Extrair as funções de regra do PDF para `op-montagem.service.ts` como
   **funções puras/isoladas** (sem mudar o comportamento).
2. O PDF passa a chamar essas funções (refactor comportamentalmente neutro,
   coberto por testes de não-regressão).
3. O agente passa a chamar as MESMAS funções.

> Alternativa descartada: reescrever a ingestão do agente copiando a lógica do
> PDF. Rejeitada porque recria a divergência (dois lugares com a mesma regra).

---

## 4. Contrato de dados (o que o agente passa a enviar)

O DTO `OpOrigemDTO` (espelhado agente↔backend) ganha campos **aditivos e
opcionais** (compatível com agente antigo durante a transição):

```ts
interface OpOrigemDTO {
  // ... campos atuais (numero, descricao, etapas, variacoes, itens, tintasTexto) ...

  // ── NOVOS (paridade PDF) ──
  /** Cliente: código no Calcgraf + CNPJ (para de-para determinístico). */
  clienteCodigo?: string
  clienteDoc?: string            // CNPJ/CPF só dígitos
  // clienteNome já existe

  /** Produto: código no Calcgraf (para de-para). */
  produtoCodigo?: string         // já existe; passa a ser populado

  /** Programação de entrega: TODAS as datas parciais (não só a 1ª). */
  programacaoEntrega?: Array<{ data: string; quantidade: number }>

  /** Planos/componentes + retiração (frente/verso). */
  planos?: Array<{
    nome: string
    tipo?: 'COMPONENTE' | 'FACE'
    formato?: string
    cores?: string
    tiragem?: number
    montagem?: string
    material?: string
    gramatura?: number
    aproveitamento?: number
    matriz?: string
    /** retiração: true gera FRENTE/VERSO (2 FACES). */
    retiracao?: boolean
    coresFrente?: string
    coresVerso?: string
  }>

  /** Centro de cada etapa: código no Calcgraf (para de-para de centro). */
  // EtapaOpOrigemDTO ganha: centroCodigo?: string

  /** Tags de cabeçalho extras. */
  matriz?: string
  formato?: string
  bobinasTexto?: string[]
}
```

**Regra de ouro do contrato:** campos ausentes = "não informado" ⇒ o backend
**preserva** o que já existe (S1). Nunca interpretamos ausência como "apagar".

---

## 5. Design de baixo nível — o motor unificado

Arquivo novo: `src/modules/pcp/importador-calcgraf/op-montagem.service.ts`
(regras compartilhadas entre PDF e agente). As funções abaixo são extraídas do
PDF e tornadas reutilizáveis.

### 5.1 Resolução de CENTRO (de-para → reuso → criar) — igual ao PDF

```ts
/**
 * Resolve o centro de uma etapa na ORDEM do importador de PDF (evita criar
 * máquina errada):
 *   1) DeParaImportacao (CENTRO_PRODUCAO, codigoExterno = centroCodigo) → centro vinculado;
 *   2) reuso por `descricao` case-insensitive (menor codigo = determinístico);
 *   3) criar com tipoProcessoId inferido (I→IMPRESSAO; senão ACABAMENTO; fallback).
 * Só cria em último caso. Toda etapa fica com centro (nunca invisível).
 */
async function resolverCentro(tx, empresaId, {
  centroCodigo, nomeCentro, tipoEtapa,
}): Promise<string>
```

> Diferença-chave vs. hoje no agente: hoje o agente **pula direto para o passo
> 2/3** (reuso/criar por nome), ignorando o de-para. Isso cria "Heidelberg" em
> vez de reusar "CD - 5 cores + Verniz". O motor unificado consulta o de-para
> primeiro — é a correção central para "não criar centro irreal".

### 5.2 Resolução de CLIENTE (determinística) — novo, sem adivinhar

```ts
/**
 * Resolve clienteId: por CNPJ (dígitos) no cadastro → senão por DeParaImportacao
 * (CLIENTE, codigoExterno = clienteCodigo) → senão NULL + tag [Cliente] texto.
 * NUNCA cria cliente, NUNCA usa placeholder "ACTUAL". Nome com várias filiais
 * → desempata pelo CNPJ (filial exata).
 */
async function resolverCliente(tx, empresaId, { clienteDoc, clienteCodigo, clienteNome }):
  Promise<{ clienteId: string | null; tagCliente: string }>
```

### 5.3 Planos + Frente/Verso — igual ao PDF

```ts
/**
 * Cria PlanoOrdemProducao a partir de `planos[]` (mesma regra do PDF):
 *  - 2+ planos OU 1 plano com retiracao → cria planos;
 *  - retiracao → 2 FACES (FRENTE/VERSO), VERSO.faceDeId → FRENTE;
 *  - retorna mapa nome→planoId para vincular etapas (etapa.planoNome/centroCodigo).
 * Nomenclatura exibida: "VERSO" (não "COSTA"); valor técnico tipo='FACE'.
 */
async function criarPlanos(tx, opId, empresaId, planos): Promise<Map<string, string>>
```

### 5.4 Programação de entrega — igual ao PDF

```ts
/**
 * Cria ProgramacaoEntrega para CADA data de `programacaoEntrega[]` e retorna a
 * 1ª data (menor) como dataEntregaPrevista. Sem programação → dataEntrega do
 * lote principal (fallback atual). Resolve o "entrega em branco".
 */
function montarEntregas(programacaoEntrega): { entregas: {...}[]; dataPrevista: Date | null }
```

### 5.5 Integração na ingestão do agente (com os cintos S1–S4)

```ts
// criarOp / atualizarOp do agente passam a:
//  1. resolverCliente → clienteId (ou tag)
//  2. montarTags (inclui [Matriz],[Formato],[Cores],[Bobina])
//  3. criarPlanos (se planos.length>=2 ou retiracao) + vincular etapas
//  4. criarEtapas usando resolverCentro (de-para primeiro!)
//  5. criarProgramacaoEntrega + setar dataEntregaPrevista
//  6. CINTO: só substitui o bloco X se o payload TROUXE o bloco X;
//     preserva posicaoFila/ordemManual=true (S3).
```

---

## 6. Pontos de atenção (análise cautelosa — anti-regressão)

| Risco | Mitigação |
|---|---|
| Refatorar o PDF introduzir regressão num fluxo crítico | Extração comportamentalmente neutra + testes de não-regressão do PDF ANTES de plugar o agente. Rodar `scripts/testar-todos-pdfs-op.ts`. |
| Agente novo zerar programação de novo | Cintos S1–S4 reforçados; a sync nunca apaga bloco ausente nem reordena fila manual. |
| De-para de centro ainda não existir p/ Calcgraf | Fallback: reuso por nome → criar (comportamento atual), mas registrando aviso. O de-para vai se populando (o agente manda `centroCodigo`; admin vincula). |
| Mudança de hash reclassificar muitas OPs | Esperado e controlado; OP sem produção = atualizada (preserva fila), com produção = pendente. Monitorar 1ª sync. |
| Reinstalação do agente | UMA só, trazendo TODOS os campos crus novos de uma vez. Versão nova com selo (v0.3.0). |
| Dados de cliente/filial errados | Match por CNPJ (determinístico), nunca por nome aproximado; sem match → tag texto, nunca placeholder. |

### Sem mudança de schema?
A maior parte reusa modelos existentes (`PlanoOrdemProducao`, `ProgramacaoEntrega`,
`DeParaImportacao`, `OrdemProducao.clienteId`). **Se nenhum campo novo de coluna
for necessário, não há migração.** Se surgir necessidade (ex.: guardar
`centroCodigo` de origem numa etapa para auditoria), seguir o steering
`database-migrations` (schema + migrate-prod no mesmo commit). O design evita
mudança de schema por padrão.

---

## 7. Estratégia de implantação (ordem segura)

1. **Backend primeiro, retrocompatível**: o motor unificado + ingestão lendo os
   campos novos. Enquanto o agente antigo não manda os campos, o comportamento
   é o atual (campos ausentes = preserva). Deploy no Render sem risco.
2. **Validar contra o backup** (golden cases: OP 3000, 3154 multi-plano, uma com
   retiração, uma com programação de entrega múltipla).
3. **Agente novo (v0.3.0)** trazendo os campos crus. Reinstalar no servidor
   (uma vez). Monitorar a 1ª sync (quantas criadas/atualizadas/pendentes).
4. **Reparo retroativo** opcional das OPs do agente já pobres (reprocessar com o
   motor novo) — com os mesmos cintos, uma a uma / lote monitorado.

---

## 8. Estratégia de teste

- **Não-regressão do PDF**: testes do fluxo de PDF antes/depois da extração do
  motor (mesma saída). `scripts/testar-todos-pdfs-op.ts` com os PDFs versionados.
- **Motor unificado (puro)**: vitest + fast-check para `resolverCliente`
  (CNPJ/filial/sem match), `montarEntregas`, inferência de tipo de processo.
- **Ingestão do agente**: estender `ingestao-op-calcgraf.service.test.ts` com os
  cintos S1–S4 (payload sem bloco → preserva; com produção → pendente; fila
  manual preservada).
- **Golden Calcgraf**: validar contra o backup local (centro resolvido por
  de-para, cliente por CNPJ, planos/retiração, entregas múltiplas).

---

## 9. Fora de escopo (não fazer agora)
- Reescrever o parser de PDF.
- Vínculo de produto 100% automático (fica best-effort; de-para quando houver).
- Mudar o modelo de planos (`VariacaoOrdemProducao` do agente é descontinuado em
  favor de `PlanoOrdemProducao`, unificando com o PDF — tratado como migração de
  comportamento, não de schema).
