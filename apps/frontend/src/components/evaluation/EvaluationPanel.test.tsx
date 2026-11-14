import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { EvaluationPanel } from './EvaluationPanel'
import { useAuthStore } from '@/stores/authStore'
import type { HistoryEntry } from '@/hooks/useGestureClassifier'

const logAttempt = vi.fn()
const submitFeedback = vi.fn()
const getUsers = vi.fn()

vi.mock('@/lib/api', () => ({
  api: {
    metrics: { logAttempt: (...a: unknown[]) => logAttempt(...a) },
    feedback: { submit: (...a: unknown[]) => submitFeedback(...a) },
    admin: { getUsers: (...a: unknown[]) => getUsers(...a) },
  },
}))

const entry = (gesture: string): HistoryEntry => ({ gesture, timestamp: '12:00:00' })

function setUser(role: 'user' | 'admin' = 'user') {
  useAuthStore.setState({
    token: 't',
    isAuthenticated: true,
    user: { id: 'me', email: 'me@x', name: 'Eu', role },
  })
}

/** Avança os timers falsos e deixa as promises pendentes resolverem. */
async function advance(ms: number) {
  await act(async () => { await vi.advanceTimersByTimeAsync(ms) })
}

async function startSession() {
  fireEvent.click(screen.getByText(/Modo avaliação \(para o mediador\)/))
  await advance(0)
  fireEvent.click(screen.getByText('Iniciar sessão'))
}

describe('EvaluationPanel — modo avaliação', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    logAttempt.mockReset().mockResolvedValue({ ok: true, id: '1' })
    submitFeedback.mockReset().mockResolvedValue({ ok: true, id: '1' })
    getUsers.mockReset().mockResolvedValue({ total: 0, users: [] })
    setUser('user')
  })
  afterEach(() => { vi.useRealTimers() })

  it('registra um acerto quando o gesto pedido é reconhecido', async () => {
    const { rerender } = render(<EvaluationPanel history={[]} confidence={0} vocabulary={['A']} />)
    await startSession()
    await advance(2000)                       // pausa de preparo → escuta
    expect(screen.getByText('Faça o sinal')).toBeInTheDocument()

    await advance(1500)                       // participante leva 1,5 s
    rerender(<EvaluationPanel history={[entry('A')]} confidence={0.9} vocabulary={['A']} />)
    await advance(0)

    expect(logAttempt).toHaveBeenCalledTimes(1)
    const sent = logAttempt.mock.calls[0][0]
    expect(sent).toMatchObject({ expected: 'A', predicted: 'A', confidence: 0.9, config: 'A', user_id: null })
    expect(sent.session_id).toBeTruthy()
    expect(sent.latency_ms).toBeGreaterThanOrEqual(1500)
    expect(sent.latency_ms).toBeLessThan(2500)
    expect(screen.getByText('acertos').previousSibling).toHaveTextContent('1')
  })

  it('registra um erro quando outro gesto é reconhecido', async () => {
    const { rerender } = render(<EvaluationPanel history={[]} confidence={0} vocabulary={['A']} />)
    await startSession()
    await advance(2000)
    rerender(<EvaluationPanel history={[entry('B')]} confidence={0.7} vocabulary={['A']} />)
    await advance(0)

    expect(logAttempt.mock.calls[0][0]).toMatchObject({ expected: 'A', predicted: 'B' })
    expect(screen.getByText('erros').previousSibling).toHaveTextContent('1')
  })

  it('registra como rejeitada a tentativa sem reconhecimento em 8 segundos', async () => {
    render(<EvaluationPanel history={[]} confidence={0} vocabulary={['A']} />)
    await startSession()
    await advance(2000)
    await advance(7900)
    expect(logAttempt).not.toHaveBeenCalled()   // ainda dentro do prazo
    await advance(200)

    expect(logAttempt).toHaveBeenCalledTimes(1)
    expect(logAttempt.mock.calls[0][0]).toMatchObject({ expected: 'A', predicted: null, confidence: null })
    expect(screen.getByText('sem resposta', { selector: 'p' }).previousSibling).toHaveTextContent('1')
  })

  it('ignora confirmações anteriores ao início da escuta', async () => {
    // O gesto já tinha sido reconhecido antes da tentativa começar
    const old = [entry('A')]
    render(<EvaluationPanel history={old} confidence={0.9} vocabulary={['A']} />)
    await startSession()
    await advance(2000)
    await advance(3000)
    expect(logAttempt).not.toHaveBeenCalled()
  })

  it('gera uma linha por tentativa e percorre todos os gestos da sessão', async () => {
    const vocab = ['A', 'B', 'C']
    const { rerender } = render(<EvaluationPanel history={[]} confidence={0} vocabulary={vocab} />)
    await startSession()

    let history: HistoryEntry[] = []
    for (let i = 0; i < vocab.length; i++) {
      await advance(2000)
      const asked = screen.getByRole('combobox').closest('div')!.querySelector('select')!.value
      history = [entry(asked), ...history]
      rerender(<EvaluationPanel history={history} confidence={0.8} vocabulary={vocab} />)
      await advance(0)
    }

    expect(logAttempt).toHaveBeenCalledTimes(3)
    const asked = logAttempt.mock.calls.map(c => c[0].expected).sort()
    expect(asked).toEqual(['A', 'B', 'C'])                       // cada gesto pedido uma vez
    const sessions = new Set(logAttempt.mock.calls.map(c => c[0].session_id))
    expect(sessions.size).toBe(1)                                // mesma sessão
    expect(screen.getByText('acertos').previousSibling).toHaveTextContent('3')
  })

  it('guarda a tentativa que falhou ao enviar e reenvia', async () => {
    logAttempt.mockRejectedValueOnce(new Error('offline'))
    const { rerender } = render(<EvaluationPanel history={[]} confidence={0} vocabulary={['A']} />)
    await startSession()
    await advance(2000)
    rerender(<EvaluationPanel history={[entry('A')]} confidence={0.9} vocabulary={['A']} />)
    await advance(0)

    // A sessão termina e o painel tenta reenviar sozinho
    await advance(0)
    expect(logAttempt.mock.calls.length).toBeGreaterThanOrEqual(1)
    const failedPayload = logAttempt.mock.calls[0][0]

    // Se ainda houver pendência visível, o botão Reenviar a resolve
    const retry = screen.queryByText('Reenviar')
    if (retry) { fireEvent.click(retry); await advance(0) }

    expect(logAttempt.mock.calls.length).toBeGreaterThanOrEqual(2)
    expect(logAttempt.mock.calls.at(-1)![0]).toEqual(failedPayload)   // mesma tentativa, sem perda
    expect(screen.queryByText(/ainda não enviada/)).not.toBeInTheDocument()
  })

  it('associa o questionário final à sessão', async () => {
    const { rerender } = render(<EvaluationPanel history={[]} confidence={0} vocabulary={['A']} />)
    await startSession()
    await advance(2000)
    rerender(<EvaluationPanel history={[entry('A')]} confidence={0.9} vocabulary={['A']} />)
    await advance(0)

    expect(screen.getByText('Como foi a experiência?')).toBeInTheDocument()
    fireEvent.click(screen.getByText('Enviar'))
    await advance(0)

    const sessionId = logAttempt.mock.calls[0][0].session_id
    expect(submitFeedback).toHaveBeenCalledTimes(1)
    expect(submitFeedback.mock.calls[0][0]).toMatchObject({ session_id: sessionId, user_id: null })
  })

  it('admin registra a tentativa em nome do participante avaliado', async () => {
    setUser('admin')
    getUsers.mockResolvedValue({ total: 2, users: [
      { id: 'me', email: 'me@x', name: 'Eu' },
      { id: 'p01', email: 'p01@x', name: 'P01' },
    ] })
    const { rerender } = render(<EvaluationPanel history={[]} confidence={0} vocabulary={['A']} />)
    fireEvent.click(screen.getByText(/Modo avaliação \(para o mediador\)/))
    await advance(0)
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'p01' } })
    fireEvent.click(screen.getByText('Iniciar sessão'))
    await advance(2000)
    rerender(<EvaluationPanel history={[entry('A')]} confidence={0.9} vocabulary={['A']} />)
    await advance(0)

    expect(logAttempt.mock.calls[0][0]).toMatchObject({ expected: 'A', user_id: 'p01' })
  })
})
