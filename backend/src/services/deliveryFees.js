const { dbGet } = require('../db');

const DEFAULT_SETTINGS = Object.freeze({
  fee_type: 'flat',
  flat_fee: 0,
  per_mile_rate: 0,
  default_zone_fee: 0,
  zone_fees: {},
});

function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function toMoney(value) {
  return Math.round(toNumber(value, 0) * 100) / 100;
}

function toBool(value) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value > 0;
  const normalized = String(value || '').trim().toLowerCase();
  return ['1', 'true', 'yes', 'y', 'on'].includes(normalized);
}

function parseZoneFees(rawValue) {
  if (!rawValue) return {};
  let parsed = rawValue;
  if (typeof rawValue === 'string') {
    try {
      parsed = JSON.parse(rawValue);
    } catch {
      return {};
    }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};

  const normalized = {};
  for (const [zone, fee] of Object.entries(parsed)) {
    const key = String(zone || '').trim();
    if (!key) continue;
    normalized[key] = Math.max(0, toMoney(fee));
  }
  return normalized;
}

function normalizeSettings(row) {
  const feeType = String(row?.fee_type || DEFAULT_SETTINGS.fee_type).trim().toLowerCase();
  const normalizedType = ['flat', 'per_mile', 'zone'].includes(feeType) ? feeType : DEFAULT_SETTINGS.fee_type;
  return {
    fee_type: normalizedType,
    flat_fee: Math.max(0, toMoney(row?.flat_fee)),
    per_mile_rate: Math.max(0, toMoney(row?.per_mile_rate)),
    default_zone_fee: Math.max(0, toMoney(row?.default_zone_fee)),
    zone_fees: parseZoneFees(row?.zone_fees),
  };
}

async function getDeliveryFeeSettings(shopId) {
  if (!shopId) return { ...DEFAULT_SETTINGS };
  try {
    const row = await dbGet(
      `SELECT fee_type, flat_fee, per_mile_rate, default_zone_fee, zone_fees
       FROM delivery_fee_settings
       WHERE shop_id = $1`,
      [shopId]
    );
    if (!row) return { ...DEFAULT_SETTINGS };
    return normalizeSettings(row);
  } catch (err) {
    // Graceful fallback when migrations have not run yet.
    if (String(err.message || '').toLowerCase().includes('delivery_fee_settings')) {
      return { ...DEFAULT_SETTINGS };
    }
    throw err;
  }
}

function computeLegFee(leg, settings) {
  const enabled = toBool(leg?.enabled);
  const miles = Math.max(0, toMoney(leg?.miles));
  const zone = String(leg?.zone || '').trim();

  if (!enabled) {
    return {
      enabled: false,
      miles,
      zone,
      method: 'none',
      amount: 0,
    };
  }

  if (settings.fee_type === 'per_mile') {
    const amount = toMoney(miles * settings.per_mile_rate);
    return {
      enabled: true,
      miles,
      zone,
      method: 'per_mile',
      rate: settings.per_mile_rate,
      amount,
    };
  }

  if (settings.fee_type === 'zone') {
    const zoneFee = zone && Object.prototype.hasOwnProperty.call(settings.zone_fees, zone)
      ? settings.zone_fees[zone]
      : settings.default_zone_fee;
    return {
      enabled: true,
      miles,
      zone,
      method: 'zone',
      applied_zone: zone || 'default',
      amount: toMoney(zoneFee),
    };
  }

  return {
    enabled: true,
    miles,
    zone,
    method: 'flat',
    amount: toMoney(settings.flat_fee),
  };
}

async function calculateDeliveryFeeBreakdown(ro) {
  if (!ro?.shop_id) {
    return {
      ...DEFAULT_SETTINGS,
      delivery: { enabled: false, method: 'none', miles: 0, zone: '', amount: 0 },
      pickup: { enabled: false, method: 'none', miles: 0, zone: '', amount: 0 },
      total_fee: 0,
    };
  }

  const settings = await getDeliveryFeeSettings(ro.shop_id);
  const delivery = computeLegFee(
    {
      enabled: ro.delivery_required,
      miles: ro.delivery_miles,
      zone: ro.delivery_zone,
    },
    settings
  );
  const pickup = computeLegFee(
    {
      enabled: ro.pickup_required,
      miles: ro.pickup_miles,
      zone: ro.pickup_zone,
    },
    settings
  );
  const totalFee = toMoney(delivery.amount + pickup.amount);

  return {
    ...settings,
    delivery,
    pickup,
    total_fee: totalFee,
  };
}

module.exports = {
  DEFAULT_SETTINGS,
  toMoney,
  getDeliveryFeeSettings,
  calculateDeliveryFeeBreakdown,
};
