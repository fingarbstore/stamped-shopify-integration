const https = require('https');

function makeRequest(options, postData = null) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch (e) { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on('error', reject);
    if (postData) req.write(postData);
    req.end();
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

  const PRIVATE_KEY = process.env.STAMPED_PRIVATE_KEY;
  const STORE_HASH  = process.env.STAMPED_STORE_HASH;

  // Step 1: single customer lookup shared by all three data fetches
  let customerRes;
  try {
    const params = shopifyId ? `shopifyId=${shopifyId}` : `email=${encodeURIComponent(email)}`;
    customerRes = await makeRequest({
      hostname: 'stamped.io',
      path: `/api/v3/merchant/shops/${STORE_HASH}/customers/lookup?${params}`,
      method: 'GET',
      headers: { 'stamped-api-key': PRIVATE_KEY, 'Content-Type': 'application/json' }
    });
  } catch (e) {
    return res.status(500).json({ success: false, error: 'Customer lookup failed', detail: e.message });
  }

  if (!customerRes.body || customerRes.status !== 200) {
    return res.status(customerRes.status).json({ success: false, error: 'Customer not found' });
  }

  const customer = customerRes.body;
  const stampedCustomerId = customer.id || customer.customerId;

  // Step 2: fire coupons + expiry in parallel using the resolved customerId
  const [couponsRes, activitiesRes] = await Promise.all([
    makeRequest({
      hostname: 'stamped.io',
      path: `/api/v3/loyalty/shops/${STORE_HASH}/rewards?customerId=${stampedCustomerId}&limit=100`,
      method: 'GET',
      headers: { 'stamped-api-key': PRIVATE_KEY, 'Content-Type': 'application/json' }
    }),
    makeRequest({
      hostname: 'stamped.io',
      path: `/api/v3/loyalty/shops/${STORE_HASH}/activities?customerId=${stampedCustomerId}&limit=50`,
      method: 'GET',
      headers: { 'stamped-api-key': PRIVATE_KEY, 'Content-Type': 'application/json' }
    })
  ]);

  // --- Process customer data ---
  const pointsData = customer.points || {};
  const customerData = {
    email: customer.email,
    customerId: stampedCustomerId,
    shopifyId: customer.shopifyId,
    firstName: customer.firstName,
    lastName: customer.lastName,
    points: {
      balance: pointsData.balance || 0,
      earned:  pointsData.earned  || 0,
      spent:   pointsData.spent   || pointsData.redeemed || 0,
      pointsUpdated: pointsData.pointsUpdated || null
    },
    tier: customer.tier || { name: 'Member' },
    referralCode: customer.referralCode || null,
    stats: customer.stats || {}
  };

  // --- Process coupons ---
  const now = Date.now();
  const allRewards = (couponsRes.body?.results || couponsRes.body?.data || [])
    .filter(r => String(r.customerId) === String(stampedCustomerId) || String(r.customer_id) === String(stampedCustomerId));

  function processCoupon(r) {
    const expiresAt = r.expiresAt || r.expires_at || r.expiry || null;
    const expiryMs  = expiresAt ? (String(expiresAt).length > 10 ? Number(expiresAt) : Number(expiresAt) * 1000) : null;
    const isExpired = expiryMs ? expiryMs < now : false;
    const isUsed    = r.isUsed || r.used || r.status === 'used' || false;
    const daysUntilExpiry = expiryMs ? Math.ceil((expiryMs - now) / 86400000) : null;
    return {
      id: r.id,
      code: r.code || r.couponCode,
      title: r.title || r.name || r.rewardName || 'Reward',
      discountText: r.discountText || '',
      status: isUsed ? 'used' : isExpired ? 'expired' : 'active',
      isExpired, isUsed,
      isExpiringSoon: !isExpired && !isUsed && daysUntilExpiry !== null && daysUntilExpiry <= 7,
      daysUntilExpiry,
      expiresAt: expiryMs ? new Date(expiryMs).toISOString() : null,
      expiryDateFormatted: expiryMs ? new Date(expiryMs).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : 'No expiry'
    };
  }

  const processed = allRewards.map(processCoupon);
  const couponsData = {
    active:  processed.filter(c => c.status === 'active'),
    used:    processed.filter(c => c.status === 'used'),
    expired: processed.filter(c => c.status === 'expired'),
    counts:  { total: processed.length, active: 0, used: 0, expired: 0 }
  };
  couponsData.counts.active  = couponsData.active.length;
  couponsData.counts.used    = couponsData.used.length;
  couponsData.counts.expired = couponsData.expired.length;

  // --- Process expiry ---
  const activities = activitiesRes.body?.results || activitiesRes.body?.data || [];
  const earningEvents = activities.filter(a => {
    const type = (a.type || a.activityType || '').toLowerCase();
    return !type.includes('redeem') && !type.includes('spent') && !type.includes('expire');
  });

  let expiryData = { hasExpiry: false };
  if (earningEvents.length > 0) {
    const sorted = earningEvents.sort((a, b) => {
      const dateA = new Date(a.createdAt || a.created_at || a.date || 0);
      const dateB = new Date(b.createdAt || b.created_at || b.date || 0);
      return dateB - dateA;
    });
    const lastEvent    = sorted[0];
    const lastDate     = new Date(lastEvent.createdAt || lastEvent.created_at || lastEvent.date);
    const expiryDate   = new Date(lastDate);
    expiryDate.setDate(expiryDate.getDate() + 360);
    const daysRemaining = Math.ceil((expiryDate - new Date()) / 86400000);
    expiryData = {
      hasExpiry: true,
      lastEarningDate: lastDate.toISOString(),
      lastEarningDateFormatted: lastDate.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }),
      expiryDate: expiryDate.toISOString(),
      expiryDateFormatted: expiryDate.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }),
      daysRemaining,
      isExpired: daysRemaining <= 0,
      isExpiringSoon: daysRemaining > 0 && daysRemaining <= 30
    };
  }

  return res.status(200).json({
    success: true,
    data: {
      customer: customerData,
      coupons: couponsData,
      expiry: expiryData
    }
  });
};
