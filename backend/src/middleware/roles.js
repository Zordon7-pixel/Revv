// Role-based access control middleware
// Roles: owner > admin > employee/staff > customer

const ADMIN_ROLES    = ['owner', 'admin'];
const EMPLOYEE_ROLES = ['owner', 'admin', 'employee', 'staff'];

const requireAdmin = (req, res, next) => {
  if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
  if (!ADMIN_ROLES.includes(req.user.role)) return res.status(403).json({ error: 'Admin access required' });
  next();
};

const requireEmployee = (req, res, next) => {
  if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
  if (!EMPLOYEE_ROLES.includes(req.user.role)) return res.status(403).json({ error: 'Staff access required' });
  next();
};

const requireCustomer = (req, res, next) => {
  if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
  if (req.user.role !== 'customer') return res.status(403).json({ error: 'Customer access only' });
  next();
};

module.exports = { requireAdmin, requireEmployee, requireCustomer };
