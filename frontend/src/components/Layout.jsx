import { Outlet, NavLink, useNavigate } from 'react-router-dom'
import { useState } from 'react'
import { LayoutDashboard, ClipboardList, Users, BarChart3, BarChart2, Settings, UserCog, LogOut, Menu, Wrench, Clock, CalendarDays, Package, CreditCard, Radar, TrendingUp } from 'lucide-react'
import FeedbackButton from './FeedbackButton'
import HelpDesk from './HelpDesk'
import NotificationBell from './NotificationBell'
import { getRole, getTokenPayload, isAdmin, isEmployee } from '../lib/auth'
import api from '../lib/api'
import { useLanguage } from '../contexts/LanguageContext'
import LanguageToggle from './LanguageToggle'

const allNav = [
  { to: '/',             icon: LayoutDashboard, labelKey: 'nav.dashboard',    adminOnly: false },
  { to: '/ros',          icon: ClipboardList,   labelKey: 'nav.repairOrders', adminOnly: false },
  { to: '/parts',        icon: Package,         labelKey: 'nav.parts',        ownerOnly: true  },
  { to: '/payments',     icon: CreditCard,      labelKey: 'nav.payments',     adminOnly: false },
  { to: '/adas',         icon: Radar,           labelKey: 'nav.adas',         adminOnly: true  },
  { to: '/tech',         icon: Wrench,          labelKey: 'nav.techView',     nonAdminOnly: true },
  { to: '/customers',    icon: Users,           labelKey: 'nav.customers',    adminOnly: false },
  { to: '/timeclock',    icon: Clock,           labelKey: 'nav.timeclock',    adminOnly: false },
  { to: '/schedule',     icon: CalendarDays,    labelKey: 'nav.schedule',     adminOnly: false },
  { to: '/reports',      icon: BarChart3,       labelKey: 'nav.reports',      adminOnly: true  },
  { to: '/performance',  icon: BarChart2,       labelKey: 'nav.performance',  adminOnly: true  },
  { to: '/job-costing', icon: TrendingUp,      labelKey: 'nav.jobCosting',   ownerOnly: true  },
  { to: '/team',         icon: UserCog,         labelKey: 'nav.team',         adminOnly: true  },
  { to: '/settings',     icon: Settings,        labelKey: 'nav.settings',     ownerOnly: true  },
]

export default function Layout() {
  const { t } = useLanguage()
  const [open, setOpen] = useState(false)
  const navigate = useNavigate()
  const admin = isAdmin()
  const staff = isEmployee()
  const role = getRole()
  const user = getTokenPayload()
  const userInitial = (user?.name || user?.email || 'U').charAt(0).toUpperCase()

  async function logout() {
    try { await api.post('/auth/logout') } catch { /* best-effort */ }
    localStorage.removeItem('sc_token')
    navigate('/login')
  }

  const nav = allNav.filter((n) => {
    if (n.nonAdminOnly) return !admin
    if (n.ownerOnly) return role === 'owner' || role === 'admin'
    if (n.adminOnly) return admin
    return true
  })

  const SidebarContent = () => (
    <div className="flex flex-col h-full">
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
      <nav className="flex-1 p-3 space-y-1">
        {nav.map(({ to, icon: Icon, labelKey }) => (
          <NavLink key={to} to={to} end={to === '/'}
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-all ${isActive ? 'bg-indigo-600 text-white font-medium' : 'text-slate-400 hover:bg-[#2a2d3e] hover:text-white'}`
            }
            onClick={() => setOpen(false)}>
            <Icon size={16} /> {t(labelKey)}
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
      {open && (
        <div className="fixed inset-0 z-50 md:hidden">
          <div className="absolute inset-0 bg-black/60" onClick={() => setOpen(false)} />
          <aside className="absolute left-0 top-0 bottom-0 w-56 bg-[#1a1d2e] border-r border-[#2a2d3e]">
            <SidebarContent />
          </aside>
        </div>
      )}

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Mobile topbar */}
        <header className="md:hidden flex items-center gap-3 px-4 py-3 bg-[#1a1d2e] border-b border-[#2a2d3e]">
          <button onClick={() => setOpen(true)} className="text-slate-400 hover:text-white">
            <Menu size={20} />
          </button>
          <div className="flex items-center gap-2 flex-1">
            <Wrench size={16} className="text-indigo-400" />
            <span className="font-bold text-sm">REVV</span>
          </div>
          <LanguageToggle />
          {staff && <NotificationBell />}
          <div className="w-8 h-8 rounded-full bg-[#2a2d3e] text-slate-200 text-xs font-semibold flex items-center justify-center">
            {userInitial}
          </div>
        </header>

        {/* Desktop navbar */}
        <header className="hidden md:flex items-center justify-end gap-3 px-6 py-3 bg-[#1a1d2e] border-b border-[#2a2d3e]">
          <LanguageToggle />
          {staff && (
            <NotificationBell />
          )}
          <div className="w-9 h-9 rounded-full bg-[#2a2d3e] text-slate-200 text-sm font-semibold flex items-center justify-center">
            {userInitial}
          </div>
        </header>

        <main className="flex-1 overflow-auto p-4 md:p-6">
          <Outlet />
          <FeedbackButton />
        </main>
        <HelpDesk />
      </div>
    </div>
  )
}
