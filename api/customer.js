// api/customer.js
// Fixed to match the exact working example from Stamped docs
// stamped.lookupCustomer({shopifyId: '7018143973476', shopId: '236485'})

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
        requestDetails: {
          endpoint: `/api/v3/loyalty/${process.env.STAMPED_STORE_HASH}/customers/lookup`,
          queryParams: {
            shopifyId: shopifyId,
            shopId: process.env.STAMPED_STORE_HASH
          },
          headers: {
            'stamped-api-key': '***' + process.env.STAMPED_PRIVATE_KEY?.slice(-4)
          }
        }
      });
    }
    
    // Format response
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
    console.error('Error details:', error);
    
    res.status(error.statusCode || 500).json({
      success: false,
      error: error.message,
      code: error.code || 'INTERNAL_ERROR',
      statusCode: error.statusCode,
      body: error.body || null
    });
  }
};

function lookupCustomer(shopifyId) {
  return new Promise((resolve, reject) => {
    const shopId = process.env.STAMPED_STORE_HASH;
    const apiKey = process.env.STAMPED_PRIVATE_KEY;

    if (!shopId || !apiKey) {
      return reject(new Error('Missing Stamped API credentials'));
    }

    // IMPORTANT: Include BOTH shopifyId AND shopId in query parameters
    // This matches the working example: lookupCustomer({shopifyId: 'X', shopId: 'Y'})
    const queryParams = [
      `shopifyId=${encodeURIComponent(shopifyId)}`,
      `shopId=${encodeURIComponent(shopId)}`
    ].join('&');

    const options = {
      hostname: 'stamped.io',
      path: `/api/v3/loyalty/${shopId}/customers/lookup?${queryParams}`,
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'stamped-api-key': apiKey
      }
    };

    console.log('=== STAMPED API REQUEST ===');
    console.log('URL:', `https://${options.hostname}${options.path}`);
    console.log('Headers:', {
      'Accept': options.headers['Accept'],
      'Content-Type': options.headers['Content-Type'],
      'stamped-api-key': apiKey.substring(0, 10) + '...'
    });

    const request = https.request(options, (response) => {
      let data = '';
      
      response.on('data', (chunk) => {
        data += chunk;
      });
      
      response.on('end', () => {
        console.log('=== STAMPED API RESPONSE ===');
        console.log('Status:', response.statusCode);
        console.log('Headers:', JSON.stringify(response.headers, null, 2));
        console.log('Body (first 1000 chars):', data.substring(0, 1000));
        
        if (response.statusCode === 200) {
          try {
            const parsed = JSON.parse(data);
            console.log('✅ Successfully parsed JSON');
            resolve(parsed);
          } catch (e) {
            console.error('❌ Failed to parse JSON:', e.message);
            const error = new Error('Invalid JSON response from Stamped V3 API');
            error.body = data;
            reject(error);
          }
        } else if (response.statusCode === 404) {
          console.error('❌ Customer not found (404)');
          const error = new Error('Customer not found in Stamped');
          error.statusCode = 404;
          error.code = 'CUSTOMER_NOT_FOUND';
          error.body = data;
          reject(error);
        } else if (response.statusCode === 401 || response.statusCode === 403) {
          console.error('❌ Authentication failed:', response.statusCode);
          const error = new Error('Authentication failed. Check STAMPED_PRIVATE_KEY');
          error.statusCode = response.statusCode;
          error.code = 'AUTH_FAILED';
          error.body = data;
          reject(error);
        } else {
          console.error('❌ Unexpected status:', response.statusCode);
          const error = new Error(`Stamped API returned ${response.statusCode}`);
          error.statusCode = response.statusCode;
          error.body = data;
          reject(error);
        }
      });
    });

    request.on('error', (error) => {
      console.error('❌ Network error:', error);
      reject(new Error(`Network error: ${error.message}`));
    });

    request.setTimeout(15000, () => {
      console.error('❌ Request timeout');
      request.destroy();
      reject(new Error('Request timeout after 15 seconds'));
    });

    request.end();
  });
}
