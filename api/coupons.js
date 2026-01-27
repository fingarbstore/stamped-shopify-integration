// api/coupons.js
// Fetches customer redemptions (coupons) from Stamped V3 API

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

  const { email, shopifyId, debug } = req.query;
  
  if (!email && !shopifyId) {
    return res.status(400).json({ 
      error: 'Email or shopifyId parameter required',
      usage: '/api/coupons?email=customer@email.com'
    });
  }

  try {
    // First, lookup customer to get their customerId
    const customer = await lookupCustomer(email, shopifyId);
    
    if (!customer || !customer.customerId) {
      return res.status(404).json({
        success: false,
        error: 'Customer not found in Stamped'
      });
    }

    // Then get their redemptions using customerId
    const redemptions = await getRedemptions(customer.customerId);
    
    if (debug === 'true') {
      return res.status(200).json({
        debug: true,
        customer: {
          customerId: customer.customerId,
          email: customer.email
        },
        rawRedemptions: redemptions
      });
    }
    
    // Format coupons
    const now = new Date();
    const formatted = redemptions.map(redemption => {
      const expiryDate = redemption.expiresAt ? new Date(redemption.expiresAt) : null;
      const daysUntilExpiry = expiryDate ? Math.ceil((expiryDate - now) / (1000 * 60 * 60 * 24)) : null;
      
      return {
        id: redemption.id || redemption.redemptionId,
        code: redemption.couponCode || redemption.code,
        rewardName: redemption.rewardName || redemption.reward?.name,
        discountType: redemption.discountType,
        discountValue: redemption.discountValue,
        discountText: redemption.discountType === 'percentage' 
          ? `${redemption.discountValue}% off`
          : `£${redemption.discountValue} off`,
        pointsRedeemed: redemption.pointsRedeemed || redemption.points,
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
        used: redemption.used || redemption.status === 'used',
        usedAt: redemption.usedAt || null,
        createdAt: redemption.createdAt || redemption.dateCreated
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

function lookupCustomer(email, shopifyId) {
  return new Promise((resolve, reject) => {
    const shopId = process.env.STAMPED_STORE_HASH;
    const apiKey = process.env.STAMPED_PRIVATE_KEY;

    if (!shopId || !apiKey) {
      return reject(new Error('Missing Stamped API credentials'));
    }

    let queryString;
    if (email) {
      queryString = `email=${encodeURIComponent(email)}`;
    } else if (shopifyId) {
      queryString = `shopifyId=${encodeURIComponent(shopifyId)}`;
    }

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

    console.log('Looking up customer:', queryString);

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

function getRedemptions(customerId) {
  return new Promise((resolve, reject) => {
    const shopId = process.env.STAMPED_STORE_HASH;
    const apiKey = process.env.STAMPED_PRIVATE_KEY;

    if (!shopId || !apiKey) {
      return reject(new Error('Missing Stamped API credentials'));
    }

    // Try redemptions endpoint with customerId filter
    const options = {
      hostname: 'stamped.io',
      path: `/api/v3/loyalty/${shopId}/redemptions?customerId=${encodeURIComponent(customerId)}`,
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'stamped-api-key': apiKey
      }
    };

    console.log('Fetching redemptions:', options.path);

    const request = https.request(options, (response) => {
      let data = '';
      
      response.on('data', (chunk) => {
        data += chunk;
      });
      
      response.on('end', () => {
        console.log('Redemptions response status:', response.statusCode);
        console.log('Redemptions response (first 500 chars):', data.substring(0, 500));

        if (response.statusCode === 200) {
          try {
            const parsed = JSON.parse(data);
            // Handle both { data: [...] } and [...] formats
            const redemptions = parsed.data || parsed;
            resolve(Array.isArray(redemptions) ? redemptions : []);
          } catch (e) {
            reject(new Error('Invalid JSON response'));
          }
        } else if (response.statusCode === 404) {
          // No redemptions found - return empty array
          console.log('No redemptions found (404)');
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
