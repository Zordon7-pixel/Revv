import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Bell, CheckCircle2, ClipboardList, CreditCard, MessageSquare, Package, Wrench } from 'lucide-react'
import api from '../lib/api'

const TYPE_META = {
  ro_created: { icon: ClipboardList, color: 'text-blue-400' },
  status_change: { icon: Wrench, color: 'text-indigo-400' },
  approval: { icon: CheckCircle2, color: 'text-emerald-400' },
  parts_request: { icon: Package, color: 'text-amber-400' },
  payment: { icon: CreditCard, color: 'text-green-400' },
  customer_message: { icon: MessageSquare, color: 'text-cyan-400' },
}

function relativeTime(input) {
  if (!input) return ''
  const date = new Date(input)
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000)
  if (seconds < 60) return 'just now'
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`
  return `${Math.floor(seconds / 86400)}d ago`
}

export default function NotificationBell() {
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
    const id = window.setInterval(() => loadNotifications(true), 30000)
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

  return (
    <div ref={rootRef} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="relative text-slate-400 hover:text-white p-2 rounded-lg hover:bg-[#2a2d3e] transition-colors"
      >
        <Bell size={18} />
        {unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-4 h-4 px-1 bg-red-600 text-white text-[9px] font-bold rounded-full flex items-center justify-center">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-10 w-96 max-w-[90vw] bg-[#1a1d2e] border border-[#2a2d3e] rounded-xl shadow-2xl z-50 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-[#2a2d3e]">
            <div className="text-sm font-bold text-white">Notifications</div>
            <button onClick={markAllRead} className="text-xs text-slate-400 hover:text-indigo-300">
              Mark all read
            </button>
          </div>

          <div className="max-h-96 overflow-y-auto">
            {loading ? (
              <div className="py-8 text-center text-xs text-slate-500">Loading...</div>
            ) : items.length === 0 ? (
              <div className="py-8 text-center text-xs text-slate-500">No unread notifications</div>
            ) : (
              items.map((item) => {
                const meta = TYPE_META[item.type] || { icon: Bell, color: 'text-slate-400' }
                const Icon = meta.icon
                return (
                  <div key={item.id} className="px-4 py-3 border-b border-[#2a2d3e] hover:bg-[#2a2d3e]/40 transition-colors">
                    <div className="flex gap-3">
                      <Icon size={16} className={`mt-0.5 ${meta.color}`} />
                      <div className="flex-1 min-w-0">
                        <div className="text-sm text-white font-medium">{item.title}</div>
                        {item.body && <div className="text-xs text-slate-300 mt-0.5">{item.body}</div>}
                        <div className="flex items-center justify-between mt-2">
                          <div className="text-[11px] text-slate-500">{relativeTime(item.created_at)}</div>
                          <div className="flex items-center gap-3">
                            {item.ro_id && (
                              <Link
                                to={`/ros/${item.ro_id}`}
                                className="text-[11px] text-indigo-300 hover:text-indigo-200"
                                onClick={() => markRead(item.id)}
                              >
                                View RO
                              </Link>
                            )}
                            <button
                              onClick={() => markRead(item.id)}
                              className="text-[11px] text-slate-400 hover:text-white"
                            >
                              Dismiss
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                )
              })
            )}
          </div>
        </div>
      )}
    </div>
  )
}
