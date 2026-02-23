import { Outlet, NavLink, useNavigate } from 'react-router-dom'
import { useState } from 'react'
import { LayoutDashboard, ClipboardList, Users, BarChart3, Settings, UserCog, LogOut, Menu, X, Wrench, Clock, CalendarDays } from 'lucide-react'
import FeedbackButton from './FeedbackButton'
import HelpDesk from './HelpDesk'
import { isAdmin } from '../lib/auth'
import api from '../lib/api'

const allNav = [
  { to: '/',           icon: LayoutDashboard, label: 'Dashboard',      adminOnly: false },
  { to: '/ros',        icon: ClipboardList,   label: 'Repair Orders',  adminOnly: false },
  { to: '/customers',  icon: Users,           label: 'Customers',      adminOnly: false },
  { to: '/timeclock',  icon: Clock,           label: 'Time Clock',     adminOnly: false },
  { to: '/schedule',   icon: CalendarDays,    label: 'Schedule',       adminOnly: false },
  { to: '/reports',    icon: BarChart3,       label: 'Reports',        adminOnly: true  },
  { to: '/team',       icon: UserCog,         label: 'Team',           adminOnly: true  },
  { to: '/settings',   icon: Settings,        label: 'Settings',       adminOnly: true  },
]

export default function Layout() {
  const [open, setOpen] = useState(false)
  const navigate = useNavigate()

  async function logout() {
    try { await api.post('/auth/logout') } catch { /* best-effort */ }
    localStorage.removeItem('sc_token')
    navigate('/login')
  }

  const nav = allNav.filter(n => !n.adminOnly || isAdmin())

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
        {nav.map(({ to, icon: Icon, label }) => (
          <NavLink key={to} to={to} end={to === '/'}
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-all ${isActive ? 'bg-indigo-600 text-white font-medium' : 'text-slate-400 hover:bg-[#2a2d3e] hover:text-white'}`
            }
            onClick={() => setOpen(false)}>
            <Icon size={16} /> {label}
          </NavLink>
        ))}
      </nav>
      <div className="p-3 border-t border-[#2a2d3e]">
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
          <div className="flex items-center gap-2">
            <Wrench size={16} className="text-indigo-400" />
            <span className="font-bold text-sm">REVV</span>
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
