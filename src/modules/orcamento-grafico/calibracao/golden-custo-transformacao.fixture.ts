/**
 * Fixtures de calibração do CUSTO DE TRANSFORMAÇÃO (Nível B, passo 2) — dados
 * REAIS do Calcgraf (banco restaurado CalcgrafCartonWega + memória de cálculo
 * do pré-cálculo 5355/15185).
 *
 * Fonte dos tempos: a memória de cálculo (pré-cálculo) lista, por atividade,
 * o tempo FIXO (acerto) e VARIÁVEL (produção) em HH:MM, o custo/hora e o
 * subtotal. Os custos-hora são da Tabela de Custos VIGENTE (Tabela 2).
 *
 * Validação cruzada: a soma dos subtotais = C.Transf do rodapé (10.453,30) e
 * bate com CalculoResAgrupamento (CustoFixo 3503,27 + CustoUnit 0,69500 × 10000).
 *
 * Ver docs/calcgraf-custo-transformacao.md para a derivação completa.
 */

import type { AtividadeCT } from '../custo-transformacao'

const hm = (h: number, m: number) => h + m / 60

/** Caso 15185 (CAIXA MÃE 12 cartuchos) — tiragem detalhada 10.000, 2 partes. */
export interface GoldenCT {
  numero: number
  descricao: string
  tiragem: number
  atividades: AtividadeCT[]
  /** Alvos reais (CalculoResAgrupamento, agrupamento 1). */
  custoFixoReal: number
  custoUnitarioReal: number
  /** Tolerância relativa aceitável (arredondamento HH:MM da memória). */
  tolerancia: number
}

/**
 * 15185 — atividades com tempos/custos REAIS da memória de cálculo.
 * As `unidadesProcessadas` e `producaoHora` reproduzem o VAR observado
 * (var_horas × producaoHora = unidades), e os parâmetros de acerto reproduzem
 * o FIXO observado. acertoPorCorMin: Heidelberg CD (CC2) = 25 min/cor.
 */
export const GOLDEN_CT: GoldenCT[] = [
  {
    numero: 15185,
    descricao: 'CAIXA MÃE 12 cartuchos — tir 10.000, 2 partes',
    tiragem: 10000,
    custoFixoReal: 3503.2717,
    custoUnitarioReal: 0.6950025,
    tolerancia: 0.01,
    atividades: [
      // Impressão Offset Heidelberg CD (CC2, Tab2 440/h) — 4 cores, 25 min/cor,
      // 2 ocorrências (PARTE 01 + PARTE 02). FIXO = 4×25×2 = 200 min.
      // VAR memória 02:44 → 15.033 folhas @5500/h.
      {
        nome: 'Offset Heidelberg CD 5cores',
        impressao: true,
        custoHora: 440.0,
        producaoHora: 5500,
        unidadesProcessadas: hm(2, 44) * 5500,
        ocorrencias: 2,
        cores: 4,
        acertoPorCorMin: 25,
        tempoPrimeiroAcertoMin: 0,
      },
      // Cortadeira (CC5, 113,21/h) — FIXO 00:30 (2×15), VAR 04:08 @3000.
      {
        nome: 'Cortadeira (Grande)',
        impressao: false,
        custoHora: 113.21,
        producaoHora: 3000,
        unidadesProcessadas: hm(4, 8) * 3000,
        ocorrencias: 2,
        quantAcertos: 1,
        tempoPorAcertoMin: 0,
        tempoPrimeiroAcertoMin: 15,
      },
      // Guilhotina maior (CC14, 77,69/h) — FIXO 0, VAR 04:01 @4000.
      {
        nome: 'Guilhotina maior',
        impressao: false,
        custoHora: 77.69,
        producaoHora: 4000,
        unidadesProcessadas: hm(4, 1) * 4000,
        ocorrencias: 2,
        quantAcertos: 1,
        tempoPorAcertoMin: 0,
        tempoPrimeiroAcertoMin: 0,
      },
      // HotStamping (CC26, 110/h) — FIXO 02:00 (t1=120), VAR 18:19 @466.
      {
        nome: 'HotStamping',
        impressao: false,
        custoHora: 110.0,
        producaoHora: 466,
        unidadesProcessadas: hm(18, 19) * 466,
        ocorrencias: 1,
        quantAcertos: 1,
        tempoPorAcertoMin: 0,
        tempoPrimeiroAcertoMin: 120,
      },
      // HotStamping 2 (CC26, 110/h) — FIXO 02:00, VAR 10:44 @546.
      {
        nome: 'HotStamping 2',
        impressao: false,
        custoHora: 110.0,
        producaoHora: 546,
        unidadesProcessadas: hm(10, 44) * 546,
        ocorrencias: 1,
        quantAcertos: 1,
        tempoPorAcertoMin: 0,
        tempoPrimeiroAcertoMin: 120,
      },
      // Mazola acoplagem (CC18, 80/h) — FIXO 00:30 (2×15), VAR 10:00 @1500.
      {
        nome: 'Mazola (acoplagem)',
        impressao: false,
        custoHora: 80.0,
        producaoHora: 1500,
        unidadesProcessadas: hm(10, 0) * 1500,
        ocorrencias: 2,
        quantAcertos: 1,
        tempoPorAcertoMin: 0,
        tempoPrimeiroAcertoMin: 15,
      },
      // Bobst E (CC8, 300/h) — FIXO 05:00 (2×150), VAR 03:00 @5000.
      {
        nome: 'Bobst E',
        impressao: false,
        custoHora: 300.0,
        producaoHora: 5000,
        unidadesProcessadas: hm(3, 0) * 5000,
        ocorrencias: 2,
        quantAcertos: 1,
        tempoPorAcertoMin: 0,
        tempoPrimeiroAcertoMin: 150,
      },
      // Destacar (CC30, 50/h) — FIXO 0, VAR 01:30 @10000.
      {
        nome: 'Destacar',
        impressao: false,
        custoHora: 50.0,
        producaoHora: 10000,
        unidadesProcessadas: hm(1, 30) * 10000,
        ocorrencias: 2,
        quantAcertos: 1,
        tempoPorAcertoMin: 0,
        tempoPrimeiroAcertoMin: 0,
      },
    ],
  },
]
