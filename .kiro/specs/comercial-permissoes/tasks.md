# Implementation Plan — Permissões do Comercial (B10)

Padrão replicado do PCP (`permissoes-pcp.routes.ts`). Armazenamento em
`Parametro` chave `comercial.permissoes.<usuarioId>` (JSON). ADMIN bypass.
Default = tudo liberado (não-regressão).

- [x] 1. Service + rotas de permissões
  - `permissoes-comercial.routes.ts`: `getPermissoesComercial`,
    `verificarPermissaoComercial`, `DEFAULT_PERMISSOES_COMERCIAL` +
    `GET /comercial/permissoes/minha` (qualquer perfil), `GET /comercial/permissoes`
    (ADMIN), `PUT /comercial/permissoes/:usuarioId` (ADMIN). Registrada em server.ts.
  - _Ações:_ podeVerComercial, podeCriarOrcamento, podeEnviarProposta,
    podeAprovarOrcamento, podeConverterPedido, podeAplicarDesconto, podeLiberarPcp,
    podeGerenciarAmostras, podeEditarCadastros.

- [x] 2. Enforcement nas rotas sensíveis
  - `POST /` (podeCriarOrcamento), `/:id/aprovar` (podeAprovarOrcamento),
    `/:id/converter` (podeConverterPedido + podeAplicarDesconto p/ desconto),
    `/pedidos/:id/liberar-pcp` (podeLiberarPcp), `/amostras/*` (podeGerenciarAmostras).
    ADMIN/SUPER_ADMIN bypass. 403 claro quando negado.

- [x] 3. Frontend — tela de Permissões
  - `/orcamento-grafico/permissoes` (usePerfilGuard ADMIN): lista usuários +
    switches por ação; admins = acesso total; salva via PUT. Item "Permissões"
    no menu Comercial.

- [ ] 4. (follow-up) Ocultar botões no front conforme permissoes/minha
  - As telas podem consumir `GET /comercial/permissoes/minha` para esconder
    ações negadas (hoje o backend já bloqueia com 403; a ocultação é cosmética).
    Fazer na revisão, se o usuário quiser.
