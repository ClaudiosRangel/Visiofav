# Infraestrutura e Deploy — VisioFab Backend

## Produção

| Recurso | Provedor | URL/Endpoint |
|---------|----------|--------------|
| **API Backend** | Render | https://visiofav.onrender.com |
| **Banco de Dados** | Neon (PostgreSQL serverless) | Configurado em env vars do Render |
| **Migração** | Automática no start | `prisma/migrate-prod.ts` |

### ⚠️ Atenção — Planos e Persistência

- **Render**: verificar se está no plano pago (free congela após 15min inatividade)
- **Neon**: verificar se está no plano pago (free tier pausa após inatividade, limite de storage)
- Para ERP em produção com dados reais, ambos devem ser planos pagos para garantir disponibilidade e persistência

## Desenvolvimento Local

| Recurso | URL |
|---------|-----|
| Backend API | http://localhost:3333 |
| PostgreSQL | localhost:5432 |
| Database | visiofab_wms |

## Comandos

| Ação | Comando |
|------|---------|
| Dev server | `npm run dev` |
| Build | `npm run build` |
| Prisma generate | `npx prisma generate` |
| Migration dev | `npx prisma migrate dev` |
| Limpar PCP | `npx tsx tests/limpar-pcp.ts` |
| Limpar OPs | `npx tsx scripts/limpar-ops.ts` |

## Stack

- **Runtime**: Node.js + tsx (TypeScript execution)
- **Framework**: Fastify
- **ORM**: Prisma 6
- **Validação**: Zod
- **Linguagem**: TypeScript 100%

## Deploy

- Push para branch `main` → deploy automático no Render
- Migrations rodam automaticamente no start do container
- Env vars configuradas no dashboard do Render

## Projetos Relacionados

- Frontend Web: `VisioFab.Wms.Front` (Vercel)
- App Mobile: `VisioFab.App` (Expo/EAS Build)
- Frontend legado: `VisioFab.Web` (Firebase → migrado)
