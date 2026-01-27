// api/customer.js
// Updated for Stamped Loyalty 2.0 (V3 API)
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
    const stampedData = await getStampedCustomer(email);
    
    // If debug mode, return raw response
    if (debug === 'true') {
      return res.status(200).json({
        debug: true,
        rawStampedResponse: stampedData,
        apiVersion: 'V3 (Loyalty 2.0)',
        environmentVars: {
          shopId: process.env.STAMPED_STORE_HASH,
          privateKeyExists: !!process.env.STAMPED_PRIVATE_KEY
        }
      });
    }
    
    // Format response - V3 API has different field names
    const customer = stampedData.data || stampedData;
    
    const response = {
      success: true,
      data: {
        email: email,
        customerId: customer.id || customer.customerId,
        points: {
          balance: customer.pointsBalance || customer.points_balance || 0,
          lifetime: customer.pointsEarned || customer.points_earned || 0,
          pending: customer.pointsPending || customer.points_pending || 0,
          redeemed: customer.pointsRedeemed || customer.points_redeemed || 0
        },
        tier: {
          current: customer.loyaltyTierName || customer.tier?.name || 'Member',
          id: customer.loyaltyTierId || customer.tier?.id || null
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
      apiVersion: 'V3 (Loyalty 2.0)'
    });
  }
};

async function getStampedCustomer(email) {
  const shopId = process.env.STAMPED_STORE_HASH;
  const privateKey = process.env.STAMPED_PRIVATE_KEY;

  if (!shopId || !privateKey) {
    throw new Error('Missing Stamped API credentials');
  }

  // Try V3 API endpoint with proper authentication
  try {
    console.log('Attempting V3 API call for Loyalty 2.0');
    const result = await makeV3Request({
      path: `/api/v3/loyalty/${shopId}/customers/search`,
      method: 'POST',
      body: {
        email: email
      },
      apiKey: privateKey
    });

    if (result && result.data && result.data.length > 0) {
      console.log('Customer found via V3 search endpoint');
      return result.data[0];
    }
  } catch (e) {
    console.log('V3 search failed:', e.message);
  }

  // Try alternative V3 endpoint
  try {
    console.log('Trying alternative V3 endpoint');
    const result = await makeV3Request({
      path: `/api/v3/loyalty/${shopId}/customers?email=${encodeURIComponent(email)}`,
      method: 'GET',
      apiKey: privateKey
    });

    if (result && result.data && result.data.length > 0) {
      console.log('Customer found via V3 GET endpoint');
      return result.data[0];
    }
  } catch (e) {
    console.log('V3 GET failed:', e.message);
  }

  // Try getting customer by querying with filter
  try {
    console.log('Trying V3 with query params');
    const result = await makeV3Request({
      path: `/api/v3/loyalty/${shopId}/customers`,
      method: 'GET',
      queryParams: {
        'filter[email]': email
      },
      apiKey: privateKey
    });

    if (result && result.data && result.data.length > 0) {
      console.log('Customer found via V3 filter');
      return result.data[0];
    }
  } catch (e) {
    console.log('V3 filter failed:', e.message);
  }

  // Customer not found
  const error = new Error('Customer not found in Stamped Loyalty 2.0');
  error.code = 'CUSTOMER_NOT_FOUND';
  error.statusCode = 404;
  throw error;
}

function makeV3Request({ path, method = 'GET', body = null, queryParams = {}, apiKey }) {
  return new Promise((resolve, reject) => {
    // Build query string
    const queryString = Object.keys(queryParams).length > 0
      ? '?' + Object.entries(queryParams).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&')
      : '';

    const options = {
      hostname: 'stamped.io',
      path: path + queryString,
      method: method,
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'stamped-api-key': apiKey  // V3 uses header authentication
      }
    };

    const requestBody = body ? JSON.stringify(body) : null;

    console.log('V3 Request:', method, `https://stamped.io${path}${queryString}`);

    const request = https.request(options, (response) => {
      let data = '';
      
      response.on('data', (chunk) => {
        data += chunk;
      });
      
      response.on('end', () => {
        console.log('V3 Response status:', response.statusCode);
        console.log('V3 Response body:', data.substring(0, 200));
        
        if (response.statusCode === 200) {
          try {
            const parsed = JSON.parse(data);
            resolve(parsed);
          } catch (e) {
            reject(new Error('Invalid JSON response from Stamped V3 API'));
          }
        } else if (response.statusCode === 404) {
          reject(new Error('Endpoint not found'));
        } else if (response.statusCode === 401 || response.statusCode === 403) {
          reject(new Error('Authentication failed - check API key'));
        } else {
          const error = new Error(`Stamped V3 API returned ${response.statusCode}`);
          error.statusCode = response.statusCode;
          error.body = data;
          reject(error);
        }
      });
    });

    request.on('error', (error) => {
      reject(error);
    });

    request.setTimeout(15000, () => {
      request.destroy();
      reject(new Error('Request timeout'));
    });

    if (requestBody) {
      request.write(requestBody);
    }

    request.end();
  });
}
