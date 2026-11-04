/**
 * Erro de domínio da Central de Consulta do Produto/Acabado.
 * O `statusCode` é mapeado para HTTP pela camada de rotas.
 */
export class CentralProdutoError extends Error {
  constructor(
    message: string,
    public statusCode = 400,
  ) {
    super(message)
    this.name = 'CentralProdutoError'
  }
}
