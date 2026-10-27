# Requirements Document

Correção de cores/tema do Gantt de Produção (PCP).

## Introduction

O cliente reclamou das cores do Gantt (`/pcp/gantt`): o quadro foi construído
assumindo TEMA ESCURO (fundos `dark-7`/`dark-6` e texto branco hardcoded),
mas o ERP roda majoritariamente em TEMA CLARO (sidebar/header brancos — ver
print do cliente). Resultado: "preto sobre preto", ilegível e destoante do
resto do sistema. O app tem `ThemeProvider` com `forceColorScheme` (claro OU
escuro, conforme preferência), então o Gantt deve seguir o tema ativo em vez
de cores fixas.

Pesquisa de mercado (DHTMLX "Terrace/Material" como skin padrão; Office
Timeline sobre esquema RAG — vermelho/âmbar/verde para status): Gantts
profissionais usam **fundo claro neutro**, **grade suave de baixo contraste**,
**texto escuro legível** e reservam cor saturada para os BLOCOS (identidade da
OP) e para os **indicadores de status (RAG)**. Dark theme é opção, não padrão.

Objetivo: tornar o Gantt **adaptativo ao tema do app** (usando tokens Mantine
em vez de cores fixas) e aplicar uma paleta didática/legível no padrão dos
melhores sistemas, sem alterar nenhum comportamento funcional.

## Glossary
- **Token adaptativo Mantine:** variável CSS que muda conforme claro/escuro
  (ex.: `--mantine-color-body`, `--mantine-color-default-border`,
  `--mantine-color-text`, `--mantine-color-dimmed`).
- **RAG:** Red-Amber-Green — esquema de status (crítico/atenção/ok).

## Requirements

### Requirement 1: Gantt adaptativo ao tema do app

**User Story:** Como usuário do ERP (em tema claro), quero que o Gantt use as
mesmas cores claras e legíveis do resto do sistema, para não ver "preto sobre
preto".

#### Acceptance Criteria
1. The system SHALL substituir TODAS as cores de superfície/texto hardcoded do
   Gantt (`var(--mantine-color-dark-7/6/5/4/3)`, `#fff`, `#555`,
   `rgba(255,...)` de texto) por tokens Mantine adaptativos equivalentes
   (`--mantine-color-body`, `--mantine-color-default`,
   `--mantine-color-default-border`, `--mantine-color-text`,
   `--mantine-color-dimmed`, etc.).
2. WHEN o app está em tema CLARO THEN o Gantt SHALL exibir fundo claro, grade
   suave e texto escuro legível (sem áreas pretas).
3. WHEN o app está em tema ESCURO THEN o Gantt SHALL continuar legível (fundos
   escuros adequados) — nenhuma regressão para quem usa dark.
4. The system SHALL NÃO alterar nenhum comportamento funcional (drag, zoom,
   filtros, foco/setas, empilhamento, cor/status por OP, conflitos, ocupação,
   virtualização) — mudança puramente visual.

### Requirement 2: Paleta didática e legível (padrão de mercado)

**User Story:** Como planejador, quero um quadro visualmente claro e com cores
que ajudem a ler a programação, no padrão dos melhores sistemas.

#### Acceptance Criteria
1. The header do eixo de tempo, a coluna de máquinas e os cabeçalhos de grupo
   (tipo de processo) SHALL usar fundos neutros claros/escuros do tema com bom
   contraste de texto (sem amarelo berrante sobre escuro — trocar o
   `c="yellow"` do cabeçalho de grupo por um tom legível nos dois temas).
2. As linhas de grade (horas/dias) SHALL ser suaves (baixo contraste), com a
   virada de dia levemente mais forte que a de hora, nos dois temas.
3. A linha "agora" SHALL permanecer vermelha (padrão universal), legível nos
   dois temas.
4. Os BLOCOS mantêm a cor da OP (`corGantt || COR_PADRAO`); a borda de status
   e a mini-faixa de ocupação SHALL seguir o esquema RAG já existente
   (vermelho/âmbar/verde) usando tokens Mantine para consistência.
5. O texto dentro dos blocos SHALL ter contraste garantido (texto claro sobre
   cor saturada do bloco — mantém legibilidade independente do tema do app).
6. A faixa de alerta de conflitos SHALL usar os tokens `red-light`/`red` que se
   adaptam ao tema (não fundo vermelho-escuro fixo).

### Requirement 3: Não-regressão funcional e de build

**User Story:** Como responsável técnico, quero que a mudança seja só de
estilo, para o Gantt continuar funcionando e compilando exatamente como antes.

#### Acceptance Criteria
1. The system SHALL manter `get_diagnostics` limpo em `pcp/gantt/page.tsx`.
2. The system SHALL compilar no `npm run build` (Next) sem erros.
3. Nenhuma lógica (handlers, memos, rotas chamadas) SHALL ser alterada — apenas
   valores de estilo (cores/bordas/fundos).
