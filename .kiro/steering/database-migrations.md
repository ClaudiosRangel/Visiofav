# Migrações de Banco de Dados — Processo Obrigatório

## Contexto

Este projeto **não usa `prisma migrate deploy`** em produção. O Render/Neon
roda apenas `npx tsx prisma/migrate-prod.ts` no start do container (ver
`package.json` → `scripts.start` e `Dockerfile` → `CMD`). O `prisma/migrations/`
(pasta de migrations formais do Prisma) é usado **somente em desenvolvimento
local** via `npx prisma migrate dev`.

Isso significa: **alterar `schema.prisma` e gerar uma migration local NÃO
propaga para produção automaticamente.** Se o `migrate-prod.ts` não for
atualizado manualmente no mesmo commit, o banco de produção fica dessincronizado
do schema — causando erros como "column does not exist" ou "table does not
exist" que só aparecem depois do deploy, em uso real.

Esse padrão de bug já ocorreu repetidamente neste projeto (módulo de
conferência, módulo fiscal inteiro, Multi-CD, PDV, vendas avançadas, etc.).

## Regra obrigatória

**Toda vez que `prisma/schema.prisma` for alterado (nova tabela, nova coluna,
novo índice, nova FK, rename, remoção), o mesmo commit DEVE incluir a
alteração equivalente em `prisma/migrate-prod.ts`.**

Antes de fazer commit + push de qualquer alteração que toque `schema.prisma`:

1. Rodar `npx prisma migrate dev` localmente para validar a migration e
   gerar o SQL de referência em `prisma/migrations/<timestamp>_.../migration.sql`.
2. Copiar o `ALTER TABLE`/`CREATE TABLE`/`CREATE INDEX` equivalente para
   `prisma/migrate-prod.ts`, seguindo o padrão idempotente já usado no
   arquivo:
   - `CREATE TABLE IF NOT EXISTS`
   - `ADD COLUMN IF NOT EXISTS`
   - `CREATE INDEX IF NOT EXISTS`
   - Para `ADD CONSTRAINT` (FK): envolver em `try/catch` individual, pois
     Postgres não tem `ADD CONSTRAINT IF NOT EXISTS`.
   - Para renomear/remover coluna com dados existentes: usar `DO $$ BEGIN
     ... END $$` verificando `information_schema.columns` antes de agir,
     e preservar dados com `UPDATE` antes de `DROP COLUMN` quando aplicável
     (nunca perder dado real sem confirmar antes).
3. Testar localmente rodando `npx tsx prisma/migrate-prod.ts` duas vezes
   seguidas contra o banco local — deve rodar sem erro e ser **idempotente**
   (segunda execução não deve falhar nem duplicar nada).
4. Só then commitar `schema.prisma` + `migrate-prod.ts` juntos.

## Como verificar se produção está alinhada com o schema

Use `prisma migrate diff` comparando o banco real de produção com o
schema — é a forma confiável de detectar dívida técnica acumulada (muito
mais confiável que `prisma migrate status`, que não reflete a realidade
aqui já que não usamos `migrate deploy`):

```bash
# No Web Shell do Render (produção), ou localmente com DATABASE_URL de produção:
npx prisma migrate diff --from-url "$DATABASE_URL" --to-schema-datamodel=prisma/schema.prisma --script
```

- Saída vazia / "This is an empty migration." → produção 100% alinhada.
- Saída com SQL → há diferença. **Não aplique esse SQL diretamente com
  `prisma db execute`** sem revisão — o script bruto do Prisma pode tentar
  `SET NOT NULL`/`DROP COLUMN` em dados que violam a constraint (já ocorreu:
  erro `Null constraint failed`). Sempre:
  1. Verificar se há registros reais nas tabelas afetadas antes de aplicar
     qualquer `DROP COLUMN`/`DROP TABLE` (query `SELECT COUNT(*)`).
  2. Verificar se há `NULL` nas colunas que receberiam `SET NOT NULL`.
  3. Escrever a correção manualmente no `migrate-prod.ts` (idempotente,
     preservando dados), testar localmente, comitar, só depois aplicar.

## Checklist rápido antes de qualquer push que toque schema.prisma

- [ ] `schema.prisma` alterado?
- [ ] `migrate-prod.ts` atualizado com o `ALTER TABLE`/`CREATE TABLE`
      equivalente, de forma idempotente?
- [ ] Testado localmente rodando `npx tsx prisma/migrate-prod.ts` 2x sem erro?
- [ ] Se a alteração remove/renomeia coluna com dados reais: dado
      preservado (migrado, não descartado) antes do `DROP`?
- [ ] Commit inclui `schema.prisma` + `migrate-prod.ts` juntos (não em
      commits separados)?

Se qualquer item acima não puder ser confirmado, **pare e resolva antes do
push** — não assuma que "vai dar certo em produção porque funcionou local".
Local e produção só ficam sincronizados se o `migrate-prod.ts` for mantido
manualmente em dia.
