import { useCallback, useEffect, useRef, useState } from 'react'
import { api, type AttemptPayload } from '@/lib/api'
import { useAuthStore } from '@/stores/authStore'
import { generateId } from '@/lib/utils'
import { APP_VERSION } from '@/lib/consent'
import { FeedbackModal } from '@/components/feedback/FeedbackModal'
import type { HistoryEntry } from '@/hooks/useGestureClassifier'

/**
 * Modo avaliação (Item 4 da especificação).
 *
 * O mediador inicia uma sessão; a plataforma pede um gesto por vez, em ordem
 * sorteada, e registra CADA tentativa com o gesto pedido e o gesto reconhecido
 * (ou nulo, se nada for reconhecido em 8 s). Ao fim, exibe o questionário de
 * feedback associado à mesma sessão.
 */

const PREPARE_MS = 2000   // pausa entre tentativas (o participante abaixa a mão)
const TIMEOUT_MS = 8000   // sem reconhecimento nesse tempo → tentativa rejeitada
const CONFIG = 'A'        // configuração do classificador em uso (linha de base: só forma da mão)

type Phase = 'closed' | 'setup' | 'prepare' | 'listening' | 'done'

interface AttemptResult {
  expected: string
  predicted: string | null
  confidence: number | null
  latency: number
}

interface Participant { id: string; name: string }

interface EvaluationPanelProps {
  history: HistoryEntry[]     // confirmações do classificador (mais recente primeiro)
  confidence: number          // confiança da confirmação mais recente
  vocabulary: string[]        // gestos disponíveis para reconhecimento
}

function shuffle<T>(items: T[]): T[] {
  const a = [...items]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

export function EvaluationPanel({ history, confidence, vocabulary }: EvaluationPanelProps) {
  const user = useAuthStore(s => s.user)
  const isAdmin = user?.role === 'admin'

  const [phase, setPhase] = useState<Phase>('closed')
  const [selected, setSelected] = useState<string[]>([])
  const [order, setOrder] = useState<string[]>([])
  const [index, setIndex] = useState(0)
  const [sessionId, setSessionId] = useState('')
  const [results, setResults] = useState<AttemptResult[]>([])
  const [pending, setPending] = useState<AttemptPayload[]>([])   // tentativas que falharam ao enviar
  const [remaining, setRemaining] = useState(TIMEOUT_MS / 1000)
  const [showFeedback, setShowFeedback] = useState(false)

  // Participante avaliado: o próprio usuário, ou (para admin) alguém escolhido
  const [participants, setParticipants] = useState<Participant[]>([])
  const [participantId, setParticipantId] = useState<string>('')
  const evaluatedId = participantId || user?.id || ''
  const onBehalf = !!user && evaluatedId !== user.id   // admin operando para outra pessoa

  // Refs para ler o estado mais recente dentro de timers/efeitos
  const historyRef = useRef(history); historyRef.current = history
  const confidenceRef = useRef(confidence); confidenceRef.current = confidence
  const phaseRef = useRef(phase); phaseRef.current = phase
  const runRef = useRef({ order, index, sessionId, evaluatedId, onBehalf })
  runRef.current = { order, index, sessionId, evaluatedId, onBehalf }
  const t0Ref = useRef(0)
  const baselineRef = useRef<HistoryEntry | null>(null)
  const attemptClosedRef = useRef(true)

  // ── Envio com fila de reenvio (nenhuma tentativa pode se perder) ────────────
  const pendingRef = useRef<AttemptPayload[]>([])

  const send = useCallback(async (payload: AttemptPayload) => {
    try {
      await api.metrics.logAttempt(payload)
    } catch {
      pendingRef.current = [...pendingRef.current, payload]
      setPending(pendingRef.current)
    }
  }, [])

  const retryPending = useCallback(async () => {
    const list = pendingRef.current
    if (list.length === 0) return
    pendingRef.current = []
    setPending([])
    for (const p of list) await send(p)   // o que falhar de novo volta para a fila
  }, [send])

  // ── Fecha a tentativa atual e avança ────────────────────────────────────────
  const finishAttempt = useCallback((predicted: string | null, conf: number | null) => {
    if (attemptClosedRef.current) return
    attemptClosedRef.current = true

    const run = runRef.current
    const expected = run.order[run.index]
    const latency = Math.round(performance.now() - t0Ref.current)

    void send({
      session_id: run.sessionId,
      expected,
      predicted,
      confidence: predicted ? conf : null,
      latency_ms: latency,
      segment_frames: null,   // passa a ser preenchido com a segmentação (item 3)
      pose_ok_ratio: null,    // passa a ser preenchido com a pose (item 2)
      config: CONFIG,
      w: null,
      app_version: APP_VERSION,
      user_id: run.onBehalf ? run.evaluatedId : null,
    })
    setResults(prev => [...prev, { expected, predicted, confidence: predicted ? conf : null, latency }])

    if (run.index + 1 >= run.order.length) {
      setPhase('done')
    } else {
      setIndex(run.index + 1)
      setPhase('prepare')
    }
  }, [send])

  // ── Máquina de estados da sessão ────────────────────────────────────────────
  useEffect(() => {
    if (phase === 'prepare') {
      const t = setTimeout(() => setPhase('listening'), PREPARE_MS)
      return () => clearTimeout(t)
    }
    if (phase === 'listening') {
      attemptClosedRef.current = false
      t0Ref.current = performance.now()
      // Só conta como resposta uma confirmação NOVA, posterior a este instante
      baselineRef.current = historyRef.current[0] ?? null
      setRemaining(TIMEOUT_MS / 1000)
      const tick = setInterval(() => {
        const left = TIMEOUT_MS - (performance.now() - t0Ref.current)
        setRemaining(Math.max(0, Math.ceil(left / 1000)))
      }, 250)
      const t = setTimeout(() => finishAttempt(null, null), TIMEOUT_MS)
      return () => { clearTimeout(t); clearInterval(tick) }
    }
    if (phase === 'done') {
      setShowFeedback(true)
      void retryPending()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, index])

  // Uma nova confirmação do classificador durante a escuta encerra a tentativa
  useEffect(() => {
    if (phaseRef.current !== 'listening') return
    const top = history[0]
    if (top && top !== baselineRef.current) finishAttempt(top.gesture, confidenceRef.current)
  }, [history, finishAttempt])

  // ── Ações do mediador ───────────────────────────────────────────────────────
  const openSetup = () => {
    setSelected(vocabulary)
    setParticipantId('')
    setPhase('setup')
    if (isAdmin) {
      api.admin.getUsers()
        .then(r => setParticipants(r.users.map(u => ({ id: u.id, name: u.name || u.email }))))
        .catch(() => setParticipants([]))
    }
  }

  const startSession = () => {
    if (selected.length === 0) return
    setOrder(shuffle(selected))   // ordem sorteada a cada sessão/participante
    setIndex(0)
    setResults([])
    setSessionId(generateId())
    setPhase('prepare')
  }

  const jumpTo = (gesture: string) => {
    const pos = order.indexOf(gesture)
    if (pos < 0) return
    attemptClosedRef.current = true   // descarta a tentativa em curso, sem registrar
    setIndex(pos)
    setPhase('prepare')
  }

  const endSession = () => {
    attemptClosedRef.current = true
    setPhase(results.length > 0 ? 'done' : 'closed')
  }

  const toggleGesture = (g: string) =>
    setSelected(prev => (prev.includes(g) ? prev.filter(x => x !== g) : [...prev, g]))

  // ── Render ──────────────────────────────────────────────────────────────────
  if (phase === 'closed') {
    return (
      <div className="text-center">
        <button onClick={openSetup} className="text-xs text-gray-400 hover:text-[#2E75B6] underline">
          Modo avaliação (para o mediador)
        </button>
      </div>
    )
  }

  const hits = results.filter(r => r.predicted === r.expected).length
  const rejected = results.filter(r => r.predicted === null).length
  const errors = results.length - hits - rejected
  const expected = order[index]

  return (
    <div className="bg-white border-2 border-[#2E75B6] rounded-2xl p-5 flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h2 className="font-bold text-[#1B3A6B] text-sm uppercase tracking-wide">Modo avaliação</h2>
        {phase === 'setup' && (
          <button onClick={() => setPhase('closed')} className="text-xs text-gray-400 hover:text-gray-600">Fechar</button>
        )}
      </div>

      {/* ── Preparação da sessão ── */}
      {phase === 'setup' && (
        <>
          <p className="text-sm text-gray-600">
            A plataforma pede um sinal por vez, em ordem sorteada, e registra cada tentativa
            (sinal pedido × sinal reconhecido). Sem reconhecimento em {TIMEOUT_MS / 1000} segundos,
            a tentativa conta como rejeitada.
          </p>

          {isAdmin && participants.length > 0 && (
            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-1">Participante avaliado</label>
              <select
                value={participantId}
                onChange={e => setParticipantId(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white"
              >
                <option value="">Eu mesmo(a) — {user?.name}</option>
                {participants.filter(p => p.id !== user?.id).map(p => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>
          )}

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-xs font-semibold text-gray-500">
                Sinais da sessão ({selected.length} de {vocabulary.length})
              </span>
              <span className="flex gap-3 text-xs">
                <button onClick={() => setSelected(vocabulary)} className="text-[#2E75B6] underline">todos</button>
                <button onClick={() => setSelected([])} className="text-[#2E75B6] underline">nenhum</button>
              </span>
            </div>
            {vocabulary.length === 0 ? (
              <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                Nenhum gesto carregado. Carregue a base coletiva na Biblioteca antes de avaliar.
              </p>
            ) : (
              <div className="flex flex-wrap gap-1.5 max-h-36 overflow-y-auto">
                {vocabulary.map(g => (
                  <button
                    key={g}
                    onClick={() => toggleGesture(g)}
                    className={`px-2.5 py-1 rounded-lg text-xs font-semibold border transition-colors ${
                      selected.includes(g)
                        ? 'bg-[#2E75B6] text-white border-[#2E75B6]'
                        : 'bg-gray-50 text-gray-500 border-gray-200'
                    }`}
                  >
                    {g}
                  </button>
                ))}
              </div>
            )}
          </div>

          <button
            onClick={startSession}
            disabled={selected.length === 0}
            className="bg-[#2E75B6] text-white rounded-xl py-2.5 text-sm font-bold hover:bg-[#1B3A6B] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            Iniciar sessão
          </button>
        </>
      )}

      {/* ── Sessão em andamento ── */}
      {(phase === 'prepare' || phase === 'listening') && (
        <>
          <div className="flex items-center justify-between text-xs text-gray-500">
            <span>Sinal {index + 1} de {order.length}</span>
            <span>✓ {hits} · ✗ {errors} · sem resposta {rejected}</span>
          </div>

          <div className={`rounded-xl px-4 py-5 text-center ${phase === 'listening' ? 'bg-blue-50' : 'bg-gray-50'}`}>
            <p className="text-xs uppercase tracking-wide text-gray-500">
              {phase === 'listening' ? 'Faça o sinal' : 'Próximo sinal — abaixe a mão'}
            </p>
            <p className="text-3xl font-black text-[#1B3A6B] tracking-wide mt-1">{expected}</p>
            {phase === 'listening' && (
              <p className="text-xs text-gray-500 mt-2">Tempo restante: {remaining}s</p>
            )}
          </div>

          <div className="flex items-center gap-2">
            <label className="text-xs text-gray-500 shrink-0">Gesto pedido:</label>
            <select
              value={expected}
              onChange={e => jumpTo(e.target.value)}
              className="flex-1 border border-gray-300 rounded-lg px-2 py-1.5 text-sm bg-white"
            >
              {order.map(g => <option key={g} value={g}>{g}</option>)}
            </select>
            <button
              onClick={endSession}
              className="text-xs bg-red-100 text-red-700 px-3 py-2 rounded-lg hover:bg-red-200 font-semibold"
            >
              Encerrar sessão
            </button>
          </div>
        </>
      )}

      {/* ── Resumo ── */}
      {phase === 'done' && (
        <>
          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="bg-green-50 rounded-xl py-3">
              <p className="text-2xl font-extrabold text-green-700">{hits}</p>
              <p className="text-xs text-green-700">acertos</p>
            </div>
            <div className="bg-red-50 rounded-xl py-3">
              <p className="text-2xl font-extrabold text-red-600">{errors}</p>
              <p className="text-xs text-red-600">erros</p>
            </div>
            <div className="bg-gray-100 rounded-xl py-3">
              <p className="text-2xl font-extrabold text-gray-600">{rejected}</p>
              <p className="text-xs text-gray-600">sem resposta</p>
            </div>
          </div>

          <ul className="text-xs divide-y divide-gray-100 max-h-40 overflow-y-auto border border-gray-100 rounded-lg">
            {results.map((r, i) => (
              <li key={i} className="flex items-center justify-between px-3 py-1.5">
                <span className="font-semibold text-gray-700">{r.expected}</span>
                <span className={
                  r.predicted === null ? 'text-gray-400'
                  : r.predicted === r.expected ? 'text-green-700' : 'text-red-600'
                }>
                  {r.predicted === null ? 'sem resposta' : `→ ${r.predicted}`}
                  {r.predicted !== null && ` · ${(r.latency / 1000).toFixed(1)}s`}
                </span>
              </li>
            ))}
          </ul>

          <div className="flex gap-2">
            <button onClick={() => setShowFeedback(true)} className="flex-1 py-2 bg-gray-100 rounded-xl text-sm font-semibold text-gray-700 hover:bg-gray-200">
              Questionário
            </button>
            <button onClick={openSetup} className="flex-1 py-2 bg-[#2E75B6] rounded-xl text-sm font-bold text-white hover:bg-[#1B3A6B]">
              Nova sessão
            </button>
            <button onClick={() => setPhase('closed')} className="py-2 px-3 text-sm text-gray-500 hover:text-gray-700">
              Fechar
            </button>
          </div>
        </>
      )}

      {/* Tentativas que não chegaram ao servidor */}
      {pending.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 flex items-center justify-between gap-3">
          <span className="text-xs text-amber-800">
            {pending.length} tentativa(s) ainda não enviada(s) ao servidor. Não feche esta página.
          </span>
          <button onClick={() => void retryPending()} className="text-xs font-bold text-amber-800 bg-amber-100 hover:bg-amber-200 px-2.5 py-1 rounded-md shrink-0">
            Reenviar
          </button>
        </div>
      )}

      <FeedbackModal
        open={showFeedback}
        onClose={() => setShowFeedback(false)}
        sessionId={sessionId || null}
        userId={onBehalf ? evaluatedId : null}
      />
    </div>
  )
}
