import { Outlet, NavLink, useNavigate } from 'react-router-dom'
import { useState, useEffect, useRef } from 'react'
import { LayoutDashboard, ClipboardList, Users, BarChart3, BarChart2, Settings, UserCog, LogOut, Menu, X, Wrench, Clock, CalendarDays, Bell, Package, CreditCard, Radar } from 'lucide-react'
import FeedbackButton from './FeedbackButton'
import HelpDesk from './HelpDesk'
import { getRole, isAdmin } from '../lib/auth'
import api from '../lib/api'

const allNav = [
  { to: '/',           icon: LayoutDashboard, label: 'Dashboard',      adminOnly: false },
  { to: '/ros',        icon: ClipboardList,   label: 'Repair Orders',  adminOnly: false },
  { to: '/parts',      icon: Package,         label: 'Parts',          ownerOnly: true  },
  { to: '/payments',   icon: CreditCard,      label: 'Payments',       adminOnly: false },
  { to: '/adas',       icon: Radar,           label: 'ADAS',           adminOnly: true  },
  { to: '/tech',       icon: Wrench,          label: 'My Jobs',        nonAdminOnly: true },
  { to: '/customers',  icon: Users,           label: 'Customers',      adminOnly: false },
  { to: '/timeclock',  icon: Clock,           label: 'Time Clock',     adminOnly: false },
  { to: '/schedule',   icon: CalendarDays,    label: 'Schedule',       adminOnly: false },
  { to: '/reports',    icon: BarChart3,       label: 'Reports',        adminOnly: true  },
  { to: '/performance', icon: BarChart2,      label: 'Performance',     adminOnly: true  },
  { to: '/team',       icon: UserCog,         label: 'Team',           adminOnly: true  },
  { to: '/settings',   icon: Settings,        label: 'Settings',       ownerOnly: true  },
]

function NotificationsPanel({ onClose }) {
  const [notifications, setNotifications] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api.get('/timeclock/notifications').then(r => {
      setNotifications(r.data.notifications || [])
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [])

  async function markAllRead() {
    await api.put('/timeclock/notifications/read-all')
    setNotifications(prev => prev.map(n => ({ ...n, read: true })))
  }

  async function markRead(id) {
    await api.put(`/timeclock/notifications/${id}/read`)
    setNotifications(prev => prev.map(n => n.id === id ? { ...n, read: true } : n))
  }

  const unread = notifications.filter(n => !n.read).length

  return (
    <div className="absolute right-0 top-8 w-80 bg-[#1a1d2e] border border-[#2a2d3e] rounded-xl shadow-2xl z-50 overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-[#2a2d3e]">
        <div className="text-sm font-bold text-white">Notifications {unread > 0 && <span className="ml-1 text-xs bg-red-600 text-white px-1.5 py-0.5 rounded-full">{unread}</span>}</div>
        <div className="flex items-center gap-2">
          {unread > 0 && <button onClick={markAllRead} className="text-[10px] text-slate-400 hover:text-indigo-400">Mark all read</button>}
          <button onClick={onClose} className="text-slate-500 hover:text-white"><X size={14}/></button>
        </div>
      </div>
      <div className="max-h-72 overflow-y-auto">
        {loading ? (
          <div className="py-6 text-center text-xs text-slate-500">Loading...</div>
        ) : notifications.length === 0 ? (
          <div className="py-6 text-center text-xs text-slate-500">No notifications</div>
        ) : (
          notifications.map(n => (
            <div key={n.id} onClick={() => !n.read && markRead(n.id)}
              className={`px-4 py-3 border-b border-[#2a2d3e] cursor-pointer hover:bg-[#2a2d3e]/40 transition-colors ${n.read ? 'opacity-50' : ''}`}>
              <div className="text-xs text-white leading-snug">{n.message}</div>
              <div className="text-[10px] text-slate-500 mt-1">{new Date(n.created_at).toLocaleString('en-US', { month:'short', day:'numeric', hour:'numeric', minute:'2-digit', hour12:true })}</div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}

export default function Layout() {
  const [open, setOpen] = useState(false)
  const [showNotif, setShowNotif] = useState(false)
  const [notifCount, setNotifCount] = useState(0)
  const notifRef = useRef(null)
  const navigate = useNavigate()
  const admin = isAdmin()
  const role = getRole()

  useEffect(() => {
    if (!admin) return
    api.get('/timeclock/notifications').then(r => {
      setNotifCount(r.data.unread || 0)
    }).catch(() => {})
  }, [admin])

  useEffect(() => {
    function handleClick(e) {
      if (notifRef.current && !notifRef.current.contains(e.target)) {
        setShowNotif(false)
      }
    }
    if (showNotif) document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [showNotif])

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
          <div className="flex items-center gap-2 flex-1">
            <Wrench size={16} className="text-indigo-400" />
            <span className="font-bold text-sm">REVV</span>
          </div>
          {admin && (
            <div className="relative" ref={notifRef}>
              <button onClick={() => setShowNotif(v => !v)}
                className="relative text-slate-400 hover:text-white p-1">
                <Bell size={18} />
                {notifCount > 0 && (
                  <span className="absolute -top-0.5 -right-0.5 w-4 h-4 bg-red-600 text-white text-[9px] font-bold rounded-full flex items-center justify-center">
                    {notifCount > 9 ? '9+' : notifCount}
                  </span>
                )}
              </button>
              {showNotif && <NotificationsPanel onClose={() => setShowNotif(false)} />}
            </div>
          )}
        </header>

        {/* Desktop top-right notifications */}
        {admin && (
          <div className="hidden md:flex absolute top-4 right-4 z-30" ref={notifRef}>
            <button onClick={() => setShowNotif(v => !v)}
              className="relative text-slate-400 hover:text-white p-2 rounded-lg hover:bg-[#2a2d3e] transition-colors">
              <Bell size={18} />
              {notifCount > 0 && (
                <span className="absolute -top-0.5 -right-0.5 w-4 h-4 bg-red-600 text-white text-[9px] font-bold rounded-full flex items-center justify-center">
                  {notifCount > 9 ? '9+' : notifCount}
                </span>
              )}
            </button>
            {showNotif && <NotificationsPanel onClose={() => setShowNotif(false)} />}
          </div>
        )}

        <main className="flex-1 overflow-auto p-4 md:p-6">
          <Outlet />
          <FeedbackButton />
        </main>
        <HelpDesk />
      </div>
    </div>
  )
}
