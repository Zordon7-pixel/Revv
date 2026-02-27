const router = require('express').Router();
const { dbGet, dbAll, dbRun } = require('../db');
const auth = require('../middleware/auth');
const { v4: uuidv4 } = require('uuid');

const CONDITION_VALUES = ['good', 'fair', 'needs_attention', 'critical'];

const DEFAULT_CHECKLIST = {
  'Body Damage': [
    'Hood',
    'Front Bumper',
    'Rear Bumper',
    'Driver Door',
    'Passenger Door',
    'Fenders',
    'Roof',
    'Trunk/Tailgate',
  ],
  Paint: ['Color Match', 'Clear Coat', 'Overspray', 'Blending'],
  'Frame/Structure': ['Frame Rails', 'Firewall', 'Strut Towers', 'Rocker Panels'],
  Glass: ['Windshield', 'Rear Window', 'Side Windows'],
  Lights: ['Headlights', 'Tail Lights', 'Turn Signals', 'Fog Lights'],
  'Mechanical (Collision-Related)': ['Airbags/SRS', 'Cooling System', 'Suspension/Alignment', 'Steering'],
};

async function getInspectionWithItems(inspectionId) {
  const inspection = await dbGet(
    `SELECT id, ro_id, shop_id, created_by, status, sent_at, viewed_at, created_at, updated_at
     FROM inspections
     WHERE id = $1`,
    [inspectionId]
  );
  if (!inspection) return null;

  const items = await dbAll(
    `SELECT id, inspection_id, category, item_name, condition, note, photo_url, sort_order, created_at
     FROM inspection_items
     WHERE inspection_id = $1
     ORDER BY sort_order ASC, item_name ASC`,
    [inspectionId]
  );

  return { ...inspection, items };
}

router.get('/:id/public', async (req, res) => {
  try {
    const inspection = await dbGet(
      `SELECT i.id, i.ro_id, i.shop_id, i.status, i.sent_at, i.viewed_at, i.created_at, i.updated_at,
              ro.ro_number, ro.job_type, ro.status AS ro_status,
              v.year, v.make, v.model, v.color, v.vin,
              s.name AS shop_name, s.phone AS shop_phone, s.address AS shop_address, s.city AS shop_city, s.state AS shop_state, s.zip AS shop_zip
       FROM inspections i
       LEFT JOIN repair_orders ro ON ro.id = i.ro_id
       LEFT JOIN vehicles v ON v.id = ro.vehicle_id
       LEFT JOIN shops s ON s.id = i.shop_id
       WHERE i.id = $1`,
      [req.params.id]
    );

    if (!inspection) return res.status(404).json({ error: 'Inspection not found' });
    if (inspection.status === 'draft') return res.status(404).json({ error: 'Inspection is not available yet' });

    const items = await dbAll(
      `SELECT id, inspection_id, category, item_name, condition, note, photo_url, sort_order, created_at
       FROM inspection_items
       WHERE inspection_id = $1
       ORDER BY sort_order ASC, item_name ASC`,
      [inspection.id]
    );

    if (inspection.status === 'sent') {
      await dbRun(
        `UPDATE inspections
         SET status = 'viewed', viewed_at = NOW(), updated_at = NOW()
         WHERE id = $1`,
        [inspection.id]
      );
      inspection.status = 'viewed';
      inspection.viewed_at = new Date().toISOString();
    }

    res.json({
      inspection: {
        id: inspection.id,
        ro_id: inspection.ro_id,
        status: inspection.status,
        sent_at: inspection.sent_at,
        viewed_at: inspection.viewed_at,
        created_at: inspection.created_at,
        updated_at: inspection.updated_at,
      },
      ro: {
        id: inspection.ro_id,
        ro_number: inspection.ro_number,
        job_type: inspection.job_type,
        status: inspection.ro_status,
      },
      vehicle: {
        year: inspection.year,
        make: inspection.make,
        model: inspection.model,
        color: inspection.color,
        vin: inspection.vin,
      },
      shop: {
        id: inspection.shop_id,
        name: inspection.shop_name,
        phone: inspection.shop_phone,
        address: inspection.shop_address,
        city: inspection.shop_city,
        state: inspection.shop_state,
        zip: inspection.shop_zip,
      },
      items,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.use(auth);

router.post('/', async (req, res) => {
  try {
    const { ro_id } = req.body || {};
    if (!ro_id) return res.status(400).json({ error: 'ro_id is required' });

    const ro = await dbGet('SELECT id, shop_id FROM repair_orders WHERE id = $1 AND shop_id = $2', [ro_id, req.user.shop_id]);
    if (!ro) return res.status(404).json({ error: 'Repair order not found' });

    const inspectionId = uuidv4();
    await dbRun(
      `INSERT INTO inspections (id, ro_id, shop_id, created_by, status, created_at, updated_at)
       VALUES ($1, $2, $3, $4, 'draft', NOW(), NOW())`,
      [inspectionId, ro_id, req.user.shop_id, req.user.id]
    );

    let sortOrder = 0;
    for (const [category, items] of Object.entries(DEFAULT_CHECKLIST)) {
      for (const itemName of items) {
        await dbRun(
          `INSERT INTO inspection_items
             (id, inspection_id, category, item_name, condition, note, photo_url, sort_order, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())`,
          [uuidv4(), inspectionId, category, itemName, null, null, null, sortOrder]
        );
        sortOrder += 1;
      }
    }

    const inspection = await getInspectionWithItems(inspectionId);
    res.status(201).json({ inspection });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/ro/:roId', async (req, res) => {
  try {
    const ro = await dbGet('SELECT id FROM repair_orders WHERE id = $1 AND shop_id = $2', [req.params.roId, req.user.shop_id]);
    if (!ro) return res.status(404).json({ error: 'Repair order not found' });

    const inspections = await dbAll(
      `SELECT id, ro_id, shop_id, created_by, status, sent_at, viewed_at, created_at, updated_at
       FROM inspections
       WHERE ro_id = $1 AND shop_id = $2
       ORDER BY created_at DESC`,
      [req.params.roId, req.user.shop_id]
    );

    const inspectionsWithItems = await Promise.all(
      inspections.map(async (inspection) => {
        const items = await dbAll(
          `SELECT id, inspection_id, category, item_name, condition, note, photo_url, sort_order, created_at
           FROM inspection_items
           WHERE inspection_id = $1
           ORDER BY sort_order ASC, item_name ASC`,
          [inspection.id]
        );
        return { ...inspection, items };
      })
    );

    res.json({ inspections: inspectionsWithItems });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.patch('/:id/items/:itemId', async (req, res) => {
  try {
    const { condition, note, photo_url } = req.body || {};

    if (condition !== undefined && condition !== null && !CONDITION_VALUES.includes(condition)) {
      return res.status(400).json({ error: 'Invalid condition value' });
    }

    const inspection = await dbGet(
      `SELECT id, shop_id FROM inspections WHERE id = $1 AND shop_id = $2`,
      [req.params.id, req.user.shop_id]
    );

    if (!inspection) return res.status(404).json({ error: 'Inspection not found' });

    const item = await dbGet(
      `SELECT id FROM inspection_items WHERE id = $1 AND inspection_id = $2`,
      [req.params.itemId, req.params.id]
    );

    if (!item) return res.status(404).json({ error: 'Inspection item not found' });

    const fields = [];
    const values = [];

    if (condition !== undefined) {
      values.push(condition || null);
      fields.push(`condition = $${values.length}`);
    }
    if (note !== undefined) {
      values.push(note || null);
      fields.push(`note = $${values.length}`);
    }
    if (photo_url !== undefined) {
      values.push(photo_url || null);
      fields.push(`photo_url = $${values.length}`);
    }

    if (!fields.length) {
      return res.status(400).json({ error: 'No valid fields to update' });
    }

    values.push(req.params.itemId);
    await dbRun(`UPDATE inspection_items SET ${fields.join(', ')} WHERE id = $${values.length}`, values);

    await dbRun('UPDATE inspections SET updated_at = NOW() WHERE id = $1', [req.params.id]);

    const updatedItem = await dbGet(
      `SELECT id, inspection_id, category, item_name, condition, note, photo_url, sort_order, created_at
       FROM inspection_items
       WHERE id = $1`,
      [req.params.itemId]
    );

    res.json({ item: updatedItem });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/:id/send', async (req, res) => {
  try {
    const inspection = await dbGet('SELECT id, shop_id FROM inspections WHERE id = $1 AND shop_id = $2', [req.params.id, req.user.shop_id]);
    if (!inspection) return res.status(404).json({ error: 'Inspection not found' });

    await dbRun(
      `UPDATE inspections
       SET status = 'sent', sent_at = NOW(), updated_at = NOW()
       WHERE id = $1`,
      [req.params.id]
    );

    const updated = await dbGet(
      `SELECT id, ro_id, shop_id, created_by, status, sent_at, viewed_at, created_at, updated_at
       FROM inspections
       WHERE id = $1`,
      [req.params.id]
    );

    res.json({ inspection: updated });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
