// api/coupons.js
// FIXED: Uses correct endpoint /api/v3/loyalty/shops/{shopId}/rewards
// Then filters by Stamped customerId

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

  const { shopifyId, email, customerId, status, debug } = req.query;
  
  if (!shopifyId && !email && !customerId) {
    return res.status(400).json({ 
      error: 'shopifyId, email, or customerId parameter required',
      usage: '/api/coupons?shopifyId=7018143973476'
    });
  }

  try {
    let stampedCustomerId = customerId;
    let customerData = null;

    // Step 1: If we don't have Stamped customerId, look up the customer first
    if (!stampedCustomerId) {
      console.log('Step 1: Looking up customer by shopifyId/email...');
      customerData = await lookupCustomer({ shopifyId, email });
      stampedCustomerId = customerData.customerId;
      
      if (!stampedCustomerId) {
        return res.status(404).json({
          success: false,
          error: 'Customer found but no customerId returned'
        });
      }
      console.log('Found Stamped customerId:', stampedCustomerId);
    }

    // Step 2: Get all rewards and filter by customerId
    console.log('Step 2: Fetching rewards for customerId:', stampedCustomerId);
    const allRewards = await getAllRewards();
    
    // Step 3: Filter rewards for this customer
    const customerRewards = allRewards.filter(r => r.customerId === stampedCustomerId);
    console.log(`Found ${customerRewards.length} rewards for this customer out of ${allRewards.length} total`);

    if (debug === 'true') {
      return res.status(200).json({
        debug: true,
        customer: customerData ? {
          shopifyId: customerData.shopifyId,
          customerId: stampedCustomerId,
          email: customerData.email
        } : { customerId: stampedCustomerId },
        totalRewardsInSystem: allRewards.length,
        customerRewardsCount: customerRewards.length,
        rawCustomerRewards: customerRewards
      });
    }
    
    // Step 4: Format the rewards
    const now = new Date();
    const formatted = customerRewards.map(reward => {
      // Parse expiry - Stamped returns timestamps in milliseconds
      let parsedExpiry = null;
      if (reward.dateExpire) {
        // Convert from timestamp string to date
        parsedExpiry = new Date(parseInt(reward.dateExpire));
      }
      
      const daysUntilExpiry = parsedExpiry && !isNaN(parsedExpiry) 
        ? Math.ceil((parsedExpiry - now) / (1000 * 60 * 60 * 24)) 
        : null;
      
      // Determine status
      const isExpired = reward.status === 'expired' || (daysUntilExpiry !== null && daysUntilExpiry < 0);
      const isUsed = reward.status === 'used' || reward.status === 'redeemed';
      const isValid = reward.status === 'valid' && !isExpired;
      
      return {
        id: reward.rewardId,
        code: reward.code,
        title: reward.title,
        description: reward.description,
        type: reward.type,
        category: reward.category,
        value: reward.value,
        discountText: formatDiscount(reward),
        status: reward.status,
        isValid: isValid,
        isExpired: isExpired,
        isUsed: isUsed,
        isExpiringSoon: daysUntilExpiry !== null && daysUntilExpiry > 0 && daysUntilExpiry <= 7,
        expiresAt: parsedExpiry ? parsedExpiry.toISOString() : null,
        expiryDateFormatted: parsedExpiry && !isNaN(parsedExpiry)
          ? parsedExpiry.toLocaleDateString('en-GB', {
              day: 'numeric',
              month: 'short',
              year: 'numeric'
            })
          : 'No expiry',
        daysUntilExpiry: daysUntilExpiry,
        createdAt: reward.dateCreated ? new Date(parseInt(reward.dateCreated)).toISOString() : null,
        service: reward.service,
        imageUrl: reward.imageUrl
      };
    });

    // Separate into categories based on status
    const active = formatted.filter(c => c.isValid && !c.isUsed && !c.isExpired);
    const used = formatted.filter(c => c.isUsed);
    const expired = formatted.filter(c => c.isExpired && !c.isUsed);

    // Optional status filter
    let responseData = {
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
    };

    // If status filter requested, only return that category
    if (status === 'active') {
      responseData = { coupons: active, count: active.length };
    } else if (status === 'used') {
      responseData = { coupons: used, count: used.length };
    } else if (status === 'expired') {
      responseData = { coupons: expired, count: expired.length };
    }

    res.status(200).json({
      success: true,
      data: responseData
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

function formatDiscount(reward) {
  const value = reward.value || 0;
  const type = reward.type || '';
  
  if (type === 'percentage' || type === 'percent') {
    return `${value}% off`;
  } else if (type === 'fixed' || type === 'fixed-perk') {
    return `£${value} off`;
  } else if (reward.title && reward.title.toLowerCase().includes('shipping')) {
    return 'Free Shipping';
  } else if (reward.title) {
    return reward.title;
  }
  return `£${value} off`;
}

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
        'stamped-api-key': privateKey
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

function getAllRewards() {
  return new Promise((resolve, reject) => {
    const shopId = process.env.STAMPED_STORE_HASH;
    const privateKey = process.env.STAMPED_PRIVATE_KEY;

    if (!shopId || !privateKey) {
      return reject(new Error('Missing Stamped API credentials'));
    }

    // CORRECT ENDPOINT from Stamped docs
    // GET https://stamped.io/api/v3/loyalty/shops/{shopId}/rewards
    const options = {
      hostname: 'stamped.io',
      path: `/api/v3/loyalty/shops/${shopId}/rewards?limit=100`,
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'stamped-api-key': privateKey
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
            
            // Response is an array directly
            const rewards = Array.isArray(parsed) ? parsed : 
                           (parsed.data ? parsed.data : 
                           (parsed.rewards ? parsed.rewards : []));
            
            console.log(`✅ Retrieved ${rewards.length} total rewards`);
            resolve(rewards);
          } catch (e) {
            console.error('JSON parse error:', e.message);
            reject(new Error('Invalid JSON from rewards API'));
          }
        } else if (response.statusCode === 404) {
          console.log('No rewards found (404)');
          resolve([]);
        } else {
          console.error('Rewards API error:', response.statusCode, data.substring(0, 200));
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
