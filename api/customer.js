// api/customer.js
// Correct implementation for Stamped Loyalty 2.0 V3 API
// Based on: https://developers.stamped.io/reference/lookupcustomer

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

  const { email, debug } = req.query;
  
  if (!email) {
    return res.status(400).json({ 
      error: 'Email parameter required',
      usage: '/api/customer?email=customer@email.com'
    });
  }

  try {
    const stampedData = await lookupCustomer(email);
    
    // If debug mode, return raw response
    if (debug === 'true') {
      return res.status(200).json({
        debug: true,
        rawStampedResponse: stampedData,
        endpoint: `/api/v3/loyalty/${process.env.STAMPED_STORE_HASH}/customers/lookup`,
        environmentVars: {
          shopId: process.env.STAMPED_STORE_HASH,
          apiKeyExists: !!process.env.STAMPED_PRIVATE_KEY
        }
      });
    }
    
    // Format response according to V3 API structure
    const response = {
      success: true,
      data: {
        email: stampedData.email || email,
        customerId: stampedData.id,
        externalCustomerId: stampedData.externalCustomerId,
        points: {
          balance: stampedData.pointsBalance || 0,
          earned: stampedData.pointsEarned || 0,
          redeemed: stampedData.pointsRedeemed || 0,
          pending: stampedData.pointsPending || 0
        },
        tier: {
          id: stampedData.loyaltyTierId || null,
          name: stampedData.loyaltyTierName || 'Member'
        },
        stats: {
          totalOrders: stampedData.totalOrders || 0,
          totalSpent: stampedData.totalSpent || 0
        }
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

function lookupCustomer(email) {
  return new Promise((resolve, reject) => {
    const shopId = process.env.STAMPED_STORE_HASH;
    const apiKey = process.env.STAMPED_PRIVATE_KEY;

    if (!shopId || !apiKey) {
      return reject(new Error('Missing Stamped API credentials. Set STAMPED_STORE_HASH and STAMPED_PRIVATE_KEY in Vercel environment variables.'));
    }

    // Official V3 API endpoint from Stamped documentation
    const options = {
      hostname: 'stamped.io',
      path: `/api/v3/loyalty/${shopId}/customers/lookup?email=${encodeURIComponent(email)}`,
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'stamped-api-key': apiKey  // V3 authentication
      }
    };

    console.log('Stamped V3 API Request:', options.method, `https://${options.hostname}${options.path}`);
    console.log('API Key length:', apiKey?.length, 'Shop ID:', shopId);

    const request = https.request(options, (response) => {
      let data = '';
      
      response.on('data', (chunk) => {
        data += chunk;
      });
      
      response.on('end', () => {
        console.log('Stamped Response Status:', response.statusCode);
        console.log('Stamped Response Headers:', JSON.stringify(response.headers));
        console.log('Stamped Response Body:', data);
        
        if (response.statusCode === 200) {
          try {
            const parsed = JSON.parse(data);
            // V3 API returns data directly, not wrapped in {data: ...}
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
