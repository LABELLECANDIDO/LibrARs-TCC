import { useEffect, useState } from 'react'
import { api, type AnalyticsData, type InviteToken } from '@/lib/api'
import { useAuthStore } from '@/stores/authStore'

type Tab = 'users' | 'data' | 'analytics' | 'invites'

interface AdminUser {
  id: string; email: string; name: string; role: string
  is_student: boolean; has_disability: boolean; created_at: string
}
interface Stats { total_users: number; total_gestures: number; total_samples: number }

export default function AdminDashboard() {
  const { user, isAuthenticated } = useAuthStore()
  const [tab, setTab] = useState<Tab>('users')
  const [users, setUsers] = useState<AdminUser[]>([])
  const [stats, setStats] = useState<Stats>({ total_users: 0, total_gestures: 0, total_samples: 0 })
  const [analytics, setAnalytics] = useState<AnalyticsData | null>(null)
  const [invites, setInvites] = useState<InviteToken[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [selectedUser, setSelectedUser] = useState<AdminUser | null>(null)
  const [showRoleModal, setShowRoleModal] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [showResetConfirm, setShowResetConfirm] = useState(false)
  const [actionLoading, setActionLoading] = useState(false)
  const [copiedToken, setCopiedToken] = useState<string | null>(null)
  const [resetLink, setResetLink] = useState<string | null>(null)
  // Zona de perigo — reset da base
  const [resetScope, setResetScope] = useState<'gestures' | 'all' | null>(null)
  const [resetConfirmText, setResetConfirmText] = useState('')
  const [resetResult, setResetResult] = useState<string | null>(null)

  if (isAuthenticated && user?.role !== 'admin') {
    return (
      <div className="max-w-4xl mx-auto px-4 py-10">
        <div className="bg-red-50 border border-red-200 text-red-700 px-6 py-4 rounded-xl text-center">
          <strong>Acesso negado.</strong> Apenas administradores podem acessar este painel.
        </div>
      </div>
    )
  }

  const loadBase = async () => {
    setLoading(true); setError('')
    try {
      const [u, s] = await Promise.all([api.admin.getUsers(), api.admin.getStats()])
      setUsers(u.users); setStats(s)
    } catch (e) { setError(e instanceof Error ? e.message : 'Erro') }
    finally { setLoading(false) }
  }
  const loadAnalytics = async () => {
    if (analytics) return
    try { setAnalytics(await api.admin.getAnalytics()) }
    catch (e) { setError(e instanceof Error ? e.message : 'Erro analytics') }
  }
  const loadInvites = async () => {
    try { setInvites(await api.admin.listInvites()) }
    catch (e) { setError(e instanceof Error ? e.message : 'Erro convites') }
  }

  useEffect(() => { loadBase() }, [])
  useEffect(() => {
    if (tab === 'analytics') loadAnalytics()
    if (tab === 'invites') loadInvites()
  }, [tab])

  const handleRoleChange = async (newRole: string) => {
    if (!selectedUser) return; setActionLoading(true)
    try { await api.admin.updateUserRole(selectedUser.id, newRole as 'user'|'admin'); setShowRoleModal(false); setSelectedUser(null); await loadBase() }
    catch (e) { setError(e instanceof Error ? e.message : 'Erro role') }
    finally { setActionLoading(false) }
  }
  const handleDeleteUser = async () => {
    if (!selectedUser) return; setActionLoading(true)
    try { await api.admin.deleteUser(selectedUser.id); setShowDeleteConfirm(false); setSelectedUser(null); await loadBase() }
    catch (e) { setError(e instanceof Error ? e.message : 'Erro delete') }
    finally { setActionLoading(false) }
  }
  const handleCreateInvite = async () => {
    setActionLoading(true)
    try {
      const res = await api.admin.createInvite()
      const link = `${window.location.origin}/convite/${res.token}`
      await navigator.clipboard.writeText(link)
      setCopiedToken(res.token); setTimeout(() => setCopiedToken(null), 4000)
      await loadInvites()
    } catch (e) { setError(e instanceof Error ? e.message : 'Erro convite') }
    finally { setActionLoading(false) }
  }
  const handleRevokeInvite = async (token: string) => {
    try { await api.admin.revokeInvite(token); await loadInvites() }
    catch (e) { setError(e instanceof Error ? e.message : 'Erro revogar') }
  }
  const handleResetDatabase = async () => {
    if (!resetScope || resetConfirmText !== 'ZERAR') return
    setActionLoading(true); setError('')
    try {
      const res = await api.admin.resetDatabase(resetScope)
      setResetResult(
        res.scope === 'all'
          ? `Base zerada: ${res.gestures_deleted} gestos e ${res.users_deleted} usuário(s) removidos. Só o seu login foi mantido.`
          : `Gestos zerados: ${res.gestures_deleted} removidos. Contas mantidas.`
      )
      setResetScope(null); setResetConfirmText('')
      await loadBase()
    } catch (e) { setError(e instanceof Error ? e.message : 'Erro ao zerar a base') }
    finally { setActionLoading(false) }
  }
  const handleCreateResetLink = async () => {
    if (!selectedUser) return; setActionLoading(true)
    try {
      const res = await api.admin.createResetLink(selectedUser.id)
      const link = `${window.location.origin}/reset/${res.token}`
      setResetLink(link); await navigator.clipboard.writeText(link)
    } catch (e) { setError(e instanceof Error ? e.message : 'Erro reset') }
    finally { setActionLoading(false); setShowResetConfirm(false) }
  }

  const tabs: { key: Tab; label: string; icon: string }[] = [
    { key: 'users',     label: 'Usuários',        icon: '👥' },
    { key: 'data',      label: 'Dados',            icon: '📊' },
    { key: 'analytics', label: 'Analytics',        icon: '📈' },
    { key: 'invites',   label: 'Convites',         icon: '🔗' },
  ]

  return (
    <div className="min-h-screen" style={{ background: 'var(--brand-bg)' }}>
      <div className="max-w-7xl mx-auto px-4 md:px-6 py-6 md:py-8">

        {/* Header */}
        <div className="mb-6 flex flex-col sm:flex-row sm:items-start gap-3 justify-between">
          <div>
            <h1 className="text-2xl md:text-3xl font-extrabold text-[#1B3A6B]">Painel do Administrador</h1>
            <p className="text-gray-500 text-sm mt-1">Gerencie participantes e visualize dados da pesquisa</p>
          </div>
          <button
            onClick={async () => {
              try {
                const data = await api.admin.exportRawDataset()
                const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
                const url = URL.createObjectURL(blob)
                const a = document.createElement('a')
                a.href = url; a.download = `libras-dataset-${new Date().toISOString().slice(0,10)}.json`
                a.click(); URL.revokeObjectURL(url)
              } catch (e) { setError(e instanceof Error ? e.message : 'Erro exportar') }
            }}
            className="bg-[#1B3A6B] text-white px-4 py-2.5 rounded-xl text-sm font-bold hover:bg-[#0F2747] transition-colors whitespace-nowrap self-start"
          >
            ⬇ Exportar dataset
          </button>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-3 md:gap-4 mb-6">
          {[
            { label: 'Participantes', value: stats.total_users, color: '#1B3A6B' },
            { label: 'Gestos únicos', value: stats.total_gestures, color: '#2E75B6' },
            { label: 'Amostras totais', value: stats.total_samples.toLocaleString('pt-BR'), color: '#1E5631' },
          ].map((s, i) => (
            <div key={i} className="bg-white rounded-2xl shadow-sm p-4 md:p-5 border border-gray-100">
              <p className="text-gray-400 text-xs font-medium">{s.label}</p>
              <p className="text-2xl md:text-3xl font-extrabold mt-1" style={{ color: s.color }}>{s.value}</p>
            </div>
          ))}
        </div>

        {/* Alertas */}
        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl mb-4 flex justify-between text-sm">
            <span>{error}</span>
            <button onClick={() => setError('')} className="font-bold ml-3">✕</button>
          </div>
        )}
        {resetLink && (
          <div className="bg-green-50 border border-green-200 text-green-800 px-4 py-3 rounded-xl mb-4 text-sm">
            <p className="font-bold">Link copiado!</p>
            <p className="text-xs font-mono mt-1 break-all">{resetLink}</p>
            <button onClick={() => setResetLink(null)} className="text-xs mt-1 underline">Fechar</button>
          </div>
        )}
        {copiedToken && (
          <div className="bg-blue-50 border border-blue-200 text-blue-800 px-4 py-3 rounded-xl mb-4 text-sm">
            <p className="font-bold">Convite copiado!</p>
            <p className="text-xs font-mono mt-1 break-all">{`${window.location.origin}/convite/${copiedToken}`}</p>
          </div>
        )}

        {/* Tabs — scroll horizontal em mobile */}
        <div className="overflow-x-auto -mx-4 px-4 md:mx-0 md:px-0 mb-5">
          <div className="flex gap-1 border-b border-gray-200 min-w-max md:min-w-0">
            {tabs.map(t => (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-semibold border-b-2 transition-colors whitespace-nowrap ${
                  tab === t.key
                    ? 'border-[#2E75B6] text-[#2E75B6]'
                    : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
              >
                <span>{t.icon}</span>
                {t.label}
              </button>
            ))}
          </div>
        </div>

        {/* ── TAB: Usuários ── */}
        {tab === 'users' && (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-50">
              <h2 className="font-bold text-gray-900 text-sm">Lista de participantes</h2>
            </div>
            {loading ? (
              <div className="px-5 py-10 text-center text-gray-400 text-sm">Carregando...</div>
            ) : (
              <>
                {/* Desktop table */}
                <div className="hidden md:block overflow-x-auto">
                  <table className="w-full">
                    <thead className="bg-gray-50 border-b border-gray-100">
                      <tr>
                        {['Nome', 'Email', 'Papel', 'Estudante', 'Def. auditiva', 'Cadastro', 'Ações'].map(h => (
                          <th key={h} className={`px-5 py-3 text-xs font-semibold text-gray-500 uppercase ${h === 'Ações' ? 'text-right' : 'text-left'}`}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {users.map(u => (
                        <tr key={u.id} className="border-b border-gray-50 hover:bg-gray-50 transition-colors">
                          <td className="px-5 py-3.5 text-sm font-semibold text-gray-900">{u.name}</td>
                          <td className="px-5 py-3.5 text-sm text-gray-500">{u.email}</td>
                          <td className="px-5 py-3.5">
                            <span className={`px-2.5 py-1 rounded-full text-xs font-bold ${u.role === 'admin' ? 'bg-red-100 text-red-700' : 'bg-blue-100 text-blue-700'}`}>
                              {u.role === 'admin' ? 'Admin' : 'Participante'}
                            </span>
                          </td>
                          <td className="px-5 py-3.5 text-center text-xs">
                            {u.is_student ? <span className="px-2 py-0.5 bg-green-100 text-green-700 rounded-full font-bold">Sim</span> : <span className="text-gray-300">—</span>}
                          </td>
                          <td className="px-5 py-3.5 text-center text-xs">
                            {u.has_disability ? <span className="px-2 py-0.5 bg-purple-100 text-purple-700 rounded-full font-bold">Sim</span> : <span className="text-gray-300">—</span>}
                          </td>
                          <td className="px-5 py-3.5 text-xs text-gray-400">{new Date(u.created_at).toLocaleDateString('pt-BR')}</td>
                          <td className="px-5 py-3.5 text-right space-x-2 text-xs font-semibold">
                            <button onClick={() => { setSelectedUser(u); setShowResetConfirm(true) }} className="text-amber-600 hover:text-amber-800">Reset senha</button>
                            <button onClick={() => { setSelectedUser(u); setShowRoleModal(true) }} className="text-blue-600 hover:text-blue-800">Papel</button>
                            <button onClick={() => { setSelectedUser(u); setShowDeleteConfirm(true) }} disabled={user?.id === u.id} className="text-red-500 hover:text-red-700 disabled:opacity-30">Deletar</button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Mobile cards */}
                <div className="md:hidden divide-y divide-gray-50">
                  {users.map(u => (
                    <div key={u.id} className="p-4 space-y-3">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <p className="font-bold text-gray-900 text-sm">{u.name}</p>
                          <p className="text-xs text-gray-500 mt-0.5">{u.email}</p>
                        </div>
                        <span className={`px-2.5 py-1 rounded-full text-xs font-bold shrink-0 ${u.role === 'admin' ? 'bg-red-100 text-red-700' : 'bg-blue-100 text-blue-700'}`}>
                          {u.role === 'admin' ? 'Admin' : 'Participante'}
                        </span>
                      </div>
                      <div className="flex gap-2 flex-wrap">
                        {u.is_student && <span className="px-2 py-0.5 bg-green-100 text-green-700 rounded-full text-xs font-bold">Estudante</span>}
                        {u.has_disability && <span className="px-2 py-0.5 bg-purple-100 text-purple-700 rounded-full text-xs font-bold">Def. auditiva</span>}
                        <span className="text-xs text-gray-400">{new Date(u.created_at).toLocaleDateString('pt-BR')}</span>
                      </div>
                      <div className="flex gap-2">
                        <button onClick={() => { setSelectedUser(u); setShowResetConfirm(true) }} className="flex-1 py-2 text-xs font-bold text-amber-700 bg-amber-50 hover:bg-amber-100 rounded-lg transition-colors">Reset senha</button>
                        <button onClick={() => { setSelectedUser(u); setShowRoleModal(true) }} className="flex-1 py-2 text-xs font-bold text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-lg transition-colors">Papel</button>
                        <button onClick={() => { setSelectedUser(u); setShowDeleteConfirm(true) }} disabled={user?.id === u.id} className="flex-1 py-2 text-xs font-bold text-red-600 bg-red-50 hover:bg-red-100 rounded-lg transition-colors disabled:opacity-30">Deletar</button>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        )}

        {/* ── TAB: Dados ── */}
        {tab === 'data' && <DataTab />}

        {/* ── TAB: Analytics ── */}
        {tab === 'analytics' && <AnalyticsTab analytics={analytics} />}

        {/* ── TAB: Convites ── */}
        {tab === 'invites' && (
          <div className="space-y-4">
            <div className="flex flex-col sm:flex-row gap-3 justify-between">
              <div>
                <h2 className="font-bold text-gray-900 text-sm">Convites de acesso</h2>
                <p className="text-xs text-gray-500 mt-0.5">Link expira em 7 dias após gerado.</p>
              </div>
              <button
                onClick={handleCreateInvite}
                disabled={actionLoading}
                className="bg-[#2E75B6] text-white px-5 py-2.5 rounded-xl font-bold hover:bg-[#1B3A6B] transition-colors disabled:opacity-60 text-sm self-start"
              >
                + Gerar convite
              </button>
            </div>

            {/* Desktop */}
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden hidden md:block">
              {invites.length === 0 ? (
                <div className="px-5 py-10 text-center text-gray-400 text-sm">Nenhum convite criado</div>
              ) : (
                <table className="w-full">
                  <thead className="bg-gray-50 border-b border-gray-100">
                    <tr>
                      {['Status', 'Usado por', 'Expira em', 'Ações'].map(h => (
                        <th key={h} className="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {invites.map(inv => {
                      const expired = !inv.used_at && new Date(inv.expires_at) < new Date()
                      const active = !inv.used_at && !expired
                      return (
                        <tr key={inv.token} className="border-b border-gray-50 hover:bg-gray-50">
                          <td className="px-5 py-3.5 text-xs">
                            {inv.used_at ? <span className="px-2.5 py-1 bg-green-100 text-green-700 rounded-full font-bold">Usado</span>
                              : expired ? <span className="px-2.5 py-1 bg-gray-100 text-gray-500 rounded-full font-bold">Expirado</span>
                              : <span className="px-2.5 py-1 bg-blue-100 text-blue-700 rounded-full font-bold">Ativo</span>}
                          </td>
                          <td className="px-5 py-3.5 text-sm text-gray-600">{inv.used_by_name ? `${inv.used_by_name}` : '—'}</td>
                          <td className="px-5 py-3.5 text-xs text-gray-400">{new Date(inv.expires_at).toLocaleString('pt-BR')}</td>
                          <td className="px-5 py-3.5 text-xs space-x-2 font-semibold">
                            {active && <>
                              <button onClick={() => { navigator.clipboard.writeText(`${window.location.origin}/convite/${inv.token}`); setCopiedToken(inv.token); setTimeout(() => setCopiedToken(null), 3000) }} className="text-blue-600 hover:text-blue-800">Copiar</button>
                              <button onClick={() => handleRevokeInvite(inv.token)} className="text-red-500 hover:text-red-700">Revogar</button>
                            </>}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              )}
            </div>

            {/* Mobile */}
            <div className="md:hidden space-y-3">
              {invites.map(inv => {
                const expired = !inv.used_at && new Date(inv.expires_at) < new Date()
                const active = !inv.used_at && !expired
                return (
                  <div key={inv.token} className="bg-white rounded-2xl border border-gray-100 p-4 shadow-sm space-y-3">
                    <div className="flex items-center justify-between">
                      <span className={`px-2.5 py-1 rounded-full text-xs font-bold ${
                        inv.used_at ? 'bg-green-100 text-green-700' : expired ? 'bg-gray-100 text-gray-500' : 'bg-blue-100 text-blue-700'
                      }`}>
                        {inv.used_at ? 'Usado' : expired ? 'Expirado' : 'Ativo'}
                      </span>
                      <span className="text-xs text-gray-400">{new Date(inv.expires_at).toLocaleDateString('pt-BR')}</span>
                    </div>
                    {inv.used_by_name && <p className="text-xs text-gray-600">Usado por: <strong>{inv.used_by_name}</strong></p>}
                    {active && (
                      <div className="flex gap-2">
                        <button
                          onClick={() => { navigator.clipboard.writeText(`${window.location.origin}/convite/${inv.token}`); setCopiedToken(inv.token); setTimeout(() => setCopiedToken(null), 3000) }}
                          className="flex-1 py-2 text-xs font-bold text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-lg transition-colors"
                        >Copiar link</button>
                        <button
                          onClick={() => handleRevokeInvite(inv.token)}
                          className="flex-1 py-2 text-xs font-bold text-red-600 bg-red-50 hover:bg-red-100 rounded-lg transition-colors"
                        >Revogar</button>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        )}
        {/* ── Zona de perigo (discreta) ── */}
        <div className="mt-8 flex flex-wrap items-center gap-2 text-xs text-gray-400">
          <span>Zona de perigo:</span>
          <button
            onClick={() => { setResetScope('gestures'); setResetConfirmText('') }}
            title="Apaga todos os gestos; mantém as contas"
            className="px-2.5 py-1 rounded-md border border-gray-200 text-amber-600 hover:bg-amber-50 transition-colors"
          >
            Zerar gestos
          </button>
          <button
            onClick={() => { setResetScope('all'); setResetConfirmText('') }}
            title="Apaga gestos, convites e outros usuários; mantém só o seu login"
            className="px-2.5 py-1 rounded-md border border-gray-200 text-red-500 hover:bg-red-50 transition-colors"
          >
            Zerar tudo
          </button>
        </div>

        {resetResult && (
          <div className="mt-4 bg-green-50 border border-green-200 text-green-800 px-4 py-3 rounded-xl text-sm flex justify-between">
            <span>✓ {resetResult}</span>
            <button onClick={() => setResetResult(null)} className="font-bold ml-3">✕</button>
          </div>
        )}
      </div>

      {/* Modais */}
      {resetScope && (
        <Modal onClose={() => { setResetScope(null); setResetConfirmText('') }}>
          <h3 className="font-bold text-red-700 mb-1">
            {resetScope === 'all' ? 'Zerar TUDO' : 'Zerar os gestos'}
          </h3>
          <p className="text-sm text-gray-600 mb-3">
            {resetScope === 'all'
              ? 'Isso apaga todos os gestos, convites e usuários — exceto o seu login. Não há como desfazer.'
              : 'Isso apaga todos os gestos e amostras de todos os participantes. As contas são mantidas. Não há como desfazer.'}
          </p>
          <label className="block text-xs font-semibold text-gray-500 mb-1">
            Digite <span className="font-mono font-bold text-red-600">ZERAR</span> para confirmar
          </label>
          <input
            value={resetConfirmText}
            onChange={e => setResetConfirmText(e.target.value.toUpperCase())}
            placeholder="ZERAR"
            className="w-full border border-gray-300 rounded-xl px-3 py-2.5 text-sm font-mono tracking-widest mb-4 focus:outline-none focus:ring-2 focus:ring-red-500"
          />
          <div className="flex gap-2">
            <button onClick={() => { setResetScope(null); setResetConfirmText('') }} className="flex-1 py-2.5 bg-gray-100 rounded-xl text-sm font-bold text-gray-700 hover:bg-gray-200">Cancelar</button>
            <button
              onClick={handleResetDatabase}
              disabled={actionLoading || resetConfirmText !== 'ZERAR'}
              className="flex-1 py-2.5 bg-red-600 rounded-xl text-sm font-bold text-white hover:bg-red-700 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {actionLoading ? 'Zerando...' : 'Confirmar reset'}
            </button>
          </div>
        </Modal>
      )}
      {showRoleModal && selectedUser && (
        <Modal onClose={() => setShowRoleModal(false)}>
          <h3 className="font-bold text-gray-900 mb-1">Alterar papel</h3>
          <p className="text-sm text-gray-500 mb-4">{selectedUser.name} · {selectedUser.email}</p>
          <div className="space-y-2">
            <button onClick={() => handleRoleChange('admin')} disabled={actionLoading || selectedUser.role === 'admin'} className="w-full py-2.5 rounded-xl font-bold text-sm bg-red-50 text-red-700 hover:bg-red-100 disabled:opacity-40">Tornar Admin</button>
            <button onClick={() => handleRoleChange('user')} disabled={actionLoading || selectedUser.role === 'user'} className="w-full py-2.5 rounded-xl font-bold text-sm bg-blue-50 text-blue-700 hover:bg-blue-100 disabled:opacity-40">Tornar Participante</button>
          </div>
        </Modal>
      )}
      {showDeleteConfirm && selectedUser && (
        <Modal onClose={() => setShowDeleteConfirm(false)}>
          <h3 className="font-bold text-gray-900 mb-1">Confirmar exclusão</h3>
          <p className="text-sm text-gray-500 mb-4">Deletar <strong>{selectedUser.name}</strong>? Todos os gestos e amostras serão perdidos.</p>
          <div className="flex gap-2">
            <button onClick={() => setShowDeleteConfirm(false)} className="flex-1 py-2.5 bg-gray-100 rounded-xl text-sm font-bold text-gray-700 hover:bg-gray-200">Cancelar</button>
            <button onClick={handleDeleteUser} disabled={actionLoading} className="flex-1 py-2.5 bg-red-600 rounded-xl text-sm font-bold text-white hover:bg-red-700 disabled:opacity-60">
              {actionLoading ? 'Deletando...' : 'Deletar'}
            </button>
          </div>
        </Modal>
      )}
      {showResetConfirm && selectedUser && (
        <Modal onClose={() => setShowResetConfirm(false)}>
          <h3 className="font-bold text-gray-900 mb-1">Gerar link de reset</h3>
          <p className="text-sm text-gray-500 mb-4">Gerar link para <strong>{selectedUser.name}</strong> redefinir a senha? O link expira em 24h e será copiado automaticamente.</p>
          <div className="flex gap-2">
            <button onClick={() => setShowResetConfirm(false)} className="flex-1 py-2.5 bg-gray-100 rounded-xl text-sm font-bold text-gray-700 hover:bg-gray-200">Cancelar</button>
            <button onClick={handleCreateResetLink} disabled={actionLoading} className="flex-1 py-2.5 bg-amber-600 rounded-xl text-sm font-bold text-white hover:bg-amber-700 disabled:opacity-60">
              {actionLoading ? 'Gerando...' : 'Gerar link'}
            </button>
          </div>
        </Modal>
      )}
    </div>
  )
}

function Modal({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 animate-fade-in-scale" onClick={e => e.stopPropagation()}>
        {children}
      </div>
    </div>
  )
}

function DataTab() {
  const [data, setData] = useState<AnalyticsData | null>(null)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')

  useEffect(() => { api.admin.getAnalytics().then(setData).finally(() => setLoading(false)) }, [])

  if (loading) return <div className="text-center py-10 text-gray-400 text-sm">Carregando dados...</div>
  if (!data) return null

  const filtered = data.all_gestures.filter(g =>
    g.name.toLowerCase().includes(search.toLowerCase()) ||
    g.user_name.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center">
        <input
          type="text"
          placeholder="Filtrar por gesto ou participante..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="border border-gray-200 rounded-xl px-4 py-2.5 text-sm w-full sm:max-w-xs focus:outline-none focus:ring-2 focus:ring-[#2E75B6] bg-white"
        />
        <span className="text-xs text-gray-400">{filtered.length} registro(s)</span>
      </div>

      {/* Desktop */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden hidden md:block">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50 border-b border-gray-100">
              <tr>
                {['Gesto', 'Participante', 'Amostras', 'Atualizado'].map(h => (
                  <th key={h} className="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map(g => (
                <tr key={g.id} className="border-b border-gray-50 hover:bg-gray-50">
                  <td className="px-5 py-3 text-sm font-bold text-gray-900">{g.name}</td>
                  <td className="px-5 py-3 text-sm text-gray-600">{g.user_name}</td>
                  <td className="px-5 py-3 text-sm font-mono font-bold text-[#1B3A6B]">{g.sample_count}</td>
                  <td className="px-5 py-3 text-xs text-gray-400">{new Date(g.updated_at).toLocaleString('pt-BR')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Mobile cards */}
      <div className="md:hidden space-y-2">
        {filtered.map(g => (
          <div key={g.id} className="bg-white rounded-2xl border border-gray-100 px-4 py-3 flex items-center justify-between shadow-sm">
            <div>
              <p className="text-sm font-bold text-gray-900">{g.name}</p>
              <p className="text-xs text-gray-500 mt-0.5">{g.user_name}</p>
            </div>
            <span className="text-sm font-extrabold text-[#1B3A6B] bg-blue-50 px-2.5 py-1 rounded-lg">{g.sample_count}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function AnalyticsTab({ analytics }: { analytics: AnalyticsData | null }) {
  if (!analytics) return <div className="text-center py-10 text-gray-400 text-sm">Carregando analytics...</div>

  const maxSamples = Math.max(...analytics.top_gestures.map(g => g.total_samples), 1)
  const maxUserSamples = Math.max(...analytics.user_stats.map(u => u.total_samples), 1)

  return (
    <div className="space-y-6">
      {/* Contribuição por participante */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5 md:p-6">
        <h3 className="font-bold text-gray-900 mb-4 text-sm md:text-base">Contribuição por participante</h3>
        <div className="space-y-4">
          {analytics.user_stats.map(u => (
            <div key={u.id}>
              <div className="flex items-center justify-between mb-1 gap-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="text-sm font-semibold text-gray-800 truncate">{u.name}</span>
                    {u.is_student && <span className="text-xs bg-blue-50 text-blue-700 px-1.5 py-0.5 rounded font-bold">estudante</span>}
                    {u.has_disability && <span className="text-xs bg-purple-50 text-purple-700 px-1.5 py-0.5 rounded font-bold">def. auditiva</span>}
                  </div>
                </div>
                <div className="text-right shrink-0 text-xs text-gray-500">
                  <span className="font-bold text-[#1B3A6B]">{u.total_samples.toLocaleString('pt-BR')}</span> amostras · {u.gesture_count} gestos
                </div>
              </div>
              <div className="w-full bg-gray-100 rounded-full h-3 overflow-hidden">
                <div className="bg-[#2E75B6] h-3 rounded-full transition-all" style={{ width: `${(u.total_samples / maxUserSamples) * 100}%` }} />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Top gestos */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5 md:p-6">
        <h3 className="font-bold text-gray-900 mb-4 text-sm md:text-base">Gestos mais coletados</h3>
        <div className="space-y-3">
          {analytics.top_gestures.map((g, idx) => (
            <div key={g.name} className="flex items-center gap-3">
              <span className="text-xs text-gray-400 w-5 text-center shrink-0">#{idx+1}</span>
              <span className="text-sm font-bold text-gray-900 w-20 md:w-32 truncate shrink-0">{g.name}</span>
              <div className="flex-1 bg-gray-100 rounded-full h-3 overflow-hidden">
                <div className="bg-[#1E5631] h-3 rounded-full" style={{ width: `${(g.total_samples / maxSamples) * 100}%` }} />
              </div>
              <span className="text-xs text-gray-500 shrink-0 w-20 text-right">{g.total_samples.toLocaleString('pt-BR')}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Timeline */}
      {analytics.timeline.length > 0 && (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5 md:p-6">
          <h3 className="font-bold text-gray-900 mb-4 text-sm md:text-base">Histórico de coleta (semanal)</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-xs min-w-[400px]">
              <thead className="border-b border-gray-100">
                <tr className="text-gray-400 uppercase">
                  <th className="pb-2 text-left font-semibold">Semana</th>
                  <th className="pb-2 text-right font-semibold">Participantes</th>
                  <th className="pb-2 text-right font-semibold">Gestos</th>
                  <th className="pb-2 text-right font-semibold">Amostras</th>
                </tr>
              </thead>
              <tbody>
                {[...analytics.timeline].reverse().map(t => (
                  <tr key={t.week} className="border-b border-gray-50">
                    <td className="py-2 text-gray-600">{new Date(t.week).toLocaleDateString('pt-BR')}</td>
                    <td className="py-2 text-right text-gray-600">{t.active_users}</td>
                    <td className="py-2 text-right text-gray-600">{t.gestures_added}</td>
                    <td className="py-2 text-right font-bold text-[#1B3A6B]">{t.samples_added.toLocaleString('pt-BR')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
