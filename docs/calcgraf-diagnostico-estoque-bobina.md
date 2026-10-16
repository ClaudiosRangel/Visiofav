# Diagnóstico — cadeia Bobina → Estoque no Calcgraf (destravar Bloco 4)

Objetivo: mapear, com DADOS REAIS do Calcgraf de **produção** (servidor PHTech),
como o sistema sabe se o material/bobina de uma OP está "em estoque" ou
"encomendado", e os kg. Isso é o pré-requisito para a regra "Aguardando Cartão"
do Vizor passar a usar um **campo confiável** (spec
`op-visualizacao-observacoes-calcgraf`, Bloco 4), hoje BLOQUEADO porque no backup
local `EstSaldos` está vazio e não há de-para claro `Suporte → item de estoque`.

## Por que no backup local não deu

- `EstSaldos` (CodItem, SaldoFisico, OrigemSaldo, CodOrigem) está VAZIO no
  backup (`SaldoFisico > 0` não retorna nada).
- `Suportes` só tem `Codigo` e `Nome` — sem FK direta para item de estoque.
- `CalculoProdutosConjuntos` (ConteudoAcond) está vazio.

No PDF da OP (ex.: 3.166) aparece "Bobina Stora Enzo 315g ... em estoque
(4.205,0 kg)". Esse texto é montado pelo GPrint cruzando a NECESSIDADE do suporte
com o SALDO. Precisamos achar esse caminho com dados reais.

## Como rodar (produção PHTech, SOMENTE LEITURA)

No servidor, via SSMS ou sqlcmd, no banco do Calcgraf (nome interno `GPrint`;
instância `SQL2019Express,5520`; login `sa`). TODAS as queries abaixo são SELECT.

> Troque `@numOp` pela OP que no PDF mostra bobina "em estoque (N kg)" e/ou
> "encomendado" — idealmente uma de cada para comparar.

### 1. Resolver o cálculo da OP
```sql
DECLARE @numOp INT = 3166; -- ajuste
SELECT TOP 1 e.CodOpHeader, MAX(ch.Codigo) AS CalcCodigo
FROM OpItemEstrutura e
JOIN CalculoHeader ch ON ch.CodOpItemEstrutura = e.Codigo
JOIN OpHeader h ON h.Codigo = e.CodOpHeader
WHERE h.Numero = @numOp
GROUP BY e.CodOpHeader;
```

### 2. Suporte(s) do cálculo (bobina/papel) e seus códigos
```sql
-- Troque @calc pelo CalcCodigo do passo 1
DECLARE @calc INT = 0;
SELECT p.Codigo, p.codPlano, p.nomePlano, p.codSuporte,
       s.Nome AS suporteNome, p.gramatura, p.dimensao1, p.dimensao2, p.tiragem
FROM CalculoPlanos p
LEFT JOIN Suportes s ON s.Codigo = p.codSuporte
WHERE p.Codigo = @calc;
```

### 3. Procurar a ligação Suporte → item de estoque
```sql
-- SuporteXEstoque liga codSuporte a CodItemEstoque + gramatura/formato.
SELECT * FROM SuporteXEstoque WHERE CodSuporte IN (
  SELECT codSuporte FROM CalculoPlanos WHERE Codigo = @calc
);
```
> Guarde os `CodItemEstoque` retornados — é a chave para o saldo.

### 4. Saldo físico desses itens (EstSaldos)
```sql
SELECT CodItem, SaldoFisico, OrigemSaldo, CodOrigem
FROM EstSaldos
WHERE CodItem IN ( /* CodItemEstoque do passo 3 */ );
```
> Em produção o `SaldoFisico` deve vir preenchido. Observe `OrigemSaldo`/
> `CodOrigem` — pode haver mais de uma linha por item (vários locais/lotes);
> provavelmente a regra soma o `SaldoFisico` por `CodItem`.

### 5. Nome do item de estoque (para bater com o texto do PDF)
```sql
SELECT Codigo, Descritivo FROM Itc WHERE Codigo IN ( /* CodItemEstoque */ );
```

### 6. (Se existir) a necessidade/consumo da bobina no cálculo
```sql
-- Procurar onde o cálculo guarda a necessidade em kg do suporte/papel.
SELECT COLUMN_NAME, DATA_TYPE
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_NAME IN ('CalculoPlanos','CalculoResAgrupamento','CalculoMatAcabamento')
  AND (COLUMN_NAME LIKE '%peso%' OR COLUMN_NAME LIKE '%kg%' OR COLUMN_NAME LIKE '%quant%' OR COLUMN_NAME LIKE '%consumo%');
```

## O que precisamos concluir deste diagnóstico

1. Caminho determinístico **OP → suporte → `CodItemEstoque` → `EstSaldos`**.
2. Como somar o `SaldoFisico` (por item? por local?) para o "kg em estoque".
3. A **necessidade em kg** da bobina no cálculo (para `fração = kgEstoque /
   kgTotal` da liberação parcial).
4. A regra do GPrint para "em estoque" vs. "encomendado" (provável:
   `SaldoFisico >= necessidade` → estoque; senão → encomendado/parcial).

Com (1)-(4) confirmados, o Bloco 4 é implementável com segurança: o reader
classifica cada bobina por saldo real e envia `bobinas:[{descricao, kg, status,
codItem}]`; o backend grava no formato que a regra já entende (sem alterar a
regra). Até lá, a regra segue pelo texto atual (fallback) — sem regressão.

## Status

- BLOQUEADO aguardando este diagnóstico com dados de produção.
- Blocos 1 (relatório Vizor com observações) e 2 (visualizar) já entregues.
