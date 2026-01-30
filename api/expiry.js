// api/points-expiry.js
// Enhanced version with better debugging and alternative endpoints
// Gets accurate points expiry from activities

const https = require('https');

module.exports = async (req, res) => {
  // CORS headers
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

  const { shopifyId, email, customerId, debug, endpoint } = req.query;
  
  if (!shopifyId && !email && !customerId) {
    return res.status(400).json({ 
      error: 'shopifyId, email, or customerId parameter required',
      usage: '/api/points-expiry?shopifyId=7018143973476',
      debugUsage: '/api/points-expiry?shopifyId=7018143973476&debug=true',
      endpointOptions: '/api/points-expiry?shopifyId=7018143973476&endpoint=reports'
    });
  }

  try {
    // Step 1: Get Stamped customerId if we only have shopifyId or email
    let stampedCustomerId = customerId;
    
    if (!stampedCustomerId) {
      const customer = await lookupCustomer({ shopifyId, email });
      stampedCustomerId = customer.customerId;
      
      if (debug === 'true') {
        console.log('Customer lookup successful:', stampedCustomerId);
      }
    }

    // Step 2: Fetch activities for this customer
    const activities = await fetchActivities(stampedCustomerId, endpoint, debug === 'true');
    
    if (debug === 'true') {
      return res.status(200).json({
        debug: true,
        customerId: stampedCustomerId,
        totalActivities: activities.length,
        endpointUsed: endpoint || 'loyalty',
        activities: activities.slice(0, 10), // First 10 for debugging
        allEvents: activities.map(a => a.event)
      });
    }

    // Step 3: Find the latest point-EARNING activity (not redemption)
    const earningActivities = activities.filter(activity => {
      const event = activity.event || '';
      
      // Exclude redemptions - these should NOT reset expiry
      if (event === 'redeem/points' || event.includes('redeem')) {
        return false;
      }
      
      // Include order events (where points are earned)
      if (event.includes('orders/') || event.includes('order')) {
        return true;
      }
      
      // Include other earning events
      const earningEvents = [
        'referral/program',
        'birthday/program', 
        'signup/program',
        'custom/program',
        'social/program',
        'review/program'
      ];
      
      return earningEvents.some(e => event.includes(e));
    });

    if (earningActivities.length === 0) {
      return res.status(200).json({
        success: true,
        data: {
          hasExpiry: false,
          message: 'No point-earning activities found',
          hint: 'Try different endpoint: ?endpoint=reports or ?endpoint=merchant',
          totalActivitiesFetched: activities.length
        }
      });
    }

    // Sort by dateCreated descending to get most recent
    earningActivities.sort((a, b) => {
      const dateA = Number(a.dateCreated) || 0;
      const dateB = Number(b.dateCreated) || 0;
      return dateB - dateA;
    });

    const latest = earningActivities[0];
    
    // Get the dateAwarded from reference, or fall back to dateCreated
    let earningTimestamp;
    if (latest.reference && latest.reference.dateAwarded) {
      earningTimestamp = latest.reference.dateAwarded;
    } else {
      earningTimestamp = Number(latest.dateCreated);
    }

    // Calculate expiry (360 days from earning)
    const EXPIRY_DAYS = 360;
    const earningDate = new Date(earningTimestamp);
    const expiryDate = new Date(earningDate);
    expiryDate.setDate(expiryDate.getDate() + EXPIRY_DAYS);

    const now = new Date();
    const daysRemaining = Math.ceil((expiryDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

    res.status(200).json({
      success: true,
      data: {
        hasExpiry: true,
        lastEarningDate: earningDate.toISOString(),
        lastEarningDateFormatted: earningDate.toLocaleDateString('en-GB', { 
          day: 'numeric', 
          month: 'short', 
          year: 'numeric' 
        }),
        lastEarningEvent: latest.event,
        lastEarningPoints: latest.pointsDebit || 0,
        expiryDate: expiryDate.toISOString(),
        expiryDateFormatted: expiryDate.toLocaleDateString('en-GB', { 
          day: 'numeric', 
          month: 'short', 
          year: 'numeric' 
        }),
        daysRemaining: daysRemaining,
        isExpired: daysRemaining <= 0,
        isExpiringSoon: daysRemaining > 0 && daysRemaining <= 30
      }
    });

  } catch (error) {
    console.error('Points Expiry Error:', error.message);
    
    res.status(error.statusCode || 500).json({
      success: false,
      error: 'Failed to calculate points expiry',
      details: error.message,
      code: error.code || 'INTERNAL_ERROR',
      hint: error.statusCode === 401 ? 'Check API key permissions for Loyalty/Activities access' : undefined
    });
  }
};

// Lookup customer to get Stamped customerId
function lookupCustomer({ shopifyId, email }) {
  return new Promise((resolve, reject) => {
    const shopId = process.env.STAMPED_STORE_HASH;
    const privateKey = process.env.STAMPED_PRIVATE_KEY;

    if (!shopId || !privateKey) {
      return reject(new Error('Missing Stamped API credentials'));
    }

    let queryParams = [`shopId=${encodeURIComponent(shopId)}`];
    if (shopifyId) queryParams.push(`shopifyId=${encodeURIComponent(shopifyId)}`);
    if (email) queryParams.push(`email=${encodeURIComponent(email)}`);

    const options = {
      hostname: 'stamped.io',
      path: `/api/v3/merchant/shops/${shopId}/customers/lookup?${queryParams.join('&')}`,
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'stamped-api-key': privateKey
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
            reject(new Error('Invalid JSON response from customer lookup'));
          }
        } else if (response.statusCode === 404) {
          const error = new Error('Customer not found');
          error.statusCode = 404;
          error.code = 'CUSTOMER_NOT_FOUND';
          reject(error);
        } else {
          const error = new Error(`Customer lookup returned ${response.statusCode}`);
          error.statusCode = response.statusCode;
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

// Fetch activities from Stamped - supports multiple endpoints
function fetchActivities(customerId, endpointType = 'loyalty', debugMode = false) {
  return new Promise((resolve, reject) => {
    const shopId = process.env.STAMPED_STORE_HASH;
    const privateKey = process.env.STAMPED_PRIVATE_KEY;

    if (!shopId || !privateKey) {
      return reject(new Error('Missing Stamped API credentials'));
    }

    // Try different endpoint paths based on parameter
    let path;
    switch(endpointType) {
      case 'reports':
        path = `/api/v3/loyalty/reports/activities?customerId=${encodeURIComponent(customerId)}&page=0&limit=50`;
        break;
      case 'merchant':
        path = `/api/v3/merchant/shops/${shopId}/customers/${encodeURIComponent(customerId)}/activities?page=0&limit=50`;
        break;
      case 'loyalty':
      default:
        path = `/api/v3/loyalty/shops/${shopId}/activities?customerId=${encodeURIComponent(customerId)}&page=0&limit=50`;
        break;
    }

    const options = {
      hostname: 'stamped.io',
      path: path,
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'stamped-api-key': privateKey
      }
    };

    if (debugMode) {
      console.log('Fetching activities from:', options.path);
      console.log('Endpoint type:', endpointType);
    }

    const request = https.request(options, (response) => {
      let data = '';
      
      response.on('data', (chunk) => {
        data += chunk;
      });
      
      response.on('end', () => {
        if (debugMode) {
          console.log('Activities Response Status:', response.statusCode);
          console.log('Response length:', data.length);
        }
        
        if (response.statusCode === 200) {
          try {
            const parsed = JSON.parse(data);
            // Response might be an array directly or wrapped in an object
            const activities = Array.isArray(parsed) ? parsed : (parsed.activities || parsed.data || []);
            
            if (debugMode) {
              console.log(`✅ Found ${activities.length} activities`);
            }
            
            resolve(activities);
          } catch (e) {
            reject(new Error('Invalid JSON response from activities'));
          }
        } else if (response.statusCode === 401) {
          const error = new Error('Activities API authentication failed - check API key permissions for Loyalty access');
          error.statusCode = 401;
          error.code = 'AUTH_FAILED';
          reject(error);
        } else if (response.statusCode === 403) {
          const error = new Error('Activities API forbidden - API key lacks permission for this endpoint');
          error.statusCode = 403;
          error.code = 'FORBIDDEN';
          reject(error);
        } else {
          const error = new Error(`Activities API returned ${response.statusCode}: ${data}`);
          error.statusCode = response.statusCode;
          reject(error);
        }
      });
    });

    request.on('error', reject);
    request.setTimeout(15000, () => {
      request.destroy();
      reject(new Error('Activities request timeout'));
    });
    request.end();
  });
}
