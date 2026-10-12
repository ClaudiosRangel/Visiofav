# Implementation Plan: Contagem por Contador de Máquina (Checkout)

## Overview

Ordem incremental e verificável. Cada bloco é commitável. Back e front são
repos/caminhos distintos (front do cadastro = `VisioFab.Wms.Front`; front do
apontamento = `VisioFab.Wms.Back/VisioFab.Checkout`). Schema + `migrate-prod.ts`
sempre no mesmo commit (steering database-migrations). Recurso aditivo: o modo
padrão continua `QUANTIDADE` (não-regressão).

## Tasks

## 1. Schema + migração (fundação)
- [ ] 1.1 `CentroProducao`: `modoContagem` (default QUANTIDADE) +
      `contadorZeraDiariamente` (default false).
- [ ] 1.2 Model `LeituraContador` + `LogLeituraContador`.
- [ ] 1.3 `migrate-prod.ts` idempotente: ADD COLUMN IF NOT EXISTS (2) +
      CREATE TABLE IF NOT EXISTS (2) + índices. Testar 2× local.
- [ ] 1.4 `prisma generate`; `get_diagnostics` nos arquivos tocados.

## 2. Motor puro + testes (regra sem Prisma)
- [ ] 2.1 `contador-maquina.service.ts`: `derivarInicial`, `calcularQuantidade`,
      `validarCadeia` (funções puras).
- [ ] 2.2 Helper de "hoje" em America/Sao_Paulo (offset -3h, padrão do projeto).
- [ ] 2.3 `contador-maquina.service.test.ts` (vitest + fast-check): 1ª vez,
      sequência contígua, zera-diário (1º do dia = 0), final<inicial = erro,
      cadeia consistente/inconsistente. Rodar `vitest run`.

## 3. Backend — apontamento por contador
- [ ] 3.1 I/O no service: `derivarInicialDoCentro(etapaId, empresaId)` (busca
      última leitura + "tem leitura hoje" + flags do centro) → inicial.
- [ ] 3.2 `GET /checkout/etapas/:id/contador` → `{ modo, leituraInicial,
      zeraDiariamente }`. Isolamento por empresa (reusa buscarEtapaDoTerminal).
- [ ] 3.3 Estender `POST /checkout/etapas/:id/apontar`: para PRODUCAO em centro
      CONTADOR, aceitar `leituraFinal`; backend deriva inicial, calcula
      quantidade, cria `ApontamentoEtapa` + `LeituraContador`. PERDA/RETRABALHO
      e modo QUANTIDADE inalterados (não-regressão).
- [ ] 3.4 `registrarLeitura` grava `LeituraContador` (empresaId da OP real) e
      vincula ao `ApontamentoEtapa`. Atualiza `quantidadeProduzida` da etapa
      pelo mesmo caminho atual.
- [ ] 3.5 `get_diagnostics`; teste manual via tsx se possível.

## 4. Backend — histórico e correção (ERP / PCP)
- [ ] 4.1 `GET /pcp/centros/:id/contador/historico` (lista cronológica, empresa).
- [ ] 4.2 `PATCH /pcp/contador/leituras/:id`: valida cadeia (`validarCadeia`),
      grava `LogLeituraContador`, recalcula quantidade + total da etapa.
      Retorna "valor esperado" quando bloqueia (409/422).
- [ ] 4.3 Perfil: supervisor/PCP (não o terminal). moduloGuard('PCP').

## 5. Frontend — cadastro de Centros (VisioFab.Wms.Front)
- [ ] 5.1 Form de Centro: `modoContagem` (Select QUANTIDADE/CONTADOR) +
      `contadorZeraDiariamente` (Switch, visível só em CONTADOR).
- [ ] 5.2 Enviar os campos no create/update do centro. get_diagnostics.

## 6. Frontend — Checkout apontar (VisioFab.Checkout)
- [ ] 6.1 Ao abrir apontar e tipo=Produção: `GET /etapas/:id/contador`. Se
      `modo CONTADOR`: trocar "Quantidade" por "Leitura inicial" (readonly) +
      "Leitura final" (input). Enviar `leituraFinal` no POST.
- [ ] 6.2 Validação client-side: final >= inicial; mostrar quantidade calculada.
- [ ] 6.3 Perda/Retrabalho e centros QUANTIDADE: tela atual intacta.

## 7. Frontend — histórico de contagem (VisioFab.Wms.Front, PCP)
- [ ] 7.1 Tela/aba por centro listando `LeituraContador` (inicial/final/qtd/
      operador/data). Edição validada; exibe valor esperado ao bloquear.
- [ ] 7.2 Mostrar logs de correção.

## 8. Fechamento
- [ ] 8.1 Não-regressão: suíte do checkout/pcp (vitest) verde.
- [ ] 8.2 Commits (back: schema+migrate juntos; front cadastro; front checkout)
      + push main. Atualizar steering `pcp-modulo.md` (modo de contagem) e
      `checkout-apontamento` (nota do novo modo).
- [ ] 8.3 QA manual: centro CONTADOR com e sem zera-diário; correção pelo
      histórico; centro QUANTIDADE inalterado.

## Task Dependency Graph

```json
{
  "waves": [
    { "wave": 1, "tasks": ["1"], "description": "Schema + migração (fundação)" },
    { "wave": 2, "tasks": ["2", "5"], "description": "Motor puro + testes; cadastro de Centros (dependem só do schema)" },
    { "wave": 3, "tasks": ["3", "4"], "description": "Backend: apontamento por contador e histórico/correção (dependem do motor)" },
    { "wave": 4, "tasks": ["6", "7"], "description": "Front: Checkout apontar (dep. 3) e histórico de contagem (dep. 4)" },
    { "wave": 5, "tasks": ["8"], "description": "Fechamento: não-regressão, commits/push, docs, QA" }
  ]
}
```

## Notes

### Decisões travadas (do usuário)
- Contador por **Centro de Produção** (máquina física).
- **Sem rollover** no meio da contagem (não trata nesta fase).
- Reset diário = **início do 1º turno**; implementado como **data civil local**
  (America/Sao_Paulo) nesta fase (refino por turno = futuro).
- Modo contador só para **Produção**; Perda/Retrabalho sempre quantidade.
- Leitura inicial **travada** no apontamento; correção só pelo **histórico**,
  com **log** e **validação de consistência** (mostra o valor esperado).

### Referências
- Padrão MES de mercado (odômetro acumulativo, produção = final − inicial):
  Sepasoft/Vorne/Industrial Shields (pesquisa 12/10/2026).
- Modelo de apontamento atual: `checkout.service.ts`, `checkout.routes.ts`,
  `VisioFab.Checkout/src/app/etapa/[id]/apontar/page.tsx`.
