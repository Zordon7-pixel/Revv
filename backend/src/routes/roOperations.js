const router = require('express').Router();
const { dbAll, dbGet, dbRun } = require('../db');
const auth = require('../middleware/auth');
const { v4: uuidv4 } = require('uuid');

const VALID_STATUSES = new Set(['queued', 'in_progress', 'done', 'blocked']);
const VALID_TYPES = new Set(['body', 'paint', 'assembly', 'molding', 'glass', 'mechanical', 'detail', 'general']);

function toNumber(value, fallback = null) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

async function ensureRoAccess(roId, shopId) {
  return dbGet(
    'SELECT id FROM repair_orders WHERE id = $1 AND shop_id = $2',
    [roId, shopId]
  );
}

// GET /ro-operations/:roId — list operations for RO
router.get('/:roId', auth, async (req, res) => {
  try {
    const ro = await ensureRoAccess(req.params.roId, req.user.shop_id);
    if (!ro) return res.status(404).json({ error: 'Repair order not found' });

    const ops = await dbAll(
      `SELECT op.id, op.ro_id, op.shop_id, op.title, op.operation_type, op.technician_id,
              op.status, op.estimated_hours, op.actual_hours, op.labor_rate, op.notes,
              op.sort_order, op.started_at, op.completed_at, op.created_at, op.updated_at,
              u.name AS technician_name, u.email AS technician_email
       FROM ro_operations op
       LEFT JOIN users u ON u.id = op.technician_id
       WHERE op.ro_id = $1 AND op.shop_id = $2
       ORDER BY op.sort_order ASC, op.created_at ASC`,
      [req.params.roId, req.user.shop_id]
    );

    return res.json({ operations: ops });
  } catch (err) {
    console.error('[RO Operations] GET error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /ro-operations/:roId — create operation
router.post('/:roId', auth, async (req, res) => {
  try {
    const ro = await ensureRoAccess(req.params.roId, req.user.shop_id);
    if (!ro) return res.status(404).json({ error: 'Repair order not found' });

    const title = String(req.body?.title || '').trim();
    if (!title) return res.status(400).json({ error: 'title is required' });

    const operationType = VALID_TYPES.has(req.body?.operation_type) ? req.body.operation_type : 'general';
    const technicianId = req.body?.technician_id || null;
    const estimatedHours = toNumber(req.body?.estimated_hours);
    const laborRate = toNumber(req.body?.labor_rate);
    const notes = req.body?.notes ? String(req.body.notes).trim() : null;
    const sortOrder = Number.isInteger(Number(req.body?.sort_order)) ? Number(req.body.sort_order) : 0;

    // Validate technician belongs to same shop if provided
    if (technicianId) {
      const tech = await dbGet(
        'SELECT id FROM users WHERE id = $1 AND shop_id = $2',
        [technicianId, req.user.shop_id]
      );
      if (!tech) return res.status(400).json({ error: 'Technician not found in this shop' });
    }

    const op = await dbGet(
      `INSERT INTO ro_operations (id, ro_id, shop_id, title, operation_type, technician_id,
        status, estimated_hours, labor_rate, notes, sort_order, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, 'queued', $7, $8, $9, $10, NOW(), NOW())
       RETURNING id, ro_id, shop_id, title, operation_type, technician_id, status,
                 estimated_hours, actual_hours, labor_rate, notes, sort_order,
                 started_at, completed_at, created_at, updated_at`,
      [uuidv4(), req.params.roId, req.user.shop_id, title, operationType, technicianId,
       estimatedHours, laborRate, notes, sortOrder]
    );

    return res.status(201).json({ success: true, operation: op });
  } catch (err) {
    console.error('[RO Operations] POST error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /ro-operations/:roId/:opId — update operation
router.put('/:roId/:opId', auth, async (req, res) => {
  try {
    const ro = await ensureRoAccess(req.params.roId, req.user.shop_id);
    if (!ro) return res.status(404).json({ error: 'Repair order not found' });

    const existing = await dbGet(
      'SELECT id, status FROM ro_operations WHERE id = $1 AND ro_id = $2 AND shop_id = $3',
      [req.params.opId, req.params.roId, req.user.shop_id]
    );
    if (!existing) return res.status(404).json({ error: 'Operation not found' });

    const fields = {};

    if (req.body?.title !== undefined) {
      const title = String(req.body.title || '').trim();
      if (!title) return res.status(400).json({ error: 'title cannot be empty' });
      fields.title = title;
    }

    if (req.body?.operation_type !== undefined) {
      if (!VALID_TYPES.has(req.body.operation_type)) {
        return res.status(400).json({ error: `Invalid operation_type. Valid: ${[...VALID_TYPES].join(', ')}` });
      }
      fields.operation_type = req.body.operation_type;
    }

    if (req.body?.status !== undefined) {
      if (!VALID_STATUSES.has(req.body.status)) {
        return res.status(400).json({ error: `Invalid status. Valid: ${[...VALID_STATUSES].join(', ')}` });
      }
      fields.status = req.body.status;
      if (req.body.status === 'in_progress' && existing.status !== 'in_progress') {
        fields.started_at = new Date().toISOString();
      }
      if (req.body.status === 'done' && existing.status !== 'done') {
        fields.completed_at = new Date().toISOString();
      }
    }

    if (req.body?.technician_id !== undefined) {
      const techId = req.body.technician_id || null;
      if (techId) {
        const tech = await dbGet(
          'SELECT id FROM users WHERE id = $1 AND shop_id = $2',
          [techId, req.user.shop_id]
        );
        if (!tech) return res.status(400).json({ error: 'Technician not found in this shop' });
      }
      fields.technician_id = techId;
    }

    if (req.body?.estimated_hours !== undefined) fields.estimated_hours = toNumber(req.body.estimated_hours);
    if (req.body?.actual_hours !== undefined) fields.actual_hours = toNumber(req.body.actual_hours);
    if (req.body?.labor_rate !== undefined) fields.labor_rate = toNumber(req.body.labor_rate);
    if (req.body?.notes !== undefined) fields.notes = req.body.notes ? String(req.body.notes).trim() : null;
    if (req.body?.sort_order !== undefined) fields.sort_order = Number.isInteger(Number(req.body.sort_order)) ? Number(req.body.sort_order) : 0;

    if (Object.keys(fields).length === 0) {
      return res.status(400).json({ error: 'No valid fields to update' });
    }

    fields.updated_at = new Date().toISOString();
    const keys = Object.keys(fields);
    const vals = Object.values(fields);
    const setClauses = keys.map((k, i) => `${k} = $${i + 1}`).join(', ');

    const updated = await dbGet(
      `UPDATE ro_operations SET ${setClauses}
       WHERE id = $${keys.length + 1} AND ro_id = $${keys.length + 2} AND shop_id = $${keys.length + 3}
       RETURNING id, ro_id, shop_id, title, operation_type, technician_id, status,
                 estimated_hours, actual_hours, labor_rate, notes, sort_order,
                 started_at, completed_at, created_at, updated_at`,
      [...vals, req.params.opId, req.params.roId, req.user.shop_id]
    );

    return res.json({ success: true, operation: updated });
  } catch (err) {
    console.error('[RO Operations] PUT error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /ro-operations/:roId/:opId — delete operation
router.delete('/:roId/:opId', auth, async (req, res) => {
  try {
    const ro = await ensureRoAccess(req.params.roId, req.user.shop_id);
    if (!ro) return res.status(404).json({ error: 'Repair order not found' });

    const removed = await dbGet(
      `DELETE FROM ro_operations
       WHERE id = $1 AND ro_id = $2 AND shop_id = $3
       RETURNING id`,
      [req.params.opId, req.params.roId, req.user.shop_id]
    );

    if (!removed) return res.status(404).json({ error: 'Operation not found' });

    return res.json({ success: true, deleted_id: removed.id });
  } catch (err) {
    console.error('[RO Operations] DELETE error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
