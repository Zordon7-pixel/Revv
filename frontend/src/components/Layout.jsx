import { Outlet, NavLink, useLocation, useNavigate } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { LayoutDashboard, ArrowLeft, ClipboardList, ClipboardCheck, Users, BarChart3, BarChart2, Settings, UserCog, LogOut, Menu, Wrench, Clock, CalendarDays, Package, CreditCard, Radar, TrendingUp, X, HelpCircle, Star, Target } from 'lucide-react'
import FeedbackButton from './FeedbackButton'
import HelpPanel from './HelpPanel'
import NotificationBell from './NotificationBell'
import { getRole, getTokenPayload, isAdmin, isEmployee, isAssistant } from '../lib/auth'
import api from '../lib/api'
import { useLanguage } from '../contexts/LanguageContext'
import LanguageToggle from './LanguageToggle'

const allNav = [
  { to: '/',             icon: LayoutDashboard, labelKey: 'nav.dashboard',    adminOnly: false },
  { to: '/ros',          icon: ClipboardList,   labelKey: 'nav.repairOrders', adminOnly: false },
  { to: '/parts',        icon: Package,         labelKey: 'nav.parts',        ownerOnly: true  },
  { to: '/inventory',    icon: Package,         labelKey: 'nav.inventory',    adminOnly: false },
  { to: '/payments',     icon: CreditCard,      labelKey: 'nav.payments',     adminOnly: false },
  { to: '/storage',      icon: Package,         labelKey: 'nav.storage',      adminOnly: false },
  { to: '/estimate-requests', icon: ClipboardCheck,  label: 'Estimate Requests',    adminOnly: true  },
  { to: '/adas',         icon: Radar,           labelKey: 'nav.adas',         adminOnly: true  },
  { to: '/vehicle-diagnostics', icon: ClipboardCheck, labelKey: 'nav.vehicleDiagnostics', adminOnly: false },
  { to: '/tech',         icon: Wrench,          labelKey: 'nav.techView',     nonAdminOnly: true },
  { to: '/customers',    icon: Users,           labelKey: 'nav.customers',    adminOnly: false },
  { to: '/timeclock',    icon: Clock,           labelKey: 'nav.timeclock',    adminOnly: false },
  { to: '/schedule',     icon: CalendarDays,    labelKey: 'nav.schedule',     adminOnly: false },
  { to: '/reports',      icon: BarChart3,       labelKey: 'nav.reports',      adminOnly: true  },
  { to: '/reviews',      icon: Star,            labelKey: 'nav.reviews',      adminOnly: false },
  { to: '/performance',  icon: BarChart2,       labelKey: 'nav.performance',  adminOnly: true  },
  { to: '/job-costing', icon: TrendingUp,      labelKey: 'nav.jobCosting',   ownerOnly: true  },
  { to: '/goals',        icon: Target,          labelKey: 'nav.goals',        ownerOnly: true  },
  { to: '/team',         icon: UserCog,         labelKey: 'nav.team',         adminOnly: true  },
  { to: '/settings',     icon: Settings,        labelKey: 'nav.settings',     ownerOnly: true  },
]

export default function Layout() {
  const { t } = useLanguage()
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)
  const location = useLocation()
  const navigate = useNavigate()
  const admin = isAdmin()
  const staff = isEmployee()
  const assistant = isAssistant()
  const role = getRole()
  const user = getTokenPayload()
  const userInitial = (user?.name || user?.email || 'U').charAt(0).toUpperCase()
  const canOpenSettings = role === 'owner' || role === 'admin'

  async function logout() {
    try { await api.post('/auth/logout') } catch { /* best-effort */ }
    localStorage.removeItem('sc_token')
    navigate('/login')
  }

  function openUserArea() {
    navigate(canOpenSettings ? '/settings' : '/dashboard')
  }

  function goDashboard() {
    navigate('/dashboard')
  }

  function goBackOrDashboard() {
    const prevPath = sessionStorage.getItem('revv_prev_path')
    if (prevPath && prevPath !== location.pathname) {
      navigate(prevPath)
      return
    }
    navigate('/dashboard')
  }

  useEffect(() => {
    const currentPath = sessionStorage.getItem('revv_current_path')
    if (currentPath && currentPath !== location.pathname) {
      sessionStorage.setItem('revv_prev_path', currentPath)
    }
    sessionStorage.setItem('revv_current_path', location.pathname)
  }, [location.pathname])

  const nav = allNav.filter((n) => {
    if (assistant) return ['/', '/ros', '/customers'].includes(n.to)
    if (n.nonAdminOnly) return !admin
    if (n.ownerOnly) return role === 'owner' || role === 'admin'
    if (n.adminOnly) return admin
    return true
  })

  const SidebarContent = () => (
    <div className="flex flex-col h-full min-h-0">
      <div className="p-5 border-b border-[#2a2d3e]">
        <div className="flex items-center gap-3 mb-1">
          <div className="w-9 h-9 bg-indigo-600 rounded-lg flex items-center justify-center">
            <Wrench size={18} className="text-white" />
          </div>
          <div>
            <div className="font-bold text-white text-sm">REVV</div>
            <div className="text-[10px] text-slate-500">Shop HQ</div>
          </div>
        </div>
        <div className="text-[9px] text-indigo-400 italic mt-2 leading-tight">
        </div>
      </div>
      <nav className="flex-1 min-h-0 overflow-y-auto p-3 space-y-1">
        {nav.map(({ to, icon: Icon, labelKey, label }) => (
          <NavLink key={to} to={to} end={to === '/'}
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-all ${isActive ? 'bg-indigo-600 text-white font-medium' : 'text-slate-400 hover:bg-[#2a2d3e] hover:text-white'}`
            }
            onClick={() => setSidebarOpen(false)}>
            <Icon size={16} /> {label || t(labelKey)}
          </NavLink>
        ))}
      </nav>
      <div className="p-3 border-t border-[#2a2d3e]">
        <div className="mb-3">
          <LanguageToggle />
        </div>
        <button onClick={logout} className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-slate-400 hover:bg-red-900/30 hover:text-red-400 transition-all w-full">
          <LogOut size={16} /> Sign Out
        </button>
      </div>
    </div>
  )

  return (
    <div className="flex h-screen bg-[#0f1117] overflow-hidden">
      {/* Desktop sidebar */}
      <aside className="hidden md:flex flex-col w-56 bg-[#1a1d2e] border-r border-[#2a2d3e] flex-shrink-0">
        <SidebarContent />
      </aside>

      {/* Mobile sidebar */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-50 md:hidden transition-opacity opacity-100 pointer-events-auto">
          <div className="absolute inset-0 bg-black/60" onClick={() => setSidebarOpen(false)} />
          <aside className="fixed inset-y-0 left-0 z-50 w-56 bg-[#1a1d2e] border-r border-[#2a2d3e] transform transition-transform duration-200 translate-x-0">
            <div className="flex justify-end p-3 border-b border-[#2a2d3e]">
              <button
                onClick={() => setSidebarOpen(false)}
                className="text-slate-400 hover:text-white"
                aria-label="Close sidebar"
              >
                <X size={18} />
              </button>
            </div>
            <div className="h-[calc(100%-57px)]">
              <SidebarContent />
            </div>
          </aside>
        </div>
      )}

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Mobile topbar */}
        <header className="md:hidden flex items-center gap-3 px-4 py-3 bg-[#1a1d2e] border-b border-[#2a2d3e]">
          <button onClick={() => setSidebarOpen(true)} className="text-slate-400 hover:text-white">
            <Menu size={20} />
          </button>
          <div className="flex items-center gap-2 flex-1">
            <Wrench size={16} className="text-indigo-400" />
            <span className="font-bold text-sm">REVV</span>
          </div>
          <button
            onClick={goBackOrDashboard}
            className="w-8 h-8 rounded-lg border border-[#2a2d3e] bg-[#0f1117] text-slate-300 hover:text-white hover:border-indigo-400 transition-colors flex items-center justify-center"
            aria-label="Go back"
            title="Back"
          >
            <ArrowLeft size={16} />
          </button>
          <button
            onClick={goDashboard}
            className="w-8 h-8 rounded-lg border border-[#2a2d3e] bg-[#0f1117] text-slate-300 hover:text-white hover:border-indigo-400 transition-colors flex items-center justify-center"
            aria-label="Go to dashboard"
            title="Dashboard"
          >
            <LayoutDashboard size={15} />
          </button>
          <LanguageToggle />
          <button
            onClick={() => setHelpOpen(true)}
            className="w-8 h-8 rounded-lg border border-[#2a2d3e] bg-[#0f1117] text-slate-300 hover:text-white hover:border-indigo-400 transition-colors flex items-center justify-center"
            aria-label="Open quick start help"
          >
            <HelpCircle size={16} />
          </button>
          {staff && <NotificationBell />}
          <button
            type="button"
            onClick={openUserArea}
            className="relative z-20 w-8 h-8 rounded-full bg-[#2a2d3e] text-slate-200 text-xs font-semibold flex items-center justify-center hover:bg-[#363a50] transition-colors cursor-pointer"
            title={canOpenSettings ? 'Open settings' : 'Go to dashboard'}
            aria-label={canOpenSettings ? 'Open settings' : 'Go to dashboard'}
          >
            {userInitial}
          </button>
        </header>

        {/* Desktop navbar */}
        <header className="hidden md:flex items-center justify-between gap-3 px-6 py-3 bg-[#1a1d2e] border-b border-[#2a2d3e]">
          <div className="flex items-center gap-2">
            <button
              onClick={goBackOrDashboard}
              className="h-9 px-3 rounded-lg border border-[#2a2d3e] bg-[#0f1117] text-slate-300 hover:text-white hover:border-indigo-400 transition-colors flex items-center gap-2"
              aria-label="Go back"
              title="Back"
            >
              <ArrowLeft size={16} />
              <span className="text-xs font-medium">Back</span>
            </button>
            <button
              onClick={goDashboard}
              className="h-9 px-3 rounded-lg border border-[#2a2d3e] bg-[#0f1117] text-slate-300 hover:text-white hover:border-indigo-400 transition-colors flex items-center gap-2"
              aria-label="Go to dashboard"
              title="Dashboard"
            >
              <LayoutDashboard size={15} />
              <span className="text-xs font-medium">Dashboard</span>
            </button>
          </div>
          <div className="flex items-center gap-3">
            <LanguageToggle />
            <button
              onClick={() => setHelpOpen(true)}
              className="w-9 h-9 rounded-lg border border-[#2a2d3e] bg-[#0f1117] text-slate-300 hover:text-white hover:border-indigo-400 transition-colors flex items-center justify-center"
              aria-label="Open quick start help"
            >
              <HelpCircle size={17} />
            </button>
            {staff && (
              <NotificationBell />
            )}
            <button
              type="button"
              onClick={openUserArea}
              className="relative z-20 w-9 h-9 rounded-full bg-[#2a2d3e] text-slate-200 text-sm font-semibold flex items-center justify-center hover:bg-[#363a50] transition-colors cursor-pointer"
              title={canOpenSettings ? 'Open settings' : 'Go to dashboard'}
              aria-label={canOpenSettings ? 'Open settings' : 'Go to dashboard'}
            >
              {userInitial}
            </button>
          </div>
        </header>

        <main className="flex-1 overflow-auto p-4 md:p-6">
          <Outlet />
          <FeedbackButton />
        </main>
        <HelpPanel isOpen={helpOpen} onClose={() => setHelpOpen(false)} />
      </div>
    </div>
  )
}
