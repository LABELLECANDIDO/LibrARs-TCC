import { useState, useEffect } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { api } from '@/lib/api'
import { useAuthStore } from '@/stores/authStore'
import { useGestureStore } from '@/stores/gestureStore'
import { TERMO_VERSAO, CONSENT_LABEL } from '@/lib/consent'

export default function InviteRegister() {
  const { token } = useParams<{ token: string }>()
  const navigate = useNavigate()
  const { setAuth } = useAuthStore()
  const loadFromApi = useGestureStore(s => s.loadFromApi)

  const [valid, setValid] = useState<boolean | null>(null)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [isStudent, setIsStudent] = useState<boolean | null>(null)
  const [hasDisability, setHasDisability] = useState<boolean | null>(null)
  const [sexo, setSexo] = useState('')
  const [faixaEtaria, setFaixaEtaria] = useState('')
  const [nivelSurdez, setNivelSurdez] = useState('')
  const [sabeLibras, setSabeLibras] = useState('')
  const [consent, setConsent] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!token) { setValid(false); return }
    api.auth.validateInvite(token)
      .then(() => setValid(true))
      .catch(() => setValid(false))
  }, [token])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!token) return
    if (isStudent === null || hasDisability === null) {
      setError('Por favor, responda todas as perguntas do perfil.')
      return
    }
    if (!sexo || !faixaEtaria || !nivelSurdez || !sabeLibras) {
      setError('Por favor, responda todas as perguntas do perfil.')
      return
    }
    if (!consent) {
      setError('Para participar, é preciso aceitar o termo de consentimento.')
      return
    }
    setError('')
    setLoading(true)
    try {
      const res = await api.auth.registerInvite(token, {
        email, password, name,
        is_student: isStudent, has_disability: hasDisability,
        sexo, faixa_etaria: faixaEtaria, nivel_surdez: nivelSurdez, sabe_libras: sabeLibras,
        consent: true, consent_version: TERMO_VERSAO,
      })
      setAuth(res.token, res.user)
      loadFromApi().catch(() => null)
      navigate('/dashboard', { replace: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao cadastrar')
    } finally {
      setLoading(false)
    }
  }

  if (valid === null) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <p className="text-gray-500">Validando convite...</p>
      </div>
    )
  }

  if (valid === false) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
        <div className="max-w-md w-full text-center space-y-4">
          <div className="text-5xl">❌</div>
          <h1 className="text-2xl font-bold text-gray-900">Convite inválido</h1>
          <p className="text-gray-600">Este link de convite é inválido ou já expirou. Peça ao administrador um novo link.</p>
          <Link to="/" className="inline-block bg-[#2E75B6] text-white px-6 py-2 rounded-lg font-semibold hover:bg-[#1B3A6B] transition-colors">
            Voltar ao início
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-[#1B3A6B] to-blue-600 px-4">
      <div className="max-w-md w-full bg-white rounded-2xl shadow-2xl p-8">
        <div className="text-center mb-6">
          <div className="text-4xl mb-3">🤝</div>
          <h1 className="text-2xl font-bold text-gray-900">Você foi convidado</h1>
          <p className="text-gray-600 text-sm mt-1">Crie sua conta para começar a contribuir com o LibrARs</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Nome completo</label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="Seu nome"
              required
              className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#2E75B6]"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
              placeholder="seu@email.com"
              className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#2E75B6]"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Senha</label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
              minLength={6}
              placeholder="Mínimo 6 caracteres"
              className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#2E75B6]"
            />
          </div>

          {/* Perguntas de perfil */}
          <div className="border-t border-gray-100 pt-4 space-y-4">
            <p className="text-sm font-semibold text-gray-700">Perfil do participante</p>
            <p className="text-xs text-gray-500 -mt-2">Essas informações ajudam na análise dos dados da pesquisa.</p>

            <div>
              <p className="text-sm font-medium text-gray-700 mb-2">Você é estudante?</p>
              <div className="flex gap-3">
                {([true, false] as const).map(val => (
                  <button
                    key={String(val)}
                    type="button"
                    onClick={() => setIsStudent(val)}
                    className={`flex-1 py-2 rounded-lg border text-sm font-medium transition-colors ${
                      isStudent === val
                        ? 'bg-[#2E75B6] text-white border-[#2E75B6]'
                        : 'bg-white text-gray-600 border-gray-300 hover:border-[#2E75B6]'
                    }`}
                  >
                    {val ? 'Sim' : 'Não'}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <p className="text-sm font-medium text-gray-700 mb-2">Possui alguma deficiência auditiva ou de fala?</p>
              <div className="flex gap-3">
                {([true, false] as const).map(val => (
                  <button
                    key={String(val)}
                    type="button"
                    onClick={() => setHasDisability(val)}
                    className={`flex-1 py-2 rounded-lg border text-sm font-medium transition-colors ${
                      hasDisability === val
                        ? 'bg-[#2E75B6] text-white border-[#2E75B6]'
                        : 'bg-white text-gray-600 border-gray-300 hover:border-[#2E75B6]'
                    }`}
                  >
                    {val ? 'Sim' : 'Não'}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Sexo</label>
              <select
                value={sexo}
                onChange={e => setSexo(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#2E75B6]"
              >
                <option value="" disabled>Selecione…</option>
                <option value="feminino">Feminino</option>
                <option value="masculino">Masculino</option>
                <option value="outro">Outro</option>
                <option value="nao_informar">Prefiro não informar</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Faixa etária</label>
              <select
                value={faixaEtaria}
                onChange={e => setFaixaEtaria(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#2E75B6]"
              >
                <option value="" disabled>Selecione…</option>
                <option value="ate_17">Até 17 anos</option>
                <option value="18_24">18 a 24 anos</option>
                <option value="25_34">25 a 34 anos</option>
                <option value="35_44">35 a 44 anos</option>
                <option value="45_59">45 a 59 anos</option>
                <option value="60_mais">60 anos ou mais</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Nível de surdez</label>
              <select
                value={nivelSurdez}
                onChange={e => setNivelSurdez(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#2E75B6]"
              >
                <option value="" disabled>Selecione…</option>
                <option value="nenhum">Nenhum (ouvinte)</option>
                <option value="leve">Leve</option>
                <option value="moderado">Moderado</option>
                <option value="severo">Severo</option>
                <option value="profundo">Profundo</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Você sabe Libras?</label>
              <select
                value={sabeLibras}
                onChange={e => setSabeLibras(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#2E75B6]"
              >
                <option value="" disabled>Selecione…</option>
                <option value="nao">Não</option>
                <option value="basico">Básico</option>
                <option value="fluente">Fluente</option>
              </select>
            </div>
          </div>

          {/* Consentimento (obrigatório) */}
          <label className="flex items-start gap-3 bg-blue-50 border border-blue-100 rounded-lg px-3 py-3 cursor-pointer">
            <input
              type="checkbox"
              checked={consent}
              onChange={e => setConsent(e.target.checked)}
              className="mt-0.5 w-5 h-5 shrink-0 accent-[#2E75B6]"
            />
            <span className="text-sm text-gray-700">
              {CONSENT_LABEL}.{' '}
              <a
                href="/termo"
                target="_blank"
                rel="noopener noreferrer"
                className="text-[#2E75B6] underline font-medium"
                onClick={e => e.stopPropagation()}
              >
                Ler o termo
              </a>
            </span>
          </label>

          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 text-sm px-3 py-2 rounded-lg">{error}</div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-[#2E75B6] hover:bg-[#1B3A6B] text-white font-semibold py-2.5 rounded-lg transition-colors disabled:opacity-60"
          >
            {loading ? 'Criando conta...' : 'Criar minha conta'}
          </button>
        </form>
      </div>
    </div>
  )
}
