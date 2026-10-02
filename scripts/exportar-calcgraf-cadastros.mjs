/**
 * Exporta do Calcgraf (SQL Server local restaurado) os cadastros de APOIO ao
 * orçamento e os clientes/vendedores/fornecedores, para cartoon/export/*.json.
 *
 * Ponte = sqlcmd + FOR JSON PATH (a lib mssql não conecta — SQL Server sem TCP).
 * O sqlcmd quebra o JSON por largura → removemos \r?\n antes de parsear.
 *
 * Uso: node scripts/exportar-calcgraf-cadastros.mjs
 * Pré-req: SQL Server local de pé, banco CalcgrafCartonWega restaurado.
 * Saída em cartoon/export (ignorado pelo git — dados sensíveis).
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'

const DB = 'CalcgrafCartonWega'
const OUT = join('cartoon', 'export')
mkdirSync(OUT, { recursive: true })

function queryJson(sql) {
  const full = `SET NOCOUNT ON; ${sql} FOR JSON PATH`
  // Grava em arquivo com -o e -u (UTF-16LE) para PRESERVAR acentos — capturar
  // o stdout corrompe os acentos (codepage do console). Lemos o UTF-16 e
  // convertemos p/ UTF-8.
  const tmp = join(OUT, `_raw-${Date.now()}.tmp`)
  execFileSync(
    'sqlcmd',
    ['-S', 'localhost', '-E', '-C', '-d', DB, '-y', '0', '-u', '-Q', full, '-o', tmp],
    { maxBuffer: 256 * 1024 * 1024 },
  )
  const buf = readFileSync(tmp)
  rmSync(tmp, { force: true })
  // -u gera UTF-16LE (com BOM). Decodifica para string JS.
  const txt = buf.toString('utf16le').replace(/^\uFEFF/, '').replace(/\r?\n/g, '').trim()
  if (!txt || txt === 'NULL') return []
  return JSON.parse(txt)
}

function exportar(nome, sql) {
  try {
    const rows = queryJson(sql)
    writeFileSync(join(OUT, `${nome}.json`), JSON.stringify(rows), 'utf8')
    console.log(`  ${nome}: ${rows.length} registros`)
  } catch (e) {
    console.error(`  ! ${nome} FALHOU: ${e.message.split('\n')[0]}`)
  }
}

console.log('Exportando cadastros de apoio e clientes/vendedores/fornecedores...')

// Apoio ao orçamento
exportar('Atividades', 'SELECT Codigo, Ativo, Nome, TipoAtividade, PlanoProduto FROM Atividades')
exportar('SuportesFull', 'SELECT Codigo, Ativo, Nome, Descricao, Fabricante, Gramaturas, Formatos, UnidCusto, UnidCalculo, Fibra FROM Suportes')
exportar('FormatosPapelFull', 'SELECT Codigo, Nome, Formato, Ativo FROM FormatosPapel')

// Endereço principal do Nome: Enderecos onde Tabela='Nomes' e Codigo=Nomes.Codigo.
// Pega 1 (default primeiro) via OUTER APPLY. Nomes podem ter >1 endereço.
const END_APPLY = `OUTER APPLY (
  SELECT TOP 1 e.Logradouro, e.Numero, e.Complemento, e.Bairro, e.Cidade, e.UF, e.CEP
  FROM Enderecos e
  WHERE e.Tabela = 'Nomes' AND e.Codigo = n.Codigo AND e.Logradouro IS NOT NULL AND e.Logradouro <> ''
  ORDER BY CASE WHEN e.flagDefault = -1 THEN 0 ELSE 1 END, e.CodChave
) ender`

// Clientes (Nomes + NomesxClientes). codEmpresa de NomesxClientes = Nomes.Codigo.
exportar(
  'Clientes',
  `SELECT n.Codigo, n.NomePrincipal, n.RazaoSocial, n.TipoPessoa, n.CNPJCPF, n.IE, n.IM,
          n.Email, n.Fone, n.Celular, n.Ativo,
          ender.Logradouro, ender.Numero, ender.Complemento, ender.Bairro, ender.Cidade, ender.UF, ender.CEP
   FROM Nomes n INNER JOIN NomesxClientes c ON c.codEmpresa = n.Codigo
   ${END_APPLY}`,
)

// Vendedores (Nomes + NomesxVendedores). Codigo de NomesxVendedores = Nomes.Codigo.
exportar(
  'Vendedores',
  `SELECT n.Codigo, n.NomePrincipal, n.RazaoSocial, n.CNPJCPF, n.Email, n.Fone, n.Celular, n.Ativo
   FROM Nomes n INNER JOIN NomesxVendedores v ON v.Codigo = n.Codigo`,
)

// Fornecedores (Nomes com TipoFornecedor marcado)
exportar(
  'Fornecedores',
  `SELECT n.Codigo, n.NomePrincipal, n.RazaoSocial, n.TipoPessoa, n.CNPJCPF, n.IE,
          n.Email, n.Fone, n.Ativo,
          ender.Logradouro, ender.Numero, ender.Complemento, ender.Bairro, ender.Cidade, ender.UF, ender.CEP
   FROM Nomes n ${END_APPLY}
   WHERE n.TipoFornecedor IS NOT NULL AND n.TipoFornecedor <> ''`,
)

console.log('Exportação concluída. Arquivos em cartoon/export/')
