# Requirements Document

Central de Documentos Financeiros — Fase D5 (Exportação Contábil)

## Introduction

A Fase D5 fecha o programa: exporta a contabilidade da empresa para consumo
externo — o arquivo legal **SPED Contábil (ECD)** e uma **exportação genérica em
CSV** (diário, razão, balancete) que serve para importar em sistemas de
contabilidade de mercado (Domínio, Fortes, Alterdata).

O projeto já tem um gerador de ECD (`sped-ecd.generator.ts`) com toda a estrutura
de blocos (0, I, J, 9) montada e testada, mas hoje ele **deriva os lançamentos de
documentos fiscais e usa um plano de contas hardcoded** — não usa a contabilidade
real criada na D4 (`ContaContabil`, `LancamentoContabil`, `PartidaContabil`). A
D5 **religa o gerador à fonte de dados correta**: quando a empresa tem
contabilidade configurada (plano de contas + lançamentos no período), o ECD usa
esses dados reais; quando não tem, o comportamento atual (derivar de documentos
fiscais) é preservado como fallback, sem quebrar empresas que ainda não usam o
módulo contábil.

Além do ECD, a D5 entrega uma exportação **CSV** do diário, do razão e do
balancete do período, para os escritórios que preferem importar em seu próprio
software contábil.

Segue as regras do projeto: reuso do gerador e do writer SPED existentes,
isolamento multi-tenant, e sem alteração de schema (a D5 só lê o que a D4 grava).

## Glossary

- **ECD (SPED Contábil)**: arquivo digital legal de escrituração contábil,
  com blocos 0 (identificação), I (plano de contas + lançamentos), J
  (demonstrações) e 9 (encerramento). Encoding ISO-8859-1, campos separados por
  pipe, linhas CR+LF.
- **Bloco I / I050**: plano de contas contábil no ECD.
- **Bloco I / I200 e I250**: lançamentos contábeis (cabeçalho do lote diário +
  partidas débito/crédito).
- **Contabilidade real (D4)**: dados de `ContaContabil` (plano de contas),
  `LancamentoContabil` e `PartidaContabil` gravados pela D4.
- **Fallback fiscal**: comportamento atual do gerador — deriva lançamentos de
  documentos fiscais autorizados e usa um plano de contas padrão, quando a
  empresa não tem contabilidade real no período.
- **Exportação CSV**: arquivos texto (diário, razão, balancete) para importação
  em software contábil de mercado.

## Requirements

### Requirement 1: ECD a partir da contabilidade real (D4)

**User Story:** Como contador, quero que a ECD use o plano de contas e os
lançamentos contábeis reais da empresa, para que a escrituração reflita a
contabilidade efetivamente registrada.

#### Acceptance Criteria

1. WHEN a empresa possui contas contábeis (D4) cadastradas THEN o gerador de ECD
   SHALL usar essas contas no registro I050 (plano de contas), com código,
   natureza, indicador analítica/sintética e nível.
2. WHEN a empresa possui lançamentos contábeis (D4) LANCADOS no período THEN o
   gerador SHALL usar esses lançamentos e suas partidas nos registros I200/I250,
   agrupados por data, respeitando débito/crédito de cada partida.
3. WHEN os lançamentos reais são usados THEN a soma dos débitos de cada lote
   diário SHALL igualar a soma dos créditos (partidas dobradas preservadas da D4).
4. WHERE a empresa não tem contas nem lançamentos contábeis no período THE gerador
   SHALL manter o comportamento de fallback fiscal atual (derivar de documentos
   fiscais + plano de contas padrão), sem erro.

### Requirement 2: Preservação da estrutura ECD existente

**User Story:** Como mantenedor, quero que a religação à D4 não quebre a estrutura
de blocos nem os testes existentes do gerador ECD.

#### Acceptance Criteria

1. WHEN a ECD é gerada THEN os blocos 0, I, J e 9 SHALL continuar presentes e na
   ordem correta, com o registro 0000 identificando LECD.
2. WHEN o gerador roda com uma empresa sem contabilidade real THEN a saída SHALL
   permanecer equivalente ao comportamento anterior (fallback fiscal), mantendo os
   testes existentes verdes.
3. WHEN a ECD usa dados reais THEN o registro I200 de cada lote SHALL ter o valor
   total do lote e o I250 SHALL registrar cada partida com sua conta e indicador
   D/C.

### Requirement 3: Exportação CSV (diário, razão, balancete)

**User Story:** Como contador que usa outro software, quero exportar diário,
razão e balancete em CSV, para importar na minha contabilidade.

#### Acceptance Criteria

1. WHEN o usuário exporta o diário de um período THEN o sistema SHALL gerar um CSV
   com uma linha por partida (data, lançamento, conta, débito/crédito, valor,
   histórico), isolado por empresa.
2. WHEN o usuário exporta o balancete de um período THEN o sistema SHALL gerar um
   CSV com uma linha por conta (código, nome, débitos, créditos, saldo), e o total
   de débitos SHALL igualar o total de créditos (tolerância R$ 0,01).
3. WHEN não há lançamentos no período THEN o sistema SHALL gerar um CSV apenas com
   o cabeçalho (sem erro).

### Requirement 4: Acesso e isolamento

**User Story:** Como administrador, quero que a exportação respeite o acesso e o
isolamento por empresa.

#### Acceptance Criteria

1. WHEN qualquer exportação (ECD ou CSV) é solicitada THEN o sistema SHALL usar
   somente dados da empresa da sessão.
2. WHEN a exportação é solicitada THEN o sistema SHALL exigir o período (ano/mês
   ou intervalo de datas) e retornar o arquivo para download.
3. WHERE a empresa da sessão difere da empresa dos dados THE sistema SHALL não
   incluir dados de outra empresa no arquivo.
