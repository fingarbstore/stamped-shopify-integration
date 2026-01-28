// api/debug.js
// Diagnostic endpoint to test Stamped API connectivity
// REMOVE THIS FILE IN PRODUCTION

const https = require('https');

module.exports = async (req, res) => {
  // Only allow from specific origins or with secret
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

  const shopId = process.env.STAMPED_STORE_HASH;
  const publicKey = process.env.STAMPED_PUBLIC_KEY;
  const privateKey = process.env.STAMPED_PRIVATE_KEY;

  const results = {
    timestamp: new Date().toISOString(),
    environment: {
      hasShopId: !!shopId,
      shopIdValue: shopId,
      hasPublicKey: !!publicKey,
      publicKeyPrefix: publicKey ? publicKey.substring(0, 20) + '...' : null,
      hasPrivateKey: !!privateKey,
      privateKeyPrefix: privateKey ? privateKey.substring(0, 15) + '...' : null
    },
    tests: []
  };

  // Test 1: Check if shop exists
  try {
    const shopTest = await testEndpoint({
      name: 'Shop Info',
      path: `/api/v3/merchant/shops/${shopId}`,
      publicKey,
      privateKey
    });
    results.tests.push(shopTest);
  } catch (e) {
    results.tests.push({ name: 'Shop Info', error: e.message });
  }

  // Test 2: List customers (to verify API access)
  try {
    const customersTest = await testEndpoint({
      name: 'List Customers',
      path: `/api/v3/merchant/shops/${shopId}/customers?limit=1`,
      publicKey,
      privateKey
    });
    results.tests.push(customersTest);
  } catch (e) {
    results.tests.push({ name: 'List Customers', error: e.message });
  }

  // Test 3: Try different customer lookup formats
  const { shopifyId, email } = req.query;
  
  if (shopifyId || email) {
    // Test lookup endpoint
    try {
      let lookupPath = `/api/v3/merchant/shops/${shopId}/customers/lookup?`;
      if (shopifyId) lookupPath += `shopifyId=${encodeURIComponent(shopifyId)}`;
      if (email) lookupPath += `${shopifyId ? '&' : ''}email=${encodeURIComponent(email)}`;
      
      const lookupTest = await testEndpoint({
        name: 'Customer Lookup',
        path: lookupPath,
        publicKey,
        privateKey
      });
      results.tests.push(lookupTest);
    } catch (e) {
      results.tests.push({ name: 'Customer Lookup', error: e.message });
    }

    // Test direct customer endpoint (if shopifyId looks like a Stamped ID)
    if (shopifyId) {
      try {
        const directTest = await testEndpoint({
          name: 'Direct Customer by ID',
          path: `/api/v3/merchant/shops/${shopId}/customers/${shopifyId}`,
          publicKey,
          privateKey
        });
        results.tests.push(directTest);
      } catch (e) {
        results.tests.push({ name: 'Direct Customer by ID', error: e.message });
      }
    }
  }

  // Test 4: Loyalty rewards endpoint
  try {
    const rewardsTest = await testEndpoint({
      name: 'Loyalty Rewards List',
      path: `/api/v3/merchant/shops/${shopId}/loyalty/reports/rewards?limit=1`,
      publicKey,
      privateKey
    });
    results.tests.push(rewardsTest);
  } catch (e) {
    results.tests.push({ name: 'Loyalty Rewards List', error: e.message });
  }

  // Add recommendations
  results.recommendations = [];
  
  const failedTests = results.tests.filter(t => t.status !== 200);
  if (failedTests.some(t => t.status === 401 || t.status === 403)) {
    results.recommendations.push('Authentication issue detected. Verify your API keys are correct and have the right permissions.');
  }
  if (failedTests.some(t => t.status === 404 && t.name === 'Shop Info')) {
    results.recommendations.push(`Shop ID "${shopId}" not found. This should be your Stamped store hash, not Shopify store ID.`);
  }
  if (failedTests.some(t => t.status === 404 && t.name === 'Customer Lookup')) {
    results.recommendations.push('Customer not found. Verify the customer exists in Stamped and has enrolled in the loyalty program.');
  }

  res.status(200).json(results);
};

function testEndpoint({ name, path, publicKey, privateKey }) {
  return new Promise((resolve) => {
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

    console.log(`Testing: ${name} - ${path}`);

    const request = https.request(options, (response) => {
      let data = '';
      
      response.on('data', (chunk) => {
        data += chunk;
      });
      
      response.on('end', () => {
        let parsedBody = null;
        try {
          parsedBody = JSON.parse(data);
        } catch (e) {
          parsedBody = { raw: data.substring(0, 500) };
        }

        resolve({
          name: name,
          endpoint: path,
          status: response.statusCode,
          statusText: response.statusCode === 200 ? 'OK' : 
                      response.statusCode === 401 ? 'Unauthorized' :
                      response.statusCode === 403 ? 'Forbidden' :
                      response.statusCode === 404 ? 'Not Found' :
                      'Error',
          responsePreview: typeof parsedBody === 'object' 
            ? JSON.stringify(parsedBody).substring(0, 300)
            : String(parsedBody).substring(0, 300),
          headers: {
            contentType: response.headers['content-type'],
            xRequestId: response.headers['x-request-id']
          }
        });
      });
    });

    request.on('error', (error) => {
      resolve({
        name: name,
        endpoint: path,
        status: 0,
        statusText: 'Network Error',
        error: error.message
      });
    });

    request.setTimeout(10000, () => {
      request.destroy();
      resolve({
        name: name,
        endpoint: path,
        status: 0,
        statusText: 'Timeout',
        error: 'Request timed out after 10 seconds'
      });
    });

    request.end();
  });
}
