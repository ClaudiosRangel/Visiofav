# Implementation Plan: Logo da Empresa

## Overview

Este plano implementa o suporte a logo de Empresa em `src/modules/empresa-selector/`.
A abordagem é incremental: primeiro o Validador_Logo (função pura, sem I/O,
em `logo-validator.ts`) e a função pura de filtragem/mapeamento usada por
`GET /minhas`, com seus testes de propriedade; depois a integração, um
endpoint por vez, na ordem de validação fixada no design (autenticação →
permissão → parse zod → Validador_Logo → persistência) em
`empresa-selector.routes.ts`; por fim a atualização de `GET /minhas` para
incluir o campo `logo`. Nenhuma alteração de `prisma/schema.prisma` nem de
`prisma/migrate-prod.ts` é necessária (Requirement 6.3).

Linguagem de implementação: TypeScript (Fastify + Prisma + Zod), conforme
já usado no projeto. Biblioteca de PBT: **fast-check**, mínimo de 100
iterações por teste de propriedade. `fast-check` e `vitest` já estão
presentes em `devDependencies` do backend e `vitest.config.ts` já está
configurado — nenhuma task de setup de testes é necessária.

## Tasks

- [x] 1. Implementar Validador_Logo e função de listagem em logo-validator.ts
  - [x] 1.1 Implementar validarLogoBase64, decidirPersistenciaLogo, mensagemErroLogo e TAMANHO_MAXIMO_LOGO_BYTES
    - Criar `src/modules/empresa-selector/logo-validator.ts` com os tipos `MotivoRejeicaoLogo`, `ResultadoValidacaoLogo`, `DecisaoPersistenciaLogo` e a constante `TAMANHO_MAXIMO_LOGO_BYTES = 2_000_000`
    - Implementar `validarLogoBase64`: remove prefixo de data-URL, valida base64, decodifica, checa tamanho (antes do formato), detecta formato por assinatura binária (magic bytes PNG/JPEG) e normaliza o `conteudoNormalizado` com o prefixo correspondente ao formato real detectado
    - Implementar `mensagemErroLogo` (mensagem 400 em português por `MotivoRejeicaoLogo`)
    - Implementar `decidirPersistenciaLogo` (ausente → manter; `null` → remover; string → validar e decidir persistir/rejeitar)
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 6.1, 6.2_

  - [x] 1.2 Implementar função pura de filtragem/mapeamento para GET /minhas
    - Em `logo-validator.ts`, implementar `filtrarEMapearEmpresasAtivas(vinculos)`: recebe a lista de vínculos usuário-empresa (cada um com `empresa.{id, razaoSocial, nomeFantasia, cnpj, logo, status}`), retorna apenas os vínculos com `empresa.status === true`, mapeados para `{ id, razaoSocial, nomeFantasia, cnpj, logo }` (incluindo `logo: null` quando ausente)
    - Função sem I/O, testável isoladamente, para ser reaproveitada no handler `GET /minhas` (task 5.1)
    - _Requirements: 1.1, 1.2, 1.3_

  - [ ]* 1.3 Write property test for imagens válidas dentro do limite
    - **Property 1: Imagens PNG e JPEG válidas dentro do limite de tamanho são aceitas**
    - **Validates: Requirements 2.1, 3.1, 4.1, 5.1**

  - [ ]* 1.4 Write property test for tamanho excedido
    - **Property 2: Tamanho excedido é sempre rejeitado, independentemente do formato**
    - **Validates: Requirements 5.3, 4.1**

  - [ ]* 1.5 Write property test for formato não reconhecido
    - **Property 3: Formato não reconhecido é sempre rejeitado quando o tamanho está dentro do limite**
    - **Validates: Requirements 5.2**

  - [ ]* 1.6 Write property test for base64 inválido
    - **Property 4: String que não é base64 válida é sempre rejeitada**
    - **Validates: Requirements 5.2, 4.5**

  - [ ]* 1.7 Write property test for determinismo de validarLogoBase64
    - **Property 5: validarLogoBase64 é determinística**
    - **Validates: Requirements 5.1, 5.2, 5.3**

  - [ ]* 1.8 Write property test for classificação por conteúdo binário
    - **Property 6: A classificação depende apenas do conteúdo binário, nunca do prefixo declarado**
    - **Validates: Requirements 3.6, 5.2**

  - [ ]* 1.9 Write property test for decisão de persistência
    - **Property 7: Decisão de persistência do campo logo é consistente com o valor recebido**
    - **Validates: Requirements 2.2, 2.4, 3.2, 3.3, 3.5, 3.6, 4.2, 4.3, 4.5, 5.4, 5.5, 6.2**

  - [ ]* 1.10 Write property test for mensagens de erro
    - **Property 8: Cada motivo de rejeição produz uma mensagem 400 não vazia e determinística**
    - **Validates: Requirements 5.4**

  - [ ]* 1.11 Write property test for filtragem/mapeamento de GET /minhas
    - **Property 9: Listagem GET /minhas preserva campos e filtra corretamente por status ativo**
    - **Validates: Requirements 1.1, 1.2, 1.3**

- [x] 2. Checkpoint — Validar Validador_Logo
  - Ensure all tests pass, ask the user if questions arise.

- [x] 3. Integrar Validador_Logo nos endpoints de escrita de empresa-selector.routes.ts
  - [x] 3.1 Integrar em POST / (Endpoint_Criação_Empresa)
    - Adicionar `logo: z.string().nullable().optional()` a `empresaBodySchema`
    - No handler, após a checagem de permissão administrativa já existente (403 antes de qualquer validação de logo) e após o parse zod, chamar `decidirPersistenciaLogo(body.logo)`; se `rejeitar`, retornar 400 com `mensagemErroLogo(decisao.motivo)` sem criar a Empresa; caso contrário definir `logo` como `conteudoNormalizado` (persistir) ou `null` (ausente/remover) antes de `prisma.empresa.create`
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5_

  - [x] 3.2 Integrar em PUT /:id (Endpoint_Atualização_Empresa)
    - No handler, após a checagem de permissão administrativa já existente e após o parse zod (`empresaBodySchema.partial()` já com `logo`), chamar `decidirPersistenciaLogo(body.logo)`; se `rejeitar`, retornar 400 sem atualizar a Empresa; se `manter`, remover `logo` do objeto `data` antes do `update` (não sobrescrever); se `remover`/`persistir`, definir `data.logo` de acordo
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6_

  - [x] 3.3 Integrar em PUT /minha (Endpoint_Atualização_Minha)
    - Adicionar `logo: z.string().nullable().optional()` ao `baseSchema` do handler
    - Aplicar a mesma lógica de `decidirPersistenciaLogo` da task 3.2, sem exigir checagem de perfil administrativo adicional (mantém a autorização já vigente do endpoint)
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5_

  - [ ]* 3.4 Write unit tests for integração leve dos 3 handlers (mock Prisma)
    - Testar que usuário não-admin consegue atualizar o próprio logo com sucesso via `PUT /minha` (Requirement 4.4)
    - Testar, para os 3 handlers, que quando `decidirPersistenciaLogo` retorna `rejeitar`, o mock de `prisma.empresa.create`/`update` nunca é chamado (Requirement 5.4, 5.5)
    - Testar caso de borda: `logo` enviado como string vazia (`''`) é tratado como `BASE64_INVALIDO`, não como equivalente a `null`
    - _Requirements: 4.4, 5.4, 5.5_

- [x] 4. Checkpoint — Validar endpoints de escrita
  - Ensure all tests pass, ask the user if questions arise.

- [x] 5. Atualizar GET /minhas para incluir logo
  - [x] 5.1 Incluir logo no select e usar filtrarEMapearEmpresasAtivas
    - Adicionar `logo: true` ao `select` de `include.empresa` em `GET /minhas`
    - Substituir a lógica inline de `.filter().map()` pela chamada a `filtrarEMapearEmpresasAtivas` (task 1.2), garantindo que o campo `logo` seja retornado (incluindo `null` quando ausente) sem alterar os demais campos já retornados (`id`, `razaoSocial`, `nomeFantasia`, `cnpj`)
    - _Requirements: 1.1, 1.2, 1.3_

- [x] 6. Checkpoint final — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document (fast-check, mínimo 100 iterações, sem I/O real)
- Unit tests validate specific examples and edge cases
- `fast-check` e `vitest` já estão disponíveis no projeto backend (`devDependencies` + `vitest.config.ts`); nenhuma task de setup de testes é necessária
- Nenhuma alteração em `prisma/schema.prisma` nem em `prisma/migrate-prod.ts` é necessária para esta feature (Requirement 6.3) — o campo `logo` já existe no model `Empresa`
- As tasks 3.1, 3.2, 3.3 e 5.1 modificam o mesmo arquivo (`empresa-selector.routes.ts`) e por isso estão em waves distintas no grafo de dependências abaixo, para evitar conflitos de escrita concorrente

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2"] },
    { "id": 2, "tasks": ["1.3", "1.4", "1.5", "1.6", "1.7", "1.8", "1.9", "1.10", "1.11"] },
    { "id": 3, "tasks": ["3.1"] },
    { "id": 4, "tasks": ["3.2"] },
    { "id": 5, "tasks": ["3.3"] },
    { "id": 6, "tasks": ["3.4", "5.1"] }
  ]
}
```
