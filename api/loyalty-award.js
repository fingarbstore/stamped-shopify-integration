// api/loyalty-award.js
// Awards loyalty points to a customer for completing a one-time social/newsletter action.
// POST /api/loyalty-award
// Body: { shopifyId: string, action: string }
//
// Valid actions:
//   social_facebook        → 35 pts  "Liked us on Facebook"
//   social_pinterest       → 35 pts  "Followed on Pinterest"
//   social_instagram_couv  → 35 pts  "Followed @couverture on Instagram"
//   social_instagram_garb  → 35 pts  "Followed @garbstore on Instagram"

const https = require('https');

const ALLOWED_ORIGINS = [
  'https://couvertureandthegarbstore.com',
  'https://www.couvertureandthegarbstore.com',
  'http://localhost:3000'
];

const VALID_ACTIONS = {
  social_facebook:       { points: 35, reason: 'social_facebook — Liked us on Facebook' },
  social_pinterest:      { points: 35, reason: 'social_pinterest — Followed on Pinterest' },
  social_instagram_couv: { points: 35, reason: 'social_instagram_couv — Followed @couverture on Instagram' },
  social_instagram_garb: { points: 35, reason: 'social_instagram_garb — Followed @garbstore on Instagram' }
};

module.exports = async (req, res) => {
  /* CORS */
  const origin = req.headers.origin;
  if (ALLOWED_ORIGINS.includes(origin)) res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { shopifyId, action } = req.body || {};

  if (!shopifyId) return res.status(400).json({ success: false, error: 'shopifyId required' });
  if (!action || !VALID_ACTIONS[action]) {
    return res.status(400).json({ success: false, error: `Invalid action. Valid: ${Object.keys(VALID_ACTIONS).join(', ')}` });
  }

  const { points, reason } = VALID_ACTIONS[action];

  try {
    const customer = await lookupCustomer({ shopifyId });
    const result   = await adjustPoints({ customerId: customer.customerId, points, reason });

    return res.status(200).json({
      success: true,
      action,
      points,
      customerId:  customer.customerId,
      activityId:  result.activityId || null
    });

  } catch (error) {
    console.error('[loyalty-award]', error.message);
    return res.status(error.statusCode || 500).json({
      success: false,
      error: error.message,
      code:   error.code || 'INTERNAL_ERROR'
    });
  }
};

/* ── Customer lookup (shared pattern with customer.js) ─────────────────── */
function lookupCustomer({ shopifyId }) {
  return new Promise((resolve, reject) => {
    const shopId     = process.env.STAMPED_STORE_HASH;
    const privateKey = process.env.STAMPED_PRIVATE_KEY;
    if (!shopId || !privateKey) return reject(new Error('Missing Stamped API credentials'));

    const query = `shopId=${encodeURIComponent(shopId)}&shopifyId=${encodeURIComponent(shopifyId)}`;
    const opts  = {
      hostname: 'stamped.io',
      path:     `/api/v3/merchant/shops/${shopId}/customers/lookup?${query}`,
      method:   'GET',
      headers:  { Accept: 'application/json', 'Content-Type': 'application/json', 'stamped-api-key': privateKey }
    };

    const req = https.request(opts, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        if (res.statusCode === 200) {
          try { resolve(JSON.parse(data)); }
          catch { reject(new Error('Invalid JSON from customer lookup')); }
        } else if (res.statusCode === 404) {
          const e = new Error('Customer not found in Stamped'); e.statusCode = 404; e.code = 'NOT_FOUND'; reject(e);
        } else {
          const e = new Error(`Customer lookup: HTTP ${res.statusCode}`); e.statusCode = res.statusCode; reject(e);
        }
      });
    });
    req.on('error', reject);
    req.setTimeout(15000, () => { req.destroy(); reject(new Error('Customer lookup timeout')); });
    req.end();
  });
}

/* ── Adjust points (Stamped v3) ─────────────────────────────────────────── */
function adjustPoints({ customerId, points, reason }) {
  return new Promise((resolve, reject) => {
    const shopId     = process.env.STAMPED_STORE_HASH;
    const privateKey = process.env.STAMPED_PRIVATE_KEY;
    if (!shopId || !privateKey) return reject(new Error('Missing Stamped API credentials'));

    const body = JSON.stringify({ points, reason });
    const opts  = {
      hostname: 'stamped.io',
      path:     `/api/v3/loyalty/shops/${shopId}/customers/${encodeURIComponent(customerId)}/adjust-points`,
      method:   'POST',
      headers:  {
        Accept:           'application/json',
        'Content-Type':   'application/json',
        'stamped-api-key': privateKey,
        'Content-Length': Buffer.byteLength(body)
      }
    };

    const req = https.request(opts, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        if (res.statusCode === 200 || res.statusCode === 201) {
          try { resolve(JSON.parse(data)); }
          catch { resolve({}); } /* some 200s have no body */
        } else if (res.statusCode === 401) {
          const e = new Error('Stamped authentication failed'); e.statusCode = 401; reject(e);
        } else {
          const e = new Error(`adjust-points: HTTP ${res.statusCode} — ${data}`); e.statusCode = res.statusCode; reject(e);
        }
      });
    });
    req.on('error', reject);
    req.setTimeout(15000, () => { req.destroy(); reject(new Error('adjust-points timeout')); });
    req.write(body);
    req.end();
  });
}
