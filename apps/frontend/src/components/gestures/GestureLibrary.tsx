import { useRef, useState, useEffect, useCallback } from 'react'
import { useGestureStore } from '@/stores/gestureStore'
import { api } from '@/lib/api'
import { formatDate } from '@/lib/utils'

interface MyRecording {
  id: string; gesture_name: string; created_at: string
  hand_ratio: number; pose_ratio: number; source: string; n_frames: number
}

export function GestureLibrary() {
  const { gestures, exportAsJson, importFromJson,
          loadCollectiveDataset, collectiveGestures, loadFromApi } = useGestureStore()
  const importRef = useRef<HTMLInputElement>(null)

  // Sincroniza com o servidor ao abrir a biblioteca (traz dados reais)
  useEffect(() => {
    loadFromApi().catch(() => null)
  }, [loadFromApi])
  const [importMsg, setImportMsg] = useState<{ type: 'ok' | 'error'; text: string } | null>(null)
  const [loadingCollective, setLoadingCollective] = useState(false)

  // Item 1 — gravações do participante, agrupadas por gesto
  const [recs, setRecs] = useState<MyRecording[]>([])
  const [expanded, setExpanded] = useState<string | null>(null)
  const loadRecs = useCallback(() => {
    api.gestures.myRecordings().then(setRecs).catch(() => setRecs([]))
  }, [])
  useEffect(() => { loadRecs() }, [loadRecs])

  const handleDeleteRecording = async (id: string) => {
    try {
      await api.gestures.deleteRecording(id)
      setRecs(prev => prev.filter(r => r.id !== id))
    } catch { /* ignora; a lista recarrega no próximo acesso */ }
  }

  // agrupa por nome de gesto
  const groups = recs.reduce<Record<string, MyRecording[]>>((acc, r) => {
    (acc[r.gesture_name] ??= []).push(r)
    return acc
  }, {})
  const groupNames = Object.keys(groups).sort((a, b) => a.localeCompare(b))

  const handleLoadCollective = async () => {
    setLoadingCollective(true)
    setImportMsg(null)
    try {
      const count = await loadCollectiveDataset()
      setImportMsg({ type: 'ok', text: `Base coletiva carregada — ${count} letra(s)/gesto(s) de todos os participantes disponíveis na tradução.` })
    } catch (err) {
      setImportMsg({ type: 'error', text: err instanceof Error ? err.message : 'Falha ao carregar base coletiva' })
    } finally {
      setLoadingCollective(false)
      setTimeout(() => setImportMsg(null), 6000)
    }
  }

  const handleExport = () => {
    const json = exportAsJson()
    const blob = new Blob([json], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `libras-gestos-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  const handleImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      try {
        const before = useGestureStore.getState().gestures.length
        importFromJson(reader.result as string)
        const after = useGestureStore.getState().gestures.length
        setImportMsg({ type: 'ok', text: `Importação concluída — ${after} gesto(s) na biblioteca${after > before ? ` (+${after - before} novos)` : ''}.` })
      } catch (err) {
        setImportMsg({ type: 'error', text: err instanceof Error ? err.message : 'Falha ao importar arquivo' })
      }
      setTimeout(() => setImportMsg(null), 5000)
    }
    reader.readAsText(file)
    e.target.value = ''
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5 flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold text-gray-800 text-base">
          Biblioteca
          {groupNames.length > 0 && (
            <span className="ml-2 text-xs font-normal bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full">
              {groupNames.length} gesto{groupNames.length !== 1 ? 's' : ''}
            </span>
          )}
        </h2>

        <div className="flex gap-2">
          <button
            onClick={() => importRef.current?.click()}
            className="text-xs bg-gray-100 hover:bg-gray-200 text-gray-600 px-2.5 py-1.5 rounded-md transition-colors"
          >
            Importar
          </button>
          <input ref={importRef} type="file" accept=".json" onChange={handleImport} className="sr-only" />
          {gestures.length > 0 && (
            <button
              onClick={handleExport}
              className="text-xs bg-gray-100 hover:bg-gray-200 text-gray-600 px-2.5 py-1.5 rounded-md transition-colors"
            >
              Exportar
            </button>
          )}
        </div>
      </div>

      {/* Base coletiva da pesquisa */}
      <div className="bg-gradient-to-br from-[#1B3A6B] to-[#2E75B6] rounded-xl p-4 text-white">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1">
            <h3 className="font-bold text-sm flex items-center gap-1.5">🌐 Base coletiva</h3>
            <p className="text-xs text-blue-100 mt-1 leading-relaxed">
              Carregue as letras e gestos treinados por <strong>todos os participantes</strong> para
              que a tradução reconheça muito mais sinais.
            </p>
            {collectiveGestures.length > 0 && (
              <p className="text-xs text-green-200 mt-1.5 font-semibold">
                ✓ {collectiveGestures.length} gesto(s) coletivos ativos na tradução
              </p>
            )}
          </div>
          <button
            onClick={handleLoadCollective}
            disabled={loadingCollective}
            className="bg-white text-[#1B3A6B] px-4 py-2 rounded-lg text-xs font-bold hover:bg-blue-50 transition-colors disabled:opacity-60 whitespace-nowrap shrink-0"
          >
            {loadingCollective ? 'Carregando...' : collectiveGestures.length > 0 ? 'Atualizar' : 'Carregar'}
          </button>
        </div>
      </div>

      {/* Feedback de importação */}
      {importMsg && (
        <div className={`rounded-lg px-3 py-2.5 text-xs border ${
          importMsg.type === 'ok'
            ? 'bg-green-50 border-green-200 text-green-800'
            : 'bg-red-50 border-red-200 text-red-700'
        }`}>
          {importMsg.text}
        </div>
      )}

      {/* Minhas gravações (Item 1) */}
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wide">Minhas gravações</h3>
        {groupNames.length > 0 && (
          <span className="text-xs text-gray-400">{groupNames.length} gesto(s) · {recs.length} gravação(ões)</span>
        )}
      </div>

      {groupNames.length === 0 ? (
        <div className="text-center py-6 text-gray-400 bg-gray-50 rounded-lg">
          <p className="text-3xl mb-2">🤲</p>
          <p className="text-sm">Você ainda não gravou nenhum gesto.</p>
          <p className="text-xs mt-1">Grave o primeiro na aba Treinar.</p>
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {groupNames.map(nome => {
            const list = groups[nome]
            const isOpen = expanded === nome
            return (
              <li key={nome} className="rounded-lg border border-gray-100 bg-gray-50 overflow-hidden">
                <button
                  onClick={() => setExpanded(isOpen ? null : nome)}
                  className="w-full flex items-center justify-between px-3 py-2.5 hover:bg-gray-100 transition-colors"
                >
                  <span className="font-medium text-gray-800 text-sm">{nome}</span>
                  <span className="flex items-center gap-2">
                    <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full font-semibold">
                      {list.length} gravação{list.length !== 1 ? 'ões' : ''}
                    </span>
                    <span className="text-gray-400 text-xs">{isOpen ? '▲' : '▼'}</span>
                  </span>
                </button>
                {isOpen && (
                  <ul className="border-t border-gray-100 divide-y divide-gray-100">
                    {list.map((r, i) => (
                      <li key={r.id} className="flex items-center justify-between px-3 py-2 bg-white">
                        <div className="min-w-0">
                          <p className="text-xs text-gray-600">
                            #{list.length - i} · {r.n_frames} quadros · mão {Math.round(r.hand_ratio * 100)}%
                            {r.source === 'segmentado' && <span className="ml-1 text-[#2E75B6]">(auto)</span>}
                          </p>
                          <p className="text-xs text-gray-400">{formatDate(r.created_at)}</p>
                        </div>
                        <button
                          onClick={() => handleDeleteRecording(r.id)}
                          className="text-gray-400 hover:text-red-500 transition-colors p-1.5 rounded-md hover:bg-red-50 shrink-0"
                          aria-label={`Excluir gravação de ${nome}`}
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            )
          })}
        </ul>
      )}

      {/* Base coletiva (somente leitura) */}
      {collectiveGestures.length > 0 && (
        <>
          <div className="flex items-center justify-between mt-2 pt-3 border-t border-gray-100">
            <h3 className="text-xs font-bold text-[#2E75B6] uppercase tracking-wide flex items-center gap-1.5">
              🌐 Base coletiva
            </h3>
            <span className="text-xs text-gray-400">{collectiveGestures.length} gesto(s)</span>
          </div>
          <p className="text-xs text-gray-400 -mt-1">
            Letras e gestos de todos os participantes — usados na tradução, não editáveis.
          </p>
          <ul className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {[...collectiveGestures]
              .sort((a, b) => a.name.localeCompare(b.name))
              .map(g => (
                <li
                  key={g.id}
                  className="flex items-center justify-between bg-blue-50/60 border border-blue-100 rounded-lg px-3 py-2"
                >
                  <span className="font-bold text-[#1B3A6B] text-sm truncate">{g.name}</span>
                  <span className="text-xs text-blue-400 font-mono shrink-0 ml-1">{g.sampleCount}</span>
                </li>
              ))}
          </ul>
        </>
      )}
    </div>
  )
}
