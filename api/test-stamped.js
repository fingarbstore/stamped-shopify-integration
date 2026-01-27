// api/test-stamped.js
// Test different Stamped API endpoints to find which works
// Usage: /api/test-stamped?email=finlay@garbstore.com

const https = require('https');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const { email } = req.query;
  
  if (!email) {
    return res.status(400).json({ 
      error: 'Email required',
      usage: '/api/test-stamped?email=customer@email.com'
    });
  }

  const storeHash = process.env.STAMPED_STORE_HASH;
  const publicKey = process.env.STAMPED_PUBLIC_KEY;
  const privateKey = process.env.STAMPED_PRIVATE_KEY;

  const results = {
    email: email,
    storeHash: storeHash,
    tests: []
  };

  // Test 1: V2 API with email query parameter
  try {
    const test1 = await testEndpoint({
      name: 'V2 API - Email Query Parameter',
      path: `/api/v2/${storeHash}/loyalty/customer?email=${encodeURIComponent(email)}`,
      auth: `${publicKey}:${privateKey}`
    });
    results.tests.push(test1);
  } catch (e) {
    results.tests.push({
      name: 'V2 API - Email Query Parameter',
      error: e.message
    });
  }

  // Test 2: V2 API with email in path
  try {
    const test2 = await testEndpoint({
      name: 'V2 API - Email in Path',
      path: `/api/v2/${storeHash}/loyalty/customer/${encodeURIComponent(email)}`,
      auth: `${publicKey}:${privateKey}`
    });
    results.tests.push(test2);
  } catch (e) {
    results.tests.push({
      name: 'V2 API - Email in Path',
      error: e.message
    });
  }

  // Test 3: Different email encoding
  try {
    const test3 = await testEndpoint({
      name: 'V2 API - Email with Plus Sign',
      path: `/api/v2/${storeHash}/loyalty/customer?email=${email.replace('@', '%40')}`,
      auth: `${publicKey}:${privateKey}`
    });
    results.tests.push(test3);
  } catch (e) {
    results.tests.push({
      name: 'V2 API - Email with Plus Sign',
      error: e.message
    });
  }

  // Test 4: Get all customers to find the right one
  try {
    const test4 = await testEndpoint({
      name: 'V2 API - List Customers',
      path: `/api/v2/${storeHash}/loyalty/customers?limit=100`,
      auth: `${publicKey}:${privateKey}`
    });
    results.tests.push(test4);
    
    // Try to find customer in list
    if (test4.data && test4.data.customers) {
      const customer = test4.data.customers.find(c => 
        c.email && c.email.toLowerCase() === email.toLowerCase()
      );
      
      if (customer) {
        results.foundCustomer = {
          message: 'Found customer in list!',
          email: customer.email,
          points: customer.pointsBalance || customer.points_balance,
          customerId: customer.id || customer.customerId
        };
      } else {
        results.foundCustomer = {
          message: 'Customer not found in list',
          totalCustomers: test4.data.customers.length,
          sampleEmails: test4.data.customers.slice(0, 5).map(c => c.email)
        };
      }
    }
  } catch (e) {
    results.tests.push({
      name: 'V2 API - List Customers',
      error: e.message
    });
  }

  // Test 5: Try V3 API
  try {
    const test5 = await testEndpoint({
      name: 'V3 API - Email Query',
      path: `/api/v3/${storeHash}/loyalty/customers?email=${encodeURIComponent(email)}`,
      auth: `${publicKey}:${privateKey}`,
      headers: {
        'stamped-api-key': privateKey
      }
    });
    results.tests.push(test5);
  } catch (e) {
    results.tests.push({
      name: 'V3 API - Email Query',
      error: e.message
    });
  }

  res.status(200).json(results);
};

function testEndpoint({ name, path, auth, headers = {} }) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'stamped.io',
      path: path,
      method: 'GET',
      auth: auth,
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        ...headers
      }
    };

    console.log(`Testing ${name}: https://stamped.io${path}`);

    const request = https.request(options, (response) => {
      let data = '';
      
      response.on('data', (chunk) => {
        data += chunk;
      });
      
      response.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          resolve({
            name,
            statusCode: response.statusCode,
            success: response.statusCode === 200,
            endpoint: path,
            data: parsed
          });
        } catch (e) {
          resolve({
            name,
            statusCode: response.statusCode,
            success: false,
            endpoint: path,
            rawResponse: data.substring(0, 500)
          });
        }
      });
    });

    request.on('error', (error) => {
      reject(error);
    });

    request.setTimeout(10000, () => {
      request.destroy();
      reject(new Error('Timeout'));
    });

    request.end();
  });
}
