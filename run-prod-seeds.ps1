$env:DATABASE_URL = "postgresql://neondb_owner:npg_OzZrPBU2D0Mw@ep-withered-mountain-aqtjul2j-pooler.c-8.us-east-1.aws.neon.tech/neondb?sslmode=require"

Write-Host "=== Rodando seed base em PRODUCAO ===" -ForegroundColor Yellow
npx tsx prisma/seed.ts

Write-Host "`n=== Rodando seed vendas completas em PRODUCAO ===" -ForegroundColor Yellow
npx tsx prisma/seed-vendas-completas.ts

Write-Host "`n=== Rodando seed NFs livres em PRODUCAO ===" -ForegroundColor Yellow
npx tsx prisma/seed-nfs-livres.ts

Write-Host "`n=== Rodando fix coordenadas empresa ===" -ForegroundColor Yellow
npx tsx prisma/fix-empresa-coords.ts

Write-Host "`n=== CONCLUIDO! ===" -ForegroundColor Green
