const https = require('https');

function stampedRequest(path, privateKey) {
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'stamped.io',
      path,
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'stamped-api-key': privateKey
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, body: {} }); }
      });
    });
    req.on('error', reject);
    req.setTimeout(15000, () => { req.destroy(); reject(new Error('Timeout')); });
    req.end();
  });
}

function formatDiscount(reward) {
  const value = reward.value || 0;
  const type = reward.type || '';
  if (type === 'percentage' || type === 'percent') return `${value}% off`;
  if (type === 'fixed' || type === 'fixed-perk') return `£${value} off`;
  if (reward.title && reward.title.toLowerCase().includes('shipping')) return 'Free Shipping';
  return reward.title || `£${value} off`;
}

module.exports = async (req, res) => {
  const allowedOrigins = [
    'https://couvertureandthegarbstore.com',
    'https://www.couvertureandthegarbstore.com',
    'http://localhost:3000'
  ];
  const origin = req.headers.origin;
  if (allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { shopifyId, email } = req.query;
  if (!shopifyId && !email) {
    return res.status(400).json({ success: false, error: 'shopifyId or email required' });
  }

  const PRIVATE_KEY = process.env.STAMPED_PRIVATE_KEY;
  const SHOP_ID = process.env.STAMPED_STORE_HASH;
  if (!PRIVATE_KEY || !SHOP_ID) {
    return res.status(500).json({ success: false, error: 'Missing API credentials' });
  }

  // Step 1: single customer lookup
  const params = shopifyId ? `shopifyId=${shopifyId}` : `email=${encodeURIComponent(email)}`;
  const customerRes = await stampedRequest(
    `/api/v3/merchant/shops/${SHOP_ID}/customers/lookup?${params}`,
    PRIVATE_KEY
  );

  if (customerRes.status !== 200) {
    return res.status(customerRes.status).json({ success: false, error: 'Customer not found' });
  }

  const stampedData = customerRes.body;
  const stampedCustomerId = stampedData.customerId;

  // Use exact same field mapping as your working customer.js
  const loyalty = stampedData.loyalty || {};
  const customerData = {
    email: stampedData.email,
    customerId: stampedCustomerId,
    shopifyId: stampedData.shopifyId,
    firstName: stampedData.firstName,
    lastName: stampedData.lastName,
    points: {
      balance: loyalty.totalPoints || 0,
      earned:  loyalty.totalPointsDebit || 0,
      spent:   loyalty.totalPointsCredit || 0,
      pointsUpdated: loyalty.datePointsUpdated || null
    },
    tier: {
      name: loyalty.vipTier || 'Member',
      lastUpdated: loyalty.dateVipTierUpdated || null
    },
    stats: {
      totalOrders: loyalty.totalOrders || 0,
      totalSpent:  loyalty.totalOrderSpent || 0
    },
    referralCode: stampedData.referralCode || null
  };

  // Step 2: fetch rewards + activities in parallel
  const [rewardsRes, activitiesRes] = await Promise.all([
    stampedRequest(`/api/v3/loyalty/shops/${SHOP_ID}/rewards?limit=100`, PRIVATE_KEY),
    stampedRequest(`/api/v3/loyalty/shops/${SHOP_ID}/activities?customerId=${stampedCustomerId}&limit=50`, PRIVATE_KEY)
  ]);

  // Process coupons — exact same logic as coupons.js
  const now = new Date();
  const allRewards = Array.isArray(rewardsRes.body) ? rewardsRes.body :
                     (rewardsRes.body?.data || rewardsRes.body?.rewards || []);
  const customerRewards = allRewards.filter(r => r.customerId === stampedCustomerId);

  const formatted = customerRewards.map(reward => {
    let parsedExpiry = null;
    if (reward.dateExpire) parsedExpiry = new Date(parseInt(reward.dateExpire));
    const daysUntilExpiry = parsedExpiry && !isNaN(parsedExpiry)
      ? Math.ceil((parsedExpiry - now) / 86400000) : null;
    const isExpired = reward.status === 'expired' || (daysUntilExpiry !== null && daysUntilExpiry < 0);
    const isUsed    = reward.status === 'used' || reward.status === 'redeemed';
    const isValid   = reward.status === 'valid' && !isExpired;
    return {
      id: reward.rewardId,
      code: reward.code,
      title: reward.title,
      description: reward.description,
      type: reward.type,
      value: reward.value,
      discountText: formatDiscount(reward),
      status: reward.status,
      isValid, isExpired, isUsed,
      isExpiringSoon: daysUntilExpiry !== null && daysUntilExpiry > 0 && daysUntilExpiry <= 7,
      expiresAt: parsedExpiry ? parsedExpiry.toISOString() : null,
      expiryDateFormatted: parsedExpiry && !isNaN(parsedExpiry)
        ? parsedExpiry.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
        : 'No expiry',
      daysUntilExpiry,
      createdAt: reward.dateCreated ? new Date(parseInt(reward.dateCreated)).toISOString() : null,
      service: reward.service,
      imageUrl: reward.imageUrl
    };
  });

  const couponsData = {
    all:     formatted,
    active:  formatted.filter(c => c.isValid && !c.isUsed && !c.isExpired),
    used:    formatted.filter(c => c.isUsed),
    expired: formatted.filter(c => c.isExpired && !c.isUsed)
  };
  couponsData.counts = {
    total:   formatted.length,
    active:  couponsData.active.length,
    used:    couponsData.used.length,
    expired: couponsData.expired.length
  };

  // Process expiry — same logic as expiry.js
  let expiryData = { hasExpiry: false };
  try {
    const activities = Array.isArray(activitiesRes.body) ? activitiesRes.body :
                       (activitiesRes.body?.data || activitiesRes.body?.results || []);
    const earningEvents = activities.filter(a => {
      const type = (a.type || a.activityType || '').toLowerCase();
      return !type.includes('redeem') && !type.includes('spent') && !type.includes('expire');
    });
    if (earningEvents.length > 0) {
      const sorted = earningEvents.sort((a, b) =>
        new Date(b.createdAt || b.created_at || b.date || 0) -
        new Date(a.createdAt || a.created_at || a.date || 0)
      );
      const lastDate   = new Date(sorted[0].createdAt || sorted[0].created_at || sorted[0].date);
      const expiryDate = new Date(lastDate);
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
  } catch (e) { /* leave as hasExpiry: false */ }

  return res.status(200).json({
    success: true,
    data: { customer: customerData, coupons: couponsData, expiry: expiryData }
  });
};
