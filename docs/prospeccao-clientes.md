# Módulo Prospectar Clientes — Acompanhamento de Implementação

Documento de registro passo a passo da construção do módulo "Prospectar
Clientes" (prospecção de leads B2B a partir da base oficial de CNPJ da
Receita Federal, filtrada por CNAE + UF). Serve para não perder contexto
entre sessões.

## Objetivo

Menu **Vendas → Prospectar Clientes** (admin), onde o usuário configura o
"negócio a prospectar" (CNAEs alvo + UF/cidade/porte), dispara uma busca na
base oficial de CNPJ e recebe uma lista de empresas candidatas (prospects).
O admin revisa, qualifica (status) e converte um prospect em `Cliente`
(reaproveitando o cadastro que já existe).

## Decisões travadas com o usuário

1. **Fonte de dados**: Base Oficial da Receita Federal (dados públicos
   gratuitos). Como a base inteira é inviável de subir no Neon (~5GB, dezenas
   de milhões de linhas), a arquitetura importa **sob demanda por CNAE + UF**:
   cada execução de prospecção baixa/filtra só as empresas dos CNAEs/UFs
   configurados. 100% base oficial, volume gerenciável, escalável depois.
2. **Escopo**: completo — configuração + busca + tela de leads + conversão
   em cliente.
3. **Multi-tenant**: por empresa (cada empresa do Vizor tem seus prospects
   e configurações, isolados por `empresaId`).
4. **Execução**: implementação direta (sem spec formal), registrando cada
   passo aqui.

## Arquitetura

### Fonte oficial de CNPJ
A Receita publica mensalmente em `https://arquivos.receitafederal.gov.br/dados/cnpj/dados_abertos_cnpj/`
arquivos CSV zipados (Empresas, Estabelecimentos, CNAEs, etc.). Baixar tudo
é inviável. Estratégia adotada:

- **Consulta sob demanda via API pública de CNPJ** que espelha a base
  oficial e permite filtro por CNAE + UF, começando pela mais aberta.
  Fontes candidatas (todas espelham a base oficial da Receita):
  - CNPJ.ws / publica.cnpj.ws (consulta unitária por CNPJ, grátis com limite)
  - BrasilAPI (consulta unitária por CNPJ, grátis)
  - **Casa dos Dados / CNPJá** (busca por CNAE+UF — o que precisamos)
- Como a busca massiva por CNAE+UF em API 100% aberta e sem chave é
  limitada, o módulo é construído com uma **camada de provider plugável**
  (`ProspeccaoProvider`): hoje implementamos o provider que consulta a base
  filtrada; amanhã dá para plugar a importação do dump oficial completo sem
  mexer no resto (rotas/tela/models não mudam).

### Models novos (Prisma)
- `ConfiguracaoProspeccao` — o "negócio a prospectar" salvo pelo usuário
  (nome, cnaes[], uf, cidade, porte, situação). Multi-tenant.
- `Prospect` — cada empresa/lead encontrado. Multi-tenant. Status de funil:
  NOVO | EM_CONTATO | QUALIFICADO | DESCARTADO | CONVERTIDO. Guarda CNPJ,
  razão social, nome fantasia, CNAE, endereço, telefone, email, e origem.
- `ExecucaoProspeccao` — histórico de cada busca disparada (config usada,
  qtd encontrada, qtd nova, quando, por quem).

Todos adicionados a `ISOLATED_MODELS` (prisma-tenant.ts) OU filtrados
manualmente por `empresaId` — decisão: filtro manual (padrão do projeto,
mais explícito), igual a `cliente.routes.ts`.

### DESCOBERTA IMPORTANTE sobre a fonte (registrada 03/09/2026)

Pesquisa confirmou: as APIs de CNPJ **100% gratuitas e sem cadastro**
(CNPJá Open, MUAC, BrasilAPI) consultam **um CNPJ por vez** — NÃO listam
empresas por CNAE+UF. A busca massiva por CNAE+UF (que é o que a prospecção
precisa) só existe em:
  - serviços PAGOS (buscadecnpj.com.br, Casa dos Dados, CNPJá comercial), ou
  - baixando o dump oficial completo da Receita (~5GB) e importando.

Por isso o provider é construído com uma interface (`ProspeccaoProvider`) e
DOIS modos, selecionáveis por env/parâmetro sem mudar rotas/tela/models:

1. **`arquivoOficial`** (recomendado p/ produção): consome uma tabela local
   `estabelecimento_cnpj` populada a partir do dump oficial da Receita
   (importação separada, sob demanda por CNAE+UF, feita por um script que
   baixa só os arquivos necessários). É a base oficial, gratuita, e permite
   busca massiva por CNAE+UF. Quando a tabela local está vazia (dump ainda
   não importado), o provider retorna vazio com aviso claro.
2. **`apiPublicaEnriquecimento`**: dado uma lista de CNPJs candidatos (ex.:
   colados pelo usuário, ou vindos de outra fonte), enriquece cada um via
   API pública gratuita (CNPJá Open / BrasilAPI) — consulta unitária. Serve
   para complementar dados (telefone/email/situação) de CNPJs já conhecidos.

MODO PADRÃO: `arquivoOficial`. A base oficial é a fonte de verdade; o
enriquecimento por API é complementar. O import do dump é o passo pesado e
foi isolado num script dedicado (`scripts/importar-cnpj-oficial.ts`), que
NÃO roda no start do servidor — é executado manualmente/sob demanda por
CNAE+UF pelo admin de infraestrutura, mantendo o volume no Neon controlado.

### Backend
- `src/modules/prospeccao/prospeccao.routes.ts` — CRUD de config, disparo de
  busca, listagem/gestão de prospects, conversão em cliente.
- `src/modules/prospeccao/provider/` — camada de acesso à fonte oficial
  (interface + provider arquivoOficial + enriquecimento por API pública).
- `src/modules/prospeccao/provider/` — camada de acesso à fonte oficial.
- Registrado em `server.ts` com prefixo `/api/prospeccao`.
- Protegido por `authenticate` + preHandler exigindo ADMIN/SUPER_ADMIN.

### Frontend
- Página `src/app/(interna)/vendas/prospeccao/page.tsx`.
- Hook `src/data/hooks/vendas/useProspeccao.ts`.
- Item de menu em `ModuleSidebar.tsx` (bloco `vendas`).
- Guards: `useModuloGuard('VENDAS')` + `usePerfilGuard(['ADMIN','SUPER_ADMIN'])`.

## Passos (checklist)

- [x] 0. Levantamento dos padrões do projeto (backend/front/tenant/menu).
- [x] 1. Doc de acompanhamento (este arquivo).
- [x] 2. Models no schema.prisma (ConfiguracaoProspeccao, ExecucaoProspeccao, Prospect + relações inversas em Empresa). `prisma generate` OK.
- [x] 3. migrate-prod.ts idempotente (3 tabelas + índices). Testado 2x local, idempotente.
- [x] 4. Provider da fonte oficial (interface + arquivoOficial + enriquecimento
      API pública) + tabela `estabelecimento_cnpj` + script `importar-cnpj-oficial.ts`.
- [x] 5. prospeccao.routes.ts (config CRUD + buscar + prospects + enriquecer + converter). Diagnostics OK.
- [x] 6. Registrado no server.ts (prefixo /api/prospeccao). Diagnostics OK.
- [x] 7. Frontend: hook (`useProspeccao.ts`) + página (`vendas/prospeccao/page.tsx`,
      2 abas: Leads e Configurações) + item de menu em ModuleSidebar (bloco vendas).
      Diagnostics OK.
- [x] 8. Verificação: diagnostics limpos (backend + frontend); tsc do módulo novo
      sem erros; script de importação executa e exibe instruções corretamente.

## Estado final (03/09/2026) — FUNCIONAL

Módulo completo e integrado. Fluxo ponta a ponta:
1. Admin abre **Vendas → Prospectar Clientes**.
2. Aba "Configurações de Busca": cria um perfil (nome + CNAEs + UF/cidade + situação).
3. Clica no ícone de radar → dispara a busca (`POST /configuracoes/:id/buscar`).
   - Se a base oficial ainda não foi importada, recebe aviso claro orientando
     rodar `scripts/importar-cnpj-oficial.ts`.
4. Aba "Leads": vê os prospects, muda status do funil inline, enriquece via API
   pública, e converte em Cliente (1 clique → reaproveita o cadastro existente).

### Pendência operacional (não é código — é dado)
Para a busca retornar empresas, a base `estabelecimento_cnpj` precisa ser
populada uma vez pelo operador de infra, baixando os arquivos de
Estabelecimentos da Receita e rodando o script filtrando pelos CNAEs do nicho
da Carton Wega (embalagens → clientes de cosméticos/alimentos/farma/calçados).
Isso é intencional: mantém o volume no Neon proporcional ao nicho, não à base
inteira (~60M de empresas). O enriquecimento por API pública funciona
imediatamente para CNPJs já conhecidos, sem depender do dump.

### Arquivos criados/alterados
Backend:
- prisma/schema.prisma (4 models: ConfiguracaoProspeccao, ExecucaoProspeccao,
  Prospect, EstabelecimentoCnpj + relações inversas em Empresa)
- prisma/migrate-prod.ts (4 tabelas idempotentes)
- src/modules/prospeccao/prospeccao.routes.ts
- src/modules/prospeccao/provider/{prospeccao-provider,arquivo-oficial.provider,
  enriquecimento-api.service,index}.ts
- scripts/importar-cnpj-oficial.ts
- src/server.ts (import + register /api/prospeccao)

Frontend:
- src/data/hooks/vendas/useProspeccao.ts
- src/app/(interna)/vendas/prospeccao/page.tsx
- src/components/layout/ModuleSidebar.tsx (item de menu + import IconRadar2)

## Rotas expostas (/api/prospeccao) — todas ADMIN/SUPER_ADMIN

| Método | Rota | Descrição |
|--------|------|-----------|
| GET | /configuracoes | Lista configs de prospecção (com _count de prospects) |
| POST | /configuracoes | Cria config (nome, cnaes[], uf, cidade, portes[], situacao) |
| PUT | /configuracoes/:id | Atualiza config |
| DELETE | /configuracoes/:id | Exclui config |
| POST | /configuracoes/:id/buscar | Dispara a busca; materializa prospects novos; retorna totais + avisos |
| GET | /execucoes | Histórico das últimas 50 execuções |
| GET | /prospects | Lista prospects (filtro busca/statusFunil/configuracaoId, paginado) |
| PATCH | /prospects/:id | Atualiza statusFunil e/ou observacoes |
| DELETE | /prospects/:id | Exclui prospect |
| POST | /prospects/:id/enriquecer | Enriquece dados via API pública (CNPJá/BrasilAPI) |
| POST | /prospects/:id/converter | Converte prospect em Cliente (reaproveita se CNPJ já existe) |

## Registro de execução

(atualizado conforme avança)
