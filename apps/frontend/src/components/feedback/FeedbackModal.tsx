import { useState } from 'react'
import { api } from '@/lib/api'

interface FeedbackModalProps {
  open: boolean
  onClose: () => void
  /** Sessão de validação (modo avaliação) à qual o feedback fica associado. */
  sessionId?: string | null
  /** Participante avaliado, quando um administrador/mediador opera a sessão. */
  userId?: string | null
}

const QUESTIONS = [
  { key: 'recognized', label: 'O app reconheceu seus sinais?', opts: [{ v: 1, e: '😟' }, { v: 2, e: '😐' }, { v: 3, e: '🙂' }] },
  { key: 'easy',       label: 'Foi fácil de usar?',            opts: [{ v: 1, e: '😟' }, { v: 2, e: '😐' }, { v: 3, e: '🙂' }] },
  { key: 'again',      label: 'Você usaria de novo?',          opts: [{ v: 0, e: '👎' }, { v: 1, e: '👍' }] },
] as const

type Answers = { recognized: number | null; easy: number | null; again: number | null }
const EMPTY: Answers = { recognized: null, easy: null, again: null }

/**
 * Questionário de feedback acessível: três perguntas respondidas por ícones
 * grandes (pouca leitura) e um comentário opcional. Usado ao fim da Chamada e
 * ao fim de uma sessão do modo avaliação.
 */
export function FeedbackModal({ open, onClose, sessionId, userId }: FeedbackModalProps) {
  const [answers, setAnswers] = useState<Answers>(EMPTY)
  const [comment, setComment] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [failed, setFailed] = useState(false)

  if (!open) return null

  const close = () => {
    setAnswers(EMPTY); setComment(''); setSubmitting(false); setFailed(false)
    onClose()
  }

  const submit = async () => {
    setSubmitting(true); setFailed(false)
    try {
      await api.feedback.submit({
        recognized_well: answers.recognized,
        easy_to_use: answers.easy,
        would_use_again: answers.again,
        comment: comment.trim() || null,
        session_id: sessionId ?? null,
        user_id: userId ?? null,
      })
      close()
    } catch {
      // Não fecha: as respostas ficam na tela para tentar de novo
      setSubmitting(false); setFailed(true)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 animate-fade-in-scale flex flex-col gap-5 max-h-[90vh] overflow-y-auto">
        <div className="text-center">
          <h3 className="text-lg font-bold text-gray-900">Como foi a experiência?</h3>
          <p className="text-sm text-gray-500">Toque na carinha que combina com o que você achou.</p>
        </div>

        {QUESTIONS.map(q => (
          <div key={q.key}>
            <p className="text-sm font-semibold text-gray-700 mb-2 text-center">{q.label}</p>
            <div className="flex justify-center gap-3">
              {q.opts.map(o => (
                <button
                  key={o.v}
                  type="button"
                  onClick={() => setAnswers(a => ({ ...a, [q.key]: o.v }))}
                  aria-label={`${q.label} — opção ${o.v}`}
                  className={`w-16 h-16 rounded-2xl text-3xl flex items-center justify-center border-2 transition-colors ${
                    answers[q.key] === o.v ? 'border-[#2E75B6] bg-blue-50' : 'border-gray-200 hover:border-gray-300'
                  }`}
                >
                  {o.e}
                </button>
              ))}
            </div>
          </div>
        ))}

        <textarea
          value={comment}
          onChange={e => setComment(e.target.value)}
          rows={2}
          placeholder="Quer comentar algo? (opcional)"
          className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-[#2E75B6]"
        />

        {failed && (
          <p className="text-xs text-red-600 text-center">
            Não foi possível enviar. Verifique a conexão e toque em Enviar de novo.
          </p>
        )}

        <div className="flex gap-2">
          <button onClick={close} className="flex-1 py-2.5 bg-gray-100 rounded-xl text-sm font-bold text-gray-600 hover:bg-gray-200">Pular</button>
          <button
            onClick={submit}
            disabled={submitting}
            className="flex-1 py-2.5 bg-[#2E75B6] rounded-xl text-sm font-bold text-white hover:bg-[#1B3A6B] disabled:opacity-60"
          >
            {submitting ? 'Enviando...' : 'Enviar'}
          </button>
        </div>
      </div>
    </div>
  )
}
