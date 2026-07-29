---
inclusion: always
---

# ATENÇÃO — Pontos a Verificar (lido em toda sessão)

Este arquivo existe para não repetir investigações já feitas e não deixar
passar uma classe de bug que já se repetiu várias vezes neste projeto:
**falta de filtro por `empresaId` em queries Prisma**, causando vazamento de
dados entre empresas diferentes no mesmo banco (multi-tenant).

Sempre que for tocar em uma rota que faça `prisma.<model>.findFirst`,
`findMany`, `findUnique`, `update`, `delete`, etc., **pare e verifique**:
1. O modelo tem `empresaId`? Se sim, o `where` filtra por
   `user.empresaId`, OU a rota usa `request.prismaScoped` (tenant
   extension automático — ver seção 1)?
2. Existe um relacionamento indireto (ex.: `EtapaOrdemProducao` não tem
   `empresaId` próprio, mas `EtapaOrdemProducao.ordemProducao.empresaId`
   sim) que precisa ser filtrado via `include`/`where` aninhado?
3. Ao criar um registro, o `empresaId` gravado é o da **entidade de
   negócio real** (ex.: da OP, da nota, do produto), não simplesmente
   `user.empresaId` do usuário que clicou no botão — nem sempre são a
   mesma coisa quando há relacionamentos entre entidades.

---

## 1. Mecanismo de isolamento multi-tenant existente (`prismaScoped`)

`src/middleware/tenant-context.ts` + `src/lib/prisma-tenant.ts` criam um
Prisma Client "scoped" (`request.prismaScoped`) que injeta `empresaId`
automaticamente em toda query, MAS **só para os modelos listados em
`ISOLATED_MODELS`** (`prisma-tenant.ts`). Rotas que usam `prisma` importado
diretamente (`import { prisma } from '../../lib/prisma'`) em vez de
`request.prismaScoped` **não recebem esse isolamento automático** — precisam
filtrar manualmente.

**Regra prática**: se o modelo está em `ISOLATED_MODELS` E a rota usa
`request.prismaScoped`, o isolamento é automático. Em qualquer outro caso
(modelo fora da lista, OU rota usando `prisma` direto), o filtro por
`empresaId` tem que ser feito manualmente na query — e é exatamente aí que
os bugs abaixo apareceram.

## 2. Bugs de isolamento já encontrados e corrigidos (histórico)

| Data/sessão | Módulo | Rota | Causa | Status |
|---|---|---|---|---|
| anterior | `zona.routes.ts` | vários | falta de filtro empresaId | Corrigido (referenciado em comentários no código) |
| anterior | Endereços livres (4 rotas) | `conferencia-entrada.routes.ts` (`enderecamento-automatico`, `enderecos-livres`), `enderecamento-wms.routes.ts` (`POST /sugerir`) | `prisma.endereco.findMany/findFirst` sem `OR: [{ empresaId }, { empresaId: null }]` — endereços de OUTRAS empresas apareciam nas sugestões/listagens, com o mesmo texto de endereço (numeração sequencial igual entre empresas) mascarando o vazamento | **Corrigido** |
| anterior | Conferência de Entrada | `conferir-todos` | `codigoProduto` do item (cProd do fornecedor) nunca resolvido para o código interno do Produto — regras de exigência de lote/shelf life/tolerância silenciosamente não aplicadas | **Corrigido** (`resolver-codigo-produto-item.service.ts`) |
| anterior | Segunda Conferência | notificação fiscal | e-mail/pendência CC-e disparado no momento da 2ª conferência, antes da aprovação final da nota — abandonar a tela ainda gerava notificação fiscal | **Corrigido** (adiado para `POST /confirmar`) |
| **esta sessão** | PCP → WMS | `etapa-operacional.routes.ts` (`/etapas/:id/iniciar`, `/pausar`, `/concluir`) | `prisma.etapaOrdemProducao.findFirst({ where: { id } })` **sem filtro de empresa** — usuário de OUTRA empresa que soubesse/enumerar o UUID de uma etapa conseguia iniciá-la/pausá-la/concluí-la. Ao concluir, a `NotaEntrada` de produção era criada com `empresaId: user.empresaId` (usuário logado) em vez do `empresaId` real da OP — o lançamento no WMS "vazava" para a empresa de quem clicou, não a empresa que produziu | **Corrigido** — agora filtra `where: { id, ordemProducao: { empresaId: user.empresaId } }` nos 3 handlers, e `criarEntradaProducao` recebe `empresaId` explícito da OP |

**Padrão recorrente**: toda vez que uma entidade "filha" (`EtapaOrdemProducao`,
`ItemNotaEntrada`, etc.) não tem `empresaId` próprio e depende do
relacionamento com a entidade "pai" para isolamento, é fácil esquecer o
filtro — porque a query "funciona" (retorna dados), só que retorna dados de
QUALQUER empresa, não só a do usuário. Não gera erro, só vaza dado. **Sempre
suspeitar quando a entidade não tem `@map("empresa_id")` direto no schema.**

## 3. Configuração dedicada em vez de flag genérica reaproveitada

Bug relacionado ao de isolamento: a integração PCP → WMS checava
`Empresa.usaWms` (flag genérica "essa empresa usa o módulo WMS") como
gatilho para uma decisão de negócio específica ("lançar automaticamente a
entrada de produção no estoque"). São decisões diferentes — uma empresa pode
usar WMS para compras/vendas normalmente e preferir lançar a entrada de
produção manualmente (revisão antes de baixar material, times diferentes,
etc.).

**Corrigido**: nova flag dedicada `pcp.integracaoWmsAutomatica` (tabela
`Parametro`, mesmo padrão de `configuracao-pcp.routes.ts`), default `true`
para preservar o comportamento já existente. Consultada via
`integracaoWmsAutomaticaAtiva(empresaId)`, exportada de
`configuracao-pcp.routes.ts`.

**Regra geral daqui pra frente**: antes de reaproveitar uma flag booleana
existente (`usaWms`, `usaPaletizacaoDinamica`, etc.) para controlar um
comportamento novo, perguntar: "essa flag já significa exatamente essa
decisão de negócio, ou é só uma pré-condição para ela?". Se for só
pré-condição, criar uma flag dedicada (nunca é caro — é uma linha na tabela
`Parametro`).

## 4. Duplicação de lógica entre rota e service (código morto)

Padrão observado: `pcp-wms-integration.service.ts` definia
`criarEntradaProducao()` mas nunca era chamada — a lógica real vivia
duplicada inline em `etapa-operacional.routes.ts`, e as duas versões já
tinham divergido em pelo menos um detalhe (`serie: 'INT'` vs `serie: 'PRD'`).

**Corrigido nesta sessão**: `criarEntradaProducao()` agora é a implementação
única, chamada por `etapa-operacional.routes.ts`. Ao encontrar um service
com função exportada mas sem nenhuma chamada (`grep` por uso zero), tratar
como sinal de dívida técnica — ou remover, ou migrar a rota para usá-la (não
deixar duas versões da mesma regra de negócio existirem em paralelo.

## 5. Integração Produção → Armazém: como o mercado faz (referência)

Comparado com padrões de ERPs de referência (SAP PP→MM, TOTVS, Sankhya,
Oracle) para a integração produção→estoque:

- **Nem sempre é automático "tudo ou nada".** O padrão de mercado costuma
  oferecer os dois modos — apontamento automático ao concluir a última
  operação, OU um passo explícito de recebimento de produção confirmado
  manualmente pelo armazém antes de entrar como estoque contado. O Vizor já
  tem uma boa base pra isso (`NotaEntrada.status = 'PENDENTE'` seguindo o
  fluxo padrão de Conferência de Entrada) — a flag `pcp.integracaoWmsAutomatica`
  (seção 3) aproxima o sistema desse padrão dual.
- **Quantidade lançada deveria ser reconciliável**, não só a da última
  etapa apontada. Sistemas maduros consolidam produção boa vs refugo de
  TODAS as etapas/operações da ordem. Hoje o Vizor usa só
  `atualizada.quantidadeProduzida` (a última etapa) como fallback para
  `etapa.ordemProducao.quantidade` — **não verificado/corrigido ainda,
  ficar atento se isso gerar reclamação de quantidade errada no WMS**.
- **Isolamento multi-tenant em sistemas de mercado (SaaS) é reforçado em
  nível de banco** (row-level security, schema por tenant), não depende de
  "lembrar de filtrar" rota por rota — que é exatamente a classe de bug
  documentada na seção 2 deste arquivo.

## 6. Erros pré-existentes do `tsc --noEmit` (baseline, ~65 erros)

Toda vez que uma verificação de build reporta "esses erros já existiam
antes da minha mudança, não relacionados", é esta lista. Não tentar corrigir
estes de forma reativa/acidental — são dívida técnica conhecida, fora do
escopo de tarefas pontuais, a menos que o usuário peça explicitamente para
resolver algum deles.

Contagem de referência: **65 erros** em 26 de julho de 2026 (`npx tsc --noEmit
-p tsconfig.json` na raiz de `VisioFab.Wms.Back`). Se esse número mudar
significativamente numa verificação futura, investigar se é regressão nova
(**tratar como bug real**) ou se a baseline foi corrigida por outro trabalho.

Arquivos e causas (agrupado por módulo):

- **`src/lib/storage.ts`** — `Buffer<ArrayBufferLike>` incompatível com
  tipo esperado pelo Prisma para campo `Bytes` (mudança de tipos do Node/Prisma).
- **`src/modules/agenda/agenda.routes.ts`** (2 erros) — `fornecedorId: null`
  não compatível com `string | undefined` esperado por `EditarAgendamentoInput`;
  `horaInicio` opcional vs obrigatório em `MoverAgendamentoInput`.
- **`src/modules/conferencia/conferencia.routes.ts`** (4 erros) — usa
  `prisma.conferencia`, mas não existe model `Conferencia` no schema (rota
  legada/órfã, possivelmente superada por `conferencia-entrada.routes.ts`).
- **`src/modules/enderecamento/enderecamento-wms.routes.ts`** (8 erros,
  linhas 468-495 e 683) — usa `include: { produto: ... }` em
  `ItemNotaEntrada` (relação não existe no schema — `ItemNotaEntrada` só
  tem `codigoProduto` string, não FK `produtoId`) e `select: { ean: ... }`
  em `Sku` (campo correto é `codigoBarra`, já reportado/corrigido em outra
  rota deste mesmo módulo no passado — aqui ainda pendente). Linha 683 usa
  `detalhes` em vez do campo correto de `registrarAudit`.
- **`src/modules/enderecamento/enderecamento.routes.ts`** (7 erros) — rota
  legada (prefixo `/api/operacoes`, **sem hook de autenticação** — ver nota
  de segurança abaixo) que referencia `Endereco.estado` (campo não existe —
  é calculado em runtime, não persistido), `Produto.centroDistribuicaoId`
  (não existe), `prisma.movimento`/`prisma.ordemServico`/`prisma.logOrdemServico`
  (models renomeados/não existem — provavelmente devia ser
  `LogMovimentacao`/`OrdemServicoWms`).
- **`src/modules/etiqueta/etiqueta.routes.ts`** (5 erros) — `Volume.peso`
  não existe no schema (provavelmente `pesoTotal` ou calculado);
  `Endereco.enderecoCompleto` possivelmente null sem tratamento.
- **`src/modules/ficha-operacional/ficha.service.ts`** — interface local
  `EnderecoComRota` divergiu do tipo real de `Endereco` (campo `codigoRua`
  com nullability incompatível).
- **`src/modules/fiscal/apuracao/apuracao-icms-st.service.ts`** — atribuição
  de `null` a campo `string` obrigatório.
- **`src/modules/fiscal/auditoria/auditoria-middleware.test.ts`** — erro de
  tipo em teste (`null` passado para posição que espera `FastifyRequest`) —
  é `.test.ts`, não afeta build de produção mas quebra `tsc --noEmit` geral.
- **`src/modules/fiscal/contingencia/contingencia.routes.ts`** (2 erros) —
  chama `FilaContingenciaService.listar()` e `ContingenciaService.retransmitirFila()`,
  métodos que não existem nas classes (renomeados ou nunca implementados).
- **`src/modules/fiscal/dctf/dctf-web.service.ts`** — comparação `<` entre
  `Decimal` (Prisma) e `number` sem `.lessThan()`/conversão.
- **`src/modules/fiscal/emissor-dfe/nfse/adapters/{abrasf,ginfes,issnet}.adapter.ts`**
  (3 erros) — `namespace 'https'` não encontrado (falta `import * as https from 'node:https'`
  ou similar).
- **`src/modules/fiscal/emissor-dfe/xml/xml-signer.ts`** — `Buffer` não
  compatível com `ByteStringBuffer` esperado por lib de assinatura XML
  (provavelmente `node-forge`).
- **`src/modules/fiscal/motor-tributario/preenchimento-tributario.test.ts`** —
  erro de tipo em teste (`"NCM_PARCIAL"` não é membro do union type esperado).
- **`src/modules/fiscal/sped/sped.routes.test.ts`** — mesmo padrão de
  `auditoria-middleware.test.ts` (mock de `FastifyRequest` incompleto).
- **`src/modules/liberacao-material/liberacao-material.routes.ts`** (2 erros) —
  `produtoId: string | null` passado onde `produtoId: string` é esperado (falta
  narrow/validação antes de usar).
- **`src/modules/multi-cd/multi-cd.routes.ts`** — `orderBy: { dataSaida: ... }`
  em `MercadoriaTransito`, campo não existe no schema.
- **`src/modules/ordem-producao/ordem-producao.routes.ts`** — `string | null`
  atribuído a campo `string` obrigatório.
- **`src/modules/ordem-servico/ordem-servico.routes.ts`** (6 erros) — módulo
  inteiro usa `prisma.ordemServico`/`prisma.logOrdemServico`, mas o model
  real no schema é `OrdemServicoWms` (renomeado em algum momento, esta rota
  não foi atualizada — **candidato a rota morta/legada, verificar se ainda é
  usada pelo frontend antes de decidir remover ou corrigir**).
- **`src/modules/parametro/parametro.routes.ts`** (2 erros) — filtro/orderBy
  por campos `nome`/`descricao` que não existem em `Parametro` (schema real
  usa `chave`/`valor`).
- **`src/modules/pcp/acompanhamento-cliente.routes.ts`** (2 erros) —
  `op.dataEntregaPrevista` e `max` possivelmente `null` sem guard antes do uso.
- **`src/modules/posicionamento/posicionamento.routes.ts`** — literal com
  campo `areaArmazenagem` não pertence ao tipo de retorno inferido.
- **`src/modules/transportadora/transportadora.routes.ts`** — `cnpj?: string`
  (opcional) passado onde `TransportadoraUncheckedCreateInput` exige
  `cnpj: string` obrigatório.
- **`src/modules/volume/volume.routes.ts`** (2 erros) — variável `user` não
  definida no escopo (provável `request.user` esquecido/removido por engano).
- **`src/modules/wave/wave.service.ts`** (4 erros) — `Record<string, unknown>`
  incompatível com `InputJsonValue` do Prisma (precisa `as Prisma.InputJsonValue`
  ou serializar); `totalPedidos`/`totalItens` referenciados mas não
  selecionados na query (só `_count.pedidos` foi selecionado).

**Nenhum destes foi corrigido nesta sessão** — são listados aqui apenas para
não precisar re-investigar do zero a cada verificação de build futura, e
para facilitar se algum dia o usuário pedir para tratá-los em lote.
