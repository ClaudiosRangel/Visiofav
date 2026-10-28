# HANDOFF — Ajustes/Melhorias do Orçamento Gráfico (12 pontos)

> Contexto: sessão anterior entregou o hand-off comercial (menu Comercial,
> conversão, amostras, jornada, upload de encaixe). O usuário então apontou 12
> pontos de ajuste/correção/melhoria no **orçamento gráfico e seu cálculo**,
> comparando o Vizor com o **Calcgraf** (prints enviados + base restaurada).
> Esta é a lista de trabalho para a PRÓXIMA sessão. Nada implementado ainda.
> Data: 28/10/2026.

## Como consultar a base do Calcgraf (restaurada local)
- SQL Server local, banco **`CalcgrafCartonWega`** (instância padrão
  `MSSQLSERVER`). Conexão: `sqlcmd -S localhost -E -C` (o `-C` é obrigatório).
  Para acentos em export: `sqlcmd -u` (UTF-16) → ler como `utf16le` no Node.
- Tabelas-chave do orçamento: `CalculoHeader` (+ `NumCalculo`, pega o de MAIOR
  `Codigo`), `CalculoPlanos`, `CalculoTintas`, `CalculoMatAcabamento`,
  `CalculoItensDiversos`, `CalculoAtividades`, `CalculoTiragens`,
  `CalculoResAgrupamento` (CT=1/MD=2/SE=3), `CalculoSTC` (custo final por
  componente), `Itc` (Origem: SUPORTE/TINTA/MAT.ACABAMENTO/CENTRO DE CUSTO/
  MATRIZ IMPRESSÃO), `TabelasCustoDetalhe`, `Nomes`/`NomesxClientes` (clientes),
  `Atividades` (acabamentos com restrições/materiais).
- Empresa Wega em produção (Neon): `75848e24-742e-461d-b913-1642c5b83ae9`.
  Connection string de produção fica FORA do git (ver steering migração-calcgraf).

## Arquivos-chave (frontend)
- Wizard novo orçamento: `VisioFab.Wms.Front/src/app/(interna)/orcamento-grafico/novo/`
  - `page.tsx` (steps: Cliente, Tipo, Medidas, Papel, Cores, DadosTecnicos,
    Acabamentos, ItensDiversos, Revisão), `StepCliente.tsx`, `StepMedidas.tsx`,
    `StepCores.tsx`, `StepAcabamentos.tsx`, `StepItensDiversos.tsx`,
    `StepDadosTecnicos.tsx`, `StepRevisao.tsx`, `dadosTecnicosPayload.ts`.
- Detalhe do orçamento: `src/app/(interna)/orcamento-grafico/[id]/page.tsx`
  (+ `ItemWizardModal.tsx`, `EncaixeArquivoModal.tsx`, `AmostrasModal.tsx`).

## Arquivos-chave (backend)
- `src/modules/orcamento-grafico/orcamento-grafico.routes.ts` (rotas; inclui
  `/calcular` prévia, `/:id/itens`, `/:id/itens/:itemId/calcular`, `de-calculo`).
- `src/modules/orcamento-grafico/orcamento-grafico-item.service.ts` (motor:
  `montarParamsDoItem`, `calcularOrcamentoGrafico`, preservarEngenhariaDoItem,
  ancorarCustoCalcgraf). `orcamento-grafico-calculo.service.ts` (cálculo puro).
- Schema: `ItemOrcamentoGrafico` (campos `itensDiversos`, `matrizQuantidade`,
  `matrizPrecoUnitario`, `cores`, `acabamentosRicos`, `encaixeArquivo`...).

---

## OS 12 PONTOS

### 1. Várias tiragens na mesma OP/orçamento (MELHORIA — grande)
No Calcgraf o orçamento tem **"Tiragens: 5.000, 10.000, 50.000"** (várias
quantidades no MESMO item/cálculo) e o Fechamento mostra uma linha de
preço/margem/C.Marg por tiragem (ver print da tela "Fechamento" e do
pré-cálculo, que lista 5.000*/10.000/50.000 com 3 margens cada).
- Hoje o Vizor tem UMA `quantidade` por item. A tela de "Comparação de Versões"
  cria orçamentos separados por quantidade (workaround), não é o mesmo conceito.
- **Alvo:** permitir N tiragens por item e exibir a matriz tiragem × margem ×
  valor (como o Calcgraf). Decidir schema: array de tiragens no item, ou tabela
  filha `TiragemItemOrcamento` (tiragem, margem, precoUnitario, valorTotal,
  cMargem). O motor já calcula por quantidade — é recalcular N vezes.
- Base: `CalculoTiragens` (uma linha por tiragem, com `ItemMargem`/
  `ValorTotalVenda`) + `CalculoMargens` (as 3 faixas). Ver foto rica (spec
  `calculo-grafico-foto-rica`) que JÁ decifrou as 3 faixas de margem por gross-up.

### 2. Itens Diversos no cálculo da Revisão + gravação (BUG a investigar)
Verificar se os **Itens Diversos** (StepItensDiversos) entram no cálculo da
Revisão (StepRevisao) de um **orçamento NOVO** (sem puxar cálculo), e se são
GRAVADOS ao salvar.
- Suspeita: a prévia `POST /orcamento-grafico/calcular` (StepRevisao) pode NÃO
  estar enviando `itensDiversos` (grep em StepRevisao.tsx não achou o campo no
  payload). O motor (`orcamento-grafico-item.service.ts`) referencia
  `itensDiversos` (8 hits) — então o cálculo SABE somar, mas a prévia pode não
  mandar. Conferir `montarPayloadDadosTecnicos`/payload do StepRevisao.
- Validar: criar orçamento novo com item diverso "fixo" e verificar se o
  Custo de Produção muda e se persiste no `item_orcamento_grafico.itens_diversos`.

### 3. "Temos essas informações no orçamento?" (INVESTIGAÇÃO)
O print do pré-cálculo do Calcgraf (15466 / 5521) tem campos que podem faltar no
Vizor: **Formato Final**, **Progr. Entrega "a combinar"**, **Repet. TR**,
**Corte/Form/Aprov.** por plano, **Quebra% / Apara%**, **Prod/H**, bloco
**Prazos** (Produção/Armazenagem/Pagamento/Financiamento), **Condição de
Pagamento** (ex.: 21 DDL). Levantar o que o Vizor já persiste vs o que falta
(comparar `ItemOrcamentoGrafico` + `resultadoCalculo` com o pré-cálculo).

### 4. Atividades de Acabamento têm RESTRIÇÕES e MATERIAIS (MELHORIA)
No Calcgraf, cada Atividade de acabamento tem **Restrições** (ex.: "Acerto
Acoplado Colagem Lateral", "Normal Repetição", "Onda B Acoplado Novo"...) e
**Materiais** (ex.: Cola Branca, Cola Quente) — ver prints da tela CARTUCHO
(Acabamento → Atividades/Restrições/Materiais). Esses materiais TÊM VALOR e
devem:
  (a) ao **puxar cálculo existente**: vir preenchidos conforme o cálculo;
  (b) em **orçamento novo**: influenciar o cálculo final.
- Base: tabela `Atividades` (restrições/materiais) + `CalculoMatAcabamento`
  (material escolhido por atividade no cálculo) + `CalculoSTC` (valor final).
- Já existe spec relacionada: `orcamento-grafico-acabamentos` (cadastro de
  acabamentos). Verificar o cadastro `AcabamentoGrafico` e se `restricao`/
  `material` existem; o item usa `acabamentosRicos` (JSON). Ver `restricaoAcabamentoId`
  já no tipo do wizard (`AcabamentoRicoSelecionado`).

### 5. "Essa informação já deveria ser preenchida" (INVESTIGAÇÃO)
Refere-se à **Matriz de Impressão** (print do bloco "Matriz de impressão —
Qtd. matrizes / Preço unitário de matriz (R$)" que aparece VAZIO no wizard). No
pré-cálculo o CD (matriz) tem Qtd 2 e aparece no MD (R$ 99,00). Ao puxar cálculo
existente, matriz deveria vir preenchida. Campos `matrizQuantidade`/
`matrizPrecoUnitario` existem no item — conferir se o `de-calculo`/ancoragem
preenche e se o motor soma no MD. Base: `Itc` Origem='MATRIZ IMPRESSÃO' +
`CalculoSTC`.

### 6. Checar se os valores estão REAIS (VALIDAÇÃO)
Conferir se o orçamento traz os valores corretos (papel por kg, tinta por cor,
acabamentos) comparando com o pré-cálculo do Calcgraf. Usar o caso **15466 /
orçamento 5521** (COVELI, FACA LINHA MEDICAMENTO 65x22x95, tiragem 19.000,
C.PROD R$ 6.622,61, Valor Total R$ 10.602,00) e o **15221/15222/15223**
(GRANVITA) dos prints. A ancoragem (foto do Calcgraf) já bate o total ao puxar;
aqui é garantir o DETALHE por componente (ver `CalculoSTC`/foto rica).

### 7. Ver e ALTERAR custos no orçamento (MELHORIA — grande) + ENCAIXE
O usuário quer, ao abrir o "Editor do cálculo" (no Calcgraf o botão **Editor
Ctrl+E**), ter os mesmos recursos do Calcgraf:
- **Fechamento** com abas: Preço de Venda (matriz tiragem×margem), Taxas de
  Produção, Custos Diretos de Venda (comissões/impostos/juros/PIS-Cofins),
  Diversos (prazos, parâmetros gerais, margem sobre venda/produção, juros).
- **Editor → Estrutura / Tabelas de custo / Expressa / Observações / Cálculo
  padrão / Acabados / Campos Livres** (menu Editar do Editor).
- **Tabelas de Custo** com "Alteração Manual de Custo" (Grupo de Origem/Origem/
  Descrição/Unidade/Tabela/Coluna/Custo Unitário) — ver print.
- **Planos** (Tipo/Nome/Tiragem/Formato/Suporte/Quebra/Apara/Atividades por
  plano/Cobertura de Tinta/Custo do Plano).
- **Observação do Cálculo** com Tipos (Pedido de Venda, Produto-Complemento,
  Proposta-Descrição, Proposta Observação...) — parece pré-preenchimento.
- **ENCAIXE:** mostrar a imagem do encaixe quando houver, "em algum lugar que
  se encaixe melhor" (hoje é o `EncaixeArquivoModal` por item — avaliar colocar
  um preview inline na Revisão/detalhe quando já houver arquivo enviado).
- É o maior item: provavelmente vira uma spec dedicada "editor de custos do
  orçamento".

### 8. Mudar títulos (UI — rápido)
Trocar títulos. A imagem mostra o estado atual; o alvo era um texto diferente.
**AÇÃO:** pedir ao usuário os textos exatos (a imagem do "para" não ficou
explícita). Candidato: nas Medidas o rótulo some conforme o tipo (2D mostra
Largura/Altura/Profundidade "Cartucho Composto"; outro print mostra
Comprimento/Largura/Altura vazios). Confirmar com o usuário o de→para exato dos
títulos antes de mexer.

### 9. Cliente existe na base como "13"? (INVESTIGAÇÃO)
Print mostra "Principal: 13 — SOL & NEVE" no Calcgraf. Verificar se o cliente
**SOL & NEVE** existe no Vizor e se o **código Calcgraf 13** está mapeado
(campo `Cliente.codigoCalcgraf`). O de-para de cliente no puxar é por **CNPJ
normalizado**, não por código (ver steering). Checar se SOL & NEVE veio na
migração de clientes (1.016 importados) e por que o código 13 é relevante.

### 10. "Editar Cabeçalho" deve ser só nome do cliente + representante (UI)
No detalhe do orçamento, o botão **Editar Cabeçalho** hoje provavelmente abre
mais campos. Reduzir para editar APENAS **cliente** e **representante/vendedor**.
Arquivo: `src/app/(interna)/orcamento-grafico/[id]/page.tsx` (ação Editar
Cabeçalho → rota `/orcamento-grafico/novo?editId=...` hoje reabre o wizard
inteiro). Avaliar um modal enxuto só com cliente+vendedor.

### 11. Ocultar uma tela por enquanto (UI — rápido)
O usuário quer **ocultar uma tela**. A imagem associada não deixou claro qual
(provável: a tela de desenho/encaixe interno OU a "prévia do encaixe" do
StepRevisao, agora que o encaixe é upload externo). **AÇÃO:** confirmar com o
usuário QUAL tela ocultar antes de agir.

### 12. Novo Orçamento: remover "Repetição de produto" (UI — rápido)
No StepCliente do wizard existe o campo **"Repetição de produto (opcional) —
Buscar produto cadastrado..."**. Quando for **orçamento NOVO** (do zero), esse
campo deve sumir (repetição é só para reimpressão de produto já cadastrado).
Arquivo: `src/app/(interna)/orcamento-grafico/novo/StepCliente.tsx` (campo
`produtoId`/`produtoNome`). Decidir: ocultar sempre no fluxo "novo", ou manter
só no fluxo de repetição. Alinha com o ponto do roadmap (repetição é 1ª classe).

---

## Sugestão de agrupamento em specs (nova sessão)
1. **UI rápidas** (pontos 8, 10, 11, 12) — uma leva pequena de frontend, confirmar
   textos/telas com o usuário antes.
2. **Investigações + correções** (2, 3, 5, 6, 9) — validar na base e corrigir o
   que estiver faltando no payload/gravação (itens diversos, matriz, valores).
3. **Acabamentos restrições/materiais** (ponto 4) — estende a spec
   `orcamento-grafico-acabamentos`.
4. **Várias tiragens por item** (ponto 1) — spec dedicada (schema + motor + UI).
5. **Editor de custos do orçamento** (ponto 7) — a maior; spec dedicada
   (fechamento com abas + tabelas de custo editáveis + planos + observações +
   preview do encaixe). Consultar `CalculoSTC`/foto rica como fonte.

## Observação importante do usuário
"Atentando as observações que parece ser pré-preenchimentos" — vários campos do
Calcgraf (Observação do Cálculo, tipos de observação, tabelas de custo) são
PRÉ-PREENCHIDOS a partir de cadastros. Ao implementar, respeitar essa lógica de
default vinda do cadastro, permitindo override por orçamento.
