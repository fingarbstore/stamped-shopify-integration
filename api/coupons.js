// api/coupons.js
// Correct implementation for Stamped Loyalty 2.0 V3 API
// Based on: https://developers.stamped.io/reference (coupons/redemptions endpoints)

const https = require('https');

module.exports = async (req, res) => {
  // CORS
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
      usage: '/api/coupons?email=customer@email.com'
    });
  }

  try {
    // First, get customer to find their ID
    const customer = await lookupCustomer(email);
    
    if (!customer || !customer.id) {
      return res.status(404).json({
        success: false,
        error: 'Customer not found in Stamped'
      });
    }

    // Then get their redemptions (coupons)
    const redemptions = await getCustomerRedemptions(customer.id);
    
    if (debug === 'true') {
      return res.status(200).json({
        debug: true,
        customer: customer,
        rawRedemptions: redemptions
      });
    }
    
    // Format coupons
    const now = new Date();
    const formatted = redemptions.map(redemption => {
      const expiryDate = redemption.expiresAt ? new Date(redemption.expiresAt) : null;
      const daysUntilExpiry = expiryDate ? Math.ceil((expiryDate - now) / (1000 * 60 * 60 * 24)) : null;
      
      return {
        id: redemption.id,
        code: redemption.couponCode,
        rewardName: redemption.rewardName,
        discountType: redemption.discountType,
        discountValue: redemption.discountValue,
        discountText: redemption.discountType === 'percentage' 
          ? `${redemption.discountValue}% off`
          : `£${redemption.discountValue} off`,
        pointsRedeemed: redemption.pointsRedeemed,
        expiresAt: redemption.expiresAt,
        expiryDate: expiryDate ? expiryDate.toISOString() : null,
        expiryDateFormatted: expiryDate ? expiryDate.toLocaleDateString('en-GB', {
          day: 'numeric',
          month: 'short',
          year: 'numeric'
        }) : 'No expiry',
        daysUntilExpiry: daysUntilExpiry,
        isExpiringSoon: daysUntilExpiry !== null && daysUntilExpiry > 0 && daysUntilExpiry <= 7,
        isExpired: daysUntilExpiry !== null && daysUntilExpiry < 0,
        used: redemption.used || false,
        usedAt: redemption.usedAt || null,
        createdAt: redemption.createdAt
      };
    });

    // Separate into categories
    const active = formatted.filter(c => !c.used && !c.isExpired);
    const used = formatted.filter(c => c.used);
    const expired = formatted.filter(c => c.isExpired && !c.used);

    res.status(200).json({
      success: true,
      data: {
        all: formatted,
        active: active,
        used: used,
        expired: expired,
        counts: {
          total: formatted.length,
          active: active.length,
          used: used.length,
          expired: expired.length
        }
      }
    });

  } catch (error) {
    console.error('Coupons API Error:', error.message);
    
    res.status(error.statusCode || 500).json({
      success: false,
      error: error.message,
      code: error.code || 'INTERNAL_ERROR'
    });
  }
};

function lookupCustomer(email) {
  return new Promise((resolve, reject) => {
    const shopId = process.env.STAMPED_STORE_HASH;
    const apiKey = process.env.STAMPED_PRIVATE_KEY;

    if (!shopId || !apiKey) {
      return reject(new Error('Missing Stamped API credentials'));
    }

    const options = {
      hostname: 'stamped.io',
      path: `/api/v3/loyalty/${shopId}/customers/lookup?email=${encodeURIComponent(email)}`,
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'stamped-api-key': apiKey
      }
    };

    console.log('Looking up customer:', email);

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
            reject(new Error('Invalid JSON response'));
          }
        } else if (response.statusCode === 404) {
          reject(new Error('Customer not found'));
        } else {
          reject(new Error(`API returned ${response.statusCode}`));
        }
      });
    });

    request.on('error', reject);
    request.setTimeout(15000, () => {
      request.destroy();
      reject(new Error('Timeout'));
    });
    request.end();
  });
}

function getCustomerRedemptions(customerId) {
  return new Promise((resolve, reject) => {
    const shopId = process.env.STAMPED_STORE_HASH;
    const apiKey = process.env.STAMPED_PRIVATE_KEY;

    if (!shopId || !apiKey) {
      return reject(new Error('Missing Stamped API credentials'));
    }

    // V3 API endpoint for redemptions
    const options = {
      hostname: 'stamped.io',
      path: `/api/v3/loyalty/${shopId}/redemptions?customerId=${customerId}`,
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'stamped-api-key': apiKey
      }
    };

    console.log('Fetching redemptions for customer:', customerId);
    console.log('Request URL:', `https://${options.hostname}${options.path}`);

    const request = https.request(options, (response) => {
      let data = '';
      
      response.on('data', (chunk) => {
        data += chunk;
      });
      
      response.on('end', () => {
        console.log('Redemptions response status:', response.statusCode);
        console.log('Redemptions response body:', data);

        if (response.statusCode === 200) {
          try {
            const parsed = JSON.parse(data);
            // V3 might return { data: [...] } or just [...]
            const redemptions = parsed.data || parsed;
            resolve(Array.isArray(redemptions) ? redemptions : []);
          } catch (e) {
            reject(new Error('Invalid JSON response'));
          }
        } else if (response.statusCode === 404) {
          // No redemptions found
          resolve([]);
        } else {
          reject(new Error(`API returned ${response.statusCode}`));
        }
      });
    });

    request.on('error', reject);
    request.setTimeout(15000, () => {
      request.destroy();
      reject(new Error('Timeout'));
    });
    request.end();
  });
}
