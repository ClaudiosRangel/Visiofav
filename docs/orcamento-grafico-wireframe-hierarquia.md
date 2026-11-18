# Orçamento Gráfico — desenho das 3 telas (Orçamento → Item → Plano)

Status: PROPOSTA para aprovação do usuário (17/11/2026). Nada implementado.
Base: `.kiro/steering/orcamento-grafico-visao-front-calcgraf.md` (prints de Cartucho Composto, Cartucho e Lâmina Simples).

## Regra de ouro
Quem decide o que aparece é o CADASTRO do Produto Gráfico (`ProdutoGrafico`), nunca o nome do produto no código:
- `tipoPlanoFixo` (via `DefaultProdutoPlano` → `TipoPlanoGrafico.fixo`) → plano único (campos do plano na tela do item) ou multi-plano (grid).
- `modoFormato` → quais campos de formato aparecem (3 dim: Comp x Larg x Alt; 2 dim; ABERTO_FECHADO: Formato Fechado + Aberto; Formato Final; sanfona/abas; página).
- `formatoPadraoLargura/Altura` → pré-preenche o formato (ex.: Venda de Cartão 660 x 960).
- `exibeRestricoes` → mostra a lista de Restrições das atividades marcadas.
- `exibeInformacoesComplementares` → campo "Informações Complementares".
- `semImpressao` → esconde Cores/Processo/Cobertura.
- `DefaultProdutoPlano` → cores, processo, cobertura e atividades iniciais.

## Tela 1 — ORÇAMENTO (`/orcamento-grafico/[id]`)
```
Série [__]  Nº [____]  Data [__/__/__]  Cliente principal [cód][nome............][🔍]   [ ] Reforma Tributária 2027
┌ Itens do Orçamento ──────────────────────────────────────────────────────────────┐
│ item │ Cálculo │ Linha de Produto │ Tipo de Produto │ Tiragens │ Descrição │ Status│
│  1   │ 15652   │ CARTUCHO COMPOSTO│ Cartucho Comp.  │ 6.000    │ CX. CART… │ Lib.  │
└──────────────────────────────────────────────────────────────────────────────────┘
[Incluir item] [Abrir item] [Copiar] [Excluir]            (duplo clique abre a Tela 2)
┌ Dados do Item (resumo só leitura do item selecionado) ┐   ┌ Fechamento │ Comissões ┐
│ multi-plano: Especificações Gerais · Tipos de Plano   │   │ Tiragem│Margem│C.Marg.│V.Unit│V.Total │
│   (suporte, cores, formato, acabamentos) ·            │   │ uma linha por tiragem, SOMA de TODOS  │
│   Acabamentos de produto · Itens Diversos             │   │ os itens do orçamento                 │
│ plano único: Formato · Suporte · Cores · Acabamento · │   └───────────────────────────────────────┘
│   Itens Diversos                                      │
└───────────────────────────────────────────────────────┘
```
Fechamento e Comissões ficam AQUI (nível orçamento), não dentro do editor do item.

## Tela 2 — ITEM (dados do produto; título = nome do produto)
Bloco A — comum a TODO item (nível produto):
```
Produto [combo]  Tipo de Produto [..]  Descrição [............]  Sigla Acabado [__][🔍]  Tributação [combo]
Tiragens [........]  Modelos ×[1]
Formato (conforme modoFormato):  3 dim: Comp[ ] Larg[ ] Alt[ ] · Aba Cola[ ] Aba Fec[ ] Alt Tampa[ ]
                                 ABERTO_FECHADO: Formato Fechado [0x0]  Formato Aberto [0x0]
                                 2 dim / Formato Final: [660 x 960]
Acabamentos de Produto (atividades do PRODUTO marcáveis; ex.: Colagem Manual, Colocação de Alça, Envase)
Acondicionamento [lista 1: Caixa Padrão/Embalar] [lista 2: escolhida]   Conteúdo por volume [__]
[Itens Diversos] [Itens Fornecidos] [Campos Livres] [Observação] [Obs. Áreas de Op]
```
Bloco B — depende do tipo de produto:
- **Plano único (Cartucho, Lâmina Simples)**: abaixo do Bloco A aparecem, na MESMA tela, os campos do plano implícito:
  `Cores` · `Processo de Impressão` (+Pré, cadeado) · `Cobertura de Tinta` · `Fabricante` · `Suporte` (+NC) · `Fornecido` · `Microondulado` ·
  `Fibra` · `Mont.` · `Formato de Corte` · `Ajuste Corte Micro` · bloco **Acabamento** (Atividades + Restrições se `exibeRestricoes`)
  · `Informações Complementares` se `exibeInformacoesComplementares`.
- **Multi-plano (Cartucho Composto, Caixa…)**: NÃO mostra campos de plano. Mostra o grid:
```
Tipos de Plano   Nome │ Suporte │ Cores │ Formato │ Acabamento     [Incluir][Copiar][Excluir][Trocar/Reordenar][Desfazer]
clique na linha → Tela 3
```

## Tela 3 — PLANO ("Inclusão/Alteração de Tipo de Plano"; só multi-plano)
```
Tipo de Plano [combo]  Nome [__]  Ocor. [_]  Tiragem [(padrão)=do item]
Mont. [__]  Corte [__]  Formato Aberto [__]  Form.Final [Comp x Larg x Alt x AltTampa]
Cores [0x0]  Processo de Impressão [combo][Pré][🔒]  Cobertura de Tinta [combo]
Capa externa: Fabricante · Suporte (+NC, Fornecido) · Fibra
Microondulado: Fabricante · Suporte (+NC, Fornecido) · Sentido onda · Ajuste Corte Micro (mm)
Capa interna: Fabricante · Suporte (+NC, Fornecido) · Cores · Processo · Cobertura
Acabamento → Atividades (lista marcável do PLANO) [+ Restrições]
[OK] [Cancelar]
```
Quais blocos aparecem depende do `TipoPlanoGrafico` (Cartão: sem micro; Microondulado: capa externa + micro + interna).

## Mapa campo → dado (hoje no back)
| Campo | Nível | Onde está hoje |
|---|---|---|
| Produto / Tipo / Descrição / Sigla / Tributação / Modelos / Tiragem | Item | `ItemOrcamentoGrafico` (produtoGraficoId, tipoEmbalagemId, descricao, siglaAcabado, tributacao, qtdModelos, quantidade) |
| Comp/Larg/Alt, Abas | Item | `comprimentoMm`, `larguraMm`, `alturaMm`, `abaColaMm`, `abaFechamentoMm` (AltTampa: **não existe**) |
| Formato Fechado/Aberto/Final | Item | **não existe** campo próprio (hoje só `medidas` Json) |
| Acabamentos de Produto | Item | `acabamentosRicos` (do item) |
| Acondicionamento / Conteúdo | Item | `acondicionamento`, `conteudoVolume` |
| Itens Diversos / Fornecidos / Campos Livres / Observação / Obs. Áreas | Item | colunas do item |
| Cores, Processo, Cobertura, Fabricante, Suporte, Fornecido, Microondulado, Fibra, Mont., Corte, Ajuste Micro (plano único) | Plano implícito no item | colunas achatadas do item |
| Plano multi: Nome, Suporte, Gramatura, Formato (L×A), Cores, Máquina, Acabamentos | Plano | `PlanoCalculoGrafico` |
| Plano multi: Ocor., Tiragem do plano, Mont., Corte, Formato Aberto/Final, Processo, Cobertura, Fabricante, Fornecido, Fibra, Sentido onda, capa externa/micro/interna, Informações Complementares | Plano | **LACUNA**: `PlanoCalculoGrafico` não tem esses campos |

### Lacunas (decisão necessária)
1. `PlanoCalculoGrafico` só tem suporte/formato/cores/máquina/acabamentos. Para a Tela 3 fiel faltam campos (ocorrências, tiragem, montagem, formato de corte,
   processo, cobertura, fabricante, fornecido, fibra, capas, sentido da onda, ajuste micro). Opção: um Json `especificacao` aditivo (sem tocar o cálculo) ou colunas novas.
2. Formato Fechado/Aberto/Final e Alt Tampa no item: hoje só em `medidas` Json.
3. Qualquer campo novo só entra de forma ADITIVA; o motor e `ancorarCustoCalcgraf` não mudam (campos novos não afetam custo até decisão explícita).

## Perguntas abertas
1. O Cartucho também tem a lista de Restrições?
2. O botão de propriedades (ícone à direita) abre Montagem e Formato de Corte?
3. Comp x Larg x Alt aparece na Lâmina Simples quando o produto é de 3 dimensões?

## Respostas do usuário (17/11/2026) — incorporar ao desenho
1. **Restrições e Materiais existem em todos os produtos.** Print do Cartucho: ao lado das Atividades há `Restrições` (da atividade em foco) e
   `Materiais` (ex.: Cola Branca / Cola Quente) com `Medida em mm` (ex.: 211), mais `Informações Complementares`. Ou seja, Restrições e Materiais
   pertencem à ATIVIDADE selecionada (Vizor: `RestricaoAcabamento` e `MaterialAcabamento.tipoParam`), não ao produto. O flag `exibeRestricoes`
   do produto vira só um liga/desliga, não a fonte.
2. **Botão de propriedades** (ícone ao lado de "Ajuste Corte Micro" no Cartucho e à direita na Lâmina Simples): ainda NÃO confirmado o que abre.
   Hipótese do usuário: preview com imagens de corte, produto e arte. Tratar como pendência; no desenho fica como botão "Propriedades/Preview".
   Também há botão ao lado de "Microondulado" (cópia/propriedades do material) e o seletor de pasta em "Cobertura de Tinta" e "Acondicionamento".
3. **Comp x Larg x Alt NÃO aparece na Lâmina Simples** (Impressos usa Formato Fechado/Aberto; Venda de Cartão usa Formato Final). Princípio: **não engessar**.
   Os produtos devem poder ser criados/ajustados por cadastro conforme a necessidade de dados; a tela do item é montada pelo cadastro
   (`modoFormato`, flags e defaults), nunca por nome de produto no código. O cadastro de produto precisa ser o editor dessa configuração.
4. **Botão NC = "Suporte Não Cadastrado".** Abre um formulário para cadastrar na hora o papel que não existe no catálogo (a lista de suportes tem
   milhares de itens), para o orçamento não travar: `Nome`, `Gramatura`, `Espessura G/`, `Espes. (micras)`, `Formato`, `Fibra`, `Tira/Retira`,
   `Consumo de Tinta` (Tipo de Suporte, Coef. Consumo, ex. 1,6), `Unidades` (Custo: KG; Cálculo: FL), `Custo por Kg`, `Custo Frete/Kg`,
   `Pacotes com`, `Crédito ICMS %`, `Crédito IPI %`. No Vizor NÃO existe esse fluxo hoje (só `SuporteGrafico` + `PrecoMateriaPrima` cadastrados).
   Deve entrar na reforma como "Suporte não cadastrado" (cria suporte + preço mínimo marcado como provisório, para o comprador regularizar depois).

## Confirmação da Fase 1 (Tela 1 — Orçamento) — 17/11/2026
Respostas do usuário às pendências da tarefa 3.1 (P1, P2, P6):
1. **Wireframe da Tela 1 APROVADO**, com visual moderno, seguindo os padrões do sistema (Mantine, tokens adaptativos, padrão de grids).
2. **P2 (imagens): decisão alterada em relação à proposta.** O upload da imagem da faca NÃO vira ação de linha do grid. As imagens (corte, produto e arte) vêm da **Ficha Master do produto**, gravadas pela **Pré-Impressão** (`FichaGraficaProduto` / `ArteRevisaoProduto`). Deve existir uma **tela de preview como a de hoje**, ligada ao **orçamento na tela principal** (botão na Tela_Orcamento), e **não** ao grid de itens.
   - Consequência: a tela de preview deixa de ser a hipótese D2 do botão "Propriedades/Preview" do Item? Pendente de confirmar com o usuário; até lá o botão do Item segue como aviso (R13).
   - Consequência para o design: acrescentar à Tela_Orcamento um botão "Preview" que lê da Ficha Master (somente leitura) e substitui o antigo `ProdutoEspecificacao` (upload da faca) que sai da página.
3. **P6 (comissões):** segue a proposta: `Vendedor.comissao` × `valorTotalConsolidado`, calculado no back, 2 casas; sem vendedor ou percentual → estado vazio.
4. **P1:** recorte da Fase 1 mantido (R1.1, R1.2, R1.6 e R1.9 na Fase 1; R1.3, R1.4, R1.5, R1.7 e R1.8 completam nas Fases 2 e 3).

## Fase 2 (Tela 2 — ITEM): decisões "recomendadas" aprovadas pelo usuário em 17/11/2026
O usuário mandou seguir com as recomendações. Ficam registradas assim:

| Código | Decisão |
|---|---|
| D1 | Campos extras do plano vão num Json aditivo `especificacao` em `PlanoCalculoGrafico` (não entra no cálculo). |
| D2 | O botão "Propriedades/Preview" do item abre o mesmo `PreviewFichaMaster` da Tela 1 (somente leitura). |
| D3 | Formato Fechado, Aberto, Final e Altura da Tampa viram **colunas novas** no item (aditivas, nulas, sem efeito no custo). |
| G1 | Tiragens: a Fase 2 mantém 1 tiragem persistida (`quantidade`). Várias tiragens ficam para fase própria. |
| G2 | Atributos novos no cadastro (`possuiAlturaTampa` no produto; blocos previstos no tipo de plano) entram como colunas nulas. Nulo = mostrar (não regride). |
| G4 | O item ganha um bloco compacto de margem (reaproveita a prévia de margem atual). |
| P4 | `SANFONA_ABAS`: Comp × Larg + Nº de sanfonas + Aba. `PAGINA`: Formato Fechado + Nº de páginas. |
| P5 | Ajuste Corte Micro: número livre em mm, 0 a 20, 1 casa. Sem faixa por produto. |
| P7 | O 12992 (CG-PROD-11) abre como multi-plano com o plano já gravado. Não é revinculado (preserva a âncora de custo). |
| Invólucros | Segue a regra R8.4. Se quiser plano único, marcar o tipo de plano como `fixo` no cadastro. |
| OP em lote | Volta para a Tela 1 (botão "Emitir OPs" + badge "OP: N" por item). |
| Upload da faca no Pedido/Proposta | Sai. As imagens ficam só na Pré-Impressão (Ficha Master). |

### Wireframe da Tela 2 — plano único (ex.: Cartucho, Lâmina Simples)
```
← Orçamento 3233 · Item 1 — CARTUCHO                         [Preview] [Salvar] [Calcular]
┌ Produto ───────────────────────────────────────────────────────────────────────────┐
│ Produto [combo]  Tipo [combo]  Descrição [..............]  Sigla [__][🔍]  Tributação [▾] │
│ Tiragem [4.000]  Modelos [1]                                                       │
│ Formato (pelo modoFormato do cadastro):                                            │
│   3 dim: Comp[ ] Larg[ ] Alt[ ]  Aba Cola[ ] Aba Fec[ ]  Alt Tampa[ ] (se possuiAlturaTampa) │
│   2 dim: Formato Final [660 x 960]   Aberto/Fechado: Fechado[ x ] Aberto[ x ]      │
│   Sanfona: Comp[ ] Larg[ ] Nº sanfonas[ ] Aba[ ]   Página: Fechado[ x ] Nº páginas[ ] │
└────────────────────────────────────────────────────────────────────────────────────┘
┌ Impressão e suporte (plano implícito) ─────────────────────────────────────────────┐
│ Cores [5x0]  Processo [▾][Pré][🔒]  Cobertura [▾]      (oculto se semImpressao)      │
│ Fabricante [▾]  Suporte [.............][NC]  Form.Sup.[ ]  [ ] Fornecido            │
│ Microondulado [▾]  Fibra [▾]  Mont. [2x2]  Formato de Corte [calc.]  Ajuste micro [ ] mm [⚙ Propriedades] │
└────────────────────────────────────────────────────────────────────────────────────┘
┌ Acabamento ────────────────────────────────────────────────────────────────────────┐
│ Atividades (marcáveis, busca)   │ Restrições da atividade em foco │ Materiais + Medida mm │
│ Informações Complementares (se exibeInformacoesComplementares)                     │
└────────────────────────────────────────────────────────────────────────────────────┘
┌ Produto final ─────────────────────────────────────────────────────────────────────┐
│ Acabamentos de Produto (marcáveis)   Acondicionamento [lista 1][lista 2]  Conteúdo/vol [ ] │
│ [Itens Diversos] [Itens Fornecidos] [Campos Livres] [Observação] [Obs. Áreas de Op]  │
│ Margem do item [▾] → prévia: custo · preço · CM%                                    │
└────────────────────────────────────────────────────────────────────────────────────┘
```

### Wireframe da Tela 2 — multi-plano (ex.: Cartucho Composto, Caixa)
Mesmos blocos "Produto" e "Produto final". **Não** mostra "Impressão e suporte" nem "Acabamento" do plano. No lugar deles:
```
┌ Tipos de Plano ──────────────────────────────────── [Incluir][Copiar][Excluir][↑↓][Desfazer] ┐
│ Nome     │ Suporte              │ Cores │ Formato    │ Acabamento                     │
│ Tampa    │ Stora Enzo 415       │ 4x0   │ 650 x 1225 │ Corte e vinco, Colagem         │
│ Fundo    │ Microondulado E      │ 1x0   │ 700 x 1000 │ Acoplagem                      │
└──────────────────────────────────────────────────────────────────────────────────────┘
clique/duplo clique na linha → Tela 3 (Plano). Item puxado de cálculo: aviso antes da 1ª alteração de plano (risco R-ANC).
```

Regras: tudo é montado pelo cadastro (`modoFormato`, flags, `DefaultProdutoPlano`, `TipoPlanoGrafico.fixo`); nenhum nome de produto fixo no código.
Campos novos não mudam o custo nem a âncora. O `EditorItem` atual só é removido no fim da Fase 2, depois da conferência.

## Fase 3 (Tela 3 — PLANO): liberada pelo usuário ("pode seguir", 18/11/2026)
- Wireframe: o da seção "Tela 3 — PLANO" acima (grid Tipos de Plano + tela "Inclusão/Alteração de Tipo de Plano").
- D1: Json `especificacao` versionado (`versao: 1`) em `PlanoCalculoGrafico`, fora do cálculo.
- G2: blocos do plano pelas flags `prevCapaExterna/prevMicroondulado/prevCapaInterna/prevFibra` (nulo = mostrar).
- R-ANC: `reconsolidarItemComPlanos` NÃO é alterado. Em item puxado de cálculo, aviso antes da 1ª alteração de plano; reordenar usa rota sem reconsolidação.
- Ajuste Corte Micro: mantido o requisito (item 0 a 100,00; plano −99,99 a 99,99) até o usuário dizer outro valor.
- Desenho do encaixe na Tela 2: fora desta fase (continua no assistente de novo orçamento).
