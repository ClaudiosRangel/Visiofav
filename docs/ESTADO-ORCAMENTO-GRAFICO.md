# ESTADO CONSOLIDADO — Orçamento Gráfico (Carton Wega)

> Documento-mestre de continuidade. Atualizar ao fim de cada rodada. Serve para
> QUALQUER sessão retomar sem perder contexto. Última atualização: 03/10/2026
> (módulo de ACABAMENTOS — motor + golden 15.235 batendo, em andamento).

## 0. EM ANDAMENTO — Módulo de Acabamentos (spec orcamento-grafico-acabamentos)

Objetivo: Vizor emitir relatório IGUAL ao Calcgraf e bater valores. Golden alvo:
`docs/calcgraf-golden-15235-acabamentos.md` (pré-cálculo 15.235).

FEITO (NÃO commitado ainda — tudo local):
- **Motor** (`orcamento-grafico-calculo.service.ts`): tipos ricos de acabamento
  (`ItemAcabamentoRico`: HORA_MAQUINA | MATERIAL_KG | MATERIAL_UN | CUSTO_FIXO),
  bloco MAT.ACABAMENTO somado ao MD, cadeia de centros no CT. Estendido com
  `tempoFixoHoras`/`tempoVarHoras` DIRETOS no HORA_MAQUINA (paridade hh:mm do
  pré-cálculo — modo direto; sem eles, modo derivado via calcularCustoTransformacao).
  Aditivo: sem itens ricos, resultado idêntico ao congelado (testado).
- **Golden 15.235** passa ≤0,5%: `calibracao/golden-acabamentos-15235.{fixture,test}.ts`.
  MD 6598,79 / CT 3813,40 / CProd 10412,19 / Total 10425,73; margens 14.440/16.760/
  19.957; cada centro e material exatos. TINTA do caso modelada como itens diretos
  (itensDiversos) — consumo fino de tinta já calibrado no 15185. Suíte 108/108.
- **Schema**: model `AcabamentoGrafico` (VARCHAR p/ enums) + migrate-prod idempotente
  + relation em CentroProducao + `prisma generate` OK.
- **Rotas**: CRUD `GET/POST/PUT/DELETE /orcamento-grafico/acabamentos` (multi-tenant).

FEITO TAMBÉM (backend completo — rodada 2):
- **4.2** `/calcular` e `/simular-tiragens` aceitam `acabamentosRicos[]` e resolvem o
  cadastro por `acabamentoId` (`montarAcabamentosRicos` em orcamento-grafico.routes.ts;
  overrides do orçamento têm precedência sobre o cadastro).
- **4.3** `GET /:id/relatorio` → `orcamento-grafico-relatorio.service.ts`
  (`montarRelatorio`: seções cabeçalho/suporte/matriz/tinta/matAcabamento/impressão/
  acabamento/custoProducao/cev/margens).
- **5.1** `GET /:id/relatorio.pdf` → `orcamento-grafico-relatorio-pdf.service.ts`
  (pdfkit, layout do pré-cálculo).
- **6.1** fase `acabamentos` em `importar-calcgraf.ts` (lê Atividades.json ATIVO/FIXO,
  de-para CG-ACAB-<Codigo>, idempotente, --dry-run; guarda no main() p/ import seguro).
- **6.2** `scripts/calcgraf-acabamentos.test.ts` (naturezaDefaultAcabamento +
  de-para determinístico). Função pura em `calcgraf-dedup.ts`. Suíte 122 verde
  (corrigido: "coladeira" não vira MATERIAL_KG).

FALTA (próxima sessão — ver tasks.md da spec):
- **7.1** tela `cadastros/acabamentos/page.tsx` (CRUD) + item no ModuleSidebar.
- **7.2** `novo/StepAcabamentos.tsx` lê do cadastro `/acabamentos` (remover lista fixa de 5).
- **7.3** botão "Relatório / PDF" no StepRevisao + detalhe + visualização das seções.
- **2.4** PBT opcional. **8.x** validação final (front), docs, COMMIT (back:
  schema+migrate+motor+rotas+PDF+importador+testes juntos; front separado),
  deploy, importar acabamentos em produção + validar relatório do 15.235.

### Extensão do motor nesta rodada (importante)
`ItemAcabamentoRico` HORA_MAQUINA ganhou `tempoFixoHoras`/`tempoVarHoras`
DIRETOS (opcionais) — reproduzem os hh:mm do pré-cálculo exatamente; sem eles,
cálculo derivado (producaoHora/acertos) continua. `producaoHora`/`unidadeBase`
viraram opcionais. Aditivo, não-regressão mantida.

---


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

1. **PBT opcionais** — 2.5 e 5.3 da finalizacao FEITAS (ver abaixo). Restam só
   2.2 e 3.3 da planificacao-visual (testes de UI puramente visuais).
2. **Refino tinta/CT** — densidade/constante da tinta e CT dos acabamentos (hoje
   só impressão calibrada no CT; acabamentos seguem legado) — exige +pré-cálculos.
3. **Validar orçamento em produção** — próximo passo combinado com o usuário:
   pegar um orçamento real do Calcgraf como base e gerar idêntico no Vizor em
   produção (empresa Wega `75848e24-...`), comparando componente a componente.

### ✅ Vendedores importados em PRODUÇÃO (02/10/2026)
`scripts/importar-calcgraf.ts --fase vendedores --empresa 75848e24-...`:
39 vendedores + 11 RepresentanteCredencial criados; 2ª execução idempotente
(0 criados, 39 intactos). Estado: 40 vendedores (39 import + 1 pré-existente),
32 placeholder `SEM-DOC`, 12 credenciais. Bug corrigido: enriquecimento tentava
gravar `telefone` (campo que o model Vendedor não tem) — removido (vendedor
existente agora só conta como `intacto`).

### PBTs adicionadas (02/10/2026)
- `src/modules/orcamento-grafico/calibracao/pbt-equivalencia-legado.test.ts`
  (Property 1): sem campos calibrados → sempre LEGADO; campos neutros (0) ≡
  ausentes (mesmo resultado). 600 runs.
- `scripts/calcgraf-dedup.ts` (funções puras extraídas do importador) +
  `scripts/calcgraf-dedup.test.ts` (Properties 4 e 5): de-para determinístico,
  normalização idempotente, não-sobrescrita de endereço. 8 propriedades.
- Suíte orcamento-grafico + PBTs: **91/91 verde** (eram 81 + 10 novas).

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
