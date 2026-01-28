// api/customer.js
// UPDATED: Provides accurate points breakdown
// - Fetches customer data AND rewards to calculate true redeemed vs expired
// Uses header authentication (stamped-api-key)

const https = require('https');

module.exports = async (req, res) => {
  // CORS headers
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

  const { shopifyId, email, debug } = req.query;
  
  if (!shopifyId && !email) {
    return res.status(400).json({ 
      error: 'shopifyId or email parameter required',
      usage: '/api/customer?shopifyId=7018143973476'
    });
  }

  try {
    // Step 1: Lookup customer
    const stampedData = await lookupCustomer({ shopifyId, email });
    const customerId = stampedData.customerId;
    
    // Step 2: Get rewards to calculate accurate redeemed vs expired
    let rewardsBreakdown = { redeemed: 0, expired: 0, active: 0 };
    if (customerId) {
      rewardsBreakdown = await calculateRewardsBreakdown(customerId);
    }
    
    // If debug mode, return raw response
    if (debug === 'true') {
      return res.status(200).json({
        debug: true,
        rawStampedResponse: stampedData,
        rewardsBreakdown: rewardsBreakdown
      });
    }
    
    // Format response - map Stamped fields to our format
    const loyalty = stampedData.loyalty || {};
    
    // Calculate accurate points
    const totalEarned = loyalty.totalPointsCredit || 0;
    const totalDebited = loyalty.totalPointsDebit || 0;  // This includes BOTH redeemed AND expired
    const currentBalance = loyalty.totalPoints || 0;
    
    const response = {
      success: true,
      data: {
        email: stampedData.email,
        customerId: stampedData.customerId,
        shopifyId: stampedData.shopifyId,
        firstName: stampedData.firstName,
        lastName: stampedData.lastName,
        points: {
          balance: currentBalance,
          earned: totalEarned,
          // Use rewards data for accurate breakdown
          redeemed: rewardsBreakdown.redeemed,
          expired: rewardsBreakdown.expired,
          // Also provide the raw total for reference
          totalDebited: totalDebited
        },
        tier: {
          name: loyalty.vipTier || 'Member',
          lastUpdated: loyalty.dateVipTierUpdated || null
        },
        stats: {
          totalOrders: loyalty.totalOrders || 0,
          totalSpent: loyalty.totalOrderSpent || 0
        },
        referralCode: stampedData.referralCode || null,
        tags: stampedData.tags || [],
        country: stampedData.country || null,
        locale: stampedData.locale || null
      }
    };

    res.status(200).json(response);

  } catch (error) {
    console.error('Stamped API Error:', error.message);
    
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

    // Build query params
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

    console.log('Stamped API Request:', options.path);

    const request = https.request(options, (response) => {
      let data = '';
      
      response.on('data', (chunk) => {
        data += chunk;
      });
      
      response.on('end', () => {
        console.log('Response Status:', response.statusCode);
        
        if (response.statusCode === 200) {
          try {
            const parsed = JSON.parse(data);
            console.log('✅ Customer found:', parsed.email);
            resolve(parsed);
          } catch (e) {
            reject(new Error('Invalid JSON response'));
          }
        } else if (response.statusCode === 404) {
          const error = new Error('Customer not found in Stamped');
          error.statusCode = 404;
          error.code = 'CUSTOMER_NOT_FOUND';
          reject(error);
        } else if (response.statusCode === 401) {
          const error = new Error('Authentication failed');
          error.statusCode = 401;
          error.code = 'AUTH_FAILED';
          reject(error);
        } else {
          const error = new Error(`Stamped API returned ${response.statusCode}`);
          error.statusCode = response.statusCode;
          reject(error);
        }
      });
    });

    request.on('error', reject);
    request.setTimeout(15000, () => {
      request.destroy();
      reject(new Error('Request timeout'));
    });
    request.end();
  });
}

function calculateRewardsBreakdown(customerId) {
  return new Promise((resolve) => {
    const shopId = process.env.STAMPED_STORE_HASH;
    const privateKey = process.env.STAMPED_PRIVATE_KEY;

    if (!shopId || !privateKey) {
      return resolve({ redeemed: 0, expired: 0, active: 0 });
    }

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

    const request = https.request(options, (response) => {
      let data = '';
      
      response.on('data', (chunk) => {
        data += chunk;
      });
      
      response.on('end', () => {
        if (response.statusCode === 200) {
          try {
            const allRewards = JSON.parse(data);
            const customerRewards = Array.isArray(allRewards) 
              ? allRewards.filter(r => r.customerId === customerId)
              : [];
            
            // Calculate points by status
            let redeemed = 0;  // Used rewards
            let expired = 0;   // Expired rewards
            let active = 0;    // Valid/active rewards
            
            customerRewards.forEach(reward => {
              // Get the points value - rewards typically have a "value" field
              // The points spent is usually the reward value or we estimate from the reward
              const pointsValue = parseInt(reward.pointsSpent) || parseInt(reward.points) || 0;
              
              switch (reward.status) {
                case 'used':
                case 'redeemed':
                  redeemed += pointsValue;
                  break;
                case 'expired':
                  expired += pointsValue;
                  break;
                case 'valid':
                case 'active':
                  active += pointsValue;
                  break;
              }
            });
            
            console.log(`✅ Rewards breakdown - Redeemed: ${redeemed}, Expired: ${expired}, Active: ${active}`);
            resolve({ redeemed, expired, active });
          } catch (e) {
            console.error('Error parsing rewards:', e.message);
            resolve({ redeemed: 0, expired: 0, active: 0 });
          }
        } else {
          console.log('Could not fetch rewards for breakdown');
          resolve({ redeemed: 0, expired: 0, active: 0 });
        }
      });
    });

    request.on('error', () => {
      resolve({ redeemed: 0, expired: 0, active: 0 });
    });
    
    request.setTimeout(10000, () => {
      request.destroy();
      resolve({ redeemed: 0, expired: 0, active: 0 });
    });
    
    request.end();
  });
}
