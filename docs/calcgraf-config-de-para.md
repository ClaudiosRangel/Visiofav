# De-para das Configurações Calcgraf → Vizor

> Fonte única para a migração das CONFIGURAÇÕES do cálculo gráfico do Calcgraf
> (Delphi/SQL Server, fechado) para o Vizor. Levantado direto na base restaurada
> `CalcgrafCartonWega`. Spec: `.kiro/specs/configurador-grafico-calcgraf/`.
>
> Enquadramento: **configuração = entrada editável**; **`CalculoSTC` = saída /
> memória congelada (evidência, não é configuração)**.

## 1. Tabela de-para (configuração → Vizor → status)

| Configuração (Calcgraf) | Conteúdo real | Model/cadastro Vizor | Status |
|---|---|---|---|
| `Itc` Origem **SUPORTE** (2232) | papel/suporte (nome, gramatura) | `PrecoMateriaPrima` (tipo PAPEL) + `SuporteGrafico` | ✅ existe |
| `Itc` Origem **TINTA** (9) | tinta (nome, preço/kg) | `PrecoMateriaPrima` (tipo TINTA) | ✅ existe |
| `Itc` Origem **MAT.ACABAMENTO** (40) | BOPP/laminação (preço/m²) | `AcabamentoGrafico` (natureza MATERIAL) | ✅ existe |
| `Itc` Origem **MATRIZ IMPRESSÃO** (6) | chapas/matriz (preço/un) | `AcabamentoGrafico` / itens diversos | ⚠️ parcial |
| `Itc` Origem **CENTRO DE CUSTO** (55) | máquina (custo-hora) | `CentroProducao` (custoHora/velocidade/acerto) | ✅ existe |
| `Itc` Origem **SERVIÇO EXTERNO** (4) | serviço terceirizado | servicosExternos / itens diversos | ⚠️ parcial |
| `TabelasCusto` + `TabelasCustoDetalhe` | **preço por VIGÊNCIA e por COLUNA** | — | ⚠️ **LACUNA** |
| crédito fiscal no papel | **PIS/COFINS 9,25% descontado do MD** | — | ⚠️ **LACUNA** |
| `TributacaoVenda` | **tributação por operação** (ICMS/IPI/PIS-COFINS/CBS + flags) | — | ⚠️ **LACUNA** |
| `CalculoTaxas` (CodTaxa 2/−7/−10) | taxas por cálculo (PIS-Cofins/comissão) | `TabelaMargem` + CEV do motor | ⚠️ parcial |
| `Agrupamentos` (1/2/3) | CT / MD / SE | constante no motor + decomposição STC | ✅ existe |
| `CalculoSTC` | **memória de custo por componente (SAÍDA)** | `CalculoGrafico.custosCalcgraf` (JSON) | ✅ existe (não é config) |

Contagem real de `Itc.Origem` (base Wega): SUPORTE 2232 · CENTRO DE CUSTO 55 ·
MAT.ACABAMENTO 40 · TINTA 9 · MATRIZ IMPRESSÃO 6 · SERVIÇO EXTERNO 4.

## 2. As 3 lacunas (detalhe + impacto)

### 2.1 Crédito fiscal do papel (PIS/COFINS 9,25%)
- **Calcgraf**: desconta o crédito de PIS/COFINS do custo do material direto. O
  papel "Stora Enzo Bobina 415" tem `ValorTotal` 7,45/kg na tabela, mas o custo
  efetivo usado no cálculo é **6,83/kg** (confirmado no CalculoSTC: 440,812 kg ×
  6,83 = 3.010,75). Origem do flag: `TributacaoVenda.FlagCredPisCofins = -1`.
  ATENÇÃO: 7,45÷1,0925 = **6,819** (≈6,82), NÃO 6,83 — o "6,83 = 7,45÷1,0925" era
  aproximação. O crédito real que leva 7,45→6,83 é **~9,08%** (7,45/6,83 = 1,0908).
  Por isso o percentual de crédito é PARAMETRIZÁVEL por papel (não fixo em 9,25%).
- **Vizor hoje**: migrou o preço BRUTO (7,45) sem o desconto → o MD do papel sai
  ~R$ 568 acima do real no 12992.
- **Impacto**: é a maior causa isolada da divergência do motor cru vs Calcgraf.
- **Solução**: campo `PrecoMateriaPrima.creditoPisCofinsPercent`; preço líquido =
  bruto ÷ (1 + crédito%/100).

### 2.2 Tabelas de custo por vigência/coluna
- **Calcgraf**: `TabelasCusto` versiona valores por período. Na Wega há 2:
  (1) "Padrão" 16/07/2004→02/12/2024; (2) "Teste" 03/12/2024→28/02/2025. Os
  cálculos de 2026 usam a vigente. `TabelasCustoDetalhe` guarda os valores por
  item (`CodItc`) e por **COLUNA** (1..4), com 6 tipos de valor cada: ValorTotal,
  ValorDireto, ValorDepreciacao, ValorAdministracao, ValorOutros, ValorFreteKg
  (cada um com flag `*Definido`).
- **Vizor hoje**: preço único por material/centro, sem versão/vigência nem colunas.
- **Impacto**: impossível manter "tabela de teste" em paralelo nem reproduzir o
  valor histórico de um cálculo pela data.
- **Solução**: models `TabelaCustoGrafico` (versão + vigência, sem sobreposição) +
  `TabelaCustoGraficoItem` (valores por coluna).

### 2.3 Tributação por operação
- **Calcgraf**: `TributacaoVenda` por operação — `AliquotaImposto` (ICMS),
  `AliquotaIPI`, `FLAGCREDICMS`, `FLAGCREDIPI`, `FlagCredPisCofins`,
  `FlagPapelImune`, `PrazoFinanciamento`, e campos de reforma tributária (CBS:
  `AliquotaCbs`/`ReducaoCbs`/`AliqCreditoCbs`). Ex. real: Codigo 2 "ICMS + IPI"
  ATIVO, ICMS 3%, FLAGCREDICMS=-1, FlagCredPisCofins=-1.
- **Vizor hoje**: CEV é parcialmente coberto por `TabelaMargem` (markup/impostos/
  comissão) + constantes do motor, sem seleção de operação por caso.
- **Impacto**: não dá para escolher a tributação da operação por orçamento (ex.:
  venda com IPI vs ISS vs papel imune).
- **Solução**: model `TributacaoGrafica` (alíquotas + flags de crédito + papel
  imune), consumível pela formação de preço.

### Componentes do CEV parametrizáveis por caso (via TributacaoGrafica/CalculoTaxas)
- ICMS (`aliquotaImposto`), IPI (`aliquotaIpi`), PIS/COFINS (`pisCofinsPercent` =
  9,25%, `CalculoTaxas` CodTaxa 2), comissões (`comissaoPercent`, `CalculoTaxas`
  CodTaxa −7), encargo financeiro/juros (`prazoFinanciamento`), e os flags de
  crédito (ICMS/IPI/PIS-COFINS) + papel imune.

## 3. Classificação de grupo por Origem (regra travada)

| Origem (Itc) | Grupo | Agrupamento Calcgraf |
|---|---|---|
| SUPORTE, TINTA, MAT.ACABAMENTO, MATRIZ IMPRESSÃO | **MD** (Material Direto) | 2 |
| CENTRO DE CUSTO | **CT** (Custo de Transformação) | 1 |
| SERVIÇO EXTERNO | **SE** (Serviço Externo) | 3 |

## 4. O que NÃO é configuração (não editar)

`CalculoSTC` é a memória de custo de cada cálculo JÁ FEITO (o custo final por
componente). No Vizor já está em `CalculoGrafico.custosCalcgraf` (JSON) para
7.926/7.951 cálculos da Wega. A feature apenas EXIBE essa memória (read-only) e a
liga à configuração que a produziu (via Origem). Golden: cálculo 12992 soma
R$ 5.192,05 (MD 4.113,94 + CT 1.078,11).
