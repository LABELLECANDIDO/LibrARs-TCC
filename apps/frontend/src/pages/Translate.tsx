import { useState, useCallback, useMemo } from 'react'
import { CameraFeed } from '@/components/camera/CameraFeed'
import { ARDisplay } from '@/components/camera/ARDisplay'
import { EvaluationPanel } from '@/components/evaluation/EvaluationPanel'
import { useGestureClassifier } from '@/hooks/useGestureClassifier'
import { useGestureStore } from '@/stores/gestureStore'
import { Link } from 'react-router-dom'
import type { Landmark } from '@/types'

export default function Translate() {
  const [landmarks, setLandmarks] = useState<Landmark[] | null>(null)
  const gestureCount = useGestureStore(s => s.gestures.length + s.collectiveGestures.length)
  const ownGestures = useGestureStore(s => s.gestures)
  const collectiveGestures = useGestureStore(s => s.collectiveGestures)

  // Vocabulário reconhecível (nomes distintos) — usado pelo modo avaliação
  const vocabulary = useMemo(
    () => Array.from(new Set([...ownGestures, ...collectiveGestures].map(g => g.name)))
      .sort((a, b) => a.localeCompare(b)),
    [ownGestures, collectiveGestures]
  )

  const handleLandmarks = useCallback((lms: Landmark[] | null, _detected: boolean) => {
    setLandmarks(lms)
  }, [])

  const { currentGesture, confidence, isDetecting, history, currentPhrase } =
    useGestureClassifier(landmarks)

  return (
    <div className="max-w-2xl mx-auto px-4 py-6 flex flex-col gap-6">
      <div className="text-center">
        <h1 className="text-2xl font-bold text-gray-900 mb-1">Tradução em Tempo Real</h1>
        <p className="text-sm text-gray-500">
          Posicione seu gesto de Libras em frente à câmera
        </p>
      </div>

      {/* Aviso: sem gestos cadastrados */}
      {gestureCount === 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-sm text-amber-800 text-center">
          Nenhum gesto cadastrado ainda.{' '}
          <Link to="/treinar" className="font-semibold underline hover:text-amber-900">
            Vá para Treinar
          </Link>{' '}
          para gravar seu primeiro gesto.
        </div>
      )}

      {/* Câmera com overlay AR */}
      <CameraFeed onLandmarks={handleLandmarks}>
        <ARDisplay
          gesture={currentGesture}
          confidence={confidence}
          isDetecting={isDetecting}
        />
      </CameraFeed>

      {/* Modo avaliação (Item 4): registra cada tentativa — gesto pedido × reconhecido */}
      <EvaluationPanel history={history} confidence={confidence} vocabulary={vocabulary} />

      {/* Modo frase */}
      {currentPhrase && (
        <div className="bg-gray-900 rounded-xl px-5 py-4 text-center">
          <p className="text-xs text-gray-400 mb-1 uppercase tracking-wider">Frase detectada</p>
          <p className="text-white text-xl font-bold tracking-wide">{currentPhrase}</p>
        </div>
      )}

      {/* Histórico */}
      {history.length > 0 && (
        <div className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold text-gray-600 uppercase tracking-wider">
            Histórico
          </h2>
          <ul className="flex flex-col gap-1" aria-label="Histórico de traduções">
            {history.map((item, i) => (
              <li
                key={i}
                className="flex items-center justify-between bg-white border border-gray-100 rounded-lg px-3 py-2"
              >
                <span className="font-medium text-gray-800 text-sm">{item.gesture}</span>
                <span className="text-xs text-gray-400 font-mono">{item.timestamp}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {gestureCount > 0 && history.length === 0 && (
        <p className="text-center text-xs text-gray-400">
          {gestureCount} gesto{gestureCount !== 1 ? 's' : ''} cadastrado
          {gestureCount !== 1 ? 's' : ''} — faça um gesto para traduzir
        </p>
      )}
    </div>
  )
}
