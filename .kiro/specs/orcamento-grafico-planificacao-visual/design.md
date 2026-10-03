# Design — Planificação Visual (contorno real da caixa aberta)

## Overview

Desenhar o contorno **esquemático paramétrico** da caixa aberta (opção (a)) por
família de embalagem e repetí-lo no encaixe da folha, no lugar do retângulo.
Puramente VISUAL — não altera custo/rendimento (o motor segue usando o bounding
box / aproveitamento do Calcgraf). Função pura no front (gera `path` SVG a partir
de L×A×P + abas), sem dependência de backend além de um identificador de gabarito
no `TipoEmbalagem`.

## Architecture

- **Gerador de planificação (front, puro):** `planificacao-gabaritos.ts` — dado
  `{ gabarito, L, A, P, abaMm, sangriaMm }`, retorna `{ larguraMm, alturaMm,
  paths: PlanPath[] }`, onde cada `PlanPath` é um polígono/segmento (contorno de
  corte sólido + linhas de vinco tracejadas). As dimensões externas batem com o
  bounding box já calculado pelo motor (`planificacao.larguraMm/alturaMm`).
- **EncaixeVisual** passa a receber opcionalmente o `plan` (os paths do gabarito)
  e, quando presente, desenha o contorno repetido na grade (com rotação); senão,
  o retângulo atual.
- **TipoEmbalagem.gabaritoPlanificacao** (schema): string com o id do gabarito
  (CARTUCHO | CAIXA_FUNDO_AUTO | CARTELA | RETANGULO/null). Default null → retângulo.
- O `/calcular` passa a devolver, junto do `encaixe`, o `gabarito` do tipo (para
  o front saber qual desenhar). Alternativa: o front já tem o `tipoEmbalagem`
  selecionado no wizard e lê de lá — evita mudança no backend de cálculo.

Decisão: o front lê `gabaritoPlanificacao` do `TipoEmbalagem` já carregado no
wizard (StepTipo), e passa L/A/P/abas do form. Backend só precisa expor o campo
novo no CRUD/consulta de TipoEmbalagem (schema + rota). O motor de cálculo não muda.

## Components and Interfaces

### Frontend
- `novo/planificacao-gabaritos.ts` (novo, puro):
  ```ts
  type GabaritoId = 'CARTUCHO' | 'CAIXA_FUNDO_AUTO' | 'CARTELA' | 'RETANGULO'
  interface PlanParams { gabarito: GabaritoId; L: number; A: number; P: number; abaMm?: number; sangriaMm?: number }
  interface PlanPath { d: string; tipo: 'CORTE' | 'VINCO' }
  interface Planificacao { larguraMm: number; alturaMm: number; paths: PlanPath[] }
  function gerarPlanificacao(p: PlanParams): Planificacao
  ```
- `EncaixeVisual.tsx`: prop opcional `plan?: Planificacao`; quando presente,
  renderiza `plan.paths` escalados em cada célula da grade (corte sólido, vinco
  tracejado), respeitando a orientação.
- `StepRevisao.tsx` / `StepMedidas.tsx`: monta `PlanParams` do form + do
  `tipoEmbalagem.gabaritoPlanificacao` e passa ao `EncaixeVisual`. Opcional:
  um preview da peça única (sem a grade) no StepMedidas.
- Cadastro `tipos-embalagem`: campo Select "Gabarito de planificação".

### Backend
- `schema.prisma`: `TipoEmbalagem.gabaritoPlanificacao String?` + migrate-prod.
- `orcamento-grafico.routes.ts`: incluir `gabaritoPlanificacao` no select e nos
  schemas Zod de POST/PUT de `/tipos-embalagem`.

## Data Models

### TipoEmbalagem (campo novo, opcional)
```prisma
gabaritoPlanificacao String? @map("gabarito_planificacao") @db.VarChar(30)
```
Valores: CARTUCHO | CAIXA_FUNDO_AUTO | CARTELA | RETANGULO | null (→ retângulo).

## Correctness Properties

### Property 1: Bounding box consistente
O `larguraMm × alturaMm` da planificação gerada é igual ao bounding box usado no
cálculo (não cria divergência entre desenho e rendimento).
**Validates: Requirements 1.4**

### Property 2: Fallback sem gabarito
Tipo sem `gabaritoPlanificacao` desenha o retângulo atual, sem erro.
**Validates: Requirements 1.3, 2.4**

### Property 3: Feature é visual (não-regressão de custo)
O resultado de custo/rendimento do `/calcular` é idêntico com ou sem a feature.
**Validates: Requirements 3.1**

### Property 4: Rotação coerente
Quando o encaixe é rotacionado, o contorno gira junto (largura↔altura trocadas).
**Validates: Requirements 2.2**

## Error Handling

- Medidas inválidas (0/negativas) → `gerarPlanificacao` retorna o retângulo do
  bounding box (degrada graciosamente, sem quebrar o SVG).
- Gabarito desconhecido → trata como RETANGULO.
- Schema: campo opcional, migrate-prod idempotente (`ADD COLUMN IF NOT EXISTS`).

## Testing Strategy

- **Unit (Vitest) no gerador** (se extraído p/ módulo testável no front, ou um
  teste simples de proporção): bounding box == L/A/P esperado por gabarito;
  nº de paths > 0; fallback retângulo.
- **Visual manual:** cartucho (como o Cerumin), caixa fundo automático, cartela.
- **Não-regressão:** suíte backend `orcamento-grafico` continua 81/81 (nada no
  motor muda).
- Build/diagnostics por arquivo (build completo trava nesta máquina).

## Gabaritos (esquemáticos) — definição das famílias

- **CARTUCHO** (caixa reta tipo creme dental/medicamento, como o Cerumin):
  4 painéis em linha (frente, lateral, verso, lateral) = largura
  `2*(L+P)`; altura = `A` + abas de topo e fundo (línguas + abas de fecho);
  aba de colagem lateral extra à direita. Vincos verticais entre painéis e
  horizontais nas abas.
- **CAIXA_FUNDO_AUTO:** igual ao cartucho no corpo, com abas de fundo maiores
  (fundo automático) desenhadas como trapézios/línguas.
- **CARTELA:** plano simples (retângulo + eventual furo/alça) — próximo do
  retângulo, com cantos arredondados opcionais.
- **RETANGULO:** fallback atual (bounding box).

Observação de fidelidade: é esquemático (proporções a partir de L/A/P + aba
padrão), não a faca técnica real. Suficiente para proposta/visualização.
