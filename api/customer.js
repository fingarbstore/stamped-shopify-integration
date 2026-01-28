// api/customer.js
// CORRECT ENDPOINT from Stamped support:
// https://stamped.io/api/v3/merchant/shops/{shopId}/customers/lookup

const https = require('https');

module.exports = async (req, res) => {
  // CORS headers
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
      error: 'shopifyId parameter required',
      usage: '/api/customer?shopifyId=7018143973476'
    });
  }

  try {
    const stampedData = await lookupCustomer(shopifyId);
    
    // If debug mode, return raw response
    if (debug === 'true') {
      return res.status(200).json({
        debug: true,
        rawStampedResponse: stampedData,
        endpoint: `/api/v3/merchant/shops/${process.env.STAMPED_STORE_HASH}/customers/lookup`,
        auth: 'HTTP Basic Auth (Public:Private)'
      });
    }
    
    // Format response with correct field mapping
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
        referralCode: stampedData.referralCode || null
      }
    };

    res.status(200).json(response);

  } catch (error) {
    console.error('Stamped V3 API Error:', error.message);
    
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

    // CORRECT ENDPOINT from Stamped support
    const options = {
      hostname: 'stamped.io',
      path: `/api/v3/merchant/shops/${shopId}/customers/lookup?shopifyId=${encodeURIComponent(shopifyId)}&shopId=${encodeURIComponent(shopId)}`,
      method: 'GET',
      // HTTP Basic Auth as specified by Stamped support
      auth: `${publicKey}:${privateKey}`,
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json'
      }
    };

    console.log('Stamped API Request:', `https://${options.hostname}${options.path}`);
    console.log('Auth:', `${publicKey.substring(0, 10)}:${privateKey.substring(0, 10)}...`);

    const request = https.request(options, (response) => {
      let data = '';
      
      response.on('data', (chunk) => {
        data += chunk;
      });
      
      response.on('end', () => {
        console.log('Response Status:', response.statusCode);
        console.log('Response Body:', data.substring(0, 500));
        
        if (response.statusCode === 200) {
          try {
            const parsed = JSON.parse(data);
            console.log('✅ Successfully retrieved customer data');
            resolve(parsed);
          } catch (e) {
            console.error('❌ JSON parse error:', e.message);
            reject(new Error('Invalid JSON response'));
          }
        } else if (response.statusCode === 404) {
          console.error('❌ Customer not found (404)');
          const error = new Error('Customer not found in Stamped');
          error.statusCode = 404;
          error.code = 'CUSTOMER_NOT_FOUND';
          reject(error);
        } else if (response.statusCode === 401 || response.statusCode === 403) {
          console.error('❌ Authentication failed:', response.statusCode);
          const error = new Error('Authentication failed. Check API keys.');
          error.statusCode = response.statusCode;
          error.code = 'AUTH_FAILED';
          reject(error);
        } else {
          console.error('❌ Unexpected status:', response.statusCode);
          const error = new Error(`Stamped API returned ${response.statusCode}`);
          error.statusCode = response.statusCode;
          reject(error);
        }
      });
    });

    request.on('error', (error) => {
      console.error('❌ Network error:', error);
      reject(error);
    });

    request.setTimeout(15000, () => {
      console.error('❌ Request timeout');
      request.destroy();
      reject(new Error('Request timeout'));
    });

    request.end();
  });
}
