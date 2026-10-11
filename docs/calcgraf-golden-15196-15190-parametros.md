# Golden 15.196 e 15.190 — parâmetros reais do Calcgraf (2 cálculos recentes)

Dados extraídos do backup SQL Server `CalcgrafCartonWega` (local) para montar
um seed de 2 cálculos RECENTES (29/09/2026), além do 15.086 já calibrado.
Fonte de verdade dos alvos: `CalculoResAgrupamento` (agrupamento 1=CT, 2=MD).

## Cálculo 15.196 (tiragem 40.000)

- Header: TiragemBase 40.000, CodLinhaProduto 5, AliqIpi 2.
- Plano: CARTUCHO, codSuporte **1030** ("NZ Extra White Bobina", R$ **8,30/kg**),
  dim peça 281×510, formSuporte **710 × 775**, coefTinta 1,5, ocorrências 1.
  (gramatura do plano = 499 — conferir; parece cartão espesso/duplo.)
- Impressão (I/2, centro 2 = HEID-CD7 R$550/h): producaoHora 5.643, cores 5
  (coresF 5), quantAcertos **15**, tempoPorAcerto **5 min**, tempoPrimeiroAcerto 0.
- Tintas: codTinta 2 (Escala) areaTinta **40%** + codTinta 4 (Pantone) areaTinta **30%**.
- Atividades (tipo A): 11 (centro 8), 14 (AFT70, 1º acerto 90, prodHora 15.134),
  34 (Destacar), 39 (Caixa), 8 (Cortadeira, 1º acerto 15, prodHora 3.000).
- MatAcabamento: 16/14 (Cola, aba **105 mm**, Tipo 3) · 40/39 (Caixa) ·
  19/42 (Verniz, cobertura **100%**, Tipo 1).
- **ALVOS (ResAgrupamento):** CT = 2.541,636 fixo + 0,0641991×40000 = **R$ 5.109,60**;
  MD = 297,00 fixo + 0,39418×40000 = **R$ 16.064,20**; **C.Prod ≈ R$ 21.173,80**.

## Cálculo 15.190 (tiragem 60.000)

- Header: TiragemBase 60.000, CodLinhaProduto 5, AliqIpi 2.
- Plano: CARTUCHO, codSuporte **1028** ("NZ Fibra Longa", R$ **7,30/kg**),
  gramatura **235**, dim peça 135×449, formSuporte **831 × 935**, coefTinta 1,5.
- Impressão (I/2 = HEID-CD7): producaoHora 5.643, cores **4** (coresF 4),
  quantAcertos **4**, tempoPorAcerto **5 min**, tempoPrimeiroAcerto 0.
- Tintas: codTinta 2 (Escala) areaTinta **80%** (só Escala, sem Pantone).
- Atividades (tipo A): 11 (centro 8, 1º acerto 150), 14 (AFT70, 1º acerto **15**,
  prodHora 30.000), 34 (Destacar), 39 (Caixa), 8 (Cortadeira, 1º acerto 15),
  9 (V.UV Total, centro 6 R$155/h).
- MatAcabamento: 16/14 (Cola, aba **120 mm**, Tipo 3) · 23/9 (Verniz UV, cob **100%**) ·
  61/42 (Verniz Primer, cob **100%**) · 40/39 (Caixa).
- **ALVOS (ResAgrupamento):** CT = 1.591,636 fixo + 0,0426024×60000 = **R$ 4.147,79**;
  MD = 233,20 fixo + 0,1438727×60000 = **R$ 8.865,56**; **C.Prod ≈ R$ 13.013,35**.

## Observações para a calibração (quando for feita)

- Mesma máquina HEID-CD7 (R$550/h) e coefTinta 1,5 do 15.086 — a densidade de
  tinta e os `fatorOperacao` precisam ser recalibrados por cálculo (base de
  folhas difere: aproveitamento/formato/tiragem distintos).
- Custos-hora dos centros: Cortadeira 113,21 · AFT70 320 · Dayuan 300 ·
  Destacar 50 · V.UV(centro 6) 155 (iguais ao 15.086).
- Preço de tinta Escala 44/kg, Pantone 71,50/kg (iguais ao 15.086).
- Aproveitamento real não veio direto na coluna `aproveitamento` (0) — derivar
  da imposição (dim peça × formSuporte) ou do `quantModelos`.
- Decisão de escopo pendente com o usuário: seed ESTRUTURAL (rápido, valores
  aproximados) vs seed CALIBRADO ≤0,5% (engenharia reversa por cálculo).
