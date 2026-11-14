import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { GestureEntry } from '@/types'
import { generateId } from '@/lib/utils'
import { api } from '@/lib/api'
import { APP_VERSION } from '@/lib/consent'

interface GestureStore {
  gestures: GestureEntry[]
  pendingSync: boolean  // true se há algum gesto com erro de sync
  collectiveGestures: GestureEntry[]  // base coletiva (todos os participantes) — só p/ classificação, não persiste

  addGesture: (name: string, samples: number[][]) => Promise<GestureEntry>
  addRecording: (name: string, frames: number[][], handRatio: number) => Promise<void>
  updateGesture: (id: string, updates: Partial<GestureEntry>) => void
  deleteGesture: (id: string) => Promise<void>
  retrySync: (id: string) => Promise<void>
  clearAll: () => void
  exportAsJson: () => string
  importFromJson: (json: string) => void

  loadFromApi: () => Promise<void>
  loadCollectiveDataset: () => Promise<number>  // retorna nº de letras carregadas
  mergeFromApi: (apiGestures: { id: string; name: string; samples: number[][];
    temporal_features?: number[]; sample_count: number; created_at: string; updated_at?: string }[]) => void
}

function isAuthed(): boolean {
  return !!localStorage.getItem('libras-ar-token')
}

export const useGestureStore = create<GestureStore>()(
  persist(
    (set, get) => ({
      gestures: [],
      pendingSync: false,
      collectiveGestures: [],

      // ── addGesture ──────────────────────────────────────────────────────────
      // Salva localmente como 'syncing', envia para API e confirma.
      // Lança erro se a API falhar — o chamador deve tratar.
      addGesture: async (name, samples) => {
        const id = generateId()
        const now = new Date().toISOString()
        const entry: GestureEntry = {
          id,
          name,
          samples,
          sampleCount: samples.length,
          createdAt: now,
          updatedAt: now,
          isPublic: false,
          syncStatus: 'syncing',
        }

        // Salva localmente imediatamente (backup local)
        set(state => ({ gestures: [...state.gestures, entry] }))

        if (!isAuthed()) return entry

        try {
          const saved = await api.gestures.upsert({ id, name, samples })
          // Atualiza com o ID, amostras e vetor temporal confirmados pelo servidor
          set(state => ({
            gestures: state.gestures.map(g =>
              g.id === id
                ? {
                    ...g,
                    id: saved.id,
                    samples: saved.samples,
                    temporalVectors: saved.temporal_features ? [saved.temporal_features] : undefined,
                    sampleCount: saved.sample_count,
                    syncStatus: 'synced',
                  }
                : g
            ),
            pendingSync: state.gestures.some(g => g.id !== id && g.syncStatus === 'error'),
          }))
          return { ...entry, id: saved.id, syncStatus: 'synced' }
        } catch (err) {
          // Marca como erro — dado fica no localStorage, usuário é avisado
          set(state => ({
            gestures: state.gestures.map(g =>
              g.id === id ? { ...g, syncStatus: 'error' } : g
            ),
            pendingSync: true,
          }))
          throw new Error('Dado salvo localmente, mas falhou ao enviar ao servidor. Tente novamente.')
        }
      },

      // ── addRecording (Item 1) ───────────────────────────────────────────────
      // Cada repetição vira uma gravação no backend (append-only). O backend
      // devolve sampled+temporal, que guardamos localmente para o classificador
      // reconhecer o gesto imediatamente, sem recarregar a base coletiva.
      addRecording: async (name, frames, handRatio) => {
        const saved = await api.gestures.createRecording(name, {
          frames,
          body: null,
          hand_ratio: handRatio,
          pose_ratio: 0,
          source: 'manual',
          app_version: APP_VERSION,
        })
        const now = new Date().toISOString()
        const entry: GestureEntry = {
          id: saved.id,
          name,
          samples: saved.sampled,
          temporalVectors: saved.temporal ? [saved.temporal] : undefined,
          sampleCount: saved.sampled_count,
          createdAt: saved.created_at || now,
          updatedAt: saved.created_at || now,
          isPublic: false,
          syncStatus: 'synced',
        }
        set(state => ({ gestures: [...state.gestures, entry] }))
      },

      // ── retrySync — reenvia gestos com erro ─────────────────────────────────
      retrySync: async (id) => {
        const gesture = get().gestures.find(g => g.id === id)
        if (!gesture || !isAuthed()) return

        set(state => ({
          gestures: state.gestures.map(g => g.id === id ? { ...g, syncStatus: 'syncing' } : g),
        }))

        try {
          const saved = await api.gestures.upsert({ id, name: gesture.name, samples: gesture.samples })
          set(state => ({
            gestures: state.gestures.map(g =>
              g.id === id ? { ...g, id: saved.id, syncStatus: 'synced' } : g
            ),
            pendingSync: state.gestures.some(g => g.id !== id && g.syncStatus === 'error'),
          }))
        } catch {
          set(state => ({
            gestures: state.gestures.map(g => g.id === id ? { ...g, syncStatus: 'error' } : g),
          }))
        }
      },

      // ── updateGesture ───────────────────────────────────────────────────────
      updateGesture: (id, updates) => {
        set(state => ({
          gestures: state.gestures.map(g =>
            g.id === id ? { ...g, ...updates, updatedAt: new Date().toISOString() } : g
          ),
        }))
      },

      // ── deleteGesture ───────────────────────────────────────────────────────
      deleteGesture: async (id) => {
        set(state => ({ gestures: state.gestures.filter(g => g.id !== id) }))
        if (isAuthed()) {
          api.gestures.delete(id).catch(e => console.warn('[gestureStore] delete failed:', e))
        }
      },

      // ── clearAll ────────────────────────────────────────────────────────────
      clearAll: () => set({ gestures: [], pendingSync: false }),

      // ── exportAsJson ────────────────────────────────────────────────────────
      exportAsJson: () => JSON.stringify(get().gestures, null, 2),

      // ── importFromJson ──────────────────────────────────────────────────────
      // Aceita dois formatos:
      //  1. Biblioteca pessoal: GestureEntry[] { id, name, samples, createdAt... }
      //  2. Dataset da pesquisa (admin): [{ gesture_name, samples, participant... }]
      // Em ambos, gestos com o MESMO nome são agregados (samples combinados),
      // para que a tradução reconheça as letras treinadas por todos.
      importFromJson: (json) => {
        try {
          const parsed = JSON.parse(json)
          if (!Array.isArray(parsed)) throw new Error('Formato inválido')

          // Normaliza cada item para { name, samples } independente do formato
          const byName = new Map<string, number[][]>()
          for (const item of parsed as Array<Record<string, unknown>>) {
            const name = String(item.name ?? item.gesture_name ?? '').trim().toUpperCase()
            const samples = item.samples
            if (!name || !Array.isArray(samples) || samples.length === 0) continue
            const valid = (samples as unknown[]).filter(
              s => Array.isArray(s) && s.length === 63
            ) as number[][]
            if (valid.length === 0) continue
            const acc = byName.get(name) ?? []
            byName.set(name, [...acc, ...valid])
          }

          if (byName.size === 0) throw new Error('Nenhum gesto válido encontrado')

          set(state => {
            const localByName = new Map(state.gestures.map(g => [g.name, g]))
            for (const [name, newSamples] of byName) {
              const existing = localByName.get(name)
              if (existing) {
                // Agrega samples ao gesto existente de mesmo nome
                localByName.set(name, {
                  ...existing,
                  samples: [...existing.samples, ...newSamples],
                  sampleCount: existing.samples.length + newSamples.length,
                  updatedAt: new Date().toISOString(),
                  syncStatus: 'syncing',
                })
              } else {
                const now = new Date().toISOString()
                localByName.set(name, {
                  id: generateId(),
                  name,
                  samples: newSamples,
                  sampleCount: newSamples.length,
                  createdAt: now,
                  updatedAt: now,
                  isPublic: false,
                  syncStatus: 'syncing',
                })
              }
            }
            return { gestures: Array.from(localByName.values()) }
          })

          // Sincroniza tudo com o servidor (upsert por nome)
          if (isAuthed()) {
            for (const g of get().gestures) {
              if (byName.has(g.name)) {
                api.gestures
                  .upsert({ id: g.id, name: g.name, samples: g.samples })
                  .then(() => get().updateGesture(g.id, { syncStatus: 'synced' }))
                  .catch(() => get().updateGesture(g.id, { syncStatus: 'error' }))
              }
            }
          }
        } catch (e) {
          console.error('[gestureStore] importFromJson failed:', e)
          throw e instanceof Error ? e : new Error('Falha ao importar')
        }
      },

      // ── loadFromApi ─────────────────────────────────────────────────────────
      // Deve ser chamado logo após o login para sincronizar dados do servidor.
      loadFromApi: async () => {
        if (!isAuthed()) return
        try {
          const remote = await api.gestures.list()
          get().mergeFromApi(remote)
        } catch (e) {
          console.warn('[gestureStore] loadFromApi failed:', e)
        }
      },

      // ── loadCollectiveDataset ───────────────────────────────────────────────
      // Carrega as letras de TODOS os participantes (em memória, só para a
      // tradução reconhecer). Não persiste e não sincroniza de volta.
      loadCollectiveDataset: async () => {
        if (!isAuthed()) return 0
        const data = await api.gestures.collectiveDataset()
        const now = new Date().toISOString()
        const collective: GestureEntry[] = data.map(d => ({
          id: `collective-${d.name}`,
          name: d.name,
          samples: d.samples,
          temporalVectors: d.temporal_vectors ?? [],
          sampleCount: d.samples.length,
          createdAt: now,
          updatedAt: now,
          isPublic: true,
          syncStatus: 'synced',
        }))
        set({ collectiveGestures: collective })
        return collective.length
      },

      // ── mergeFromApi ────────────────────────────────────────────────────────
      // O servidor tem prioridade quando o dado é mais recente (por updatedAt).
      // Isso garante que trocar de dispositivo não perde dados do banco.
      mergeFromApi: (apiGestures) => {
        set(state => {
          const localMap = new Map(state.gestures.map(g => [g.id, g]))

          for (const ag of apiGestures) {
            const existing = localMap.get(ag.id)
            const temporalVectors = ag.temporal_features ? [ag.temporal_features] : undefined
            if (!existing) {
              // Gesto existe no banco mas não localmente — adiciona
              localMap.set(ag.id, {
                id: ag.id,
                name: ag.name,
                samples: ag.samples,
                temporalVectors,
                sampleCount: ag.sample_count,
                createdAt: ag.created_at,
                updatedAt: ag.updated_at ?? ag.created_at,
                isPublic: false,
                syncStatus: 'synced',
              })
            } else {
              // Existe nos dois — usa o mais recente
              const serverTime = new Date(ag.updated_at ?? ag.created_at).getTime()
              const localTime = new Date(existing.updatedAt).getTime()
              if (serverTime > localTime) {
                localMap.set(ag.id, {
                  ...existing,
                  samples: ag.samples,
                  temporalVectors,
                  sampleCount: ag.sample_count,
                  updatedAt: ag.updated_at ?? ag.created_at,
                  syncStatus: 'synced',
                })
              } else {
                // Local é mais recente — marca como synced se não tiver erro
                if (existing.syncStatus !== 'error') {
                  localMap.set(ag.id, { ...existing, syncStatus: 'synced' })
                }
              }
            }
          }

          const merged = Array.from(localMap.values())
          return {
            gestures: merged,
            pendingSync: merged.some(g => g.syncStatus === 'error'),
          }
        })
      },
    }),
    {
      name: 'libras-ar-gestures',
      version: 2,
      // Persiste apenas os gestos do usuário — a base coletiva fica só em memória
      partialize: (s) => ({ gestures: s.gestures }),
      // Limpa gestos corrompidos (ex: importações antigas sem nome/samples válidos)
      migrate: (persisted) => {
        const p = persisted as { gestures?: unknown[] } | undefined
        if (p && Array.isArray(p.gestures)) {
          p.gestures = p.gestures
            .filter((g): g is GestureEntry => {
              const x = g as Partial<GestureEntry>
              return (
                !!x &&
                typeof x.name === 'string' &&
                x.name.trim().length > 0 &&
                Array.isArray(x.samples) &&
                x.samples.length > 0
              )
            })
            .map(g => ({
              ...g,
              id: g.id || generateId(),
              sampleCount: g.sampleCount ?? g.samples.length,
              createdAt: g.createdAt || new Date().toISOString(),
              updatedAt: g.updatedAt || g.createdAt || new Date().toISOString(),
            }))
        }
        return p as { gestures: GestureEntry[] }
      },
    }
  )
)
