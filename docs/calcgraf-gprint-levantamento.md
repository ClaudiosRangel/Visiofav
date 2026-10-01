# Levantamento Calcgraf / G-Print — Migração Carton Wega → Vizor

Documento vivo. Objetivo: catalogar TUDO que o Calcgraf/G-Print faz (via
relatórios PDF + navegação nos menus por TS, sem acesso à base de dados), para
depois comparar com o que o Vizor já tem pronto (PCP + Orçamento Gráfico +
specs existentes) e montar o plano de ação (specs por bloco).

- **Cliente**: Carton Wega (embalagens de papel/papelão — caixas, cartuchos, cartões).
- **Sistema legado**: Calcgraf / G-Print (fornecedor PHTech; acesso via RDP em `sistemas.phtech.net.br:1551`, versão VL.Mai'16.257).
- **Consultoria de custos**: metodologia **RKW** (WebGraf/Calcgraf), doc `Apresentacao - Consultoria de Custos - Carton Wega_03112023.pdf` (31 páginas).
- **Status**: EM LEVANTAMENTO. Comparativo + plano só após o usuário sinalizar fim.

---

## 1. Mapa de menus do Calcgraf/G-Print (capturado via TS)

- **Vendas** → Orçamento; Cadastros (Materiais, Atividades, Itens Diversos, Produtos, Produção, Fechamento, Custos, Séries, Diversos)
- **Produção** → OP/Pedido (Emissão, Reemissão, Visualização, Cancelamento, Reativação, Efetivar OP Reserva, Crédito, Liberação de Cálculo Recusado por Tempo); Controle de Protocolos; Cadastros
- **Cadastros** → Nomes (Empresa, Vendedores, Contatos, Ordenação de Campos/Perfil, Hierarquia de Comissões, Consultas Empresas, Listagem); Créditos; Unidades; Classificação Fiscal; Moedas; Localidade de Frete; Parâmetros; Feriados
- **Gerencial** → Pré-Impressão; Metas de Venda (Manutenção, Consulta)
- **Sistema**; **Canais de atendimento**; **Fim**

---

## 2. Metodologia RKW (custeio) — conceito

A metodologia **RKW** (Reichskuratorium für Wirtschaftlichkeit) é a base do
custeio: apropria TODOS os custos e despesas (não só os de produção) aos
produtos. Calcgraf a posiciona como a que melhor se aplica a **indústria sob
encomenda** (cada trabalho tem muitas variáveis: formato, dados técnicos, área
de impressão, acabamentos).

**Ciclo RKW no Calcgraf:**
1. **Levantamento do Custo Fixo mensal** da empresa → via **Mapa de Custos**.
2. **Formação do Preço de Venda** (módulo Orçamento).
3. **Apuração dos Resultados**:
   - Cobertura dos Custos Fixos mensais (visão Gerencial).
   - Realização das horas produtivas previstas no mês (PCP / Análise de Produtividade).
   - Comparativo **Previsto × Realizado** = Produtividade e Custos (Pós-Cálculo).

Ideia central: vender **horas de máquina** (custo-hora por centro produtivo) +
materiais. O custo fixo total é rateado nos centros → custo-hora → preço.

---

## 3. Composição de Horas Produtivas / Mês (base padrão de mercado)

Calcgraf usa uma "base padrão" para as horas produtivas mensais de cada centro,
para permitir **benchmarking contra o mercado** (comparar de igual para igual):

| Item | Valor |
|---|---|
| Horas disponíveis no ano (52 semanas × 44h) | 2.288 h/ano |
| (−) 10 feriados anuais (média 8,8 h/dia × 10) | 88 h/ano |
| Sub-total | 2.200 h/ano |
| Horas produtivas mensais = 2.200 ÷ 12 | 183 h/mês |
| (−) Horas improdutivas e ociosas (tempo médio estimado) | 33 h/mês |
| **TOTAL DE HORAS PRODUTIVAS / MÊS (base padrão)** | **150 h/mês** |

Base alternativa citada: 22 dias úteis × turno de 8h = 176; subtraindo
improdutivas médias ≈ **150 h/mês**.

**Regras de negócio (comentários do slide):**
- Base padrão permite comparação com o mercado → competitividade "de igual para igual".
- Ineficiência/motivos que reduzam horas produtivas → custo-hora sobe → preço sobe → menos aprovações. **Ineficiência NÃO deve ser repassada ao mercado; deve ser corrigida internamente.**
- Empresa comprovadamente mais eficiente → refletir isso nos turnos → vantagem competitiva.
- Para cada setor, estudam-se as horas produtivas abatendo o tempo improdutivo (refeição + paradas ocasionais por turno).

---

## 4. Encargos Sociais (tabela padrão CLT)

Percentuais sobre salário, usados no rateio de "Salários + Encargos" do Mapa de
Custos. Duas colunas: **Regime Normal** e **Regime Simples**.

| Encargo | Normal | Simples |
|---|---|---|
| **Mensais** | | |
| INSS empresa (taxa fixa patronal) | 20,00% | — |
| Seguro acidente de trabalho | 2,00% | — |
| Terceiros (Incra, Senai, Salário-educação, etc.) | 5,80% | — |
| FGTS | 8,00% | 8,50% |
| **(1) Total encargos mensais** | **35,80%** | **8,50%** |
| **Anuais** | | |
| 13º Salário + Encargos (1/12 + total enc. mensais) | 11,32% | 9,00% |
| Abono de Férias + Encargos ((1/12)/3 + total enc. mensais) | 3,77% | 3,00% |
| **(2) Total encargos anuais** | **15,09%** | **12,00%** |
| **Provisionados** | | |
| Multa FGTS | 4,60% | 4,60% |
| Auxílio doença e falta justificada | 1,60% | 1,60% |
| Aviso prévio | 2,50% | 2,50% |
| **(3) Total encargos provisionados** | **8,70%** | **8,70%** |
| **TOTAL ENCARGOS SOCIAIS/MÊS (1+2+3)** | **60,00%** | **29,00%** |

→ Carton Wega: **60% de encargos sociais sobre salários** (Regime Normal).

---

## 5. Centros de Custo PRODUTIVOS

Empresa dividida em Centros de Custo Produtivos — são os centros cujas **horas
são vendidas** no sistema de Orçamentos. Atividades manuais e operações pequenas
(difíceis de mensurar/separar) são agrupadas em **Acabamento Geral**.

Campos por centro: **Natureza** (Impressão/Acabamento), **Nome**, **Uso
Orçamento** (Sim/Não), **Unid. Prod.** (nº de unidades/máquinas), **Turnos**,
**B.H.M.** (Base Horas Mês = 150), **+ Horas Extras**, **Horas Produtivas** (total).

| Natureza | Centro | Uso Orç. | Unid.Prod. | Turnos | B.H.M. | +H.Extras | H.Produtivas |
|---|---|---|---|---|---|---|---|
| Impressão | Roland Ultra | Sim | 1 | 1 | 150 | — | 150 |
| Impressão | Sormz - Verniz (Acabamento) | Sim | 1 | 1 | 150 | — | 150 |
| Impressão | Heidelberg SM | Sim | 1 | 1 | 150 | — | 150 |
| Impressão | Heidelberg CD | Sim | 1 | 1 | 150 | 75 | 225 |
| Impressão | KBA 6 cores | Sim | 1 | 1 | 150 | 75 | 225 |
| Acabamento | Corte de Bobina | Sim | 2 | 1 | 150 | — | 300 |
| Acabamento | Coladeiras | Sim | 2 | 1 | 150 | — | 300 |
| Acabamento | Plastificadoras | Sim | 2 | 1 | 150 | — | 300 |
| Acabamento | Vincadeiras/(Corte/Vinco) | Sim | 4 | 1 | 150 | — | 600 |
| Acabamento | Acopladeiras | Sim | 2 | 1 | 150 | — | 300 |
| Acabamento | Acabamento Geral | Sim | 1 | 1 | 150 | — | 150 |

Observações:
- **Horas Produtivas = Unid.Prod. × B.H.M. + Horas Extras** (ex.: Vincadeiras 4×150 = 600; Heidelberg CD 150+75 = 225).
- Bate com o Relatório 1 (Mapa Custos/Hora): as mesmas máquinas e horas (150/225/300/600) aparecem lá.

---

## 6. Centros de Custo AUXILIARES

Apoiam os centros produtivos; suas horas **não são vendidas diretamente**, mas
**rateadas** entre os produtivos por critério próprio de cada um.

| Centro Auxiliar | Rateio | Status |
|---|---|---|
| Fábrica geral | Fábrica | Ativo |
| Corte inicial | Corte Inicial | Ativo |
| Pré-impressão / CTP | Pré-Impressão | Ativo |

Critérios de rateio (comentários):
- **Fábrica Geral**: rateada **igualmente** entre os setores da Produção.
- **Corte Inicial** e **Pré-Impressão/CTP**: rateados **somente entre as Impressoras**.

---

## 7. Cadastro de Bens a Depreciar (Ativo Imobilizado) — por centro

Cada bem é vinculado a um Centro (Produtivo, Auxiliar ou Administração) e gera
**depreciação mensal**, que entra no rateio do custo fixo daquele centro.

Campos por bem: **Grupo** (Veículos / Informática outros / Impressoras /
Acabamento autom. / Acabamento manual), **Bem a Depreciar** (descrição),
**Valor**, **Estado** (Ótimo/Bom/Regular), **Anos** (vida útil), **Residual %**
(valor residual), **Depreciação** (mensal calculada), **Status**.

> Regra explícita no slide: **"O valor e o estado dos bens determinam o cálculo
> da depreciação mensal."** (estado afeta o cálculo — provável ajuste de vida
> útil/residual por estado). Depreciação mensal ≈ (Valor − Residual) ÷ (Anos×12),
> modulada pelo estado.

Exemplos capturados (Valor / Anos / Residual / Depreciação mensal):
- **Aux. Fábrica geral** (7 itens, total 623.600, deprec. 4.550,00): caminhões 3/4, Ford Cargo Sayder, Ford Cargo toco, Kpi, Fiorino (Veículos, 5 anos, 60% residual); computadores expedição/produção (Informática, 3 anos).
- **Aux. Corte inicial** (2 itens, 90.000, deprec. 506,25): Guilhotina Polar 150, Guilhotina Tiger 130 DX (10 anos, 30–35% residual).
- **Aux. Pré-impressão/CTP** (5 itens, 169.000, deprec. 2.654,17): 4 computadores, CTP Screen (65.000, manual, 10 anos), Epson Stylus, Plotter de Recorte, Servidor.
- **Roland Ultra** (1 item, 50.000, deprec. 270,83; 10 anos, 35% res.).
- **Sormz-Verniz** (1, 85.000, 460,42).
- **Heidelberg SM** (200.000, 1.083,33), **CD** (800.000, 4.333,33), **KBA 6 cores** (1.650.000, 40% res., 8.250,00).
- **Corte de Bobina** (2: Cortadeira Dellmark 65.000, Cortadeira Makpel 125.000; deprec. 1.056,25).
- **Coladeiras** (2: Coladeira AFT 70 205.000, Bobst Media 68 250.000; deprec. 2.464,58).
- **Plastificadoras** (2: 80cm 15.000, 60cm 12.000; deprec. 146,25).
- **Vincadeiras/(Corte/Vinco)** (4: Bobst E 680.000, Bobst S 450.000, Vinco Feva 85.000, Vinco Hot 90.000; deprec. 7.256,25).
- **Acopladeiras** (2: Acopladeira Jato 14.000, semi-automática 85.000 40% res.; deprec. 506,67).
- **Acabamento Geral** (1: Máquina de Destaque 3.000; deprec. 16,25).
- **Administração** (8 itens, 53.600, deprec. 1.488,89): computadores Comercial, Compras, Financeiro (+8 monitores), Notebook, Orçamento, Portaria e Câmeras, RH, Servidor Principal VPS (todos Informática, 3 anos).

**TOTAL GERAL Ativo Imobilizado: R$ 5.800.200,00 → Depreciação mensal R$ 34.043,47**
(bate com o rodapé do R1: "Depreciação Mensal 35.043,47" — pequena divergência de arredondamento entre slides; confirmar valor exato).

Nota: existe também um centro **"Administração"** (além dos produtivos e
auxiliares) — só com bens de informática. Provavelmente entra na Taxa
Administrativa (31,7% no R1), não no rateio produtivo direto.

---

## 8. Cadastro de Funcionários — por centro

Cada funcionário vinculado a um Centro (Produtivo/Auxiliar), com **Cargo**,
**Salário**, **A.C.** (Adicional/Complemento? — coluna com valores tipo 628,00 /
218,00 / 168,00 / 698,00 em alguns; confirmar significado — provável adicional
como insalubridade/periculosidade ou comissão), **Observações**. O somatório de
salários por centro alimenta "Salários + Encargos" (× 60% encargos) no rateio.

Total funcionários: **107** (bate com R1). Distribuição capturada:
- **Aux. Fábrica geral**: 24 func. (motoristas, supervisor PCP, analistas PCP, operadores, auxiliares limpeza, apontador produção, almoxarife, eletricista, técnico mecânica, conferente, supervisor qualidade, inspetores qualidade, etc.) — total salários 55.819,10.
- **Aux. Corte inicial**: 3 func. (operador guilhotina, aux. produção, operador máquina de cortar) — 6.591,37.
- **Aux. Pré-impressão/CTP**: 4 func. (analistas pré-impressão, arte finalista) — 12.705,48 (A.C. 628,00).
- **Roland Ultra**: 0 func. diretos vinculados.
- **Sormz-Verniz**: 2 (operador acabamento, aux. produção) — 3.401,06.
- **Heidelberg SM**: 0 func. diretos.
- **Heidelberg CD**: 3 (2 impressores, aux. produção) — 10.753,40 (A.C. 698,00).
- **KBA 6 cores**: 2 (impressor produção sr, impressor offset) — 7.152,38.
- **Corte de Bobina**: 2 (aux. produção, operador máquina cortar) — 3.547,91.
- **Coladeiras**: 9 (auxiliares/operadores de colar) — 20.799,64 (A.C. 218,00).
- **Plastificadoras**: 5 — 8.345,10.
- **Vincadeiras/(Corte/Vinco)**: 7 (operadores corte e vinco, auxiliares) — 19.056,13 (A.C. 168,00).
- **Acopladeiras**: 3 (operador acabamento, auxiliares) — (parcial na imagem).

Observação importante: centros de **Impressão sem funcionário direto** (Roland,
Heidelberg SM) recebem mão de obra via rateio dos auxiliares — o custo-hora
deles vem majoritariamente de depreciação + rateio (Fábrica Geral, Corte
Inicial, Pré-Impressão) e despesas, não de salário direto.

Mais centros com funcionários (lote 3):
- **Acabamento Geral**: 30 func. (aux. produção majoritariamente) — total 43.484,67 (A.C. 218,00).
- **Administração**: 11 func. (orçamentista, coordenadora RH, assistentes RH, comercial, estagiário, compras, assistente fiscal, assistente administrativo) — total 27.941,52 (A.C. 3.000,00).

### 8.1 Coluna "A.C." = **Ajuda de Custo** (esclarecido no lote 3)

O totalizador geral confirma: **A.C. = "Ajuda de Custo"**, somada à folha por
fora dos encargos. Fechamento geral da folha:

| Item | Valor |
|---|---|
| Total de Funcionários | **111** (107 diretos + rateados; ver 8.2) |
| Salários | R$ 245.782,88 |
| Encargos sob salários (60%) | R$ 147.469,60 |
| Ajuda de Custo | R$ 6.898,00 |
| **Custo total folha de pagamento** | **R$ 400.150,78** |

> Fórmula da folha: `Custo Folha = Salários + (Salários × 60%) + Ajuda de Custo`.
> A Ajuda de Custo **não** sofre os 60% de encargos (entra por fora).
> Atenção: aqui o total de funcionários é **111** (não 107 do R1) — a diferença
> são os funcionários rateados/gestão adicionados. Reconciliar no fim.

### 8.2 Funcionários RATEADOS (chave de rateio entre centros)

Alguns funcionários não pertencem a um único centro — são distribuídos entre
vários por **Chave de Rateio** + **Percentual**. É o mesmo mecanismo dos centros
auxiliares, mas aplicado a pessoas específicas. Grupo "Funcionários Rateados":
- Fabio Eduardo Vidal Silva (impressor offset PL2, 4.635,10, A.C. 218)
- Higor Lopes de Melo (aux. produção JR01, 1.388,39)
- Thiago Bordim (Gestão de Produção, 11.500,00, A.C. 1.750,00)
- Subtotal rateados: 3 func., 17.523,49 salário, 1.968,00 A.C.

Exemplos de distribuição por chave de rateio:
- **Thiago Bordim (Gerente Produção)**: chave 1 em cada um dos 13 centros
  produtivos → **7,69% cada** (1/13), TOTAL 100%. (rateio igualitário entre os 13).
- **Fabio Eduardo Vidal Silva (uso exclusivo)**: Roland Ultra 50 / Heidelberg SM
  50 → **50%/50%** (só entre esses 2 centros, justamente os que não têm
  operador direto).
- **Higor Lopes de Melo (uso exclusivo)**: Roland Ultra 50% / Heidelberg SM 50%.

> A "Chave de Rateio" é um PESO (número), não a % direta: o percentual é
> calculado = peso do centro ÷ soma dos pesos. Ex.: 1 e 1 → 50%/50%; treze "1"
> → 7,69% cada. Isso explica por que Roland/Heidelberg SM (sem func. direto)
> ainda têm mão de obra: recebem operadores rateados 50/50.

---

## 9. Despesas mensais (rateáveis no custo fixo)

Lista de despesas mensais da empresa com **Valor**, **Participação %** e
**% Acumulado** (ordenada desc — análise de Pareto). Total **R$ 321.982,98**
(bate com "Despesas Mensais 43,1%" do R1).

| Despesa | Valor | Part.% | Acum.% |
|---|---|---|---|
| Manutenção de Máquinas | 72.080,63 | 22,39% | 22,39% |
| Despesas com Pessoal | 59.171,19 | 18,38% | 40,76% |
| Despesas com Manutenção (geral) - exceto máquinas | 45.000,00 | 13,98% | 54,74% |
| Despesas com Veículos (Combustível/Pedágios/manut.) | 38.270,00 | 11,89% | 66,63% |
| Honorários Diretoria | 30.000,00 | 9,32% | 75,94% |
| Energia Elétrica | 23.477,90 | 7,29% | 83,23% |
| Honorários Profissionais | 13.000,00 | 4,04% | 87,27% |
| Aluguel e IPTU | 8.200,00 | 2,55% | 89,82% |
| Manutenção Predial | 7.000,00 | 2,17% | 91,99% |
| Honorários esporádicos | 6.310,00 | 1,96% | 93,95% |
| Seguro Imóvel/Equipamentos/Veículos | 5.066,00 | 1,57% | 95,53% |
| Material de Limpeza e Copa | 3.471,10 | 1,08% | 96,60% |
| Despesas Bancárias | 3.100,00 | 0,96% | 97,57% |
| Propagandas e Brindes | 2.800,94 | 0,87% | 98,44% |
| Comunicação (fone/internet) | 2.200,00 | 0,68% | 99,12% |
| Treinamentos e Consultorias | 1.000,00 | 0,31% | 99,43% |
| Suprimentos Administração | 935,22 | 0,29% | 99,72% |
| Associações de Classe | 500,00 | 0,16% | 99,88% |
| Água e Esgoto | 400,00 | 0,12% | 100,00% |
| Outras | 0,00 | — | — |
| **Total** | **321.982,98** | | |

Regras (comentários):
- As **9 maiores despesas = 91,99%** do total (foco de revisão).
- **Empréstimos NÃO entram** no Mapa de Custos.
- **Rateio de despesas por área ocupada (m²) NÃO foi feito** por falta da
  informação de área por setor → oportunidade de refino no próximo mapa (ratear
  por m² por centro + consumo por centro). Hoje o rateio de despesas é por
  critério simplificado.
- Há também um **gráfico de pizza** das despesas (mesmos valores, visual).

---

## 10. Distribuição do Custo Fixo por Centro (resultado do rateio)

Resultado consolidado do rateio: cada centro recebe sua parcela do custo fixo
(salários+encargos+ajuda de custo do centro + depreciação do centro + despesas
rateadas + rateio dos auxiliares recebidos). Colunas: **Valor** e **Percentual**.

| Centro de Custo | Valor | % |
|---|---|---|
| Administração | 245.429,93 | 32,4% |
| Fábrica geral | 108.332,10 | 14,3% |
| Acabamento Geral | 87.501,22 | 11,6% |
| Vincadeiras/(Corte/Vinco) | 43.262,07 | 5,7% |
| Coladeiras | 42.383,38 | 5,6% |
| Pré-impressão / CTP | 25.757,65 | 3,4% |
| Heidelberg CD | 25.438,09 | 3,4% |
| KBA 6 cores | 22.374,45 | 3,0% |
| Acopladeiras | 20.760,62 | 2,7% |
| Plastificadoras | 17.773,08 | 2,3% |
| Corte inicial | 12.653,76 | 1,7% |
| Corte de Bobina | 9.397,54 | 1,2% |
| Sormz - Verniz (Acabamento) | 8.566,74 | 1,1% |
| Heidelberg SM | 8.139,08 | 1,1% |
| Roland Ultra | 7.326,58 | 1,0% |
| **Totais** | **685.096,30** | **90,5%** |

Nota: este total (685.096,30) é ANTES do 2º nível de rateio (Administração,
Fábrica Geral, Corte Inicial, Pré-Impressão ainda aparecem como linha própria —
depois eles se distribuem nos produtivos, produzindo o custo-hora final do R1).
Comentário: distribuição "bem equilibrada", mas recomenda-se rever no próximo
mapa os rateios de despesas por área ocupada e consumo por centro.

**Fluxo de custeio consolidado (do que já vimos):**
```
Salários por centro ─┐
  × (1 + 60% encargos)│
  + Ajuda de Custo    ├─► Custo de MO por centro
Depreciação por centro│
  (Valor,Estado,Anos, ├─► Custo de depreciação por centro
   Residual)          │
Despesas mensais      ├─► rateadas por centro (hoje critério simplificado)
Funcionários rateados ┘   (chave de rateio → % por centro)
        │
        ▼
Distribuição do Custo Fixo por centro (§10)  ── 1º nível
        │  (rateio dos auxiliares/administração → produtivos)
        ▼
Custo Total Apurado por centro produtivo (R1)  ── 2º nível
        ÷ Horas Produtivas (§3, §5)
        ▼
CUSTO/HORA por centro → base do Orçamento (preço de venda)
```

---

## 11. Composição dos Custos Hora — a planilha-mestre (2º nível de rateio)

Esta é a planilha central que amarra tudo (relatório WebGraf "Mapa de
Localização de Custos — Composição do Custo/Hora"). Mostra, linha a linha por
centro, como se chega ao Custo/Hora. Estrutura de colunas:

| Col | Nome | Fórmula |
|---|---|---|
| A | Salários + Encargos | folha do centro (salário × 1,60 + ajuda de custo) |
| B | Depreciações | depreciação mensal dos bens do centro |
| C | Despesas | despesas rateadas ao centro |
| D | **Custo Fixo** | **= A + B + C** |
| E | Rateio Centros Custo → **Auxiliar** | parcela dos auxiliares recebida pelo centro |
| F | Rateio Centros Custo → **Administração** | parcela da administração recebida pelo centro |
| G | **Custo Fixo Final** | **= D + E + F** |
| H | Horas Produtivas | do cadastro do centro |
| — | **Custo/Hora A Praticar** | **= G ÷ H** |

Agrupamento em 3 naturezas: **ADM** (Administração), **AUXILIAR** (Fábrica
geral, Corte inicial, Pré-impressão/CTP) e **PRODUTIVO** (as 11 máquinas).

Valores capturados (D = Custo Fixo | E = Aux | F = Adm | G = Final | H = horas | Custo/Hora):
- **ADM Administração**: A 47.706,43 | B 1.488,89 | C 196.234,61 | D 245.429,93 (não vai para H — é distribuída via col F aos produtivos, aparece negativa no Acabamento Geral p/ fechar).
- **AUX Fábrica geral**: D 108.332,10; **Corte inicial**: D 12.653,76; **Pré-impressão/CTP**: D 25.757,65 (distribuídos via col E).
- **Roland Ultra**: D 7.326,58 | E 19.451,22 | F 22.349,75 | **G 49.127,55** | H 150 | **327,52**
- **Sormz-Verniz**: D 8.566,74 | E 9.848,37 | F 15.369,94 | G 33.785,05 | 150 | 225,23
- **Heidelberg SM**: D 8.139,08 | E 19.451,22 | F 23.027,89 | G 50.618,19 | 150 | 337,45
- **Heidelberg CD**: D 25.438,09 | E 19.451,22 | F 37.466,28 | G 82.355,59 | 225 | 366,02
- **KBA 6 cores**: D 22.374,45 | E 19.451,22 | F 34.909,25 | G 76.734,92 | 225 | 341,04
- **Corte de Bobina**: D 9.397,54 | E 9.848,37 | F 16.063,35 | G 35.309,26 | 300 | 117,70
- **Coladeiras**: D 42.383,38 | E 9.848,37 | F 43.594,55 | G 95.826,31 | 300 | 319,42
- **Plastificadoras**: D 17.773,08 | E 9.848,37 | F 23.053,88 | G 50.675,34 | 300 | 168,92
- **Vincadeiras/(Corte/Vinco)**: D 43.262,07 | E 9.848,37 | F 44.327,94 | G 97.438,39 | 600 | 162,40
- **Acopladeiras**: D 20.760,62 | E 9.848,37 | F 25.547,40 | G 56.156,39 | 300 | 187,19
- **Acabamento Geral**: D 87.501,22 | E 9.848,37 | F **−74.849,60** | G 22.500,00 | 150 | 150,00
- **Totais**: A 400.150,48 | B 35.043,47 | C 321.982,98 | (Custo Fixo total) 757.176,93

Observações CRÍTICAS:
- O **rateio Auxiliar (E)** confirma §6: impressoras recebem valores maiores
  (19.451,22 — recebem Corte Inicial + Pré-Impressão); acabamentos recebem
  9.848,37 (só Fábrica Geral). Roland/Heidelberg SM/CD/KBA = 19.451,22
  (impressoras); demais = 9.848,37.
- O **Acabamento Geral tem col F negativa (−74.849,60)** — é a conta de
  fechamento/ajuste que faz o rateio da Administração bater 100% (a
  Administração 245.429,93 é redistribuída; o Acabamento Geral absorve o
  resíduo negativo para o custo-hora dele fechar em 150,00 "A Praticar", que é
  um valor-alvo definido, não puramente calculado — ver §12 sobre ajustes).
- **Custo Fixo total 757.176,93** (aqui) vs 685.096,30 (§10, antes do 2º nível)
  vs 747.572,02 (R1). As diferenças são versões/datas do mapa + níveis de
  rateio. Reconciliar exatamente no fim; conceito está claro.

---

## 12. Custo Total Apurado × Custo a Praticar (com AJUSTES) e Resultado Apurado

Dois relatórios que comparam três "custos-hora" por centro e aplicam ajustes:

### Colunas
- **Custo/Hora A Praticar**: o alvo calculado do mapa (col do §11).
- **Custo Apurado — Custo/Hora + Ajuste %**: o custo real apurado e o % de
  ajuste aplicado para equiparar (quase todos **24,0%**; Acabamento Geral
  **−84,4%**).
- **Custo Praticado — Custo/Hora + Variação %**: o que estava efetivamente
  sendo praticado e a variação vs a praticar.

### "Custo Total Apurado e Custo a Praticar" (valores)
| Centro | A Praticar | Apurado Custo/Hora | Ajuste | Praticado Custo/Hora | Variação |
|---|---|---|---|---|---|
| Roland Ultra | 327,52 | 264,13 | 24,0% | 254,73 | 28,6% |
| Sormz-Verniz | 225,23 | 181,65 | 24,0% | 271,43 | −17,0% |
| Heidelberg SM | 337,45 | 272,15 | 24,0% | 289,61 | 16,5% |
| Heidelberg CD | 366,02 | 295,19 | 24,0% | 543,64 | −32,7% |
| KBA 6 cores | 341,04 | 275,04 | 24,0% | 678,76 | −49,8% |
| Corte de Bobina | 117,70 | 94,92 | 24,0% | 209,64 | −43,9% |
| Coladeiras | 319,42 | 257,61 | 24,0% | 528,46 | −39,6% |
| Plastificadoras | 168,92 | 136,23 | 24,0% | 247,22 | −31,7% |
| Vincadeiras | 162,40 | 130,97 | 24,0% | 695,72 | −76,7% |
| Acopladeiras | 187,19 | 150,96 | 24,0% | 285,14 | −34,4% |
| Acabamento Geral | 150,00 | 960,25 | −84,4% | 811,15 | −81,5% |

> Regra: **Custo/Hora A Praticar = Custo/Hora Apurado × (1 + Ajuste%)**. Ex.:
> 264,13 × 1,24 = 327,52. O ajuste de 24% "empurra" o apurado para o praticar,
> gerando um custo-hora mais competitivo/equivalente e menos distorção nos
> orçamentos. O **Acabamento Geral** é a exceção (ajuste NEGATIVO −84,4%),
> porque o custo-hora apurado dele (960,25) está inflado pelo resíduo da
> Administração — o A Praticar é fixado em 150,00 (valor-alvo). Comentário do
> slide: "Deve ser considerado o Custo/Hora **a praticar**".

### "Custo Fixo Apurado" (rodapé, versão desta data)
| | Valor | % |
|---|---|---|
| Salários + Encargos | 400.150,48 | 52,8% |
| Depreciações | 35.043,47 | 4,6% |
| Despesas | 321.982,98 | 42,5% |
| **Total Geral** | **757.176,93** | **100%** |
- Taxa Administrativa: **48%** · Total Funcionários: **111** · Ativo Imobilizado: R$ 5.800.200,00 · Encargos Sociais: R$ 147.469,60.

> Comentário estratégico: **Taxa Administrativa 48%** vs referência de mercado
> 30–40% → a empresa tem **investimento em Administração acima do ideal** (mais
> peso em ADM do que em Produção). Recomenda-se reavaliar a taxa administrativa
> e os rateios no próximo mapa. Isso é output de CONSULTORIA (diagnóstico), não
> só cálculo — o sistema calcula a taxa administrativa (% do custo fixo que é
> Administração) e permite comparar com benchmark.

### "Resultado Apurado" (a mesma tabela do R1, versão desta data)
Confirma o R1: Custo Total Apurado, Horas Produtivas, Custo/Hora Apurado,
A Praticar, Total A Praticar, Praticado, Apurado × A Praticar (24,0% geral,
−84,4% Acabamento Geral). Custo Fixo 650.527,00 / 650.797,00 nesta versão
(116,4%). Há uma variante colorida (amarelo = A Praticar Ajustado) da mesma
tabela.

### Gráfico Distribuição do Custo Fixo (pizza)
Mesmos % do §10 (Administração 32,4%, Fábrica geral 14,3%, etc.). Custo Fixo
Total = R$ 685.098,30 (rótulo do gráfico).

---

## 13. Equivalência de custos-hora (por que ajustar)

Gráfico "Custos Apurados × Custos A Praticar (Ajustado)" por centro. Regra de
negócio explícita:
> "Para que as simulações de Orçamentos não sigam a tendência de escolher
> sempre a máquina mais barata, realizamos a **equivalência dos custos-hora**,
> assim a escolha será pelas **características técnicas** (não pelo preço)."

Ou seja, o ajuste de 24% (§12) serve para nivelar os custos-hora entre máquinas
concorrentes, evitando que o orçamentista/algoritmo sempre roteie para a máquina
de menor custo-hora. Simulações e validações (custos anteriores × novos) são
imprescindíveis antes de fechar.

---

## 14. Contribuição Marginal (análise dos orçamentos)

Conceito (fundamental para o Orçamento e o Gerencial):
> Contribuição Marginal (CM) = % de cada trabalho correspondente a **Custo de
> Transformação + Lucro projetado** no orçamento.

**Formação do Preço de Venda (fórmula-mestre do orçamento):**
```
Preço de Venda = Materiais + Custos de Transformação + Serviços Externos  (= Custo de Produção)
                 + CEV (Custos de Venda)
                 + Margem de Lucro
```
- **Custo de Transformação** = horas de máquina × custo-hora (o motor de custeio §1–§13 entra aqui).
- **Materiais** = papel/tinta/verniz/cola/faca (consumo).
- **Serviços externos** = terceirização (ex.: acabamento fora).
- **CEV** = custos de venda (comissão, impostos, frete?).
- **Margem de Lucro** = markup.

**Relatório "Contribuição Marginal"** (período 01/06/2023 a Fim):
Lista orçamentos por Data, Cliente Principal, Tipo de Produto, Descrição,
Tiragem, Valor Total, Margem, C.Marginal, Vendedor, Cálculo|Proposta.
Totalizadores capturados:
- Qtde Cálculos: 50 · Total Orçado: R$ 3.051.137,54 · Margem Média Orçada: 18,72% · **C.Marginal Média Orçada: 35,91%**.
- Qtde O.P./Ped.: 1/1 · Total Fechado: 56.492,52 · Margem Média OP/Ped: 20,00% · C.Marginal Média OP/Ped: 27,96%.
- Aproveitamento Qtde: 2,00% · Aproveitamento Valor: 1,85% (taxa de conversão orçamento→pedido).

> **CM Média Orçada 35,91%** é o número-âncora usado no ponto de equilíbrio (§16).
> "Aproveitamento" = taxa de fechamento (quantos orçamentos viram pedido) — em
> qtde e em valor.

---

## 15. Contribuição Marginal — Simulação de faturamento (Gerencial)

Cruza o faturamento real (jan–ago/2023) com a CM média projetada (35,91%) e o
custo fixo do mapa, para simular se cada mês cobriu o custo fixo. Colunas:
- **Dados Reais**: Mês, Valor Faturamento, Contribuição Marginal R$ (= Fat × 35,91%).
- **Projeção**: CM % (35,91% fixa).
- **Estudo (Mapa de Custos Out/2023)**: Custo Fixo (757.176,93), Faturamento
  projetado para cobrir custo fixo (= Custo Fixo ÷ CM% = **R$ 2.108.540,60**),
  Diferença (faturamento − meta).
- **Resultado simulado jan–ago**: −R$ 235.587,30.

Exemplos de meses (Faturamento / CM R$ / Diferença p/ cobrir custo fixo):
- jan-23: 2.882.067,13 / 1.034.950,31 / +773.526,53
- fev-23: 1.857.607,22 / 667.066,75 / −250.933,38
- mar-23: 1.855.675,37 / 666.372,03 / −252.865,23
- abr-23: 1.594.437,69 / 572.584,12 / −514.042,91
- mai-23: 1.929.840,32 / 693.006,74 / −178.697,29
- jun-23: 2.176.378,84 / 781.537,64 / +67.838,24
- jul-23: 1.751.116,63 / 628.826,72 / −357.421,91
- ago-23: 2.585.549,25 / 928.470,74 / +477.008,65
- **Médias**: Faturamento 2.079.092,19 / CM 746.602,00.

> Insight do slide: com custo fixo de 757.176,93 e CM 35,91%, o faturamento
> **não cobriu o custo fixo** em fev/mar/abr/mai/jul. Estudo preliminar; precisa
> acompanhar com dados reais mês a mês (módulos **Faturamento** + **Gerencial**).
> Inclui gráfico de linhas (Faturamento vs CM% ao longo dos meses).

---

## 16. Simulação Ponto de Equilíbrio (Break-Even)

"Demonstrativo — Cobertura do Custo Fixo". A partir da CM média, calcula a meta
de faturamento/mês para pagar o custo fixo (break-even).

| Item | Valor |
|---|---|
| (A) Salários + Encargos | 400.150,48 |
| (B) Despesas Mensais | 321.982,98 |
| (C) Depreciação Mensal | 35.043,47 |
| **Custo Fixo** | **R$ 757.176,93** |
| CM média últimos 6 meses | 35,91% |
| **Meta de Faturamento Bruto (mensal)** | **R$ 2.108.540,60** (= 757.176,93 ÷ 0,3591) |
| Meta de Faturamento Líquida (sem depreciações) | R$ 2.073.497,13 |
| Média de Faturamento Mensal últimos 6 meses | R$ 2.079.092,19 |
| **Resultado → Diferença (Meta / Média)** | **−R$ 29.448,41** (não cobriu) |
| Lucro Bruto realizado | R$ 0,00 (não houve) |

> Regras: **Ponto de Equilíbrio = Custo Fixo ÷ CM%**. A **Margem de Lucro só é
> obtida DEPOIS de pagar o Custo Fixo mensal**. Meta líquida = sem depreciação
> (que não é desembolso caixa). Recomenda uso dos módulos Faturamento + Gerencial
> para acompanhamento mensal Custo Fixo × CM × Cobertura.

---

## 17. DRE Contábil (confronto)

DRE contábil real da Carton Wega (1245 - CARTON WEGA INDUSTRIA DE EMBALAGENS SA,
CNPJ 23.787.041/0001-75), período 01/01/2022–31/12/2022:
- **Lucro Líquido do Exercício 2022 = R$ 1.683.359,86** → ÷12 = R$ 140.279,98/mês.

> Uso: confrontar o resultado gerencial (Custos × Gerencial × Faturamento) com o
> DRE contábil real, validando o modelo de custeio contra a contabilidade.
> Implica integração/importação do DRE contábil para comparação.

---

## Relatórios catalogados (índice)

- **R1 — Mapa de Localização de Custos / Custos-Hora** (pág. 1 do arquivo, WebGraf). Motor de custeio por centro: Custo Total Apurado, Horas Produtivas, Custo/Hora (Apurado / A Praticar / Praticado), Custo Total A Praticar, desvio Apurado×A Praticar. Rodapé: Custo Fixo R$ 747.572,02 (Salários+Encargos 52,2% / Despesas 43,1% / Depreciação 4,7%), Taxa Administrativa 31,7%, 107 funcionários, Encargos Sociais R$ 143.867,76, Ativo Imobilizado R$ 5.800.200,00.
- Slides conceituais 1–5 (RKW, Horas Produtivas, Encargos Sociais, Centros Produtivos, Centros Auxiliares) → seções 2–6 acima.

## 18. Encerramento do PDF de consultoria (sem funcionalidade nova)

Últimas páginas: recomendações finais e contracapa.
- "Estudo do impacto do novo cenário de custos": treinamento no software de
  Custos; simular orçamentos com os novos custos para apurar custo × receita;
  após alguns meses, nova consultoria; oferta de acompanhamento no módulo Gerencial.
- Contracapa: Consultoria de Custos Carton Wega, Novembro/2023. Contato:
  Leandro Tripodoro, Gerente de Negócios Calcgraf, 11 3885-0500.

→ **PDF de consultoria (31 págs) 100% catalogado** (§§2–18).

---

## Arquitetura da suíte Calcgraf/PHTech (módulos separados)

O Calcgraf/PHTech é uma **suíte modular** (vários executáveis), não um app único.
Módulos oficiais (calcgraf.com.br/solucoes) e correspondência com os ícones do
desktop do cliente (RDP sistemas.phtech.net.br:1551):

| Ícone desktop | Módulo | Função |
|---|---|---|
| Calcgraf (barra) | **Orçamento** | elaboração de orçamentos de impressos gráficos |
| Ficha Técnica (barra) | **Ficha Técnica** | especificações técnicas de produtos recorrentes |
| G_gprint / GPrint | **G-Print / PCP / Pedido** | emissão de OP, PCP, pedidos (o PDF que o Vizor já parseia) |
| GCad | **GCad** | imbricação/imposição de cartuchos (melhor aproveitamento de MP) |
| GE | Gestão/Estoque (a confirmar) | — |
| Gerencial | **Painel de Controle / Análises** | ponto de equilíbrio, cobertura custo fixo por CM, metas, faturamento |
| GPrint_Co | **Compras** | — |
| GPrint_Est | **Estoque** | — |
| GPrint_Fic | **Ficha Técnica** | — |
| Financeiro | **Financeiro** | contas, fluxo de caixa |
| WKRadar7 | integração externa (WK) | — |

Outros módulos da suíte (site): Laudo Técnico, WMS, Faturamento (NF-e/NFS-e),
Comissões, SPED/Bloco K, CC-e/MDF-e, SINTEGRA, RECOPI, **Pós-cálculo**, CRM,
**Análise Comercial**, **Análise de Produtividade**, Painel de Controle, G-Link
(portal web cliente), NetCalc (versão SaaS PME).

### ⚠️ ONDE FICA O MAPA DE CUSTOS (Bloco A) — descoberta importante
Os relatórios do Mapa de Localização de Custos (§7–§13, RI-1..RI-6) têm o logo
**`web graf`** (WebGraf), NÃO Calcgraf. O site confirma: área do cliente →
**webgraf.com.br**. O **Mapa de Localização de Custos (MLC)** é um sistema/serviço
do **WebGraf**, e no caso da Carton Wega foi entregue via **Consultoria de Custos**
(doc nov/2023). Passo a passo oficial do MLC (calcgraf.com.br/como-fazer-o-seu-mapa-de-custo)
confirma exatamente os 10 passos que deduzimos:
1. Dividir empresa em centros (auxiliares/produtivos/administrativos).
2. Lançar funcionários por centro.
3. Somar salários por centro + 60% encargos.
4. Depreciação mensal por centro.
5. Lançar despesas rateando por centro.
6. Somar despesas por centro (incl. depreciação).
7. Custo fixo por centro = salários+encargos + despesas.
8. Distribuir auxiliares + administrativos → produtivos (rateio).
9. Definir horas produtivas/mês por centro produtivo.
10. Custo/Hora = (Custo Fixo + Rateios) ÷ Horas Produtivas.

**Implicação para o Bloco A:** os cadastros de custo (bens/funcionários/despesas/
rateios) podem NÃO estar no Calcgraf desktop que o cliente acessa — podem estar
no WebGraf (web) ou terem sido mantidos pela consultoria. Confirmar com o usuário
onde estão editáveis: (a) no WebGraf web (login próprio), (b) num módulo do
desktop (procurar "Gerencial" ou menu de Custos), ou (c) só planilha da consultoria.

### DUAS CAMADAS DE CÁLCULO — distinção crítica (confirmada em 08/11/24)

Menu do módulo **Gerencial** (desktop g-print VL.Jan/17.38): Analisador,
Informações Gerenciais (Carteira de Pedidos, Faturamento x Vendas x Carteira,
Painel de Controle), Parâmetros, Sistema, Fim. → É **consumo/leitura**, NÃO tem
cadastro de bens/depreciação/funcionários/despesas/rateios. Confirma que o Mapa
de Custos NÃO é editado no desktop.

Existem **duas camadas de cálculo distintas** no ecossistema Calcgraf:

1. **Cálculo do MAPA DE CUSTOS (RKW)** → produz o *custo-hora por máquina*.
   Estratégico/mensal. Feito no **WebGraf/Consultoria** (logo web graf). Entregue
   à Carton Wega como CONSULTORIA (nov/2023), provavelmente não como tela viva.
2. **Cálculo do ORÇAMENTO/OP** → usa o custo-hora (insumo) + imposição/consumo/
   tempos para chegar ao *preço de um trabalho*. Operacional/diário. Feito no
   **G-Print desktop (Delphi)** — é o que a Carton Wega usa para gerar OP e é o
   PDF que o Vizor já parseia.

**Hipótese do usuário (a confirmar):** o cliente recebeu a proposta/consultoria
da versão WEB (Mapa de Custos WebGraf), mas OPERA a geração de OP pelo DESKTOP
Delphi (G-Print) — e o cálculo do desktop é OUTRO (consome custo-hora fixo
cadastrado, não recalcula o mapa).

**Verificações pendentes no sistema (para fechar):**
- V1: em Vendas → Cadastros → Custos (ou cadastro de máquinas/centros do
  desktop), existe campo "custo/hora" DIGITÁVEL por máquina? (se sim → desktop
  só consome o nº da consultoria).
- V2: tela de detalhamento do cálculo de um Orçamento no G-Print (como chega ao
  preço: horas por máquina, consumo papel/tinta) — esse é o motor a replicar.
- V3 (pergunta ao usuário): ao orçar hoje, o G-Print calcula o preço sozinho a
  partir das medidas, ou alguém calcula por fora e lança o valor?

**Impacto no plano de ação:**
- Se o custo-hora é fixo cadastrado no desktop → o GAP 1 (Motor RKW) vira um
  DIFERENCIAL do Vizor (o cliente ganha uma tela viva de Mapa de Custos que hoje
  depende de consultoria paga externa), não uma paridade obrigatória para migrar.
- O que é OBRIGATÓRIO para migrar = replicar o **cálculo de orçamento/OP do
  desktop** (camada 2), que o módulo Orçamento Gráfico do Vizor JÁ tem em boa
  parte. Validar aderência campo a campo (V2).

### ✅ CONFIRMADO (V1) — Tabelas de Custo → Valores (tela "Tabelas de Custo - Detalhes")

Tese confirmada. A tela de cadastro de custos do G-Print desktop:
- **Tabela de Custo**: "Padrão" (suporta múltiplas tabelas de preço).
- **Origem** (categorias de custo, dropdown): **CENTRO DE CUSTO**, MAT. ACABAMENTO,
  MATRIZ IMPRESSÃO, PRÉ-IMPRESSÃO, **SERVIÇO EXTERNO**, SUPORTE, TINTA.
  → São os componentes da formação de preço (camada 2). Confirma "Serviço Externo"
  (terceirização) como categoria própria (faltava no §14).
- **Colunas**: "Default" (as Colunas = variações de preço/tabela).
- Grid: **Descrição** (máquina/item: AFT70 Coladeira, Bobst 68 Coladeira, Bobst E
  Corte e Vinco, Cortadeira Grande/Pequena, CVM/CVMR Corte e Vinco, Dayuan,
  Destacar, Diana Coladeira, etc.) | **Un. = H (HORA)** | Valor (custo-hora) |
  **Valor Administração** | **Valor Outros** | **Últ. Alteração** (data).
- Valores-hora reais: Bobst 68 Coladeira 231,06; Bobst E Corte e Vinco 100,00;
  Cortadeira Grande 113,21; Cortadeira Pequena 113,21; CVM 86,27; Diana 231,06;
  Destacar 50,00; itens manuais (Botão de pressão, Colar envelopes, Colocação de
  alça/ilhós/velcro) 15,00; etc. Colagem acetato 0,06.
- **Valor Administração / Valor Outros** = "Não Definido" na maioria (são as
  parcelas de rateio adm/outros do Mapa de Custos, guardadas como VALOR, não
  recalculadas).
- Rodapé: **Sub-Coluna** + **% para Aplicação** (permite aplicar % sobre o valor).

**PROVAS:**
1. Unidade **H (hora)** + valor-hora **digitável por máquina** com **data de última
   alteração** → são valores FIXOS cadastrados, não recalculados por rateio no
   desktop.
2. Colunas Administração/Outros existem mas guardam VALOR (herança do Mapa de
   Custos), não fórmula de rateio.
3. Origem categoriza o custo (Centro de Custo = transformação/hora; Tinta =
   material; Serviço Externo = terceirização; Matriz Impressão = faca; etc.).

**CONCLUSÃO DEFINITIVA:** o G-Print desktop (o que a Carton Wega opera para gerar
OP) **consome** custos-hora fixos cadastrados em Tabelas de Custo → Valores. O
Mapa de Custos RKW (WebGraf/consultoria) **alimenta esses valores por fora**; o
desktop NÃO recalcula o mapa. Logo:
- **Migração obrigatória** = cadastro "Tabela de Custos" (máquina × valor-hora,
  por Origem/categoria, com Colunas/variações e % de aplicação) + o motor de
  cálculo de orçamento (camada 2). O Vizor já tem o motor de orçamento; falta
  aderir ao modelo "Tabela de Custos por Origem/Coluna" do Calcgraf.
- **Diferencial Vizor** = o Mapa de Custos RKW vivo (GAP 1) — que HOJE a Wega só
  tem via consultoria paga externa. Forte argumento comercial.

### Verificações ainda úteis (não bloqueiam o plano)
- Colunas (submenu): ver o que são as "Colunas" (variações de tabela de preço).
- Tabelas de Custo → Manutenção: estrutura/definição da tabela.

### V2 (parcial) — Orçamento real (Vendas → Orçamento → Manutenção)

Submenu Orçamento: **Manutenção** (Ctrl+S), **Cálculo Padrão**, Listagem de
Cálculos, Emissão de Pré-Cálculos, Propostas.

Tela "Orçamentos" (Manutenção) — exemplo real **Orçamento nº 0005353,
29/09/2026**:
- **Cliente Principal**: código 365 - GERDAU RIOGRANDENSE.
- **Itens do Orçamento** (um orçamento tem N itens/cálculos): item 1, **Cálculo
  15182**, Linha de Produto "CARTUCHO C(...)", **Tipo de Produto: Invólucros**,
  **Tiragens 4.000**, Descrição "RÓTULO P/FARPADO GIR 500M", **Status: Ped: 2931**
  (orçamento já convertido em pedido nº 2931).
- **Dados do Item** (painel texto):
  - Especificações Gerais: **Formato 190 x 1 x 1200, 1 modelo(s)**.
  - **Tipos de Plano** (o roteiro/materiais): "Invólucros Stora Enzo Bobina 415g,
    3/0, 190 x 1200 mm, **Cortadeira (Grande), Guilhotina de envol, Fita dupla
    face, Laminação maior**" ← papel (bobina 415g), cores (3/0), e as ETAPAS/
    máquinas do roteiro.
  - Acabamentos: Não tem. Itens Diversos: Não tem.
- **Aba Fechamento**: Tiragem **4.000** | **Margem 43,58%** | **C.Marg. 52,36%** |
  **Valor Unitário $4,28524** | **Valor Total $17.140,96**.
- Aba **Comissões** (separada — vínculo com hierarquia de comissões/vendedor).
- Botão "Cálculo Padrão" no menu = o motor de cálculo (memória de cálculo).

**Estrutura confirmada da camada 2 (orçamento):**
- Orçamento (cabeçalho: série, número, data, cliente) → N **Itens/Cálculos**.
- Cada Item: Tipo de Produto (Invólucros/Cartucho/etc.) + Tiragem + Formato +
  Plano (papel/bobina + cores NxN + lista de etapas/máquinas) + Acabamentos +
  Itens Diversos.
- Fechamento por tiragem: Margem %, **Contribuição Marginal %**, Valor Unitário,
  Valor Total. (permite múltiplas tiragens — simulação).
- Conversão orçamento→pedido registrada no item (Status "Ped: NNNN").

**Mapa Calcgraf → Vizor (aderência do motor):**
| Calcgraf | Vizor OrcamentoGrafico |
|---|---|
| Tipo de Produto (Invólucros/Cartucho) | TipoEmbalagem |
| Formato / medidas | medidas (JSON) + fórmulas de planificação |
| Plano: papel/bobina + gramatura | papelId/gramatura/PrecoMateriaPrima |
| Cores 3/0 (NxN) | numCores/cores (JSON) |
| Etapas (Cortadeira, Guilhotina, Laminação) | roteiro/etapas × custo-hora (Tabela de Custos) |
| Acabamentos | acabamentos (JSON) |
| Tiragem / múltiplas tiragens | quantidade / variacoes (simular-tiragens) |
| Margem % / C.Marg. % / Valor Unit / Total | margemReal / (CM a ADICIONAR) / precoUnitario / precoVenda |
| Status "Ped: NNNN" | pedidoVendaId (gera PedidoVenda ao aprovar) |

Aderência ALTA. Principais ajustes de paridade identificados:
1. **Contribuição Marginal %** — o Calcgraf exibe C.Marg. por item/tiragem; o
   Vizor tem margemReal mas precisa ADICIONAR o cálculo/exibição de Contribuição
   Marginal (Custo Transformação + Lucro) por orçamento.
2. **Tabela de Custos por Origem/Coluna** — o custo-hora do Vizor vem de
   `CentroProducao.custoHora` (um valor); o Calcgraf usa Tabela de Custos (máquina
   × valor-hora × Coluna/variação × Origem). Avaliar adotar esse modelo p/ paridade
   (múltiplas tabelas de preço, colunas, % de aplicação).
3. **Serviço Externo** como categoria de custo (Origem do Calcgraf) — garantir no
   motor de preço do Vizor.
4. **Itens Diversos** (categoria de custo avulsa no orçamento) — verificar no Vizor.
5. Um orçamento com **N itens/cálculos** (o Calcgraf agrupa vários cálculos sob um
   orçamento/cliente); o Vizor hoje é 1 orçamento = 1 cálculo. Avaliar
   agrupamento (orçamento multi-item).

### AINDA ÚTIL (opcional): abrir "Cálculo Padrão" ou o botão de cálculo do item
para ver a MEMÓRIA DE CÁLCULO detalhada (horas de cada máquina, consumo kg de
papel/tinta, decomposição do custo). Não bloqueia o plano — a aderência já está
clara —, mas ajudaria a validar as fórmulas exatas (perdas, aproveitamento,
tempos) contra o motor do Vizor.

### RI-7 — Listagem de Cálculos (relatório de orçamentos)
Cliente GERDAU RIOGRANDENSE, período 01–30/09/2026. Colunas: Data Orçamento |
Tipo de Produto (Impressos/Invólucros) | Descrição | Tiragem | Valor Total |
Vendedor | **Cálculo|Proposta** | **OP|Pedido** | Vl.Pedido | Aprovação.
- Cálculos: 14921, 14922, 14930, 15007, 15063, 15180, 15181, 15182 (Rótulos p/
  farpado, Fita amar papelão), vendedor MARSCH.
- Múltiplas tiragens por cálculo (ex. 14930: 4.000 e 10.000).
- Totais: **8 cálculos, Total Orçado 136.284,88, Total Fechado 136.284,88,
  Aproveitamento Qtde 100% / Valor 100%**.
- Nota: "múltiplas tiragens de um mesmo cálculo NÃO são variantes na quantidade";
  cálculos aprovados usam o próprio valor no Total Orçado. Confirma conceito de
  variantes de tiragem + aproveitamento (§14).

### Como chegar na MEMÓRIA DE CÁLCULO (para próxima captura)
A tela "Cálculo Padrão" é a busca; digitar **Número do cálculo** (ex.: 15182) +
buscar → duplo-clique no resultado abre a tela de cálculo detalhada. OU em
Orçamento → Manutenção, abrir o item e usar o botão de cálculo. A Listagem de
Cálculos (RI-7) é só relatório-resumo, não a memória.

### V2 (completo) — EDITOR DE CÁLCULO (o motor da camada 2) ⭐

Tela "Editor" do **Cálculo Nº 7343** (montagem do cálculo de um item):
- **Linha de Produto**: LÂMINAS · **Tiragem**: 4.000 · Sigla Acabado: (vários).
- **Produto**: Impressos, Formato **1200 x 190**.
- **Planos** (o roteiro/plano — pode haver mais de um plano por cálculo):
  Impressos | Tiragem 4.000 | **Suporte: Nz Bobina 325** (papel/substrato) |
  Formato 1200 x 190 | **Pré-Impressão** | **Impressão: 3x0 - Offset Plana** |
  **Acabamento: Cortadeira (Grande), Guilhotina de envol...**
- **Atividades de Acabamento** (checkboxes — catálogo de operações da fábrica,
  = os centros/máquinas de acabamento): Caixa Padrão, Colocação de Alça, Verniz
  UV Total, Bobst S/E (Corte e Vinco), CVM/CVMR (Corte e Vinco), AFT70/Bobst 68
  (Coladeira), Cortadeira Pequena, Guilhotina maior/menor, Jato/Mazola
  (acoplagem), Plastificadora maior/menor, Serviços manuais, **Fita dupla face
  ✓**, HotStamping 1/2/3, Destacar, **Laminação maior ✓**/menor, Relevo, Verniz
  (vários tipos: UV Total, Local, BA Brilho/Fosco, Offset Fosco, UV Local Wega),
  **Guilhotina de envol ✓**, Diana (Coladeira), Fita dupla face 2.
  → O usuário MARCA as atividades que o trabalho usa; cada uma puxa o valor-hora
    da Tabela de Custos (Origem = Centro de Custo/Mat.Acabamento).
- **Aplicado sobre**: lista + botão **Detalhes...** (a decomposição numérica).
- Abas: **Itens Diversos**, **Itens Fornecidos** (materiais/serviços avulsos e
  fornecidos pelo cliente).

**Estrutura completa do cálculo (camada 2) — confirmada:**
```
Cálculo (nº) ─ Linha de Produto ─ Tiragem
  └─ Produto (formato, modelos)
       └─ Plano(s): Suporte(papel/bobina) + Formato + Pré-Impressão +
                    Impressão(NxN, tipo: Offset Plana/Rotativa) + Acabamentos
            ├─ Atividades de Acabamento (checkboxes → máquinas × custo-hora)
            ├─ Itens Diversos (custos avulsos)
            └─ Itens Fornecidos (material do cliente — não cobra material)
  → Detalhes: memória de cálculo (horas/consumo/valores)
  → Fechamento: Margem%, C.Marg.%, Valor Unit, Valor Total (por tiragem)
```

**Aderência final ao Vizor:** o modelo do Vizor (TipoEmbalagem + medidas + papel
+ cores + acabamentos[] + quantidade) cobre bem. Ajustes de paridade
consolidados (ver lista no §V2 parcial):
1. Catálogo rico de **Atividades de Acabamento** (checkbox por operação) —
   mapear para os acabamentos[] do Vizor + centros/Tabela de Custos.
2. **Itens Fornecidos** (material do cliente, não cobra) — NOVO conceito, o Vizor
   não tem; adicionar.
3. **Itens Diversos** (custos avulsos no cálculo) — verificar no Vizor.
4. **Tipo de Impressão** (Offset Plana vs Rotativa) já existe no cálculo de
   consumo do Vizor (PLANA/ROTATIVA) — bom.
5. **Suporte** = papel/bobina com gramatura (Nz Bobina 325) → PrecoMateriaPrima.

### Sobre a memória de cálculo numérica
O botão "Detalhes..." (ao lado de "Aplicado sobre") abre **Acabados - Dados
Cadastrais** (Conta Nível 1 = ACABADOS, Unidade de Faturamento, conversão de
unidade) — é o cadastro do produto ACABADO, NÃO a memória de custos. "Aplicado
sobre" fica vazio quando nenhuma atividade está marcada.

A memória de cálculo numérica (horas × valor-hora, consumo kg papel/tinta,
parciais) sai provavelmente por **relatório/impressão**: ícone impressora na
barra do Editor, ou **Vendas → Orçamento → Emissão de Pré-Cálculos** (gera o
relatório detalhado do cálculo). Captura FUTURA (opcional).

> **Decisão:** NÃO bloquear o plano por isso. A ESTRUTURA da camada 2 está 100%
> mapeada. As fórmulas numéricas exatas (tempo/perda/aproveitamento) são
> calibração — validar depois comparando um cálculo real do Calcgraf (via Emissão
> de Pré-Cálculos ou proposta) com a saída do motor do Vizor (que já existe).
> LEVANTAMENTO CONSIDERADO SUFICIENTE PARA O PLANO DE AÇÃO.

---

## RELATÓRIOS IMPRESSOS DO CALCGRAF (fonte real, layout de saída)

### RI-1 — "Mapa de Localização de Custos — Relação de Bens a Depreciar"

Cabeçalho: `web graf` · "Mapa: Carton Wega - Agosto 2023 - 8/2023" · "Emitido
em 03/11/2023 12:45 - Página X de 3". É a fonte impressa do §7 (confirma os
dados). Layout: agrupado por Centro (Auxiliar / de Custo produtivo /
Administração), com subtotal por centro (Núm. Itens + soma Valor + soma
Depreciação) e **TOTAL GERAL** no fim.

Colunas: **Grupo** | **Bem a Depreciar** | **Valor** | **Estado** | **Anos** |
**Residual %** | **Depreciação** | **Status**.

Confirmações vs §7:
- **TOTAL GERAL = 5.710.200,00** de Valor (não 5.800.200,00 do slide) e
  **Depreciação 34.537,22** (≠ 34.043,47 do §7 e ≠ 35.043,47 do R1). → Os
  slides usaram uma versão/data diferente do mapa (emissão 03/11/2023). Confirma
  que os totais variam por versão do mapa; a estrutura é idêntica. Reconciliar
  no fim é questão de qual "foto" do mapa usar.
- Grupos de bens confirmados: Veículos, Informática outros, Impressoras,
  Acabamento autom., Acabamento manual.
- Estado do bem: Ótimo / Bom / Regular (coluna própria, ao lado do Valor).
- Bens com Residual em branco (Informática, 3 anos) → depreciam 100% (sem valor
  residual); máquinas têm residual 30–40%.

> Este relatório é exportável em planilha (aberto no LibreOffice/Excel na
> captura) — bom sinal: o Calcgraf exporta relatórios em formato tabular, o que
> facilita extração de dados reais para massa de teste/migração.

### RI-2 — "Relação de Centros Auxiliares"
Colunas: **Centros Auxiliares** | **Rateio** (o método/chave) | **Status**.
- Fábrica geral → rateio "Fábrica" → Ativo
- Corte inicial → rateio "Corte Inicial" → Ativo
- Pré-impressão / CTP → rateio "Pré-Impressão" → Ativo

### RI-3 — "Relação de Centros Produtivos"
Colunas: **Natureza** | **Centro Custo Produtivo** | **Uso Orçamento** |
**Unid. Prod.** | **Turno** | **B.H.M.** | **+ Horas Extras** | **Horas
Produtivas**. Confirma integralmente o §5 (mesmas 11 máquinas e horas).

### RI-4 — "Relação de Despesas"
Colunas: **Despesas** | **Nome rateio** (a chave de rateio de cada despesa) |
**Valor**. Confirma §9 e revela a **chave de rateio de cada despesa** (peça
que faltava):

| Despesa | Chave de rateio | Valor |
|---|---|---|
| Água e Esgoto | **Quant. funcionários** | 400,00 |
| Aluguel e IPTU | Administração | 8.200,00 |
| Associações de Classe | Administração | 500,00 |
| Comunicação (fone/internet) | Administração | 2.200,00 |
| Despesas Bancárias | Administração | 3.100,00 |
| Despesas com Manutenção (geral) - exceto máquinas | Administração | 45.000,00 |
| Despesas com Pessoal | **Quant. funcionários** | 59.171,19 |
| Despesas com Veículos | Administração | 38.270,00 |
| Energia Elétrica | Administração | 23.477,90 |
| Honorários Diretoria | Administração | 30.000,00 |
| Honorários esporádicos | Administração | 6.310,00 |
| Honorários Profissionais | Administração | 13.000,00 |
| Manutenção de Máquinas | **Manutenção máquinas** | 72.080,63 |
| Manutenção Predial | Administração | 7.000,00 |
| Material de Limpeza e Copa | Administração | 3.471,10 |
| Propagandas e Brindes | Administração | 2.800,94 |
| Seguro Imóvel/Equipamentos/Veículos | Administração | 5.066,00 |
| Suprimentos Administração | Administração | 935,22 |
| Treinamentos e Consultorias | Administração | 1.000,00 |
| **Total** | | **321.982,98** |

> Cada despesa tem uma **CHAVE DE RATEIO nomeada** que define como se distribui:
> - **Administração**: vai para o centro Administração (e de lá é redistribuída).
> - **Quant. funcionários**: rateada proporcionalmente ao nº de funcionários de cada centro (ver RI-5).
> - **Manutenção máquinas**: rateada proporcionalmente ao valor/quantidade de máquinas por centro.
> São **chaves de rateio reutilizáveis** (tipos de critério), não % fixos por despesa.

### RI-5 — "Relação de Funcionários por Centro de Custo"
Fonte impressa dos §8/§8.1/§8.2. Colunas: **Funcionário** | **Cargo** |
**Salário** | **A.C.** (Ajuda de Custo) | **Observações**. Agrupado por centro
com subtotal (Qtde func. + soma salário + soma A.C.). Inclui grupo final
**"Funcionários Rateados"** (Fabio, Higor, Thiago Bordim). **TOTAL GERAL:
salário 245.782,88 / A.C. 6.898,00** (confirma §8.1).

### RI-6 — "Listagem de Rateios" (o MECANISMO completo de rateio) ⭐

Relatório-chave. Lista TODAS as regras de rateio do mapa, em 3 blocos:

**(a) Rateios de Centro Auxiliar** — como cada auxiliar se distribui nos centros:
- **Fábrica geral** (nome do critério: "Fábrica"): peso 1 em cada um dos 11
  produtivos → **9,09% cada** (1/11), TOTAL 11 = 100%. (rateio igual entre TODOS
  os produtivos).
- **Corte inicial** (critério "Corte Inicial"): peso 1 SÓ nas 5 impressoras
  (Roland, Sormz-Verniz, Heidelberg SM, Heidelberg CD, KBA) → **20,0% cada**,
  TOTAL 5 = 100%. (confirma §6: só entre impressoras).
- **Pré-impressão/CTP** (bloco truncado, mas segue mesmo padrão das impressoras — §6).

**(b) Rateios de Funcionário** — funcionários rateados (confirma §8.2):
- **Thiago Bordim (Gerente Produção)**: peso 1 nos 13 centros → 7,69% cada.
  (13 = 11 produtivos + Fábrica geral + Corte inicial, todos com peso 1).
- **Fabio Eduardo Vidal Silva (uso exclusivo)**: Roland Ultra peso 50 /
  Heidelberg SM peso 50 → 50%/50%.
- **Higor Lopes de Melo (uso exclusivo)**: Roland Ultra 50 / Heidelberg SM 50 → 50%/50%.

**(c) Rateios de Despesa** — como cada CHAVE de despesa (RI-4) distribui:
- **"Quant. funcionários"** (usada por Água e Esgoto, Despesas com Pessoal):
  peso = nº de funcionários de cada centro (+ 0,08 de ajuste — provável fração
  de rateados). Ex.: Fábrica geral 24,08 → 21,69%; Corte inicial 3,08 → 2,77%;
  Pré-impressão/CTP 4 → 3,6%; Roland 1,08 → 0,97%; Coladeiras 9,08 → 8,18%;
  Acabamento Geral 30,08 → 27,1%; Administração 11 → 9,91%. TOTAL **111** → 100%.
  (o peso 0,08 extra em cada centro produtivo = distribuição fracionada dos 3
  rateados/gestão pelos 12? — a confirmar; o total bate 111 = 108 diretos + 3 rateados).
- **"Manutenção máquinas"** (usada por Manutenção de Máquinas): peso proporcional
  às máquinas por centro (não capturado em detalhe — inferir do valor dos bens
  ou nº de unidades).
- **"Administração"** (maioria das despesas): vai 100% para o centro Administração.

> **Modelo de dados do rateio (deduzido do RI-6):**
> Uma **ChaveDeRateio** (tipo de critério) tem uma lista de destinos
> (Centro → peso). O % de cada centro = peso ÷ Σ pesos. Tipos observados:
> - Rateio de **centro auxiliar** (Fábrica/Corte Inicial/Pré-Impressão): pesos manuais por centro-destino.
> - Rateio de **funcionário** (por func. específico): pesos manuais.
> - Rateio de **despesa**: por chave nomeada — "Administração" (destino único),
>   "Quant. funcionários" (peso automático = headcount do centro),
>   "Manutenção máquinas" (peso automático = máquinas do centro).
> Ou seja: chaves podem ser de **peso manual** ou **peso automático/dinâmico**
> (derivado de headcount ou de ativo/máquinas do centro).

---

## COMPARATIVO — Calcgraf × Vizor (o que já existe vs o que falta)

### O que o Vizor JÁ TEM (módulo Orçamento Gráfico — spec 100% implementada)
Fonte: `.kiro/specs/orcamento-grafico/` (design + tasks todas [x]).
- **Motor de ORÇAMENTO** (`orcamento-grafico-calculo.service.ts`): encaixe/imposição,
  papel (peso/custo), tinta (por cor, cobertura, rendimento), máquinas
  (setup+operação × **custo-hora**), acabamentos, formação de preço (markup +
  impostos + comissão + desp.adm).
- Cadastros: **TipoEmbalagem** (fórmulas de planificação), **PrecoMateriaPrima**,
  **ParametroPerda** (por processo/máquina), **TabelaMargem** (markup/impostos/
  comissão/despAdm/descontoMax).
- **CentroProducao** já tem: velocidade, formato de folha, pinça — MAS o
  **custo-hora é um dado de entrada** (`maquinaImpressao.custoHora`), não é
  calculado por rateio.
- Fluxo comercial completo: orçamento → versões → enviar → aprovar → **gera
  PedidoVenda → OP com BOM/roteiro/etapas**; proposta PDF; dashboard comercial;
  simulação de tiragens; importação em massa.
- PCP já tem: importação de OP (PDF GPrint), painel de programação, apontamentos,
  cálculo de consumo gráfico, integração PCP→WMS.

### O que o Calcgraf tem e o Vizor NÃO tem (GAPS)

**GAP 1 — Motor de Custeio RKW / Mapa de Custos (o maior gap).** ⭐
O Vizor consome `custoHora` como entrada; o Calcgraf **calcula** o custo-hora
via Mapa de Custos. Falta TODO o subsistema:
- Cadastro de **Bens a Depreciar** (Valor, Estado, Anos, Residual%) → depreciação
  mensal por bem/centro (§7, RI-1).
- Cadastro de **Funcionários por centro** (salário, cargo, Ajuda de Custo) +
  **Funcionários Rateados** (§8, RI-5).
- Cadastro de **Despesas mensais** com **chave de rateio** por despesa (§9, RI-4).
- **Encargos Sociais** (tabela CLT, Normal/Simples — 60%/29%) (§4).
- **Centros de Custo Auxiliares** + **Administração** (além dos produtivos) (§6, §5).
- **Horas Produtivas** por centro (base padrão de mercado: B.H.M. × unid + extras) (§3, §5).
- **Motor de Rateio em 2 níveis** com **Chaves de Rateio** reutilizáveis
  (peso manual OU automático por headcount/máquinas) → distribui auxiliares +
  administração nos produtivos (§10, §11, RI-6).
- Cálculo do **Custo/Hora** por centro: Apurado, **A Praticar** (com ajuste % de
  equivalência), Praticado (§11, §12).
- Relatórios: Mapa Custos/Hora, Composição do Custo Hora, Resultado Apurado,
  Distribuição do Custo Fixo, Taxa Administrativa vs benchmark (§10–§13).

**GAP 2 — Camada Gerencial/Analítica (RKW).**
- **Contribuição Marginal** por orçamento e média (orçado × fechado,
  aproveitamento/taxa de conversão) (§14).
- **Simulação de faturamento × cobertura de custo fixo** mês a mês (§15).
- **Ponto de Equilíbrio** (break-even = Custo Fixo ÷ CM%) (§16).
- **Confronto com DRE Contábil** (§17).
- Metas de Venda (menu Gerencial).

**GAP 3 — Detalhes do Orçamento estilo Calcgraf (a validar contra telas reais).**
- CEV (Custos de Venda) como bloco explícito na formação de preço (§14) — o Vizor
  tem impostos/comissão/despAdm na TabelaMargem, mas confirmar equivalência.
- Serviços Externos (terceirização) como componente do custo — confirmar se o
  Vizor cobre.
- Crédito / Efetivar OP Reserva / Liberação de Cálculo Recusado por Tempo (menu
  Produção do Calcgraf) — fluxos específicos a validar.
- Hierarquia de Comissões (menu Cadastros) — validar contra Portal Representante.

### Conexão custeio → orçamento
No Calcgraf, o **Custo/Hora A Praticar** (saída do Mapa de Custos) É a entrada
`custoHora` de cada CentroProducao no orçamento. Ou seja: implementar o GAP 1
alimenta diretamente o campo que o motor de orçamento do Vizor já consome. É
uma integração limpa (o Mapa de Custos escreve o `custoHora`/`custoHoraPraticar`
no CentroProducao; o orçamento lê).

---

## STATUS DO LEVANTAMENTO

- [x] PDF "Apresentacao - Consultoria de Custos - Carton Wega_03112023.pdf" (31 págs) — motor de custeio RKW completo (§§2–18).
- [x] Relatórios impressos do Calcgraf (RI-1 a RI-6): Bens a Depreciar, Centros Auxiliares, Centros Produtivos, Despesas, Funcionários, Listagem de Rateios.
- [x] Comparativo Calcgraf × Vizor (GAPS 1–3 acima).
- [ ] Confirmar via SISTEMA (acesso direto): telas de Orçamento real, OP, Ficha de Produto, Produtividade/Pós-Cálculo, cadastros de custo.
- [ ] Prints das telas: Orçamento, Cadastros de Custos, OP/Pedido, Análise de Produtividade/Pós-Cálculo, relatórios gerenciais.

## Síntese — o que o Calcgraf faz (visão de módulos, para o comparativo futuro)

1. **Motor de Custeio RKW** (Mapa de Custos): cadastros de Centros Produtivos +
   Auxiliares + Administração; Bens a Depreciar (depreciação por bem/centro);
   Funcionários por centro + Funcionários Rateados (chave de rateio);
   Despesas mensais; Encargos Sociais (tabela CLT); Horas Produtivas (base
   padrão de mercado). Rateio em 2 níveis (auxiliares/adm → produtivos) →
   Custo/Hora por centro (Apurado / A Praticar com ajuste / Praticado).
2. **Orçamento (formação de preço)**: Preço = Materiais + Custo de Transformação
   (horas × custo-hora) + Serviços Externos + CEV + Margem. Contribuição
   Marginal por orçamento. Simulação/equivalência de máquinas.
3. **Produção (OP/Pedido)**: emissão/reemissão/cancelamento/reativação de OP,
   crédito, efetivar OP reserva. (detalhar com prints)
4. **Gerencial/Analítico**: Contribuição Marginal (orçado × fechado,
   aproveitamento), Simulação de faturamento vs custo fixo, Ponto de Equilíbrio
   (break-even = Custo Fixo ÷ CM%), confronto com DRE Contábil, Metas de Venda.
5. **Cadastros gerais**: Empresa, Vendedores, Contatos, Hierarquia de Comissões,
   Unidades, Classificação Fiscal, Moedas, Localidade de Frete, Feriados,
   Parâmetros, Materiais, Atividades, Produtos, Séries.

## A confirmar (dúvidas acumuladas, resolver no fim)
- Reconciliar os vários totais de Custo Fixo entre slides/datas (747.572,02 /
  757.176,93 / 685.096,30 / 650.797,00) — versões/níveis de rateio distintos.
- Depreciação mensal: 35.043,47 (R1/§12) vs 34.043,47 (§7) — arredondamento?
- Fórmula exata do rateio de despesas por centro (hoje "critério simplificado",
  ideal por m² — não implementado por falta de dado de área).
- Como o "Estado" do bem (Ótimo/Bom/Regular) modula a depreciação.
- Composição exata do CEV (Custos de Venda): comissão + impostos + frete?
