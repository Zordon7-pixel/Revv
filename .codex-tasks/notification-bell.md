# Task: In-App Notification Bell for REVV

## Goal
Build a real-time in-app notification bell for staff (admin, owner, employees) that surfaces important events without requiring SMS or page refresh.

## Trigger Events (what generates a notification)
1. New RO created → notify all staff
2. RO status changed → notify assigned tech + owner
3. Customer approves/declines estimate → notify owner + admin
4. Parts request submitted → notify owner
5. Payment marked received → notify owner
6. New customer message / photo upload on TrackPortal → notify owner + admin

## DB Schema (add to migrate.js)
```sql
CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  shop_id INTEGER NOT NULL,
  user_id INTEGER,          -- NULL = all staff
  type TEXT NOT NULL,       -- 'ro_created', 'status_change', 'approval', 'parts_request', 'payment', 'customer_message'
  title TEXT NOT NULL,
  body TEXT,
  ro_id INTEGER,
  read INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (shop_id) REFERENCES shops(id),
  FOREIGN KEY (ro_id) REFERENCES repair_orders(id)
);
```

## Backend
- `backend/src/services/notifications.js` — createNotification(shopId, userId, type, title, body, roId)
- `backend/src/routes/notifications.js`:
  - GET /api/notifications — returns unread notifications for current user
  - PATCH /api/notifications/:id/read — mark one as read
  - PATCH /api/notifications/read-all — mark all as read
- Wire createNotification() into existing route handlers:
  - ros.js: on RO create, on status change
  - approval.js: on approval/decline
  - partsRequests.js: on new parts request
  - payments.js: on payment received
  - portal.js: on customer message/photo

## Frontend
- `frontend/src/components/NotificationBell.jsx`:
  - Bell icon (Lucide `Bell`) in the top navbar
  - Red badge with unread count
  - Click → dropdown panel showing last 10 notifications
  - Each notification: icon, title, body, relative time, link to RO
  - "Mark all read" button at top of dropdown
  - Auto-polls GET /api/notifications every 30 seconds
- Add to `frontend/src/components/Layout.jsx` — place bell in top navbar next to user avatar

## Notes
- No WebSockets needed — polling every 30s is fine for v1
- Notifications are per-shop (shop_id scoped)
- user_id NULL = broadcast to all staff in that shop
- Keep it simple — no push notifications, no email, just in-app
- Use existing auth middleware (requireAuth, requireRole)
- Run migration on startup (already handled by migrate.js pattern)

## Done When
- [ ] notifications table created in DB
- [ ] GET /api/notifications returns unread for authenticated user
- [ ] PATCH mark-read endpoints work
- [ ] createNotification() called in at least: RO create, status change, approval
- [ ] NotificationBell renders in navbar with badge count
- [ ] Clicking bell shows dropdown with recent notifications
- [ ] Mark all read clears the badge
- [ ] Pushed to GitHub
