# Restaurar o backup do Calcgraf (Carton Wega) — SQL Server

## O que é o arquivo

`C:\Source\VisioFab.Wms.Back\cartoon\CartonWega.bak` (~659 MB, veio em ARJ →
extraído). **Formato confirmado: Microsoft SQL Server backup** (assinatura
`TAPE` + "Microsoft SQL Server" no cabeçalho, formato MTF). O G-Print/Calcgraf
desta instalação roda sobre **SQL Server** (não Firebird, como eu suspeitava).

> Segurança: o backup tem dados reais do cliente (salários, clientes, preços).
> Restaurar e trabalhar SÓ LOCALMENTE, em instância isolada. NÃO commitar dados
> reais no git; nos testes/docs versionados usar dados anonimizados/exemplo.

## Passo 1 — Ter um SQL Server local

Opção A (recomendada, leve e grátis): **SQL Server Express** ou **Developer**.
- Download: SQL Server 2022 Express/Developer (Microsoft).
- Instalação "Basic" já sobe uma instância (ex.: `localhost\SQLEXPRESS`).

Opção B (Docker, se preferir):
```
docker run -e "ACCEPT_EULA=Y" -e "MSSQL_SA_PASSWORD=Str0ng!Pass" \
  -p 1433:1433 --name mssql-calcgraf -d mcr.microsoft.com/mssql/server:2022-latest
```
(no Docker o .bak precisa estar acessível dentro do container — copiar via
`docker cp CartonWega.bak mssql-calcgraf:/var/opt/mssql/`)

Também instalar o **sqlcmd** (vem com o SQL Server / ou "SQL Server Command Line
Utilities") OU usar o **SSMS** (SQL Server Management Studio, interface gráfica).

## Passo 2 — Descobrir os nomes lógicos do backup

Antes de restaurar, ver os arquivos lógicos internos (data/log):
```sql
RESTORE FILELISTONLY FROM DISK = 'C:\Source\VisioFab.Wms.Back\cartoon\CartonWega.bak'
```
Isso lista `LogicalName` (algo como `CartonWega` e `CartonWega_log`) e o tipo (D/L).

## Passo 3 — Restaurar num banco novo isolado

```sql
RESTORE DATABASE CalcgrafCartonWega
FROM DISK = 'C:\Source\VisioFab.Wms.Back\cartoon\CartonWega.bak'
WITH
  MOVE '<LogicalName_Data>' TO 'C:\SQLData\CalcgrafCartonWega.mdf',
  MOVE '<LogicalName_Log>'  TO 'C:\SQLData\CalcgrafCartonWega_log.ldf',
  REPLACE, RECOVERY
```
(trocar `<LogicalName_*>` pelos nomes do passo 2; criar a pasta `C:\SQLData`).

Via sqlcmd (linha de comando):
```
sqlcmd -S localhost\SQLEXPRESS -E -Q "RESTORE FILELISTONLY FROM DISK='C:\Source\VisioFab.Wms.Back\cartoon\CartonWega.bak'"
```

## Passo 4 — Explorar o schema de origem (mapeamento)

Depois de restaurado, listar tabelas e colunas para o de/para com o Vizor:
```sql
USE CalcgrafCartonWega;
SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_TYPE='BASE TABLE' ORDER BY TABLE_NAME;
-- colunas de uma tabela:
SELECT COLUMN_NAME, DATA_TYPE FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='<tabela>';
```
Procurar tabelas de: custos-hora/tabela de custo, centros/máquinas, orçamentos/
cálculos, produtos, materiais, clientes, funcionários, bens/depreciação.

## Passo 5 — Importar para o Vizor

Escrever `scripts/importar-calcgraf-*.ts` que:
1. Conecta no SQL Server local (lib `mssql` ou `tedious`) — SÓ LEITURA.
2. Lê as tabelas de origem.
3. Mapeia campos → models Prisma do Vizor (MapaCusto/MapaCentro/BemDepreciar/
   FuncionarioCusto/DespesaCusto, OrcamentoGrafico, produtos, etc.).
4. Insere no Vizor via Prisma, com de/para e validação.
5. Valida contra os golden cases (agora com dados reais).
Prefixar scripts temporários de exploração com `_tmp-` e remover após uso.

## Como Kiro ajuda a partir daqui

Kiro NÃO instala o SQL Server (é setup local do usuário). Depois que a instância
estiver de pé e o banco restaurado, Kiro pode:
- Rodar as queries de exploração (via script Node com `mssql`) e mapear o schema.
- Escrever o script de importação e os golden cases com dados reais.
Basta o usuário informar a connection string do SQL Server local.
