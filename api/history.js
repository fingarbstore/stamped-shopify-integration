// api/earning-history.js
// Fetches customer's complete earning history with pending points calculation
// Pending points: orders less than 28 days old are not yet awarded

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
      usage: '/api/earning-history?shopifyId=7018143973476'
    });
  }

  try {
    // Step 1: Get Stamped customerId if needed
    let stampedCustomerId = customerId;
    
    if (!stampedCustomerId) {
      const customer = await lookupCustomer({ shopifyId, email });
      stampedCustomerId = customer.customerId;
    }

    // Step 2: Fetch all activities
    const activities = await fetchActivities(stampedCustomerId, endpoint, debug === 'true');
    
    if (debug === 'true') {
      return res.status(200).json({
        debug: true,
        customerId: stampedCustomerId,
        totalActivities: activities.length,
        activities: activities.slice(0, 20)
      });
    }

    // Step 3: Process activities into earning history
    const now = new Date();
    const PENDING_DAYS = 28;
    
    let earningHistory = [];
    let pendingPoints = 0;
    let pendingOrders = [];
    
    activities.forEach(activity => {
      const event = activity.event || '';
      const pointsEarned = activity.pointsDebit || 0;
      const dateCreated = new Date(activity.dateCreated);
      
      // Skip if no points earned
      if (pointsEarned <= 0) return;
      
      // Determine activity type and if it's an earning event
      let activityType = 'Other';
      let isEarning = false;
      let isPending = false;
      
      if (event.includes('orders/') || event.includes('order')) {
        activityType = 'Order';
        isEarning = true;
        
        // Check if order is pending (less than 28 days old)
        const daysSinceOrder = Math.floor((now - dateCreated) / (1000 * 60 * 60 * 24));
        isPending = daysSinceOrder < PENDING_DAYS;
        
        if (isPending) {
          pendingPoints += pointsEarned;
          const daysRemaining = PENDING_DAYS - daysSinceOrder;
          pendingOrders.push({
            points: pointsEarned,
            daysRemaining: daysRemaining,
            awardDate: new Date(dateCreated.getTime() + (PENDING_DAYS * 24 * 60 * 60 * 1000)),
            orderDate: dateCreated,
            orderId: activity.reference?.orderId || 'Unknown'
          });
        }
      } else if (event.includes('referral')) {
        activityType = 'Referral';
        isEarning = true;
      } else if (event.includes('review')) {
        activityType = 'Review';
        isEarning = true;
      } else if (event.includes('birthday')) {
        activityType = 'Birthday';
        isEarning = true;
      } else if (event.includes('signup')) {
        activityType = 'Sign Up';
        isEarning = true;
      } else if (event.includes('social')) {
        activityType = 'Social';
        isEarning = true;
      } else if (event.includes('custom')) {
        activityType = 'Bonus';
        isEarning = true;
      } else if (event.includes('redeem')) {
        activityType = 'Redeemed';
        isEarning = false;
      }
      
      // Only include earning activities in history
      if (isEarning) {
        earningHistory.push({
          type: activityType,
          points: pointsEarned,
          date: dateCreated.toISOString(),
          dateFormatted: dateCreated.toLocaleDateString('en-GB', {
            day: 'numeric',
            month: 'short',
            year: 'numeric'
          }),
          isPending: isPending,
          daysUntilAwarded: isPending ? PENDING_DAYS - Math.floor((now - dateCreated) / (1000 * 60 * 60 * 24)) : null,
          orderId: activity.reference?.orderId || null,
          description: generateDescription(activityType, activity)
        });
      }
    });
    
    // Sort by date descending (most recent first)
    earningHistory.sort((a, b) => new Date(b.date) - new Date(a.date));
    
    // Sort pending orders by award date
    pendingOrders.sort((a, b) => a.awardDate - b.awardDate);
    
    // Calculate summary statistics
    const totalEarned = earningHistory.reduce((sum, item) => sum + item.points, 0);
    const earnedByType = {};
    earningHistory.forEach(item => {
      if (!earnedByType[item.type]) {
        earnedByType[item.type] = 0;
      }
      earnedByType[item.type] += item.points;
    });

    res.status(200).json({
      success: true,
      data: {
        history: earningHistory,
        summary: {
          totalEarned: totalEarned,
          totalActivities: earningHistory.length,
          earnedByType: earnedByType,
          pendingPoints: pendingPoints,
          pendingOrdersCount: pendingOrders.length
        },
        pending: {
          totalPoints: pendingPoints,
          orders: pendingOrders.map(order => ({
            points: order.points,
            daysRemaining: order.daysRemaining,
            awardDate: order.awardDate.toLocaleDateString('en-GB', {
              day: 'numeric',
              month: 'short',
              year: 'numeric'
            }),
            orderDate: order.orderDate.toLocaleDateString('en-GB', {
              day: 'numeric',
              month: 'short',
              year: 'numeric'
            }),
            orderId: order.orderId
          }))
        }
      }
    });

  } catch (error) {
    console.error('Earning History Error:', error.message);
    
    res.status(error.statusCode || 500).json({
      success: false,
      error: 'Failed to fetch earning history',
      details: error.message,
      code: error.code || 'INTERNAL_ERROR'
    });
  }
};

// Generate human-readable description
function generateDescription(type, activity) {
  switch(type) {
    case 'Order':
      const orderId = activity.reference?.orderId || '';
      return orderId ? `Order #${orderId}` : 'Purchase';
    case 'Referral':
      return 'Friend referral';
    case 'Review':
      return 'Product review';
    case 'Birthday':
      return 'Birthday bonus';
    case 'Sign Up':
      return 'Account creation';
    case 'Social':
      return 'Social media follow';
    case 'Bonus':
      return 'Special bonus';
    default:
      return type;
  }
}

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

// Fetch activities from Stamped
function fetchActivities(customerId, endpointType = 'loyalty', debugMode = false) {
  return new Promise((resolve, reject) => {
    const shopId = process.env.STAMPED_STORE_HASH;
    const privateKey = process.env.STAMPED_PRIVATE_KEY;

    if (!shopId || !privateKey) {
      return reject(new Error('Missing Stamped API credentials'));
    }

    // Try different endpoint paths
    let path;
    switch(endpointType) {
      case 'reports':
        path = `/api/v3/loyalty/reports/activities?customerId=${encodeURIComponent(customerId)}&page=0&limit=100`;
        break;
      case 'merchant':
        path = `/api/v3/merchant/shops/${shopId}/customers/${encodeURIComponent(customerId)}/activities?page=0&limit=100`;
        break;
      case 'loyalty':
      default:
        path = `/api/v3/loyalty/shops/${shopId}/activities?customerId=${encodeURIComponent(customerId)}&page=0&limit=100`;
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
      console.log('Fetching activities:', options.path);
    }

    const request = https.request(options, (response) => {
      let data = '';
      
      response.on('data', (chunk) => {
        data += chunk;
      });
      
      response.on('end', () => {
        if (response.statusCode === 200) {
          try {
            const parsed = JSON.parse(data);
            const activities = Array.isArray(parsed) ? parsed : (parsed.activities || parsed.data || []);
            resolve(activities);
          } catch (e) {
            reject(new Error('Invalid JSON response from activities'));
          }
        } else if (response.statusCode === 401) {
          const error = new Error('Activities API authentication failed');
          error.statusCode = 401;
          error.code = 'AUTH_FAILED';
          reject(error);
        } else {
          const error = new Error(`Activities API returned ${response.statusCode}`);
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
