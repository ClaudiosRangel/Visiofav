import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render } from '@testing-library/react'
import Home from './page'

const replaceMock = vi.fn()
const useSessaoTerminalMock = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: replaceMock }),
}))

vi.mock('@/contexts/sessao-terminal-context', () => ({
  useSessaoTerminal: () => useSessaoTerminalMock(),
}))

describe('Home (página raiz)', () => {
  beforeEach(() => {
    replaceMock.mockClear()
  })

  it('redireciona para /login-terminal quando não há sessão ativa', () => {
    useSessaoTerminalMock.mockReturnValue({ estaAutenticado: false })
    render(<Home />)
    expect(replaceMock).toHaveBeenCalledWith('/login-terminal')
  })

  it('redireciona para /painel quando há sessão ativa', () => {
    useSessaoTerminalMock.mockReturnValue({ estaAutenticado: true })
    render(<Home />)
    expect(replaceMock).toHaveBeenCalledWith('/painel')
  })
})
