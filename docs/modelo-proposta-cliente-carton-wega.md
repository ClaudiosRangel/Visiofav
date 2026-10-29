# Modelo de Proposta ao Cliente — Carton Wega (referência de layout B1)

> Referência para o template "Padrão Carton Wega" (spec comercial-templates-proposta,
> bloco B1, task 6). Transcrito das 2 imagens enviadas pelo Caio em 29/10/2026.
> São DOIS usos do mesmo layout: (1) proposta de 1 item e (2) proposta multi-item
> ("modelo para aprovação de cálculo", que continua em várias páginas).

## Layout (ordem dos elementos)

1. **Logo Carton Wega centralizado** no topo (barra CMYK + "carton wega /
   embalagens de papel"). No Vizor usa o logo da empresa (`empresa.logoUrl`).
2. **Linha de cabeçalho**: à ESQUERDA `"Comendador Levy Gasp, {data por extenso}"`
   (ex.: "23 de Outubro de 2026"); à DIREITA, alinhado, duas linhas:
   `Proposta nº   {numero}` e `Cálculo nº   {numeroCalcgraf/numero}`.
3. **Destinatário**: `À` + `{CLIENTE em negrito/maiúsculas}`. No multi-item
   também mostra `At. Sr(a): {contato}` e `E-mail: {email}` abaixo.
4. **Saudação**: `"Prezado(s) senhor(es),"` + `"Conforme solicitado,
   encaminhamos abaixo nossa proposta:"`.
5. **Bloco de dados do produto** (modelo 1 item) — rótulos em negrito:
   - `Produto:` (tipo de embalagem, ex.: Cartuchos)
   - `Descrição:` (ex.: "Piloto Cartucho Sabonete Leite de Rosas")
   - `Formato Final:` (ex.: "57 x 32x82 mm")
   - `Especificações:` (ex.: "Cartucho em Klabin Advanced Triplex 250 g/m2, 2x0 cores")
   - `Acabamentos:` (ex.: "Verniz Base Água Total Frente, Laminação maior Total
     Verso, FACA NOVA")
6. **Tabela de preços**:
   - Modelo 1 item: colunas **Quantidade | Unitário | Total (R$)**, uma linha por
     faixa de tiragem (ex.: 70.000 → R$ 0,298 → R$ 20.860,00; 100.000 → R$ 0,245
     → R$ 24.500,00).
   - Modelo multi-item: colunas **Quantidade | Descrição | Unitário | Valor Total**
     — cada linha é um item com a descrição COMPLETA (produto + formato +
     material + cores + acabamentos + "Cálculo 15.xxx" + tributação "(3% ICMS +
     0% IPI)"). Continua em páginas seguintes com "continua..." / "...continuação".
7. **Rodapé de condições** (rótulos em negrito, em duas colunas):
   - `Cond. Pagto:` (ex.: "15/21/28") · `Validade:` (ex.: "10 dias")
   - `Vendedor:` (ex.: "CB") · `Imposto:` (ex.: "ICMS + IPI")
   - `Programação Entrega:` (ex.: "a combinar")
8. **Bloco "IMPORTANTE:"** (texto fixo, 5 linhas):
   - A gráfica não se responsabiliza por impressões realizadas sem provas de cor.
   - Este Orçamento está apoiado na informação fornecida pelo cliente. Qualquer
     reajuste nos preços estará apoiado nas diferenças que se encontrem na
     recepção dos arquivos originais do cliente.
   - Reservamos o direito de entregar 10% a mais ou a menos da quantidade
     solicitada, de acordo com as normas A.B.T.G - ASSOCIAÇÃO BRASILEIRA DE
     TECNOLOGIA GRÁFICA.
   - Os processos de fabricação só terão início após confirmação do pedido e
     aprovação de arte.
9. `"Autorizo a confecção do(s) item(ns) acima assinalado(s)."`
10. **Linha de assinatura** + `"Assinatura do Cliente"`.
11. `"Atenciosamente,"` + `"Carton Wega Indústria de Embalagens"`.
12. **Rodapé**: `"CARTON WEGA INDUSTRIA DE EMBALAGENS SA"` (razão social).

## Mapeamento para o template B1 (TemplatePropostaConfig)

Este layout é um ESTILO próprio ("wega") — vai além dos toggles genéricos do B1.
Decisão de implementação: adicionar um campo `estilo: 'PADRAO' | 'WEGA'` à config
do template (aditivo), e um renderizador `gerarPropostaWega()` que desenha este
layout. O template "Padrão Carton Wega" (default da Wega) usa `estilo: 'WEGA'`;
os demais seguem o `'PADRAO'` (layout genérico atual). Os toggles de bloco ainda
valem no estilo WEGA onde fizer sentido (ex.: decomposição de custos NÃO aparece
na proposta ao cliente Wega — ela mostra só preço final por tiragem/item).

- Cabeçalho WEGA: logo + "Comendador Levy Gasp, {data}" + Proposta/Cálculo nº.
- Introdução: "Prezado(s) senhor(es), Conforme solicitado, encaminhamos abaixo
  nossa proposta:" (texto fixo do estilo; editável via `textos.introducao`).
- Condições (IMPORTANTE): texto fixo do estilo; editável via `textos.condicoes`.
- Rodapé: razão social; editável via `textos.rodape`.
- Campos Cond.Pagto/Vendedor/Imposto/Validade/Programação: vêm do orçamento/
  pedido (alguns ainda não existem como coluna — ver P3/P17; por ora usar o que
  há: validade, vendedor; os demais como "a combinar"/configurável).

## Observações importantes
- "Comendador Levy Gasp" é o endereço/bairro da Carton Wega (linha fixa do
  cabeçalho). Tornar configurável no template (um campo de "cidade/linha de
  data") para não ficar hardcoded para outras empresas.
- O "Cálculo nº" é o `numeroCalcgraf` do cálculo de origem (quando o item veio da
  biblioteca/repetição). Já temos esse dado (`calculoOrigem`).
- A tabela multi-item com descrição rica já existe no conceito dos itens do
  orçamento — reusar a descrição consolidada de cada `ItemOrcamentoGrafico`.
