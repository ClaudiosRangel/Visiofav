# Implementation Plan: Orçamento Gráfico — Suporte e Fechamento (paridade Calcgraf)

## Overview

Trabalho inteiramente **aditivo** e **sem alteração de schema** (os 4 models —
`SuporteGrafico`, `PrecoMateriaPrima`, `ParametroPerda`, `TabelaMargem` — já
existem com todos os campos). Repositórios **separados**: backend em
`c:\Source\VisioFab.Wms.Back`, frontend em `c:\Source\VisioFab.Wms.Front`.
Tenant alvo: Carton Wega (`75848e24-742e-461d-b913-1642c5b83ae9`).

A ordem segue a dependência: primeiro as fases do importador (suportes + seed de
margem), depois os ajustes aditivos de backend (filtro + bloqueios), depois o
frontend (StepPapel em 2 níveis), em seguida os testes (property-based + golden
15.235) e, por último, a execução/validação em produção (manual, exige
confirmação do usuário).

**Validação (ambiente desta máquina):** usar `get_diagnostics` nos arquivos
tocados e `npx vitest run src/modules/orcamento-grafico --reporter=dot` para os
testes. **Não** depender de `tsc`/`build` completos (travam nesta máquina).
**Não commitar automaticamente** — commit só quando o usuário pedir (política do
steering).

## Tasks

- [x] 1. BACKEND — Fase `suportes` no importador (`scripts/importar-calcgraf.ts`)
  - [x] 1.1 Implementar função pura de mapeamento linha-origem → `SuporteGrafico`
    - Criar função pura `mapearSuporte(linhaOrigem)` que converte uma linha da
      tabela `Suportes` do Calcgraf em um objeto `SuporteGrafico`: `codigo` =
      `CG-SUP-<Codigo>`, `descricao`, `coefTinta` (de `CoefTinta`), `gramaturas`
      (lista livre, ex.: "191,230,280") e `tipoSuporte` derivado da descrição
      (CARTAO/KRAFT/OFFSET/COUCHE…, com default inferido)
    - Função deve ser isolada (sem I/O) para permitir teste de propriedade sem banco
    - Ignorar/sinalizar registros sem código ou sem descrição (retornar motivo)
    - _Requirements: 1.2, 1.6_

  - [x] 1.2 Implementar a fase `suportes` com de-para, idempotência e `--dry-run`
    - Rotear `--fase suportes` em `main()`, seguindo o padrão existente
      (`garantirEmpresa()`, `temDryRun()`, `comRetry()`)
    - Ler `cartoon/export/SuportesFull.json` (fallback `Suportes.json`)
    - De-para por `codigo` (`@@unique([empresaId, codigo])`): existente → atualiza;
      inexistente → cria (idempotente)
    - Contar e registrar criados / atualizados / ignorados ao final
    - `--dry-run` apenas relata as alterações previstas, sem gravar
    - Gravar sempre com `empresaId` da Carton Wega resolvido por `garantirEmpresa()`
    - _Requirements: 1.1, 1.3, 1.4, 1.5, 1.6, 1.7_

  - [ ]* 1.3 Property test — mapeamento de campos do importador de suportes
    - **Property 1: Mapeamento de campos do importador de suportes**
    - Para qualquer linha de origem válida, a conversão preserva código
      (`CG-SUP-<Codigo>`), descrição, `coefTinta` e gramaturas sem perda/alteração
    - fast-check, ≥ 100 iterações, tag "Feature: orcamento-grafico-suporte-fechamento, Property 1"
    - **Validates: Requirements 1.2**

  - [ ]* 1.4 Property test — invalidação de suportes sem código/descrição
    - **Property 3: Suportes inválidos são ignorados sem interromper**
    - Para qualquer mistura de linhas válidas e inválidas, ignora exatamente as
      inválidas (com motivo) e importa todas as válidas
    - fast-check, ≥ 100 iterações, tag "Feature: orcamento-grafico-suporte-fechamento, Property 3"
    - **Validates: Requirements 1.6**

  - [ ]* 1.5 Property test — idempotência e de-para do importador de suportes
    - **Property 2: Idempotência e de-para do importador de suportes**
    - Simular um "store" de códigos em memória (sem banco real); aplicar 1x e 2x
      produz o mesmo estado final; nº de `SuporteGrafico` = nº de códigos distintos
    - fast-check, ≥ 100 iterações, tag "Feature: orcamento-grafico-suporte-fechamento, Property 2"
    - **Validates: Requirements 1.3, 1.4**

- [x] 2. BACKEND — Seed da Tabela de Margem da Wega (`semearTabelaMargem`)
  - [x] 2.1 Implementar a sub-rotina de seed da `TabelaMargem`
    - Criar `semearTabelaMargem(empresaId)` roteada por `--fase suportes` |
      `--fase seed-margem` | `--fase tudo`
    - Composição CEV do caso 15.235: ICMS 3,00 + juros 2,50 + PIS/COFINS 9,25 +
      comissão 3,00 = 17,75%, mapeada para os campos de `TabelaMargem`
      (`impostos`/`comissao`/`despAdm`) de forma que a soma reproduza 17,75% no
      gross-up; `markup` default coerente com a margem de 30,01% do golden
    - Preservação (Req 4.5): se já existe `TabelaMargem` para o tenant, NÃO semear
      (no-op) — preserva ajuste manual
    - Idempotente por `@@unique([empresaId, nome])`; respeitar `--dry-run`;
      usar `comRetry()`
    - _Requirements: 4.2, 4.4, 4.5_

  - [ ]* 2.2 Property test — idempotência e preservação do seed da Tabela de Margem
    - **Property 8: Idempotência e preservação do seed da Tabela de Margem**
    - Se já existe ≥1 tabela → no-op; se não existe → cria exatamente uma; reexecutar
      não duplica (mesmo estado final independente do nº de execuções)
    - fast-check, ≥ 100 iterações, tag "Feature: orcamento-grafico-suporte-fechamento, Property 8"
    - **Validates: Requirements 4.4, 4.5**

  - [ ]* 2.3 Teste de exemplo — composição do CEV 17,75% no seed
    - Verificar que a `TabelaMargem` semeada reproduz CEV 17,75% (ICMS 3 + juros 2,5
      + PIS/COFINS 9,25 + comissão 3) no gross-up
    - _Requirements: 4.2_

- [x] 3. BACKEND — `GET /precos-mp` aceitar filtro `suporteId` (`orcamento-grafico.routes.ts`)
  - [x] 3.1 Adicionar `suporteId` ao schema Zod de query e à cláusula `where`
    - Adicionar `suporteId: z.string().uuid().optional()` ao schema de query
    - Quando presente, incluir `where.suporteId = query.suporteId`
    - Mudança isolada: não quebra chamadas atuais (StepPapel atual não envia o param);
      manter filtro por `empresaId` (isolamento multi-tenant)
    - _Requirements: 2.3_

  - [ ]* 3.2 Property test — filtro de preços por suporte
    - **Property 5: Filtro de preços por suporte**
    - Para qualquer conjunto de `PrecoMateriaPrima` e qualquer `suporteId`, a consulta
      filtrada retorna só registros com aquele `suporteId` (e, com `tipo=PAPEL`, só
      papéis) — testar sobre a função de montagem da cláusula `where`, sem rede
    - fast-check, ≥ 100 iterações, tag "Feature: orcamento-grafico-suporte-fechamento, Property 5"
    - **Validates: Requirements 2.3**

- [x] 4. BACKEND — Bloqueios de pré-condição em `/calcular` e `POST /` (defesa em profundidade)
  - [x] 4.1 Bloquear cálculo quando o Suporte não tem preço PAPEL vinculado (Req 2.4)
    - Em `/calcular` e `POST /`, antes de calcular: quando o `papelId` do request
      aponta para um `PrecoMateriaPrima.suporteId`, verificar que o Suporte possui
      ao menos um `PrecoMateriaPrima` de tipo `PAPEL` vinculado
    - Se não houver, retornar HTTP 400 com mensagem acionável: "Suporte sem preço de
      material vinculado — vincule um preço ao suporte antes de calcular"
    - _Requirements: 2.4_

  - [x] 4.2 Bloquear cálculo quando não há `ParametroPerda` aplicável (Req 5.4)
    - Em `/calcular` e `POST /`, antes de calcular: se não existe NENHUM
      `ParametroPerda` aplicável ao processo/empresa, retornar HTTP 400:
      "Nenhum Parâmetro de Perda cadastrado — cadastre a perda do processo antes de
      calcular"
    - Manter o fallback de perdas no motor puro (para testes que injetam perdas
      direto): o bloqueio vive na rota/borda, não no núcleo de cálculo
    - _Requirements: 5.4_

  - [ ]* 4.3 Property test — bloqueio por pré-condição ausente
    - **Property 6: Bloqueio por pré-condição ausente**
    - (a) suporte sem preço PAPEL → rejeita; (b) sem `ParametroPerda` aplicável →
      rejeita; ambas satisfeitas → prossegue — testar sobre as funções de validação,
      sem rede
    - fast-check, ≥ 100 iterações, tag "Feature: orcamento-grafico-suporte-fechamento, Property 6"
    - **Validates: Requirements 2.4, 5.4**

- [x] 5. FRONTEND — StepPapel em dois níveis (`VisioFab.Wms.Front`)
  - [x] 5.1 Adicionar `suporteId`/`suporteNome` ao `WizardFormData`
    - Estender a interface `WizardFormData` com `suporteId: string | null` e
      `suporteNome?: string`
    - _Requirements: 2.6_

  - [x] 5.2 Implementar o nível 1 (Suporte) do StepPapel
    - `GET /orcamento-grafico/suportes?busca=<termo>` → Select de Suportes da empresa
    - Ao escolher: `updateForm({ suporteId, suporteNome })`
    - Exibir o nome do Suporte idêntico ao cadastrado a partir do Calcgraf
    - _Requirements: 2.1, 2.5_

  - [x] 5.3 Implementar o nível 2 (preço do papel vinculado) do StepPapel
    - `GET /orcamento-grafico/precos-mp?tipo=PAPEL&suporteId=<id>&busca=<termo>`
    - Nível 2 desabilitado enquanto nenhum Suporte estiver selecionado
    - Ao escolher: `updateForm({ papelId, papelDescricao, precoKg, gramatura })`
    - _Requirements: 2.3_

  - [x] 5.4 Bloquear avanço quando o Suporte não tem preço vinculado
    - Se o Suporte escolhido não retornar nenhum preço vinculado, exibir alerta e
      desabilitar o botão "Próximo"
    - "Próximo" só habilita com `suporteId` + `papelId` + `precoKg > 0`
    - _Requirements: 2.4_

  - [x] 5.5 Enviar `suporteId` ao backend em `/calcular` e `POST /`
    - Incluir `suporteId` no payload de `/calcular` e `POST /` (persistir a escolha
      do suporte; `papelId` já é enviado e é o que o backend usa para resolver o
      CoefTinta)
    - _Requirements: 2.5, 2.6_

- [ ] 6. BACKEND — Testes de propriedade do núcleo (seleção de tinta, perdas, isolamento)
  - [ ]* 6.1 Property test — seleção do modelo de tinta (SPANKS vs legado)
    - **Property 4: Seleção do modelo de tinta (SPANKS vs legado)**
    - `coefTintaSuporte > 0` → modelo SPANKS (`modeloCalculo.tinta === 'CALIBRADO'`);
      ausente/≤0 → modelo legado `rendimentoM2Kg` com resultado idêntico ao
      `calcularTinta` legado (`modeloCalculo.tinta === 'LEGADO'`) — testar sobre o
      motor puro
    - fast-check, ≥ 100 iterações, tag "Feature: orcamento-grafico-suporte-fechamento, Property 4"
    - **Validates: Requirements 2.2, 3.1, 3.2**

  - [ ]* 6.2 Property test — aplicação monotônica das perdas
    - **Property 7: Aplicação monotônica das perdas**
    - Aumentar perda fixa (folhas) ou variável (%) nunca diminui as folhas brutas;
      folhas brutas = `ceil((folhasNecessárias + perdaFixa) × (1 + perdaVariável/100))`
      — testar sobre `calcularPapel` (motor puro)
    - fast-check, ≥ 100 iterações, tag "Feature: orcamento-grafico-suporte-fechamento, Property 7"
    - **Validates: Requirements 5.3**

  - [ ]* 6.3 Property test — isolamento multi-tenant dos cadastros
    - **Property 9: Isolamento multi-tenant dos cadastros**
    - Para empresas A e B com `SuporteGrafico`/`TabelaMargem`/`ParametroPerda`,
      consultas/gravações filtradas por `empresaId` de A só retornam/afetam A —
      testar sobre as funções de validação / cláusula `where`, sem rede
    - fast-check, ≥ 100 iterações, tag "Feature: orcamento-grafico-suporte-fechamento, Property 9"
    - **Validates: Requirements 7.2**

- [ ] 7. Checkpoint — garantir que todos os testes passam
  - Rodar `npx vitest run src/modules/orcamento-grafico --reporter=dot` e
    `get_diagnostics` nos arquivos tocados. Ensure all tests pass, ask the user if
    questions arise.

- [ ] 8. BACKEND — Golden 15.235 (estender `calibracao/`)
  - [ ] 8.1 Estender os testes golden com o caso Suporte "Duplex 280"
    - Em `src/modules/orcamento-grafico/calibracao/`, reusar/estender os golden
      existentes para o caso 15.235 com Suporte "Duplex 280" a R$ 8,30/kg:
      Material Direto 6.598,70; Custo de Produção 10.413,50; preço à margem de
      30,01% = 19.960,00 para 20.000 un — todos com desvio ≤ 0,5%
    - _Requirements: 3.3, 3.4, 4.3_

  - [ ]* 8.2 Garantir não-regressão da suíte `orcamento-grafico`
    - Rodar a suíte completa `orcamento-grafico` e confirmar que permanece verde
      após as mudanças desta spec
    - _Requirements: 7.1_

- [ ] 9. Checkpoint final — garantir que todos os testes passam
  - Rodar `npx vitest run src/modules/orcamento-grafico --reporter=dot` (incluindo
    golden 15.235 e não-regressão) e `get_diagnostics`. Ensure all tests pass, ask
    the user if questions arise.

- [ ]* 10. EXECUÇÃO/VALIDAÇÃO EM PRODUÇÃO (manual — exige confirmação do usuário)
  - [ ]* 10.1 Rodar a fase `suportes` + seed de margem na Wega e validar
    - **Tarefa MANUAL de alto risco — requer confirmação explícita do usuário e a
      `DATABASE_URL` de produção (Neon), guardada FORA do git (via env, nunca
      hardcode/commit).**
    - Rodar `--dry-run` ANTES do `--apply`
    - Validar os 78 suportes importados + Suporte "Duplex" com `CoefTinta` correto
    - Validar a `TabelaMargem` semeada (CEV 17,75%)
    - Conferir na tela do Orçamento Gráfico (StepPapel exibindo os suportes)
    - _Requirements: 1.1, 1.5, 4.2_

## Notes

- Tarefas marcadas com `*` são opcionais (testes e a validação em produção) e podem
  ser puladas para um MVP mais rápido; as de implementação (sem `*`) são obrigatórias.
- Cada tarefa referencia os requisitos específicos para rastreabilidade.
- Os testes de propriedade (fast-check, ≥ 100 iterações) referenciam diretamente as
  Properties 1–9 do design e são testados sobre LÓGICA PURA (mapeamento, cláusula
  `where`, motor puro, funções de validação), sem rede/banco real.
- Validação do ambiente: `get_diagnostics` + `npx vitest run
  src/modules/orcamento-grafico --reporter=dot`. **Não** usar `tsc`/`build` completos
  (travam nesta máquina). O reporter `basic` foi removido — usar `--reporter=dot`.
- **Sem alteração de schema** nesta spec (os 4 models já existem); portanto não há
  mudança em `schema.prisma`/`migrate-prod.ts`.
- **Não commitar automaticamente** — commit só quando o usuário pedir (back e front
  são repos separados).
- Req 6 (comissões por agente/juros) está FORA do MVP (fase futura) e não vira tarefa.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "3.1"] },
    { "id": 1, "tasks": ["1.2", "2.1", "3.2", "5.1"] },
    { "id": 2, "tasks": ["1.3", "1.4", "1.5", "2.2", "2.3", "4.1", "4.2", "5.2"] },
    { "id": 3, "tasks": ["4.3", "5.3", "5.4", "6.1", "6.2", "6.3"] },
    { "id": 4, "tasks": ["5.5", "8.1"] },
    { "id": 5, "tasks": ["8.2", "10.1"] }
  ]
}
```
