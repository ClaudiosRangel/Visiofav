/**
 * FERRAMENTA DE REGRESSÃO — Parser de PDF de OP (GPrint/Calcograf)
 * =================================================================
 * SOMENTE LEITURA — não grava nada no banco nem altera arquivos.
 *
 * Roda `parseGprintPdf` (src/modules/pcp/importacao-op/parsers/gprint-parser.ts)
 * contra TODOS os PDFs de OP encontrados na raiz do projeto (qualquer
 * arquivo .pdf cujo nome contenha "OP" seguido de dígitos, ex.: "OP 2849.pdf",
 * "OP-2452.pdf"), e imprime quantas etapas/máquinas cada um extraiu.
 *
 * QUANDO USAR:
 * Sempre que alterar qualquer regex/lógica dentro de gprint-parser.ts
 * (extrairEtapas, extrairMateriais, extrairCabecalho, etc.), rode este
 * script ANTES e DEPOIS da mudança e compare a saída. Se o número de
 * etapas ou a lista de máquinas de algum PDF mudar sem você esperar isso,
 * é sinal de regressão — o parser trabalha com regex sobre texto
 * reconstruído de PDF, e uma correção para um caso pode silenciosamente
 * quebrar outro (foi exatamente assim que o bug do delimitador "Obs."
 * vs "Obs.:" foi descoberto e corrigido — ver ATENCAO-pontos-verificar.md).
 *
 * COMO COMPARAR ANTES/DEPOIS (não há snapshot automático — comparação manual):
 *   git stash push -- src/modules/pcp/importacao-op/parsers/gprint-parser.ts
 *   npx tsx scripts/testar-todos-pdfs-op.ts > antes.txt
 *   git stash pop
 *   npx tsx scripts/testar-todos-pdfs-op.ts > depois.txt
 *   # comparar antes.txt vs depois.txt (diff manual, ou Compare-Object no PowerShell)
 *   Remove-Item antes.txt, depois.txt   # não commitar esses arquivos
 *
 * Uso simples (só ver o estado atual):
 *   npx tsx scripts/testar-todos-pdfs-op.ts
 *
 * LIMITAÇÃO: só testa os PDFs que estiverem fisicamente na raiz do projeto
 * no momento da execução (não versionados no git — cada pessoa acumula os
 * seus ao longo do tempo, testando importações reais). Se você tiver um PDF
 * de OP com um caso de borda interessante para o parser, considere deixá-lo
 * na raiz do projeto (fora do commit) para os próximos a rodarem contra ele.
 */

import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { extrairTextoPdf } from '../src/modules/pcp/importacao-op/pdf-extractor.service'
import { isGprintPdf, parseGprintPdf } from '../src/modules/pcp/importacao-op/parsers/gprint-parser'

const raiz = join(__dirname, '..')

async function main() {
  const arquivos = readdirSync(raiz).filter((f) => f.toLowerCase().endsWith('.pdf') && /op[\s-]?\d/i.test(f))

  if (arquivos.length === 0) {
    console.log('Nenhum PDF de OP encontrado na raiz do projeto (esperado nome contendo "OP" + dígitos, ex.: "OP 2849.pdf").')
    return
  }

  console.log(`Encontrados ${arquivos.length} PDFs de OP: ${arquivos.join(', ')}`)
  console.log('─'.repeat(80))

  let totalOk = 0
  let totalComAviso = 0
  let totalErro = 0

  for (const arquivo of arquivos) {
    const caminho = join(raiz, arquivo)
    try {
      const buffer = readFileSync(caminho)
      const { texto } = await extrairTextoPdf(buffer)

      if (!isGprintPdf(texto)) {
        console.log(`\n${arquivo}: ❌ NÃO reconhecido como GPrint/Calcograf`)
        totalErro++
        continue
      }

      const dados = parseGprintPdf(texto)
      const maquinas = dados.etapas.map((e) => e.maquina || e.descricao).join(', ')

      console.log(`\n${arquivo}`)
      console.log(`  OP: ${dados.cabecalho.numeroOp} | Cliente: ${dados.cabecalho.cliente} | Confiança: ${dados.confianca}%`)
      console.log(`  Etapas extraídas: ${dados.etapas.length} — [${maquinas}]`)
      if (dados.avisos.length > 0) {
        console.log(`  Avisos: ${dados.avisos.join(' | ')}`)
        totalComAviso++
      } else {
        totalOk++
      }
    } catch (err: any) {
      console.log(`\n${arquivo}: ❌ ERRO ao processar — ${err.message}`)
      totalErro++
    }
  }

  console.log('\n' + '─'.repeat(80))
  console.log(`Resumo: ${totalOk} sem avisos | ${totalComAviso} com avisos | ${totalErro} com erro (de ${arquivos.length} PDFs)`)
}

main().catch((err) => {
  console.error('Erro geral:', err)
  process.exit(1)
})
