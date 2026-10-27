# Design — Correção de cores/tema do Gantt de Produção

## Overview

O Gantt (`/pcp/gantt/page.tsx`) foi construído com cores de tema ESCURO
hardcoded; o ERP deste cliente roda em tema CLARO → "preto sobre preto". A
correção troca as cores fixas por TOKENS ADAPTATIVOS do Mantine (que respeitam
`forceColorScheme` do `ThemeProvider`), alinhando o Gantt ao visual claro de
produção dos melhores sistemas (DHTMLX Material; RAG do Office Timeline).
Mudança puramente visual — nenhuma lógica alterada.

## Architecture

Camada única: `VisioFab.Wms.Front/src/app/(interna)/pcp/gantt/page.tsx`.
Substituição de valores de estilo (cores/fundos/bordas). Sem backend, sem
schema, sem novas dependências.

## Components and Interfaces

### Mapa de tokens (de → para)
- Fundo de chrome (`dark-7`) → `--mantine-color-body`.
- Faixa destacada / cabeçalho de grupo (`dark-6`) → `--mantine-color-default`.
- Bordas/divisórias (`gray-5`, `dark-4/5`) → `--mantine-color-default-border`.
- Grade: virada de dia → `gray-4` (solid); hora → `gray-3` (dashed).
- Cabeçalho de grupo: `c="yellow"` → `c="var(--mantine-color-text)"` fw700.
- Linha "agora" e triângulo de entrega → `--mantine-color-red-6` (prazo/agora).
- Pastilhas sobre a barra (passada/cadeado): fundo `#fff` →
  `--mantine-color-body` (acompanha o tema; borda colorida RAG preservada).
- Scrollbar: `#555` → `--mantine-color-gray-5`.
- Faixa de conflitos: fundo `red-9`/borda `red-7` (escuro fixo) →
  `--mantine-color-red-light` + `red-light-color`; textos `red.3` → `red.7`.
- `STATUS_BORDER` (RAG) → tons Mantine nível 6 (red/orange/blue/green/teal/gray).
- Texto DENTRO dos blocos: permanece BRANCO (contraste sobre a cor saturada da
  OP — não segue o tema).

## Data Models
Nenhum.

## Correctness Properties

### Property 1: Adaptação ao tema
Todas as superfícies/bordas/grade usam tokens que mudam com claro/escuro; no
tema claro não há áreas pretas.
**Validates: Requirements 1.1, 1.2, 1.3**

### Property 2: Não-regressão funcional
Nenhum handler/memo/cálculo de posição é alterado; só valores de cor.
**Validates: Requirements 1.4, 3.3**

## Error Handling
N/A (sem I/O; mudança de estilo).

## Testing Strategy
`get_diagnostics` limpo + `npm run build` (Next) OK. Validação visual (claro e
escuro) com o usuário ao subir em produção.
