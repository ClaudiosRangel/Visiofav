/**
 * Templates ZPL padrão pré-configurados para o módulo de etiquetas.
 * Cada template usa placeholders no formato {{campo}} para substituição dinâmica.
 */

export interface TemplatePadrao {
  nome: string
  tipo: 'PRODUTO' | 'ENDERECO' | 'PALETE' | 'EXPEDICAO'
  codigoZpl: string
  larguraMm: number
  alturaMm: number
  camposExemplo: Record<string, string>
}

export const TEMPLATES_PADRAO: TemplatePadrao[] = [
  {
    nome: 'Produto EAN',
    tipo: 'PRODUTO',
    codigoZpl: [
      '^XA',
      '^PW800^LL400',
      '^FO20,20^A0N,35,35^FD{{produtoNome}}^FS',
      '^FO20,65^A0N,22,22^FDCod: {{produtoCodigo}} | Un: {{unidade}}^FS',
      '^FO20,100^A0N,18,18^FDLote: {{lote}} | Val: {{validade}}^FS',
      '^FO20,140^BY2^BEN,80,Y,N^FD{{ean}}^FS',
      '^FO20,250^A0N,18,18^FD{{empresaNome}}^FS',
      '^XZ',
    ].join('\n'),
    larguraMm: 100,
    alturaMm: 50,
    camposExemplo: {
      produtoNome: 'Produto Exemplo',
      produtoCodigo: 'PRD-001',
      unidade: 'UN',
      lote: 'LT-2025-001',
      validade: '31/12/2025',
      ean: '7891234567890',
      empresaNome: 'Empresa Demo',
    },
  },
  {
    nome: 'Endereço',
    tipo: 'ENDERECO',
    codigoZpl: [
      '^XA',
      '^PW800^LL400',
      '^FO20,20^A0N,50,50^FD{{enderecoCompleto}}^FS',
      '^FO20,80^A0N,25,25^FDRua {{rua}} | Predio {{predio}} | Nivel {{nivel}}^FS',
      '^FO20,120^A0N,20,20^FDTipo: {{tipoEndereco}}^FS',
      '^FO20,160^BY2^BCN,80,Y,N,N^FD{{codigoBarras}}^FS',
      '^XZ',
    ].join('\n'),
    larguraMm: 100,
    alturaMm: 50,
    camposExemplo: {
      enderecoCompleto: 'A-01-03-02',
      rua: 'A',
      predio: '01',
      nivel: '03',
      tipoEndereco: 'PICKING',
      codigoBarras: 'A010302',
    },
  },
  {
    nome: 'Palete QR',
    tipo: 'PALETE',
    codigoZpl: [
      '^XA',
      '^PW800^LL600',
      '^FO20,20^A0N,40,40^FDPALETE {{paleteNumero}}^FS',
      '^FO20,70^GB760,2,2^FS',
      '^FO20,85^A0N,25,25^FDOrigem: {{origem}}^FS',
      '^FO20,120^A0N,25,25^FDData: {{data}} | Itens: {{totalItens}}^FS',
      '^FO20,155^A0N,25,25^FDPeso: {{pesoTotal}} kg^FS',
      '^FO200,200^BQN,2,6^FDQA,{{qrConteudo}}^FS',
      '^FO20,450^A0N,18,18^FD{{empresaNome}}^FS',
      '^XZ',
    ].join('\n'),
    larguraMm: 100,
    alturaMm: 75,
    camposExemplo: {
      paleteNumero: 'PLT-00123',
      origem: 'Recebimento NF 12345',
      data: '15/01/2025',
      totalItens: '48',
      pesoTotal: '520.5',
      qrConteudo: 'PLT-00123|2025-01-15|48',
      empresaNome: 'Empresa Demo',
    },
  },
  {
    nome: 'Expedição',
    tipo: 'EXPEDICAO',
    codigoZpl: [
      '^XA',
      '^PW800^LL600',
      '^FO20,20^A0N,35,35^FDEXPEDICAO^FS',
      '^FO20,60^GB760,2,2^FS',
      '^FO20,75^A0N,28,28^FDDest: {{destinatario}}^FS',
      '^FO20,110^A0N,22,22^FD{{enderecoDest}}^FS',
      '^FO20,140^A0N,22,22^FD{{cidadeDest}} - {{ufDest}}^FS',
      '^FO20,175^GB760,2,2^FS',
      '^FO20,190^A0N,22,22^FDPedido: {{pedidoNumero}} | NF: {{nfNumero}}^FS',
      '^FO20,220^A0N,22,22^FDVolumes: {{totalVolumes}} | Peso: {{pesoTotal}} kg^FS',
      '^FO20,260^A0N,22,22^FDTransp: {{transportadora}}^FS',
      '^FO20,300^GB760,2,2^FS',
      '^FO80,320^BY3^BCN,80,Y,N,N^FD{{codigoRastreio}}^FS',
      '^FO20,440^A0N,18,18^FD{{empresaNome}} | {{dataExpedicao}}^FS',
      '^XZ',
    ].join('\n'),
    larguraMm: 100,
    alturaMm: 75,
    camposExemplo: {
      destinatario: 'Cliente Exemplo Ltda',
      enderecoDest: 'Rua das Flores, 123',
      cidadeDest: 'São Paulo',
      ufDest: 'SP',
      pedidoNumero: '1234',
      nfNumero: '000567',
      totalVolumes: '3',
      pesoTotal: '45.2',
      transportadora: 'Transportes Rapido',
      codigoRastreio: 'BR123456789',
      empresaNome: 'Empresa Demo',
      dataExpedicao: '15/01/2025',
    },
  },
]
