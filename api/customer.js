// api/customer.js
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
    
    // If debug mode, return RAW Stamped response
    if (debug === 'true') {
      return res.status(200).json({
        debug: true,
        rawStampedResponse: stampedData,
        environmentVars: {
          storeHash: process.env.STAMPED_STORE_HASH,
          publicKeyExists: !!process.env.STAMPED_PUBLIC_KEY,
          privateKeyExists: !!process.env.STAMPED_PRIVATE_KEY
        }
      });
    }
    
    // Format response
    const response = {
      success: true,
      data: {
        email: email,
        points: {
          balance: stampedData.pointsBalance || stampedData.points_balance || 0,
          lifetime: stampedData.pointsLifetime || stampedData.points_lifetime || 0,
          pending: stampedData.pointsPending || stampedData.points_pending || 0,
          expiring: stampedData.pointsExpiring || stampedData.points_expiring || null,
          expiryDate: stampedData.pointsExpiryDate || stampedData.points_expiry_date || null
        },
        tier: {
          current: stampedData.tier?.name || 'Member',
          level: stampedData.tier?.level || 0,
          nextTier: stampedData.tier?.nextTier?.name || null,
          pointsToNext: stampedData.tier?.pointsToNextTier || null
        },
        customerId: stampedData.customerId || stampedData.customer_id,
        rawDataKeys: Object.keys(stampedData) // Show what keys Stamped actually returned
      }
    };

    res.status(200).json(response);

  } catch (error) {
    console.error('Stamped API Error:', error.message);
    
    res.status(error.statusCode || 500).json({
      success: false,
      error: error.message,
      code: error.code || 'INTERNAL_ERROR',
      statusCode: error.statusCode
    });
  }
};

function getStampedCustomer(email) {
  return new Promise((resolve, reject) => {
    const storeHash = process.env.STAMPED_STORE_HASH;
    const publicKey = process.env.STAMPED_PUBLIC_KEY;
    const privateKey = process.env.STAMPED_PRIVATE_KEY;

    console.log('Calling Stamped API with:', {
      storeHash,
      email,
      publicKeyLength: publicKey?.length,
      privateKeyLength: privateKey?.length
    });

    if (!storeHash || !publicKey || !privateKey) {
      return reject(new Error('Missing Stamped API credentials'));
    }

    const options = {
      hostname: 'stamped.io',
      path: `/api/v2/${storeHash}/loyalty/customer?email=${encodeURIComponent(email)}`,
      method: 'GET',
      auth: `${publicKey}:${privateKey}`,
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json'
      }
    };

    console.log('Request URL:', `https://stamped.io${options.path}`);

    const request = https.request(options, (response) => {
      let data = '';
      
      response.on('data', (chunk) => {
        data += chunk;
      });
      
      response.on('end', () => {
        console.log('Stamped Response Status:', response.statusCode);
        console.log('Stamped Response Body:', data);

        if (response.statusCode === 200) {
          try {
            const parsed = JSON.parse(data);
            resolve(parsed);
          } catch (e) {
            reject(new Error('Invalid JSON response from Stamped'));
          }
        } else if (response.statusCode === 404) {
          // Customer not found - return empty data
          console.log('Customer not found in Stamped');
          resolve({ 
            pointsBalance: 0, 
            pointsLifetime: 0,
            customerNotFound: true 
          });
        } else {
          const error = new Error(`Stamped API returned ${response.statusCode}`);
          error.statusCode = response.statusCode;
          error.responseBody = data;
          reject(error);
        }
      });
    });

    request.on('error', (error) => {
      console.error('Request error:', error);
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
