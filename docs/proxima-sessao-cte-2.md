# Próxima Sessão CT-e (2) — Pendências e Correções

## Contexto

Sessão anterior implementou: DACTE paisagem, email, cores veículo, validação
pré-transmissão, filtros data, seleção em lote, cancelamento e CC-e na SEFAZ.

O cancelamento e CC-e já comunicam com a SEFAZ SVRS (sem erros de schema/
formato), e o cancelamento foi executado com sucesso em homologação.

---

## Pendências a resolver

### 1. Configuração de E-mail — usar config da tela existente

**Problema**: A rota `POST /cte/:id/enviar-email` busca SMTP das variáveis de
ambiente (`process.env.SMTP_HOST`, etc). Mas o sistema já tem uma tela de
configuração SMTP em `/configuracoes/email` que salva no banco.

**O que fazer**:
- Localizar onde essa tela salva os dados SMTP (provavelmente tabela
  `Parametro` com prefixo `smtp.` ou modelo dedicado `ConfigEmail`)
- Na rota de envio de e-mail do CT-e, buscar os dados SMTP do banco
  (mesma lógica da tela) em vez de `process.env`
- Adicionar campos faltantes na tela se necessário:
  - "Email de Suporte" já existe
  - Verificar se precisa de "E-mail Remetente (From)" separado
  - "Usar TLS" já existe (toggle)
- Garantir que "Enviar Email de Teste" funcione

### 2. Erro na tela "Dados da Empresa" (Configurador → Empresa → aba Fiscal)

**Problema**: Console error "A component is changing an uncontrolled input to
be controlled" na linha 355 do `configurador/empresa/page.tsx`.

**Causa**: O campo `codigoMunicipio` começa como `undefined` (vindo do
backend quando não preenchido) e depois muda para string quando o usuário
edita. React não permite transição `undefined → string` em controlled inputs.

**O que fazer**:
- No arquivo `src/app/(interna)/configurador/empresa/page.tsx`, linha ~355
- Garantir que o `defaultValue` ou `value` do campo `codigoMunicipio`
  nunca seja `undefined` — usar `''` como fallback:
  ```tsx
  value={field.value ?? ''}
  ```
- Verificar outros campos que possam ter o mesmo problema (campos opcionais
  que vêm `null`/`undefined` do backend)

### 3. Menu "Eventos" no CT-e — listar histórico de eventos

**O que fazer**: Adicionar ao menu de ações (⋮) do CT-e uma opção "Eventos"
que abre um modal/drawer listando todos os eventos já efetuados para aquele
CT-e.

**Campos da listagem de eventos**:
- Data do evento (`dataEvento`)
- Tipo do evento (Cancelamento / Carta de Correção / etc)
- Sequência (`nSeqEvento`)
- Status (REGISTRADO / REJEITADO)
- Protocolo (se houver)
- Descrição resumida (justificativa ou texto da correção)

**Backend**: A rota `GET /cte/:id` já retorna `eventos` (include no findFirst).
Basta usar esses dados no frontend.

**Frontend**:
- No `AcoesMenu`, adicionar item "Eventos" (ícone `IconHistory`)
- Modal com tabela simples dos eventos
- Visível para CT-e AUTORIZADO ou CANCELADO

### 4. Mostrar Remetente (origem) e Destinatário (destino) na listagem

**O que fazer**: Na tabela de listagem de CT-e, além de "Tomador/Destinatário",
mostrar informações de origem e destino.

**Opções**:
- Adicionar coluna "Origem → Destino" extraindo de `xmlEnviado` (JSON
  salvo no campo) os valores `xMunIni/ufIni` e `xMunFim/ufFim`
- Ou retornar esses campos diretamente do backend na query de listagem
  (extrair do JSON no SELECT)

**Backend**: Na rota `GET /cte`, após buscar os documentos, parsear o
`xmlEnviado` (que é o JSON do payload) para extrair `cMunIni`, `xMunIni`,
`ufIni`, `cMunFim`, `xMunFim`, `ufFim` e retornar como campos adicionais.

### 5. Filtro por ambiente — bug: "Produção" mas mostra CT-e de homologação

**Problema**: A tela de empresa mostra "Ambiente CT-e: 1 - Produção", mas a
listagem de CT-e ainda mostra os emitidos em homologação.

**Causa provável**: O campo `ambienteCTe` pode não existir no model `Empresa`
do Prisma (é acessado via `(empresa as any).ambienteCTe`). Se o campo não
existir no banco, retorna `undefined` e o fallback é `empresa.ambienteNFe`
que pode estar como `2` (homologação).

**O que verificar**:
1. O campo `ambienteCTe` existe na tabela `empresa` no banco? Rodar:
   ```sql
   SELECT column_name FROM information_schema.columns
   WHERE table_name = 'empresa' AND column_name LIKE '%ambiente%';
   ```
2. Se não existir, verificar se o frontend está salvando em outro lugar
   (tabela `Parametro`? campo com nome diferente?)
3. Se o campo existe mas está null/0, o fallback pega `ambienteNFe = 2`
4. Corrigir a lógica: se `ambienteCTe` é `1` (produção), filtrar apenas
   `where: { ambiente: 1 }`. Verificar se o valor está sendo lido
   corretamente:
   ```ts
   const ambienteAtual = empresa.ambienteCTe ?? empresa.ambienteNFe ?? 2
   ```

**Ação**: Verificar o model Empresa no schema.prisma, confirmar se o campo
`ambienteCTe` (ou `ambiente_cte`) existe, e se está sendo salvo pela tela
do Configurador.

---

## Arquivos relevantes

| Item | Arquivo(s) |
|------|-----------|
| 1 - Email | `cte.routes.ts` (rota enviar-email), tela `/configuracoes/email` |
| 2 - Erro empresa | `src/app/(interna)/configurador/empresa/page.tsx:355` |
| 3 - Eventos | `src/app/(interna)/fiscal/cte/page.tsx` (AcoesMenu) |
| 4 - Origem/Destino | `cte.routes.ts` (GET /cte), `page.tsx` (listagem) |
| 5 - Ambiente | `cte.routes.ts` (filtro ambiente), schema empresa |

---

## Resumo do que foi feito nesta sessão (para commit)

### Backend (`VisioFab.Wms.Back`)
- `cte-validacao.service.ts` — validação pré-transmissão (20+ regras)
- `cte-dacte-pdf.service.ts` — DACTE paisagem com QR Code, Code128, tarja
- `cte-cores.routes.ts` — CRUD cores de veículo + seed DENATRAN
- `cte.routes.ts` — rotas email, lote, filtro ambiente, filtro data autoriz.
- `cte-emissao.service.ts` — correções: fmtDataHora (UTC→BRT), nSeqEvento
  (padStart 3), minificação XML eventos, limpeza eventos rejeitados,
  grupoAlterado='compl'
- `sefaz-client.ts` — GZip apenas para CTE_AUTORIZACAO (não eventos)
- `emissor-dfe.routes.ts` — registro das rotas de cores
- `schema.prisma` — model CorVeiculo
- `migrate-prod.ts` — CREATE TABLE cor_veiculo (TEXT, não UUID)
- `scripts/criar-tabela-cor.mjs` — script de criação direta da tabela
- `package.json` — pdfkit instalado

### Frontend (`VisioFab.Wms.Front`)
- `page.tsx` (listagem CT-e) — reescrita com checkboxes, lote, filtros data,
  coluna Dt. Autorização, envio email, motivo de falha nos toasts
- `nova/page.tsx` — resolverCodigoMunicipio (onBlur), resolverCodigoCor
- `useCte.ts` — 7 novos hooks + correção duplicata useTransmitir
- `ModuleSidebar.tsx` — menu "Cores de Veículo" em Cadastros
- `cadastros/cores-veiculo/page.tsx` — tela CRUD de cores

---

## Instruções para continuar na próxima sessão

1. Abrir esta doc: `docs/proxima-sessao-cte-2.md`
2. Dizer ao assistente: "continue com a sessão CT-e, implemente os itens
   do arquivo docs/proxima-sessao-cte-2.md"
3. Prioridade sugerida: Item 5 (bug ambiente) → Item 2 (erro empresa) →
   Item 1 (email do banco) → Item 4 (origem/destino) → Item 3 (eventos)
