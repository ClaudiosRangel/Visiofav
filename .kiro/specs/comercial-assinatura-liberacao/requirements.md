# Requirements — Assinatura do Setor na Liberação ao PCP (Bloco B6)

## Introdução

O Caio pediu que, antes de encaminhar o pedido ao PCP (abrir OP), haja uma
**validação por assinatura/senha do setor de orçamento**. Decisão (usuário
confirmou "pode seguir" com a recomendação): usar a **senha do próprio usuário**
logado, exigindo que ele tenha **perfil/permissão de orçamento**, e **registrar
quem liberou** (auditável por pessoa — não uma senha compartilhada).

O aceite do cliente (enviar proposta → aguardar aceite) já é coberto pelo fluxo
de status ENVIADO→APROVADO e pela aprovação do representante no portal
(`aprovadaClientePor/Em`). Este bloco foca na **assinatura na liberação ao PCP**.

Fonte de verdade: `docs/PROJETO-MODULO-COMERCIAL.md` (bloco B6).

## Requisitos

### Requisito 1: Exigir assinatura (senha) na liberação ao PCP

1. QUANDO o comercial liberar um pedido para o PCP E a empresa exigir assinatura
   ENTÃO o sistema DEVE exigir a **senha do usuário logado** e só liberar se a
   senha conferir (bcrypt) E o usuário tiver perfil permitido (ADMIN/SUPERVISOR,
   ou permissão de orçamento).
2. QUANDO a senha estiver incorreta ENTÃO o sistema DEVE retornar 401 e NÃO
   liberar o pedido.
3. QUANDO o usuário não tiver perfil permitido ENTÃO o sistema DEVE retornar 403.
4. A liberação bem-sucedida DEVE registrar quem assinou e quando (auditoria).

### Requisito 2: Configurável por empresa

1. A exigência de assinatura DEVE ser configurável (`Parametro`
   `comercial.exigir-assinatura-liberacao`, default **true**).
2. QUANDO desligada ENTÃO a liberação NÃO exige senha (comportamento anterior —
   não-regressão).

### Requisito 3: Isolamento e segurança

1. Toda query filtra `empresaId` explícito.
2. A senha NUNCA trafega em log; a verificação usa bcrypt.compareSync.
3. Não altera o motor de cálculo.
