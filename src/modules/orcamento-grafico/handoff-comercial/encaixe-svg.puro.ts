/**
 * Download da imagem do encaixe/imposição (R11 — spec orcamento-grafico-
 * handoff-comercial). PURO: renderiza o `encaixe.layout` que o motor já gera
 * (`resultadoCalculo.encaixe.layout`) como um SVG de documentação, com a folha,
 * a grade de peças (colunas × linhas) e uma legenda.
 *
 * Nada de recalcular — é só desenho determinístico do layout existente.
 */

export interface EncaixeLayout {
  folhaLarguraMm: number
  folhaAlturaMm: number
  colunas: number
  linhas: number
  pecaLarguraMm: number
  pecaAlturaMm: number
  orientacao?: 'NORMAL' | 'ROTACIONADA'
}

export interface EncaixeLegenda {
  orcamentoNumero?: number | string
  itemDescricao?: string | null
  aproveitamento?: number
  folhasNecessarias?: number
}

function esc(s: string): string {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function num(n: number): string {
  return Number.isFinite(n) ? String(Math.round(n * 100) / 100) : '0'
}

/**
 * Gera o SVG do encaixe. Determinístico: mesmo layout → mesmo SVG.
 * Retorna `null` quando o layout é inválido/ausente (sem folha ou sem grade) —
 * o chamador trata como "encaixe não gerado".
 *
 * @param layout dados do encaixe (do motor)
 * @param legenda metadados para a legenda (opcional)
 * @param larguraPx largura-alvo do desenho em px (default 800)
 */
export function encaixeParaSvg(
  layout: EncaixeLayout | null | undefined,
  legenda: EncaixeLegenda = {},
  larguraPx = 800,
): string | null {
  if (!layout) return null
  const { folhaLarguraMm, folhaAlturaMm, colunas, linhas, pecaLarguraMm, pecaAlturaMm } = layout
  if (!(folhaLarguraMm > 0) || !(folhaAlturaMm > 0) || !(colunas >= 1) || !(linhas >= 1)) return null

  const margem = 20
  const alturaLegenda = 70
  const escala = (larguraPx - margem * 2) / folhaLarguraMm
  const folhaWpx = folhaLarguraMm * escala
  const folhaHpx = folhaAlturaMm * escala
  const totalW = folhaWpx + margem * 2
  const totalH = folhaHpx + margem * 2 + alturaLegenda

  const pecaWpx = pecaLarguraMm * escala
  const pecaHpx = pecaAlturaMm * escala

  const pecas: string[] = []
  for (let c = 0; c < colunas; c++) {
    for (let l = 0; l < linhas; l++) {
      const x = margem + c * pecaWpx
      const y = margem + l * pecaHpx
      // Não desenha peça que ultrapassa a folha (segurança visual).
      if (x + pecaWpx > margem + folhaWpx + 0.5 || y + pecaHpx > margem + folhaHpx + 0.5) continue
      pecas.push(
        `<rect x="${num(x)}" y="${num(y)}" width="${num(pecaWpx)}" height="${num(pecaHpx)}" ` +
          `fill="#cfe3ff" stroke="#1f6feb" stroke-width="1"/>`,
      )
    }
  }

  const aprov = legenda.aproveitamento ?? colunas * linhas
  const linhaLegenda = [
    legenda.orcamentoNumero != null ? `Orçamento ${esc(String(legenda.orcamentoNumero))}` : null,
    legenda.itemDescricao ? esc(legenda.itemDescricao) : null,
    `Folha ${num(folhaLarguraMm)}×${num(folhaAlturaMm)} mm`,
    `Peça ${num(pecaLarguraMm)}×${num(pecaAlturaMm)} mm`,
    `Aproveitamento ${aprov} pç/folha`,
    legenda.folhasNecessarias != null ? `${legenda.folhasNecessarias} folhas` : null,
  ].filter(Boolean).join('  ·  ')

  const legendaY = margem + folhaHpx + 24

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${num(totalW)}" height="${num(totalH)}" viewBox="0 0 ${num(totalW)} ${num(totalH)}">
  <rect x="0" y="0" width="${num(totalW)}" height="${num(totalH)}" fill="#ffffff"/>
  <rect x="${margem}" y="${margem}" width="${num(folhaWpx)}" height="${num(folhaHpx)}" fill="#f6f8fa" stroke="#868e96" stroke-width="1.5"/>
  ${pecas.join('\n  ')}
  <text x="${margem}" y="${num(legendaY)}" font-family="Arial, sans-serif" font-size="13" fill="#212529">${linhaLegenda}</text>
</svg>`
}
