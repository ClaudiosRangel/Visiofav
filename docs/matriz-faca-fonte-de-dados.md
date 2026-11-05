# Matriz / Faca de corte — fonte de dados real (investigação definitiva)

> Criado em 05/11/2026. Fecha a pendência "re-exportação da matriz real da base
> Calcgraf" do projeto Comercial. **Leia antes de tentar trazer a matriz de
> qualquer outra fonte** — a investigação abaixo é conclusiva.

## Pergunta

De onde vem o número da faca/matriz de corte de um produto gráfico (ex.:
`2529B - COM BRAILLE`, `2186B`, `2405B - COM RELEVO`) e como expô-lo/pesquisá-lo
no Vizor (Central do Produto, orçamento, OP)?

## Investigação na base Calcgraf restaurada (SQL Server local)

Banco `CalcgrafCartonWega` restaurado em `localhost` (MSSQLSERVER). Conexão:
`sqlcmd -S localhost -E -C -d CalcgrafCartonWega` (o `-C` é obrigatório; **não**
usar `-W`/`-s` que corrompem a saída — usar `-i arq.sql -o arq.out`).

Achados (todos confirmados por query):

| Fonte candidata | Resultado |
|---|---|
| `CalculoPlanos.CodFaca` (int) | **0 em 100%** dos 14.754 planos (sempre 0/null) |
| `CalculoPlanos.CodFacaCartuchoComposto` / `codFacaEtiquetaFlexo` | idem (vazios) |
| Cadastro `FichaTecMatrizes` (facas/matrizes) | **0 registros** |
| `FichaTecMatrizesComposicaoNomes` (monta o nome "2529B") | **0 registros** |
| `FichaTecListagemMatrizes`, `FichaTecTiposMatrizes` | **0 registros** |
| `CalculoPlanos.nomePlano` | contém COMPONENTE (CARTUCHO/Cartão/TAMPA...), **não** a matriz |
| `CalculoHeader.CpNome/CpBase/CodCalculoPadrao` | nenhum contém "2529" nem "BRAILLE" |

**Conclusão:** a Carton Wega **nunca usou o cadastro de matrizes/facas do
Calcgraf** (todo o subsistema `FichaTec*` + `CodFaca` está vazio). O número da
faca **não existe de forma estruturada** na base de cálculo. Portanto, NÃO há
"re-exportação da matriz real" possível a partir do Calcgraf — o dado não está lá.

## Onde a matriz REALMENTE está (e já está no Vizor)

O número da faca vem do **PDF da Ordem de Produção do G-Print** (sistema de
produção, distinto da base de cálculo), na linha "Matriz". O parser de PDF do
Vizor (`gprint-parser.ts`) já extrai esse valor e o grava como **tag `[Matriz]`**
no campo `observacoes` da `OrdemProducao` (padrão documentado no steering
`pcp-modulo` §1.6 / §3.2).

Dado real conferido em produção (Neon, empresa Carton Wega `75848e24-...`):
- **379 OPs**, das quais **289 (76%)** têm a tag `[Matriz]` preenchida.
- Exemplos: OP 10099 (ref 3193) → `2529B - COM BRAILLE`; OP 10101 (ref 3203) →
  `2210B - COM BRAILLE`; OP 10103 (ref 3208) → `2405B - COM RELEVO E`; 2186B,
  2242B, 1241B etc.

Extração: `observacoes.match(/\[Matriz\]\s*(.+?)(?:\n|$)/i)`.

## Recomendação de uso (sem schema novo)

Para exibir/pesquisar a matriz no Vizor (Central do Produto v2, detalhe da OP,
etc.), **ler a tag `[Matriz]` das OPs do produto** — é a única fonte real e já
está populada. Não criar importador do Calcgraf para isso (não há dado).

Se, no futuro, o cliente quiser um CADASTRO estruturado de facas (com
imagem/dimensões/vínculo ao produto), isso é um cadastro NOVO no Vizor
(`ModeloFaca` já existe no schema, hoje vazio) alimentado manualmente ou pela
própria tag `[Matriz]` — não por importação do Calcgraf.
