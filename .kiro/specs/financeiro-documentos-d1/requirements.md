# Requirements Document

Central de Documentos Financeiros — Fase D1 — Vizor ERP

## Introduction

Primeira fase do programa "Central de Documentos Financeiros"
(`docs/PROGRAMA-DOCUMENTOS-FINANCEIROS.md`). Eleva o lançamento financeiro ao
nível de mercado: documento **tipado** (o tipo governa o comportamento),
fornecedor **PF ou PJ** (detecção automática CPF/CNPJ), formulário de inclusão
**rico** (4 blocos) e **contratos parcelados** (financiamentos, dívidas a órgãos,
impostos parcelados) consolidados como um todo, não parcelas soltas.

Estende o que já existe: `ContaPagar`/`ContaReceber` (já ricas),
`inclusao-titulo.service.ts` (parcelas + parse de linha digitável, já criado),
`Fornecedor`, `Cliente`, `CategoriaFinanceira`, `CentroCusto`, `ContaFinanceira`.
Segue padrões do projeto: migração idempotente no mesmo commit, isolamento
multi-tenant, Zod, Fastify, Prisma, Mantine 7, QA Python+Playwright.

Fora de escopo (fases seguintes): IA/OCR (D2), folha (D3), contábil/plano de
contas contábil (D4), exportação ECD (D5).

## Glossary

- **Documento financeiro**: título a pagar ou receber, com um *tipo* que define seu comportamento.
- **Tipo de documento**: NF, NFS, BOLETO, DESPESA, IMPOSTO, FINANCIAMENTO, RECORRENTE, REEMBOLSO, OUTRO.
- **Parceiro**: fornecedor (a pagar) ou cliente (a receber), PF ou PJ.
- **Contrato/Parcelamento**: agrupador de N parcelas de uma mesma dívida (financiamento, imposto parcelado), com total e saldo devedor.
- **PF/PJ**: pessoa física (CPF, 11 dígitos) ou jurídica (CNPJ, 14 dígitos).

## Requirements

### Requisito 1 — Documento financeiro tipado

**User Story:** Como operador financeiro, quero classificar cada lançamento por tipo, para o sistema se comportar de acordo (campos, contabilização futura, relatórios).

#### Acceptance Criteria
1. QUANDO um título é criado ENTÃO o sistema DEVE aceitar um `tipoDocumento` do conjunto (NF, NFS, BOLETO, DESPESA, IMPOSTO, FINANCIAMENTO, RECORRENTE, REEMBOLSO, OUTRO) e um `subtipo` textual opcional.
2. QUANDO nenhum tipo é informado ENTÃO o sistema DEVE assumir `OUTRO` como padrão (retrocompatível com títulos existentes).
3. QUANDO títulos são listados ENTÃO o sistema DEVE permitir filtrar por `tipoDocumento`.
4. QUANDO um título é do tipo `IMPOSTO` ENTÃO o sistema DEVE aceitar campos de guia (código de receita, competência, referência do órgão) sem exigi-los para os demais tipos.

### Requisito 2 — Fornecedor PF ou PJ (detecção automática)

**User Story:** Como operador, quero cadastrar/pagar tanto empresa (CNPJ) quanto pessoa física (CPF), sem escolher o tipo manualmente.

#### Acceptance Criteria
1. QUANDO um documento de parceiro é informado ENTÃO o sistema DEVE detectar automaticamente PF (11 dígitos) ou PJ (14 dígitos) e derivar `tipoPessoa` (FISICA/JURIDICA).
2. QUANDO um CPF ou CNPJ é informado ENTÃO o sistema DEVE validar o dígito verificador e rejeitar documento inválido (422), exceto quando explicitamente marcado sem documento.
3. QUANDO um fornecedor PF é criado ENTÃO o sistema DEVE persisti-lo normalmente (o campo de documento aceita CPF ou CNPJ).
4. QUANDO o documento é validado ENTÃO a normalização (só dígitos) e o cálculo de DV DEVEM ser determinísticos e testáveis isoladamente.

### Requisito 3 — Inclusão de título com parceiro por autocomplete (opção A)

**User Story:** Como operador, quero buscar o parceiro no cadastro e, se não existir, digitar nome+documento livre para uma despesa avulsa.

#### Acceptance Criteria
1. QUANDO o usuário informa `parceiroId` ENTÃO o sistema DEVE vincular ao fornecedor/cliente existente (validado por empresa).
2. QUANDO o usuário informa nome+documento livre (sem `parceiroId`) ENTÃO o sistema DEVE aceitar o lançamento sem exigir cadastro formal, gravando o nome/documento no título.
3. QUANDO o parceiro informado é de outra empresa ENTÃO o sistema DEVE responder 404.

### Requisito 4 — Formulário rico (inclusão de documento)

**User Story:** Como operador, quero um formulário profissional em blocos (dados gerais, financeiros, classificação, anexos), à altura dos melhores ERPs.

#### Acceptance Criteria
1. QUANDO o usuário inclui um documento ENTÃO o sistema DEVE aceitar: tipo, parceiro (ou livre), número do documento, natureza (categoria), data de emissão, vencimento, valor total, parcelas, forma de pagamento, conta bancária, centro de custo, código de barras (boleto), anexo (PDF/imagem) e observações.
2. QUANDO o usuário informa a linha digitável de um boleto ENTÃO o sistema DEVE interpretar e sugerir valor e vencimento (via `interpretarLinhaDigitavel`).
3. QUANDO `parcelas > 1` ENTÃO o sistema DEVE gerar N títulos com vencimentos mensais e valores divididos (resto na 1ª), numerados parcela/total (via `incluirTitulo`).
4. QUANDO um anexo é enviado ENTÃO o sistema DEVE persisti-lo apenas na 1ª parcela (evitar duplicar conteúdo pesado).
5. QUANDO campos inválidos são enviados ENTÃO o sistema DEVE rejeitar (422, "campo: motivo") sem persistir nada.

### Requisito 5 — Contrato / Parcelamento consolidado

**User Story:** Como gestor, quero ver uma dívida parcelada (financiamento de carro, parcelamento de imposto) como um contrato único, com total e saldo, não só parcelas soltas.

#### Acceptance Criteria
1. QUANDO o usuário cria um contrato de parcelamento ENTÃO o sistema DEVE persistir descrição, credor/parceiro, valor total, entrada (opcional), número de parcelas, taxa de juros (opcional), data da 1ª parcela e tipo (FINANCIAMENTO/IMPOSTO/OUTRO).
2. QUANDO um contrato é criado ENTÃO o sistema DEVE gerar os N títulos a pagar vinculados ao contrato, com vencimentos mensais.
3. QUANDO o usuário consulta um contrato ENTÃO o sistema DEVE apresentar total, total pago, saldo devedor e as parcelas com seus status.
4. QUANDO uma parcela vinculada é paga ENTÃO o saldo devedor do contrato DEVE refletir o pagamento.
5. QUANDO o contrato pertence a outra empresa ENTÃO 404.

### Requisito 6 — Frontend

**User Story:** Como operador, quero o formulário rico e a tela de contratos.

#### Acceptance Criteria
1. QUANDO abro "Nova Conta a Pagar/Receber" ENTÃO DEVE aparecer o formulário em 4 blocos (Dados Gerais, Financeiros, Classificação/Pagamento, Anexos) com seleção de tipo, parceiro com autocomplete (busca ou livre), CPF/CNPJ com máscara/validação dinâmica, parcelas e leitura de código de barras.
2. QUANDO acesso o menu Financeiro ENTÃO DEVE haver uma tela de Contratos/Parcelamentos (criar + consultar saldo).
3. QUANDO uma ação de sucesso/erro ocorre ENTÃO o sistema DEVE notificar (verde/vermelho) com Mantine 7 e tokens de tema.

### Requisito 7 — QA automatizado

#### Acceptance Criteria
1. QUANDO a suíte QA roda ENTÃO DEVE existir `test_45_documentos_financeiros.py` cobrindo: inclusão tipada, PF/PJ (detecção+validação), parceiro livre, parcelamento (N títulos), contrato (saldo devedor após pagamento), e isolamento multi-tenant.
2. QUANDO a validação depende de dados fiscais reais ENTÃO usar massa sintética (sem SEFAZ).

### Requisito 8 — Isolamento, validação e migração

#### Acceptance Criteria
1. QUANDO qualquer query é executada ENTÃO DEVE filtrar por `empresaId`.
2. QUANDO uma entrada inválida chega ENTÃO Zod rejeita (422, "campo: motivo").
3. QUANDO o schema muda ENTÃO o mesmo commit atualiza `prisma/migrate-prod.ts` idempotente, testado 2x local.
