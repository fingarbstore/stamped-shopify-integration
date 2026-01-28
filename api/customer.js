// api/coupons.js
// UPDATED: Better debugging and multiple endpoint fallbacks
// Uses loyalty reports rewards API from Stamped

const https = require('https');

module.exports = async (req, res) => {
  // CORS
  const allowedOrigins = [
    'https://couvertureandthegarbstore.com',
    'https://www.couvertureandthegarbstore.com',
    'http://localhost:3000'
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

  const { shopifyId, email, customerId, debug } = req.query;
  
  if (!shopifyId && !email && !customerId) {
    return res.status(400).json({ 
      error: 'shopifyId, email, or customerId parameter required',
      usage: '/api/coupons?shopifyId=7018143973476'
    });
  }

  try {
    let stampedCustomerId = customerId;
    let customerData = null;

    // If we don't have customerId, look up the customer first
    if (!stampedCustomerId) {
      console.log('Looking up customer by shopifyId or email...');
      customerData = await lookupCustomer({ shopifyId, email });
      stampedCustomerId = customerData.customerId || customerData.id;
      
      if (!stampedCustomerId) {
        return res.status(404).json({
          success: false,
          error: 'Customer found but no customerId returned',
          customerData: debug === 'true' ? customerData : undefined
        });
      }
    }

    console.log('Fetching rewards for customerId:', stampedCustomerId);

    // Get their rewards/coupons
    const rewardsResponse = await getCustomerRewards(stampedCustomerId, debug === 'true');
    
    if (debug === 'true') {
      return res.status(200).json({
        debug: true,
        customer: customerData ? {
          shopifyId: customerData.shopifyId,
          customerId: stampedCustomerId,
          email: customerData.email
        } : { customerId: stampedCustomerId },
        rawRewardsResponse: rewardsResponse.raw,
        requestDetails: rewardsResponse.requestDetails,
        parsedRewards: rewardsResponse.rewards
      });
    }
    
    const rewards = rewardsResponse.rewards || [];
    
    // Format coupons
    const now = new Date();
    const formatted = rewards.map(reward => {
      const expiryDate = reward.expiresAt || reward.expiry || reward.expiryDate;
      const parsedExpiry = expiryDate ? new Date(expiryDate) : null;
      const daysUntilExpiry = parsedExpiry ? Math.ceil((parsedExpiry - now) / (1000 * 60 * 60 * 24)) : null;
      
      // Handle different response formats from Stamped
      const code = reward.couponCode || reward.code || reward.discountCode;
      const discountType = reward.discountType || reward.type || 'fixed';
      const discountValue = reward.discountValue || reward.value || reward.amount || 0;
      
      return {
        id: reward.id || reward.rewardId,
        code: code,
        rewardName: reward.name || reward.rewardName || reward.title,
        discountType: discountType,
        discountValue: discountValue,
        discountText: discountType === 'percentage' || discountType === 'percent'
          ? `${discountValue}% off`
          : `£${discountValue} off`,
        pointsRedeemed: reward.pointsRedeemed || reward.points || reward.pointsCost,
        expiresAt: expiryDate,
        expiryDate: parsedExpiry ? parsedExpiry.toISOString() : null,
        expiryDateFormatted: parsedExpiry ? parsedExpiry.toLocaleDateString('en-GB', {
          day: 'numeric',
          month: 'short',
          year: 'numeric'
        }) : 'No expiry',
        daysUntilExpiry: daysUntilExpiry,
        isExpiringSoon: daysUntilExpiry !== null && daysUntilExpiry > 0 && daysUntilExpiry <= 7,
        isExpired: daysUntilExpiry !== null && daysUntilExpiry < 0,
        used: reward.used || reward.status === 'used' || reward.redeemed === true,
        usedAt: reward.usedAt || reward.redeemedAt || null,
        createdAt: reward.createdAt || reward.dateCreated || reward.created
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
      code: error.code || 'INTERNAL_ERROR',
      details: error.details || null
    });
  }
};

function lookupCustomer({ shopifyId, email }) {
  return new Promise((resolve, reject) => {
    const shopId = process.env.STAMPED_STORE_HASH;
    const publicKey = process.env.STAMPED_PUBLIC_KEY;
    const privateKey = process.env.STAMPED_PRIVATE_KEY;

    if (!shopId || !publicKey || !privateKey) {
      return reject(new Error('Missing Stamped API credentials'));
    }

    let queryParams = [];
    if (shopifyId) queryParams.push(`shopifyId=${encodeURIComponent(shopifyId)}`);
    if (email) queryParams.push(`email=${encodeURIComponent(email)}`);

    const options = {
      hostname: 'stamped.io',
      path: `/api/v3/merchant/shops/${shopId}/customers/lookup?${queryParams.join('&')}`,
      method: 'GET',
      auth: `${publicKey}:${privateKey}`,
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json'
      }
    };

    console.log('Customer lookup URL:', `https://${options.hostname}${options.path}`);

    const request = https.request(options, (response) => {
      let data = '';
      
      response.on('data', (chunk) => {
        data += chunk;
      });
      
      response.on('end', () => {
        console.log('Customer lookup status:', response.statusCode);
        
        if (response.statusCode === 200) {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(new Error('Invalid JSON from customer lookup'));
          }
        } else if (response.statusCode === 404) {
          const error = new Error('Customer not found in Stamped');
          error.statusCode = 404;
          error.code = 'CUSTOMER_NOT_FOUND';
          error.details = { response: data.substring(0, 500) };
          reject(error);
        } else {
          const error = new Error(`Customer lookup failed: ${response.statusCode}`);
          error.statusCode = response.statusCode;
          error.details = { response: data.substring(0, 500) };
          reject(error);
        }
      });
    });

    request.on('error', reject);
    request.setTimeout(15000, () => {
      request.destroy();
      reject(new Error('Customer lookup timeout'));
    });
    request.end();
  });
}

function getCustomerRewards(customerId, includeDebug = false) {
  return new Promise((resolve, reject) => {
    const shopId = process.env.STAMPED_STORE_HASH;
    const publicKey = process.env.STAMPED_PUBLIC_KEY;
    const privateKey = process.env.STAMPED_PRIVATE_KEY;

    if (!shopId || !publicKey || !privateKey) {
      return reject(new Error('Missing Stamped API credentials'));
    }

    // Try the loyalty reports rewards endpoint
    // Documentation: https://developers.stamped.io/reference/loyalty-reports-rewards
    const path = `/api/v3/merchant/shops/${shopId}/loyalty/reports/rewards?customerId=${encodeURIComponent(customerId)}`;
    
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
      customerId: customerId
    };

    console.log('=== Rewards API Request ===');
    console.log('URL:', requestDetails.url);

    const request = https.request(options, (response) => {
      let data = '';
      
      response.on('data', (chunk) => {
        data += chunk;
      });
      
      response.on('end', () => {
        console.log('Rewards response status:', response.statusCode);
        console.log('Rewards response body (first 500):', data.substring(0, 500));

        if (response.statusCode === 200) {
          try {
            const parsed = JSON.parse(data);
            
            // Handle different response formats
            let rewards = [];
            if (Array.isArray(parsed)) {
              rewards = parsed;
            } else if (parsed.data && Array.isArray(parsed.data)) {
              rewards = parsed.data;
            } else if (parsed.rewards && Array.isArray(parsed.rewards)) {
              rewards = parsed.rewards;
            } else if (parsed.results && Array.isArray(parsed.results)) {
              rewards = parsed.results;
            }
            
            console.log(`✅ Found ${rewards.length} rewards`);
            
            resolve({
              rewards: rewards,
              raw: includeDebug ? parsed : undefined,
              requestDetails: includeDebug ? requestDetails : undefined
            });
          } catch (e) {
            console.error('❌ JSON parse error:', e.message);
            reject(new Error('Invalid JSON from rewards API'));
          }
        } else if (response.statusCode === 404) {
          // 404 might mean no rewards, not an error
          console.log('ℹ️ No rewards found (404)');
          resolve({
            rewards: [],
            raw: includeDebug ? { status: 404, body: data } : undefined,
            requestDetails: includeDebug ? requestDetails : undefined
          });
        } else {
          console.error('❌ Rewards API error:', response.statusCode);
          const error = new Error(`Rewards API returned ${response.statusCode}`);
          error.statusCode = response.statusCode;
          error.details = { response: data.substring(0, 500) };
          reject(error);
        }
      });
    });

    request.on('error', (error) => {
      console.error('❌ Network error:', error);
      reject(error);
    });
    
    request.setTimeout(15000, () => {
      request.destroy();
      reject(new Error('Rewards API timeout'));
    });
    
    request.end();
  });
}
