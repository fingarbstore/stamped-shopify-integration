// /api/expiry.js
// Standalone endpoint to get accurate points expiry from activities
// Call this ALONGSIDE your existing /api/customer endpoint
// 
// Usage: /api/points-expiry?shopifyId=123 or ?email=test@example.com or ?customerId=xxx
//
// Points expire 360 days after the last EARNING activity (not spending/redemption)

const STAMPED_API_KEY = process.env.STAMPED_API_KEY;
const STAMPED_SHOP_ID = process.env.STAMPED_SHOP_ID || '236485';

// Events that EARN points (reset expiry timer)
const POINT_EARNING_EVENTS = [
  'orders/paid|fulfilled',
  'orders/paid',
  'orders/fulfilled',
  'referral/program',
  'birthday/program',
  'signup/program',
  'custom/program',
  'social/program',
  'review/program'
];

export default async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const { customerId, email, shopifyId } = req.query;

  if (!customerId && !email && !shopifyId) {
    return res.status(400).json({ 
      success: false, 
      error: 'customerId, email, or shopifyId is required' 
    });
  }

  try {
    // Get Stamped customerId if we only have email or shopifyId
    let stampedCustomerId = customerId;
    
    if (!stampedCustomerId) {
      const params = new URLSearchParams();
      if (email) params.append('email', email);
      if (shopifyId) params.append('shopifyId', shopifyId);

      const lookupResponse = await fetch(
        `https://stamped.io/api/v3/shops/${STAMPED_SHOP_ID}/customers/lookup?${params}`,
        {
          headers: {
            'Authorization': `Basic ${Buffer.from(STAMPED_API_KEY + ':').toString('base64')}`,
            'Content-Type': 'application/json'
          }
        }
      );

      if (!lookupResponse.ok) {
        return res.status(404).json({ 
          success: false, 
          error: 'Customer not found' 
        });
      }

      const customer = await lookupResponse.json();
      stampedCustomerId = customer.customerId;
    }

    // Fetch activities for this customer
    const activitiesResponse = await fetch(
      `https://stamped.io/api/v3/loyalty/shops/${STAMPED_SHOP_ID}/activities?customerId=${stampedCustomerId}&page=0&limit=50`,
      {
        headers: {
          'Authorization': `Basic ${Buffer.from(STAMPED_API_KEY + ':').toString('base64')}`,
          'Content-Type': 'application/json'
        }
      }
    );

    if (!activitiesResponse.ok) {
      throw new Error(`Activities API returned ${activitiesResponse.status}`);
    }

    const activities = await activitiesResponse.json();
    
    // Find the latest point-EARNING activity (not redemption)
    const earningActivities = activities.filter(activity => {
      const event = activity.event || '';
      
      // Exclude redemptions - these should NOT reset expiry
      if (event === 'redeem/points') {
        return false;
      }
      
      // Include known earning events
      if (POINT_EARNING_EVENTS.some(e => event.includes(e))) {
        return true;
      }
      
      // Include any order event with points
      if (event.includes('orders/') && activity.pointsDebit > 0) {
        return true;
      }
      
      return false;
    });

    if (earningActivities.length === 0) {
      return res.json({
        success: true,
        data: {
          hasExpiry: false,
          message: 'No point-earning activities found'
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

    return res.json({
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
    console.error('Points expiry error:', error);
    return res.status(500).json({ 
      success: false, 
      error: 'Failed to calculate points expiry',
      details: error.message
    });
  }
}
