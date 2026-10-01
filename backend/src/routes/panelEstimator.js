'use strict';
const express = require('express');
const n = require('../services/panelEstimatorStore');
const { createPanelEstimatorDraft } = require('../services/panelEstimatorDraft');
const { createPanelEstimatorPresets } = require('../services/panelEstimatorPresets');
const { createPanelEstimatorRevisions } = require('../services/panelEstimatorRevisions');

function createPanelEstimatorRouter({ database, authenticate } = {}) {
  database ??= require('../db');
  authenticate ??= require('../middleware/auth');
  const pool = database.pool ?? database;
  const router = express.Router();
  const store = n.createPanelEstimatorStore(pool);
  const drafts = createPanelEstimatorDraft(pool), presets = createPanelEstimatorPresets(pool);
  const revisions = createPanelEstimatorRevisions(pool);
  const noStore = (req, res, next) => { res.set('Cache-Control', 'no-store'); next(); };
  const author = (req, res, next) => ['owner', 'admin', 'assistant'].includes(req.user?.role)
    ? next() : res.status(403).json({ error: 'FORBIDDEN' });
  const privateAccess = (req, res, next) => ['owner', 'admin'].includes(req.user?.role)
    ? next() : res.status(403).json({ error: 'FORBIDDEN' });
  const scope = req => ({ shopId: req.user.shop_id, roId: req.params.roId });
  const actor = req => ({ shopId: req.user.shop_id, actorId: req.user.id, role: req.user.role });
  const safeCodes = new Set(['INVALID_INPUT', 'INVALID_REFERENCE', 'PRESET_INCOMPATIBLE', 'INVALID_PACKAGE',
    'NOT_FOUND', 'FORBIDDEN', 'VERSION_CONFLICT', 'PRESET_ARCHIVED', 'IDEMPOTENCY_CONFLICT',
    'PREVIEW_CONFLICT', 'REVIEW_REQUIRED', 'SCOPE_RECONCILIATION_REQUIRED', 'LINE_RECONCILIATION_REQUIRED']);
  // Neither database errors nor request payloads are logged or returned.
  const endpoint = fn => async (req, res) => {
    try { await fn(req, res); }
    catch (err) {
      if (['40P01', '40001'].includes(err.code) || (err.code === 'P0001' && err.message === 'PANEL_REVISION_CONFLICT')) {
        return res.status(409).json({ error: 'VERSION_CONFLICT' });
      }
      if (safeCodes.has(err.code)) return res.status(err.status ?? 400).json({ error: err.code });
      if (err instanceof TypeError || err instanceof RangeError || ['22P02', '22003'].includes(err.code)) {
        return res.status(400).json({ error: 'INVALID_INPUT' });
      }
      res.status(500).json({ error: 'PANEL_ESTIMATOR_UNAVAILABLE' });
    }
  };
  function expected(body) {
    n.object(body);
    const version = n.cents(body.expected_version, Number.MAX_SAFE_INTEGER);
    if (version === null) n.invalid();
    return version;
  }
  function draftBody(body) {
    n.object(body);
    // Server tax is authoritative. Other unrecognized request fields are stripped
    // by the same recursive store projection on both save and preview.
    if (Object.hasOwn(body, 'tax_rate_bps') || (body.adjustments && Object.hasOwn(body.adjustments, 'tax_rate_bps'))) n.invalid();
    if (body.scenario && Object.hasOwn(body.scenario, 'carrier_approved')) n.invalid();
    return n.publicSnapshot(body);
  }
  const authorRoute = [noStore, authenticate, author];
  const privateRoute = [...authorRoute, privateAccess];
  router.get('/panel-presets', ...authorRoute, endpoint(async (req, res) => {
    res.json({ presets: await presets.list(actor(req)) });
  }));
  router.post('/panel-presets', ...privateRoute, endpoint(async (req, res) => {
    res.status(201).json(await presets.create({ ...actor(req), body: req.body }));
  }));
  router.post('/panel-presets/:id/versions', ...privateRoute, endpoint(async (req, res) => {
    res.status(201).json(await presets.version({ ...actor(req), familyId: req.params.id, body: req.body }));
  }));
  router.post('/panel-presets/:id/archive', ...privateRoute, endpoint(async (req, res) => {
    n.keys(req.body, ['archived']);
    res.json(await presets.archive({ ...actor(req), familyId: req.params.id, archived: req.body.archived }));
  }));
  router.get('/panel-presets/:id/cost-config', ...privateRoute, endpoint(async (req, res) => {
    res.json(await presets.getPrivate({ ...actor(req), id: req.params.id }));
  }));
  const base = '/:roId/panel-estimator';
  router.get(base, ...authorRoute, endpoint(async (req, res) => {
    const draft = await store.getDraft(scope(req));
    const catalog = await presets.list(actor(req));
    res.json({ ...draft, scenarios: [draft.scenario], presets: catalog, active_revision_id: await revisions.selected(scope(req)) });
  }));
  router.put(`${base}/draft`, ...authorRoute, endpoint(async (req, res) => {
    const expectedVersion = expected(req.body), body = draftBody(req.body);
    const draft = await store.saveDraft({ ...body, ...scope(req), expectedVersion });
    res.json({ ...draft, scenarios: [draft.scenario], active_revision_id: await revisions.selected(scope(req)) });
  }));
  router.post(`${base}/preview`, ...authorRoute, endpoint(async (req, res) => {
    const expectedVersion = expected(req.body), body = draftBody(req.body);
    const result = await drafts.preview({ ...scope(req), expectedVersion, body });
    res.json({ version: result.version, input_hash: result.input_hash, quote: result.sell, review_flags: result.sell.review_flags });
  }));
  router.get(`${base}/cost-summary`, ...privateRoute, endpoint(async (req, res) => {
    if (req.query.revision_id !== undefined) {
      return res.json(await revisions.getCosts({ ...scope(req), ...actor(req), revisionId: req.query.revision_id }));
    }
    const result = await drafts.read(scope(req));
    res.json({ version: result.version, input_hash: result.input_hash, costs: result.costs });
  }));
  router.post(`${base}/commit`, ...authorRoute, endpoint(async (req, res) => {
    res.json(await revisions.commit({ ...scope(req), ...actor(req), body: req.body }));
  }));
  router.get(`${base}/quote`, ...authorRoute, endpoint(async (req, res) => {
    res.json(await revisions.getQuote({ ...scope(req), ...actor(req), revisionId: req.query.revision_id }));
  }));
  router.put(`${base}/cost-settings`, ...privateRoute, endpoint(async (req, res) => {
    const expectedVersion = expected(req.body);
    const reason = n.requiredText(req.body.reason, 4000);
    const result = await store.saveCosts({ ...n.privateSnapshot(req.body), reason, ...scope(req), expectedVersion });
    res.json({ version: result.version });
  }));
  return router;
}
module.exports = { createPanelEstimatorRouter };
