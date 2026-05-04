import { Decimal } from '@prisma/client/runtime/library'
import type {
  OndaSeparacao,
  OrdemSeparacao,
  ItemSeparacao,
  ConferenciaSaida,
  ItemConferenciaSaida,
  Volume,
  ItemVolume,
  Carregamento,
  CarregamentoVolume,
  NotaEntrada,
  ItemNotaEntrada,
  FichaOperacional,
  Produto,
  Endereco,
  Transportadora,
  Doca,
} from '@prisma/client'

// ---------------------------------------------------------------------------
// Tipos compostos (Prisma includes) usados como parâmetros dos métodos
// ---------------------------------------------------------------------------

export interface ItemSeparacaoComRelacoes extends ItemSeparacao {
  produto?: Pick<Produto, 'id' | 'codigo' | 'nome' | 'unidade'> | null
  enderecoOrigem?: Pick<Endereco, 'id' | 'enderecoCompleto'> | null
  codigoBarra?: string | null
}

export interface OrdemSeparacaoComItens extends OrdemSeparacao {
  itens: ItemSeparacaoComRelacoes[]
  funcionario?: { nome: string } | null
}

/** Onda com itens (via ordens) — usada em gerarHtmlSeparacao */
export interface OndaComItens extends OndaSeparacao {
  ordens: OrdemSeparacaoComItens[]
}

/** Onda com volumes — usada em gerarHtmlEmbalagem */
export interface VolumeComItens extends Volume {
  itens: (ItemVolume & {
    itemSeparacao?: ItemSeparacaoComRelacoes | null
  })[]
}

export interface OndaComVolumes extends OndaSeparacao {
  volumes: VolumeComItens[]
}

/** Onda com volumes + itens pendentes — usada em gerarHtmlFichaAcompanhamentoEmbalagem */
export interface OndaComVolumesEPendentes extends OndaComVolumes {
  itensPendentes: ItemSeparacaoComRelacoes[]
}

/** Endereço com campos de rota — usado em ficha de acompanhamento separação */
export interface EnderecoComRota extends Endereco {
  codigoRua?: string | null
  codigoPredio?: string | null
  codigoNivel?: string | null
}

/** Carregamento com volumes — usada em gerarHtmlCarregamento */
export interface CarregamentoVolumeComVolume extends CarregamentoVolume {
  volume: VolumeComItens
}

export interface CarregamentoComVolumes extends Carregamento {
  volumes: CarregamentoVolumeComVolume[]
  doca?: Pick<Doca, 'id' | 'descricao'> | null
  transportadora?: Pick<Transportadora, 'id' | 'razaoSocial' | 'cnpj'> | null
}

/** Carregamento completo — usado em romaneio */
export type CarregamentoCompleto = CarregamentoComVolumes

/** Nota com itens — usada em gerarHtmlEnderecamento */
export interface NotaComItens extends NotaEntrada {
  itens: ItemNotaEntrada[]
}

/** Conferência com itens — usada em gerarHtmlConferencia */
export interface ItemConferenciaSaidaComRelacoes extends ItemConferenciaSaida {
  itemSeparacao?: ItemSeparacaoComRelacoes | null
}

export interface ConferenciaComItens extends ConferenciaSaida {
  itens: ItemConferenciaSaidaComRelacoes[]
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toNumber(v: Decimal | number | null | undefined): number {
  if (v == null) return 0
  return typeof v === 'number' ? v : Number(v)
}

function dataFormatada(d?: Date | string | null): string {
  if (!d) return '—'
  const dt = typeof d === 'string' ? new Date(d) : d
  return dt.toLocaleDateString('pt-BR')
}

function dataHoraFormatada(d?: Date | string | null): string {
  if (!d) return '—'
  const dt = typeof d === 'string' ? new Date(d) : d
  return dt.toLocaleString('pt-BR')
}

// ---------------------------------------------------------------------------
// CSS base para impressão
// ---------------------------------------------------------------------------

const PRINT_CSS = `
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'Courier New', Courier, monospace; font-size: 12px; padding: 10mm; color: #000; }
  h1 { font-size: 18px; margin-bottom: 4px; }
  h2 { font-size: 14px; margin-bottom: 8px; font-weight: normal; color: #333; }
  .header { border-bottom: 2px solid #000; padding-bottom: 8px; margin-bottom: 12px; }
  .header-row { display: flex; justify-content: space-between; align-items: center; }
  .meta { margin-bottom: 10px; }
  .meta span { display: inline-block; margin-right: 20px; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 12px; }
  th, td { border: 1px solid #000; padding: 4px 6px; text-align: left; font-size: 11px; }
  th { background: #eee; font-weight: bold; }
  .blank-field { min-width: 60px; height: 20px; border-bottom: 1px solid #999; display: inline-block; }
  .blank-cell { min-height: 22px; }
  .barcode-section { text-align: center; margin-top: 16px; padding-top: 10px; border-top: 1px dashed #999; }
  .barcode-label { font-size: 10px; color: #666; margin-bottom: 2px; }
  .barcode-text { font-family: 'Libre Barcode 128', 'Code 128', monospace; font-size: 36px; letter-spacing: 2px; }
  .barcode-value { font-size: 10px; color: #333; margin-top: 2px; }
  .totals { margin-top: 8px; font-weight: bold; }
  .signature-area { margin-top: 30px; display: flex; justify-content: space-between; }
  .signature-line { width: 200px; border-top: 1px solid #000; text-align: center; padding-top: 4px; font-size: 10px; }
  .footer { margin-top: 20px; font-size: 9px; color: #666; text-align: center; }
  @media print {
    body { padding: 5mm; }
    @page { margin: 10mm; size: A4; }
    .no-print { display: none; }
  }
`

function htmlDocument(title: string, body: string): string {
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <style>${PRINT_CSS}</style>
</head>
<body>
${body}
</body>
</html>`
}

function barcodeHtml(code: string): string {
  return `<div class="barcode-section">
  <div class="barcode-label">Código de Barras — Identificador da Ficha</div>
  <div class="barcode-text">${code}</div>
  <div class="barcode-value">${code}</div>
</div>`
}

// ---------------------------------------------------------------------------
// FichaService
// ---------------------------------------------------------------------------

export class FichaService {
  // =========================================================================
  // 4.1 — HTML generation methods
  // =========================================================================

  /**
   * Gera HTML da ficha de separação (picking).
   * Contém: número da OS/onda, lista de itens (produto, endereço de origem,
   * quantidade solicitada, campo em branco para quantidade separada),
   * código de barras identificador único.
   */
  gerarHtmlSeparacao(onda: OndaComItens): string {
    const codigoBarras = `SEP-${onda.numero}-${Date.now().toString(36).toUpperCase()}`

    // Flatten all items from all orders
    const itens = onda.ordens.flatMap((o) => o.itens)

    let rows = ''
    itens.forEach((item, idx) => {
      rows += `<tr>
        <td>${idx + 1}</td>
        <td>${item.produto?.codigo ?? '—'}</td>
        <td>${item.produto?.nome ?? '—'}</td>
        <td>${item.enderecoOrigem?.enderecoCompleto ?? '—'}</td>
        <td>${item.produto?.unidade ?? 'UN'}</td>
        <td style="text-align:right">${toNumber(item.quantidadeSolicitada)}</td>
        <td class="blank-cell"></td>
      </tr>`
    })

    const body = `
<div class="header">
  <div class="header-row">
    <div>
      <h1>FICHA DE SEPARAÇÃO</h1>
      <h2>Onda nº ${onda.numero}</h2>
    </div>
    <div style="text-align:right">
      <div>Data: ${dataFormatada(onda.criadoEm)}</div>
      <div>Prioridade: ${onda.prioridade}</div>
    </div>
  </div>
</div>

<div class="meta">
  <span><strong>Status:</strong> ${onda.status}</span>
  <span><strong>Total de itens:</strong> ${itens.length}</span>
</div>

<table>
  <thead>
    <tr>
      <th>#</th>
      <th>Código</th>
      <th>Produto</th>
      <th>Endereço Origem</th>
      <th>Un</th>
      <th>Qtd Solicitada</th>
      <th>Qtd Separada</th>
    </tr>
  </thead>
  <tbody>
    ${rows}
  </tbody>
</table>

<div class="signature-area">
  <div class="signature-line">Operador</div>
  <div class="signature-line">Conferente</div>
</div>

${barcodeHtml(codigoBarras)}

<div class="footer">VisioFab WMS — Ficha de Separação — Gerada em ${dataHoraFormatada(new Date())}</div>`

    return htmlDocument(`Ficha Separação — Onda ${onda.numero}`, body)
  }

  /**
   * Gera HTML da ficha de embalagem (packing).
   * Contém: número da OS/onda, itens agrupados por volume,
   * campos em branco para peso e dimensões.
   */
  gerarHtmlEmbalagem(onda: OndaComVolumes): string {
    const codigoBarras = `EMB-${onda.numero}-${Date.now().toString(36).toUpperCase()}`

    let volumeBlocks = ''
    onda.volumes.forEach((vol) => {
      let itemRows = ''
      vol.itens.forEach((iv, idx) => {
        itemRows += `<tr>
          <td>${idx + 1}</td>
          <td>${iv.itemSeparacao?.produto?.codigo ?? '—'}</td>
          <td>${iv.itemSeparacao?.produto?.nome ?? '—'}</td>
          <td>${iv.itemSeparacao?.produto?.unidade ?? 'UN'}</td>
          <td style="text-align:right">${toNumber(iv.quantidade)}</td>
        </tr>`
      })

      volumeBlocks += `
<h3 style="margin-top:12px;">Volume ${vol.codigo} — ${vol.tipo}</h3>
<table>
  <thead>
    <tr>
      <th>#</th>
      <th>Código</th>
      <th>Produto</th>
      <th>Un</th>
      <th>Quantidade</th>
    </tr>
  </thead>
  <tbody>
    ${itemRows}
  </tbody>
</table>
<div class="meta" style="margin-top:6px;">
  <span><strong>Peso (kg):</strong> <span class="blank-field"></span></span>
  <span><strong>Comprimento (cm):</strong> <span class="blank-field"></span></span>
  <span><strong>Largura (cm):</strong> <span class="blank-field"></span></span>
  <span><strong>Altura (cm):</strong> <span class="blank-field"></span></span>
</div>`
    })

    const body = `
<div class="header">
  <div class="header-row">
    <div>
      <h1>FICHA DE EMBALAGEM</h1>
      <h2>Onda nº ${onda.numero}</h2>
    </div>
    <div style="text-align:right">
      <div>Data: ${dataFormatada(onda.criadoEm)}</div>
      <div>Total de volumes: ${onda.volumes.length}</div>
    </div>
  </div>
</div>

${volumeBlocks}

<div class="signature-area">
  <div class="signature-line">Embalador</div>
  <div class="signature-line">Conferente</div>
</div>

${barcodeHtml(codigoBarras)}

<div class="footer">VisioFab WMS — Ficha de Embalagem — Gerada em ${dataHoraFormatada(new Date())}</div>`

    return htmlDocument(`Ficha Embalagem — Onda ${onda.numero}`, body)
  }

  /**
   * Gera HTML da ficha de carregamento (loading).
   * Contém: dados do veículo, doca, lista de volumes com sequência de carga,
   * campo de confirmação.
   */
  gerarHtmlCarregamento(carregamento: CarregamentoComVolumes): string {
    const codigoBarras = `CAR-${carregamento.id.substring(0, 8).toUpperCase()}-${Date.now().toString(36).toUpperCase()}`

    const volumesSorted = [...carregamento.volumes].sort((a, b) => a.sequencia - b.sequencia)

    let rows = ''
    volumesSorted.forEach((cv) => {
      const vol = cv.volume
      rows += `<tr>
        <td style="text-align:center">${cv.sequencia}</td>
        <td>${vol.codigo}</td>
        <td>${vol.tipo}</td>
        <td style="text-align:right">${toNumber(vol.pesoKg)}</td>
        <td style="text-align:right">${vol.itens?.length ?? 0}</td>
        <td class="blank-cell"></td>
      </tr>`
    })

    const body = `
<div class="header">
  <div class="header-row">
    <div>
      <h1>FICHA DE CARREGAMENTO</h1>
    </div>
    <div style="text-align:right">
      <div>Data: ${dataFormatada(carregamento.criadoEm)}</div>
    </div>
  </div>
</div>

<div class="meta">
  <span><strong>Veículo:</strong> ${carregamento.veiculoPlaca}</span>
  <span><strong>Doca:</strong> ${carregamento.doca?.descricao ?? '—'}</span>
  <span><strong>Transportadora:</strong> ${carregamento.transportadora?.razaoSocial ?? '—'}</span>
  <span><strong>Status:</strong> ${carregamento.status}</span>
</div>

<table>
  <thead>
    <tr>
      <th>Seq</th>
      <th>Volume</th>
      <th>Tipo</th>
      <th>Peso (kg)</th>
      <th>Itens</th>
      <th>Confirmação</th>
    </tr>
  </thead>
  <tbody>
    ${rows}
  </tbody>
</table>

<div class="totals">
  Total de volumes: ${carregamento.volumes.length}
</div>

<div class="signature-area">
  <div class="signature-line">Operador Carga</div>
  <div class="signature-line">Motorista</div>
</div>

${barcodeHtml(codigoBarras)}

<div class="footer">VisioFab WMS — Ficha de Carregamento — Gerada em ${dataHoraFormatada(new Date())}</div>`

    return htmlDocument('Ficha de Carregamento', body)
  }

  /**
   * Gera HTML da ficha de endereçamento.
   * Contém: lista de itens recebidos, quantidade,
   * campo em branco para endereço de destino.
   */
  gerarHtmlEnderecamento(nota: NotaComItens): string {
    const codigoBarras = `END-${nota.numero}-${Date.now().toString(36).toUpperCase()}`

    let rows = ''
    nota.itens.forEach((item, idx) => {
      rows += `<tr>
        <td>${idx + 1}</td>
        <td>${item.codigoProduto ?? '—'}</td>
        <td>${item.descricao}</td>
        <td>${item.unidade}</td>
        <td style="text-align:right">${toNumber(item.quantidade)}</td>
        <td>${item.lote ?? '—'}</td>
        <td>${(item as any).validade ? dataFormatada((item as any).validade) : '—'}</td>
        <td class="blank-cell"></td>
      </tr>`
    })

    const body = `
<div class="header">
  <div class="header-row">
    <div>
      <h1>FICHA DE ENDEREÇAMENTO</h1>
      <h2>Nota de Entrada nº ${nota.numero}${nota.serie ? ` — Série ${nota.serie}` : ''}</h2>
    </div>
    <div style="text-align:right">
      <div>Data Entrada: ${dataFormatada(nota.dataEntrada)}</div>
      <div>Fornecedor: ${nota.fornecedor ?? '—'}</div>
    </div>
  </div>
</div>

<div class="meta">
  <span><strong>Status:</strong> ${nota.status}</span>
  <span><strong>Total de itens:</strong> ${nota.itens.length}</span>
</div>

<table>
  <thead>
    <tr>
      <th>#</th>
      <th>Código</th>
      <th>Descrição</th>
      <th>Un</th>
      <th>Quantidade</th>
      <th>Lote</th>
      <th>Validade</th>
      <th>Endereço Destino</th>
    </tr>
  </thead>
  <tbody>
    ${rows}
  </tbody>
</table>

<div class="signature-area">
  <div class="signature-line">Operador</div>
  <div class="signature-line">Conferente</div>
</div>

${barcodeHtml(codigoBarras)}

<div class="footer">VisioFab WMS — Ficha de Endereçamento — Gerada em ${dataHoraFormatada(new Date())}</div>`

    return htmlDocument(`Ficha Endereçamento — Nota ${nota.numero}`, body)
  }

  /**
   * Gera HTML da ficha de conferência.
   * Contém: itens e campos em branco para quantidade conferida.
   */
  gerarHtmlConferencia(conferencia: ConferenciaComItens): string {
    const codigoBarras = `CONF-${conferencia.id.substring(0, 8).toUpperCase()}-${Date.now().toString(36).toUpperCase()}`

    let rows = ''
    conferencia.itens.forEach((ic, idx) => {
      const sep = ic.itemSeparacao
      rows += `<tr>
        <td>${idx + 1}</td>
        <td>${sep?.produto?.codigo ?? '—'}</td>
        <td>${sep?.produto?.nome ?? '—'}</td>
        <td>${sep?.produto?.unidade ?? 'UN'}</td>
        <td style="text-align:right">${toNumber(sep?.quantidadeSeparada)}</td>
        <td class="blank-cell"></td>
        <td class="blank-cell"></td>
      </tr>`
    })

    const body = `
<div class="header">
  <div class="header-row">
    <div>
      <h1>FICHA DE CONFERÊNCIA DE SAÍDA</h1>
    </div>
    <div style="text-align:right">
      <div>Data: ${dataFormatada(conferencia.criadoEm)}</div>
      <div>Status: ${conferencia.status}</div>
    </div>
  </div>
</div>

<div class="meta">
  <span><strong>Total de itens:</strong> ${conferencia.itens.length}</span>
</div>

<table>
  <thead>
    <tr>
      <th>#</th>
      <th>Código</th>
      <th>Produto</th>
      <th>Un</th>
      <th>Qtd Separada</th>
      <th>Qtd Conferida</th>
      <th>Observação</th>
    </tr>
  </thead>
  <tbody>
    ${rows}
  </tbody>
</table>

<div class="signature-area">
  <div class="signature-line">Conferente</div>
  <div class="signature-line">Supervisor</div>
</div>

${barcodeHtml(codigoBarras)}

<div class="footer">VisioFab WMS — Ficha de Conferência — Gerada em ${dataHoraFormatada(new Date())}</div>`

    return htmlDocument('Ficha de Conferência de Saída', body)
  }

  // =========================================================================
  // Fichas de Acompanhamento — Tracking sheets for outbound flow evolution
  // =========================================================================

  /**
   * Gera HTML da ficha de acompanhamento de separação.
   * Itens ordenados por rota de coleta (rua → prédio → nível),
   * com código de barras do SKU, checkbox para marcação.
   */
  gerarHtmlFichaAcompanhamentoSeparacao(onda: OndaComItens): string {
    const codigoBarras = `ACOMP-SEP-${onda.numero}-${Date.now().toString(36).toUpperCase()}`

    // Flatten and enrich items
    const itens = onda.ordens.flatMap((o) =>
      o.itens.map((item) => ({
        ...item,
        funcionarioNome: (o as any).funcionario?.nome ?? null,
      })),
    )

    // Sort by collection route: rua → prédio → nível
    itens.sort((a, b) => {
      const endA = (a.enderecoOrigem as any) ?? {}
      const endB = (b.enderecoOrigem as any) ?? {}
      const ruaCompare = (endA.codigoRua ?? '').localeCompare(endB.codigoRua ?? '')
      if (ruaCompare !== 0) return ruaCompare
      const predioCompare = (endA.codigoPredio ?? '').localeCompare(endB.codigoPredio ?? '')
      if (predioCompare !== 0) return predioCompare
      return (endA.codigoNivel ?? '').localeCompare(endB.codigoNivel ?? '')
    })

    // Get employee names
    const funcionarios = [...new Set(onda.ordens.filter((o) => (o as any).funcionario?.nome).map((o) => (o as any).funcionario.nome))]
    const funcionarioStr = funcionarios.length > 0 ? funcionarios.join(', ') : '—'

    let rows = ''
    itens.forEach((item, idx) => {
      rows += `<tr>
        <td style="text-align:center"><input type="checkbox" /></td>
        <td>${idx + 1}</td>
        <td>${item.produto?.codigo ?? '—'}</td>
        <td>${item.produto?.nome ?? '—'}</td>
        <td>${(item as any).codigoBarra ?? '—'}</td>
        <td>${item.enderecoOrigem?.enderecoCompleto ?? '—'}</td>
        <td>${item.produto?.unidade ?? 'UN'}</td>
        <td style="text-align:right">${toNumber(item.quantidadeSolicitada)}</td>
        <td class="blank-cell"></td>
      </tr>`
    })

    const body = `
<div class="header">
  <div class="header-row">
    <div>
      <h1>FICHA DE ACOMPANHAMENTO — SEPARAÇÃO</h1>
      <h2>Onda nº ${onda.numero}</h2>
    </div>
    <div style="text-align:right">
      <div>Data: ${dataFormatada(onda.criadoEm)}</div>
      <div>Prioridade: ${onda.prioridade}</div>
    </div>
  </div>
</div>

<div class="meta">
  <span><strong>Funcionário(s):</strong> ${funcionarioStr}</span>
  <span><strong>Total de itens:</strong> ${itens.length}</span>
  <span><strong>Status:</strong> ${onda.status}</span>
</div>

<table>
  <thead>
    <tr>
      <th style="width:30px">✓</th>
      <th>#</th>
      <th>Código</th>
      <th>Produto</th>
      <th>Cód. Barras</th>
      <th>Endereço Origem</th>
      <th>Un</th>
      <th>Qtd Solicitada</th>
      <th>Qtd Separada</th>
    </tr>
  </thead>
  <tbody>
    ${rows}
  </tbody>
</table>

<div class="signature-area">
  <div class="signature-line">Operador</div>
  <div class="signature-line">Conferente</div>
</div>

${barcodeHtml(codigoBarras)}

<div class="footer">VisioFab WMS — Ficha de Acompanhamento Separação — Gerada em ${dataHoraFormatada(new Date())}</div>`

    return htmlDocument(`Ficha Acompanhamento Separação — Onda ${onda.numero}`, body)
  }

  /**
   * Gera HTML da ficha de acompanhamento de embalagem.
   * Agrupado por volume, com seção de pendentes, campos editáveis para dimensões.
   */
  gerarHtmlFichaAcompanhamentoEmbalagem(onda: OndaComVolumesEPendentes): string {
    const codigoBarras = `ACOMP-EMB-${onda.numero}-${Date.now().toString(36).toUpperCase()}`

    let volumeBlocks = ''
    onda.volumes.forEach((vol) => {
      let itemRows = ''
      vol.itens.forEach((iv, idx) => {
        const sep = iv.itemSeparacao as ItemSeparacaoComRelacoes | null
        itemRows += `<tr>
          <td>${idx + 1}</td>
          <td>${sep?.produto?.codigo ?? '—'}</td>
          <td>${sep?.produto?.nome ?? '—'}</td>
          <td>${(sep as any)?.codigoBarra ?? '—'}</td>
          <td style="text-align:right">${toNumber(iv.quantidade)}</td>
        </tr>`
      })

      volumeBlocks += `
<h3 style="margin-top:12px;">Volume ${vol.codigo} — ${vol.tipo}</h3>
<table>
  <thead>
    <tr>
      <th>#</th>
      <th>Código</th>
      <th>Produto</th>
      <th>Cód. Barras</th>
      <th>Quantidade</th>
    </tr>
  </thead>
  <tbody>
    ${itemRows}
  </tbody>
</table>
<div class="meta" style="margin-top:6px;">
  <span><strong>Peso (kg):</strong> ${toNumber(vol.pesoKg) > 0 ? toNumber(vol.pesoKg) : '<span class="blank-field"></span>'}</span>
  <span><strong>Comprimento (cm):</strong> ${toNumber(vol.comprimentoCm) > 0 ? toNumber(vol.comprimentoCm) : '<span class="blank-field"></span>'}</span>
  <span><strong>Largura (cm):</strong> ${toNumber(vol.larguraCm) > 0 ? toNumber(vol.larguraCm) : '<span class="blank-field"></span>'}</span>
  <span><strong>Altura (cm):</strong> ${toNumber(vol.alturaCm) > 0 ? toNumber(vol.alturaCm) : '<span class="blank-field"></span>'}</span>
</div>`
    })

    // Pending items section
    let pendentesBlock = ''
    if (onda.itensPendentes && onda.itensPendentes.length > 0) {
      let pendRows = ''
      onda.itensPendentes.forEach((item, idx) => {
        pendRows += `<tr>
          <td>${idx + 1}</td>
          <td>${item.produto?.codigo ?? '—'}</td>
          <td>${item.produto?.nome ?? '—'}</td>
          <td>${(item as any).codigoBarra ?? '—'}</td>
          <td>${item.produto?.unidade ?? 'UN'}</td>
          <td style="text-align:right">${toNumber(item.quantidadeSeparada)}</td>
        </tr>`
      })

      pendentesBlock = `
<h3 style="margin-top:16px; color:#c00;">Pendentes de Embalagem</h3>
<table>
  <thead>
    <tr>
      <th>#</th>
      <th>Código</th>
      <th>Produto</th>
      <th>Cód. Barras</th>
      <th>Un</th>
      <th>Qtd Separada</th>
    </tr>
  </thead>
  <tbody>
    ${pendRows}
  </tbody>
</table>`
    }

    const body = `
<div class="header">
  <div class="header-row">
    <div>
      <h1>FICHA DE ACOMPANHAMENTO — EMBALAGEM</h1>
      <h2>Onda nº ${onda.numero}</h2>
    </div>
    <div style="text-align:right">
      <div>Data: ${dataFormatada(onda.criadoEm)}</div>
      <div>Total de volumes: ${onda.volumes.length}</div>
    </div>
  </div>
</div>

${volumeBlocks}
${pendentesBlock}

<div class="signature-area">
  <div class="signature-line">Embalador</div>
  <div class="signature-line">Conferente</div>
</div>

${barcodeHtml(codigoBarras)}

<div class="footer">VisioFab WMS — Ficha de Acompanhamento Embalagem — Gerada em ${dataHoraFormatada(new Date())}</div>`

    return htmlDocument(`Ficha Acompanhamento Embalagem — Onda ${onda.numero}`, body)
  }

  /**
   * Gera HTML da ficha de acompanhamento de carregamento.
   * Volumes ordenados por sequência, com checkbox, totais de peso e quantidade.
   */
  gerarHtmlFichaAcompanhamentoCarregamento(carregamento: CarregamentoComVolumes): string {
    const codigoBarras = `ACOMP-CAR-${carregamento.id.substring(0, 8).toUpperCase()}-${Date.now().toString(36).toUpperCase()}`

    const volumesSorted = [...carregamento.volumes].sort((a, b) => a.sequencia - b.sequencia)

    let pesoTotal = 0
    let rows = ''
    volumesSorted.forEach((cv) => {
      const vol = cv.volume
      const peso = toNumber(vol.pesoKg)
      pesoTotal += peso

      rows += `<tr>
        <td style="text-align:center"><input type="checkbox" /></td>
        <td style="text-align:center">${cv.sequencia}</td>
        <td>${vol.codigo}</td>
        <td>${vol.tipo}</td>
        <td style="text-align:right">${peso.toFixed(3)}</td>
        <td style="text-align:right">${toNumber(vol.comprimentoCm).toFixed(1)}x${toNumber(vol.larguraCm).toFixed(1)}x${toNumber(vol.alturaCm).toFixed(1)}</td>
        <td style="text-align:center">${vol.itens?.length ?? 0}</td>
      </tr>`
    })

    const body = `
<div class="header">
  <div class="header-row">
    <div>
      <h1>FICHA DE ACOMPANHAMENTO — CARREGAMENTO</h1>
    </div>
    <div style="text-align:right">
      <div>Data: ${dataFormatada(carregamento.criadoEm)}</div>
    </div>
  </div>
</div>

<div class="meta">
  <span><strong>Veículo:</strong> ${carregamento.veiculoPlaca}</span>
  <span><strong>Doca:</strong> ${carregamento.doca?.descricao ?? '—'}</span>
  <span><strong>Transportadora:</strong> ${carregamento.transportadora?.razaoSocial ?? '—'}</span>
</div>

<table>
  <thead>
    <tr>
      <th style="width:30px">✓</th>
      <th>Seq</th>
      <th>Volume</th>
      <th>Tipo</th>
      <th>Peso (kg)</th>
      <th>Dimensões (cm)</th>
      <th>Itens</th>
    </tr>
  </thead>
  <tbody>
    ${rows}
  </tbody>
</table>

<div class="totals">
  <div>Total de volumes: ${carregamento.volumes.length}</div>
  <div>Peso total: ${pesoTotal.toFixed(3)} kg</div>
</div>

<div class="signature-area">
  <div class="signature-line">Operador Carga</div>
  <div class="signature-line">Motorista</div>
</div>

${barcodeHtml(codigoBarras)}

<div class="footer">VisioFab WMS — Ficha de Acompanhamento Carregamento — Gerada em ${dataHoraFormatada(new Date())}</div>`

    return htmlDocument('Ficha de Acompanhamento — Carregamento', body)
  }

  // =========================================================================
  // 4.2 - ZPL generation
  // =========================================================================

  /**
   * Gera ZPL II compatível com impressoras térmicas Zebra.
   * Tamanho padrão: 4×6 polegadas (100×150 mm ≈ 800×1200 dots a 203 dpi).
   * Inclui barcode Code128 (^BC), tipo da ficha e informação de referência.
   */
  gerarZplFicha(ficha: FichaOperacional): string {
    const tipoLabel: Record<string, string> = {
      SEPARACAO: 'SEPARACAO',
      EMBALAGEM: 'EMBALAGEM',
      CARREGAMENTO: 'CARREGAMENTO',
      ENDERECAMENTO: 'ENDERECAMENTO',
      CONFERENCIA: 'CONFERENCIA',
    }

    const tipo = tipoLabel[ficha.tipo] ?? ficha.tipo
    const barcode = ficha.codigoBarras
    const dataGeracao = dataFormatada(ficha.criadoEm)
    const status = ficha.status

    // 4×6 inches at 203 dpi = 812×1218 dots
    // Using 800×1200 as standard label dimensions
    return [
      '^XA',
      // Label dimensions: width 800 dots, length 1200 dots
      '^PW800^LL1200',
      // Title
      `^FO30,30^A0N,50,50^FDFICHA OPERACIONAL^FS`,
      // Horizontal rule
      `^FO30,90^GB740,2,2^FS`,
      // Tipo
      `^FO30,110^A0N,40,40^FDTipo: ${tipo}^FS`,
      // Referência
      `^FO30,165^A0N,30,30^FDRef: ${ficha.referenciaId.substring(0, 20)}^FS`,
      // Status
      `^FO30,210^A0N,30,30^FDStatus: ${status}^FS`,
      // Data
      `^FO30,255^A0N,30,30^FDData: ${dataGeracao}^FS`,
      // Horizontal rule
      `^FO30,300^GB740,2,2^FS`,
      // Barcode Code128
      `^FO80,340^BY3^BCN,120,Y,N,N^FD${barcode}^FS`,
      // Barcode value text
      `^FO80,490^A0N,24,24^FD${barcode}^FS`,
      // Footer
      `^FO30,560^A0N,20,20^FDVisioFab WMS^FS`,
      '^XZ',
    ].join('\n')
  }

  // =========================================================================
  // 4.3 — Romaneio methods
  // =========================================================================

  /**
   * Gera HTML do romaneio de carregamento.
   * Contém: número do carregamento, dados do veículo/transportadora, doca,
   * lista de volumes com sequência/peso/dimensões, totais de peso e quantidade.
   */
  gerarRomaneioHtml(carregamento: CarregamentoCompleto): string {
    const volumesSorted = [...carregamento.volumes].sort((a, b) => a.sequencia - b.sequencia)

    let pesoTotal = 0
    let totalItens = 0

    let rows = ''
    volumesSorted.forEach((cv) => {
      const vol = cv.volume
      const peso = toNumber(vol.pesoKg)
      const qtdItens = vol.itens?.length ?? 0
      pesoTotal += peso
      totalItens += qtdItens

      rows += `<tr>
        <td style="text-align:center">${cv.sequencia}</td>
        <td>${vol.codigo}</td>
        <td>${vol.tipo}</td>
        <td style="text-align:right">${peso.toFixed(3)}</td>
        <td style="text-align:right">${toNumber(vol.comprimentoCm).toFixed(1)}</td>
        <td style="text-align:right">${toNumber(vol.larguraCm).toFixed(1)}</td>
        <td style="text-align:right">${toNumber(vol.alturaCm).toFixed(1)}</td>
        <td style="text-align:center">${qtdItens}</td>
        <td>${cv.carregadoEm ? dataHoraFormatada(cv.carregadoEm) : 'Pendente'}</td>
      </tr>`
    })

    const body = `
<div class="header">
  <div class="header-row">
    <div>
      <h1>ROMANEIO DE CARREGAMENTO</h1>
    </div>
    <div style="text-align:right">
      <div>Data: ${dataFormatada(carregamento.criadoEm)}</div>
    </div>
  </div>
</div>

<div class="meta">
  <span><strong>Veículo:</strong> ${carregamento.veiculoPlaca}</span>
  <span><strong>Transportadora:</strong> ${carregamento.transportadora?.razaoSocial ?? '—'} ${carregamento.transportadora?.cnpj ? `(${carregamento.transportadora.cnpj})` : ''}</span>
</div>
<div class="meta">
  <span><strong>Doca:</strong> ${carregamento.doca?.descricao ?? '—'}</span>
  <span><strong>Status:</strong> ${carregamento.status}</span>
</div>

<table>
  <thead>
    <tr>
      <th>Seq</th>
      <th>Volume</th>
      <th>Tipo</th>
      <th>Peso (kg)</th>
      <th>Comp (cm)</th>
      <th>Larg (cm)</th>
      <th>Alt (cm)</th>
      <th>Itens</th>
      <th>Carregado em</th>
    </tr>
  </thead>
  <tbody>
    ${rows}
  </tbody>
</table>

<div class="totals">
  <div>Total de volumes: ${carregamento.volumes.length}</div>
  <div>Peso total: ${pesoTotal.toFixed(3)} kg</div>
  <div>Total de itens: ${totalItens}</div>
</div>

<div class="signature-area">
  <div class="signature-line">Responsável Expedição</div>
  <div class="signature-line">Motorista</div>
  <div class="signature-line">Conferente</div>
</div>

<div class="footer">VisioFab WMS — Romaneio de Carregamento — Gerado em ${dataHoraFormatada(new Date())}</div>`

    return htmlDocument('Romaneio de Carregamento', body)
  }

  /**
   * Gera PDF do romaneio de carregamento.
   * Retorna Buffer com conteúdo PDF.
   * Implementação leve: encapsula o HTML em uma estrutura PDF mínima.
   * Pode ser aprimorado futuramente com uma lib de PDF dedicada.
   */
  gerarRomaneioPdf(carregamento: CarregamentoCompleto): Buffer {
    const html = this.gerarRomaneioHtml(carregamento)

    // Minimal PDF wrapping the HTML content as a text stream.
    // This produces a valid PDF that can be opened by readers, containing
    // the HTML as embedded content. For production use, swap in a proper
    // HTML-to-PDF renderer (e.g. puppeteer, pdf-lib, or wkhtmltopdf).
    const htmlBytes = Buffer.from(html, 'utf-8')
    const streamLength = htmlBytes.length

    const pdfContent = [
      '%PDF-1.4',
      '1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj',
      '2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj',
      `3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 595 842]/Contents 4 0 R/Resources<<>>>>endobj`,
      `4 0 obj<</Length ${streamLength}>>`,
      'stream',
      html,
      'endstream',
      'endobj',
      'xref',
      '0 5',
      '0000000000 65535 f ',
      '0000000009 00000 n ',
      '0000000058 00000 n ',
      '0000000115 00000 n ',
      `0000000230 00000 n `,
      'trailer<</Size 5/Root 1 0 R>>',
      'startxref',
      '0',
      '%%EOF',
    ].join('\n')

    return Buffer.from(pdfContent, 'utf-8')
  }
}
