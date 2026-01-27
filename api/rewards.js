// api/rewards.js
// GET /api/rewards
// Returns: list of available rewards to redeem

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

  try {
    const rewards = await getStampedRewards();
    
    // Format rewards
    const formatted = rewards.map(reward => ({
      id: reward.id,
      name: reward.name,
      description: reward.description || '',
      pointsCost: reward.pointsCost,
      discountType: reward.discountType,
      discountValue: reward.discountValue,
      discountText: reward.discountType === 'percentage'
        ? `${reward.discountValue}% OFF`
        : `£${reward.discountValue} OFF`,
      minPurchase: reward.minPurchase || 0,
      enabled: reward.enabled !== false
    })).filter(r => r.enabled).sort((a, b) => a.pointsCost - b.pointsCost);

    res.status(200).json({
      success: true,
      data: {
        rewards: formatted,
        count: formatted.length
      }
    });

  } catch (error) {
    console.error('Rewards API Error:', error.message);
    
    res.status(error.statusCode || 500).json({
      success: false,
      error: error.message,
      code: error.code || 'INTERNAL_ERROR'
    });
  }
};

function getStampedRewards() {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'stamped.io',
      path: `/api/v2/${process.env.STAMPED_STORE_HASH}/loyalty/rewards`,
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
            resolve(parsed.rewards || []);
          } catch (e) {
            reject(new Error('Invalid JSON response'));
          }
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
