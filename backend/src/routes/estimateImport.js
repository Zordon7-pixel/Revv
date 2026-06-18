const router = require('express').Router();
const multer = require('multer');
const { XMLValidator } = require('fast-xml-parser');
const auth = require('../middleware/auth');
const { requireTechnician } = require('../middleware/roles');
const roLimitGuard = require('../middleware/roLimitGuard');
const { parseBms } = require('../lib/bmsParser');
const { insuranceOcrLimiter } = require('./insuranceOcr');
const { importEstimateHandler } = require('./ros');

const MAX_BMS_UPLOAD_BYTES = 5 * 1024 * 1024;
const MAX_BMS_LINE_ITEMS = 300;

function isAllowedXmlFile(file) {
  const mimeType = String(file?.mimetype || '').toLowerCase();
  const filename = String(file?.originalname || '').toLowerCase();
  return (
    mimeType === 'application/xml'
    || mimeType === 'text/xml'
    || mimeType === 'application/octet-stream'
    || filename.endsWith('.xml')
  );
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_BMS_UPLOAD_BYTES },
  fileFilter: (_req, file, cb) => {
    if (isAllowedXmlFile(file)) return cb(null, true);
    return cb(new Error('Unsupported BMS file type. Upload a CIECA BMS XML file.'));
  },
});

function uploadBms(req, res, next) {
  upload.single('bms_file')(req, res, (err) => {
    if (!err) return next();
    const isSizeError = err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE';
    return res.status(400).json({
      success: false,
      error: isSizeError ? 'BMS XML file is too large. Upload a file under 5MB.' : err.message,
    });
  });
}

function safeParseError(err) {
  const message = String(err?.message || '').trim();
  if (!message) return 'Could not parse BMS XML file.';
  if (/entity|doctype|xxe|external|system|public/i.test(message)) {
    return 'Invalid BMS XML file.';
  }
  return 'Could not parse BMS XML file.';
}

function validateXmlBuffer(buffer) {
  const xml = Buffer.isBuffer(buffer) ? buffer.toString('utf8') : String(buffer || '');
  if (!xml.trim().startsWith('<')) throw new Error('Invalid XML file');
  if (/<!DOCTYPE/i.test(xml)) throw new Error('DOCTYPE declarations are not allowed');
  const result = XMLValidator.validate(xml, {
    allowBooleanAttributes: true,
  });
  if (result !== true) {
    const message = result?.err?.msg || 'Invalid XML file';
    throw new Error(message);
  }
}

function normalizeParsedForImport(parsed) {
  const estimate = parsed && typeof parsed === 'object' ? parsed : {};
  return {
    customer: {
      name: estimate.customer_name || null,
      phone: estimate.customer_phone || null,
    },
    vehicle: {
      year: estimate.vehicle_year || null,
      make: estimate.vehicle_make || null,
      model: estimate.vehicle_model || null,
      vin: estimate.vin || null,
    },
    insurance: {
      company: estimate.insurance_company || null,
      claim_number: estimate.claim_number || null,
      adjuster_name: estimate.adjuster_name || null,
      adjuster_phone: estimate.adjuster_phone || null,
      adjuster_email: estimate.adjuster_email || null,
      deductible: estimate.estimate_totals?.deductible ?? null,
    },
    line_items: Array.isArray(estimate.line_items) ? estimate.line_items : [],
    notes: 'Created from CIECA BMS estimate import',
  };
}

router.post('/parse-bms', auth, insuranceOcrLimiter, uploadBms, (req, res) => {
  try {
    if (!req.file?.buffer) {
      return res.status(400).json({ success: false, error: 'BMS XML file is required.' });
    }
    validateXmlBuffer(req.file.buffer);
    const parsed = parseBms(req.file.buffer);
    if (Array.isArray(parsed.line_items) && parsed.line_items.length > MAX_BMS_LINE_ITEMS) {
      return res.status(400).json({ success: false, error: 'Too many line items in BMS XML file.' });
    }
    return res.json({ success: true, parsed });
  } catch (err) {
    return res.status(400).json({ success: false, error: safeParseError(err) });
  }
});

router.post('/create', auth, requireTechnician, insuranceOcrLimiter, roLimitGuard, async (req, res) => {
  const parsed = req.body?.parsed || req.body;
  const lineItems = Array.isArray(parsed?.line_items) ? parsed.line_items : [];
  if (lineItems.length > MAX_BMS_LINE_ITEMS) {
    return res.status(400).json({ error: 'Too many line items' });
  }
  req.body = normalizeParsedForImport(parsed);
  return importEstimateHandler(req, res);
});

module.exports = router;
