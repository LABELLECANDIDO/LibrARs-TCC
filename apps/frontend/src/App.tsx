import { useState } from 'react'
import { BrowserRouter, Routes, Route, NavLink, useLocation, Navigate, Link } from 'react-router-dom'
import Landing from '@/pages/Landing'
import Dashboard from '@/pages/Dashboard'
import Translate from '@/pages/Translate'
import Train from '@/pages/Train'
import Library from '@/pages/Library'
import Call from '@/pages/Call'
import AdminDashboard from '@/pages/AdminDashboard'
import InviteRegister from '@/pages/InviteRegister'
import ResetPassword from '@/pages/ResetPassword'
import Termo from '@/pages/Termo'
import { useAuthStore } from '@/stores/authStore'
import './index.css'

// ── Logo com tratamento de marca ──────────────────────────────────────────────
function BrandLogo({ size = 'md' }: { size?: 'sm' | 'md' | 'lg' }) {
  const cls = size === 'lg' ? 'text-3xl' : size === 'sm' ? 'text-base' : 'text-xl'
  return (
    <span className={`font-extrabold tracking-tight ${cls}`}>
      <span style={{ color: 'var(--brand-navy)' }}>Libr</span>
      <span style={{ color: 'var(--brand-blue)' }}>AR</span>
      <span style={{ color: 'var(--brand-navy)' }}>s</span>
    </span>
  )
}

const appNavItems = [
  { to: '/traduzir', label: 'Traduzir', icon: '🎯' },
  { to: '/treinar',  label: 'Treinar',  icon: '🏋️' },
  { to: '/biblioteca', label: 'Biblioteca', icon: '📚' },
  { to: '/chamada',  label: 'Chamada',  icon: '📞' },
]

// ── Navbar autenticada ────────────────────────────────────────────────────────
function AuthNav() {
  const { user, clearAuth } = useAuthStore()
  const [open, setOpen] = useState(false)

  return (
    <header className="bg-white border-b border-gray-200 sticky top-0 z-50 shadow-sm">
      <div className="max-w-6xl mx-auto px-4 md:px-8 py-3 flex items-center justify-between">
        <Link to="/dashboard" onClick={() => setOpen(false)}>
          <BrandLogo />
        </Link>

        {/* Desktop nav */}
        <nav className="hidden md:flex gap-1 text-sm items-center">
          {appNavItems.map(item => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                `px-3 py-1.5 rounded-md transition-colors font-medium ${
                  isActive
                    ? 'bg-blue-50 text-[#2E75B6]'
                    : 'text-gray-600 hover:bg-gray-100'
                }`
              }
            >
              {item.label}
            </NavLink>
          ))}

          {user?.role === 'admin' && (
            <NavLink
              to="/admin"
              className={({ isActive }) =>
                `px-3 py-1.5 rounded-md transition-colors font-medium ${
                  isActive ? 'bg-red-50 text-red-700' : 'text-gray-600 hover:bg-gray-100'
                }`
              }
            >
              Admin
            </NavLink>
          )}

          <div className="flex items-center gap-1 ml-2 pl-2 border-l border-gray-200">
            <span className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-[#1E5631] bg-green-50 rounded-md">
              <span className="w-2 h-2 bg-[#1E5631] rounded-full" />
              {user?.name.split(' ')[0]}
            </span>
            <button
              onClick={clearAuth}
              className="px-3 py-1.5 text-sm text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-md transition-colors"
            >
              Sair
            </button>
          </div>
        </nav>

        {/* Mobile: user + hamburger */}
        <div className="flex items-center gap-2 md:hidden">
          <span className="text-xs text-[#1E5631] bg-green-50 px-2 py-1 rounded-full font-medium">
            {user?.name.split(' ')[0]}
          </span>
          <button
            onClick={() => setOpen(v => !v)}
            aria-label="Menu"
            className="p-2 rounded-lg text-gray-600 hover:bg-gray-100 transition-colors"
          >
            {open ? (
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            ) : (
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            )}
          </button>
        </div>
      </div>

      {/* Mobile dropdown */}
      {open && (
        <div className="md:hidden bg-white border-t border-gray-100 animate-slide-down">
          <nav className="flex flex-col px-4 py-3 gap-1">
            {appNavItems.map(item => (
              <NavLink
                key={item.to}
                to={item.to}
                onClick={() => setOpen(false)}
                className={({ isActive }) =>
                  `flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-colors ${
                    isActive
                      ? 'bg-blue-50 text-[#2E75B6]'
                      : 'text-gray-700 hover:bg-gray-50'
                  }`
                }
              >
                <span className="text-lg">{item.icon}</span>
                {item.label}
              </NavLink>
            ))}

            {user?.role === 'admin' && (
              <NavLink
                to="/admin"
                onClick={() => setOpen(false)}
                className={({ isActive }) =>
                  `flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-colors ${
                    isActive ? 'bg-red-50 text-red-700' : 'text-gray-700 hover:bg-gray-50'
                  }`
                }
              >
                <span className="text-lg">🔑</span>
                Painel Admin
              </NavLink>
            )}

            <div className="border-t border-gray-100 mt-2 pt-2">
              <button
                onClick={() => { clearAuth(); setOpen(false) }}
                className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium text-red-600 hover:bg-red-50 transition-colors"
              >
                <span className="text-lg">🚪</span>
                Sair da conta
              </button>
            </div>
          </nav>
        </div>
      )}
    </header>
  )
}

// ── Navbar pública (landing) ──────────────────────────────────────────────────
function PublicNav() {
  const [open, setOpen] = useState(false)
  return (
    <header className="bg-white border-b border-gray-200 sticky top-0 z-50 shadow-sm">
      <div className="max-w-6xl mx-auto px-4 md:px-8 py-4 flex items-center justify-between">
        <BrandLogo />
        <nav className="hidden md:flex gap-8 items-center">
          <a href="#how-it-works" className="text-gray-600 hover:text-[#2E75B6] transition-colors font-medium text-sm">
            Como funciona
          </a>
          <a href="#features" className="text-gray-600 hover:text-[#2E75B6] transition-colors font-medium text-sm">
            Funcionalidades
          </a>
        </nav>
        <div className="hidden md:block">
          <a
            href="#auth-form"
            className="bg-[#2E75B6] text-white px-5 py-2 rounded-lg font-semibold hover:bg-[#1B3A6B] transition-colors text-sm"
          >
            Entrar
          </a>
        </div>
        <button
          onClick={() => setOpen(v => !v)}
          className="md:hidden p-2 rounded-lg text-gray-600 hover:bg-gray-100 transition-colors"
          aria-label="Menu"
        >
          {open ? (
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          ) : (
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          )}
        </button>
      </div>

      {open && (
        <div className="md:hidden bg-white border-t border-gray-100 animate-slide-down">
          <nav className="flex flex-col px-4 py-3 gap-1">
            <a href="#how-it-works" onClick={() => setOpen(false)} className="px-4 py-3 text-sm text-gray-700 hover:bg-gray-50 rounded-xl font-medium">
              Como funciona
            </a>
            <a href="#features" onClick={() => setOpen(false)} className="px-4 py-3 text-sm text-gray-700 hover:bg-gray-50 rounded-xl font-medium">
              Funcionalidades
            </a>
            <a href="#auth-form" onClick={() => setOpen(false)}
              className="mt-1 bg-[#2E75B6] text-white px-4 py-3 rounded-xl text-sm font-semibold text-center hover:bg-[#1B3A6B] transition-colors">
              Entrar / Cadastrar
            </a>
          </nav>
        </div>
      )}
    </header>
  )
}

// ── Badge de versão (canto inferior direito) ──────────────────────────────────
//  Mostra o commit SHA curto do deploy atual, injetado no build via SOURCE_COMMIT.
//  Serve para conferir rapidamente qual versão está no ar em produção.
function VersionBadge() {
  const version = (import.meta.env.VITE_APP_VERSION as string | undefined)?.slice(0, 7) || 'dev'
  return (
    <span
      className="fixed bottom-1 right-1 z-[100] text-[10px] leading-none font-mono text-gray-400/60 select-none pointer-events-none"
      title="Versão do deploy"
    >
      {version}
    </span>
  )
}

// ── App ───────────────────────────────────────────────────────────────────────
function AppContent() {
  const { isAuthenticated } = useAuthStore()
  const location = useLocation()
  const isLanding = location.pathname === '/' && !isAuthenticated

  return (
    <div className="flex flex-col min-h-screen">
      {isAuthenticated && <AuthNav />}
      {isLanding && <PublicNav />}

      <VersionBadge />

      <main className="flex-1">
        <Routes>
          <Route path="/"           element={isAuthenticated ? <Navigate to="/dashboard" replace /> : <Landing />} />
          <Route path="/convite/:token" element={<InviteRegister />} />
          <Route path="/reset/:token"   element={<ResetPassword />} />
          <Route path="/termo"          element={<Termo />} />
          <Route path="/dashboard"  element={isAuthenticated ? <Dashboard />      : <Navigate to="/" replace />} />
          <Route path="/traduzir"   element={isAuthenticated ? <Translate />      : <Navigate to="/" replace />} />
          <Route path="/treinar"    element={isAuthenticated ? <Train />          : <Navigate to="/" replace />} />
          <Route path="/biblioteca" element={isAuthenticated ? <Library />        : <Navigate to="/" replace />} />
          <Route path="/chamada"    element={isAuthenticated ? <Call />           : <Navigate to="/" replace />} />
          <Route path="/admin"      element={isAuthenticated ? <AdminDashboard /> : <Navigate to="/" replace />} />
          <Route path="*"           element={<Navigate to={isAuthenticated ? '/dashboard' : '/'} replace />} />
        </Routes>
      </main>
    </div>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <AppContent />
    </BrowserRouter>
  )
}

export { BrandLogo }
