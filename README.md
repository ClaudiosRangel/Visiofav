# VisioFab WMS - Backend

API REST com Fastify + Prisma + PostgreSQL.

## Setup Completo

```bash
# 1. Instalar dependências
npm install

# 2. Subir PostgreSQL (Docker)
docker-compose up -d

# 3. Gerar client Prisma
npx prisma generate

# 4. Criar tabelas no banco (migration)
npx prisma migrate dev --name init

# 5. Popular banco com dados iniciais
npx prisma db seed

# 6. Rodar em dev
npm run dev
```

API disponível em `http://localhost:3333`

Login padrão: `admin@visiofab.com` / `123456`

## Endpoints

### Auth
- `POST /api/auth/login`
- `POST /api/auth/registrar`

### Cadastros
- `GET/POST/PUT/DELETE /api/centros-distribuicao`
- `GET/POST/PUT/DELETE /api/depositos`
- `GET/POST/PUT/DELETE /api/zonas`
- `GET/POST/PUT/DELETE /api/estruturas`
- `GET/POST/PUT/DELETE /api/produtos`
- `GET/POST/PUT/DELETE /api/funcionarios`
- `GET/POST/PUT/DELETE /api/docas`
- `GET/POST/PUT/DELETE /api/enderecos`
- `POST /api/enderecos/gerar` (geração automática)
- `GET/POST/PUT/DELETE /api/veiculos`

### Operacional
- `GET/POST/DELETE /api/ordens-servico`
- `PATCH /api/ordens-servico/:id/status`

### Utilitário
- `GET /api/health`

## Ferramentas
- `npx prisma studio` — Interface visual do banco (porta 5555)
- `npx prisma db seed` — Repopular dados iniciais
