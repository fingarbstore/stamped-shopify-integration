// api/coupons.js
// FIXED: Uses header authentication (stamped-api-key)
// Stamped V3 API - Customer Rewards/Coupons

const https = require('https');

module.exports = async (req, res) => {
  // CORS
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
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const { shopifyId, email, customerId, debug } = req.query;
  
  if (!shopifyId && !email && !customerId) {
    return res.status(400).json({ 
      error: 'shopifyId, email, or customerId parameter required',
      usage: '/api/coupons?shopifyId=7018143973476'
    });
  }

  try {
    let stampedCustomerId = customerId;
    let customerData = null;

    // If we don't have Stamped customerId, look up the customer first
    if (!stampedCustomerId) {
      console.log('Looking up customer...');
      customerData = await lookupCustomer({ shopifyId, email });
      stampedCustomerId = customerData.customerId;
      
      if (!stampedCustomerId) {
        return res.status(404).json({
          success: false,
          error: 'Customer found but no customerId returned'
        });
      }
    }

    console.log('Fetching rewards for customerId:', stampedCustomerId);

    // Get their rewards/coupons
    const rewards = await getCustomerRewards(stampedCustomerId);
    
    if (debug === 'true') {
      return res.status(200).json({
        debug: true,
        customer: customerData ? {
          shopifyId: customerData.shopifyId,
          customerId: stampedCustomerId,
          email: customerData.email
        } : { customerId: stampedCustomerId },
        rawRewards: rewards
      });
    }
    
    // Format coupons
    const now = new Date();
    const formatted = rewards.map(reward => {
      const expiryDate = reward.expiresAt || reward.expiry || reward.expiryDate;
      const parsedExpiry = expiryDate ? new Date(expiryDate) : null;
      const daysUntilExpiry = parsedExpiry && !isNaN(parsedExpiry) 
        ? Math.ceil((parsedExpiry - now) / (1000 * 60 * 60 * 24)) 
        : null;
      
      const code = reward.couponCode || reward.code || reward.discountCode;
      const discountType = reward.discountType || reward.type || 'fixed';
      const discountValue = reward.discountValue || reward.value || reward.amount || 0;
      
      return {
        id: reward.id || reward.rewardId,
        code: code,
        rewardName: reward.name || reward.rewardName || reward.title,
        discountType: discountType,
        discountValue: discountValue,
        discountText: discountType === 'percentage' || discountType === 'percent'
          ? `${discountValue}% off`
          : `£${discountValue} off`,
        pointsRedeemed: reward.pointsRedeemed || reward.points || reward.pointsCost,
        expiresAt: expiryDate,
        expiryDate: parsedExpiry && !isNaN(parsedExpiry) ? parsedExpiry.toISOString() : null,
        expiryDateFormatted: parsedExpiry && !isNaN(parsedExpiry) 
          ? parsedExpiry.toLocaleDateString('en-GB', {
              day: 'numeric',
              month: 'short',
              year: 'numeric'
            }) 
          : 'No expiry',
        daysUntilExpiry: daysUntilExpiry,
        isExpiringSoon: daysUntilExpiry !== null && daysUntilExpiry > 0 && daysUntilExpiry <= 7,
        isExpired: daysUntilExpiry !== null && daysUntilExpiry < 0,
        used: reward.used || reward.status === 'used' || reward.redeemed === true,
        usedAt: reward.usedAt || reward.redeemedAt || null,
        createdAt: reward.createdAt || reward.dateCreated || reward.created
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

function lookupCustomer({ shopifyId, email }) {
  return new Promise((resolve, reject) => {
    const shopId = process.env.STAMPED_STORE_HASH;
    const privateKey = process.env.STAMPED_PRIVATE_KEY;

    if (!shopId || !privateKey) {
      return reject(new Error('Missing Stamped API credentials'));
    }

    let queryParams = [`shopId=${encodeURIComponent(shopId)}`];
    if (shopifyId) queryParams.push(`shopifyId=${encodeURIComponent(shopifyId)}`);
    if (email) queryParams.push(`email=${encodeURIComponent(email)}`);

    const options = {
      hostname: 'stamped.io',
      path: `/api/v3/merchant/shops/${shopId}/customers/lookup?${queryParams.join('&')}`,
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'stamped-api-key': privateKey  // CORRECT AUTH METHOD
      }
    };

    console.log('Customer lookup:', options.path);

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
            reject(new Error('Invalid JSON from customer lookup'));
          }
        } else if (response.statusCode === 404) {
          const error = new Error('Customer not found in Stamped');
          error.statusCode = 404;
          reject(error);
        } else {
          const error = new Error(`Customer lookup failed: ${response.statusCode}`);
          error.statusCode = response.statusCode;
          reject(error);
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
    const privateKey = process.env.STAMPED_PRIVATE_KEY;

    if (!shopId || !privateKey) {
      return reject(new Error('Missing Stamped API credentials'));
    }

    // Loyalty reports rewards endpoint
    const options = {
      hostname: 'stamped.io',
      path: `/api/v3/merchant/shops/${shopId}/loyalty/reports/rewards?customerId=${encodeURIComponent(customerId)}`,
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'stamped-api-key': privateKey  // CORRECT AUTH METHOD
      }
    };

    console.log('Rewards request:', options.path);

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
            
            // Handle different response formats
            let rewards = [];
            if (Array.isArray(parsed)) {
              rewards = parsed;
            } else if (parsed.data && Array.isArray(parsed.data)) {
              rewards = parsed.data;
            } else if (parsed.rewards && Array.isArray(parsed.rewards)) {
              rewards = parsed.rewards;
            } else if (parsed.results && Array.isArray(parsed.results)) {
              rewards = parsed.results;
            }
            
            console.log(`✅ Found ${rewards.length} rewards`);
            resolve(rewards);
          } catch (e) {
            reject(new Error('Invalid JSON from rewards API'));
          }
        } else if (response.statusCode === 404) {
          // 404 might mean no rewards
          console.log('No rewards found (404)');
          resolve([]);
        } else {
          const error = new Error(`Rewards API returned ${response.statusCode}`);
          error.statusCode = response.statusCode;
          reject(error);
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
