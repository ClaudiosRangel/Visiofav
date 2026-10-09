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

  it('DESMEMBRA cada operação em uma etapa POR PLANO (modelo Opção 2 — OP 3.133 real)', () => {
    // Seção de acabamentos agregada: cada operação lista os planos que atende.
    // Modelo Opção 2: desmembra em UMA ETAPA POR PLANO (controle individual
    // de iniciar/concluir por plano).
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

    // Cortadeira (BOLSA,CAIXA,TAMPA) → 3 etapas (uma por plano)
    const corts = dados.etapas.filter((e) => /Cortadeira/.test(e.descricao))
    expect(corts).toHaveLength(3)
    expect(corts.map((e) => e.planoNome).sort()).toEqual(['BOLSA', 'CAIXA', 'TAMPA'])
    // Nome base preservado + sufixo do plano
    expect(corts.find((e) => e.planoNome === 'BOLSA')!.descricao).toBe('Cortadeira (Grande) — BOLSA')

    // SG (CAIXA,TAMPA) → 2 etapas
    const sgs = dados.etapas.filter((e) => /SG/.test(e.descricao))
    expect(sgs).toHaveLength(2)
    expect(sgs.map((e) => e.planoNome).sort()).toEqual(['CAIXA', 'TAMPA'])

    // Guilhotina (só TAMPA) → 1 etapa; Seladora (só BOLSA) → 1 etapa
    expect(dados.etapas.filter((e) => /Guilhotina/.test(e.descricao))).toHaveLength(1)
    expect(dados.etapas.find((e) => /Guilhotina/.test(e.descricao))!.planoNome).toBe('TAMPA')
    expect(dados.etapas.find((e) => /Seladora/.test(e.descricao))!.planoNome).toBe('BOLSA')
  })

  it('reconhece o plano quando o sufixo "(PLANO)" está no DETALHE após a "/" (OP-3133 real: Verniz e Fechadora de Caixa)', () => {
    // Caso real da OP-3133: algumas operações trazem o sufixo de plano NÃO no
    // nome, mas no texto após a "/" (o detalhe). Ex.:
    //   "Verniz / Heidelberg CD 5cores (TAMPA)"           → plano TAMPA
    //   "Fechadora de Caixa / Diana (Coladeira) (CAIXA)"  → plano CAIXA
    // Só vale quando o grupo "(PLANO)" é o FINAL do detalhe (evita capturar um
    // "(BOLSA,CAIXA,TAMPA)" que apareça no meio de um detalhe longo — como a
    // linha de continuação do Dayuan "...Acoplado Repetição (BOLSA,CAIXA,
    // TAMPA)  2477B - Tampa / 2478B - Bolsa", que NÃO é o plano da operação).
    const texto = [
      'CARTON WEGA INDUSTRIA DE EMBALAGENS SA   O.P.: 3.133 R',
      'GPrint - Sistema Calcgraf',
      'Cliente:   SOL & NEVE',
      'Produto:   Cartucho Composto',
      'Descrição:   Caixa de Sorvete 7 Litros',
      'Quantidade:   5.000',
      'Plano   Formato   Mont.   Tiragem   Cores   Máq.Impr.   Chapa   Acabamento',
      'TAMPA   780 x 480   2x2   1.375   4x0 +V   Heidelberg CD 5cores   4   Verniz',
      'CAIXA   831 x 585   1x2   2.750   4x0   Heidelberg CD 5cores   4   Fechadora de Caixa',
      'BOLSA   648 x 830   2x1   2.750   0x0   Seladora Bolsa',
      'Acabamentos   Fixo   Variável',
      'Verniz / Heidelberg CD 5cores (TAMPA)  00:00  00:00',
      'Fechadora de Caixa / Diana (Coladeira) (CAIXA)  01:30  01:00',
      'Dayuan (Corte e Vinc / Matriz: 2570B / Acoplado Repetição (BOLSA,CAIXA,TAMPA)  2477B - Tampa / 2478B - Bolsa  04:30  01:55',
      'Materiais   Qtde.',
      'NZ Fibra Longa 200   103,88   KG',
    ].join('\n')

    const dados = parseGprintPdf(texto)

    const verniz = dados.etapas.find((e) => /Verniz/.test(e.descricao))
    expect(verniz?.planoNome).toBe('TAMPA')

    const fechadora = dados.etapas.find((e) => /Fechadora de Caixa/.test(e.descricao))
    expect(fechadora?.planoNome).toBe('CAIXA')
  })

  it('reconhece o plano quando o sufixo "(PLANO,...)" está no fim de UM SEGMENTO do detalhe (OP-3154 real: Verniz)', () => {
    // Caso real OP-3154: "Verniz / Heidelberg CD 5cores (CAIXA,TAMPA) / Verniz
    // Primer" — o grupo de planos NÃO está no fim absoluto do detalhe (termina
    // em "Verniz Primer"), mas está no fim do 1º segmento separado por "/".
    // A captura por segmento resolve isso. Antes, a OP-3154 deixava Verniz e
    // Verniz UV Total SEM plano (bug relatado pelo cliente — "Sorsz" não
    // quebrou e falhou).
    const texto = [
      'CARTON WEGA INDUSTRIA DE EMBALAGENS SA   O.P.: 3.154 R',
      'GPrint - Sistema Calcgraf',
      'Cliente:   TESTE',
      'Produto:   Cartucho Composto',
      'Descrição:   Caixa com Tampa',
      'Quantidade:   22.000',
      'Plano   Formato   Mont.   Tiragem   Cores   Máq.Impr.   Chapa   Acabamento',
      'TAMPA   820 x 530   2x2   11.000   4x0   Heidelberg CD 5cores   4   Verniz, Verniz UV Total',
      'CAIXA   715 x 875   2x1   22.000   4x0   Heidelberg CD 5cores   4   Verniz, Verniz UV Total',
      'Acabamentos   Fixo   Variável',
      'Verniz / Heidelberg CD 5cores (CAIXA,TAMPA)  / Verniz Primer  00:00  00:00',
      'Verniz UV Total / Heidelberg LeterSet (CAIXA,TAMPA)  / Verniz UV - Caixa e tampa  00:00  06:36',
      'Materiais   Qtde.',
      'NZ Fibra Longa 200   103,88   KG',
    ].join('\n')
    const dados = parseGprintPdf(texto)

    const verniz = dados.etapas.filter((e) => e.descricao.startsWith('Verniz —') || /^Verniz —/.test(e.descricao))
    expect(verniz.map((e) => e.planoNome).sort()).toEqual(['CAIXA', 'TAMPA'])
    const vernizUV = dados.etapas.filter((e) => /Verniz UV Total/.test(e.descricao))
    expect(vernizUV.map((e) => e.planoNome).sort()).toEqual(['CAIXA', 'TAMPA'])
  })

  it('costura o grupo de planos "(M)" quebrado em 2 linhas (OP-3154 real: Bimac/Acoplagem)', () => {
    // Caso real OP-3154: a operação de Acoplagem (Bimac) traz o grupo de planos
    // de MICRO "(CAIXA (M),TAMPA (M))" aberto no fim do nome e FECHADO numa 2ª
    // linha curta, com os tempos no meio:
    //   "Bimac (Acoplagem) Cartão+Micro Fornecido (CAIXA  / Segue obs  00:30  05:30"
    //   "(M),TAMPA (M))"
    // O parser deve costurar a cauda "(M),TAMPA (M))" dentro do NOME (antes do
    // " / "), reconstruir o grupo "(CAIXA (M),TAMPA (M))" e desmembrar em
    // CAIXA e TAMPA. Antes ficava SEM plano (bug relatado pelo cliente).
    const texto = [
      'CARTON WEGA INDUSTRIA DE EMBALAGENS SA   O.P.: 3.154 R',
      'GPrint - Sistema Calcgraf',
      'Cliente:   TESTE',
      'Produto:   Cartucho Composto',
      'Descrição:   Caixa com Tampa e Bolsa',
      'Quantidade:   22.000',
      'Plano   Formato   Mont.   Tiragem   Cores   Máq.Impr.   Chapa   Acabamento',
      'TAMPA   820 x 530   2x2   11.000   4x0   Heidelberg CD 5cores   4   Bimac (Acoplagem)',
      'CAIXA   715 x 875   2x1   22.000   4x0   Heidelberg CD 5cores   4   Bimac (Acoplagem)',
      'BOLSA   860 x 720   2x1   22.000   0x0   Seladora Bolsa',
      'Acabamentos   Fixo   Variável',
      'Seladora Bolsa (BOLSA)  00:00  27:30',
      'Bimac (Acoplagem) Cartão+Micro Fornecido (CAIXA  / Segue obs de impressão  00:30  05:30',
      '(M),TAMPA (M))',
      'Destacar (CAIXA,TAMPA)  00:00  03:18',
      'Materiais   Qtde.',
      'NZ Fibra Longa 200   103,88   KG',
    ].join('\n')
    const dados = parseGprintPdf(texto)

    const bimac = dados.etapas.filter((e) => /Bimac/.test(e.descricao))
    expect(bimac).toHaveLength(2)
    expect(bimac.map((e) => e.planoNome).sort()).toEqual(['CAIXA', 'TAMPA'])
    // Nome base limpo (sem o "(CAIXA" truncado nem o grupo de planos).
    expect(bimac[0].descricao).toMatch(/^Bimac \(Acoplagem\) Cartão\+Micro Fornecido — (CAIXA|TAMPA)$/)
  })
})

describe('parseGprintPdf — plano único (NÃO-REGRESSÃO)', () => {
  it('OS com 1 plano real + "(M)" de acoplagem retorna planos[] vazio (OP-3145: Cartão + Cartão (M), sem retiração) — SEM pai/filho', () => {
    // Bug real OP-3145: "Cartão" (plano real, 2x0 — não é retiração) + "Cartão
    // (M)" (Micro de acoplagem) eram contados como 2 planos → painel mostrava
    // pai/filho numa OS de plano ÚNICO. O "(M)" deve ser agregado ao pai, não
    // contar como plano. Resultado esperado: planos[] vazio → fluxo legado.
    const texto = [
      'CARTON WEGA INDUSTRIA DE EMBALAGENS SA   O.P.: 3.145 R',
      'GPrint - Sistema Calcgraf',
      'Cliente:   ESAB',
      'Produto:   Cartucho Composto',
      'Descrição:   CAIXA DE PAPELAO P/5KG',
      'Quantidade:   5.600',
      'Plano   Material   Formato   Quant(Kg)   TR   Form. Corte   Form   Aprov',
      'Cartão   NZ Fibra Longa 203   950 x 670   198,98   N   915 x 670   1/1   4',
      'Cartão (M)   Micro Pardo Formato 245   660 x 905   225,36   N   660 x 905   1/1   4',
      'Plano   Formato   Mont.   Tiragem   Cores   Máq.Impr.   Chapa   Acabamento',
      'Cartão   915 x 670   1x4   1.540   2x0 +V   Heidelberg CD 5cores   2   Cortadeira (Grande), Guilhotina maior, Verniz, Destacar, AFT70 (Coladeira)',
      'Cartão (M)   660 x 905   1x4   1.540   0x0   Bimac (Acoplagem)',
      'Impressão   Fixo   Variável',
      'Offset Plana Heidelberg CD 5cores   00:50   01:00',
      'Materiais   Qtde.',
      'NZ Fibra Longa 203   198,98   KG',
    ].join('\n')
    const dados = parseGprintPdf(texto)
    expect(dados.planos).toHaveLength(0)
    expect(dados.etapas.length).toBeGreaterThan(0)
    // Nenhuma etapa deve ter plano (sem pai/filho no painel).
    expect(dados.etapas.every((e) => !e.planoNome)).toBe(true)
  })

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

  it('MÚLTIPLOS planos frente/costa (OP-3143 real: CARTUCHO e BERÇO, ambos 5x5) — cada plano com roteiro + impressão FRENTE/COSTA', () => {
    // Caso real OP-3143: 2 planos, AMBOS retiração (5x5). As operações da
    // tabela de processo NÃO têm sufixo "(PLANO)" — cada plano tem seu roteiro
    // na própria linha da tabela. Esperado: cada plano gera suas etapas, com a
    // impressão desmembrada em FRENTE/COSTA. Antes, só o 1º plano era lido.
    const texto = [
      'CARTON WEGA INDUSTRIA DE EMBALAGENS SA   O.P.: 3.143 R',
      'GPrint - Sistema Calcgraf',
      'Cliente:   DESINCHA',
      'Produto:   Cartuchos',
      'Descrição:   CARTUCHO CHA MISTO',
      'Quantidade:   33.000',
      'Plano   Formato   Mont.   Tiragem   Cores   Máq.Impr.   Chapa   Acabamento',
      'CARTUCHO   585 x 640   1x2   16.500 x 2   5x5 +V   Heidelberg CD   10   Cortadeira (Grande), Guilhotina maior, Verniz, HotStamping, Destacar, AFT70 (Coladeira)',
      'BERÇO   710 x 525   3x3   3.667 x 2   5x5 +V   Heidelberg CD   10   Cortadeira (Grande), Guilhotina maior, Verniz, HotStamping, Destacar, AFT70 (Coladeira)',
      'Impressão   Fixo   Variável',
      'Offset Plana Heidelberg CD 7cores   08:30   06:24',
      'Materiais   Qtde.',
      'NZ Super White 281   1.790,15   KG',
    ].join('\n')
    const dados = parseGprintPdf(texto)

    expect(dados.planos.map((p) => p.nome)).toEqual(['CARTUCHO', 'BERÇO'])
    expect(dados.planos.every((p) => p.frenteCosta)).toBe(true)

    // Impressão: 2 por plano (FRENTE/COSTA) = 4 no total.
    const impressoes = dados.etapas.filter((e) => e.tipo === 'IMPRESSAO')
    expect(impressoes).toHaveLength(4)
    expect(impressoes.map((e) => e.planoNome).sort()).toEqual(['BERÇO COSTA', 'BERÇO FRENTE', 'CARTUCHO COSTA', 'CARTUCHO FRENTE'])

    // Cada plano tem suas etapas de acabamento (uma por operação, sem face).
    const doCartucho = dados.etapas.filter((e) => e.planoNome === 'CARTUCHO')
    const doBerco = dados.etapas.filter((e) => e.planoNome === 'BERÇO')
    expect(doCartucho.length).toBeGreaterThanOrEqual(5)
    expect(doBerco.length).toBeGreaterThanOrEqual(5)
    // Nenhuma etapa de acabamento do BERÇO deve "engolir" as outras (split OK).
    expect(doBerco.some((e) => /Destacar/.test(e.descricao))).toBe(true)
    expect(doBerco.some((e) => /AFT70/.test(e.descricao))).toBe(true)
  })

  it('detecta frente/costa de PLANO ÚNICO (OP-3092 real: cores 5x1, tiragem 16.500 x 2)', () => {
    // Antes havia a trava `grupos.length < 2` que impedia detectar retiração em
    // OS de UM único plano — a OP-3092 (CARTUCHO, 5x1) caía no fluxo legado
    // achatado. Agora 1 plano COM cores NxM (N>0, M>0) ativa frente/costa.
    const texto = [
      'CARTON WEGA INDUSTRIA DE EMBALAGENS SA   O.P.: 3.092 R',
      'GPrint - Sistema Calcgraf',
      'Cliente:   PROBELLE   Cód. Cliente:   78',
      'Produto:   Cartuchos',
      'Descrição:   CARTUCHOS BURGUESINHAS',
      'Quantidade:   99.000',
      'Plano   Formato   Mont.   Tiragem   Cores   Máq.Impr.   Chapa   Acabamento',
      'CARTUCHO   540 x 740   3x2   16.500 x 2   5x1 +V+V   KBA Rapida 75 6cores   6   Cortadeira (Grande), Guilhotina maior, Verniz, Destacar',
      'Materiais   Qtde.',
      'Nz Bobina 238   1.685,47   KG',
    ].join('\n')
    const dados = parseGprintPdf(texto)
    expect(dados.planos).toHaveLength(1)
    const p = dados.planos[0]
    expect(p.frenteCosta).toBe(true)
    expect(p.coresFrente).toBe('5x0')
    expect(p.coresCosta).toBe('1x0')
    expect(p.tiragem).toBe(16500)
  })

  it('desmembra FACE só na IMPRESSÃO; demais centros = etapa única (OP-3092)', () => {
    // Regra confirmada: a retiração é fenômeno da impressora. Só a impressão
    // vira 2 etapas (FRENTE/COSTA); os acabamentos ficam 1 etapa cada,
    // vinculados à FRENTE.
    const texto = [
      'CARTON WEGA INDUSTRIA DE EMBALAGENS SA   O.P.: 3.092 R',
      'GPrint - Sistema Calcgraf',
      'Cliente:   PROBELLE',
      'Produto:   Cartuchos',
      'Descrição:   CARTUCHOS BURGUESINHAS',
      'Quantidade:   99.000',
      'Plano   Formato   Mont.   Tiragem   Cores   Máq.Impr.   Chapa   Acabamento',
      'CARTUCHO   540 x 740   3x2   16.500 x 2   5x1 +V+V   KBA Rapida 75 6cores   6   Cortadeira (Grande), Guilhotina maior, Verniz, Destacar',
      'Impressão   Fixo   Variável',
      'Offset Plana KBA Rapida 75 6cores   02:35   03:40',
      'Acabamentos   Fixo   Variável',
      'Cortadeira (Grande)  / 17.000 folhas 58,0 x 74,0 cm  00:15  04:04',
      'Destacar  00:00  01:39',
      'Guilhotina maior  / Refilar 17.000 folhas  00:00  04:08',
      'Verniz  / Verniz Primer  00:00  00:00',
      'Materiais   Qtde.',
      'Nz Bobina 238   1.685,47   KG',
    ].join('\n')
    const dados = parseGprintPdf(texto)

    // Impressão desmembrada em 2 (FRENTE/COSTA)
    const impressao = dados.etapas.filter((e) => e.tipo === 'IMPRESSAO')
    expect(impressao).toHaveLength(2)
    expect(impressao.map((e) => e.planoNome).sort()).toEqual(['COSTA', 'FRENTE'])

    // Acabamentos: UMA etapa cada, vinculada à FRENTE (sem desmembrar por face)
    const cortadeira = dados.etapas.filter((e) => /Cortadeira/.test(e.descricao))
    expect(cortadeira).toHaveLength(1)
    expect(cortadeira[0].planoNome).toBe('FRENTE')
    const verniz = dados.etapas.filter((e) => e.tipo === 'VERNIZ')
    expect(verniz).toHaveLength(1)
    expect(verniz[0].planoNome).toBe('FRENTE')
    // Nenhuma etapa de acabamento com planoNome COSTA
    expect(dados.etapas.filter((e) => e.tipo !== 'IMPRESSAO' && e.planoNome === 'COSTA')).toHaveLength(0)
  })
})
