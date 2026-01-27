// api/customer.js
// GET /api/customer?email=customer@email.com
// Returns: points balance, tier, lifetime points

const https = require('https');

module.exports = async (req, res) => {
  // CORS headers - allow your Shopify domain
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
  
  // Handle preflight
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Validate request
  const { email } = req.query;
  
  if (!email) {
    return res.status(400).json({ 
      error: 'Email parameter required',
      usage: '/api/customer?email=customer@email.com'
    });
  }

  try {
    // Call Stamped API
    const stampedData = await getStampedCustomer(email);
    
    // Format response
    const response = {
      success: true,
      data: {
        email: email,
        points: {
          balance: stampedData.pointsBalance || 0,
          lifetime: stampedData.pointsLifetime || 0,
          pending: stampedData.pointsPending || 0,
          expiring: stampedData.pointsExpiring || null,
          expiryDate: stampedData.pointsExpiryDate || null
        },
        tier: {
          current: stampedData.tier?.name || 'Member',
          level: stampedData.tier?.level || 0,
          nextTier: stampedData.tier?.nextTier?.name || null,
          pointsToNext: stampedData.tier?.pointsToNextTier || null
        },
        customerId: stampedData.customerId
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

// Helper function to call Stamped API
function getStampedCustomer(email) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'stamped.io',
      path: `/api/v2/${process.env.STAMPED_STORE_HASH}/loyalty/customer?email=${encodeURIComponent(email)}`,
      method: 'GET',
      auth: `${process.env.STAMPED_PUBLIC_KEY}:${process.env.STAMPED_PRIVATE_KEY}`,
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json'
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
            resolve(JSON.parse(data));
          } catch (e) {
            reject(new Error('Invalid JSON response from Stamped'));
          }
        } else if (response.statusCode === 404) {
          // Customer not found in Stamped
          resolve({ pointsBalance: 0, pointsLifetime: 0 });
        } else {
          const error = new Error(`Stamped API returned ${response.statusCode}`);
          error.statusCode = response.statusCode;
          reject(error);
        }
      });
    });

    request.on('error', (error) => {
      error.code = 'NETWORK_ERROR';
      reject(error);
    });

    request.setTimeout(10000, () => {
      request.destroy();
      reject(new Error('Request timeout'));
    });

    request.end();
  });
}
