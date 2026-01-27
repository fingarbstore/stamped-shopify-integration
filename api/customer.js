// api/customer.js
// Correct implementation based on actual Stamped V3 API response
// Endpoint: GET /api/v3/loyalty/{shopId}/customers/lookup

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

  const { email, shopifyId, debug } = req.query;
  
  if (!email && !shopifyId) {
    return res.status(400).json({ 
      error: 'Email or shopifyId parameter required',
      usage: '/api/customer?email=customer@email.com'
    });
  }

  try {
    const stampedData = await lookupCustomer(email, shopifyId);
    
    // If debug mode, return raw response
    if (debug === 'true') {
      return res.status(200).json({
        debug: true,
        rawStampedResponse: stampedData,
        endpoint: `/api/v3/loyalty/${process.env.STAMPED_STORE_HASH}/customers/lookup`,
        queryUsed: email ? `email=${email}` : `shopifyId=${shopifyId}`
      });
    }
    
    // Format response with correct field mapping
    const loyalty = stampedData.loyalty || {};
    
    const response = {
      success: true,
      data: {
        // Customer info
        email: stampedData.email,
        customerId: stampedData.customerId,
        shopifyId: stampedData.shopifyId,
        firstName: stampedData.firstName,
        lastName: stampedData.lastName,
        
        // Points info (from loyalty object)
        points: {
          balance: loyalty.totalPoints || 0,
          earned: loyalty.totalPointsCredit || 0,
          redeemed: loyalty.totalPointsDebit || 0,
          lifetime: loyalty.totalPointsCredit || 0
        },
        
        // Tier info
        tier: {
          name: loyalty.vipTier || 'Member',
          lastUpdated: loyalty.dateVipTierUpdated || null
        },
        
        // Shopping stats
        stats: {
          totalOrders: loyalty.totalOrders || 0,
          totalSpent: loyalty.totalOrderSpent || 0
        },
        
        // Referral
        referralCode: stampedData.referralCode || null,
        
        // Metadata
        dateCreated: stampedData.dateStampedCreated,
        dateUpdated: stampedData.dateStampedUpdated
      }
    };

    res.status(200).json(response);

  } catch (error) {
    console.error('Stamped V3 API Error:', error.message);
    
    res.status(error.statusCode || 500).json({
      success: false,
      error: error.message,
      code: error.code || 'INTERNAL_ERROR',
      hint: error.statusCode === 404 
        ? 'Customer not found in Stamped. They may need to be enrolled in the loyalty program.'
        : error.statusCode === 401
        ? 'Authentication failed. Check your STAMPED_PRIVATE_KEY is correct.'
        : 'Check Vercel logs for details'
    });
  }
};

function lookupCustomer(email, shopifyId) {
  return new Promise((resolve, reject) => {
    const shopId = process.env.STAMPED_STORE_HASH;
    const apiKey = process.env.STAMPED_PRIVATE_KEY;

    if (!shopId || !apiKey) {
      return reject(new Error('Missing Stamped API credentials. Set STAMPED_STORE_HASH and STAMPED_PRIVATE_KEY in Vercel environment variables.'));
    }

    // Build query string - use email or shopifyId
    let queryString;
    if (email) {
      queryString = `email=${encodeURIComponent(email)}`;
    } else if (shopifyId) {
      queryString = `shopifyId=${encodeURIComponent(shopifyId)}`;
    }

    // Official V3 API endpoint
    const options = {
      hostname: 'stamped.io',
      path: `/api/v3/loyalty/${shopId}/customers/lookup?${queryString}`,
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'stamped-api-key': apiKey
      }
    };

    console.log('Stamped V3 API Request:', `https://${options.hostname}${options.path}`);

    const request = https.request(options, (response) => {
      let data = '';
      
      response.on('data', (chunk) => {
        data += chunk;
      });
      
      response.on('end', () => {
        console.log('Stamped Response Status:', response.statusCode);
        console.log('Stamped Response Body (first 500 chars):', data.substring(0, 500));
        
        if (response.statusCode === 200) {
          try {
            const parsed = JSON.parse(data);
            resolve(parsed);
          } catch (e) {
            const error = new Error('Invalid JSON response from Stamped V3 API');
            error.body = data;
            reject(error);
          }
        } else if (response.statusCode === 404) {
          const error = new Error('Customer not found in Stamped');
          error.statusCode = 404;
          error.code = 'CUSTOMER_NOT_FOUND';
          reject(error);
        } else if (response.statusCode === 401 || response.statusCode === 403) {
          const error = new Error('Authentication failed. Check your STAMPED_PRIVATE_KEY.');
          error.statusCode = response.statusCode;
          error.code = 'AUTH_FAILED';
          reject(error);
        } else {
          const error = new Error(`Stamped API returned ${response.statusCode}`);
          error.statusCode = response.statusCode;
          error.body = data;
          reject(error);
        }
      });
    });

    request.on('error', (error) => {
      console.error('Request error:', error);
      reject(new Error(`Network error: ${error.message}`));
    });

    request.setTimeout(15000, () => {
      request.destroy();
      reject(new Error('Request timeout after 15 seconds'));
    });

    request.end();
  });
}
