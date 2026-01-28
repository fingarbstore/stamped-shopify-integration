// api/coupons.js
// Uses correct endpoint + filter rewards API from Stamped support
// https://developers.stamped.io/reference/loyalty-reports-rewards

const https = require('https');

module.exports = async (req, res) => {
  // CORS
  const allowedOrigins = [
    'https://couvertureandthegarbstore.com',
    'https://www.couvertureandthegarbstore.com'
  ];
  
  const origin = req.headers.origin;
  if (allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const { shopifyId, debug } = req.query;
  
  if (!shopifyId) {
    return res.status(400).json({ 
      error: 'shopifyId parameter required'
    });
  }

  try {
    // First, lookup customer to get their Stamped customerId
    const customer = await lookupCustomer(shopifyId);
    
    if (!customer || !customer.customerId) {
      return res.status(404).json({
        success: false,
        error: 'Customer not found in Stamped'
      });
    }

    // Then get their rewards/coupons using filter API
    const rewards = await getCustomerRewards(customer.customerId);
    
    if (debug === 'true') {
      return res.status(200).json({
        debug: true,
        customer: {
          shopifyId: customer.shopifyId,
          customerId: customer.customerId,
          email: customer.email
        },
        rawRewards: rewards
      });
    }
    
    // Format coupons
    const now = new Date();
    const formatted = rewards.map(reward => {
      const expiryDate = reward.expiresAt ? new Date(reward.expiresAt) : null;
      const daysUntilExpiry = expiryDate ? Math.ceil((expiryDate - now) / (1000 * 60 * 60 * 24)) : null;
      
      return {
        id: reward.id,
        code: reward.couponCode || reward.code,
        rewardName: reward.name || reward.rewardName,
        discountType: reward.discountType,
        discountValue: reward.discountValue,
        discountText: reward.discountType === 'percentage' 
          ? `${reward.discountValue}% off`
          : `£${reward.discountValue} off`,
        pointsRedeemed: reward.pointsRedeemed || reward.points,
        expiresAt: reward.expiresAt,
        expiryDate: expiryDate ? expiryDate.toISOString() : null,
        expiryDateFormatted: expiryDate ? expiryDate.toLocaleDateString('en-GB', {
          day: 'numeric',
          month: 'short',
          year: 'numeric'
        }) : 'No expiry',
        daysUntilExpiry: daysUntilExpiry,
        isExpiringSoon: daysUntilExpiry !== null && daysUntilExpiry > 0 && daysUntilExpiry <= 7,
        isExpired: daysUntilExpiry !== null && daysUntilExpiry < 0,
        used: reward.used || reward.status === 'used',
        usedAt: reward.usedAt || null,
        createdAt: reward.createdAt || reward.dateCreated
      };
    });

    // Separate into categories
    const active = formatted.filter(c => !c.used && !c.isExpired);
    const used = formatted.filter(c => c.used);
    const expired = formatted.filter(c => c.isExpired && !c.used);

    res.status(200).json({
      success: true,
      data: {
        all: formatted,
        active: active,
        used: used,
        expired: expired,
        counts: {
          total: formatted.length,
          active: active.length,
          used: used.length,
          expired: expired.length
        }
      }
    });

  } catch (error) {
    console.error('Coupons API Error:', error.message);
    
    res.status(error.statusCode || 500).json({
      success: false,
      error: error.message,
      code: error.code || 'INTERNAL_ERROR'
    });
  }
};

function lookupCustomer(shopifyId) {
  return new Promise((resolve, reject) => {
    const shopId = process.env.STAMPED_STORE_HASH;
    const publicKey = process.env.STAMPED_PUBLIC_KEY;
    const privateKey = process.env.STAMPED_PRIVATE_KEY;

    if (!shopId || !publicKey || !privateKey) {
      return reject(new Error('Missing Stamped API credentials'));
    }

    const options = {
      hostname: 'stamped.io',
      path: `/api/v3/merchant/shops/${shopId}/customers/lookup?shopifyId=${encodeURIComponent(shopifyId)}&shopId=${encodeURIComponent(shopId)}`,
      method: 'GET',
      auth: `${publicKey}:${privateKey}`,
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json'
      }
    };

    console.log('Looking up customer...');

    const request = https.request(options, (response) => {
      let data = '';
      
      response.on('data', (chunk) => {
        data += chunk;
      });
      
      response.on('end', () => {
        if (response.statusCode === 200) {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(new Error('Invalid JSON'));
          }
        } else if (response.statusCode === 404) {
          reject(new Error('Customer not found'));
        } else {
          reject(new Error(`API returned ${response.statusCode}`));
        }
      });
    });

    request.on('error', reject);
    request.setTimeout(15000, () => {
      request.destroy();
      reject(new Error('Timeout'));
    });
    request.end();
  });
}

function getCustomerRewards(customerId) {
  return new Promise((resolve, reject) => {
    const shopId = process.env.STAMPED_STORE_HASH;
    const publicKey = process.env.STAMPED_PUBLIC_KEY;
    const privateKey = process.env.STAMPED_PRIVATE_KEY;

    if (!shopId || !publicKey || !privateKey) {
      return reject(new Error('Missing Stamped API credentials'));
    }

    // Use filter rewards API endpoint
    const options = {
      hostname: 'stamped.io',
      path: `/api/v3/merchant/shops/${shopId}/loyalty/reports/rewards?customerId=${encodeURIComponent(customerId)}`,
      method: 'GET',
      auth: `${publicKey}:${privateKey}`,
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json'
      }
    };

    console.log('Fetching customer rewards:', options.path);

    const request = https.request(options, (response) => {
      let data = '';
      
      response.on('data', (chunk) => {
        data += chunk;
      });
      
      response.on('end', () => {
        console.log('Rewards response status:', response.statusCode);

        if (response.statusCode === 200) {
          try {
            const parsed = JSON.parse(data);
            // Response might be { data: [...] } or just [...]
            const rewards = parsed.data || parsed.rewards || parsed;
            resolve(Array.isArray(rewards) ? rewards : []);
          } catch (e) {
            reject(new Error('Invalid JSON'));
          }
        } else if (response.statusCode === 404) {
          resolve([]); // No rewards found
        } else {
          reject(new Error(`API returned ${response.statusCode}`));
        }
      });
    });

    request.on('error', reject);
    request.setTimeout(15000, () => {
      request.destroy();
      reject(new Error('Timeout'));
    });
    request.end();
  });
}
