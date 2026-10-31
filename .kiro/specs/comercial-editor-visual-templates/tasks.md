# Implementation Plan: Editor Visual de Documentos (Comercial)

## Overview

A implementação segue a ordem **backend primeiro, frontend depois**, respeitando
os repositórios SEPARADOS:

- **BACKEND** → `c:\Source\VisioFab.Wms.Back` (Fastify / Prisma 6 / Neon / pdfkit).
- **FRONTEND** → `c:\Source\VisioFab.Wms.Front` (Next.js 15 / Mantine 7 / axios).

Cada tarefa é incremental e test-driven: começa pelo schema + migração
idempotente (no MESMO item, conforme o steering `database-migrations.md`), passa
pelo núcleo PURO (binding/clamp/escala/despacho), pelo renderizador PDF, pelo
service de CRUD/default, seed da Wega e rotas; depois espelha binding/escala no
frontend e monta o editor (canvas react-moveable, paleta, painel, preview,
página e integração de geração/seleção de template).

As Correctness Properties (1–13) do design viram **sub-tarefas opcionais** de
property-based testing (`fast-check`, mínimo 100 iterações, tag
`// Feature: comercial-editor-visual-templates, Property N`). O núcleo funcional
permanece como tarefa obrigatória.

**Restrição crítica**: NENHUMA tarefa toca
`orcamento-grafico-calculo.service.ts` (motor de cálculo intocado — Req 10.3).

## Tasks

- [ ] 1. [BACKEND] Estender schema `TemplateProposta` + migração idempotente (mesmo item)
  - Em `prisma/schema.prisma`: adicionar ao model `TemplateProposta` os campos
    `tipo String @default("PROPOSTA") @db.VarChar(20)` e `layoutJson Json? @map("layout_json")`,
    e o índice `@@index([empresaId, tipo, isDefault])`.
  - No MESMO item, atualizar `prisma/migrate-prod.ts` (idempotente): `ADD COLUMN
    IF NOT EXISTS tipo`, `ADD COLUMN IF NOT EXISTS layout_json JSONB`,
    `CREATE INDEX IF NOT EXISTS template_proposta_empresa_id_tipo_is_default_idx`.
  - Rodar `npx prisma generate`.
  - _Requirements: 5.1, 10.4_

- [ ] 2. [BACKEND] Definir tipos e validação/normalização do Layout_JSON (núcleo puro)
  - [ ] 2.1 Criar tipos e schema Zod do Layout_JSON
    - Criar `src/modules/orcamento-grafico/template-visual/layout-json.types.ts`
      com `TipoTemplate`, `Pagina`, `TipoElemento`, `EstiloTexto`, `Elemento`,
      `LayoutDocumento` (coordenadas/dimensões em pt; A4 = 595 × 842).
    - Criar `layout-json.service.ts` com `validarLayoutJson(raw)` (Zod, erro
      legível "campo: motivo"), `normalizarLayout(raw)` (tolerante, nunca lança)
      e `clampElemento(el, pagina)` (restringe x/y/largura/altura à área útil).
    - _Requirements: 1.3, 7.1_

  - [ ]* 2.2 Escrever property test do clamp
    - **Property 1: Clamp mantém o elemento dentro da área útil**
    - **Validates: Requirements 1.3**
    - `layout-json.service.test.ts` com fast-check (mín. 100 iterações), tag
      `// Feature: comercial-editor-visual-templates, Property 1`.

- [ ] 3. [BACKEND] Implementar resolução de binding + formatação (núcleo puro)
  - [ ] 3.1 Criar `binding-resolver.service.ts`
    - Criar `src/modules/orcamento-grafico/template-visual/binding-resolver.service.ts`
      com `resolverBinding(caminho, ctx)` (valor presente → texto; ausente →
      `{ vazio: true, aviso }` sem lançar), `formatarMoeda` (R$ pt-BR),
      `formatarData` (dd/mm/aaaa) e `resolverTabela(fonteDados, ctx)`.
    - Definir o tipo `ContextoGeracao` (cliente/empresa/orcamento/itens/variacoes),
      reaproveitando conceitualmente os tipos já existentes em
      `orcamento-grafico-proposta-pdf.service.ts` (SEM alterar aquele arquivo).
    - _Requirements: 3.3, 3.4, 3.5_

  - [ ]* 3.2 Escrever property test de binding presente
    - **Property 4: Binding presente é substituído pelo valor do contexto**
    - **Validates: Requirements 3.3**
    - fast-check mín. 100 iterações, tag `Property 4`.

  - [ ]* 3.3 Escrever property test de binding ausente (nunca lança)
    - **Property 5: Binding ausente nunca lança e produz vazio + aviso**
    - **Validates: Requirements 3.4**
    - fast-check mín. 100 iterações, tag `Property 5`.

  - [ ]* 3.4 Escrever property test de formatação moeda/data idempotente
    - **Property 6: Formatação de moeda/data é idempotente e segue o padrão brasileiro**
    - **Validates: Requirements 3.5**
    - fast-check mín. 100 iterações, tag `Property 6`.

- [ ] 4. [BACKEND] Implementar o Renderizador_PDF (pdfkit, por coordenadas)
  - [ ] 4.1 Criar `renderizador-pdf.service.ts`
    - Criar `src/modules/orcamento-grafico/template-visual/renderizador-pdf.service.ts`
      com `renderizarLayout(layout, ctx): Promise<Buffer>`: itera `elementos` NA
      ORDEM do array e despacha por tipo — LOGO→`doc.image`; TEXTO/CAMPO_DINAMICO/
      BLOCO_CONDICOES→`doc.text(..., x, y, { width, align })`; TABELA→linha a linha
      via `resolverTabela`; LINHA/ASSINATURA→`doc.moveTo().lineTo().stroke()`
      (+ rótulo na assinatura). Usa `resolverBinding` para CAMPO_DINAMICO.
    - LOGO ausente/inválido = best-effort (omite o elemento, não quebra o PDF).
    - _Requirements: 1.6, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 2.9_

  - [ ]* 4.2 Escrever property test da ordem de desenho
    - **Property 2: Ordem de desenho preserva a ordem do Layout_JSON**
    - **Validates: Requirements 1.6**
    - pdfkit mockado (captura das chamadas), fast-check mín. 100 iterações, tag `Property 2`.

  - [ ]* 4.3 Escrever property test do despacho por tipo nas coordenadas
    - **Property 3: Despacho do renderizador por tipo nas coordenadas do elemento**
    - **Validates: Requirements 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 2.9**
    - pdfkit mockado, fast-check mín. 100 iterações, tag `Property 3`.

- [ ] 5. Checkpoint — garantir testes do núcleo verdes
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 6. [BACKEND] Implementar o Servico_Template (CRUD + default, isolamento empresaId)
  - [ ] 6.1 Criar `template-visual.service.ts`
    - Criar `src/modules/orcamento-grafico/template-visual/template-visual.service.ts`
      com `listarTemplatesVisuais(empresaId, tipo)`, `obterTemplateVisual`
      (404 cross-empresa), `criarTemplateVisual` (valida tipo + Layout_JSON),
      `atualizarTemplateVisual`, `excluirTemplateVisual` (bloqueia default) e
      `resolverTemplateVisual(empresaId, tipo, templateId?)`.
    - `empresaId` EXPLÍCITO em TODA query (não confiar só no `prismaScoped` —
      steering ATENCAO §2.1).
    - _Requirements: 5.2, 5.3, 5.4, 7.1, 7.4, 7.5, 7.6, 8.4, 9.1, 9.2, 9.3_

  - [ ] 6.2 Implementar duplicação e definição de default
    - Em `template-visual.service.ts`: `duplicarTemplateVisual` (mesmo tipo, cópia
      do Layout_JSON, `isDefault=false`, id novo) e `definirDefault` (transação:
      zera demais defaults do mesmo `empresaId`+`tipo` antes de marcar o alvo).
    - _Requirements: 7.2, 7.3_

  - [ ]* 6.3 Escrever property test do filtro por tipo
    - **Property 8: Listar por tipo retorna apenas templates daquele tipo e empresa**
    - **Validates: Requirements 5.2**
    - Prisma com banco local, fast-check mín. 100 iterações, tag `Property 8`.

  - [ ]* 6.4 Escrever property test de rejeição de tipo inválido
    - **Property 9: Tipo inválido é sempre rejeitado na criação**
    - **Validates: Requirements 5.4**
    - fast-check mín. 100 iterações, tag `Property 9`.

  - [ ]* 6.5 Escrever property test da duplicação
    - **Property 11: Duplicação copia layout e tipo sem marcar default**
    - **Validates: Requirements 7.2**
    - fast-check mín. 100 iterações, tag `Property 11`.

  - [ ]* 6.6 Escrever property test da unicidade de default por tipo
    - **Property 12: No máximo um default por empresa por tipo**
    - **Validates: Requirements 7.3**
    - fast-check mín. 100 iterações, tag `Property 12`.

  - [ ]* 6.7 Escrever property test do isolamento multi-tenant
    - **Property 13: Isolamento multi-tenant (acesso cross-empresa é inexistência)**
    - **Validates: Requirements 8.4, 9.2, 9.3**
    - fast-check mín. 100 iterações, tag `Property 13`.

- [ ] 7. [BACKEND] Implementar o Seed_Default_Wega (idempotente)
  - [ ] 7.1 Criar `seed-default-wega.service.ts`
    - Criar `src/modules/orcamento-grafico/template-visual/seed-default-wega.service.ts`
      com `seedTemplatesVisuaisWega(empresaId)`: cria 1 template `PROPOSTA`
      (Layout_JSON que reproduz o estilo WEGA do renderizador atual) + 1
      `ORCAMENTO`, marca default quando não houver default do tipo, grava
      `empresaId` explícito, e é idempotente (não duplica em reexecução).
    - _Requirements: 6.1, 6.2, 6.3, 6.5_

  - [ ]* 7.2 Escrever property test da idempotência do seed
    - **Property 10: Seed é idempotente**
    - **Validates: Requirements 6.4**
    - Prisma com banco local, fast-check mín. 100 iterações, tag `Property 10`.

- [ ] 8. [BACKEND] Criar as rotas do template visual e fiação no servidor
  - [ ] 8.1 Criar `template-visual.routes.ts`
    - Criar `src/modules/orcamento-grafico/template-visual/template-visual.routes.ts`
      (prefixo `/api/orcamento-grafico/templates-visuais`, autenticado): GET `/?tipo`,
      GET `/:id`, POST `/`, PUT `/:id`, POST `/:id/duplicar`, PATCH `/:id/default`,
      DELETE `/:id`, POST `/:id/preview-pdf`, POST `/gerar-pdf`.
    - `/gerar-pdf` resolve template visual via `resolverTemplateVisual`; com
      Layout_JSON monta o `ContextoGeracao` e chama `renderizarLayout`; SEM
      template visual aplicável cai no Fluxo_Legado (`gerarPropostaPdf` atual,
      SEM alterá-lo). Erros Zod → 400 "campo: motivo"; cross-empresa → 404.
    - Registrar as rotas em `src/server.ts`.
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 10.2_

  - [ ]* 8.2 Escrever testes de exemplo das rotas/serviço
    - Criar com tipo válido (5.3); excluir não-default (7.4) e excluir default
      rejeita (7.5); resolver sem id retorna default (8.2); resolver sem default
      retorna null→Fluxo_Legado (8.3); update com layout válido persiste (7.6);
      gerar com templateId produz Buffer PDF não vazio (8.1).
    - _Requirements: 5.3, 7.4, 7.5, 7.6, 8.1, 8.2, 8.3_

- [ ] 9. Checkpoint — backend completo
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 10. [FRONTEND] Espelhar binding e escala (libs puras TS)
  - [ ] 10.1 Criar `lib/binding-resolver.ts` (porta TS do binding)
    - Criar `src/lib/comercial/template-visual/binding-resolver.ts` com a MESMA
      especificação do backend: `resolverBinding`, `formatarMoeda` (R$ pt-BR),
      `formatarData` (dd/mm/aaaa), `resolverTabela` + o tipo `ContextoGeracao`.
    - _Requirements: 3.3, 3.4, 3.5_

  - [ ] 10.2 Criar `lib/layout-escala.ts` (escala pt→px + clamp)
    - Criar `src/lib/comercial/template-visual/layout-escala.ts` com
      `ptParaPx(valorPt, escala)` (escala = larguraCanvasPx / 595) e helpers de clamp.
    - _Requirements: 4.2, 4.3_

  - [ ]* 10.3 Escrever property test da escala pt→px (fidelidade)
    - **Property 7: Escala pt→px preserva a posição relativa (fidelidade preview↔PDF)**
    - **Validates: Requirements 4.3**
    - fast-check mín. 100 iterações (`vitest`, `--pool=threads` se der timeout),
      tag `// Feature: comercial-editor-visual-templates, Property 7`.

- [ ] 11. [FRONTEND] Implementar o Canvas A4 com react-moveable
  - Criar `src/components/comercial/template-visual/CanvasA4.tsx`: container A4
    escalado (pt→px) exibindo margens A4; cada elemento vira div absoluto
    manipulável por react-moveable (arrastar atualiza x/y — Req 1.1; redimensionar
    atualiza largura/altura — Req 1.2; snapping às margens/guias respeitando a
    área útil — Req 1.3). Preserva a ordem dos elementos no Layout_JSON (Req 1.6).
  - Instalar `react-moveable` como dependência do frontend.
  - _Requirements: 1.1, 1.2, 1.3, 1.6, 4.4_

- [ ] 12. [FRONTEND] Implementar a Paleta de Elementos
  - Criar `src/components/comercial/template-visual/PaletaElementos.tsx` com os 7
    tipos (LOGO, TEXTO, CAMPO_DINAMICO, TABELA, LINHA, BLOCO_CONDICOES, ASSINATURA);
    adicionar um elemento insere no Layout_JSON com valores iniciais de posição/
    dimensão/estilo.
  - _Requirements: 2.1, 2.2_

- [ ] 13. [FRONTEND] Implementar o Painel de Propriedades
  - Criar `src/components/comercial/template-visual/PainelPropriedades.tsx`:
    selecionar elemento exibe x/y/largura/altura/fonte/tamanho/alinhamento (Req 1.4);
    editar valor numérico aplica ao Layout_JSON com clamp (Req 1.5); catálogo de
    bindings suportados listado (Req 3.1) e associar binding registra no elemento
    CAMPO_DINAMICO/TABELA (Req 3.2).
  - _Requirements: 1.4, 1.5, 3.1, 3.2_

- [ ] 14. [FRONTEND] Implementar o Renderizador_Preview (DOM, espelho do PDF)
  - Criar `src/components/comercial/template-visual/RenderizadorPreview.tsx`:
    interpreta o Layout_JSON em DOM absoluto usando `binding-resolver.ts` +
    `layout-escala.ts`, mesma Pagina/margens A4 do PDF; atualiza ao finalizar
    alteração de posição/dimensão/estilo/binding (Req 4.1).
  - _Requirements: 4.1, 4.2, 4.3, 4.4_

  - [ ]* 14.1 Escrever testes de componente/interação do editor
    - Paleta expõe 7 tipos (2.1); adicionar insere com valores iniciais (2.2);
      selecionar exibe painel (1.4); editar valor aplica + clamp (1.5); arrastar
      atualiza x/y (1.1); redimensionar atualiza largura/altura (1.2); alteração
      atualiza preview (4.1); canvas usa margens A4 (4.4); catálogo de bindings
      listado (3.1); associar binding registra (3.2).
    - _Requirements: 1.1, 1.2, 1.4, 1.5, 2.1, 2.2, 3.1, 3.2, 4.1, 4.4_

- [ ] 15. [FRONTEND] Montar a página do editor + integração de template
  - [ ] 15.1 Criar a página `editor-visual/page.tsx`
    - Criar `src/app/(interna)/comercial/editor-visual/page.tsx` compondo
      Paleta + CanvasA4 + PainelPropriedades + RenderizadorPreview e o cliente
      axios para o CRUD (`/api/orcamento-grafico/templates-visuais`): listar por
      tipo, criar, atualizar, duplicar, definir default, excluir, preview-pdf.
    - _Requirements: 5.2, 7.1, 7.2, 7.3, 7.4, 7.6_

  - [ ] 15.2 Integrar geração/seleção de template na emissão do PDF
    - Permitir escolher o template (por tipo) ao gerar o documento, chamando
      `POST /api/orcamento-grafico/templates-visuais/gerar-pdf` com
      `{ orcamentoId, templateId?, tipo }`; sem seleção usa o default; sem template
      visual cai no fluxo atual (não-regressão). NÃO alterar as rotas legadas
      `proposta-pdf`/`enviar-email`.
    - _Requirements: 8.1, 8.2, 8.3, 10.1_

- [ ] 16. [BACKEND+FRONTEND] Verificação final (sem regressão, motor intocado)
  - `get_diagnostics` limpo nos arquivos tocados (back e front).
  - BACKEND: rodar `npx tsx prisma/migrate-prod.ts` 2× local (idempotência das
    colunas `tipo`/`layout_json` e do índice — Req 10.4).
  - BACKEND: confirmar não-regressão das rotas legadas `proposta-pdf` e
    `enviar-email` (suíte existente verde — Req 10.1).
  - Confirmar que `orcamento-grafico-calculo.service.ts` permanece INTOCADO
    (Req 10.3) e que nenhuma tarefa alterou esse arquivo.
  - FRONTEND: `npm run build` (Next) OK; testes com execução única (`vitest run`).

- [ ] 17. Checkpoint final — garantir tudo verde
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tarefas marcadas com `*` são opcionais (property-based tests e testes de
  exemplo/componente) e podem ser puladas para um MVP mais rápido; o núcleo
  funcional está nas tarefas obrigatórias.
- Property tests usam **fast-check** com **mínimo de 100 iterações** e a tag
  `// Feature: comercial-editor-visual-templates, Property N`.
- Cada property (1–13) é coberta por um único teste de propriedade, posicionado
  perto da implementação que valida.
- Properties 1–7 são puras (sem banco); Properties 8–13 usam Prisma com banco
  local; o Renderizador_PDF (Properties 2, 3) usa pdfkit mockado.
- Repositórios SEPARADOS: cada tarefa indica BACKEND (`VisioFab.Wms.Back`) ou
  FRONTEND (`VisioFab.Wms.Front`); commits são responsabilidade do usuário
  (no backend, `schema.prisma` + `migrate-prod.ts` sempre no mesmo commit).
- Esta feature é aditiva e NÃO toca o motor de cálculo
  (`orcamento-grafico-calculo.service.ts`) nem o contrato das rotas legadas.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1"] },
    { "id": 1, "tasks": ["2.1", "3.1", "10.1", "10.2"] },
    { "id": 2, "tasks": ["2.2", "3.2", "3.3", "3.4", "4.1", "6.1", "10.3"] },
    { "id": 3, "tasks": ["4.2", "4.3", "6.2", "7.1", "11", "12"] },
    { "id": 4, "tasks": ["6.3", "6.4", "6.5", "6.6", "6.7", "7.2", "8.1", "13", "14"] },
    { "id": 5, "tasks": ["8.2", "14.1", "15.1"] },
    { "id": 6, "tasks": ["15.2", "16"] }
  ]
}
```
