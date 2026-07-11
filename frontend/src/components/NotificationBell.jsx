import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Bell, CheckCircle2, ClipboardList, CreditCard, MessageSquare, Package, Wrench } from 'lucide-react'
import api from '../lib/api'

const TYPE_META = {
  ro_created: { icon: ClipboardList, color: 'text-brand' },
  status_change: { icon: Wrench, color: 'text-brand' },
  approval: { icon: CheckCircle2, color: 'text-good' },
  parts_request: { icon: Package, color: 'text-brand' },
  payment: { icon: CreditCard, color: 'text-good' },
  customer_message: { icon: MessageSquare, color: 'text-brand' },
}

function relativeTime(input) {
  if (!input) return ''
  const date = new Date(input)
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000)
  if (seconds < 60) return 'just now'
  if (seconds < 3600) {
    const mins = Math.floor(seconds / 60)
    return `${mins} ${mins === 1 ? 'min' : 'mins'} ago`
  }
  if (seconds < 86400) {
    const hours = Math.floor(seconds / 3600)
    return `${hours} ${hours === 1 ? 'hour' : 'hours'} ago`
  }
  const days = Math.floor(seconds / 86400)
  return `${days} ${days === 1 ? 'day' : 'days'} ago`
}

export default function NotificationBell() {
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(true)
  const [notifications, setNotifications] = useState([])
  const rootRef = useRef(null)

  const unread = notifications.length

  const loadNotifications = async (silent = false) => {
    try {
      if (!silent) setLoading(true)
      const res = await api.get('/notifications')
      setNotifications(res.data.notifications || [])
    } catch {
      if (!silent) setNotifications([])
    } finally {
      if (!silent) setLoading(false)
    }
  }

  useEffect(() => {
    loadNotifications()
    const id = window.setInterval(() => loadNotifications(true), 60000)
    return () => window.clearInterval(id)
  }, [])

  useEffect(() => {
    const onClickOutside = (event) => {
      if (rootRef.current && !rootRef.current.contains(event.target)) {
        setOpen(false)
      }
    }
    if (open) document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [open])

  const items = useMemo(() => notifications.slice(0, 10), [notifications])

  const markRead = async (id) => {
    try {
      await api.patch(`/notifications/${id}/read`)
      setNotifications((prev) => prev.filter((item) => item.id !== id))
    } catch {}
  }

  const markAllRead = async () => {
    try {
      await api.patch('/notifications/read-all')
      setNotifications([])
    } catch {}
  }

  const onNotificationClick = async (item) => {
    await markRead(item.id)
    setOpen(false)
    if (item.ro_id) {
      navigate(`/ros/${item.ro_id}`)
    }
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="relative rounded-lg p-2 text-muted transition-colors hover:bg-raised hover:text-ink"
        aria-label="Open notifications"
      >
        <Bell size={18} />
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-crit px-1 text-[9px] font-bold text-white">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-10 z-50 w-96 max-w-[90vw] overflow-hidden rounded-instrument border border-line bg-panel shadow-2xl">
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <div className="font-display text-sm font-bold text-ink">Notifications</div>
            <button onClick={markAllRead} className="text-xs text-muted hover:text-brand">
              Mark all read
            </button>
          </div>

          <div className="max-h-96 overflow-y-auto">
            {loading ? (
              <div className="py-8 text-center text-xs text-faint" role="status">Loading...</div>
            ) : items.length === 0 ? (
              <div className="py-8 text-center text-xs text-faint" role="status">No unread notifications</div>
            ) : (
              items.map((item) => {
                const meta = TYPE_META[item.type] || { icon: Bell, color: 'text-muted' }
                const Icon = meta.icon
                const message = item.body || item.title
                return (
                  <button
                    key={item.id}
                    onClick={() => onNotificationClick(item)}
                    className="w-full border-b border-line px-4 py-3 text-left transition-colors hover:bg-panel-2"
                  >
                    <div className="flex gap-3">
                      <Icon size={16} className={`mt-0.5 ${meta.color}`} />
                      <div className="flex-1 min-w-0">
                        <div className="text-xs text-faint">{item.ro_number ? `RO #${item.ro_number}` : 'General update'}</div>
                        <div className="mt-0.5 text-sm font-medium text-ink">{message}</div>
                        {item.body && item.title !== item.body && (
                          <div className="mt-0.5 text-xs text-muted">{item.title}</div>
                        )}
                        <div className="flex items-center justify-between mt-2">
                          <div className="text-[11px] text-faint">{relativeTime(item.created_at)}</div>
                          <div className="text-[11px] text-brand">{item.ro_id ? 'Open RO' : 'Mark read'}</div>
                        </div>
                      </div>
                    </div>
                  </button>
                )
              })
            )}
          </div>
        </div>
      )}
    </div>
  )
}
