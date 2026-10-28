# Requirements Document

Desmembramento de etapa informando QUANTIDADE e TIRAGEM por parte (PCP).

## Introduction

Ao desmembrar uma etapa de produção entre máquinas (`POST /pcp/etapas/:id/
desmembrar`), hoje o sistema aceita apenas UMA base de divisão por vez —
`QUANTIDADE` (unidades) **ou** `TIRAGEM` (folhas) — e valida que a soma das
partes é igual ao total daquela base. O modal do frontend tem duas abas
separadas. O cliente (Caio, Carton Wega) relatou o erro "Informe pelo menos 2
partes com centro e quantidade" ao tentar dividir informando os dois valores.

Na lógica real da gráfica, ao desmembrar entre máquinas cada parte tem a sua
própria quantidade (unidades) E a sua própria tiragem (folhas), e esses valores
podem ser DIFERENTES entre as partes. O modelo atual não guarda tiragem por
etapa (`EtapaOrdemProducao` só tem `quantidadePrevista`, um número).

Objetivo: permitir desmembrar informando, por parte, quantidade E tiragem,
validando as duas somas contra os totais da etapa, e persistindo ambos.
Recurso ADITIVO e NÃO-REGRESSIVO: desmembrar por uma base só continua
funcionando como hoje.

## Glossary
- **Quantidade (un):** unidades do produto da OP.
- **Tiragem (folhas):** folhas/passagens de máquina — base de tempo de impressão.
- **Parte:** cada fragmento criado no desmembramento (vira uma etapa nova num
  centro de produção).

## Requirements

### Requirement 1: Guardar tiragem prevista por etapa

**User Story:** Como planejador, quero que cada etapa-parte guarde tanto a
quantidade quanto a tiragem previstas, para refletir a divisão real entre
máquinas.

#### Acceptance Criteria
1. The system SHALL adicionar o campo `tiragemPrevista Decimal?` (nullable) em
   `EtapaOrdemProducao` (`tiragem_prevista`), sem remover/alterar
   `quantidadePrevista`.
2. The migration SHALL ser idempotente em `prisma/migrate-prod.ts` (ADD COLUMN
   IF NOT EXISTS), no mesmo commit do schema.
3. WHEN uma etapa não tem `tiragemPrevista` THEN o comportamento legado
   SHALL ser preservado (null = sem tiragem específica).

### Requirement 2: Desmembrar informando quantidade E tiragem por parte

**User Story:** Como planejador, quero informar, em cada parte do
desmembramento, a quantidade e a tiragem daquela parte, podendo ser diferentes
entre as partes.

#### Acceptance Criteria
1. The endpoint `POST /pcp/etapas/:id/desmembrar` SHALL aceitar um modo em que
   cada parte traz `{ centroProducaoId, quantidade, tiragem, observacao? }`.
2. WHEN o modo "qtd+tiragem" é usado THEN o sistema SHALL validar que a soma das
   `quantidade` das partes = quantidade total da etapa E a soma das `tiragem`
   das partes = tiragem total da etapa (tolerância 0.01), retornando 400 com
   mensagem clara qual soma não bateu.
3. WHEN alguma parte estiver sem `quantidade` ou sem `tiragem` (no modo
   qtd+tiragem) THEN o sistema SHALL retornar 400 explicando o campo faltante.
4. The system SHALL criar uma etapa-parte por parte, gravando
   `quantidadePrevista` e `tiragemPrevista` com os valores informados.
5. The system SHALL manter o modo de base ÚNICA (`QUANTIDADE` ou `TIRAGEM`)
   existente funcionando igual (não-regressão) — o novo modo é opcional.
6. The rateio do tempo de operação das partes SHALL ser proporcional à TIRAGEM
   da parte sobre a tiragem total (a tiragem dita o tempo de máquina); se não
   houver tiragem, cair no rateio por quantidade (legado).
7. Permissão `podeDesmembrar` e isolamento `empresaId` SHALL ser preservados.
   Auditoria (`LogOrdemProducao`) SHALL registrar o desmembramento com as duas
   bases.

### Requirement 3: Frontend — modal de desmembrar com os dois campos

**User Story:** Como planejador, quero um modal onde informo quantidade e
tiragem de cada parte, com validação visual das duas somas.

#### Acceptance Criteria
1. The modal de desmembrar SHALL oferecer um modo "Quantidade + Tiragem" em que
   cada parte tem DOIS campos (quantidade e tiragem) além do centro.
2. The modal SHALL mostrar as DUAS somas em tempo real (Σqtd / total un e
   Σtiragem / total folhas) e só habilitar "Desmembrar" quando ambas baterem.
3. The modal SHALL manter os modos "Por Quantidade" e "Por Tiragem" existentes
   (abas), adicionando o novo modo sem quebrar os anteriores.
4. The total de quantidade e de tiragem da etapa SHALL ser exibido para
   referência (como já é hoje por base única).

### Requirement 4: Não-regressão

**User Story:** Como responsável técnico, quero que o novo modo seja aditivo,
para o desmembramento por base única continuar funcionando e tudo compilar.

#### Acceptance Criteria
1. The system SHALL preservar o comportamento atual de desmembrar por base
   única.
2. The system SHALL manter `get_diagnostics` limpo e compilar (back: tsc/
   prisma generate; front: build Next).
3. Schema + `migrate-prod.ts` SHALL ir no mesmo commit (steering
   database-migrations).
