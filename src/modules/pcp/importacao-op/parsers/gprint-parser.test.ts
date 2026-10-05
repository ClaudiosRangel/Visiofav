import { describe, it, expect } from 'vitest'
import { parseGprintPdf } from './gprint-parser'

/**
 * Monta um texto sintético no mesmo formato reconstruído por
 * `pdf-extractor.service.ts` (linhas com múltiplos espaços entre colunas),
 * reproduzindo o trecho relevante de um PDF de OP GPrint real.
 */
function textoBaseComAcabamentos(secaoAcabamentos: string): string {
  return `
CARTON WEGA INDUSTRIA DE EMBALAGENS SA   O.P.: 2.452 R
GPrint - Sistema Calcgraf   09/01/2026   10:07   1ª via
Cliente:   FRESCATTO   Cód. Cliente:   776
Produto:   Cartuchos
Descrição:   CINTA LOMBO SALMÃO 500G ALFRESCO
Quantidade:   25.000
Impressão   Fixo   Variável
Offset Plana KBA Rapida 75 6cores   02:35   01:05
${secaoAcabamentos}
Materiais   Qtde.
Stora Enzo Bobina 290  337,34  KG
`.trim()
}

describe('parseGprintPdf — seção de Acabamentos', () => {
  it('extrai TODAS as etapas mesmo quando uma linha intermediária contém "obs." minúscula no meio da frase (bug real: OP-2452)', () => {
    // Reprodução literal do trecho problemático: a 3ª etapa ("Cortadeira
    // (Grande)") tem detalhe "Segue obs. de impressão" — a palavra "obs."
    // minúscula, sem dois-pontos, no meio do texto. Antes da correção, o
    // delimitador de fim de seção (`/Obs\./i` sem exigir ":") confundia essa
    // ocorrência com o marcador real de observações do documento e cortava
    // a seção ali, descartando Destacar/Guilhotina/Laminação maior/menor.
    const secao = [
      'Acabamentos   Fixo   Variável',
      'AFT70 (Coladeira) Lateral Simples  / Colagem lateral  01:30  01:33',
      'Bobst S (Corte e Vi Normal Repetição  / Matriz: 1938B  00:30  01:00',
      'Cortadeira (Grande)  / Segue obs. de impressão  00:15  00:30',
      'Destacar  00:00  00:16',
      'Guilhotina maior  / Segue obs. de impressão  00:00  00:41',
      'Laminação maior / Plastificadora maior  / Laminação fosco frente  00:00  03:26',
      'Laminação menor / Plastificadora menor  / Laminação verso brilho  00:00  03:26',
    ].join('\n')

    const texto = textoBaseComAcabamentos(secao)
    const dados = parseGprintPdf(texto)

    // 1 etapa de impressão + 7 etapas de acabamento = 8 no total
    expect(dados.etapas).toHaveLength(8)

    const descricoes = dados.etapas.map((e) => e.descricao)
    expect(descricoes).toContain('AFT70 (Coladeira) Lateral Simples')
    expect(descricoes).toContain('Bobst S (Corte e Vi Normal Repetição')
    expect(descricoes).toContain('Cortadeira (Grande)')
    expect(descricoes).toContain('Destacar')
    expect(descricoes).toContain('Guilhotina maior')
    expect(descricoes).toContain('Laminação maior')
    expect(descricoes).toContain('Laminação menor')
  })

  it('ainda respeita "Obs.:" (com dois-pontos) como delimitador real de fim de seção', () => {
    const secao = [
      'Acabamentos   Fixo   Variável',
      'AFT70 (Coladeira) Lateral Simples  / Colagem lateral  01:30  01:33',
      'Obs.:   Colagem: caixa 022 com 1.500 unidades',
      'Guilhotina maior  00:00  00:41', // não deveria ser capturada — vem depois do delimitador real
    ].join('\n')

    const texto = textoBaseComAcabamentos(secao)
    const dados = parseGprintPdf(texto)

    const descricoes = dados.etapas.map((e) => e.descricao)
    expect(descricoes).toContain('AFT70 (Coladeira) Lateral Simples')
    expect(descricoes).not.toContain('Guilhotina maior')
  })

  it('extrai o tipo de colagem (texto após "/") nas etapas de COLAGEM', () => {
    const secao = [
      'Acabamentos   Fixo   Variável',
      'AFT70 (Coladeira) Lateral Simples  / Colagem Lateral  01:30  03:14',
      'Cortadeira (Grande)  / 12.500 folhas 54,0 x 97,0 cm  00:15  03:56',
    ].join('\n')

    const texto = textoBaseComAcabamentos(secao)
    const dados = parseGprintPdf(texto)

    const colagem = dados.etapas.find((e) => e.tipo === 'COLAGEM')
    expect(colagem).toBeDefined()
    // Texto exato do PDF preservado
    expect(colagem?.tipoColagem).toBe('Colagem Lateral')

    // Etapas que não são de colagem não recebem tipoColagem
    const cortadeira = dados.etapas.find((e) => e.tipo === 'CORTADEIRA')
    expect(cortadeira?.tipoColagem).toBeNull()
  })

  it('extrai "Fundo Automático" como tipo de colagem', () => {
    const secao = [
      'Acabamentos   Fixo   Variável',
      'AFT70 (Coladeira) Fundo Automático  / Fundo Automático  01:00  02:00',
    ].join('\n')

    const texto = textoBaseComAcabamentos(secao)
    const dados = parseGprintPdf(texto)

    const colagem = dados.etapas.find((e) => e.tipo === 'COLAGEM')
    expect(colagem?.tipoColagem).toBe('Fundo Automático')
  })

  it('não perde etapas quando não há nenhuma menção a "obs." nas linhas de acabamento', () => {
    const secao = [
      'Acabamentos   Fixo   Variável',
      'Destacar  00:00  00:16',
      'Guilhotina maior  00:00  00:41',
    ].join('\n')

    const texto = textoBaseComAcabamentos(secao)
    const dados = parseGprintPdf(texto)

    const descricoes = dados.etapas.map((e) => e.descricao)
    expect(descricoes).toContain('Destacar')
    expect(descricoes).toContain('Guilhotina maior')
  })
})

describe('parseGprintPdf — descrição do produto (multi-linha)', () => {
  it('captura descrição de uma única linha (comportamento anterior preservado)', () => {
    const texto = [
      'CARTON WEGA INDUSTRIA DE EMBALAGENS SA   O.P.: 2.965 R',
      'GPrint - Sistema Calcgraf',
      'Cliente:   NATIVITA   Cód. Cliente:   776',
      'Produto:   Cartuchos',
      'Descrição:   CARTUCHO DIGEVITA   Cód. Acabado:   4691',
      'Formato Final:   42 x 36x113 mm',
      'Quantidade:   90.000',
    ].join('\n')

    const dados = parseGprintPdf(texto)
    expect(dados.cabecalho.descricao).toBe('CARTUCHO DIGEVITA')
  })

  it('concatena descrição que quebra em duas linhas (bug real: OP-2963 "SOLUÇÃO ORAL 50ML" na 2ª linha)', () => {
    // A 1ª linha traz descrição + "Cód. Acabado: 4694"; a 2ª linha ("SOLUÇÃO
    // ORAL 50ML") é continuação da descrição; a 3ª ("4688") é um código
    // acabado empilhado (não faz parte da descrição).
    const texto = [
      'CARTON WEGA INDUSTRIA DE EMBALAGENS SA   O.P.: 2.963 R',
      'GPrint - Sistema Calcgraf',
      'Cliente:   NATIVITA   Cód. Cliente:   776',
      'Produto:   Cartuchos',
      'Descrição:   CARTUCHOS BROMOPRIDA / CLORIDRATO DE AMBROXOL 7,5ML  Cód. Acabado:   4694',
      'SOLUÇÃO ORAL 50ML',
      '4688',
      'Formato Final:   42 x 36x113 mm',
      'Quantidade:   200.000',
    ].join('\n')

    const dados = parseGprintPdf(texto)
    expect(dados.cabecalho.descricao).toBe(
      'CARTUCHOS BROMOPRIDA / CLORIDRATO DE AMBROXOL 7,5ML SOLUÇÃO ORAL 50ML',
    )
  })

  it('concatena descrição de três linhas com múltiplos códigos acabados (imagem do cliente: NATIVITA Cartuchos)', () => {
    const texto = [
      'CARTON WEGA INDUSTRIA DE EMBALAGENS SA   O.P.: 3.079 R',
      'GPrint - Sistema Calcgraf',
      'Cliente:   NATIVITA',
      'Produto:   Cartuchos',
      'Descrição:   CARTUCHOS CLORIDRATO DE AMBROXOL INFANTIL /  Cód. Acabado:   1031707',
      'CARBOCISTEINA ADULTO / CARBOCISTEINA INFANTIL',
      '4471',
      '4472',
      'Formato Final:   42 x 36x113 mm',
      'Quantidade:   200.000',
    ].join('\n')

    const dados = parseGprintPdf(texto)
    expect(dados.cabecalho.descricao).toBe(
      'CARTUCHOS CLORIDRATO DE AMBROXOL INFANTIL / CARBOCISTEINA ADULTO / CARBOCISTEINA INFANTIL',
    )
    // os 3 códigos acabados continuam sendo capturados
    expect(dados.cabecalho.codigosAcabados).toEqual(['1031707', '4471', '4472'])
  })

  it('para a descrição ao encontrar um novo rótulo de seção (não engole Formato/Quantidade)', () => {
    const texto = [
      'CARTON WEGA INDUSTRIA DE EMBALAGENS SA   O.P.: 2.997 R',
      'GPrint - Sistema Calcgraf',
      'Cliente:   COMPACTOR',
      'Produto:   Cartuchos',
      'Descrição:   CAIXA KIT ESF. C1 VASCO   Cód. Acabado:   4735',
      'Formato Final:   76 x 76x146 mm',
      'Quantidade:   16.000',
    ].join('\n')

    const dados = parseGprintPdf(texto)
    expect(dados.cabecalho.descricao).toBe('CAIXA KIT ESF. C1 VASCO')
  })
})

describe('parseGprintPdf — planos multi-componente (Fase B)', () => {
  // Texto sintético reproduzindo a tabela de processo de uma OS multi-plano
  // (OP 3.133 real: "Caixa de Sorvete 7 Litros" com TAMPA, CAIXA, BOLSA).
  function textoMultiPlano(): string {
    return [
      'CARTON WEGA INDUSTRIA DE EMBALAGENS SA   O.P.: 3.133 R',
      'GPrint - Sistema Calcgraf   28/09/2026   15:37   1ª via',
      'Cliente:   SOL & NEVE   Cód. Cliente:   13',
      'Produto:   Cartucho Composto',
      'Descrição:   Caixa de Sorvete 7 Litros',
      'Quantidade:   5.000',
      'Plano   Formato   Mont.   Tiragem   Cores   Máq.Impr.   Chapa   Acabamento',
      'TAMPA   780 x 480   2x2   1.375   4x0 +V   Heidelberg CD 5cores   4   Cortadeira (Grande), Guilhotina maior, Verniz, SG (Laminadora), Dayuan (Corte e Vinc), Destacar',
      'CAIXA   831 x 585   1x2   2.750   4x0   Heidelberg CD 5cores   4   Cortadeira (Grande), SG (Laminadora), Dayuan (Corte e Vinc), Destacar, Fechadora de Caixa',
      'BOLSA   648 x 830   2x1   2.750   0x0   Cortadeira (Grande), Plastificadora maior, Dayuan (Corte e Vinc), Destacar, Seladora Bolsa',
      'Materiais   Qtde.',
      'NZ Fibra Longa 200   103,88   KG',
    ].join('\n')
  }

  it('extrai os 3 planos (TAMPA, CAIXA, BOLSA) com formato/cores/tiragem', () => {
    const dados = parseGprintPdf(textoMultiPlano())
    expect(dados.planos).toHaveLength(3)
    const nomes = dados.planos.map((p) => p.nome)
    expect(nomes).toEqual(['TAMPA', 'CAIXA', 'BOLSA'])

    const tampa = dados.planos[0]
    expect(tampa.formato).toBe('780 x 480')
    expect(tampa.montagem).toBe('2x2')
    expect(tampa.tiragem).toBe(1375)
    expect(tampa.cores).toContain('4x0')
  })

  it('associa as etapas de acabamento ao plano correto', () => {
    const dados = parseGprintPdf(textoMultiPlano())
    const tampa = dados.planos.find((p) => p.nome === 'TAMPA')!
    const caixa = dados.planos.find((p) => p.nome === 'CAIXA')!
    const bolsa = dados.planos.find((p) => p.nome === 'BOLSA')!

    const descr = (p: any) => p.etapas.map((e: any) => e.descricao)
    expect(descr(tampa)).toContain('Cortadeira (Grande)')
    expect(descr(tampa)).toContain('Guilhotina maior')
    expect(descr(caixa)).toContain('Fechadora de Caixa')
    expect(descr(bolsa)).toContain('Seladora Bolsa')
    // BOLSA não tem Guilhotina nem Fechadora de Caixa
    expect(descr(bolsa)).not.toContain('Fechadora de Caixa')
  })

  it('não é frente/costa quando cores são Nx0', () => {
    const dados = parseGprintPdf(textoMultiPlano())
    expect(dados.planos.every((p) => p.frenteCosta === false)).toBe(true)
  })

  it('extrai planosNomes do sufixo (X,Y,Z) das etapas (modelo Opção 1 — OP 3.133 real)', () => {
    // Reproduz a seção de acabamentos AGREGADA real: cada operação lista os
    // planos que atende entre parênteses. A etapa é ÚNICA (não desmembra).
    const texto = [
      'CARTON WEGA INDUSTRIA DE EMBALAGENS SA   O.P.: 3.133 R',
      'GPrint - Sistema Calcgraf',
      'Cliente:   SOL & NEVE',
      'Produto:   Cartucho Composto',
      'Descrição:   Caixa de Sorvete 7 Litros',
      'Quantidade:   5.000',
      'Plano   Formato   Mont.   Tiragem   Cores   Máq.Impr.   Chapa   Acabamento',
      'TAMPA   780 x 480   2x2   1.375   4x0 +V   Heidelberg CD 5cores   4   Cortadeira (Grande), Guilhotina maior, Verniz',
      'CAIXA   831 x 585   1x2   2.750   4x0   Heidelberg CD 5cores   4   Cortadeira (Grande), SG (Laminadora), Fechadora de Caixa',
      'BOLSA   648 x 830   2x1   2.750   0x0   Cortadeira (Grande), Seladora Bolsa',
      'Acabamentos   Fixo   Variável',
      'Cortadeira (Grande) (BOLSA,CAIXA,TAMPA)  00:15  05:23',
      'Guilhotina maior (TAMPA)  00:00  00:41',
      'Seladora Bolsa (BOLSA)  00:00  01:00',
      'SG (Laminadora) (CAIXA,TAMPA)  00:00  02:00',
      'Materiais   Qtde.',
      'NZ Fibra Longa 200   103,88   KG',
    ].join('\n')

    const dados = parseGprintPdf(texto)
    const cort = dados.etapas.find((e) => /Cortadeira/.test(e.descricao))!
    const guilh = dados.etapas.find((e) => /Guilhotina/.test(e.descricao))!
    const selad = dados.etapas.find((e) => /Seladora/.test(e.descricao))!

    expect(cort.planosNomes).toEqual(['BOLSA', 'CAIXA', 'TAMPA'])
    expect(guilh.planosNomes).toEqual(['TAMPA'])
    expect(selad.planosNomes).toEqual(['BOLSA'])
    // Nº de etapas = nº de operações (NÃO desmembra por plano)
    expect(dados.etapas.filter((e) => /Cortadeira/.test(e.descricao))).toHaveLength(1)
  })
})

describe('parseGprintPdf — plano único (NÃO-REGRESSÃO)', () => {
  it('OS de plano único retorna planos[] vazio (usa fluxo de etapas achatado)', () => {
    const texto = [
      'CARTON WEGA INDUSTRIA DE EMBALAGENS SA   O.P.: 2.997 R',
      'GPrint - Sistema Calcgraf',
      'Cliente:   COMPACTOR',
      'Produto:   Cartuchos',
      'Descrição:   CAIXA KIT ESF. C1 VASCO',
      'Quantidade:   16.000',
      'Impressão   Fixo   Variável',
      'Offset Plana Heidelberg CD 6cores   03:30   10:29',
      'Acabamentos   Fixo   Variável',
      'Cortadeira (Grande)  00:15  05:23',
      'Destacar  00:00  00:16',
      'Materiais   Qtde.',
      'Stora Enzo Bobina 290  337,34  KG',
    ].join('\n')
    const dados = parseGprintPdf(texto)
    expect(dados.planos).toHaveLength(0)
    // etapas achatadas continuam existindo (não-regressão)
    expect(dados.etapas.length).toBeGreaterThan(0)
  })
})

describe('parseGprintPdf — frente/costa (Fase C)', () => {
  it('detecta retiração quando Cores é NxM com N>0 e M>0 (7x5)', () => {
    // Precisa de 2+ planos para extrairPlanos retornar algo; o 2º é só para
    // satisfazer o mínimo. O 1º plano (CARTUCHO) é 7x5 → frente/costa.
    const texto = [
      'CARTON WEGA INDUSTRIA DE EMBALAGENS SA   O.P.: 9.001 R',
      'GPrint - Sistema Calcgraf',
      'Cliente:   TESTE   Cód. Cliente:   1',
      'Produto:   Cartucho',
      'Descrição:   CARTUCHO DIA',
      'Quantidade:   8.250',
      'Plano   Formato   Mont.   Tiragem   Cores   Máq.Impr.   Chapa   Acabamento',
      'FRENTE   475 x 660   1x4   8.250 x 2   7x5   Heidelberg CD 7cores   4   Cortadeira (Grande), Verniz, Destacar',
      'VERSO   475 x 660   1x4   8.250   0x0   Cortadeira (Grande)',
    ].join('\n')
    const dados = parseGprintPdf(texto)
    const fc = dados.planos.find((p) => p.frenteCosta)
    expect(fc).toBeDefined()
    expect(fc!.coresFrente).toBe('7x0')
    expect(fc!.coresCosta).toBe('5x0')
    // tiragem base = 8250 (o "x 2" indica 2 passagens, não dobra a quantidade)
    expect(fc!.tiragem).toBe(8250)
  })
})
