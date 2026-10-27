# Implementation Plan — Correção de cores/tema do Gantt

## Overview

Mudança visual num único arquivo (`pcp/gantt/page.tsx`): trocar cores de tema
escuro hardcoded por tokens adaptativos do Mantine. Sem backend/schema.

## Tasks

- [x] 1. Adaptar superfícies, grade e texto ao tema (`VisioFab.Wms.Front`)
  - [x] 1.1 Fundos `dark-7`→`body`, `dark-6`→`default`; bordas/divisórias
    (`gray-5`/`dark-4/5`)→`default-border`; grade dia=`gray-4`/hora=`gray-3`;
    cabeçalho de grupo `c="yellow"`→texto padrão fw700.
  - [x] 1.2 Linha "agora" + triângulo de entrega → `red-6`; pastilhas
    (passada/cadeado) fundo `#fff`→`body`; scrollbar `#555`→`gray-5`.
  - [x] 1.3 Faixa de conflitos `red-9`/`red-7`→`red-light`/`red-light-color`,
    textos `red.3`→`red.7`. `STATUS_BORDER` (RAG) → tons Mantine nível 6.
  - _Requisitos: 1.1, 1.2, 1.3, 2.1, 2.2, 2.3, 2.4, 2.5, 2.6_

- [x] 2. Verificação
  - [x] 2.1 `get_diagnostics` limpo em `pcp/gantt/page.tsx`.
  - [x] 2.2 `npm run build` (Next) compila sem erros.
  - _Requisitos: 3.1, 3.2, 3.3_

## Task Dependency Graph

```json
{
  "waves": [
    { "wave": 1, "tasks": ["1"] },
    { "wave": 2, "tasks": ["2"] }
  ]
}
```

## Notes

- Texto dentro dos blocos permanece branco (contraste sobre cor da OP).
- Validação visual (claro/escuro) com o usuário na subida em produção.
