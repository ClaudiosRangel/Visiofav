# Planilha de Pedidos (Solicitação de Orçamento) — Carton Wega

> Referência para o formulário do portal (spec comercial-portal-solicitacao,
> bloco B2 Fase B). Transcrito das 3 imagens enviadas pelo Caio em 29/10/2026
> (é um Google Forms/Sheets que os representantes preenchem hoje).

## Colunas da planilha (ordem original)

| # | Coluna | Tipo | Observação |
|---|--------|------|------------|
| 1 | Carimbo de data/hora | timestamp | automático (criadoEm) |
| 2 | Endereço de e-mail | texto | e-mail do representante que lançou |
| 3 | Já é cliente da empresa? | Sim/Não | decide se cadastra cliente novo |
| 4 | Razão Social e Nome Fantasia | texto | nome do cliente |
| 5 | CNPJ | texto | consulta Receita (Fase A) |
| 6 | Mercado atuante | texto | segmento (ex.: Alimentício, Cosméticos) |
| 7 | Estado de origem / Cidade | texto | UF + cidade |
| 8 | Entrega | Única / Fracionada | |
| 9 | Se fracionada, de quantos em quantos dias? | texto | só quando Fracionada |
| 10 | Prazo de pagamento desejado | texto | ex.: "28/35", "30 em 30" |
| 11 | Nome do produto | texto | |
| 12 | Data de validade | texto/data | validade do produto/proposta |
| 13 | Variação de arte (um ou mais p/ emitir, quantas?) | texto/int | nº de variações de arte |
| 14 | Tipo de pedido | select | Cartucho / Sacola / Caixa / Envelope (= tipo de embalagem) |
| 15 | Exportação | Comum / Exportação | |
| 16 | Quantidade | int | tiragem |
| 17 | Cartão | texto | Duplex / Triplex / Kraft+Cartolina... |
| 18 | Gramatura | texto | ex.: "300", "120 g/m²" |
| 19 | Cartão FSC (Conselho de Manejo Florestal)? | Sim/Não | certificação FSC |
| 20 | Medidas (Comprimento x Largura x Altura mm) | texto | C x L x A |
| 21 | Corte Interno verso | Sim/Não | |
| 22 | Passtime (Sim ou Não) | Sim/Não | janela/visor |
| 23 | Acabamentos | texto | Verniz UV, Laminação, Faca Nova... |
| 24 | Matriz (nova ou usa anterior? se tiver, qual?) | texto | nº da matriz/faca |
| 25 | Acabamento manual? | Sim/Não | colagem manual, etc. |
| 26 | Quant. deseja por volume | texto/int | peças por caixa/volume |
| 27 | Anexo 1 / Anexo 2 | url | links (Drive / WhatsApp) de arte |
| 28 | Discriminação | texto longo | itens do pedido multi-item (produto/desc/qtd) |
| 29 | Observações | texto longo | observações livres |
| 30 | Representante | select | nome do representante (vem do token no portal) |

## Mapeamento para o Vizor (SolicitacaoOrcamentoRep)

Campos que JÁ existem no model: cliente (clienteId/clienteNome/clienteCpfCnpj),
tipoEmbalagem (= #14), medidas L/A/C (= #20, mas a planilha usa texto único),
quantidade (= #16), acabamentos (= #23 texto), observacoes (= #29),
produtoId (repetição). Representante/e-mail vêm do token (#2, #30).

Colunas NOVAS a adicionar (Fase B — todas nullable, aditivas, não-regressão):

| Campo Prisma | Coluna planilha | Tipo |
|---|---|---|
| `tipoPedido` | (classificação) | VARCHAR(12) REPETICAO/MOSTRUARIO/NOVO |
| `jaCliente` | #3 | BOOLEAN |
| `mercado` | #6 | VARCHAR(120) |
| `ufOrigem` | #7 | VARCHAR(2) |
| `cidade` | #7 | VARCHAR(120) |
| `tipoEntrega` | #8 | VARCHAR(20) UNICA/FRACIONADA |
| `entregaFracionadaDias` | #9 | VARCHAR(60) |
| `prazoPagamento` | #10 | VARCHAR(60) |
| `produtoNome` | #11 | VARCHAR(200) |
| `dataValidade` | #12 | VARCHAR(60) (texto; a planilha mistura formatos) |
| `variacoesArte` | #13 | VARCHAR(60) |
| `exportacao` | #15 | VARCHAR(12) COMUM/EXPORTACAO |
| `cartao` | #17 | VARCHAR(120) |
| `gramatura` | #18 | VARCHAR(60) (texto; planilha usa "300"/"120 g/m²") |
| `cartaoFsc` | #19 | BOOLEAN |
| `medidasTexto` | #20 | VARCHAR(120) (C x L x A em texto, além dos numéricos já existentes) |
| `corteInternoVerso` | #21 | BOOLEAN |
| `passtime` | #22 | BOOLEAN |
| `matriz` | #24 | VARCHAR(200) |
| `acabamentoManual` | #25 | BOOLEAN |
| `quantidadePorVolume` | #26 | VARCHAR(60) |
| `anexo1Url` / `anexo2Url` | #27 | VARCHAR(500) |
| `discriminacao` | #28 | TEXT (itens multi-item em texto) |

Notas:
- **Tipo de pedido** (Repetição/Mostruário/Novos) é a classificação pedida pelo
  Caio na tela de lançamento — não aparece como coluna explícita na planilha
  (hoje é inferido), mas vamos capturar explicitamente.
- Vários campos são **texto livre** na planilha (gramatura, medidas, prazo) — no
  Vizor mantemos texto p/ não perder fidelidade, com os campos numéricos já
  existentes (medidaLargura/Altura/Comprimento) preenchidos quando possível.
- `gramatura` já existe numérico em outros models; aqui na solicitação do portal
  é texto (fidelidade à planilha). Não confundir com a gramatura do cálculo.
- Anexos: por ora só URL (o representante cola o link do Drive/WhatsApp). Upload
  de arquivo real pode vir depois (fora do escopo B2).
