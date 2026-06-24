/**
 * Script para gerar um PDF de teste que simula a OP do GPrint/Calcograf.
 * Usa PDFKit para gerar um PDF com texto extraível.
 *
 * Uso: npx tsx tests/gerar-pdf-teste-gprint.ts
 */

import PDFDocument from 'pdfkit'
import fs from 'fs'

const doc = new PDFDocument({ size: 'A4', margin: 30 })
const output = fs.createWriteStream('tests/op-gprint-teste.pdf')
doc.pipe(output)

// Cabeçalho
doc.fontSize(10)
doc.text('CARTON WEGA INDUSTRIA DE EMBALAGENS SA', 30, 30)
doc.text('GPrint - Sistema Calcograf', 30, 42)
doc.text('O.P.: 2.849 R', 400, 30)
doc.text('17/06/2026 14:05   1ª via', 400, 42)

doc.text('Cliente:  ICEFRESH', 30, 70)
doc.text('Cód. Cliente: 903', 400, 70)
doc.text('Fone:  14-3003.1282', 30, 82)
doc.text('Cálculo: 13.960', 400, 82)

doc.text('Contato:  Vendedor: JOAO BORTOLOMAI', 30, 94)
doc.text('Pedido: 2.634', 400, 94)

doc.text('Produto: Cartuchos', 30, 116)
doc.text('RM: Emp6.145', 400, 116)
doc.text('Descrição: CART SUPER FRESH CREME DENTAL 90G MENTA', 30, 128)
doc.text('Cód. Acabado: 4590', 400, 128)

doc.text('Formato Final: 38 x 28x177 mm', 30, 146)
doc.text('Quantidade: 2.200.000 +', 30, 160)
doc.text('220.000', 30, 172)
doc.text('(excedente)', 30, 184)

doc.text('Programação de Entrega: 4590 - 1.200.000 para 06/07/26, 1.000.000 para 02/08/26', 30, 200)

// Materiais
doc.moveDown()
doc.text('─────────────────────────────────────────────────────', 30, 220)
doc.text('Material        Formato   Quant(Kg)  Tr   Quant.  Form.Corta Form.  Aprov', 30, 232)
doc.text('CARTUCHO  Stora Enzo Bobina 222   720 x 1000  14.419,87   N   720 x 1000  1/1     21', 30, 244)

doc.moveDown()
doc.text('Impressão', 30, 270)
doc.text('Offset Plana Heidelberg CD 7cores                     03:30   10:29', 30, 282)

doc.text('Obs.: Serviço Novo', 30, 300)
doc.text('Bobina Stora Enzo 222g - 72,0 cm em estoque (13.793,0 kg)', 30, 316)
doc.text('Bobina Stora Enzo 220g - 70,0 cm encomendado (4.549,16 kg)', 30, 328)

doc.text('LXL: 21 - 68,4 X 99,0 CM', 30, 348)
doc.text('Montagem: Cartucho Super Fresh 90G Menta - (21) - 2.200.000 un', 30, 360)

// Cortadeira
doc.text('Cortadeira', 30, 382)
doc.text('86.200 folhas Stora Enzo 222g 72,0 x 100,0 cm - entrando direto em máquina', 30, 394)
doc.text('29.540 folhas Stora Enzo 220g 70,0 x 100,0 cm - entrando direto em máquina', 30, 406)
doc.text('Total: 115.740 folhas', 30, 420)

doc.text('Seguir contratual', 30, 440)

// Acabamentos
doc.text('Acabamentos', 30, 460)
doc.text('AFT70 (Cortadeira) Lateral Simples  / Colagem Lateral  01:30  40:20', 30, 474)
doc.text('Bobel E (Corte e Vi  / Matriz: 2551B - Faca Nova  02:30  23:03', 30, 486)
doc.text('Cortadeira (Grande)  / Segue obs de impressão  00:15  38:25', 30, 498)
doc.text('Verniz / Heidelberg CD 7cores  / Verniz Primer  00:00  00:00', 30, 510)
doc.text('Verniz UV Total / Heidelberg LaterSet  / Verniz UV - Reserva na Aba de cola  00:00  23:03', 30, 522)

// Materiais
doc.text('Materiais                                      Qtde.', 30, 548)
doc.text('Stora Enzo Bobina 222                     18.419,87 KG', 30, 562)
doc.text('Escala       (CMYK) (60%)                    94,63 KG', 30, 574)
doc.text('Pantone 01   (CW0288 - AMARELO) (40%)        62,75 KG', 30, 586)
doc.text('CD 7 Cores                                       5 PC', 30, 598)
doc.text('Cola Branca (177 mm)                        128,50 KG', 30, 610)
doc.text('FACA NOCA COM DESTACADOR                      1,00 UN', 30, 622)
doc.text('Verniz Primer (F100)                        248,91 KG', 30, 634)
doc.text('Verniz UV (F90)                             224,02 KG', 30, 646)

doc.text('Caixa Padrão com 900 / Embalagens', 30, 670)
doc.text('Obs.: Colagem: Caixa 011 com 900 un', 30, 682)

doc.end()

output.on('finish', () => {
  console.log('PDF gerado: tests/op-gprint-teste.pdf')
})
