# Calcgraf → Vizor — Mapeamento de importação (banco real restaurado)

Banco `CalcgrafCartonWega` restaurado localmente (SQL Server `localhost`,
`sqlcmd -S localhost -E -C`). Nome interno original do banco = "GPrint".
Centenas de tabelas com dados reais da Carton Wega. Este doc mapeia as tabelas
de origem → models do Vizor, por bloco.

> Segurança: dados reais (salários, clientes). Trabalhar SÓ local. NÃO commitar
> dados reais; scripts de exploração com prefixo `_tmp-` e remover após uso.

## Tabelas-chave identificadas (por contagem de linhas)

### Bloco 3 — Mapa de Custos RKW (custeio)
- `CentrosCusto` (52) — centros de custo contábeis.
- `CentrosProducao` (52) — centros produtivos (máquinas).
- `CentrosProducaoxRecursos` (51), `CentrosProducaoxTiragensProdHora` (82),
  `CentrosProducaoxAjustesM2` (52), `CentrosProducaoxReversao` (52).
- `TabelasCusto` (2) + `TabelasCustoDetalhe` (18186) — a Tabela de Custos
  (máquina × valor-hora × coluna/origem). ESTA é a origem do custo-hora.
- `GerCustoFixoMes` (5) — custo fixo mensal (provável fonte do Mapa RKW).
- `finRateiosCentrosCusto` (37) — rateios entre centros de custo.
- `EstCentrosCusto` (3), `AcsGruposxEstCentrosCusto` (5).

### Bloco 1 — Orçamento (Cálculo)
- `CalculoHeader` (11561) — cabeçalho do orçamento/cálculo.
- `CalculoPlanos` (14754), `CalculoAcabadosxPlanos` (14754) — planos por cálculo.
- `CalculoTiragens` (16183) — tiragens/variantes.
- `CalculoTintas` (22166), `CalculoMatAcabamento` (37047),
  `CalculoAtvImpressao` (29508), `CalculoAtvAcabamento` (73032),
  `CalculoAtividades` (84605) — itens de custo do cálculo.
- `CalculoItensDiversos` (12410), `CalculoItensFornecidos` (21).
- `CalculoMargens` (399454), `CalculoTaxas` (33297) — margem/CEV.
- `CalculoAcabados` (11103), `CalculoAcabadosEstoque` (11071).
- `DadosCalculosAprovados` (7584).

### Cadastros de apoio
- `Produtos` (12), `ProdutosxPlanos` (18), `ProdutosxAtividades` (3),
  `ProdutosxItensDiversos` (12).
- `Nomes` (1894) + `NomesxClientes` (1497) + `NomesxVendedores` (39) — clientes/
  vendedores (modelo "Nomes" genérico do Calcgraf).
- `Fornecedores` (383), `Contatos` (138), `Enderecos` (4720).
- `Atividades` (68) — atividades de acabamento (o catálogo de checkboxes).
- `Suportes` (78), `SuportesFormatos` (1256), `FormatosPapel` (42),
  `SuportesxEspessura` (554) — papel/substrato.
- `Roteiros` (422), `PcpEstrutura` (3193), `Unidades` (10), `Series` (9).
- `Parametros` (867), `ClassFiscal` (207).

### Pedidos / Produção / Fiscal (blocos futuros)
- `PedidoHeader` (3527), `PedidoItem` (7666), `PedidoVenda` (3061).
- `OpHeader` (3193), `OpItem` (4255), `OpLote` (3194), `OpItemEstrutura` (3193).
- `NotasFiscais` (5674), `DadosFiscaisNFe` (5158), `FinTitulos` (11747).

## Conexão para exploração/importação
```
sqlcmd -S localhost -E -C -d CalcgrafCartonWega -Q "<query>"
```
Para o script de importação: instalar `mssql` (npm), conectar em
`server=localhost; options={ trustServerCertificate:true, encrypt:true }`,
autenticação Windows (msnodesqlv8) OU criar um login SQL. LEITURA apenas.

## Colunas confirmadas (exploração real)

### `Itc` (2346) — catálogo de itens de custo (PK Codigo)
`Codigo, Origem, CodOrigem, Gramatura, Dimensao1, Dimensao2, Ativo,
Agrupamento, CodAgrupamento, Ordem, Descritivo, Unidade, CodTabelaCustoDefault,
AliqCredIcms, AliqCredIpi, RegraColunaOperador/Valor/Codigo, PrazoFinanciamento,
CodExterno, FlagItemDiverso, EncargosFinanceiros`.
- **Origem** (confirmado, = dropdown da tela): CENTRO DE CUSTO, MAT.ACABAMENTO,
  MATRIZ IMPRESSÃO, SERVIÇO EXTERNO, SUPORTE, TINTA.
- `Descritivo` = nome do item; `Unidade` = H/KG/UN/M2/RL/PC.

### `TabelasCusto` (2) — cabeçalho da tabela de preço
`Codigo, Ativo, Nome, ValidadeInicio, ValidadeFim, ControleCarga`.

### `TabelasCustoDetalhe` (18186) — valores por item × coluna (BATE com a tela printada)
`CodTabelaCusto, CodItc, Coluna, ValorTotal, ValorTotalDefinido, ValorDireto,
ValorDepreciacao, ValorAdministracao, ValorOutros, ValorFreteKg (+ *Definido),
DataHoraUltAlteracao`. → é a "Tabela de Custos → Valores" (Valor Direto,
Depreciação, Administração, Outros, Frete/Kg). Amostra real confere: Tinta
Pantone 170,5; Metálica 253; Suporte Kraft 6060/kg; Serviço Externo Chapa 264.
NOTA: itens Origem='CENTRO DE CUSTO' NÃO têm ValorTotal>0 aqui — o custo-hora das
MÁQUINAS vem do MAPA (não da tabela de preço). Confirma a "camada 1" do custeio.

### `CentrosProducao` (52) — máquinas
`Codigo, Ativo, Nome, TipoAtividade, CodQuebra, Processo, CodCoberturaTinta`.
### `CentrosCusto` (52) — `Codigo, Ativo, Nome, AgrupamentoCusto, FlagTabelaCusto`.
### `CentrosProducaoxTiragensProdHora` (82) — `CodCpr, Tiragem, ProdHora` (produtividade por faixa de tiragem).
### `GerCustoFixoMes` (5) — `CustoFixo, AnoMes, MetaPercRentabilidade, MetaValorRentabilidade, CodEmpresa, Codigo` (custo fixo por competência — Mapa RKW).
### `finRateiosCentrosCusto` (37) — rateios entre centros.

## Próximos passos (ordem)
1. Instalar `mssql` (npm) no back. Conexão: `server=localhost, user/pwd OU
   trustedConnection via msnodesqlv8, options.trustServerCertificate=true`.
   (Alternativa sem lib: exportar CSVs via `sqlcmd -o` e importar por arquivo.)
2. Escrever `scripts/_tmp-explorar-calcgraf.mjs` (ad-hoc) e depois
   `scripts/importar-calcgraf-mapa-custo.ts`:
   - Mapear TabelasCustoDetalhe+Itc → cadastro de materiais/preços do Vizor
     (Orçamento Gráfico: PrecoMateriaPrima; e futura Tabela de Custos por Origem).
   - Mapear GerCustoFixoMes + CentrosProducao + rateios → MapaCusto/MapaCentro (RKW).
3. Validar contra relatórios RI-1..RI-6 e contra os golden cases já decompostos.
4. Depois: cadastros (Produtos/Nomes-clientes/Fornecedores/Atividades/Suportes)
   e cálculos (CalculoHeader e filhas → OrcamentoGrafico).

## Credencial de acesso ao banco (DECIDIDO)
A lib `mssql`/tedious NÃO conecta (SQL Server sem TCP/IP na porta 1433 — só
named pipes/shared memory, padrão da instância). Habilitar TCP exigiria mexer no
SQL Server Configuration Manager + reiniciar serviço. **Decisão: usar `sqlcmd`
como ponte** (autenticação Windows `-E -C`, já funciona), com **`FOR JSON PATH`**
para exportar cada tabela como JSON. Testado OK — trouxe os 52 CentrosProducao
reais (KBA Rapida 75, Heidelberg CD/SM, Roland, Cortadeiras, Bobst, Coladeiras...).
Comando base:
```
sqlcmd -S localhost -E -C -d CalcgrafCartonWega -y 0 -Q "SET NOCOUNT ON; SELECT ... FOR JSON PATH"
```
(`-y 0` = largura ilimitada da coluna; sem `-h`). Script exportador:
`scripts/_tmp-exportar-calcgraf.mjs` (gera JSON em `cartoon/export/`).
