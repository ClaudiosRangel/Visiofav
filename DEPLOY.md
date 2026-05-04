# Deploy VisioFab WMS — Guia Completo

## 1. Banco de Dados — Neon (PostgreSQL grátis)

1. Acesse https://neon.tech e crie uma conta
2. Crie um novo projeto: **visiofab-wms**
3. Copie a **Connection String** (formato: `postgresql://user:pass@host/dbname?sslmode=require`)
4. Execute as migrations:

```bash
# No terminal local, com a DATABASE_URL do Neon:
DATABASE_URL="postgresql://user:pass@host/dbname?sslmode=require" npx prisma migrate deploy --schema prisma/schema.prisma
```

5. (Opcional) Seed inicial — criar empresa e usuário admin:

```bash
DATABASE_URL="postgresql://..." npx prisma db seed
```

## 2. Backend — Render (grátis)

1. Acesse https://render.com e crie uma conta
2. Conecte seu repositório GitHub
3. Crie um **New Web Service**:
   - **Root Directory**: `VisioFab.Wms.Back`
   - **Runtime**: Docker
   - **Plan**: Free
4. Configure as **Environment Variables**:
   - `DATABASE_URL` = (cole a connection string do Neon)
   - `JWT_SECRET` = (gere um secret forte: `openssl rand -hex 32`)
   - `PORT` = `3333`
   - `NODE_ENV` = `production`
5. Deploy automático ao push no GitHub

**URL do backend**: `https://visiofab-wms-api.onrender.com`

> ⚠️ O plano grátis do Render tem "cold start" — a primeira requisição após inatividade demora ~30s.

## 3. Frontend WMS — Vercel

1. Acesse https://vercel.com
2. Importe o projeto do GitHub
3. Configure:
   - **Root Directory**: `VisioFab.Wms.Front`
   - **Framework Preset**: Next.js
4. Configure **Environment Variables**:
   - `NEXT_PUBLIC_API_URL` = `https://visiofab-wms-api.onrender.com/api`
5. Deploy automático ao push

**URL do frontend**: `https://visiofab-wms.vercel.app` (ou domínio customizado)

## 4. App Mobile — APK Local

### Pré-requisitos:
- EAS CLI: `npm install -g eas-cli`
- Conta Expo: `eas login`
- Java JDK 17+ instalado (para build local)

### Gerar APK localmente:

```bash
cd VisioFab.App

# Build APK local (sem enviar para Expo servers)
eas build --platform android --profile local-apk --local
```

O APK será gerado em `./build-xxxxx.apk`.

### Gerar APK via Expo Cloud (mais fácil):

```bash
cd VisioFab.App

# Build APK na nuvem Expo (grátis, demora ~15min)
eas build --platform android --profile preview
```

Após o build, baixe o APK pelo link fornecido.

### Configurar URL da API no app:
- Na tela de **Configurações** do app, altere a URL para: `https://visiofab-wms-api.onrender.com/api`
- Ou defina no `eas.json` no profile `local-apk` → `env.EXPO_PUBLIC_API_URL`

## 5. Checklist Pós-Deploy

- [ ] Banco Neon criado e migrations executadas
- [ ] Backend Render rodando (testar: `curl https://visiofab-wms-api.onrender.com/api/health`)
- [ ] Frontend Vercel acessível
- [ ] CORS configurado no backend (já está `origin: true`)
- [ ] Criar usuário admin no banco de produção
- [ ] Testar login no frontend e no app
- [ ] Configurar URL da API no app mobile
