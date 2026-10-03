# ESTADO CONSOLIDADO — Orçamento Gráfico (Carton Wega)

> Documento-mestre de continuidade. Atualizar ao fim de cada rodada. Serve para
> QUALQUER sessão retomar sem perder contexto. Última atualização: 02/10/2026
> (planificação visual concluída).

## 1. Visão geral do que foi construído (em ordem)

1. **Calibração Calcgraf (módulos puros + testes)** — CONGELADO
   - Custo de Transformação: `src/modules/orcamento-grafico/custo-transformacao.ts`
     (acerto-por-cor + produção × custo-hora). Doc: `docs/calcgraf-custo-transformacao.md`.
     Validado 52/53 cálculos ≤1% no CustoFixo.
   - Consumo de Tinta: `src/modules/orcamento-grafico/consumo-tinta.ts` (SPANKS +
     partida). Doc: `docs/calcgraf-consumo-tinta.md`. 15185: custo 1,3%.
   - Testes: `calibracao/golden-custo-transformacao.*`, `golden-consumo-tinta.*`,
     `golden-componentes.*` (papel), `golden-precos.*` (preço/decomposição).
   - COMMITADO (back `70d330ca1`).

2. **Finalização — integração ao motor + cadastros + vendedores** — CONCLUÍDA e COMMITADA
   - Spec: `.kiro/specs/orcamento-grafico-finalizacao/` (requirements+design+tasks,
     todas as tasks marcadas; 2.5 e 5.3 opcionais PBT ficaram pendentes).
   - Motor `orcamento-grafico-calculo.service.ts`: tinta→SPANKS e máquina→acerto-
     por-cor quando parâmetros presentes; fallback legado; flag `modeloCalculo`.
   - Schema: `CentroProducao` (acertoPorCorMin, tempoSetupMin), model
     `SuporteGrafico` (coefTinta), `PrecoMateriaPrima` (suporteId, gramatura,
     densidadeTinta). `migrate-prod.ts` idempotente (roda no deploy).
   - Rotas: CRUD `/orcamento-grafico/suportes`; `/calcular` e `/simular-tiragens`
     unificados lendo os campos novos; `/precos-mp` estendido; `/centros-producao`
     aceita acerto/setup.
   - Frontend: tela `cadastros/suportes/`, item no `ModuleSidebar`, campos de
     acerto/setup em `pcp/cadastros/centros/`, vínculo papel→suporte + densidade
     em `cadastros/precos-materiais/`.
   - Importador: fase `vendedores` em `scripts/importar-calcgraf.ts`.
   - Commits back `d29082891`, `6b6c18bdb` (fix revisão); front `3f650ea`.

3. **Encaixe gráfico (SVG, retângulo em grade)** — CONCLUÍDO e COMMITADO
   - Backend expõe `encaixe.layout` (colunas/linhas/dimensões/pinça).
   - Front: `src/app/(interna)/orcamento-grafico/novo/EncaixeVisual.tsx` desenha
     a folha + peças em tempo real no `StepRevisao`.
   - Commits back `5502a0ed6`, front `73bb815`; docs/steering `7a926781b`.

4. **Planificação visual (contorno da caixa aberta)** — CONCLUÍDA
   - Spec: `.kiro/specs/orcamento-grafico-planificacao-visual/` (requirements+design+tasks, tasks marcadas; 2.2 e 3.3 opcionais ficaram pendentes).
   - DECISÃO DO USUÁRIO: alvo **(a)** — desenho ESQUEMÁTICO paramétrico por
     família (cartucho, caixa, cartela) a partir de L×A×P + abas. NÃO é faca
     técnica real (b). É só visual (não muda custo/rendimento).
   - Backend: `TipoEmbalagem.gabaritoPlanificacao String?` (schema +
     migrate-prod `ADD COLUMN IF NOT EXISTS`); select + Zod POST/PUT de
     `/tipos-embalagem` estendidos.
   - Frontend: gerador puro `novo/planificacao-gabaritos.ts` (CARTUCHO/
     CAIXA_FUNDO_AUTO/CARTELA/RETANGULO); `EncaixeVisual.tsx` desenha o contorno
     (corte sólido + vinco tracejado) repetido na grade, respeitando orientação;
     `StepRevisao.tsx` monta a planificação por `useMemo` (leitura robusta das
     medidas por aliases L/largura/altura/profundidade); Select "Gabarito de
     planificação" no cadastro `cadastros/tipos-embalagem`.
   - Validação: suíte `orcamento-grafico` 81/81; diagnostics limpos.

## 2. Estado de commits

Etapas 1–3 commitadas e pushed. Etapa 4 (planificação visual) é o commit
corrente desta rodada — back `main` (schema+migrate+rotas+spec+docs) e front
`main` (gerador+EncaixeVisual+StepRevisao+cadastro).

## 3. PENDÊNCIAS conhecidas (ordem de prioridade)

1. **Importar vendedores** — fase pronta, NÃO executada (precisa ambiente).
   Rodar `npx tsx scripts/importar-calcgraf.ts --fase vendedores --dry-run`,
   conferir contadores, depois sem `--dry-run`. 39 registros; muitos sem CPF
   (placeholder `SEM-DOC-<Codigo>`); e-mail válido → RepresentanteCredencial.
2. **PBT opcionais** (tasks 2.5 e 5.3 da spec finalizacao + 2.2 e 3.3 da
   planificacao-visual) — fast-check/testes de UI opcionais.
3. **Refino tinta/CT** — densidade/constante da tinta e CT dos acabamentos (hoje
   só impressão calibrada no CT; acabamentos seguem legado) — exige +pré-cálculos.

## 4. Armadilhas/decisões a lembrar

- Densidade de tinta default = **1,0** (NÃO 1,3) — foi o que calibrou no 15185.
- Custo-hora do Calcgraf = **Tabela de Custos 2** (vigente), não a 1 (antiga).
- Produtos/SKUs do Calcgraf: **fora de escopo** (decisão do usuário; `Produto` é
  compartilhado com PCP/produção).
- Build/tsc completos TRAVAM nesta máquina — validar por `get_diagnostics` + a
  suíte vitest (`npx vitest run src/modules/orcamento-grafico --reporter=dot`).
- Postgres local parado (precisa admin); migração roda em produção no deploy.
- git push no PowerShell: stderr + exit 1 mesmo com sucesso — confirmar pela
  linha `xxx..yyy main -> main`. DNS falha às vezes; retentar.
- Suíte orcamento-grafico: **81/81** (último estado verde).
