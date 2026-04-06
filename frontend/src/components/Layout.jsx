import { Outlet, NavLink, useLocation, useNavigate } from 'react-router-dom'
import { useEffect, useMemo, useRef, useState } from 'react'
import { LayoutDashboard, ArrowLeft, ClipboardList, ClipboardCheck, Users, BarChart3, Settings, UserCog, LogOut, Menu, Wrench, Clock, CalendarDays, Package, CreditCard, Radar, TrendingUp, X, HelpCircle, Star, ChevronDown } from 'lucide-react'
import FeedbackButton from './FeedbackButton'
import HelpPanel from './HelpPanel'
import NotificationBell from './NotificationBell'
import { getRole, getTokenPayload, isAdmin, isEmployee, isAssistant } from '../lib/auth'
import api from '../lib/api'
import { useLanguage } from '../contexts/LanguageContext'
import { useTheme } from '../contexts/ThemeContext'
import LanguageToggle from './LanguageToggle'

const NAV_GROUPS = [
  { id: 'core', label: 'Core', defaultOpen: true },
  { id: 'operations', label: 'Operations', defaultOpen: true },
  { id: 'financial', label: 'Financial', defaultOpen: false },
  { id: 'insights', label: 'Insights', defaultOpen: false },
  { id: 'admin', label: 'Admin', defaultOpen: false },
]

const allNav = [
  { to: '/dashboard',    icon: LayoutDashboard, labelKey: 'nav.dashboard',    group: 'core', adminOnly: false },
  { to: '/ros',          icon: ClipboardList,   labelKey: 'nav.repairOrders', group: 'core', adminOnly: false },
  { to: '/customers',    icon: Users,           labelKey: 'nav.customers',    group: 'core', adminOnly: false },
  { to: '/schedule',     icon: CalendarDays,    labelKey: 'nav.schedule',     group: 'core', adminOnly: false },

  { to: '/parts',        icon: Package,         labelKey: 'nav.parts',        group: 'operations', ownerOnly: true, employeeAllowed: true },
  { to: '/inventory',    icon: Package,         labelKey: 'nav.inventory',    group: 'operations', adminOnly: false },
  { to: '/storage',      icon: Package,         labelKey: 'nav.storage',      group: 'operations', adminOnly: false },
  { to: '/timeclock',    icon: Clock,           labelKey: 'nav.timeclock',    group: 'core', adminOnly: false },
  { to: '/tech',         icon: Wrench,          labelKey: 'nav.techView',     group: 'operations', nonAdminOnly: true },
  { to: '/adas',         icon: Radar,           labelKey: 'nav.adas',         group: 'operations', adminOnly: true, employeeAllowed: true },
  { to: '/vehicle-diagnostics', icon: ClipboardCheck, labelKey: 'nav.vehicleDiagnostics', group: 'operations', adminOnly: false },

  { to: '/payments',     icon: CreditCard,      labelKey: 'nav.payments',     group: 'financial', adminOnly: false },
  { to: '/job-costing',  icon: TrendingUp,      labelKey: 'nav.jobCosting',   group: 'financial', ownerOnly: true  },

  { to: '/reviews',      icon: Star,            labelKey: 'nav.reviews',      group: 'insights', adminOnly: false },
  { to: '/reports',      icon: BarChart3,       labelKey: 'nav.reports',      group: 'insights', adminOnly: true  },

  { to: '/estimate-requests', icon: ClipboardCheck, label: 'Estimate Requests', group: 'operations', adminOnly: true  },
  { to: '/team',         icon: UserCog,         labelKey: 'nav.team',         group: 'admin', adminOnly: true  },
  { to: '/settings',     icon: Settings,        labelKey: 'nav.settings',     group: 'admin', ownerOnly: true  },
]

const REVV_WATERMARK_SVG = encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="260" height="260" viewBox="0 0 260 260"><rect width="260" height="260" fill="none"/><g opacity="0.22"><text x="34" y="138" fill="#94a3b8" font-size="44" font-family="Arial, sans-serif" font-weight="700">REVV</text></g><circle cx="208" cy="56" r="24" fill="#4f46e5" fill-opacity="0.22"/><circle cx="64" cy="214" r="14" fill="#22d3ee" fill-opacity="0.18"/></svg>'
)
const REVV_WATERMARK_STYLE = {
  backgroundImage: `url("data:image/svg+xml,${REVV_WATERMARK_SVG}")`,
  backgroundSize: '260px 260px',
  backgroundRepeat: 'repeat',
}
const MAIN_AMBIENT_STYLE = {
  backgroundImage:
    'radial-gradient(circle at 20% 18%, rgba(79,70,229,0.24), transparent 40%), radial-gradient(circle at 82% 72%, rgba(34,211,238,0.18), transparent 44%), linear-gradient(180deg, #121524 0%, #0f1117 100%)',
}

export default function Layout() {
  const { t } = useLanguage()
  const { theme, setTheme } = useTheme()
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)
  const [currentUserName, setCurrentUserName] = useState('')
  const [currentUserEmail, setCurrentUserEmail] = useState('')
  const [currentUserPhone, setCurrentUserPhone] = useState('')
  const [userMenuOpen, setUserMenuOpen] = useState(false)
  const [accountOpen, setAccountOpen] = useState(false)
  const [profileForm, setProfileForm] = useState({ name: '', phone: '' })
  const [profileSaving, setProfileSaving] = useState(false)
  const [profileMessage, setProfileMessage] = useState('')
  const [openNavGroups, setOpenNavGroups] = useState(() =>
    Object.fromEntries(NAV_GROUPS.map((group) => [group.id, group.defaultOpen]))
  )
  const userMenuMobileRef = useRef(null)
  const userMenuDesktopRef = useRef(null)
  const location = useLocation()
  const navigate = useNavigate()
  const admin = isAdmin()
  const staff = isEmployee()
  const assistant = isAssistant()
  const role = getRole()
  const employeeRestrictedNav = role === 'employee' || role === 'staff' || role === 'technician'
  const user = getTokenPayload()
  const userInitial = (user?.name || user?.email || 'U').charAt(0).toUpperCase()
  const canOpenSettings = role === 'owner' || role === 'admin'
  const fallbackHomePath = '/dashboard'
  const roleLabelMap = {
    owner: 'Owner',
    admin: 'Admin',
    assistant: 'Assistant',
    employee: 'Tech',
    staff: 'Tech',
    technician: 'Tech',
  }
  const roleLabel = roleLabelMap[role] || (role ? `${role.charAt(0).toUpperCase()}${role.slice(1)}` : 'User')

  async function logout() {
    try { await api.post('/auth/logout') } catch { /* best-effort */ }
    localStorage.removeItem('sc_token')
    navigate('/login')
  }

  function openUserArea() {
    setUserMenuOpen((prev) => !prev)
  }

  function goBackOrDashboard() {
    const prevPath = sessionStorage.getItem('revv_prev_path')
    if (prevPath && prevPath !== location.pathname) {
      navigate(prevPath)
      return
    }
    navigate(fallbackHomePath)
  }

  useEffect(() => {
    const currentPath = sessionStorage.getItem('revv_current_path')
    if (currentPath && currentPath !== location.pathname) {
      sessionStorage.setItem('revv_prev_path', currentPath)
    }
    sessionStorage.setItem('revv_current_path', location.pathname)
  }, [location.pathname])

  useEffect(() => {
    let active = true
    api.get('/users/me')
      .then((res) => {
        if (!active) return
        const userData = res?.data || {}
        setCurrentUserName((userData.name || '').trim())
        setCurrentUserEmail((userData.email || '').trim())
        setCurrentUserPhone((userData.phone || '').trim())
        setProfileForm({
          name: (userData.name || '').trim(),
          phone: (userData.phone || '').trim(),
        })
      })
      .catch(() => {})
    return () => { active = false }
  }, [])

  useEffect(() => {
    const onClickOutside = (event) => {
      const inMobileMenu = userMenuMobileRef.current?.contains(event.target)
      const inDesktopMenu = userMenuDesktopRef.current?.contains(event.target)
      if (!inMobileMenu && !inDesktopMenu) {
        setUserMenuOpen(false)
      }
    }
    if (userMenuOpen) document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [userMenuOpen])

  async function saveProfile() {
    const name = String(profileForm.name || '').trim()
    if (!name) {
      setProfileMessage('Name is required.')
      return
    }
    setProfileSaving(true)
    setProfileMessage('')
    try {
      await api.put('/users/me', { name, phone: String(profileForm.phone || '').trim() })
      setCurrentUserName(name)
      setCurrentUserPhone(String(profileForm.phone || '').trim())
      setProfileMessage('Profile updated.')
      setTimeout(() => setProfileMessage(''), 2500)
    } catch (err) {
      setProfileMessage(err?.response?.data?.error || 'Could not save profile.')
    } finally {
      setProfileSaving(false)
    }
  }

  const nav = useMemo(() => {
    return allNav.filter((n) => {
      if (assistant) {
        if (n.to === '/team' || n.to === '/users' || n.to === '/settings' || n.to === '/tech') return false
        return true
      }
      if (employeeRestrictedNav) {
        if (n.employeeAllowed) return true
        if (n.to === '/storage' || n.to === '/tech') return false
        if (n.group === 'financial' || n.group === 'insights') return false
      }
      if (n.nonAdminOnly) return !admin
      if (n.ownerOnly) return role === 'owner' || role === 'admin'
      if (n.adminOnly) return admin
      return true
    })
  }, [admin, assistant, role, employeeRestrictedNav])
  const navGroups = NAV_GROUPS
    .map((group) => ({ ...group, items: nav.filter((item) => item.group === group.id) }))
    .filter((group) => group.items.length)

  const UserMenu = () => (
    <div
      className="absolute right-0 top-11 w-52 bg-[#1a1d2e] border border-[#2a2d3e] rounded-xl shadow-2xl z-[90] overflow-hidden"
      role="menu"
    >
      <div className="px-3 py-2 border-b border-[#2a2d3e]">
        <div className="text-[10px] uppercase tracking-wide text-slate-500 mb-1">Theme</div>
        <div className="grid grid-cols-2 gap-1">
          <button
            type="button"
            onClick={() => setTheme('dark')}
            className={`text-xs px-2 py-1 rounded ${theme === 'dark' ? 'bg-indigo-600 text-white' : 'bg-[#0f1117] text-slate-300 hover:text-white'}`}
          >
            Dark
          </button>
          <button
            type="button"
            onClick={() => setTheme('light')}
            className={`text-xs px-2 py-1 rounded ${theme === 'light' ? 'bg-indigo-600 text-white' : 'bg-[#0f1117] text-slate-300 hover:text-white'}`}
          >
            Light
          </button>
        </div>
      </div>
      <button
        type="button"
        onClick={() => {
          setAccountOpen(true)
          setUserMenuOpen(false)
        }}
        className="w-full text-left px-3 py-2.5 text-sm text-slate-200 hover:bg-[#2a2d3e]"
      >
        My Account
      </button>
      {canOpenSettings && (
        <button
          type="button"
          onClick={() => {
            navigate('/settings')
            setUserMenuOpen(false)
          }}
          className="w-full text-left px-3 py-2.5 text-sm text-slate-200 hover:bg-[#2a2d3e]"
        >
          Shop Settings
        </button>
      )}
      <button
        type="button"
        onClick={logout}
        className="w-full text-left px-3 py-2.5 text-sm text-red-300 hover:bg-red-900/25"
      >
        Sign Out
      </button>
    </div>
  )

  function toggleNavGroup(groupId) {
    setOpenNavGroups((prev) => ({ ...prev, [groupId]: !prev[groupId] }))
  }

  useEffect(() => {
    const activeItem = nav.find((item) => {
      if (item.to === '/dashboard') return location.pathname === '/dashboard'
      return location.pathname === item.to || location.pathname.startsWith(`${item.to}/`)
    })
    if (!activeItem) return
    setOpenNavGroups((prev) => (prev[activeItem.group] ? prev : { ...prev, [activeItem.group]: true }))
  }, [location.pathname, nav])

  const SidebarContent = () => (
    <div className="flex flex-col h-full min-h-0">
      <div className="p-5 border-b border-[#2a2d3e]">
        <div className="flex items-center gap-3 mb-1">
          <div className="w-9 h-9 rounded-lg overflow-hidden flex-shrink-0">
            <img src="/revv-logo.jpg" alt="REVV" className="w-full h-full object-cover" />
          </div>
          <div>
            <div className="font-bold text-white text-sm">REVV</div>
            <div className="text-[10px] text-slate-500">Shop HQ</div>
          </div>
        </div>
        <div className="text-[10px] text-slate-300 mt-2 leading-tight">
          Signed in: <span className="text-white font-semibold">{currentUserName || 'User'}</span> · <span className="text-indigo-300">{roleLabel}</span>
        </div>
      </div>
      <nav className="flex-1 min-h-0 overflow-y-auto p-3 space-y-2">
        {navGroups.map((group) => {
          const isOpen = !!openNavGroups[group.id]
          return (
            <div key={group.id} className="border border-[#2a2d3e] rounded-lg overflow-hidden">
              <button
                type="button"
                onClick={() => toggleNavGroup(group.id)}
                className="w-full flex items-center justify-between px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400 bg-[#141726] hover:text-slate-200 transition-colors"
              >
                <span>{group.label}</span>
                <ChevronDown size={13} className={`transition-transform ${isOpen ? 'rotate-180' : ''}`} />
              </button>
              {isOpen && (
                <div className="p-1 space-y-1">
                  {group.items.map(({ to, icon: Icon, labelKey, label }) => (
                    <NavLink key={to} to={to} end={to === '/dashboard'}
                      className={({ isActive }) =>
                        `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-all ${isActive ? 'bg-indigo-600 text-white font-medium' : 'text-slate-400 hover:bg-[#2a2d3e] hover:text-white'}`
                      }
                      onClick={() => setSidebarOpen(false)}>
                      <Icon size={16} /> {label || t(labelKey)}
                    </NavLink>
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </nav>
      <div className="p-3 border-t border-[#2a2d3e]">
        <div className="mb-2">
          <FeedbackButton placement="sidebar" />
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
      <aside className="hidden md:flex flex-col w-56 bg-[#1a1d2e] border-r border-[#2a2d3e] flex-shrink-0 relative z-[70]">
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
            <img src="/revv-logo.jpg" alt="REVV" className="w-6 h-6 rounded object-cover" />
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
          <LanguageToggle />
          <button
            onClick={() => setHelpOpen(true)}
            className="w-8 h-8 rounded-lg border border-[#2a2d3e] bg-[#0f1117] text-slate-300 hover:text-white hover:border-indigo-400 transition-colors flex items-center justify-center"
            aria-label="Open quick start help"
          >
            <HelpCircle size={16} />
          </button>
          {staff && <NotificationBell />}
          <div ref={userMenuMobileRef} className="relative">
            <button
              type="button"
              onClick={openUserArea}
              className="relative z-20 w-8 h-8 rounded-full bg-[#2a2d3e] text-slate-200 text-xs font-semibold flex items-center justify-center hover:bg-[#363a50] transition-colors cursor-pointer"
              title="Open user menu"
              aria-label="Open user menu"
            >
              {userInitial}
            </button>
            {userMenuOpen && <UserMenu />}
          </div>
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
            <div ref={userMenuDesktopRef} className="relative">
              <button
                type="button"
                onClick={openUserArea}
                className="relative z-20 w-9 h-9 rounded-full bg-[#2a2d3e] text-slate-200 text-sm font-semibold flex items-center justify-center hover:bg-[#363a50] transition-colors cursor-pointer"
                title="Open user menu"
                aria-label="Open user menu"
              >
                {userInitial}
              </button>
              {userMenuOpen && <UserMenu />}
            </div>
          </div>
        </header>

        <div className="relative flex-1 overflow-hidden" style={MAIN_AMBIENT_STYLE}>
          <div className="pointer-events-none absolute inset-0 opacity-[0.14]" style={REVV_WATERMARK_STYLE} />
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-transparent via-[#0f1117]/25 to-[#0f1117]/55" />
          <main className="relative z-10 h-full overflow-auto p-4 md:p-6">
            <Outlet />
          </main>
        </div>
        {accountOpen && (
          <div className="fixed inset-0 z-[95] bg-black/60 flex items-center justify-center p-4">
            <div className="w-full max-w-sm bg-[#1a1d2e] border border-[#2a2d3e] rounded-2xl p-5 space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold text-white">My Account</h3>
                <button
                  type="button"
                  onClick={() => setAccountOpen(false)}
                  className="text-slate-400 hover:text-white"
                >
                  <X size={16} />
                </button>
              </div>
              <div className="space-y-3">
                <div>
                  <label className="block text-xs text-slate-400 mb-1">Full Name</label>
                  <input
                    value={profileForm.name}
                    onChange={(e) => setProfileForm((prev) => ({ ...prev, name: e.target.value }))}
                    className="w-full bg-[#0f1117] border border-[#2a2d3e] rounded-lg px-3 py-2 text-sm text-white"
                  />
                </div>
                <div>
                  <label className="block text-xs text-slate-400 mb-1">Phone</label>
                  <input
                    value={profileForm.phone}
                    onChange={(e) => setProfileForm((prev) => ({ ...prev, phone: e.target.value }))}
                    className="w-full bg-[#0f1117] border border-[#2a2d3e] rounded-lg px-3 py-2 text-sm text-white"
                  />
                </div>
                <div>
                  <label className="block text-xs text-slate-400 mb-1">Email</label>
                  <input
                    value={currentUserEmail}
                    readOnly
                    className="w-full bg-[#0f1117] border border-[#2a2d3e] rounded-lg px-3 py-2 text-sm text-slate-400"
                  />
                </div>
              </div>
              {profileMessage && (
                <p className={`text-xs ${profileMessage.includes('updated') ? 'text-emerald-300' : 'text-red-300'}`}>
                  {profileMessage}
                </p>
              )}
              <div className="flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setAccountOpen(false)}
                  className="text-xs text-slate-400 hover:text-white px-3 py-1.5"
                >
                  Close
                </button>
                <button
                  type="button"
                  onClick={saveProfile}
                  disabled={profileSaving}
                  className="text-xs bg-indigo-600 hover:bg-indigo-500 text-white px-3 py-1.5 rounded-lg disabled:opacity-50"
                >
                  {profileSaving ? 'Saving...' : 'Save'}
                </button>
              </div>
            </div>
          </div>
        )}
        <HelpPanel isOpen={helpOpen} onClose={() => setHelpOpen(false)} />
      </div>
    </div>
  )
}
