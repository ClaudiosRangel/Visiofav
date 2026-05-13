---
inclusion: auto
---

# Padrões de Teste e Deploy — VisioFab WMS Backend

## Deploy para Produção

O deploy é automático via push para `main`:

```bash
git add -A
git commit -m "feat/fix: descrição"
git push origin main
```

- **Hosting**: Render (https://visiofav.onrender.com)
- **Migração**: Executada automaticamente no start via `prisma/migrate-prod.ts`
- **Seed**: Incluir novos seeds no `migrate-prod.ts` (idempotente com `IF NOT EXISTS`)
- **Tempo de deploy**: ~2 minutos após push

## Regra Obrigatória de Testes

Toda nova funcionalidade ou correção de bug DEVE incluir testes automatizados antes do deploy.

## Quando Criar Testes

1. **Novas rotas/endpoints**: Teste unitário para o service + teste de integração para a rota
2. **Alteração em rotas existentes**: Teste de regressão garantindo que o comportamento anterior não quebrou
3. **Serviços puros (sem I/O)**: Property-based tests com fast-check (mínimo 100 iterações)
4. **Correções de bug**: Teste que reproduz o bug antes do fix (deve falhar sem o fix, passar com o fix)

## Framework

- **Backend**: Vitest + fast-check (já configurado)
- **Comando**: `npx vitest run` (deve passar antes de qualquer commit)

## Estrutura de Testes

- Testes ficam ao lado do arquivo testado: `service.ts` → `service.test.ts`
- Testes de integração em `src/tests/integration/`
- Property tests incluem tag: `Feature: {nome}, Property {N}: {título}`

## Checklist Pré-Deploy

Antes de fazer push para main:
1. ✅ `npx vitest run` passa sem erros
2. ✅ Novos endpoints têm pelo menos 1 teste de happy path
3. ✅ Alterações em endpoints existentes têm teste de regressão
4. ✅ Serviços puros têm property tests para propriedades críticas

## O Que Testar em Cada Endpoint

- **Resposta de sucesso** (status code + formato do body)
- **Validação de input** (campos obrigatórios, tipos incorretos)
- **Erros esperados** (404, 409, 400 com mensagens corretas)
- **Efeitos colaterais** (invalidação de cache, criação de registros relacionados)
