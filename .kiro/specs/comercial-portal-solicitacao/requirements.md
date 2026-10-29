# Requirements — Portal: Formulário de Solicitação + CNPJ (Bloco B2 do Módulo Comercial)

## Introdução

O portal do representante já tem um formulário básico de solicitação de orçamento
(`SolicitacaoOrcamentoRep`: cliente, tipo de embalagem, medidas, quantidade,
acabamentos, observações). O Caio quer um formulário **mais rico**, baseado na
planilha de pedidos da Carton Wega, com **cadastro de cliente novo** (quando o
cliente ainda não existe) usando **consulta de CNPJ na Receita** para
autopreencher, e distinção de **tipo de pedido** (Repetição / Mostruário / Novos).

Este bloco (B2) é **faseado** para reduzir risco de schema:
- **Fase A (sem schema):** consulta de CNPJ exposta ao portal + autopreenchimento
  no cadastro de cliente novo (reaproveita `enriquecerCnpj` do módulo prospecção —
  BrasilAPI/CNPJá Open, já autorizado pelo usuário).
- **Fase B (com schema):** campos extras da planilha Wega em
  `SolicitacaoOrcamentoRep` + tipo de pedido. Depende da LISTA FINAL de campos
  (o usuário vai confirmar).

Fonte de verdade: `docs/PROJETO-MODULO-COMERCIAL.md` (bloco B2).

## Requisitos

### Requisito 1: Consulta de CNPJ no portal (Fase A)

**User Story:** Como representante, quero consultar um CNPJ e ter os dados do
cliente preenchidos automaticamente, para cadastrar um cliente novo sem digitar
tudo à mão.

#### Acceptance Criteria

1. QUANDO o representante informar um CNPJ válido (14 dígitos) ENTÃO o sistema
   DEVE retornar razão social, nome fantasia, endereço, telefone e e-mail
   consultados na Receita (via `enriquecerCnpj`).
2. QUANDO o CNPJ for inválido (≠ 14 dígitos) ENTÃO o sistema DEVE retornar erro
   claro sem chamar a API externa.
3. QUANDO a API pública não responder/encontrar ENTÃO o sistema DEVE retornar um
   aviso (não quebrar o fluxo — o representante pode preencher manualmente).
4. A rota DEVE ser autenticada pelo portal (`portalRepAuth`) e isolada por
   empresa/vendedor do token.

### Requisito 2: Cadastro de cliente novo pelo portal (Fase A)

**User Story:** Como representante, quando o cliente ainda não existe, quero
cadastrá-lo direto na solicitação, para não depender do comercial criar antes.

#### Acceptance Criteria

1. QUANDO o representante cadastrar um cliente novo ENTÃO o sistema DEVE criar o
   `Cliente` na `empresaId` do token, com os dados (CNPJ, razão social, fantasia,
   endereço) — reaproveitando o autopreenchimento do Requisito 1.
2. QUANDO já existir um cliente com o mesmo CNPJ na empresa ENTÃO o sistema DEVE
   reaproveitar o existente (não duplicar) e retorná-lo.
3. O cliente criado DEVE respeitar as regras/campos mínimos do cadastro de
   `Cliente` existente (não burlar validações).
4. A criação DEVE ser restrita aos clientes da carteira/empresa do representante
   (isolamento multi-tenant).

### Requisito 3: Campos da planilha Carton Wega no formulário (Fase B)

**User Story:** Como representante, quero um formulário com os campos da planilha
de pedidos da Carton Wega, para registrar a solicitação com todos os dados que o
comercial precisa.

#### Acceptance Criteria

1. O formulário DEVE capturar (lista a CONFIRMAR com o usuário): é cliente?,
   mercado/segmento, UF de origem, cidade, tipo/local de entrega, fracionado
   (S/N), prazo de pagamento, nome do produto, acabamento, precisa amostra (S/N),
   quantidade, gramatura, e os já existentes (tipo de embalagem, medidas,
   observações).
2. O formulário DEVE permitir escolher o **tipo de pedido**: Repetição /
   Mostruário / Novos.
3. QUANDO o tipo for Repetição ENTÃO o formulário DEVE permitir vincular o
   produto/cálculo que será repetido (reaproveita `produtoId` já existente).
4. Os campos novos DEVEM ser persistidos em `SolicitacaoOrcamentoRep` (migração
   idempotente, aditiva — null = legado, não-regressão).
5. O comercial DEVE ver os campos novos ao assumir/precificar a solicitação.

### Requisito 4: Não-regressão e isolamento

#### Acceptance Criteria

1. O formulário básico atual DEVE continuar funcionando (campos novos opcionais).
2. TODA query DEVE filtrar `empresaId` (e `vendedorId` no portal) explicitamente.
3. A consulta de CNPJ NÃO DEVE transmitir dados sensíveis do ERP a terceiros —
   só envia o CNPJ consultado à API pública (dado público).
