const router = require('express').Router();
const { pool, dbGet, dbAll, dbRun } = require('../db');
const auth = require('../middleware/auth');
const { requireTechnician } = require('../middleware/roles');
const { ensureDelivery, savePart, PENDING, fail } = require('../services/partsDelivery');
router.use(auth, requireTechnician);
router.use(async (req,res,next) => { try { await ensureDelivery(pool); next(); } catch {res.status(503).json({error:'Parts tracking is temporarily unavailable.'});} });
function error(res,e) { return res.status(e.publicMessage ? e.status : 500).json({error:e.publicMessage?e.message:'Could not save or load parts.'}); }
router.get('/ro/:roId', async (req,res) => {
  try {
    if (!await dbGet('SELECT id FROM repair_orders WHERE id=$1 AND shop_id=$2',[req.params.roId,req.user.shop_id])) throw fail('RO not found.',404);
    res.json({parts:await dbAll('SELECT * FROM parts_orders WHERE ro_id=$1 AND shop_id=$2 ORDER BY created_at ASC',[req.params.roId,req.user.shop_id])});
  } catch(e) {error(res,e);}
});
router.get('/all-pending', async (req,res) => {
  try {
    res.json({parts:await dbAll(`SELECT p.*,r.ro_number,c.name AS customer_name,v.year,v.make,v.model
      FROM parts_orders p JOIN repair_orders r ON p.ro_id=r.id AND p.shop_id=r.shop_id
      LEFT JOIN customers c ON r.customer_id=c.id AND c.shop_id=r.shop_id
      LEFT JOIN vehicles v ON r.vehicle_id=v.id AND v.shop_id=r.shop_id
      WHERE p.shop_id=$1 AND p.status=ANY($2::text[]) AND COALESCE(NULLIF(LOWER(TRIM(r.status)), ''), 'intake') NOT IN ('closed','completed','total_loss')
      ORDER BY p.expected_date ASC NULLS LAST,p.created_at ASC`,[req.user.shop_id,PENDING])});
  } catch(e) {error(res,e);}
});
router.get('/:id/delivery-history', async (req,res) => {
  try {
    if(!await dbGet('SELECT id FROM parts_orders WHERE id=$1 AND shop_id=$2',[req.params.id,req.user.shop_id])) throw fail('Part not found.',404);
    res.json({events:await dbAll('SELECT revision,source,before_state,after_state,created_at FROM parts_delivery_events WHERE part_id=$1 AND shop_id=$2 ORDER BY revision DESC LIMIT 50',[req.params.id,String(req.user.shop_id)])});
  } catch(e) {error(res,e);}
});
router.post('/ro/:roId', async (req,res) => {
  try {res.status(201).json(await savePart(pool,req.user.shop_id,req.user.id,req.body,{roId:req.params.roId}));} catch(e) {error(res,e);}
});
router.put('/:id', async (req,res) => {
  try {res.json(await savePart(pool,req.user.shop_id,req.user.id,req.body,{id:req.params.id}));} catch(e) {error(res,e);}
});
router.put('/:id/delivery', async (req,res) => {
  try {res.json(await savePart(pool,req.user.shop_id,req.user.id,req.body,{id:req.params.id,requireRevision:true}));} catch(e) {error(res,e);}
});
router.delete('/:id', async (req,res) => {
  try {await dbRun('DELETE FROM parts_orders WHERE id=$1 AND shop_id=$2',[req.params.id,req.user.shop_id]);res.json({ok:true});} catch(e) {error(res,e);}
});
module.exports=router;
