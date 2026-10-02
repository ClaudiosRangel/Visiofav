# Estudo de Impacto — Migração TOTAL Calcgraf → Vizor (Carton Wega)

> Objetivo do cliente: operar SOMENTE no Vizor — cálculo gráfico, geração de OP,
> controle de pedidos, PCP, controle de estoque e emissão de NF-e. Este
> documento é o estudo de impacto (foco em PRODUTOS) + o plano de migração dos
> demais cadastros. Base: diagnóstico SOMENTE LEITURA da produção (Neon) em
> {DATA} e exploração do backup Calcgraf (SQL Server restaurado).

## 1. Retrato ATUAL da produção (Vizor, empresa Wega 75848e24-…)

| Item | Qtd | Observação |
|---|---|---|
| Produtos | **330** | Códigos são os DO CALCGRAF (ex.: `3918`, `1051437`, `16279`) |
| Produtos que já têm OP | **239** | A base nasceu majoritariamente das importações de PDF de OP |
| OPs por status | PLANEJADA 37 · CONCLUIDA 168 · LIBERADA 83 · EM_PRODUCAO 4 · CANCELADA 1 | |
| OPs em programação ATIVA | **87** (PROGRAMADA/LIBERADA/EM_PRODUCAO) | São as sensíveis — não podem ser afetadas |
| Estruturas (BOM) | **0** | Produção roda sem BOM formal no Vizor hoje |
| Roteiros | **0** | Idem — as etapas vêm do PDF da OP |
| Clientes | **1** | Praticamente campo verde |
| Fornecedores | **0** | Campo verde |
| Centros de Produção | **57** | Já cadastrados |

## 2. Descoberta-chave que define o risco dos PRODUTOS

**Os produtos do Vizor JÁ USAM os códigos do Calcgraf.** A amostra mostra
códigos como `3918`, `1051437`, `16279` — idênticos aos do sistema legado. Isso
porque a importação de PDF de OP já trouxe o produto com seu código original.

Consequência direta para a importação de produtos do Calcgraf:
- **A colisão por código NÃO é exceção — é a regra.** Importar `CalculoAcabados`
  do Calcgraf pelo mesmo código vai bater com os 330 existentes, e 239 deles
  têm OP (87 em programação ativa).
- Portanto a estratégia "prefixo CG-" (criar `CG-3918`) **duplicaria** produtos
  que já existem com o código real — PIOR do que não importar, pois criaria dois
  cadastros para o mesmo item e confundiria OP/estoque/NF-e.

## 3. Classificação do impacto por cadastro

### 3.1 PRODUTOS — ALTO risco, requer de-para por código (NÃO prefixar)
A regra correta aqui é o OPOSTO da do resto da migração:
- **Produto do Calcgraf cujo código JÁ existe no Vizro (maioria)**: NÃO criar.
  Opcionalmente, ENRIQUECER campos vazios do existente (NCM, unidade, família,
  atributos gráficos) — **apenas campos nulos/vazios, nunca sobrescrever** o que
  a produção já usa. Isso é um UPDATE seletivo e precisa de aprovação item a item
  do que será preenchido.
- **Produto do Calcgraf cujo código NÃO existe no Vizor**: candidato a INSERT
  (produtos antigos/históricos que nunca entraram em OP no Vizor). Volume provável:
  milhares (Calcgraf tem histórico grande). Decidir SE vale trazer histórico que
  nunca será produzido — ou importar só os ATIVOS.
- **NUNCA** DELETE; **NUNCA** UPDATE de código/nome de produto em OP.
- Entregável obrigatório antes de qualquer escrita: relatório de-para
  (existe/novo/colisão), destacando quais colisões tocam OP ativa.

### 3.2 CLIENTES — risco BAIXO (campo verde: só 1 hoje)
- Origem Calcgraf: `Nomes` + `NomesxClientes` (~1.497). AINDA NÃO EXPORTADOS.
- Como só há 1 cliente no Vizor, a colisão é mínima. De-para por CNPJ/CPF
  (chave natural) para não duplicar o único existente.
- `Cliente` é compartilhado com Vendas/Financeiro/NF-e — importar com cuidado de
  deduplicar por documento. INSERT de novos; nunca sobrescrever.

### 3.3 VENDEDORES — risco BAIXO
- Origem: `NomesxVendedores` (~39). AINDA NÃO EXPORTADOS.
- No Vizor viram usuários/representantes. Mapear para o cadastro de vendedor do
  Portal Representante. INSERT de novos.

### 3.4 FORNECEDORES — risco BAIXO (0 hoje)
- Origem: `Fornecedores` (383). AINDA NÃO EXPORTADOS. Campo verde. De-para por CNPJ.

### 3.5 Cadastros de apoio ao orçamento — JÁ FEITO / baixo risco
- Tipos de embalagem (12) ✅ importados. Preços de MP (1.767) ✅ importados.
  Mapa de Custos (custo/hora) ✅ importado. Centros de produção: 57 já existem.
- Atividades de acabamento (`Atividades` 68), Suportes/Formatos de papel: podem
  ser importados para enriquecer o orçamento (baixo risco — cadastros auxiliares).

## 4. O que PRECISA ser exportado do Calcgraf (ainda não temos)

Os JSONs atuais em `cartoon/export/` cobrem custeio/orçamento. Para a migração
TOTAL faltam exportar do SQL Server:
- `Nomes` + `NomesxClientes` + `NomesxVendedores` (clientes/vendedores).
- `Fornecedores` + `Contatos` + `Enderecos`.
- `CalculoAcabados` / `CalculoHeader` + filhas (produtos acabados reais + cálculos).
- `PedidoHeader`/`PedidoItem`/`PedidoVenda` (pedidos — se migrar histórico).
- `OpHeader`/`OpItem`/`OpLote`/`OpItemEstrutura` (OPs — se migrar histórico).
- `NotasFiscais`/`DadosFiscaisNFe`/`FinTitulos` (fiscal/financeiro — se migrar).
- `Atividades`, `Suportes`, `FormatosPapel` (apoio) — já exportados.

## 5. DECISÕES DO USUÁRIO (definidas)

1. **SEM histórico agora.** Não migrar pedidos/OPs/NF-e históricos. O Vizor começa
   "do zero operacional"; o Calcgraf permanece como consulta do passado.
2. **Produtos — tabelas auxiliares a analisar.** Antes de importar qualquer coisa
   ligada a produto, ANALISAR as tabelas auxiliares do Calcgraf que se ligam ao
   produto (atributos gráficos, estrutura/BOM, roteiro, etc.) e verificar se dá
   para VINCULAR ao produto JÁ EXISTENTE no Vizor sem conflito de código/ids de
   referência/relacionamento. Só vincular/enriquecer o existente; não duplicar.
3. **Tudo em paralelo, com virada cirúrgica e faseada:**
   - Fase atual: continua importando PDF de OP normalmente (produção não para) E
     começa a TESTAR o cálculo de orçamento no Vizor.
   - Critério de avanço: só passa para a próxima etapa quando o **cálculo de
     orçamento do Vizor bater 100% com o Calcgraf**.
   - Etapa seguinte: gerar a OP pelo próprio Vizor (deixando de depender do PDF
     do Calcgraf). Transição cirúrgica, sem quebrar a programação atual.
4. **NF-e é passo posterior.** Foco AGORA = orçamento gráfico. PORÉM: analisar
   TODOS os PDFs que o cliente mandou (OP, NF-e, pré-cálculo) para mapear quais
   DADOS o Vizor precisa ter/capturar para gerar esses documentos corretamente —
   garantindo que esses dados venham do próprio Vizor quando chegar a hora.

## 5.1 Prioridade imediata — ORÇAMENTO bater 100%

Para o cálculo do Vizor igualar o Calcgraf, falta (ver docs/calcgraf-plano-de-acao.md
Bloco 2 — calibração):
- **Golden cases**: ~10 orçamentos reais do Calcgraf (entrada → preço final) e,
  idealmente, 1-2 "Emissão de Pré-Cálculos" (memória de cálculo com horas por
  máquina, kg de papel/tinta, valores parciais). **AINDA NÃO temos esse PDF** no
  projeto (só PDFs de OP, que são o resultado da produção, não a memória do preço).
- **Calibrar** fórmulas de planificação dos TipoEmbalagem (hoje genéricas 2D/3D)
  e parâmetros de perda/aproveitamento/setup até diferença ≤ 0,5% no unitário.
- **Cadastrar** a TabelaMargem da Wega (markup/impostos/comissão/CEV) e conferir
  os 57 centros/velocidade/setup usados no orçamento.

## 5.2 Análise dos PDFs do cliente (para o Vizor gerar documentos corretos)

PDFs disponíveis no projeto: 11 de OP (GPrint), 6 NF-e, 1 CT-e, apresentação RKW.
Objetivo: mapear, por tipo de documento, quais CAMPOS o Vizor precisa ter
cadastrados/capturar para reproduzir o documento. Falta o PDF de Pré-Cálculo
(memória de cálculo) — pedir ao cliente, é o golden case que mais acelera a
calibração do orçamento.

## 6. Plano de migração proposto (ordem por risco crescente)

1. **Clientes + Fornecedores + Vendedores** (campo verde) — exportar `Nomes`/
   `Fornecedores`, de-para por CNPJ, INSERT. Baixo risco. Habilita pedidos/NF-e.
2. **Cadastros de apoio** (Atividades/Suportes/Formatos) — enriquecer orçamento.
3. **Produtos — de-para primeiro (dry-run), decisão item a item.** Só então
   INSERT dos ATIVOS inexistentes + enriquecimento seletivo dos existentes.
   NUNCA tocar produto em OP ativa.
4. **Estoque inicial** (saldos) — contagem/implantação na data de corte.
5. **Configuração de NF-e** (certificado/série/tributação) — pré-requisito fiscal.
6. **Virada**: a partir da data de corte, OP/pedido/NF-e nascem no Vizor.
   Histórico fiscal/financeiro: decidir manter legado como consulta (recomendado)
   ou migrar (requer plano contábil específico).

## 7. Salvaguardas (válidas para toda escrita em produção)

- Dry-run por padrão; `--apply` explícito; tudo em transação; empresaId explícito.
- Produto/Cliente/Fornecedor: SÓ INSERT de chave inexistente; enriquecimento só
  de campos vazios, nunca sobrescrever dado em uso; NUNCA DELETE.
- Validar em LOCAL antes de produção; connection string Neon via env, fora do git.
- Nenhuma operação pode afetar as 87 OPs em programação ativa.

## 5.3 Mapeamento do PDF de OP (GPrint) → cadastros do Vizor

Análise do "OP 2849" (ICEFRESH / Cartucho Super Fresh 90G) — representativo do
que o cálculo gráfico da Wega carrega. Cada bloco do documento mapeia para um
dado que o Vizor precisa TER (cadastro) ou CAPTURAR (no orçamento) para
reproduzir o cálculo e, depois, gerar a própria OP.

| Bloco no PDF | Conteúdo | Dado no Vizor | Status |
|---|---|---|---|
| Cabeçalho | Cliente (ICEFRESH, cód 903), Vendedor (JOAO BORTOLOMAI), Pedido, Cálculo | `Cliente`, `vendedorId`, nº pedido/cálculo | Cliente/vendedor FALTAM importar (1 cliente hoje) |
| Produto/Descrição | "Cartuchos" + descrição + Cód. Acabado (4590) | `TipoEmbalagem` (✅12) + descrição + código produto | Tipo ✅; produto 4590 já pode existir (de PDF) |
| Formato Final | 38 x 28 x 177 mm (L×P×A) | `medidas` do orçamento (L/A/P) | Entrada do usuário ✅ |
| Plano/Material | Suporte "Stora Enzo Bobina 222", formato 720×1000, Kg, aproveitamento | `PrecoMateriaPrima` (papel) + Suporte/Formato | Preços ✅; cadastro de Suporte/Formato FALTA (apoio) |
| Mont./Tiragem/Cores | Montagem 7x3, tiragem 115.239, cores 5x0+V+V | aproveitamento/imposição + policromia | Lógica do motor ✅; calibrar fórmulas |
| Máq. Impressão | Heidelberg CD 5/7cores + tempos Fixo 03:30 / Variável 10:29 | `CentroProducao` (velocidade/setup/custoHora) | 57 centros ✅; conferir tempos/setup por centro |
| Acabamentos | Cortadeira, Verniz, Bobst E, Destacar, AFT70 Coladeira (c/ tempos) | `CentroProducao` de acabamento + `Atividades` (catálogo) | Centros ✅; `Atividades`(68) FALTA importar |
| Materiais (consumo) | Papel 18.419 kg, tintas (Escala CMYK, Pantone), vernizes, cola, faca | cálculo de consumo (motor) + preços | Motor ✅; preços ✅ |
| Faca/Matriz | "FACA NOCA COM DESTACADOR", "Matriz 2551B" | item FACA (preço) + tag matriz | Preço FACA ✅ (via Itc) |
| Embalagem | "Caixa Padrão com 900 un" | acabamento/embalagem | Lógica ✅ |

### Conclusão do mapeamento (foco orçamento)
O que o Vizro JÁ tem para reproduzir o cálculo: tipos de embalagem, preços de
material (papel/tinta/verniz/cola/faca), custo/hora dos centros (via Mapa), e o
motor de cálculo. O que FALTA para o orçamento ficar fiel e autossuficiente:
1. **`Atividades` (68)** — catálogo de acabamentos do Calcgraf (ex.: "AFT70
   Coladeira", "Verniz UV Total", "Destacar"). Alimenta a lista de acabamentos
   do orçamento. BAIXO risco (cadastro auxiliar). → exportar + importar.
2. **`Suportes`/`FormatosPapel`** — catálogo de papéis/formatos (ex.: Stora Enzo
   222 72cm). Hoje o preço existe, mas o cadastro estruturado (gramatura/largura)
   ajuda o cálculo de consumo. BAIXO risco. → exportar + importar.
3. **Clientes/Vendedores** — para o orçamento ter cliente/vendedor reais
   (hoje texto livre). BAIXO risco (campo verde). → exportar + importar.
4. **TabelaMargem da Wega** (markup/impostos/comissão/CEV) — formação de preço.
   → cadastrar (dado comercial, não vem do Calcgraf estruturado).
5. **Calibração por golden cases** — depende do PDF de "Emissão de Pré-Cálculos"
   (memória de cálculo), que ainda NÃO temos. É o que mais acelera o "bater 100%".

### Pedido ao cliente (desbloqueia a calibração)
- **1-2 "Emissão de Pré-Cálculos"** do Calcgraf (menu Vendas → Orçamento →
  Emissão de Pré-Cálculos) — a memória de cálculo detalhada de um orçamento real.
- **~10 orçamentos reais** (entrada + total/unitário/margem/CM) variados.

## 5.4 Exportação dos cadastros (FEITO) — cartoon/export

`scripts/exportar-calcgraf-cadastros.mjs` (sqlcmd + FOR JSON PATH, saída `-u`
UTF-16 → UTF-8 para PRESERVAR acentos; capturar stdout corrompia). Exportados:

| Arquivo | Registros | Observação |
|---|---|---|
| Atividades.json | 68 | catálogo de operações (impressão + acabamento) |
| SuportesFull.json | 78 | papéis/substratos (gramaturas, formatos, fibra) |
| FormatosPapelFull.json | 42 | formatos de folha |
| Clientes.json | 1497 | Nomes ⋈ NomesxClientes (codEmpresa = Nomes.Codigo) |
| Vendedores.json | 39 | Nomes ⋈ NomesxVendedores |
| Fornecedores.json | 276 | Nomes com TipoFornecedor |

**Clientes: 1.024 têm CNPJ/CPF; 473 NÃO têm** (cadastros antigos/incompletos).
Chave de de-para = CNPJ/CPF normalizado. Decisão pendente: importar só os 1.024
com documento (base limpa p/ NF-e — recomendado) OU todos os 1.497 deduplicando
por nome (traz incompletos). Acentos conferidos OK (0 corrompidos).

**Ligação da coluna (armadilha):** em `NomesxClientes`, a coluna chamada
`codEmpresa` é na verdade o `Nomes.Codigo` (nome enganoso); `CodTCF` é quase
sempre NULL. Em `NomesxVendedores`, a chave é `Codigo` = `Nomes.Codigo`.

PRÓXIMO: escrever a fase de importação (clientes/vendedores/fornecedores +
atividades/suportes/formatos) no importador, DRY-RUN primeiro contra produção
(de-para por CNPJ; Vizor tem só 1 cliente / 0 fornecedores hoje = baixo risco).

## 5.5 Importação de clientes/fornecedores (FEITO em produção)

Fase `cadastros` do importador (`--fase cadastros`, com `--dry-run` opcional e
`comRetry` para reconectar quando o pooler do Neon fecha a conexão em loops
longos). De-para por documento (cpfCnpj/cnpj); SÓ INSERT de doc inexistente.

- **Clientes**: 1.015 importados (só os com CNPJ/CPF, decisão do usuário) + 1
  pré-existente = **1.016** em produção. 0 colisões.
- **Fornecedores**: **232** importados. 0 colisões (campo verde).
- Vendedores (39): NÃO importados como Cliente/Fornecedor — viram usuários/
  representantes (Portal Rep), fase dedicada futura.
- Endereço dos clientes NÃO veio (está em `Enderecos`, outra tabela) — importar
  depois se a NF-e exigir. Hoje cliente tem nome/doc/IE/contato.

Lição (armadilha Neon): loop sequencial de ~1.000+ upserts derruba a conexão
("Server has closed the connection"). O `comRetry` (reconecta + reexecuta, 4x)
resolve; a idempotência (find antes de create) permite retomar sem duplicar.

PRÓXIMO (orçamento bater 100%): importar Atividades/Suportes/Formatos (fase a
escrever) + cadastrar TabelaMargem + CALIBRAR com os "Pré-Cálculos" (aguardando
prints do usuário).
