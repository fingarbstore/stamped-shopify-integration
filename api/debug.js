// api/debug.js
// Diagnostic endpoint - tries BOTH authentication methods
// Method 1: HTTP Basic Auth (publicKey:privateKey)
// Method 2: Header: stamped-api-key

const https = require('https');

module.exports = async (req, res) => {
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
      shopId: shopId,
      publicKeyPrefix: publicKey ? publicKey.substring(0, 25) + '...' : null,
      privateKeyPrefix: privateKey ? privateKey.substring(0, 20) + '...' : null
    },
    authTests: []
  };

  const { shopifyId, email } = req.query;
  const testPath = `/api/v3/merchant/shops/${shopId}/customers?limit=1`;

  // Test 1: HTTP Basic Auth (publicKey:privateKey)
  console.log('=== Testing HTTP Basic Auth (publicKey:privateKey) ===');
  const basicAuth1 = await testWithAuth({
    name: 'Basic Auth (publicKey:privateKey)',
    path: testPath,
    authType: 'basic',
    username: publicKey,
    password: privateKey
  });
  results.authTests.push(basicAuth1);

  // Test 2: HTTP Basic Auth (privateKey:publicKey) - reversed
  console.log('=== Testing HTTP Basic Auth (privateKey:publicKey) ===');
  const basicAuth2 = await testWithAuth({
    name: 'Basic Auth (privateKey:publicKey) - reversed',
    path: testPath,
    authType: 'basic',
    username: privateKey,
    password: publicKey
  });
  results.authTests.push(basicAuth2);

  // Test 3: Header with private key
  console.log('=== Testing Header Auth (stamped-api-key: privateKey) ===');
  const headerAuth1 = await testWithAuth({
    name: 'Header (stamped-api-key: privateKey)',
    path: testPath,
    authType: 'header',
    apiKey: privateKey
  });
  results.authTests.push(headerAuth1);

  // Test 4: Header with public key
  console.log('=== Testing Header Auth (stamped-api-key: publicKey) ===');
  const headerAuth2 = await testWithAuth({
    name: 'Header (stamped-api-key: publicKey)',
    path: testPath,
    authType: 'header',
    apiKey: publicKey
  });
  results.authTests.push(headerAuth2);

  // Test 5: Both Basic Auth AND Header
  console.log('=== Testing Both Basic Auth + Header ===');
  const bothAuth = await testWithAuth({
    name: 'Both Basic Auth + Header',
    path: testPath,
    authType: 'both',
    username: publicKey,
    password: privateKey,
    apiKey: privateKey
  });
  results.authTests.push(bothAuth);

  // Find working auth method
  const workingAuth = results.authTests.find(t => t.status === 200);
  
  if (workingAuth) {
    results.recommendation = `✅ SUCCESS! Use "${workingAuth.name}" authentication method`;
    results.workingMethod = workingAuth.name;
    
    // If we found a working method, test customer lookup
    if (shopifyId || email) {
      let lookupPath = `/api/v3/merchant/shops/${shopId}/customers/lookup?`;
      if (shopifyId) lookupPath += `shopifyId=${encodeURIComponent(shopifyId)}`;
      if (email) lookupPath += `${shopifyId ? '&' : ''}email=${encodeURIComponent(email)}`;
      
      const customerTest = await testWithAuth({
        name: 'Customer Lookup',
        path: lookupPath,
        ...getAuthConfig(workingAuth.name, publicKey, privateKey)
      });
      results.customerLookup = customerTest;
    }
  } else {
    results.recommendation = '❌ All authentication methods failed. Please verify your API keys.';
    results.possibleIssues = [
      'API keys might be incorrect - double check by copying fresh from Stamped dashboard',
      'Store Hash might be wrong - verify it matches exactly',
      'API keys might not have the required permissions',
      'There might be IP restrictions on the API keys'
    ];
  }

  res.status(200).json(results);
};

function getAuthConfig(methodName, publicKey, privateKey) {
  if (methodName.includes('Header') && methodName.includes('privateKey')) {
    return { authType: 'header', apiKey: privateKey };
  }
  if (methodName.includes('Header') && methodName.includes('publicKey')) {
    return { authType: 'header', apiKey: publicKey };
  }
  if (methodName.includes('reversed')) {
    return { authType: 'basic', username: privateKey, password: publicKey };
  }
  if (methodName.includes('Both')) {
    return { authType: 'both', username: publicKey, password: privateKey, apiKey: privateKey };
  }
  return { authType: 'basic', username: publicKey, password: privateKey };
}

function testWithAuth({ name, path, authType, username, password, apiKey }) {
  return new Promise((resolve) => {
    const options = {
      hostname: 'stamped.io',
      path: path,
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json'
      }
    };

    // Apply authentication based on type
    if (authType === 'basic' || authType === 'both') {
      options.auth = `${username}:${password}`;
    }
    
    if (authType === 'header' || authType === 'both') {
      options.headers['stamped-api-key'] = apiKey;
    }

    console.log(`Testing: ${name}`);
    console.log(`Path: ${path}`);
    console.log(`Auth type: ${authType}`);

    const request = https.request(options, (response) => {
      let data = '';
      
      response.on('data', (chunk) => {
        data += chunk;
      });
      
      response.on('end', () => {
        console.log(`${name}: Status ${response.statusCode}`);
        
        let parsedBody = null;
        try {
          parsedBody = JSON.parse(data);
        } catch (e) {
          parsedBody = { raw: data.substring(0, 300) };
        }

        resolve({
          name: name,
          status: response.statusCode,
          success: response.statusCode === 200,
          responsePreview: JSON.stringify(parsedBody).substring(0, 400)
        });
      });
    });

    request.on('error', (error) => {
      resolve({
        name: name,
        status: 0,
        success: false,
        error: error.message
      });
    });

    request.setTimeout(10000, () => {
      request.destroy();
      resolve({
        name: name,
        status: 0,
        success: false,
        error: 'Timeout'
      });
    });

    request.end();
  });
}
