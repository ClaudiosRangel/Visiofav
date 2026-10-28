# Backlog — Pontos do Orçamento Gráfico (Caio)

Registro vivo dos pontos levantados por Caio para o módulo de Orçamento Gráfico
(comparação com o Calcgraf). Existe para que NENHUM ponto se perca entre sessões
do Kiro. Sempre que um ponto for implementado, marcar aqui o status + a spec/
commit que o entregou.

> **Como usar:** cada ponto tem um ID estável (P1, P2, ...). Ao implementar,
> mudar o status para ✅ e anotar a spec e os commits. Pontos novos entram no
> fim da lista com o próximo ID livre. NÃO renumerar os existentes.

Última atualização: 28/10/2026.

---

## Legenda de status

- ✅ **Entregue** — implementado, verificado e (quando aplicável) commitado.
- 🟡 **Parcial** — parte entregue; resto pendente (detalhar o que falta).
- ⬜ **Pendente** — ainda não implementado.
- 🔎 **Investigação registrada** — levantamento feito/documentado, sem
  implementação de código.

---

## Spec de referência já criada

`.kiro/specs/orcamento-grafico-ajustes-caio/` (requirements + design + tasks) —
cobriu os pontos rápidos + investigações desta primeira leva. Back commit
`ac47bdbf9`; Front commit `29b064f`.

---

## Pontos

### P1 — Várias tiragens na mesma OP / item (matriz Tiragem × Margem) ✅ ENTREGUE

**O que é (Calcgraf):** uma única OS/orçamento tem vários itens de tiragem na
MESMA tela (ex.: itens 15221 / 15222 / 15223 "CARTUCHO COMPOSTO" no orçamento
5371), e o Fechamento mostra a **matriz Tiragem × Margem** (ex.: tiragens 5.000 /
10.000 / 50.000 com Margem%, C.Marg%, C.Marg$, Valor Unitário, Valor Total,
Primeiro Mil, Mil Seguinte por linha). O operador escolhe a faixa de tiragem e a
margem numa grade só.

**Evidência:** imagens do Calcgraf — lista de itens da OS (15221/15222/15223) +
tela "CARTUCHO COMPOSTO" (Tiragens "5.000,10.000,50.000") + Fechamento → aba
"Preço de Venda" com a grade de tiragens × margens.

**Escopo provável:** modelar múltiplas tiragens por item (ou múltiplos itens de
tiragem por OS), recalcular preço por faixa, exibir a grade Tiragem × Margem na
Revisão/detalhe, e permitir escolher a faixa que vira o preço do item.

**Status:** fora de escopo da 1ª spec (decisão do handoff). Relacionado à
"Comparação de Versões" que foi OCULTADA (P8) — este é o substituto definitivo
daquele workaround.

**ENTREGUE (28/10/2026).** Spec `orcamento-grafico-varias-tiragens`
(requirements + design). Decisões confirmadas pelo usuário (inclusive via
WhatsApp): grade POR ITEM; operador DIGITA as tiragens separadas por vírgula; a
grade é de comparação e, ao escolher UMA faixa, ela vira a `quantidade` oficial
do item (sem tabela nova / sem schema). Implementação SÓ frontend (reusa as
rotas `simular-tiragens` que já existem):
- `parse-faixas-tiragem.ts` (parser puro) + teste vitest/fast-check (15/15).
- `StepRevisao.tsx`: input "Tiragens (separadas por vírgula)"; grade Tiragem ×
  Margem (Quantidade, Valor Unitário, Valor Total, Margem%, CM% e CM$, 1º Mil /
  Mil Seguinte derivados no front); botão "Usar esta tiragem" → vira a
  `quantidade` do item; faixa atual destacada; vazio → faixas automáticas
  (não-regressão). get_diagnostics limpo. NÃO commitado ainda.
NOTA operacional: no FRONT deste repo, o vitest roda no pool PADRÃO (forks); o
`--pool=threads` TRAVOU nesta máquina (oposto da nota de steering do OutLife).

---

### P2 — Itens Diversos no cálculo (Revisão) e na gravação ✅ ENTREGUE

**O que era:** garantir que os Itens Diversos (aba "Itens Complementares" →
"Itens Diversos" do wizard) entrem no cálculo da Revisão de um orçamento NOVO
(sem puxar cálculo) e sejam gravados.

**Entregue:** o `StepRevisao` passou a enviar `itensDiversos` no payload da
prévia (`POST /orcamento-grafico/calcular`); o motor já somava ao Material
Direto e o salvar já persistia em `item_orcamento_grafico.itens_diversos`.
Spec `orcamento-grafico-ajustes-caio` (Req 1). Front commit `29b064f`.

---

### P3 — Campos do pré-cálculo: "temos essas informações no orçamento?" 🔎 INVESTIGAÇÃO REGISTRADA / 🟡 PARCIAL

**O que é (Calcgraf):** a tela de **Fechamento** do Calcgraf (orçamento 5521,
cliente COVELI, "FACA LINHA MEDICAMENTO 65x22x95") tem 4 abas com dados que o
Vizor precisa ter/exibir:
- **Preço de Venda** — grade Tiragem × Margem (ligado ao P1).
- **Taxas de Produção** — Materiais Diretos, Transformação, Serviços Externos,
  Crédito Pis/Cofins, Crédito de ICMS, Crédito de IPI, Custo Financeiro.
- **Custos Diretos de Venda** — Comissão de Agência/Vendedor/Vendedor2/Produtor/
  Produtor2/Interna, Imposto de Venda, Juros, Pis/Cofins (alíquota × base +
  valor fixo = valor da taxa).
- **Diversos** — Prazos (Produção/Entrega, Armazenagem, Pagamento, (-)
  Financiamento, Total em dias), Precisão do Valor Unitário (Ideal/Máxima/
  Var.Máx.%), Margem de Lucro sobre (Venda/Produção), Juros (Bancária/Aplicação,
  incide à vista/à prazo, simples/composto).

**O que entrou:** o LEVANTAMENTO (tabela no design da spec
`orcamento-grafico-ajustes-caio`, Req 2) confirmando, contra o schema real,
quais campos já existem (engenharia: formato, aproveitamento, cores, papel) e
quais NÃO existem como coluna (prazos, condição de pagamento, quebra/apara por
item, taxas/comissões/créditos editáveis) — hoje só vivem na foto/CEV ou em
cadastros. Conclusão registrada: a 1ª spec NÃO cria colunas novas.

**O que falta (⬜):** IMPLEMENTAR a exibição/edição desses campos no orçamento do
Vizor (as 4 abas do Fechamento). Isso se sobrepõe fortemente ao **P7** (editor de
custos completo) — provavelmente a mesma spec entrega P3(implementação) + P7.

---

### P4 — Acabamentos com Restrições + Materiais (com valor) influenciando o cálculo ⬜ PENDENTE

**O que é (Calcgraf):** na tela "CARTUCHO COMPOSTO", a lista "Tipos de Plano"
tem, por plano, os acabamentos (ex.: "Cortadeira (Grande), Verniz, Dayuan (Corte
e Vinco), Diana (Coladeira), Bisuc (Acoplagens)") e a seção "Acabamentos de
Produto → Atividades" (Colagem Manual, Colocação de Alça, Envase) +
"Acondicionamento" (Caixa Padrão, Embalar). Os acabamentos têm **restrições**
(sub-opções) e **materiais com valor** que entram no cálculo (MD/CT).

**Evidência:** imagens da tela "CARTUCHO COMPOSTO" (Tipos de Plano + Acabamentos
de Produto / Acondicionamento) e "Item Diversos: FACA NOVA, COLAGEM MANUAL
DUPLA".

**Status:** fora de escopo da 1ª spec. **Spec dedicada a criar** (há uma spec
`orcamento-grafico-acabamentos` já existente no repo — verificar se cobre isto
ou se é outra; não confundir). Relacionado ao cadastro rico de acabamentos
(`AcabamentoGrafico`) já usado em `acabamentosRicos`.

---

### P5 — Matriz de Impressão preenchida ao puxar cálculo ✅ ENTREGUE

**O que era:** ao "Puxar Cálculo", a Matriz de Impressão deveria vir preenchida
(qtd + preço unitário) e entrar no Material Direto, sem digitação manual.

**Entregue:** `copiarCalculoParaItem` projeta a matriz nos campos dedicados
(`matrizQuantidade`/`matrizPrecoUnitario`) a partir da decomposição STC / foto
rica, removendo o item diverso equivalente para não duplicar no MD; o detalhe do
item exibe qtd/preço da matriz. Spec `orcamento-grafico-ajustes-caio` (Req 3).
Back `ac47bdbf9` + Front `29b064f`.

---

### P6 — Validação de valores reais por componente (golden) ❌ DESCARTADO

**DESCARTADO (28/10/2026, decisão do usuário):** NÃO foi um pedido real do
usuário — veio de uma referência do handoff da sessão anterior que citava esses
números como golden. Na verificação, os cálculos 15466/15221/15222/15223 NÃO
existem no acervo (teto 15196). Como não é pendência do usuário, o ponto é
encerrado. A metodologia de conferência (foto × STC, desvio ≤0,5%) continua
disponível e já é usada pela rota de conferência existente; se um dia precisar
validar, usar um cálculo que exista (ex.: 12992). Mantido aqui só por registro.

**O que era:** conferir que papel/kg, tinta/cor e acabamentos batem com o
pré-cálculo do Calcgraf nos casos 15466 (orç. 5521) e 15221/15222/15223.

**Resultado:** a metodologia está confirmada (decomposição `custos_calcgraf` por
`origem`, rota de conferência com desvio ≤0,5%). PORÉM os números citados
**NÃO existem** no acervo migrado da Wega — o maior `numero_calcgraf` é **15196**
(acervo: 7.951 cálculos, 7.926 com STC). O único alvo real existente é o **12992**
(já validado: soma STC = R$ 5.192,05, bate exato). Registrado no design da spec.

**O que falta (⬜):** se o usuário quiser, escolher casos golden que EXISTAM
(≤ 15196) e rodar a comparação componente a componente. Também pode ser que o
Calcgraf tenha cálculos mais novos (15221+) que ainda NÃO foram migrados — se for
o caso, re-exportar/re-importar o acervo atualizado antes de validar.

**NOTA (28/10/2026):** não é possível verificar daqui se o Calcgraf tem cálculos
> 15196 — o Calcgraf roda no SQL Server do servidor da PHTech (acesso via RDP),
fora do alcance do Kiro. O que foi confirmado é o acervo MIGRADO no Vizor (Neon):
teto 15196, 7.951 cálculos. Para destravar o P6, o usuário precisa: (a) escolher
cálculos golden que existam (≤ 15196) para a validação valer; ou (b) re-exportar
o acervo atualizado do Calcgraf (incluindo 15221+, se existirem lá) e re-importar
antes de validar. Enquanto isso, o 12992 serve de golden confirmado.

---

### P7 — Editor de custos completo (Fechamento com abas) ⬜ PENDENTE

**O que é (Calcgraf):** reproduzir o **Fechamento** completo do Calcgraf como
editor no Vizor: as 4 abas (Preço de Venda / Taxas de Produção / Custos Diretos
de Venda / Diversos), **Tabelas de Custo editáveis**, **Planos**, **Observações**,
e **mostrar a imagem do encaixe onde encaixar melhor** (preview de imposição).

**Evidência:** as 5 telas de "Fechamento" (orç. 5521) + "Tipos de Plano" da tela
Cartucho Composto.

**Status:** maior item do conjunto. Fora de escopo da 1ª spec. **Spec dedicada a
criar.** Engloba a IMPLEMENTAÇÃO do P3 (as 4 abas e seus campos). O preview de
encaixe já tem base (`EncaixeVisual`/`EncaixeArquivoModal` no front) — estender
para "mostrar onde encaixa melhor".

---

### P8 — Ocultar Comparação de Versões ✅ ENTREGUE

**O que era:** ocultar a tela de Comparação de Versões (workaround antigo de
"várias tiragens"), preservando o código.

**Entregue:** flag `MOSTRAR_COMPARACAO_VERSOES = false` em `[id]/page.tsx`
(código preservado). Será substituída pelo P1 (várias tiragens por item). Spec
`orcamento-grafico-ajustes-caio` (Req 8). Front `29b064f`.

---

### P9 — Rótulos das medidas (Comprimento/Largura/Altura) ✅ ENTREGUE

**O que era:** o StepMedidas mostrava rótulos divergentes/duplicados; Caio quer
"Comprimento, Largura, Altura".

**Entregue:** normalização na UI (`StepMedidas`, por `param.nome` L/A/P, aplica
também ao `ItemWizardModal`) + seed `importar-calcgraf.ts` corrigido + dado
corrigido em PRODUÇÃO nos 12 `CG-EMB-*` (não havia duplicata — era divergência
de nomenclatura "Largura/Altura/Profundidade"). Spec
`orcamento-grafico-ajustes-caio` (Req 5). Back `ac47bdbf9` + Front `29b064f`.

---

### P10 — Editar Cabeçalho enxuto (cliente + representante) ✅ ENTREGUE

**O que era:** "Editar Cabeçalho" devia editar só cliente + representante, sem
reabrir o wizard inteiro.

**Entregue:** modal enxuto `EditarCabecalhoModal` (cliente + vendedor) via
`PUT /orcamento-grafico/:id` (não recalcula). Spec
`orcamento-grafico-ajustes-caio` (Req 7). Front `29b064f`.

---

### P11 — Ocultar uma tela ✅ ENTREGUE

Confirmado com o usuário = a tela de **Comparação de Versões** (ver P8).

---

### P12 — Remover "Repetição de produto" no Novo Orçamento ✅ ENTREGUE

**Entregue:** campo oculto no `StepCliente` (prop `mostrarRepeticaoProduto`,
default false) no fluxo novo. Spec `orcamento-grafico-ajustes-caio` (Req 9).
Front `29b064f`.

---

### P13 — De-para do cliente SOL & NEVE / código Calcgraf 13 ✅ RESOLVIDO

**Resultado (consulta à produção autorizada):** o cliente existe — razão social
"MARBRAN INDUSTRIA COMERCIO E TRANSPORTE LTDA", fantasia "SOL & NEVE", **com CNPJ
`70928650/0001-87` E `codigoCalcgraf = 13`**. O de-para resolve pelo critério
PRIMÁRIO (CNPJ); o código 13 é rede redundante. Nenhuma ação necessária.
Registrado no design (Req 6).

---

### P14 — Busca de cliente: código exato no topo + nome fantasia entre parênteses ✅ ENTREGUE

**O que era (pedido durante a sessão):** ao localizar por código/nome, a lista
mostrava só a Razão Social; melhorar para (a) LIKE também por nome fantasia, (b)
mostrar o nome fantasia entre parênteses, (c) trazer o código exato no topo.

**Entregue:** LIKE por nome fantasia já existia no backend. Adicionado: código
exato no topo (`GET /clientes`) + nome fantasia entre parênteses no rótulo
(`StepCliente` + `EditarCabecalhoModal`). Back `ac47bdbf9` + Front `29b064f`.

---

### P15 — Exibir o encaixe REAL (arquivo enviado) ao lado do encaixe simplificado ✅ ENTREGUE

**O que é:** hoje existem DUAS representações de encaixe/imposição, em telas
separadas:
1. **Encaixe REAL** — o arquivo (PNG/JPG/SVG/PDF) gerado por um aplicativo
   externo de imposição e enviado pelo usuário no modal "Encaixe / Imposição"
   (`EncaixeArquivoModal`), acessível pelo ícone de grade na linha do item. É o
   layout VERDADEIRO das peças da caixa na folha (ex.: o thumbnail PNG "CAIXA DE
   PAPELÃO P/5KG DE ELETRODO SERRALHEIRO").
2. **Encaixe SIMPLIFICADO** — a seção "Encaixe na folha" do wizard de item
   (StepRevisao / Editar Item), um retângulo azul esquemático do aproveitamento
   GEOMÉTRICO calculado pelo motor (ex.: "2x1 = 2 peças/folha, rotacionada 90°,
   61,4% da folha").

**Pedido do usuário:** quando houver o **arquivo de encaixe real** enviado para
o item, exibi-lo **ao lado** do encaixe simplificado (na mesma tela de Revisão/
"Encaixe na folha"), para o operador comparar o teórico (motor) com o real
(aplicativo de imposição) lado a lado.

**Evidência:** imagem 1 = modal "Encaixe / Imposição" com o thumbnail PNG real
do item; imagem 2 = "Editar Item do Orçamento" → StepRevisão → seção "Encaixe na
folha" com o retângulo azul simplificado. O usuário quer os dois juntos.

**Escopo provável (frontend):** no StepRevisao, quando o item tiver arquivo de
encaixe enviado (o mesmo que o `EncaixeArquivoModal` gerencia), buscar/exibir a
miniatura do arquivo real ao lado do `EncaixeVisual` simplificado (layout em
duas colunas: "Encaixe calculado" × "Encaixe real (arquivo enviado)"). Reusar o
endpoint/arquivo que o `EncaixeArquivoModal` já consome. Só exibição — não altera
cálculo.

**Observação:** depende de o item já ter id salvo (o arquivo de encaixe é
vinculado ao item persistido). No wizard de item em EDIÇÃO isso existe; na
CRIAÇÃO do zero (item ainda sem id) não há arquivo — nesse caso exibir só o
simplificado (não-regressão).

**ENTREGUE (28/10/2026):** `StepRevisao.tsx` agora exibe, quando o item salvo
tem arquivo de encaixe enviado, a miniatura/PDF do encaixe REAL num `SimpleGrid`
de 2 colunas ao lado do "Encaixe calculado" (EncaixeVisual). Adicionados campos
gerais `_itemSalvoOrcamentoId`/`_itemSalvoId` ao `WizardFormData`
(`novo/page.tsx`), preenchidos pelo `ItemWizardModal` para QUALQUER item em
edição (não só repetição) — assim o encaixe real aparece em qualquer item salvo
com arquivo. Sem arquivo / criação do zero → só o encaixe calculado (1 coluna),
sem regressão. Só frontend (endpoints de encaixe-arquivo já existiam).
get_diagnostics limpo. NÃO commitado ainda.

---

## Próximos pontos (a registrar — o usuário vai enviar mais)

<!-- Adicionar aqui os novos pontos conforme o usuário for passando, com IDs
     P16, P17, ... Não renumerar os existentes. -->
