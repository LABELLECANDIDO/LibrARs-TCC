import { useState, useRef, useEffect, useCallback } from 'react'
import { io, Socket } from 'socket.io-client'
import { Link } from 'react-router-dom'
import { CameraFeed } from '@/components/camera/CameraFeed'
import { ARDisplay } from '@/components/camera/ARDisplay'
import { useGestureClassifier } from '@/hooks/useGestureClassifier'
import { useSpeechRecognition } from '@/hooks/useSpeechRecognition'
import { useAuthStore } from '@/stores/authStore'
import { useGestureStore } from '@/stores/gestureStore'
import type { Landmark } from '@/types'
import { generateId } from '@/lib/utils'

const WS_URL = (import.meta.env.VITE_WS_URL as string | undefined) ?? ''

// ── Tipos ─────────────────────────────────────────────────────────────────────

type Status = 'idle' | 'waiting' | 'connected'

interface LogEntry {
  id: string
  type: 'gesture' | 'speech'
  text: string
  from: 'me' | 'peer'
  timestamp: string
}

function now() {
  return new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

function speak(text: string) {
  if (!window.speechSynthesis) return
  window.speechSynthesis.cancel()
  const u = new SpeechSynthesisUtterance(text)
  u.lang = 'pt-BR'
  u.rate = 0.95
  window.speechSynthesis.speak(u)
}

// ── Componente ────────────────────────────────────────────────────────────────

export default function Call() {
  const { user, isAuthenticated } = useAuthStore()
  const gestureCount = useGestureStore((s) => s.gestures.length + s.collectiveGestures.length)

  // Chamada
  const [status, setStatus] = useState<Status>('idle')
  const [roomCode, setRoomCode] = useState('')
  const [inputCode, setInputCode] = useState('')
  const [peerName, setPeerName] = useState('')
  const [callError, setCallError] = useState('')

  // Tradução do par (overlay no vídeo)
  const [peerGesture, setPeerGesture] = useState<string | null>(null)
  const [peerConfidence, setPeerConfidence] = useState(0)
  const peerGestureTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Fala do par recebida via STT deles
  const [peerSpeechInterim, setPeerSpeechInterim] = useState('')

  // Configurações
  const [ttsEnabled, setTtsEnabled] = useState(true)
  const ttsEnabledRef = useRef(true)
  useEffect(() => { ttsEnabledRef.current = ttsEnabled }, [ttsEnabled])

  // Log de conversa
  const [log, setLog] = useState<LogEntry[]>([])
  const logEndRef = useRef<HTMLDivElement>(null)
  const lastSentGestureRef = useRef<string | null>(null)

  // Refs WebRTC / Socket
  const socketRef = useRef<Socket | null>(null)
  const pcRef = useRef<RTCPeerConnection | null>(null)
  const localStreamRef = useRef<MediaStream | null>(null)
  const remoteVideoRef = useRef<HTMLVideoElement>(null)
  const currentRoomRef = useRef('')

  // Classificador de gestos local
  const [landmarks, setLandmarks] = useState<Landmark[] | null>(null)
  const handleLandmarks = useCallback((lms: Landmark[] | null) => setLandmarks(lms), [])
  const { currentGesture, confidence, isDetecting } = useGestureClassifier(landmarks)

  // STT — transcreve fala e envia ao par
  const handleFinalSpeech = useCallback((text: string) => {
    if (!socketRef.current || !currentRoomRef.current) return
    socketRef.current.emit('speech', {
      code: currentRoomRef.current,
      text,
      final: true,
    })
    setLog(prev => [...prev, { id: generateId(), type: 'speech', text, from: 'me', timestamp: now() }])
  }, [])

  const handleInterimSpeech = useCallback((text: string) => {
    if (!socketRef.current || !currentRoomRef.current || !text) return
    socketRef.current.emit('speech', {
      code: currentRoomRef.current,
      text,
      final: false,
    })
  }, [])

  const { isListening, isSupported: sttSupported, interimText, start: startSTT, stop: stopSTT } =
    useSpeechRecognition(handleFinalSpeech, handleInterimSpeech)

  // Envia gesto confirmado + adiciona ao log (sem repetir o mesmo gesto)
  useEffect(() => {
    if (!currentGesture || !socketRef.current || !currentRoomRef.current) return
    if (currentGesture === lastSentGestureRef.current) return
    lastSentGestureRef.current = currentGesture

    socketRef.current.emit('gesture', {
      code: currentRoomRef.current,
      gesture: currentGesture,
      confidence,
    })
    setLog(prev => [...prev, { id: generateId(), type: 'gesture', text: currentGesture, from: 'me', timestamp: now() }])
  }, [currentGesture, confidence])

  // Scroll automático no log
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [log, peerSpeechInterim])

  // ── Socket.io ──────────────────────────────────────────────────────────────

  useEffect(() => {
    const socket = io(WS_URL, { autoConnect: true, transports: ['websocket', 'polling'] })
    socketRef.current = socket

    // Gesto do par → overlay + TTS + log
    socket.on('peer-gesture', (d: { gesture: string; confidence: number }) => {
      setPeerGesture(d.gesture)
      setPeerConfidence(d.confidence)
      if (peerGestureTimerRef.current) clearTimeout(peerGestureTimerRef.current)
      peerGestureTimerRef.current = setTimeout(() => setPeerGesture(null), 3000)

      if (ttsEnabledRef.current) speak(d.gesture)
      setLog(prev => [...prev, { id: generateId(), type: 'gesture', text: d.gesture, from: 'peer', timestamp: now() }])
    })

    // Fala do par → exibe como texto
    socket.on('peer-speech', (d: { text: string; final: boolean }) => {
      if (d.final) {
        setPeerSpeechInterim('')
        setLog(prev => [...prev, { id: generateId(), type: 'speech', text: d.text, from: 'peer', timestamp: now() }])
      } else {
        setPeerSpeechInterim(d.text)
      }
    })

    // WebRTC signaling
    socket.on('webrtc-offer', async (d: { sdp: RTCSessionDescriptionInit }) => {
      const pc = ensurePeerConnection()
      await pc.setRemoteDescription(d.sdp)
      const answer = await pc.createAnswer()
      await pc.setLocalDescription(answer)
      socket.emit('webrtc-answer', { code: currentRoomRef.current, sdp: answer })
    })

    socket.on('webrtc-answer', async (d: { sdp: RTCSessionDescriptionInit }) => {
      await pcRef.current?.setRemoteDescription(d.sdp)
    })

    socket.on('webrtc-ice', async (d: { candidate: RTCIceCandidateInit }) => {
      try { await pcRef.current?.addIceCandidate(d.candidate) } catch { /* ICE tardio */ }
    })

    socket.on('peer-joined', (d: { userId?: string; userName?: string }) => {
      setPeerName(d.userName || d.userId?.slice(0, 8) || 'Participante')
      setStatus('connected')
      initiateWebRTC()
    })

    socket.on('peer-left', () => {
      setPeerName('')
      setPeerGesture(null)
      setPeerSpeechInterim('')
      setStatus('waiting')
      if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null
      pcRef.current?.close()
      pcRef.current = null
    })

    return () => {
      socket.disconnect()
      pcRef.current?.close()
      localStreamRef.current?.getTracks().forEach(t => t.stop())
      if (peerGestureTimerRef.current) clearTimeout(peerGestureTimerRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── WebRTC helpers ─────────────────────────────────────────────────────────

  function ensurePeerConnection(): RTCPeerConnection {
    if (pcRef.current && pcRef.current.connectionState !== 'closed') return pcRef.current
    const pc = new RTCPeerConnection({
      iceServers: [
        // STUN — tenta conexão direta primeiro (sem custo de banda)
        { urls: 'stun:stun.l.google.com:19302' },
        // TURN próprio (coturn na VPS) — relé do vídeo quando STUN falha
        // (WiFi com NAT simétrico). Credenciais são públicas por natureza no WebRTC.
        {
          urls: [
            'turn:37.27.81.229:3478?transport=udp',
            'turn:37.27.81.229:3478?transport=tcp',
          ],
          username: 'librasturn',
          credential: 'libras-turn-2026',
        },
      ],
    })
    pc.ontrack = e => { if (remoteVideoRef.current) remoteVideoRef.current.srcObject = e.streams[0] }
    pc.onicecandidate = e => {
      if (e.candidate) socketRef.current?.emit('webrtc-ice', { code: currentRoomRef.current, candidate: e.candidate })
    }
    pc.onconnectionstatechange = () => { if (pc.connectionState === 'connected') setStatus('connected') }
    pcRef.current = pc
    return pc
  }

  async function addLocalTracks(pc: RTCPeerConnection) {
    if (!localStreamRef.current) {
      localStreamRef.current = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user' },
        audio: true,
      })
    }
    localStreamRef.current.getTracks().forEach(t => pc.addTrack(t, localStreamRef.current!))
  }

  async function initiateWebRTC() {
    const pc = ensurePeerConnection()
    await addLocalTracks(pc)
    const offer = await pc.createOffer()
    await pc.setLocalDescription(offer)
    socketRef.current?.emit('webrtc-offer', { code: currentRoomRef.current, sdp: offer })
  }

  function createRoom() {
    setCallError('')
    socketRef.current?.emit(
      'create-room',
      { userId: user?.id, userName: user?.name },
      (res: { code: string }) => {
        currentRoomRef.current = res.code
        setRoomCode(res.code)
        setStatus('waiting')
      }
    )
  }

  async function joinRoom() {
    const code = inputCode.trim().toUpperCase()
    if (!code) return
    setCallError('')
    socketRef.current?.emit(
      'join-room',
      { code, userId: user?.id, userName: user?.name },
      async (res: { ok?: boolean; error?: string; peerUserId?: string; peerUserName?: string }) => {
        if (res.error) { setCallError(res.error); return }
        currentRoomRef.current = code
        setRoomCode(code)
        setPeerName(res.peerUserName || res.peerUserId?.slice(0, 8) || 'Participante')
        setStatus('connected')
        const pc = ensurePeerConnection()
        await addLocalTracks(pc)
      }
    )
  }

  function endCall() {
    stopSTT()
    pcRef.current?.close(); pcRef.current = null
    localStreamRef.current?.getTracks().forEach(t => t.stop()); localStreamRef.current = null
    if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null
    currentRoomRef.current = ''
    setRoomCode(''); setInputCode(''); setPeerName('')
    setPeerGesture(null); setPeerSpeechInterim('')
    setLog([])
    setStatus('idle')
    socketRef.current?.disconnect()
    socketRef.current?.connect()
  }

  // ── Guard ──────────────────────────────────────────────────────────────────

  if (!isAuthenticated) {
    return (
      <div className="max-w-md mx-auto px-4 py-16 text-center flex flex-col items-center gap-4">
        <div className="text-4xl">🔒</div>
        <h1 className="text-xl font-bold text-gray-900">Chamada em Tempo Real</h1>
        <p className="text-sm text-gray-500">Faça login para iniciar uma chamada com tradução ao vivo.</p>
        <Link to="/" className="mt-2 px-5 py-2.5 bg-blue-600 text-white rounded-xl text-sm font-semibold hover:bg-blue-700 transition-colors">
          Ir para login
        </Link>
      </div>
    )
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="max-w-2xl mx-auto px-4 py-6 flex flex-col gap-5">
      <div className="text-center">
        <h1 className="text-2xl font-bold text-gray-900 mb-1">Chamada em Tempo Real</h1>
        <p className="text-sm text-gray-500">Gestos e fala traduzidos para os dois lados</p>
      </div>

      {gestureCount === 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-sm text-amber-800 text-center">
          Sem gestos carregados.{' '}
          <Link to="/biblioteca" className="font-semibold underline">Abra a Biblioteca</Link>{' '}
          e carregue a base coletiva antes de entrar em chamada.
        </div>
      )}

      {/* ── IDLE ── */}
      {status === 'idle' && (
        <div className="flex flex-col gap-4">
          <button onClick={createRoom} className="w-full py-3.5 bg-[#2E75B6] text-white rounded-xl font-bold hover:bg-[#1B3A6B] transition-colors">
            + Criar nova sala
          </button>
          <div className="flex items-center gap-3 text-gray-400 text-sm">
            <div className="flex-1 h-px bg-gray-200" />
            ou entre com um código
            <div className="flex-1 h-px bg-gray-200" />
          </div>
          <div className="flex gap-2">
            <input
              value={inputCode}
              onChange={e => setInputCode(e.target.value.toUpperCase())}
              placeholder="CÓDIGO DA SALA"
              maxLength={6}
              className="flex-1 border border-gray-300 rounded-xl px-3 py-2.5 text-sm font-mono uppercase tracking-widest focus:outline-none focus:ring-2 focus:ring-[#2E75B6]"
            />
            <button
              onClick={joinRoom}
              disabled={inputCode.length < 4}
              className="px-4 py-2.5 bg-gray-900 text-white rounded-xl text-sm font-bold hover:bg-gray-700 disabled:opacity-40 transition-colors"
            >
              Entrar
            </button>
          </div>
          {callError && <p className="text-sm text-red-600 text-center bg-red-50 border border-red-200 rounded-lg px-3 py-2">{callError}</p>}
        </div>
      )}

      {/* ── WAITING ── */}
      {status === 'waiting' && (
        <div className="bg-blue-50 border border-blue-200 rounded-xl px-5 py-6 text-center flex flex-col items-center gap-3">
          <div className="w-10 h-10 border-4 border-blue-300 border-t-blue-600 rounded-full animate-spin" />
          <div>
            <p className="text-sm font-medium text-blue-800">Aguardando participante…</p>
            <p className="text-xs text-blue-600 mt-1">Compartilhe o código abaixo</p>
          </div>
          <div className="bg-white border border-blue-300 rounded-xl px-6 py-3 font-mono text-2xl font-bold tracking-widest text-blue-700">
            {roomCode}
          </div>
          <button onClick={() => navigator.clipboard.writeText(roomCode)} className="text-xs text-blue-600 underline">
            Copiar código
          </button>
          <button onClick={endCall} className="text-sm text-red-600 hover:text-red-800 underline">Cancelar</button>
        </div>
      )}

      {/* ── CONNECTED ── */}
      {status === 'connected' && (
        <>
          {/* Barra de status */}
          <div className="flex items-center justify-between bg-green-50 border border-green-200 rounded-xl px-4 py-2">
            <div className="flex items-center gap-2 text-sm text-green-800">
              <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
              <span className="font-medium">Conectado{peerName ? ` com ${peerName}` : ''}</span>
            </div>
            <div className="flex items-center gap-2">
              {/* Toggle TTS */}
              <button
                onClick={() => setTtsEnabled(v => !v)}
                title={ttsEnabled ? 'Desativar voz automática' : 'Ativar voz automática'}
                className={`text-xs px-2.5 py-1 rounded-lg font-medium transition-colors ${
                  ttsEnabled ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-500'
                }`}
              >
                🔊 {ttsEnabled ? 'Voz: ON' : 'Voz: OFF'}
              </button>
              <span className="text-xs text-green-600 font-mono">{roomCode}</span>
              <button onClick={endCall} className="text-xs bg-red-100 text-red-700 px-2.5 py-1 rounded-lg hover:bg-red-200 font-medium transition-colors">
                Encerrar
              </button>
            </div>
          </div>

          {/* Vídeo do par */}
          <div className="relative bg-black rounded-2xl overflow-hidden" style={{ aspectRatio: '16/9' }}>
            <video ref={remoteVideoRef} autoPlay playsInline className="w-full h-full object-cover" />
            {peerGesture && (
              <div className="absolute inset-0 pointer-events-none">
                <ARDisplay gesture={peerGesture} confidence={peerConfidence} isDetecting={false} />
              </div>
            )}
            {peerSpeechInterim && (
              <div className="absolute bottom-3 left-0 right-0 px-3">
                <div className="bg-black/70 text-white text-sm px-4 py-2 rounded-xl text-center backdrop-blur-sm">
                  💬 {peerSpeechInterim}…
                </div>
              </div>
            )}
          </div>

          {/* Log de conversa */}
          <div className="bg-white border border-gray-100 rounded-2xl overflow-hidden shadow-sm">
            <div className="px-4 py-2.5 border-b border-gray-50 flex items-center justify-between">
              <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wide">Histórico da conversa</h3>
              {log.length > 0 && (
                <button onClick={() => setLog([])} className="text-xs text-gray-400 hover:text-gray-600">Limpar</button>
              )}
            </div>

            <div className="h-48 overflow-y-auto px-3 py-3 flex flex-col gap-2">
              {log.length === 0 && (
                <p className="text-center text-gray-400 text-xs mt-6">
                  A conversa aparecerá aqui — gestos e fala dos dois lados
                </p>
              )}
              {log.map(entry => (
                <div key={entry.id} className={`flex ${entry.from === 'me' ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[75%] px-3 py-2 rounded-xl text-sm ${
                    entry.from === 'me'
                      ? entry.type === 'gesture'
                        ? 'bg-[#2E75B6] text-white'
                        : 'bg-[#1E5631] text-white'
                      : entry.type === 'gesture'
                        ? 'bg-blue-50 text-[#1B3A6B] border border-blue-100'
                        : 'bg-gray-100 text-gray-800'
                  }`}>
                    <div className="flex items-center gap-1.5 mb-0.5">
                      <span className="text-xs opacity-70">
                        {entry.type === 'gesture' ? '🤟' : '🎤'}
                        {' '}{entry.from === 'me' ? 'Você' : peerName || 'Participante'}
                      </span>
                      <span className="text-xs opacity-50">{entry.timestamp}</span>
                    </div>
                    <p className="font-semibold">{entry.text}</p>
                  </div>
                </div>
              ))}

              {/* Fala interim do par (digitando...) */}
              {peerSpeechInterim && (
                <div className="flex justify-start">
                  <div className="max-w-[75%] px-3 py-2 rounded-xl text-sm bg-gray-100 text-gray-500 border border-gray-200">
                    <div className="text-xs opacity-70 mb-0.5">🎤 {peerName || 'Participante'}</div>
                    <p className="italic">{peerSpeechInterim}…</p>
                  </div>
                </div>
              )}
              <div ref={logEndRef} />
            </div>
          </div>

          {/* Câmera local + STT */}
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <p className="text-xs font-bold text-gray-500 uppercase tracking-wide">Sua câmera — gestos detectados</p>

              {/* Botão STT */}
              {sttSupported ? (
                <button
                  onClick={isListening ? stopSTT : startSTT}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-colors ${
                    isListening
                      ? 'bg-red-100 text-red-700 hover:bg-red-200 animate-pulse'
                      : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}
                >
                  {isListening ? (
                    <><span className="w-2 h-2 bg-red-500 rounded-full" /> Parar fala</>
                  ) : (
                    <>🎤 Falar (ouvinte)</>
                  )}
                </button>
              ) : (
                <span className="text-xs text-gray-400">STT não suportado neste navegador</span>
              )}
            </div>

            {/* Texto interim do próprio STT */}
            {interimText && (
              <div className="bg-green-50 border border-green-200 rounded-xl px-3 py-2 text-sm text-green-800">
                🎤 <span className="italic">{interimText}…</span>
              </div>
            )}

            <CameraFeed onLandmarks={handleLandmarks}>
              <ARDisplay gesture={currentGesture} confidence={confidence} isDetecting={isDetecting} />
            </CameraFeed>
          </div>
        </>
      )}
    </div>
  )
}
