// api/coupons.js
// GET /api/coupons?email=customer@email.com&status=active
// Returns: list of customer's coupons with expiry dates

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

  // Validate
  const { email, status } = req.query;
  
  if (!email) {
    return res.status(400).json({ 
      error: 'Email parameter required',
      usage: '/api/coupons?email=customer@email.com&status=active'
    });
  }

  try {
    // Get coupons from Stamped
    const stampedCoupons = await getStampedCoupons(email, status || 'all');
    
    // Format with expiry calculations
    const now = new Date();
    const formatted = stampedCoupons.map(coupon => {
      const expiryDate = new Date(coupon.expiresAt);
      const daysUntilExpiry = Math.ceil((expiryDate - now) / (1000 * 60 * 60 * 24));
      
      return {
        code: coupon.code,
        discountType: coupon.discountType, // 'percentage' or 'fixed'
        discountValue: coupon.discountValue,
        discountText: coupon.discountType === 'percentage' 
          ? `${coupon.discountValue}% off`
          : `£${coupon.discountValue} off`,
        minPurchase: coupon.minPurchase || 0,
        expiresAt: coupon.expiresAt,
        expiryDate: expiryDate.toISOString(),
        expiryDateFormatted: expiryDate.toLocaleDateString('en-GB', {
          day: 'numeric',
          month: 'short',
          year: 'numeric'
        }),
        daysUntilExpiry: daysUntilExpiry,
        isExpiringSoon: daysUntilExpiry > 0 && daysUntilExpiry <= 7,
        isExpired: daysUntilExpiry < 0,
        status: coupon.status, // 'active', 'used', 'expired'
        used: coupon.status === 'used',
        usedAt: coupon.usedAt || null,
        createdAt: coupon.createdAt
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

function getStampedCoupons(email, status) {
  return new Promise((resolve, reject) => {
    const statusParam = status !== 'all' ? `&status=${status}` : '';
    
    const options = {
      hostname: 'stamped.io',
      path: `/api/v2/${process.env.STAMPED_STORE_HASH}/loyalty/customer/coupons?email=${encodeURIComponent(email)}${statusParam}`,
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
            const parsed = JSON.parse(data);
            resolve(parsed.coupons || []);
          } catch (e) {
            reject(new Error('Invalid JSON response from Stamped'));
          }
        } else if (response.statusCode === 404) {
          resolve([]);
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
