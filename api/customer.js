// api/customer.js
// FIXED: Uses header authentication (stamped-api-key)
// Stamped V3 API - Customer Lookup

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
    const stampedData = await lookupCustomer({ shopifyId, email });
    
    // If debug mode, return raw response
    if (debug === 'true') {
      return res.status(200).json({
        debug: true,
        rawStampedResponse: stampedData
      });
    }
    
    // Format response - map Stamped fields to our format
    const loyalty = stampedData.loyalty || {};
    
    const response = {
      success: true,
      data: {
        email: stampedData.email,
        customerId: stampedData.customerId,
        shopifyId: stampedData.shopifyId,
        firstName: stampedData.firstName,
        lastName: stampedData.lastName,
        points: {
          balance: loyalty.totalPoints || 0,
          earned: loyalty.totalPointsCredit || 0,
          redeemed: loyalty.totalPointsDebit || 0
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
        'stamped-api-key': privateKey  // CORRECT AUTH METHOD
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
