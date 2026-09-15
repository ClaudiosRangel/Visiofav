# Requirements Document

Bloco F2 — Vendas com Emissão Real de NF-e (fluxo 100% ponta a ponta)

## Introduction

O Vizor já emite NF-e real na SEFAZ: o motor `nfeEmissaoService.emitir()` executa
o fluxo completo (cálculo de tributos → XML layout 4.00 → validação XSD →
assinatura A1 → transmissão SEFAZ → autorização/rejeição), com contingência
automática, cancelamento, Carta de Correção (CC-e), inutilização e DANFE PDF.
Porém o fluxo **não está fechado ponta a ponta**: alguns caminhos de venda não
emitem documento fiscal, a amarração pós-autorização (financeiro + estoque) é
feita de forma inline e duplicada em cada rota, não há reprocessamento de nota
rejeitada, e a organização da NF-e está atrás da maturidade que o CT-e (já em
produção) alcançou.

O CT-e (modelo 57 v4.00, em produção real) serve de **modelo estrutural de
referência** — não para cópia literal, mas para nivelar a NF-e ao mesmo padrão:
ponto único de captação de título financeiro na autorização
(`gerar-titulo-de-documento.service.ts`, idempotente e protegido), ambiente
derivado do próprio documento (não de env global), validação pré-transmissão, e
ciclo gravar → editar → transmitir com detalhe/XML/consulta.

Este bloco (F2) fecha as lacunas para que **toda venda que deve emitir NF-e/NFC-e
o faça de forma consistente**, com a autorização amarrando financeiro e estoque
por um caminho único, rejeições tratadas de forma compreensível, e a nota
rejeitada reprocessável. Segue as regras do projeto: migração idempotente no
mesmo commit, isolamento multi-tenant por `empresaId`, e reuso da infra fiscal
compartilhada (SEFAZ client, xml-signer, certificado).

## Glossary

- **Documento fiscal (DocumentoFiscal)**: registro único para NF-e/NFC-e/CT-e/
  MDF-e (campo `tipo`, `modelo` 55/65/57/58). Guarda status, chave, protocolo,
  XML e totais.
- **Autorização**: retorno da SEFAZ com cStat 100 — o documento passa a
  `AUTORIZADO` e vale como documento fiscal.
- **Rejeição de negócio**: retorno da SEFAZ com cStat da série 2xx (dados
  inválidos, cadastro, regra fiscal) — distinta de falha de infraestrutura
  (108/109/999, que dispara contingência).
- **Ponto único de captação**: serviço `gerar-titulo-de-documento.service.ts`
  que transforma um documento fiscal AUTORIZADO em título financeiro, de forma
  idempotente (não duplica) e protegida (falha não desfaz a autorização,
  registra `PendenciaTituloFiscal`). Hoje ligado só ao CT-e.
- **Baixa de estoque**: dedução do saldo do produto na saída. Para empresa sem
  WMS, via `registrarMovimentacao` (kardex); para empresa com WMS, via onda de
  separação/expedição (fora do escopo de emissão).
- **NFC-e (modelo 65)**: documento fiscal do consumidor final, emitido no PDV.
- **Reprocessamento**: reeditar uma NF-e rejeitada e retransmitir, sem criar um
  novo registro do zero.
- **Ambiente**: 1=Produção, 2=Homologação. Deve ser derivado do próprio
  documento/empresa, não de variável de ambiente global.

## Requirements

### Requirement 1: Cobertura de emissão em todos os fluxos de venda

**User Story:** Como usuário do sistema, quero que todo tipo de venda que exige
documento fiscal o emita de fato, para não ter venda efetivada sem nota.

#### Acceptance Criteria

1. WHEN uma venda é finalizada no PDV THEN o sistema SHALL emitir NFC-e
   (modelo 65) via o motor de emissão, vinculando o documento fiscal à venda do
   PDV e registrando a chave de acesso.
2. WHEN uma encomenda é faturada THEN o sistema SHALL emitir a NF-e da venda
   pelo mesmo caminho de emissão das demais vendas.
3. WHEN um pedido de venda é efetivado (fluxo já existente) THEN o sistema SHALL
   continuar emitindo a NF-e como hoje, sem regressão.
4. WHERE a empresa não tem certificado digital ou dados fiscais obrigatórios
   configurados THE sistema SHALL bloquear a emissão com mensagem clara do que
   falta, sem efetivar a venda parcialmente.
5. WHERE a venda é uma consignação (remessa ou acerto) THE sistema SHALL permitir
   emitir a NF-e correspondente (remessa/retorno/venda) pelo mesmo motor — o
   detalhamento de CFOPs de consignação é tratado no design.

### Requirement 2: Amarração pós-autorização por ponto único (financeiro + estoque)

**User Story:** Como mantenedor, quero que a autorização de uma NF-e gere o
título financeiro e a baixa de estoque por um caminho único e consistente, para
eliminar a duplicação inline e a divergência entre fluxos.

#### Acceptance Criteria

1. WHEN uma NF-e de venda é autorizada THEN o sistema SHALL gerar o título de
   contas a receber através do ponto único de captação
   (`gerar-titulo-de-documento.service.ts`), de forma idempotente (não duplica
   para o mesmo documento) e usando o `empresaId` do documento.
2. WHEN a geração do título falha THEN o sistema SHALL não desfazer a
   autorização fiscal e SHALL registrar `PendenciaTituloFiscal` para
   reprocessamento (mesmo padrão do CT-e).
3. WHEN uma NF-e de venda é autorizada para empresa sem WMS THEN o sistema SHALL
   registrar a baixa de estoque via `registrarMovimentacao` (kardex), de forma
   idempotente por documento.
4. WHERE a empresa usa WMS THE sistema SHALL não baixar estoque na emissão (a
   baixa ocorre na expedição), preservando o comportamento atual.
5. WHEN uma NF-e autorizada é cancelada THEN o sistema SHALL cancelar os títulos
   financeiros em aberto vinculados ao documento e SHALL reverter a baixa de
   estoque quando esta tiver sido feita na emissão.

### Requirement 3: Tratamento de rejeições compreensível

**User Story:** Como usuário, quero entender por que a SEFAZ rejeitou minha nota,
para poder corrigir, em vez de ver apenas um código técnico.

#### Acceptance Criteria

1. WHEN a SEFAZ rejeita uma NF-e com cStat de negócio THEN o sistema SHALL
   registrar o cStat e o xMotivo e SHALL apresentar ao usuário uma mensagem
   explicativa (mapeando os códigos de rejeição mais comuns para orientação de
   correção), preservando o código técnico para auditoria.
2. WHEN a rejeição ocorre durante a efetivação de uma venda THEN o sistema SHALL
   não efetivar a venda (sem gerar título nem baixar estoque) e SHALL retornar a
   rejeição de forma clara.
3. WHERE a resposta da SEFAZ é falha de infraestrutura (não rejeição de negócio)
   THE sistema SHALL seguir o fluxo de contingência existente (não tratar como
   rejeição do usuário).

### Requirement 4: Reprocessamento de NF-e rejeitada

**User Story:** Como usuário, quero corrigir e reenviar uma NF-e rejeitada, para
não precisar refazer todo o lançamento.

#### Acceptance Criteria

1. WHEN uma NF-e está REJEITADA THEN o sistema SHALL permitir retransmiti-la após
   correção, reaproveitando o mesmo registro de documento fiscal (sem duplicar
   numeração indevidamente).
2. WHEN a retransmissão é autorizada THEN o sistema SHALL aplicar a mesma
   amarração pós-autorização do Requirement 2 (título + estoque).
3. WHERE a NF-e já está AUTORIZADA ou CANCELADA THE sistema SHALL recusar o
   reprocessamento.

### Requirement 5: Ambiente derivado do documento (correção do cStat 252)

**User Story:** Como mantenedor, quero que o ambiente (produção/homologação) da
NF-e venha do próprio documento/empresa, para evitar a divergência de ambiente
que já causou rejeição no CT-e (cStat 252).

#### Acceptance Criteria

1. WHEN uma NF-e é transmitida THEN o sistema SHALL resolver a URL do webservice
   da SEFAZ usando o mesmo ambiente (`tpAmb`) gravado no documento, não uma
   variável de ambiente global isolada.
2. WHEN um evento (cancelamento, CC-e, inutilização) é transmitido THEN o
   sistema SHALL usar o ambiente do documento correspondente.

### Requirement 6: Consulta, XML e detalhe (nivelamento ao CT-e)

**User Story:** Como usuário, quero consultar a situação da NF-e na SEFAZ, ver o
detalhe e baixar o XML, para ter as mesmas capacidades que já tenho no CT-e.

#### Acceptance Criteria

1. WHEN o usuário abre uma NF-e THEN o sistema SHALL fornecer um endpoint de
   detalhe com dados do documento, itens e eventos.
2. WHEN o usuário solicita o XML de uma NF-e autorizada THEN o sistema SHALL
   fornecer o XML autorizado (nfeProc) para download.
3. WHEN o usuário solicita a consulta da situação THEN o sistema SHALL consultar
   a SEFAZ pela chave de acesso e retornar o status atual.
4. WHEN o usuário abre a listagem de NF-e no frontend THEN a tela SHALL oferecer
   DANFE (PDF), download de XML e as ações conforme o status, com os rótulos de
   status alinhados aos valores gravados no backend.

### Requirement 7: Isolamento, integridade e testes

**User Story:** Como administrador, quero que a emissão respeite o isolamento por
empresa e que o fluxo esteja coberto por testes.

#### Acceptance Criteria

1. WHEN qualquer operação de NF-e (emitir, consultar, cancelar, reprocessar) é
   executada THEN o sistema SHALL operar somente sobre documentos da empresa da
   sessão.
2. WHEN o schema é alterado THEN a migração equivalente idempotente SHALL ser
   incluída no `migrate-prod.ts` no mesmo commit.
3. WHEN o núcleo de mapeamento de rejeição e a geração de título de NF-e são
   implementados THEN SHALL haver testes unitários cobrindo os casos principais,
   e um teste QA E2E do fluxo de emissão (ou seed equivalente) SHALL validar a
   amarração ponta a ponta sem depender de transmissão real à SEFAZ em ambiente
   de teste.
