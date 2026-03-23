const crypto = require('crypto');
const { dbGet, dbRun } = require('../db');

const DEFAULT_APP_URL = 'https://revvshop.app';
const TOKEN_URL = 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer';
const REVOKE_URL = 'https://developer.api.intuit.com/v2/oauth2/tokens/revoke';
const STATE_TTL_MS = 10 * 60 * 1000;
const SERVICE_ITEM_NAME = 'REVV Collision Services';

function appUrl() {
  return String(process.env.APP_URL || DEFAULT_APP_URL).replace(/\/+$/, '');
}

function config() {
  const env = String(process.env.QUICKBOOKS_ENV || 'production').toLowerCase() === 'sandbox' ? 'sandbox' : 'production';
  return {
    clientId: process.env.QUICKBOOKS_CLIENT_ID || '',
    clientSecret: process.env.QUICKBOOKS_CLIENT_SECRET || '',
    redirectUri: process.env.QUICKBOOKS_REDIRECT_URI || `${appUrl()}/api/accounting/quickbooks/callback`,
    scope: process.env.QUICKBOOKS_SCOPES || 'com.intuit.quickbooks.accounting',
    environment: env,
    authBase: 'https://appcenter.intuit.com/connect/oauth2',
    apiBase: env === 'sandbox' ? 'https://sandbox-quickbooks.api.intuit.com' : 'https://quickbooks.api.intuit.com',
  };
}

function isConfigured() {
  const cfg = config();
  return !!(cfg.clientId && cfg.clientSecret && cfg.redirectUri);
}

function b64urlEncode(input) {
  return Buffer.from(String(input))
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function b64urlDecode(input) {
  const raw = String(input || '').replace(/-/g, '+').replace(/_/g, '/');
  const padded = raw + '='.repeat((4 - (raw.length % 4)) % 4);
  return Buffer.from(padded, 'base64').toString('utf8');
}

function signState(payload) {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET is required');
  const body = b64urlEncode(JSON.stringify(payload));
  const sig = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  return `${body}.${sig}`;
}

function verifyState(token) {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET is required');
  const [body, sig] = String(token || '').split('.');
  if (!body || !sig) throw new Error('Invalid state');
  const expected = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  if (expected !== sig) throw new Error('Invalid state signature');
  const parsed = JSON.parse(b64urlDecode(body));
  if (!parsed?.shop_id || !parsed?.ts) throw new Error('Invalid state payload');
  if (Date.now() - Number(parsed.ts) > STATE_TTL_MS) throw new Error('State expired');
  return parsed;
}

function connectUrl({ shopId, userId } = {}) {
  if (!shopId || !userId) throw new Error('shopId and userId are required');
  if (!isConfigured()) throw new Error('QuickBooks app is not configured on server');

  const cfg = config();
  const state = signState({
    shop_id: shopId,
    user_id: userId,
    ts: Date.now(),
    nonce: crypto.randomBytes(8).toString('hex'),
  });

  const params = new URLSearchParams({
    client_id: cfg.clientId,
    response_type: 'code',
    scope: cfg.scope,
    redirect_uri: cfg.redirectUri,
    state,
  });
  return `${cfg.authBase}?${params.toString()}`;
}

function tokenExpiry(secondsFromNow) {
  const n = Number(secondsFromNow || 0);
  if (!Number.isFinite(n) || n <= 0) return null;
  return new Date(Date.now() + n * 1000).toISOString();
}

async function exchangeCodeForTokens(code) {
  const cfg = config();
  const basic = Buffer.from(`${cfg.clientId}:${cfg.clientSecret}`).toString('base64');
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code: String(code || ''),
    redirect_uri: cfg.redirectUri,
  });

  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body,
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(json?.error_description || json?.error || 'QuickBooks token exchange failed');
  }
  return json;
}

async function refreshTokens(refreshToken) {
  const cfg = config();
  const basic = Buffer.from(`${cfg.clientId}:${cfg.clientSecret}`).toString('base64');
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: String(refreshToken || ''),
  });

  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body,
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(json?.error_description || json?.error || 'QuickBooks token refresh failed');
  }
  return json;
}

async function saveTokens(shopId, realmId, tokenData = {}) {
  await dbRun(
    `UPDATE shops
     SET quickbooks_company_id = $1,
         quickbooks_realm_id = $1,
         quickbooks_access_token = $2,
         quickbooks_refresh_token = $3,
         quickbooks_token_expires_at = $4,
         quickbooks_refresh_expires_at = $5,
         quickbooks_connected_at = NOW(),
         quickbooks_sync_enabled = COALESCE(quickbooks_sync_enabled, TRUE)
     WHERE id = $6`,
    [
      String(realmId || '').trim() || null,
      tokenData.access_token || null,
      tokenData.refresh_token || null,
      tokenExpiry(tokenData.expires_in),
      tokenExpiry(tokenData.x_refresh_token_expires_in),
      shopId,
    ]
  );
}

async function getConnection(shopId) {
  return dbGet(
    `SELECT
       quickbooks_company_id,
       quickbooks_realm_id,
       quickbooks_access_token,
       quickbooks_refresh_token,
       quickbooks_token_expires_at,
       quickbooks_refresh_expires_at,
       quickbooks_connected_at,
       quickbooks_last_sync_at,
       COALESCE(quickbooks_sync_enabled, FALSE) AS quickbooks_sync_enabled,
       COALESCE(quickbooks_environment, $2) AS quickbooks_environment
     FROM shops
     WHERE id = $1`,
    [shopId, config().environment]
  );
}

async function connectionStatus(shopId) {
  const row = await getConnection(shopId);
  return {
    configured: isConfigured(),
    connected: !!(row?.quickbooks_realm_id && row?.quickbooks_refresh_token),
    environment: row?.quickbooks_environment || config().environment,
    realm_id: row?.quickbooks_realm_id || null,
    token_expires_at: row?.quickbooks_token_expires_at || null,
    refresh_expires_at: row?.quickbooks_refresh_expires_at || null,
    connected_at: row?.quickbooks_connected_at || null,
    last_sync_at: row?.quickbooks_last_sync_at || null,
    sync_enabled: !!row?.quickbooks_sync_enabled,
  };
}

function isExpired(isoValue, safetyMs = 90 * 1000) {
  if (!isoValue) return true;
  const ts = new Date(isoValue).getTime();
  if (!Number.isFinite(ts)) return true;
  return ts <= Date.now() + safetyMs;
}

async function ensureAccessToken(shopId, forceRefresh = false) {
  const row = await getConnection(shopId);
  if (!row?.quickbooks_realm_id || !row?.quickbooks_refresh_token) {
    throw new Error('QuickBooks is not connected for this shop');
  }

  if (!forceRefresh && row.quickbooks_access_token && !isExpired(row.quickbooks_token_expires_at)) {
    return { accessToken: row.quickbooks_access_token, realmId: row.quickbooks_realm_id };
  }

  const refreshed = await refreshTokens(row.quickbooks_refresh_token);
  await saveTokens(shopId, row.quickbooks_realm_id, refreshed);
  return {
    accessToken: refreshed.access_token,
    realmId: row.quickbooks_realm_id,
  };
}

async function qbRequest(shopId, { method = 'GET', path = '', query = null, body = null, retry = true } = {}) {
  const cfg = config();
  const { accessToken, realmId } = await ensureAccessToken(shopId);
  const qs = query ? `?${new URLSearchParams(query).toString()}` : '';
  const url = `${cfg.apiBase}/v3/company/${encodeURIComponent(realmId)}${path}${qs}`;

  const response = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const json = await response.json().catch(() => ({}));
  if (response.status === 401 && retry) {
    await ensureAccessToken(shopId, true);
    return qbRequest(shopId, { method, path, query, body, retry: false });
  }
  if (!response.ok) {
    const fault = json?.Fault?.Error?.[0];
    throw new Error(fault?.Detail || fault?.Message || `QuickBooks API error ${response.status}`);
  }
  return json;
}

function qbLiteral(value) {
  return String(value || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

async function ensureIncomeItem(shopId) {
  const existing = await qbRequest(shopId, {
    path: '/query',
    query: {
      query: `select * from Item where Name = '${qbLiteral(SERVICE_ITEM_NAME)}' maxresults 1`,
      minorversion: '75',
    },
  });
  const current = existing?.QueryResponse?.Item?.[0];
  if (current?.Id) return current.Id;

  const accounts = await qbRequest(shopId, {
    path: '/query',
    query: {
      query: "select * from Account where AccountType = 'Income' and Active = true maxresults 1",
      minorversion: '75',
    },
  });
  const income = accounts?.QueryResponse?.Account?.[0];
  if (!income?.Id) throw new Error('No active income account found in QuickBooks');

  const created = await qbRequest(shopId, {
    method: 'POST',
    path: '/item',
    query: { minorversion: '75' },
    body: {
      Name: SERVICE_ITEM_NAME,
      Type: 'Service',
      IncomeAccountRef: { value: String(income.Id) },
    },
  });
  const id = created?.Item?.Id;
  if (!id) throw new Error('Failed to create QuickBooks service item');
  return id;
}

async function ensureCustomer(shopId, ro) {
  const displayName = String(ro.customer_name || `Customer ${ro.ro_number || ro.id}`).trim().slice(0, 100);
  const existing = await qbRequest(shopId, {
    path: '/query',
    query: {
      query: `select * from Customer where DisplayName = '${qbLiteral(displayName)}' maxresults 1`,
      minorversion: '75',
    },
  });
  const customer = existing?.QueryResponse?.Customer?.[0];
  if (customer?.Id) return customer.Id;

  const payload = { DisplayName: displayName };
  if (ro.customer_email) payload.PrimaryEmailAddr = { Address: String(ro.customer_email).trim() };
  if (ro.customer_phone) payload.PrimaryPhone = { FreeFormNumber: String(ro.customer_phone).trim() };
  const created = await qbRequest(shopId, {
    method: 'POST',
    path: '/customer',
    query: { minorversion: '75' },
    body: payload,
  });
  const id = created?.Customer?.Id;
  if (!id) throw new Error('Failed to create QuickBooks customer');
  return id;
}

function buildLines(ro, itemId) {
  const sums = [
    { desc: 'Parts', amount: Number(ro.parts_cost || 0) },
    { desc: 'Labor', amount: Number(ro.labor_cost || 0) },
    { desc: 'Sublet', amount: Number(ro.sublet_cost || 0) },
    { desc: 'Tax', amount: Number(ro.tax || 0) },
  ].filter((x) => Number.isFinite(x.amount) && x.amount > 0);

  const total = Number(ro.total || 0);
  if (!sums.length && total > 0) sums.push({ desc: 'Repair Invoice', amount: total });

  return sums.map((line) => ({
    Amount: Number(line.amount.toFixed(2)),
    Description: line.desc,
    DetailType: 'SalesItemLineDetail',
    SalesItemLineDetail: {
      ItemRef: { value: String(itemId) },
      Qty: 1,
      UnitPrice: Number(line.amount.toFixed(2)),
    },
  }));
}

async function loadRoForSync(shopId, roId) {
  return dbGet(
    `SELECT
       ro.id, ro.ro_number, ro.created_at, ro.actual_delivery,
       ro.parts_cost, ro.labor_cost, ro.sublet_cost, ro.tax, ro.total, ro.notes,
       ro.insurance_company, ro.insurer, ro.claim_number,
       c.name AS customer_name, c.email AS customer_email, c.phone AS customer_phone,
       v.year, v.make, v.model, v.vin
     FROM repair_orders ro
     LEFT JOIN customers c ON c.id = ro.customer_id
     LEFT JOIN vehicles v ON v.id = ro.vehicle_id
     WHERE ro.id = $1 AND ro.shop_id = $2`,
    [roId, shopId]
  );
}

async function findExistingInvoice(shopId, docNumber) {
  const result = await qbRequest(shopId, {
    path: '/query',
    query: {
      query: `select * from Invoice where DocNumber = '${qbLiteral(docNumber)}' maxresults 1`,
      minorversion: '75',
    },
  });
  return result?.QueryResponse?.Invoice?.[0] || null;
}

function plusDaysISO(input, days = 30) {
  const base = input ? new Date(input) : new Date();
  if (Number.isNaN(base.getTime())) return new Date().toISOString().slice(0, 10);
  const due = new Date(base.getTime() + (days * 24 * 60 * 60 * 1000));
  return due.toISOString().slice(0, 10);
}

async function syncInvoiceForRo(shopId, roId) {
  const ro = await loadRoForSync(shopId, roId);
  if (!ro) throw new Error('RO not found');

  const customerId = await ensureCustomer(shopId, ro);
  const itemId = await ensureIncomeItem(shopId);
  const docNumber = String(ro.ro_number || ro.id).slice(0, 21);
  const lines = buildLines(ro, itemId);
  if (!lines.length) throw new Error('RO has no invoice amount to sync');

  const memoBits = [];
  const vehicle = [ro.year, ro.make, ro.model].filter(Boolean).join(' ');
  if (vehicle) memoBits.push(vehicle);
  if (ro.claim_number) memoBits.push(`Claim ${ro.claim_number}`);
  if (ro.insurance_company || ro.insurer) memoBits.push(`Carrier ${ro.insurance_company || ro.insurer}`);

  const payload = {
    CustomerRef: { value: String(customerId) },
    DocNumber: docNumber,
    TxnDate: new Date(ro.created_at || Date.now()).toISOString().slice(0, 10),
    DueDate: plusDaysISO(ro.actual_delivery || ro.created_at, 30),
    Line: lines,
    PrivateNote: memoBits.join(' | ').slice(0, 4000),
  };
  if (ro.customer_email) payload.BillEmail = { Address: String(ro.customer_email).trim() };

  const existing = await findExistingInvoice(shopId, docNumber);
  let response;
  if (existing?.Id && existing?.SyncToken != null) {
    response = await qbRequest(shopId, {
      method: 'POST',
      path: '/invoice',
      query: { minorversion: '75' },
      body: {
        ...payload,
        Id: existing.Id,
        SyncToken: existing.SyncToken,
      },
    });
  } else {
    response = await qbRequest(shopId, {
      method: 'POST',
      path: '/invoice',
      query: { minorversion: '75' },
      body: payload,
    });
  }

  await dbRun('UPDATE shops SET quickbooks_last_sync_at = NOW() WHERE id = $1', [shopId]);
  const invoice = response?.Invoice || null;
  return {
    ok: true,
    ro_id: roId,
    quickbooks_invoice_id: invoice?.Id || null,
    quickbooks_doc_number: invoice?.DocNumber || docNumber,
    total: invoice?.TotalAmt || lines.reduce((s, x) => s + Number(x.Amount || 0), 0),
    updated: !!existing?.Id,
  };
}

async function disconnect(shopId) {
  const row = await getConnection(shopId);
  const token = row?.quickbooks_refresh_token || row?.quickbooks_access_token;

  if (isConfigured() && token) {
    const basic = Buffer.from(`${config().clientId}:${config().clientSecret}`).toString('base64');
    const body = new URLSearchParams({ token: String(token) });
    await fetch(REVOKE_URL, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${basic}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body,
    }).catch(() => {});
  }

  await dbRun(
    `UPDATE shops
     SET quickbooks_company_id = NULL,
         quickbooks_realm_id = NULL,
         quickbooks_access_token = NULL,
         quickbooks_refresh_token = NULL,
         quickbooks_token_expires_at = NULL,
         quickbooks_refresh_expires_at = NULL,
         quickbooks_connected_at = NULL,
         quickbooks_last_sync_at = NULL,
         quickbooks_sync_enabled = FALSE
     WHERE id = $1`,
    [shopId]
  );
  return { ok: true };
}

async function setSyncEnabled(shopId, enabled) {
  await dbRun('UPDATE shops SET quickbooks_sync_enabled = $1 WHERE id = $2', [enabled ? true : false, shopId]);
  return { ok: true, sync_enabled: !!enabled };
}

module.exports = {
  config,
  isConfigured,
  connectUrl,
  verifyState,
  exchangeCodeForTokens,
  saveTokens,
  connectionStatus,
  syncInvoiceForRo,
  disconnect,
  setSyncEnabled,
};

