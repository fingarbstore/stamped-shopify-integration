# Shopify Stamped.io Backend API

A serverless backend proxy API deployed on Vercel that securely retrieves customer loyalty data from Stamped.io and exposes it to your Shopify storefront.

**Live API:** `https://stamped-shopify-integration-l8dp.vercel.app`

---

## 📋 Table of Contents

- [Overview](#overview)
- [Architecture](#architecture)
- [Prerequisites](#prerequisites)
- [Setup](#setup)
- [API Endpoints](#api-endpoints)
- [Environment Variables](#environment-variables)
- [Security](#security)
- [Development](#development)
- [Deployment](#deployment)
- [Troubleshooting](#troubleshooting)
- [Support](#support)

---

## Overview

This API acts as a secure middleware between your Shopify store and Stamped.io's loyalty program API. It:

- ✅ Protects your Stamped.io private API keys from client-side exposure
- ✅ Provides customer points, tier status, and loyalty data
- ✅ Returns available coupons and rewards for customers
- ✅ Handles CORS for secure cross-origin requests
- ✅ Runs serverless on Vercel with automatic scaling

**Use Case:** Display customer loyalty information (points, rewards, coupons) on your Shopify storefront without exposing sensitive API credentials.

---

## Architecture

```
┌─────────────────┐         ┌──────────────────┐         ┌─────────────────┐
│  Shopify Store  │ ──────> │  Vercel API      │ ──────> │  Stamped.io     │
│  (Frontend)     │ <────── │  (This Codebase) │ <────── │  (Loyalty API)  │
└─────────────────┘         └──────────────────┘         └─────────────────┘
    JavaScript                  Node.js (Async)              REST API
    Fetch Requests              CORS Enabled                 Private Keys
```

**Tech Stack:**
- **Runtime:** Node.js 18+ (Serverless Functions)
- **Hosting:** Vercel
- **HTTP Client:** Native `https` module
- **Authentication:** Header-based API key authentication

**File Structure:**
```
/api
  ├── customer.js     # GET customer points & tier data
  ├── coupons.js      # GET customer discount coupons
  ├── rewards.js      # GET available loyalty rewards
  ├── history.js      # GET customer loyalty history
  ├── expiry.js       # GET points expiration data
  └── debug.js        # Debug endpoint (dev only)
package.json          # Project metadata
vercel.json           # Vercel configuration (memory, timeout)
README.md             # This file
```

---

## Prerequisites

Before you begin, ensure you have:

1. **A Stamped.io account** with loyalty program enabled
2. **Stamped.io API credentials** (public key, private key, store hash)
3. **A Vercel account** (free tier works)
4. **A GitHub account** (for repository hosting)
5. **Git installed locally** (for pushing code)

---

## Setup

### 1. Get Stamped API Credentials

1. Log into your [Stamped.io dashboard](https://stamped.io/dashboard)
2. Navigate to **Settings → API Keys**
3. Copy the following:
   - **Public API Key** (starts with `pub_`)
   - **Private API Key** (starts with `priv_`)
   - **Store Hash** (usually your store name, e.g., `garbstore`)

⚠️ **Keep your Private API Key secret!** Never commit it to your repository or expose it in client-side code.

---

### 2. Deploy to Vercel

#### Option A: Deploy from GitHub (Recommended)

1. **Push this code to GitHub:**
   ```bash
   git init
   git add .
   git commit -m "Initial commit"
   git remote add origin https://github.com/YOUR_USERNAME/stamped-shopify-integration.git
   git push -u origin main
   ```

2. **Import to Vercel:**
   - Go to [vercel.com](https://vercel.com)
   - Click **"Add New Project"**
   - Import your GitHub repository
   - Vercel will auto-detect the configuration from `vercel.json`

3. **Add Environment Variables in Vercel:**
   - Go to **Project Settings → Environment Variables**
   - Add the following:
     ```
     STAMPED_PUBLIC_KEY=pub_xxxxxxxxxxxx
     STAMPED_PRIVATE_KEY=priv_xxxxxxxxxxxx
     STAMPED_STORE_HASH=your-store-name
     ```
   - Apply to: **Production, Preview, and Development**

4. **Deploy:**
   - Click **"Deploy"**
   - Vercel will build and deploy your API
   - Your API will be live at `https://your-project.vercel.app`

#### Option B: Deploy with Vercel CLI

```bash
npm install -g vercel
vercel login
vercel --prod
```

Follow the prompts and add environment variables when asked.

---

### 3. Test Your Endpoints

Once deployed, test your API endpoints in a browser or with `curl`:

#### Get Customer Data
```bash
curl "https://your-project.vercel.app/api/customer?email=test@example.com"
```

#### Get Customer Coupons
```bash
curl "https://your-project.vercel.app/api/coupons?email=test@example.com&status=active"
```

#### Get Available Rewards
```bash
curl "https://your-project.vercel.app/api/rewards"
```

**Expected Response:**
```json
{
  "success": true,
  "data": { ... }
}
```

---

## API Endpoints

### `GET /api/customer`

Returns customer loyalty points and tier information.

**Parameters:**
| Parameter | Type   | Required | Description              |
|-----------|--------|----------|--------------------------|
| `email`   | string | Yes      | Customer email address   |
| `shopifyId` | string | No     | Shopify customer ID      |
| `debug`   | string | No       | Set to `'true'` for raw response |

**Example Request:**
```javascript
fetch('https://your-api.vercel.app/api/customer?email=customer@example.com')
  .then(res => res.json())
  .then(data => console.log(data));
```

**Example Response:**
```json
{
  "success": true,
  "data": {
    "points": {
      "balance": 500,
      "lifetime": 1200,
      "pending": 50
    },
    "tier": {
      "current": "Gold",
      "nextTier": "Platinum",
      "pointsToNext": 500
    },
    "customerId": "stamped_customer_id"
  }
}
```

**Error Response:**
```json
{
  "success": false,
  "error": "shopifyId or email parameter required",
  "usage": "/api/customer?shopifyId=7818143373876"
}
```

---

### `GET /api/coupons`

Returns customer's discount coupons from Stamped loyalty program.

**Parameters:**
| Parameter | Type   | Required | Description              |
|-----------|--------|----------|--------------------------|
| `email`   | string | Yes      | Customer email address   |
| `shopifyId` | string | No     | Shopify customer ID      |
| `customerId` | string | No   | Stamped customer ID      |
| `status`  | string | No       | Filter: `active`, `used`, `expired`, `all` (default: `all`) |
| `debug`   | string | No       | Set to `'true'` for raw response |

**Example Request:**
```javascript
fetch('https://your-api.vercel.app/api/coupons?email=customer@example.com&status=active')
  .then(res => res.json())
  .then(data => console.log(data));
```

**Example Response:**
```json
{
  "success": true,
  "data": {
    "active": [
      {
        "code": "SAVE10",
        "discountText": "10% off",
        "expiresAt": "2025-12-31",
        "daysUntilExpiry": 45,
        "status": "active"
      }
    ],
    "used": [],
    "expired": []
  }
}
```

---

### `GET /api/rewards`

Returns list of available rewards that customers can redeem with points.

**Parameters:**
| Parameter | Type   | Required | Description              |
|-----------|--------|----------|--------------------------|
| `debug`   | string | No       | Set to `'true'` for raw response |

**Example Request:**
```javascript
fetch('https://your-api.vercel.app/api/rewards')
  .then(res => res.json())
  .then(data => console.log(data));
```

**Example Response:**
```json
{
  "success": true,
  "data": {
    "rewards": [
      {
        "id": "reward_123",
        "name": "£5 Off",
        "pointsCost": 500,
        "discountText": "£5 OFF",
        "discountType": "fixed_amount",
        "discountValue": 5,
        "enabled": true
      },
      {
        "id": "reward_456",
        "name": "10% Off",
        "pointsCost": 300,
        "discountText": "10% OFF",
        "discountType": "percentage",
        "discountValue": 10,
        "enabled": true
      }
    ]
  }
}
```

---

### `GET /api/history`

Returns customer's loyalty activity history (points earned, redeemed, etc.).

**Parameters:**
| Parameter | Type   | Required | Description              |
|-----------|--------|----------|--------------------------|
| `email`   | string | Yes      | Customer email address   |
| `shopifyId` | string | No     | Shopify customer ID      |

**Example Response:**
```json
{
  "success": true,
  "data": {
    "history": [
      {
        "date": "2025-01-15",
        "action": "earned",
        "points": 50,
        "description": "Purchase #12345"
      }
    ]
  }
}
```

---

### `GET /api/expiry`

Returns information about customer's expiring points.

**Parameters:**
| Parameter | Type   | Required | Description              |
|-----------|--------|----------|--------------------------|
| `email`   | string | Yes      | Customer email address   |
| `shopifyId` | string | No     | Shopify customer ID      |

---

### `GET /api/debug` (Development Only)

Debug endpoint for testing API responses. **Remove in production.**

---

## Environment Variables

Configure these in your Vercel project settings:

| Variable | Description | Example |
|----------|-------------|---------|
| `STAMPED_PUBLIC_KEY` | Your Stamped.io public API key | `pub_abc123...` |
| `STAMPED_PRIVATE_KEY` | Your Stamped.io private API key | `priv_xyz789...` |
| `STAMPED_STORE_HASH` | Your store identifier | `garbstore` |

**How to add in Vercel:**
1. Go to your project dashboard
2. Click **Settings → Environment Variables**
3. Add each variable with its value
4. Select which environments (Production, Preview, Development)
5. Click **Save**

---

## Security

### Current Security Measures

✅ **CORS Protection**
- Only allows requests from your specified domains
- Configured in each endpoint's `allowedOrigins` array
- Current allowed origins:
  - `https://coverfutureandthegarbstore.com`
  - `https://www.coverfutureandthegarbstore.com`
  - `http://localhost:3000` (development only)

✅ **API Key Protection**
- Private keys stored as environment variables (not in code)
- Never exposed to client-side JavaScript
- Transmitted via secure HTTPS headers

✅ **Input Validation**
- Email and parameter validation in all endpoints
- Prevents injection attacks

### Security Best Practices

⚠️ **Recommended Improvements:**

1. **Rate Limiting** - Add rate limiting to prevent API abuse (see documentation)
2. **API Authentication** - Consider adding your own API key for requests from your storefront
3. **Request Logging** - Monitor suspicious activity
4. **Error Messages** - Don't expose internal errors in production

---

## Development

### Local Development Setup

1. **Clone the repository:**
   ```bash
   git clone https://github.com/fingarbstore/stamped-shopify-integration.git
   cd stamped-shopify-integration
   ```

2. **Install Vercel CLI:**
   ```bash
   npm install -g vercel
   ```

3. **Link to your Vercel project:**
   ```bash
   vercel link
   ```

4. **Pull environment variables:**
   ```bash
   vercel env pull
   ```
   This creates a `.env` file with your environment variables.

5. **Run locally:**
   ```bash
   vercel dev
   ```
   Your API will run at `http://localhost:3000`

6. **Test locally:**
   ```bash
   curl "http://localhost:3000/api/customer?email=test@example.com"
   ```

### Debug Mode

All endpoints support a `debug=true` parameter for raw API responses:

```bash
curl "https://your-api.vercel.app/api/customer?email=test@example.com&debug=true"
```

This returns the raw response from Stamped.io without processing.

---

## Deployment

### Automatic Deployments

Every push to `main` branch triggers an automatic deployment to Vercel.

**Deployment Flow:**
1. Push code to GitHub
2. Vercel detects the push
3. Builds and deploys automatically
4. Production URL is updated

### Manual Deployment

```bash
vercel --prod
```

### Monitoring Deployments

- View deployments at: https://vercel.com/[your-username]/stamped-shopify-integration
- See logs, errors, and performance metrics
- Current status: **90 successful deployments**

---

## Troubleshooting

### Common Issues

#### **1. "Server misconfiguration" error**
**Cause:** Environment variables not set correctly in Vercel.

**Fix:**
1. Go to Vercel Dashboard → Settings → Environment Variables
2. Verify all three variables are set: `STAMPED_PUBLIC_KEY`, `STAMPED_PRIVATE_KEY`, `STAMPED_STORE_HASH`
3. Redeploy your project

---

#### **2. "shopifyId or email parameter required"**
**Cause:** Missing required query parameters in your request.

**Fix:**
Ensure your request includes `email` or `shopifyId`:
```javascript
// ✅ Correct
fetch('https://your-api.vercel.app/api/customer?email=test@example.com')

// ❌ Incorrect
fetch('https://your-api.vercel.app/api/customer')
```

---

#### **3. CORS error in browser console**
**Cause:** Your domain is not in the `allowedOrigins` array.

**Fix:**
1. Open the endpoint file (e.g., `api/customer.js`)
2. Add your domain to `allowedOrigins`:
   ```javascript
   const allowedOrigins = [
     'https://coverfutureandthegarbstore.com',
     'https://www.coverfutureandthegarbstore.com',
     'https://your-new-domain.com',  // Add this
     'http://localhost:3000'
   ];
   ```
3. Commit and push changes

---

#### **4. "Failed to fetch customer data from Stamped"**
**Cause:** Issue with Stamped.io API or incorrect credentials.

**Fix:**
1. Verify your Stamped.io credentials are correct
2. Check if the customer exists in Stamped.io
3. Test with the debug endpoint:
   ```bash
   curl "https://your-api.vercel.app/api/customer?email=test@example.com&debug=true"
   ```
4. Check Vercel logs for detailed error messages

---

#### **5. Timeouts or slow responses**
**Cause:** Stamped.io API is slow or unresponsive.

**Current timeout:** 10 seconds (configured in `vercel.json`)

**Fix:**
- Check Stamped.io status
- Consider adding caching for frequently requested data
- Increase timeout in `vercel.json` (max 60s on Pro plan)

---

### Viewing Logs

**In Vercel Dashboard:**
1. Go to your project
2. Click **"Deployments"**
3. Select a deployment
4. Click **"View Function Logs"**

**Using Vercel CLI:**
```bash
vercel logs
```

---

## Frontend Integration Example

### Vanilla JavaScript

```javascript
async function getCustomerLoyaltyData(email) {
  try {
    const response = await fetch(
      `https://your-api.vercel.app/api/customer?email=${encodeURIComponent(email)}`
    );

    if (!response.ok) {
      throw new Error('Failed to fetch loyalty data');
    }

    const data = await response.json();

    if (data.success) {
      console.log('Points:', data.data.points.balance);
      console.log('Tier:', data.data.tier.current);
      return data.data;
    } else {
      console.error('API Error:', data.error);
    }
  } catch (error) {
    console.error('Network Error:', error);
  }
}

// Usage
getCustomerLoyaltyData('customer@example.com');
```

### React/Next.js

```javascript
import { useState, useEffect } from 'react';

function LoyaltyWidget({ customerEmail }) {
  const [loyaltyData, setLoyaltyData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchLoyalty() {
      try {
        const res = await fetch(
          `https://your-api.vercel.app/api/customer?email=${encodeURIComponent(customerEmail)}`
        );
        const data = await res.json();
        if (data.success) {
          setLoyaltyData(data.data);
        }
      } catch (error) {
        console.error('Error:', error);
      } finally {
        setLoading(false);
      }
    }

    if (customerEmail) {
      fetchLoyalty();
    }
  }, [customerEmail]);

  if (loading) return <div>Loading loyalty data...</div>;
  if (!loyaltyData) return null;

  return (
    <div className="loyalty-widget">
      <h3>Your Rewards</h3>
      <p>Points: {loyaltyData.points.balance}</p>
      <p>Tier: {loyaltyData.tier.current}</p>
    </div>
  );
}
```

---

## Performance

**Current Configuration (vercel.json):**
- **Memory:** 1024 MB
- **Timeout:** 10 seconds
- **Region:** Auto (closest to user)

**Typical Response Times:**
- Customer lookup: ~200-500ms
- Coupons: ~300-700ms
- Rewards: ~150-300ms

**Optimization Tips:**
- Implement caching (Redis, Vercel KV)
- Add rate limiting
- Use Vercel Edge Functions for faster response

---

## Roadmap

Future improvements:

- [ ] Add rate limiting with Vercel KV
- [ ] Implement response caching
- [ ] Add comprehensive error logging
- [ ] Create TypeScript definitions
- [ ] Add integration tests
- [ ] Implement retry logic for failed requests
- [ ] Add health check endpoint
- [ ] Create webhooks for real-time updates

---

## Support

**For issues or questions:**
- **Email:** [finlay@garbstore.com](mailto:finlay@garbstore.com)
- **Stamped.io Documentation:** https://stamped.io/docs
- **Vercel Documentation:** https://vercel.com/docs

---

## License

MIT License

---

## Changelog

### v1.0.0 (2025-01-30)
- Initial release
- Basic customer, coupons, and rewards endpoints
- Vercel deployment configuration
- CORS protection
- Debug mode support
