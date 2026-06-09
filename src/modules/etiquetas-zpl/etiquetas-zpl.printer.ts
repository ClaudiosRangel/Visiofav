import * as net from 'net'

/**
 * Envia código ZPL para uma impressora de rede via TCP.
 * Usa timeout de 10 segundos para conexão e envio.
 */
export async function enviarZplParaImpressora(
  ip: string,
  porta: number,
  zpl: string,
): Promise<{ sucesso: boolean; erro?: string; tempoMs: number }> {
  const inicio = Date.now()

  return new Promise((resolve) => {
    const socket = new net.Socket()
    let resolvido = false

    const finalizar = (sucesso: boolean, erro?: string) => {
      if (resolvido) return
      resolvido = true
      socket.destroy()
      resolve({ sucesso, erro, tempoMs: Date.now() - inicio })
    }

    socket.setTimeout(10000)

    socket.on('timeout', () => {
      finalizar(false, 'Timeout de conexão (10s)')
    })

    socket.on('error', (err) => {
      finalizar(false, `Erro de conexão: ${err.message}`)
    })

    socket.on('close', () => {
      if (!resolvido) {
        finalizar(true)
      }
    })

    socket.connect(porta, ip, () => {
      socket.write(zpl, 'utf-8', (err) => {
        if (err) {
          finalizar(false, `Erro ao enviar ZPL: ${err.message}`)
        } else {
          // Aguarda brevemente para garantir envio, depois fecha
          setTimeout(() => finalizar(true), 100)
        }
      })
    })
  })
}

/**
 * Testa a conectividade TCP com uma impressora sem enviar dados.
 */
export async function testarConexaoImpressora(
  ip: string,
  porta: number,
): Promise<{ sucesso: boolean; erro?: string; tempoMs: number }> {
  const inicio = Date.now()

  return new Promise((resolve) => {
    const socket = new net.Socket()
    let resolvido = false

    const finalizar = (sucesso: boolean, erro?: string) => {
      if (resolvido) return
      resolvido = true
      socket.destroy()
      resolve({ sucesso, erro, tempoMs: Date.now() - inicio })
    }

    socket.setTimeout(5000)

    socket.on('timeout', () => {
      finalizar(false, 'Timeout de conexão (5s)')
    })

    socket.on('error', (err) => {
      finalizar(false, `Erro: ${err.message}`)
    })

    socket.connect(porta, ip, () => {
      finalizar(true)
    })
  })
}
