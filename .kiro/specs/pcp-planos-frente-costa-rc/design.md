# Design — PCP: Planos de Produção, Frente/Costa e Requisição de Corte (RC)

## Overview

Visão geral

Três entregas incrementais sobre o módulo PCP existente, projetadas para
**estender sem reescrever** e com **compatibilidade retroativa total** (o
módulo roda em produção na Carton Wega):

- **Fase A — RC** (independente): model `RequisicaoCorte` + rotas + PDF +
  botão na aba Cortadeira. Não toca em OP/etapas, risco mínimo.
- **Fase B — Planos** (base): model `PlanoOrdemProducao` + `planoId` nullable
  na etapa + parser extrai `planos[]` + confirmação amarra etapa→plano +
  painel exibe o plano.
- **Fase C — Frente/Costa**: reaproveita o Plano (tipo `FACE`); só o gatilho
  de cores `NxM` e a geração dos dois planos FACE na confirmação.

A ordem A → B → C permite entregar valor cedo (RC) e isolar o risco maior
(planos tocam o parser e a confirmação, que são código sensível).

## Architecture

As três fases se encaixam na arquitetura existente do PCP (Fastify + Prisma
no backend; Next.js/Mantine no frontend):

- **Backend**: novos models em `schema.prisma` (+ `migrate-prod.ts`
  idempotente); extensão do parser `gprint-parser.ts`; extensão da rota de
  confirmação `importacao-op.routes.ts`; novo arquivo de rotas
  `requisicao-corte.routes.ts`; novo service de PDF
  `requisicao-corte-pdf.service.ts`; extensão do painel em
  `etapa-operacional.routes.ts`.
- **Frontend**: extensão de `programacao/page.tsx` (badge de plano + modal
  RC) e, se necessário, da tela de preview de importação.
- **Isolamento multi-tenant**: toda rota nova filtra `empresaId` explícito;
  planos e etapas isolam via relacionamento com a OP.

## Princípio de compatibilidade (invariante do projeto)

> `planoId = NULL` SEMPRE significa "plano único / sem plano" e DEVE se
> comportar exatamente como o sistema atual.

Isso é verificado em cada ponto que lê etapas: painel, conclusão de OP,
reordenação de fila, apontamento. Nenhum desses pontos passa a **exigir**
plano — plano é informação aditiva opcional.

---

## Fase B — Planos de Produção

### Modelo de dados

```prisma
model PlanoOrdemProducao {
  id              String        @id @default(uuid())
  ordemProducaoId String        @map("ordem_producao_id")
  ordemProducao   OrdemProducao @relation(fields: [ordemProducaoId], references: [id], onDelete: Cascade)
  empresaId       String        @map("empresa_id")
  nome            String        @db.VarChar(60)   // "TAMPA", "CAIXA", "FRENTE", "COSTA"
  tipo            String        @default("COMPONENTE") @db.VarChar(20) // COMPONENTE | FACE
  formato         String?       @db.VarChar(40)   // "780 x 480"
  cores           String?       @db.VarChar(30)   // "4x0 +V", "7x0"
  tiragem         Decimal?      @db.Decimal(12, 4)
  montagem        String?       @db.VarChar(30)   // "2x2"
  faceDeId        String?       @map("face_de_id") // COSTA → FRENTE
  faceDe          PlanoOrdemProducao?  @relation("FaceParDeDe", fields: [faceDeId], references: [id])
  faces           PlanoOrdemProducao[] @relation("FaceParDeDe")
  sequencia       Int           @default(1)
  criadoEm        DateTime      @default(now()) @map("criado_em")

  etapas          EtapaOrdemProducao[]

  @@index([ordemProducaoId])
  @@map("plano_ordem_producao")
}
```

`EtapaOrdemProducao` ganha:

```prisma
  planoId         String?             @map("plano_id")
  plano           PlanoOrdemProducao? @relation(fields: [planoId], references: [id], onDelete: SetNull)
```

E `OrdemProducao` ganha a relação inversa `planos PlanoOrdemProducao[]`.

**onDelete escolhido:**
- OP → Plano = `Cascade` (apagar OP apaga planos; já é o padrão das filhas).
- Plano → Etapa = `SetNull` (apagar um plano NÃO apaga a etapa; a etapa só
  perde o vínculo e vira "sem plano"). Isso protege apontamentos: nunca se
  perde uma etapa por mexer em plano.

### migrate-prod.ts (idempotente)

```sql
CREATE TABLE IF NOT EXISTS "plano_ordem_producao" (
  "id" TEXT PRIMARY KEY,
  "ordem_producao_id" TEXT NOT NULL,
  "empresa_id" TEXT NOT NULL,
  "nome" VARCHAR(60) NOT NULL,
  "tipo" VARCHAR(20) NOT NULL DEFAULT 'COMPONENTE',
  "formato" VARCHAR(40),
  "cores" VARCHAR(30),
  "tiragem" DECIMAL(12,4),
  "montagem" VARCHAR(30),
  "face_de_id" TEXT,
  "sequencia" INTEGER NOT NULL DEFAULT 1,
  "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "plano_ordem_producao_ordem_producao_id_idx"
  ON "plano_ordem_producao"("ordem_producao_id");
ALTER TABLE "etapa_ordem_producao" ADD COLUMN IF NOT EXISTS "plano_id" TEXT;
-- FKs em try/catch individuais (Postgres não tem ADD CONSTRAINT IF NOT EXISTS)
```

As FKs (`plano → OP`, `plano → plano`, `etapa → plano`) são adicionadas cada
uma em bloco `DO $$ ... EXCEPTION WHEN duplicate_object THEN null $$` ou
try/catch, seguindo o padrão do arquivo. Testar rodando 2× local.

### Parser: extração de planos

Hoje `parseGprintPdf` retorna `etapas[]` achatado e `extrairTiragem` já lê a
tabela "Plano". A mudança:

1. Nova função `extrairPlanos(texto)` que lê a tabela de planos (as duas
   tabelas que o GPrint imprime: a de **materiais por plano** — "Plano /
   Material / Formato / Quant(Kg)" — e a de **processo por plano** — "Plano /
   Formato / Mont. / Tiragem / Cores / Máq.Impr. / Chapa / Acabamento").
   Casa as duas pela coluna "Plano" (nome). Retorna:

```ts
interface PlanoOp {
  nome: string            // "TAMPA", "CAIXA", "BOLSA"
  formato: string | null  // "780 x 480"
  cores: string | null    // "4x0 +V"
  tiragem: number | null
  montagem: string | null
  acabamentoTexto: string | null  // texto bruto da coluna Acabamento
  etapas: EtapaOp[]       // etapas derivadas do acabamentoTexto
}
```

2. As **etapas** de cada plano vêm da coluna "Acabamento" daquele plano:
   `"Cortadeira (Grande), Guilhotina maior, Verniz, SG (Laminadora),
   Dayuan (Corte e Vinc, Destacar"` → split por vírgula (respeitando os
   parênteses) → cada token vira uma `EtapaOp` com `tipo` classificado pela
   mesma heurística atual (`cortadeira|corte`, `colagem`, `verniz`, etc.).
   A ordem na string define a `sequencia` dentro do plano.

3. `DadosOpGprint` ganha `planos: PlanoOp[]`. **`etapas[]` continua existindo**
   e é preenchido como hoje quando NÃO há múltiplos planos — garante
   não-regressão para OS de plano único. Quando há planos, `etapas[]` pode ser
   a concatenação (compatível) e a confirmação prioriza `planos[]`.

4. **Fallback de plano único**: se `extrairPlanos` encontrar 0 ou 1 plano, a
   confirmação usa o caminho atual (etapas achatadas, sem criar PlanoOrdem).
   Só cria planos quando há 2+.

**Cuidado de regressão (regra do steering):** rodar
`npx tsx scripts/testar-todos-pdfs-op.ts` antes e depois; a contagem de
etapas de cada PDF versionado não pode cair. Novos testes em
`gprint-parser.test.ts` para multi-plano / plano único / frente-costa.

### Confirmação da importação (importacao-op.routes.ts)

No laço que cria etapas (`for i of dados.etapas`), introduzir:

- Se `dados.planos.length >= 2`:
  1. Para cada plano, criar `PlanoOrdemProducao` (nome, tipo, formato, cores,
     tiragem, montagem, sequencia, empresaId da OP).
  2. Criar as etapas daquele plano com `planoId` apontando para o plano
     recém-criado. O vínculo de centro (`centrosVinculados`) continua pelo
     índice global da etapa — a UI de preview precisará indexar as etapas de
     forma consistente (ver nota de frontend/preview abaixo).
- Se `< 2`: caminho atual intacto (nenhum PlanoOrdem criado, `planoId` NULL).

Na **reimportação** (substituição total): já há
`etapaOrdemProducao.deleteMany`. Adicionar
`planoOrdemProducao.deleteMany({ where: { ordemProducaoId: op.id } })` ANTES
de recriar. Como etapa→plano é `SetNull`, apagar planos primeiro e depois
etapas (ou vice-versa) não corre risco; recriamos ambos do zero a partir do
novo PDF. Todas as travas de confirmação existentes permanecem inalteradas.

### Painel de Programação

`GET /pcp/programacao/painel` (etapa-operacional.routes.ts): o `findMany` de
etapas passa a incluir `plano: { select: { id, nome, tipo } }` (ou um
`select` já existente estendido). Isso evita N+1. A resposta por etapa ganha
`plano?: { nome, tipo }`.

Frontend (`programacao/page.tsx`): onde renderiza a OP na linha da fila,
acrescentar o sufixo `· {plano.nome}` quando `etapa.plano` existir. Sem
plano → render atual inalterado. Nenhuma mudança na lógica de drag-and-drop,
apontamento ou conclusão.

### Conclusão da OP

Nenhuma mudança. A regra em `PATCH /etapas/:id/concluir`
(`todasEtapas.every(e => e.status === 'CONCLUIDA')`) já olha todas as etapas
da OP por `ordemProducaoId` — abrange todos os planos automaticamente.

---

## Fase C — Frente e Costa

Depende da Fase B (planos). É um caso particular de plano.

### Detecção

No parser, ao processar um plano cuja coluna Cores case `(\d)\s*x\s*(\d)` com
**ambos > 0** (ex.: `7x5`), marcar `plano.frenteCosta = true` e guardar
`coresFrente = "7x0"`, `coresCosta = "5x0"`. A tiragem `qtd x 2` é lida como
base `qtd` (o `x 2` indica as duas passagens, não dobra a quantidade).

### Geração na confirmação

Quando um plano vem com `frenteCosta`, em vez de 1 plano criar 2 do tipo
`FACE`:
- "FRENTE" (cores = coresFrente, tiragem = qtd, sequencia n)
- "COSTA" (cores = coresCosta, tiragem = qtd, sequencia n+1,
  `faceDeId` = id da FRENTE)

### Distribuição de etapas entre FRENTE/COSTA — REGRA CONFIRMADA

**Decisão do usuário (confirmada): FACE só na IMPRESSÃO (pai e filhos).** A
retiração (tira-retira) é um fenômeno da impressora — a mesma folha passa 2×
na máquina (daí `tiragem qtd x 2` e cores `NxM`). Do acabamento em diante
(Cortadeira, Guilhotina, Verniz, Destacar, Coladeira, etc.) a folha já é UMA
só; não existe "frente" e "costa" para apontar separadamente nesses centros.

Portanto:
- **Centro de IMPRESSÃO**: desmembra em 2 etapas FACE (FRENTE e COSTA),
  controláveis individualmente (iniciar/apontar/concluir por face) — reusa o
  layout pai/filho da Fase B. O pai é a OP; os dois filhos são FRENTE/COSTA.
- **Demais centros (acabamento/corte/colagem)**: UMA etapa única, SEM
  desmembrar por face. Não ganham subitens FRENTE/COSTA. A etapa fica
  vinculada ao plano FRENTE (default) só para efeito de dado; visualmente é
  uma linha normal (sem pai/filho) nesses centros.
- A OP só conclui quando TODAS as etapas (as 2 faces da impressão + as etapas
  únicas dos demais centros) fecharem (regra `every(CONCLUIDA)` já existente).

Exemplo real — **OP-3092 (PROBELLE), plano único CARTUCHO, cores `5x1 +V+V`,
tiragem `16.500 x 2`**:
- Impressão (KBA Rapida 75): PAI "OP 3.092 — CARTUCHOS..." + filhos
  "FRENTE" (5 cores, 16.500) e "COSTA" (1 cor, 16.500), ações habilitadas.
- Cortadeira (Grande), Guilhotina maior, Verniz, Verniz UV Total, Bobst E,
  Destacar, AFT70 (Coladeira): cada uma como ETAPA ÚNICA (sem face), tiragem
  base 16.500.

NOTA: a OP-3092 NÃO é multi-componente (é um único plano CARTUCHO que vira
2 FACES). Diferente da OP-3133, que tem 3 COMPONENTES (TAMPA/CAIXA/BOLSA),
cada um peça física distinta com material/tiragem próprios.

A OP permanece com um único `numero`. Os dois planos FACE são apenas filhos
da mesma OP → `@@unique([empresaId, numero])` nunca é violado.

### Painel

- Na IMPRESSÃO: FRENTE/COSTA aparecem como linhas-filho (badge `violet`
  "FACE", ex.: "OP 3.092 · FRENTE") sob a linha-pai da OP — reusa o layout
  pai/filho e o drag/recolher já implementados na Fase B.
- Nos demais centros: linha única sem pai/filho (render legado), badge de
  plano opcional só informativo.

---

## Fase A — Requisição de Corte (RC)

### Modelo de dados

```prisma
model RequisicaoCorte {
  id                  String   @id @default(uuid())
  empresaId           String   @map("empresa_id")
  numero              String   @db.VarChar(20)   // "49/2026"
  ordemProducaoId     String?  @map("ordem_producao_id")
  dataSolicitacao     DateTime @map("data_solicitacao")
  dataCorte           DateTime? @map("data_corte")
  requisitante        String   @db.VarChar(120)
  fabricanteCartao    String   @map("fabricante_cartao") @db.VarChar(120)
  fornecedor          String?  @db.VarChar(120)
  larguraBobinaCm     Decimal? @map("largura_bobina_cm") @db.Decimal(10, 2)
  gramaturaG          Decimal? @map("gramatura_g") @db.Decimal(10, 2)
  tamanhoCorteCm      Decimal? @map("tamanho_corte_cm") @db.Decimal(10, 2)
  formatoCorte        String?  @map("formato_corte") @db.VarChar(60)
  qtdFolhasCortadeira Int?     @map("qtd_folhas_cortadeira")
  textoGuilhotina     String?  @map("texto_guilhotina") @db.VarChar(120)
  qtdFolhasGuilhotina Int?     @map("qtd_folhas_guilhotina")
  nomeProduto         String   @map("nome_produto") @db.VarChar(200)
  nomeServico         String   @map("nome_servico") @db.VarChar(200)
  pesoKg              Decimal? @map("peso_kg") @db.Decimal(12, 2)
  instrucoesRefile    String?  @map("instrucoes_refile") @db.Text
  status              String   @default("ABERTA") @db.VarChar(20)
  criadoPorId         String?  @map("criado_por_id")
  criadoEm            DateTime @default(now()) @map("criado_em")
  atualizadoEm        DateTime @updatedAt @map("atualizado_em")

  @@index([empresaId])
  @@map("requisicao_corte")
}
```

### Numeração `NN/AAAA`

Sequencial por empresa + ano: no backend, antes de criar, buscar a maior RC
do ano corrente da empresa (`numero LIKE '%/AAAA'`), extrair o prefixo, somar
1. Começa em `1/AAAA`. (Mesmo padrão de "proximoNumero" já usado em OP/avulsas.)

### Rotas (novo arquivo `requisicao-corte.routes.ts`, prefixo `/api/pcp`)

| Método | Rota | Descrição |
|---|---|---|
| GET | `/requisicoes-corte` | Lista (filtro empresaId, busca por numero/produto). |
| GET | `/requisicoes-corte/:id` | Detalhe. |
| POST | `/requisicoes-corte` | Cria (numero auto). |
| PUT | `/requisicoes-corte/:id` | Edita. |
| DELETE | `/requisicoes-corte/:id` | Exclui. |
| GET | `/requisicoes-corte/:id/pdf` | Gera o PDF da 1ª via (pdfkit, aceita token via query p/ abrir em nova aba, igual ao PDF de OP). |

Todas filtram `empresaId` explícito (regra multi-tenant) + `moduloGuard` PCP.
Registrar em `server.ts`.

### PDF da 1ª via (`requisicao-corte-pdf.service.ts`)

pdfkit (já usado em `cte-dacte-pdf.service.ts`). Layout fiel ao FO-002/PCP:
cabeçalho com logo/título "REQUISIÇÃO DE CORTE DE CARTÃO", código do
formulário, "Nº NN/AAAA", selo "1ª VIA", campos em pares rótulo/valor, e o
bloco de instruções de refile em destaque. Fonte do layout: a imagem do
formulário fornecida pelo usuário.

### Frontend

- Modal `AdicionarRC` disparado por um botão "+ Adicionar RC" no card de
  centros do tipo CORTADEIRA no painel (`programacao/page.tsx`). Campos
  conforme o formulário. Botões "Salvar" e "Salvar e Imprimir" (o 2º abre o
  PDF em nova aba após salvar).
- (Opcional) Tela de listagem de RCs em PCP → Cortadeira/RCs, consumindo
  `GET /requisicoes-corte`, com reimpressão.

---

## Data Models

Resumo consolidado dos modelos (detalhados por fase acima):

- **`PlanoOrdemProducao`** (nova tabela `plano_ordem_producao`): plano/
  componente de uma OS. Campos: `id`, `ordemProducaoId` (FK Cascade),
  `empresaId`, `nome`, `tipo` (COMPONENTE|FACE), `formato`, `cores`,
  `tiragem`, `montagem`, `faceDeId` (auto-FK), `sequencia`, `criadoEm`.
- **`EtapaOrdemProducao`** (existente): ganha `planoId` (FK nullable,
  `onDelete: SetNull`). `NULL` = plano único/legado.
- **`OrdemProducao`** (existente): ganha relação inversa
  `planos PlanoOrdemProducao[]`. Nenhum campo removido/alterado.
- **`RequisicaoCorte`** (nova tabela `requisicao_corte`): formulário de corte.
  Campos conforme Fase A acima.

## Components and Interfaces

- **Parser** (`gprint-parser.ts`): nova função pura `extrairPlanos(texto)`;
  `DadosOpGprint` ganha `planos: PlanoOp[]` (aditivo, `etapas[]` preservado).
- **Confirmação** (`importacao-op.routes.ts`): cria `PlanoOrdemProducao` e
  vincula `planoId` nas etapas quando há 2+ planos; reimportação apaga/recria
  planos preservando as travas atuais.
- **Painel** (`etapa-operacional.routes.ts` + `programacao/page.tsx`):
  resposta por etapa ganha `plano?: { nome, tipo }`; UI exibe badge.
- **RC** (`requisicao-corte.routes.ts` + `requisicao-corte-pdf.service.ts`):
  CRUD + PDF; modal no frontend.

## Riscos e mitigação

| Risco | Mitigação |
|---|---|
| Quebrar OPs em produção | `planoId` nullable; `NULL` = comportamento atual; nenhuma migração automática. |
| Regressão no parser (frágil, regex) | Rodar `testar-todos-pdfs-op.ts` antes/depois; novos testes unitários; fallback plano único. |
| Perder apontamento ao reimportar | Nenhuma mudança nas travas atuais; `SetNull` protege etapa de delete por plano. |
| Violar `@@unique(numero)` no frente/costa | Planos são filhos; OP continua registro único. |
| Vazamento multi-tenant | Toda rota nova filtra `empresaId` explícito (não confiar só em prismaScoped). |
| Schema x produção dessincronizado | `migrate-prod.ts` idempotente no mesmo commit; testar 2× local. |

## Pontos a confirmar no detalhamento (tasks)

1. Frente/Costa: as etapas de acabamento comuns ficam só na FRENTE, ou são
   replicadas em cada face? (default proposto: impressão por face, acabamento
   na FRENTE).
2. Preview da importação (frontend): como exibir os planos e permitir o
   usuário revisar/vincular centros por plano (hoje o preview é lista única
   de etapas). Pode exigir ajuste na tela de preview — avaliar o escopo.

## Correctness Properties

Property 1: Legado intacto — toda etapa com `planoId = NULL` se comporta
exatamente como antes da mudança (painel, conclusão, fila, apontamento).
**Validates: Requirements 1.3, 4.2, 5.4**

Property 2: Número único — nenhuma combinação de planos (inclusive FACE) cria
mais de um registro `OrdemProducao` por `(empresaId, numero)`.
**Validates: Requirements 3.3**

Property 3: Não-regressão do parser — para todo PDF versionado, a contagem de
etapas após a mudança é ≥ à contagem antes (nunca perde etapa).
**Validates: Requirements 2.3, 2.5**

Property 4: Conclusão abrangente — a OP só conclui quando todas as etapas de
todos os planos estão CONCLUIDA.
**Validates: Requirements 4.4**

Property 5: Proteção de apontamento — nenhuma operação de plano
(criar/excluir/reimportar) remove etapa com apontamento sem a confirmação já
existente.
**Validates: Requirements 1.5, 5.1, 5.3**

Property 6: Isolamento — nenhuma rota nova retorna dados de outra empresa.
**Validates: Requirements 4.5, 6.4**

## Error Handling

- Reimportação de OP CONCLUIDA/CANCELADA → 409 (bloqueio duro, inalterado).
- Reimportação de OP em andamento/com apontamento → 409
  `CONFIRMACAO_NECESSARIA` (inalterado).
- Parser sem planos reconhecíveis → fallback para etapas achatadas (plano
  único), nunca erro fatal.
- RC: validação Zod dos campos; numeração em transação para evitar colisão de
  sequencial; FK de OP opcional validada quando informada.
- PDF: falha na geração retorna erro legível sem derrubar a rota.

## Testing Strategy

- **Unit (parser)**: casos multi-plano, plano único (não-regressão) e
  frente/costa em `gprint-parser.test.ts`.
- **Regressão de PDFs reais**: `scripts/testar-todos-pdfs-op.ts` antes/depois
  de qualquer mudança no parser.
- **Backend**: `get_diagnostics` nos arquivos tocados; `migrate-prod.ts`
  rodado 2× local (idempotência).
- **Manual/E2E**: importar OS multi-plano, verificar painel; reimportar OS
  legada e confirmar criação de planos; criar e imprimir uma RC.
- **Build**: `npm run build` back e front antes do commit.
