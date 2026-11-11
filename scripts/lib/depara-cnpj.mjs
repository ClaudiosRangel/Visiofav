/**
 * Funções PURAS de de-para por CNPJ (tarefa 13.6 / Properties 9, 10, 11).
 *
 * Usadas pelos gravadores de paridade para casar registros do legado com o
 * cadastro do Vizor por CNPJ normalizado (somente dígitos), aplicando a regra
 * de ambiguidade: só casa quando há EXATAMENTE 1 candidato.
 *
 * Testável por vitest sem tocar banco (ver lib/depara-cnpj.test.mjs).
 */

/**
 * Normaliza um CNPJ/CPF deixando SOMENTE dígitos.
 * Property 9: formatações diferentes do mesmo documento casam.
 *   normalizarCnpj('12.345.678/0001-90') === normalizarCnpj('12345678000190')
 *
 * @param {unknown} valor
 * @returns {string} apenas dígitos (string vazia se nulo/sem dígitos)
 */
export function normalizarCnpj(valor) {
  if (valor == null) return ''
  return String(valor).replace(/\D/g, '')
}

/**
 * Resolve o cliente correspondente a partir de uma lista de candidatos.
 *
 * Property 10: 0 ou >= 2 candidatos ⇒ retorna null (NÃO grava — fica vazio).
 * Só retorna o id quando há EXATAMENTE 1 candidato.
 *
 * `candidatos` pode ser:
 *   - uma lista de ids (string) já filtrados pelo CNPJ, OU
 *   - uma lista de objetos { id, cpfCnpj } a filtrar pelo `cnpj` informado.
 * Quando `cnpj` é informado e os candidatos têm `cpfCnpj`, filtra por CNPJ
 * normalizado antes de aplicar a regra de unicidade.
 *
 * @param {string} cnpj CNPJ alvo (será normalizado); pode ser '' se já pré-filtrado
 * @param {Array<string | { id: string, cpfCnpj?: string, cpf_cnpj?: string }>} candidatos
 * @returns {string | null} id quando houver exatamente 1 candidato; senão null
 */
export function casarCliente(cnpj, candidatos) {
  if (!Array.isArray(candidatos) || candidatos.length === 0) return null

  const alvo = normalizarCnpj(cnpj)

  // Extrai os ids elegíveis.
  const ids = []
  for (const c of candidatos) {
    if (typeof c === 'string') {
      // já pré-filtrado pelo chamador; cada string é um id candidato
      ids.push(c)
      continue
    }
    if (c && typeof c === 'object') {
      const doc = normalizarCnpj(c.cpfCnpj ?? c.cpf_cnpj)
      // Se há cnpj alvo e o candidato traz documento, exige casar.
      if (alvo && doc && doc !== alvo) continue
      if (c.id != null) ids.push(String(c.id))
    }
  }

  // Property 10: ambiguidade (0 ou >= 2) ⇒ vazio.
  if (ids.length !== 1) return null
  return ids[0]
}
