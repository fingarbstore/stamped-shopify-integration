// api/customer.js
// UPDATED: Better debugging and endpoint handling
// Stamped V3 API - Customer Lookup

const https = require('https');

module.exports = async (req, res) => {
  // CORS headers
  const allowedOrigins = [
    'https://couvertureandthegarbstore.com',
    'https://www.couvertureandthegarbstore.com',
    'http://localhost:3000' // For local testing
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
      usage: '/api/customer?shopifyId=7018143973476 or /api/customer?email=test@example.com'
    });
  }

  try {
    const stampedData = await lookupCustomer({ shopifyId, email, debug: debug === 'true' });
    
    // If debug mode, return raw response
    if (debug === 'true') {
      return res.status(200).json({
        debug: true,
        rawStampedResponse: stampedData.raw,
        requestDetails: stampedData.requestDetails,
        endpoint: stampedData.endpoint
      });
    }
    
    // Format response with correct field mapping
    const loyalty = stampedData.loyalty || {};
    
    const response = {
      success: true,
      data: {
        email: stampedData.email,
        customerId: stampedData.customerId || stampedData.id,
        shopifyId: stampedData.shopifyId,
        firstName: stampedData.firstName,
        lastName: stampedData.lastName,
        points: {
          balance: loyalty.totalPoints || loyalty.points || 0,
          earned: loyalty.totalPointsCredit || loyalty.pointsEarned || 0,
          redeemed: loyalty.totalPointsDebit || loyalty.pointsRedeemed || 0
        },
        tier: {
          name: loyalty.vipTier || loyalty.tier || 'Member',
          lastUpdated: loyalty.dateVipTierUpdated || null
        },
        stats: {
          totalOrders: loyalty.totalOrders || 0,
          totalSpent: loyalty.totalOrderSpent || loyalty.totalSpent || 0
        },
        referralCode: stampedData.referralCode || loyalty.referralCode || null
      }
    };

    res.status(200).json(response);

  } catch (error) {
    console.error('Stamped V3 API Error:', error.message);
    
    res.status(error.statusCode || 500).json({
      success: false,
      error: error.message,
      code: error.code || 'INTERNAL_ERROR',
      details: error.details || null
    });
  }
};

function lookupCustomer({ shopifyId, email, debug }) {
  return new Promise((resolve, reject) => {
    const shopId = process.env.STAMPED_STORE_HASH;
    const publicKey = process.env.STAMPED_PUBLIC_KEY;
    const privateKey = process.env.STAMPED_PRIVATE_KEY;

    if (!shopId || !publicKey || !privateKey) {
      const error = new Error('Missing Stamped API credentials');
      error.details = {
        hasShopId: !!shopId,
        hasPublicKey: !!publicKey,
        hasPrivateKey: !!privateKey
      };
      return reject(error);
    }

    // Build query params - try different lookup methods
    let queryParams = [];
    if (shopifyId) {
      queryParams.push(`shopifyId=${encodeURIComponent(shopifyId)}`);
    }
    if (email) {
      queryParams.push(`email=${encodeURIComponent(email)}`);
    }
    
    // Try the lookup endpoint first
    const path = `/api/v3/merchant/shops/${shopId}/customers/lookup?${queryParams.join('&')}`;
    
    const options = {
      hostname: 'stamped.io',
      path: path,
      method: 'GET',
      auth: `${publicKey}:${privateKey}`,
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json'
      }
    };

    const requestDetails = {
      url: `https://${options.hostname}${options.path}`,
      method: options.method,
      auth: `${publicKey.substring(0, 15)}...`,
      shopId: shopId
    };

    console.log('=== Stamped API Request ===');
    console.log('URL:', requestDetails.url);
    console.log('Auth:', requestDetails.auth);

    const request = https.request(options, (response) => {
      let data = '';
      
      response.on('data', (chunk) => {
        data += chunk;
      });
      
      response.on('end', () => {
        console.log('Response Status:', response.statusCode);
        console.log('Response Headers:', JSON.stringify(response.headers, null, 2));
        console.log('Response Body (first 1000 chars):', data.substring(0, 1000));
        
        if (response.statusCode === 200) {
          try {
            const parsed = JSON.parse(data);
            console.log('✅ Successfully retrieved customer data');
            
            if (debug) {
              resolve({
                raw: parsed,
                requestDetails: requestDetails,
                endpoint: path,
                ...parsed
              });
            } else {
              resolve(parsed);
            }
          } catch (e) {
            console.error('❌ JSON parse error:', e.message);
            const error = new Error('Invalid JSON response from Stamped');
            error.details = { rawResponse: data.substring(0, 500) };
            reject(error);
          }
        } else if (response.statusCode === 404) {
          console.error('❌ Customer not found (404)');
          console.error('Response body:', data);
          
          const error = new Error('Customer not found in Stamped. Check if shopifyId is correct.');
          error.statusCode = 404;
          error.code = 'CUSTOMER_NOT_FOUND';
          error.details = {
            searchedWith: { shopifyId, email },
            stampedResponse: data.substring(0, 500),
            hint: 'Ensure the customer exists in Stamped and the ID matches'
          };
          reject(error);
        } else if (response.statusCode === 401 || response.statusCode === 403) {
          console.error('❌ Authentication failed:', response.statusCode);
          const error = new Error('Authentication failed. Check API keys and permissions.');
          error.statusCode = response.statusCode;
          error.code = 'AUTH_FAILED';
          error.details = {
            stampedResponse: data.substring(0, 500),
            hint: 'Verify STAMPED_PUBLIC_KEY and STAMPED_PRIVATE_KEY are correct'
          };
          reject(error);
        } else {
          console.error('❌ Unexpected status:', response.statusCode);
          const error = new Error(`Stamped API returned ${response.statusCode}`);
          error.statusCode = response.statusCode;
          error.details = {
            stampedResponse: data.substring(0, 500)
          };
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
      reject(new Error('Request timeout - Stamped API did not respond in 15 seconds'));
    });

    request.end();
  });
}
