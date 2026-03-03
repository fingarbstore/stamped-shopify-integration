const https = require('https');

const HOST = 'stamped-shopify-integration-l8dp.vercel.app';

function internalGet(path) {
  return new Promise((resolve, reject) => {
    https.get({
      hostname: HOST,
      path,
      headers: { 'Content-Type': 'application/json' }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch { resolve({ success: false }); }
      });
    }).on('error', reject);
  });
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { shopifyId, email } = req.query;
  if (!shopifyId && !email) {
    return res.status(400).json({ success: false, error: 'shopifyId or email required' });
  }

  const params = shopifyId
    ? `shopifyId=${shopifyId}`
    : `email=${encodeURIComponent(email)}`;

  const [customerResult, couponsResult, expiryResult] = await Promise.all([
    internalGet(`/api/customer?${params}`),
    internalGet(`/api/coupons?${params}`),
    internalGet(`/api/points-expiry?${params}`)
  ]);

  if (!customerResult.success) {
    return res.status(404).json({ success: false, error: 'Customer not found' });
  }

  return res.status(200).json({
    success: true,
    data: {
      customer: customerResult.data || null,
      coupons:  couponsResult.data  || null,
      expiry:   expiryResult.data   || null
    }
  });
};
