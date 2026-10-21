# Implementation Plan — Cálculo Gráfico: Foto Rica + Conferência

Ordem: provar no 11121 → aplicar aos 7.951 → tela → conferência. Nada toca o
motor, o PCP ou a estrutura existente. Foto rica é aditiva na coluna
`resultado_calculo`. `empresaId` explícito. Produção só após prova local.

## Tasks

- [ ] 1. Tipo `FotoRicaCalculo` (contrato do JSON)
  - Criar `src/modules/orcamento-grafico/calculo-grafico/foto-rica.types.ts`
    com a interface `FotoRicaCalculo` (cabecalho, planos, suportes, matriz,
    tintas, matAcabamento, impressao, acabamentos, itensDiversos, custos, cev,
    margens) conforme o design.
  - _Requirements: 1, 2_

- [ ] 2. Exportador rico (SQL Server → JSON) + PROVA no 11121
  - [ ] 2.1 `scripts/exportar-calculos-acervo-rico.mjs` — por cálculo (maior
    Codigo por NumCalculo, não cancelado), montar a `FotoRicaCalculo` completa
    via `sqlcmd -u` (UTF-16→UTF-8), resolvendo nomes (suporte/máquina/atividade/
    material/tinta/cliente/linha/produto). Flag `--numero N` para exportar 1 só.
    - _Requirements: 1.1, 1.2, 1.3_
  - [ ] 2.2 Rodar `--numero 11121` e CONFERIR contra o PDF do ESAB: planos,
    suportes, tintas, acabamentos, C.PROD 64.491,72, Valor Total 100.580,00,
    margens 10/15,93/30%. Ajustar o mapeamento até bater.
    - _Requirements: 1.4, 5.1_

- [ ] 3. Importador da foto rica (idempotente) + gravar o 11121
  - [ ] 3.1 `foto-rica-import.service.ts` — atualiza `resultado_calculo` por
    `(empresaId, numeroCalcgraf)`, idempotente, em lote; não recalcula; seção
    ausente vira vazia. `empresaId` explícito.
    - _Requirements: 2.1, 2.2, 2.3, 2.5, 6.1_
  - [ ] 3.2 `scripts/importar-foto-rica-calcgraf.ts` — carga (dry-run, lotes,
    retry Neon, `--numero` p/ um só). Gravar o 11121 em produção e conferir na
    tela.
    - _Requirements: 2.1, 5.1, 6.2, 6.3_

- [ ] 4. Tela de detalhe = espelho do pré-cálculo
  - [ ] 4.1 Renderizar a `FotoRicaCalculo` em seções no detalhe do cálculo
    (biblioteca): cabeçalho, planos, suportes, matriz, tintas, mat.acabamento,
    impressão, acabamentos, custos (MD/CT/SE/C.PROD), CEV, margens. Selo "Foto
    do Calcgraf — valores originais". Fallback para o resumo quando não houver
    foto rica.
    - _Requirements: 3.1, 3.2, 3.3, 3.5_
  - [ ] 4.2 Botão Imprimir/PDF da visão (paridade com o pré-cálculo impresso).
    - _Requirements: 3.4_

- [ ] 5. Checkpoint — validar o 11121 ponta a ponta
  - Tela do 11121 no Vizor bate com o PDF do Calcgraf seção por seção.
  - _Requirements: 5.1_

- [ ] 6. Aplicar a foto rica aos 7.951 (produção, idempotente)
  - Exportar todos, gravar a foto rica (lotes), relatório (quantos com/sem foto
    e por quê). Não toca PCP.
  - _Requirements: 5.2, 5.3, 6.2_

- [ ] 7. Camada 2 — Conferência ao recriar (anti-vergonha)
  - [ ] 7.1 Backend: ao reaproveitar/recalcular um item vindo de cálculo,
    retornar foto (Calcgraf) + recalculado (Vizor) + desvio por componente.
    - _Requirements: 4.1, 4.2_
  - [ ] 7.2 Frontend: exibir colunas Calcgraf × Vizor + desvio; ≤0,5% verde,
    senão alerta com motivo; operador escolhe qual valor vai à proposta.
    - _Requirements: 4.2, 4.3, 4.4, 4.5_

- [ ] 8. Checkpoint final
  - 11121 e amostra do acervo com foto rica completa; conferência funcionando.

## Notas
- `resultado_calculo` é Json existente — foto rica é aditiva (sem migração de
  schema).
- Fidelidade obrigatória: agregados (MD/CT/SE/C.PROD/Valor Total/margens) +
  receita nominal (planos/suportes/tintas/acabamentos). Subtotais por linha =
  best-effort do que o Calcgraf expõe.
- Produção: tabela isolada `calculo_grafico`; PCP intocado; connection string
  via env.
