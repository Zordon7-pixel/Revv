import { Outlet, NavLink, useLocation, useNavigate } from 'react-router-dom'
import { useEffect, useMemo, useRef, useState } from 'react'
import { LayoutDashboard, ArrowLeft, ClipboardList, ClipboardCheck, Users, BarChart3, Settings, UserCog, LogOut, Menu, Wrench, Clock, CalendarDays, Package, CreditCard, Radar, TrendingUp, Gauge, X, HelpCircle, Star, ChevronDown, PanelLeftClose, PanelLeftOpen, Search } from 'lucide-react'
import FeedbackButton from './FeedbackButton'
import HelpPanel from './HelpPanel'
import NotificationBell from './NotificationBell'
import { getRole, getTokenPayload, isAdmin, isEmployee, isAssistant } from '../lib/auth'
import api from '../lib/api'
import { useLanguage } from '../contexts/LanguageContext'
import { useTheme } from '../contexts/ThemeContext'
import LanguageToggle from './LanguageToggle'
import AppOverlay from './AppOverlay'
import CommandPalette from './CommandPalette'
import { Logo } from './ui'
import { resolveUploadedMediaUrl } from '../lib/mediaUrls'

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
  { to: '/floor',        icon: Wrench,          label: 'Floor Mode',          group: 'operations', techOnly: true },
  { to: '/tech',         icon: Wrench,          labelKey: 'nav.techView',     group: 'operations', nonAdminOnly: true },
  { to: '/adas',         icon: Radar,           labelKey: 'nav.adas',         group: 'operations', adminOnly: true, employeeAllowed: true },
  { to: '/vehicle-diagnostics', icon: ClipboardCheck, labelKey: 'nav.vehicleDiagnostics', group: 'operations', adminOnly: false },

  { to: '/payments',     icon: CreditCard,      labelKey: 'nav.payments',     group: 'financial', adminOnly: false },
  { to: '/job-costing',  icon: TrendingUp,      labelKey: 'nav.jobCosting',   group: 'financial', ownerOnly: true  },
  { to: '/owner-kpis',   icon: Gauge,           label: 'Owner KPIs',          group: 'financial', ownerOnly: true  },

  { to: '/reviews',      icon: Star,            labelKey: 'nav.reviews',      group: 'insights', adminOnly: false },
  { to: '/reports',      icon: BarChart3,       labelKey: 'nav.reports',      group: 'insights', adminOnly: true  },

  { to: '/estimate-requests', icon: ClipboardCheck, label: 'Estimate Requests', group: 'operations', adminOnly: true  },
  { to: '/team',         icon: UserCog,         labelKey: 'nav.team',         group: 'admin', adminOnly: true  },
  { to: '/settings',     icon: Settings,        labelKey: 'nav.settings',     group: 'admin', ownerOnly: true  },
]

export default function Layout() {
  const { t } = useLanguage()
  const { theme, setTheme } = useTheme()
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    try { return localStorage.getItem('revv_sidebar_collapsed') === '1' } catch { return false }
  })
  const [helpOpen, setHelpOpen] = useState(false)
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false)
  const [currentUserName, setCurrentUserName] = useState('')
  const [currentUserEmail, setCurrentUserEmail] = useState('')
  const [currentUserPhone, setCurrentUserPhone] = useState('')
  const [shopIdentity, setShopIdentity] = useState({ name: '', logo_url: '' })
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

  function toggleSidebarCollapsed() {
    setSidebarCollapsed((prev) => {
      const next = !prev
      try { localStorage.setItem('revv_sidebar_collapsed', next ? '1' : '0') } catch {}
      return next
    })
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
    let active = true
    api.get('/market/shop')
      .then((res) => {
        if (!active) return
        setShopIdentity({
          name: String(res?.data?.name || '').trim(),
          logo_url: String(res?.data?.logo_url || '').trim(),
        })
      })
      .catch(() => {})

    const onShopLogoUpdated = (event) => {
      setShopIdentity((prev) => ({
        name: event?.detail?.name === undefined ? prev.name : String(event.detail.name || '').trim(),
        logo_url: event?.detail?.logo_url === undefined ? prev.logo_url : String(event.detail.logo_url || '').trim(),
      }))
    }
    window.addEventListener('revv:shop-logo-updated', onShopLogoUpdated)
    return () => {
      active = false
      window.removeEventListener('revv:shop-logo-updated', onShopLogoUpdated)
    }
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
        if (n.to === '/team' || n.to === '/users' || n.to === '/settings' || n.to === '/tech' || n.to === '/floor') return false
        return true
      }
      if (employeeRestrictedNav) {
        if (n.techOnly) return true
        if (n.employeeAllowed) return true
        if (n.to === '/storage' || n.to === '/tech') return false
        if (n.group === 'financial' || n.group === 'insights') return false
      }
      if (n.techOnly) return false
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
      className="absolute right-0 top-11 z-[90] w-52 overflow-hidden rounded-instrument border border-line bg-panel shadow-2xl"
      role="menu"
    >
      <div className="border-b border-line px-3 py-2">
        <div className="mb-1 text-[10px] uppercase tracking-wide text-faint">Theme</div>
        <div className="grid grid-cols-2 gap-1">
          <button
            type="button"
            onClick={() => setTheme('dark')}
            className={`rounded px-2 py-1 text-xs ${theme === 'dark' ? 'bg-brand text-white' : 'bg-void text-muted hover:text-ink'}`}
          >
            Dark
          </button>
          <button
            type="button"
            onClick={() => setTheme('light')}
            className={`rounded px-2 py-1 text-xs ${theme === 'light' ? 'bg-brand text-white' : 'bg-void text-muted hover:text-ink'}`}
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
        className="w-full px-3 py-2.5 text-left text-sm text-ink hover:bg-raised"
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
          className="w-full px-3 py-2.5 text-left text-sm text-ink hover:bg-raised"
        >
          Shop Settings
        </button>
      )}
      <button
        type="button"
        onClick={logout}
        className="w-full px-3 py-2.5 text-left text-sm text-crit hover:bg-crit/10"
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

  useEffect(() => {
    const root = document?.documentElement
    if (!root) return undefined
    root.dataset.sidebarCollapsed = sidebarCollapsed ? 'true' : 'false'
    return () => {
      delete root.dataset.sidebarCollapsed
    }
  }, [sidebarCollapsed])

  const SidebarContent = () => (
    <div className="flex flex-col h-full min-h-0">
      <div className="border-b border-line p-5">
        <div className="flex items-center gap-3 mb-1">
          <div className="grid h-9 w-9 flex-shrink-0 place-items-center overflow-hidden rounded-lg bg-white p-1">
            {shopIdentity.logo_url ? (
              <img src={resolveUploadedMediaUrl(shopIdentity.logo_url)} alt={`${shopIdentity.name || 'Shop'} logo`} className="h-full w-full object-contain" />
            ) : (
              <Logo variant="mark" className="h-full w-full object-contain" />
            )}
          </div>
          <div className="min-w-0">
            <div className="truncate text-sm font-bold text-ink">{shopIdentity.name || 'REVV'}</div>
            <div className="text-[10px] text-faint">Shop HQ · REVV</div>
          </div>
        </div>
        <div className="mt-2 text-[10px] leading-tight text-muted">
          Signed in: <span className="font-semibold text-ink">{currentUserName || 'User'}</span> · <span className="text-brand">{roleLabel}</span>
        </div>
      </div>
      <nav className="flex-1 min-h-0 overflow-y-auto p-3 space-y-2">
        {navGroups.map((group) => {
          const isOpen = !!openNavGroups[group.id]
          return (
            <div key={group.id} className="overflow-hidden rounded-lg border border-line">
              <button
                type="button"
                onClick={() => toggleNavGroup(group.id)}
                className="flex w-full items-center justify-between bg-panel-2 px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted transition-colors hover:text-ink"
              >
                <span>{group.label}</span>
                <ChevronDown size={13} className={`transition-transform ${isOpen ? 'rotate-180' : ''}`} />
              </button>
              {isOpen && (
                <div className="p-1 space-y-1">
                  {group.items.map(({ to, icon: Icon, labelKey, label }) => (
                    <NavLink key={to} to={to} end={to === '/dashboard'}
                      className={({ isActive }) =>
                        `flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-all ${isActive ? 'bg-brand text-white font-medium' : 'text-muted hover:bg-raised hover:text-ink'}`
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
      <div className="border-t border-line p-3">
        <div className="mb-2">
          <FeedbackButton placement="sidebar" />
        </div>
        <button onClick={logout} className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-muted transition-all hover:bg-crit/10 hover:text-crit">
          <LogOut size={16} /> Sign Out
        </button>
      </div>
    </div>
  )

  if (location.pathname === '/ros/new') {
    return (
      <div className="new-ro-visual-shell bg-void">
        <main className="new-ro-visual-scroll" aria-label="Create repair order">
          <Outlet />
        </main>
      </div>
    )
  }

  return (
    <div className="app-shell flex overflow-hidden bg-void">
      {/* Desktop sidebar */}
      <aside
        className={`${sidebarCollapsed ? 'hidden' : 'hidden md:flex'} relative z-[70] w-56 flex-shrink-0 flex-col border-r border-line bg-panel`}
      >
        <SidebarContent />
      </aside>

      {/* Mobile sidebar */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-50 md:hidden transition-opacity opacity-100 pointer-events-auto">
          <div className="absolute inset-0 bg-black/60" onClick={() => setSidebarOpen(false)} />
          <aside className="app-mobile-sidebar fixed inset-y-0 left-0 z-50 w-56 translate-x-0 transform border-r border-line bg-panel transition-transform duration-200">
            <div className="flex justify-end border-b border-line p-3">
              <button
                onClick={() => setSidebarOpen(false)}
                className="text-muted hover:text-ink"
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
        <header className="app-mobile-header flex min-w-0 items-center gap-1.5 border-b border-line bg-panel px-3 py-3 md:hidden">
          <button onClick={() => setSidebarOpen(true)} className="grid h-8 w-8 shrink-0 place-items-center text-muted hover:text-ink" aria-label="Open navigation">
            <Menu size={20} />
          </button>
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <div className="grid h-6 w-6 shrink-0 place-items-center overflow-hidden rounded bg-white p-0.5">
              {shopIdentity.logo_url ? (
                <img src={resolveUploadedMediaUrl(shopIdentity.logo_url)} alt={`${shopIdentity.name || 'Shop'} logo`} className="h-full w-full object-contain" />
              ) : (
                <Logo variant="mark" className="h-full w-full object-contain" />
              )}
            </div>
            <span className="min-w-0 truncate text-sm font-bold text-ink max-[359px]:hidden">{shopIdentity.name || 'REVV'}</span>
          </div>
          <button
            onClick={goBackOrDashboard}
            className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-line-2 bg-void text-muted transition-colors hover:border-brand hover:text-ink"
            aria-label="Go back"
            title="Back"
          >
            <ArrowLeft size={16} />
          </button>
          <button
            type="button"
            onClick={() => setCommandPaletteOpen(true)}
            className="grid h-8 w-8 shrink-0 place-items-center rounded-md border border-line-2 bg-void text-muted transition-colors hover:border-brand hover:text-ink"
            aria-label="Search repair orders"
            title="Search"
          >
            <Search size={16} />
          </button>
          <div className="hidden shrink-0 min-[430px]:block"><LanguageToggle /></div>
          <button
            onClick={() => setHelpOpen(true)}
            className="hidden h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-line-2 bg-void text-muted transition-colors hover:border-brand hover:text-ink min-[520px]:flex"
            aria-label="Open quick start help"
          >
            <HelpCircle size={16} />
          </button>
          {staff && <div className="hidden shrink-0 min-[620px]:block"><NotificationBell /></div>}
          <div ref={userMenuMobileRef} className="relative">
            <button
              type="button"
              onClick={openUserArea}
              className="relative z-20 flex h-8 w-8 cursor-pointer items-center justify-center rounded-full bg-raised text-xs font-semibold text-ink transition-colors hover:bg-panel-2"
              title="Open user menu"
              aria-label="Open user menu"
            >
              {userInitial}
            </button>
            {userMenuOpen && <UserMenu />}
          </div>
        </header>

        {/* Desktop navbar */}
        <header className="hidden items-center justify-between gap-3 border-b border-line bg-panel px-6 py-3 md:flex">
          <div className="flex items-center gap-2">
            <button
              onClick={toggleSidebarCollapsed}
              className="flex h-9 w-9 items-center justify-center rounded-lg border border-line-2 bg-void text-muted transition-colors hover:border-brand hover:text-ink"
              aria-label={sidebarCollapsed ? 'Show sidebar' : 'Hide sidebar'}
              aria-pressed={sidebarCollapsed}
              title={sidebarCollapsed ? 'Show sidebar' : 'Hide sidebar'}
            >
              {sidebarCollapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
            </button>
            <button
              onClick={goBackOrDashboard}
              className="flex h-9 items-center gap-2 rounded-lg border border-line-2 bg-void px-3 text-muted transition-colors hover:border-brand hover:text-ink"
              aria-label="Go back"
              title="Back"
            >
              <ArrowLeft size={16} />
              <span className="text-xs font-medium">Back</span>
            </button>
          </div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setCommandPaletteOpen(true)}
              className="flex h-9 items-center gap-2 rounded-md border border-line-2 bg-void px-3 text-muted transition-colors hover:border-brand hover:text-ink"
              aria-label="Search repair orders"
              title="Search repair orders"
            >
              <Search size={16} />
              <span className="text-xs">Search</span>
              <kbd className="rounded border border-line bg-panel-2 px-1.5 py-0.5 font-mono text-[10px] text-faint">⌘K</kbd>
            </button>
            <LanguageToggle />
            <button
              onClick={() => setHelpOpen(true)}
              className="flex h-9 w-9 items-center justify-center rounded-lg border border-line-2 bg-void text-muted transition-colors hover:border-brand hover:text-ink"
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
                className="relative z-20 flex h-9 w-9 cursor-pointer items-center justify-center rounded-full bg-raised text-sm font-semibold text-ink transition-colors hover:bg-panel-2"
                title="Open user menu"
                aria-label="Open user menu"
              >
                {userInitial}
              </button>
              {userMenuOpen && <UserMenu />}
            </div>
          </div>
        </header>

        <div className="relative flex-1 overflow-hidden bg-void">
          <main className="app-main-scroll h-full overflow-auto p-4 md:p-6">
            <Outlet />
          </main>
        </div>
        {accountOpen && (
          <AppOverlay label="My account" onClose={() => setAccountOpen(false)} className="bg-black/60 p-4">
            <div className="w-full max-w-sm space-y-4 rounded-instrument border border-line bg-panel p-5">
              <div className="flex items-center justify-between">
                <h3 className="font-display text-sm font-bold text-ink">My Account</h3>
                <button
                  type="button"
                  onClick={() => setAccountOpen(false)}
                  className="text-muted hover:text-ink"
                  aria-label="Close account settings"
                >
                  <X size={16} />
                </button>
              </div>
              <div className="space-y-3">
                <div>
                  <label className="mb-1 block text-xs text-muted">Full Name</label>
                  <input
                    value={profileForm.name}
                    onChange={(e) => setProfileForm((prev) => ({ ...prev, name: e.target.value }))}
                    className="w-full rounded-lg border border-line-2 bg-void px-3 py-2 text-sm text-ink outline-none focus:border-brand"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-muted">Phone</label>
                  <input
                    value={profileForm.phone}
                    onChange={(e) => setProfileForm((prev) => ({ ...prev, phone: e.target.value }))}
                    className="w-full rounded-lg border border-line-2 bg-void px-3 py-2 text-sm text-ink outline-none focus:border-brand"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-muted">Email</label>
                  <input
                    value={currentUserEmail}
                    readOnly
                    className="w-full rounded-lg border border-line-2 bg-void px-3 py-2 text-sm text-muted"
                  />
                </div>
              </div>
              {profileMessage && (
                <p className={`text-xs ${profileMessage.includes('updated') ? 'text-good' : 'text-crit'}`}>
                  {profileMessage}
                </p>
              )}
              <div className="flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setAccountOpen(false)}
                  className="px-3 py-1.5 text-xs text-muted hover:text-ink"
                >
                  Close
                </button>
                <button
                  type="button"
                  onClick={saveProfile}
                  disabled={profileSaving}
                  className="rounded-lg bg-brand px-3 py-1.5 text-xs text-white hover:bg-brand-lit disabled:opacity-50"
                >
                  {profileSaving ? 'Saving...' : 'Save'}
                </button>
              </div>
            </div>
          </AppOverlay>
        )}
        <HelpPanel isOpen={helpOpen} onClose={() => setHelpOpen(false)} />
        <CommandPalette open={commandPaletteOpen} onOpenChange={setCommandPaletteOpen} />
      </div>
    </div>
  )
}
