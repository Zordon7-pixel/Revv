const ROLE_RANK = {
  owner: 4,
  admin: 3,
  assistant: 3,
  technician: 2,
  employee: 2,
  staff: 2,
  customer: 0,
};

function getRoleRank(role) {
  return ROLE_RANK[String(role || '').toLowerCase()] ?? -1;
}

const requireRole = (minRole) => (req, res, next) => {
  if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
  const current = getRoleRank(req.user.role);
  const minimum = getRoleRank(minRole);
  if (current < minimum) {
    return res.status(403).json({ error: `${minRole} access required` });
  }
  return next();
};

const requireOwner = requireRole('owner');
const requireAdmin = requireRole('admin');
const requireTechnician = requireRole('technician');
const requireAssistant = requireRole('assistant');
const requireEmployee = requireTechnician;

const requireCustomer = (req, res, next) => {
  if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
  if (req.user.role !== 'customer') return res.status(403).json({ error: 'Customer access only' });
  return next();
};

module.exports = {
  ROLE_RANK,
  requireRole,
  requireOwner,
  requireAdmin,
  requireTechnician,
  requireAssistant,
  requireEmployee,
  requireCustomer,
};
