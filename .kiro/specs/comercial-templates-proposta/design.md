# Design — Templates de Proposta PDF (Bloco B1)

## Overview

Transformar a geração de proposta PDF (hoje layout fixo em
`orcamento-grafico-proposta-pdf.service.ts`) em algo **dirigido por um template**
configurável por empresa, com um **default**, sem alterar os VALORES da proposta.
Abordagem de menor risco e aditiva:

- Novo model `TemplateProposta` (empresaId, nome, isDefault, config Json).
- O `gerarPropostaPdf` passa a receber uma `config` (do template) e renderiza
  cabeçalho/textos/blocos conforme ela. **Sem template → usa a config embutida
  que reproduz o layout atual (não-regressão).**
- CRUD de templates (rotas REST) + default por empresa.
- As rotas de download e envio por e-mail aceitam `templateId` opcional.

Nenhuma mudança no motor de cálculo. Só camada de apresentação + 1 tabela nova.

## Modelo de dados

### `TemplateProposta` (tabela `template_proposta`)

```prisma
model TemplateProposta {
  id         String   @id @default(uuid())
  empresaId  String   @map("empresa_id")
  nome       String   @db.VarChar(120)
  isDefault  Boolean  @default(false) @map("is_default")
  // Config de layout/textos/blocos (shape em TemplatePropostaConfig).
  config     Json
  criadoEm   DateTime @default(now()) @map("criado_em")
  atualizadoEm DateTime @updatedAt @map("atualizado_em")

  @@index([empresaId, isDefault])
  @@map("template_proposta")
}
```

**Migração (`migrate-prod.ts`, idempotente — mesmo commit do schema):**
`CREATE TABLE IF NOT EXISTS template_proposta (...)` + `CREATE INDEX IF NOT EXISTS`.
Postgres local off → roda no deploy do Render (idempotente garantido por IF NOT
EXISTS). Sem dado destrutivo.

### Shape da config (TypeScript, dentro de `config` Json)

```ts
interface TemplatePropostaConfig {
  cabecalho: {
    mostrarLogo: boolean
    mostrarRazaoSocial: boolean
    mostrarCnpj: boolean
    mostrarTelefone: boolean
    mostrarEmail: boolean
  }
  textos: {
    introducao?: string   // parágrafo de abertura
    condicoes?: string    // condições comerciais
    rodape?: string       // texto de rodapé
  }
  blocos: {
    engenharia: boolean          // papel/gramatura/cores/acabamentos
    decomposicaoCustos: boolean  // MD/CT/acabamento
    variacoesTiragem: boolean    // grade de tiragens
    validade: boolean
    observacoes: boolean
  }
}
```

A config default (template embutido) liga todos os blocos que o layout atual já
mostra e usa os textos padrão de hoje — garantindo não-regressão.

## Componentes e mudanças

### Backend (`VisioFab.Wms.Back`)

**1. `template-proposta.service.ts` (novo)** — puro de infra:
- `CONFIG_DEFAULT_EMBUTIDA`: a config que reproduz o layout atual.
- `obterConfigTemplate(empresaId, templateId?)`: se `templateId`, busca o
  template DESSA empresa (404 se de outra); senão busca o `isDefault` da empresa;
  senão retorna `CONFIG_DEFAULT_EMBUTIDA`. empresaId EXPLÍCITO.
- `normalizarConfig(raw)`: mescla a config do banco com defaults (tolerante a
  campos ausentes — função pura, testável).
- CRUD: `listar/criar/atualizar/excluir/definirDefault` (todos com empresaId;
  `definirDefault` desmarca o default anterior numa transação; `excluir` barra o
  default).

**2. `orcamento-grafico-proposta-pdf.service.ts` (estender)** —
`gerarPropostaPdf(params)` ganha `params.config: TemplatePropostaConfig`. A
renderização passa a consultar `config.cabecalho/textos/blocos` para decidir o
que desenhar. Quando `config` não é passada, usa `CONFIG_DEFAULT_EMBUTIDA`
(não-regressão: mesma saída de hoje). Nenhum número muda.

**3. `template-proposta.routes.ts` (novo)** — registrado em `server.ts` com
prefixo `/api/orcamento-grafico/templates-proposta` (mantém o módulo):
- `GET /` lista; `POST /` cria; `PUT /:id` atualiza; `DELETE /:id` exclui;
  `PATCH /:id/default` define default. authenticate + isolamento empresaId.

**4. Rotas existentes (download + enviar-email)** — passam a ler `templateId`
(query no download, body no e-mail), chamar `obterConfigTemplate` e repassar a
`config` ao `gerarPropostaPdf`. Sem `templateId` → default (não-regressão).

### Frontend (`VisioFab.Wms.Front`)

- Nova tela de cadastro em **Comercial → Cadastros → Templates de Proposta**
  (`/orcamento-grafico/cadastros/templates-proposta`): lista + form (nome,
  default, toggles de cabeçalho/blocos, textareas de textos) + preview (baixar
  PDF de exemplo). Entrada no `ModuleSidebar` (grupo Cadastros).
- No detalhe do orçamento (`[id]`), onde hoje há "Baixar PDF"/"Enviar proposta",
  adicionar um `Select` de template (default pré-selecionado) que passa o
  `templateId` ao baixar/enviar.

## Error Handling

- `templateId` de outra empresa → 404 (não vaza nem gera PDF).
- Config malformada no banco → `normalizarConfig` preenche defaults (nunca
  quebra a geração).
- Excluir default → 400 com mensagem clara.
- Bloco ligado sem dado no orçamento → omitido (Requisito 3.3).

## Testing Strategy

Natureza: infra + apresentação. PBT útil em `normalizarConfig` (função pura):
propriedades — idempotência (normalizar duas vezes = uma), toda chave de bloco
vira booleano, nunca lança para qualquer JSON de entrada. Teste unitário de
`obterConfigTemplate` (default embutido quando sem template; 404 cross-empresa).
Verificação: `get_diagnostics` nos arquivos tocados + `prisma generate` +
conferência manual de um PDF com template custom vs default. Golden: não há
número a validar (valores inalterados); garantir que sem template a saída é a de
hoje (não-regressão visual conferida pelo usuário ao subir).

## Correctness Properties

- P1 (idempotência): `normalizarConfig(normalizarConfig(x)) == normalizarConfig(x)`.
- P2 (totalidade): `normalizarConfig(x)` nunca lança, para qualquer JSON.
- P3 (default único): após `definirDefault(t)`, exatamente um template da empresa
  tem `isDefault = true`.
- P4 (isolamento): `obterConfigTemplate(empresaA, templateDeB)` → erro 404.
