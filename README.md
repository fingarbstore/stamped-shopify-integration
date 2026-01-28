# Shopify Stamped.io Backend API

Backend proxy for retrieving customer loyalty data from Stamped.io.

## Setup

### 1. Get Stamped API Credentials

1. Log into Stamped.io dashboard
2. Go to Settings → API Keys
3. Copy your:
   - Public API Key (starts with `pub_`)
   - Private API Key (starts with `priv_`)
   - Store Hash (usually your store name)

### 2. Deploy to Vercel

1. Push this code to GitHub
2. Go to https://vercel.com
3. Click "Import Project"
4. Select your GitHub repository
5. Add environment variables:
   - `STAMPED_PUBLIC_KEY`
   - `STAMPED_PRIVATE_KEY`
   - `STAMPED_STORE_HASH`
6. Click "Deploy"

### 3. Test Your Endpoints

Visit in browser:
- `https://your-project.vercel.app/api/customer?email=test@example.com`
- `https://your-project.vercel.app/api/coupons?email=test@example.com`
- `https://your-project.vercel.app/api/rewards`

## API Endpoints

### GET /api/customer
Returns customer points and tier data.

**Parameters:**
- `email` (required): Customer email address

**Response:**
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
    }
  }
}
```

### GET /api/coupons
Returns customer's discount coupons.

**Parameters:**
- `email` (required): Customer email
- `status` (optional): active|used|expired|all (default: all)

**Response:**
```json
{
  "success": true,
  "data": {
    "active": [
      {
        "code": "SAVE10",
        "discountText": "10% off",
        "expiresAt": "2025-02-28",
        "daysUntilExpiry": 32
      }
    ]
  }
}
```

### GET /api/rewards
Returns available rewards to redeem.

**Response:**
```json
{
  "success": true,
  "data": {
    "rewards": [
      {
        "id": "reward_123",
        "name": "£5 Off",
        "pointsCost": 500,
        "discountText": "£5 OFF"
      }
    ]
  }
}
```

## Security

- API keys are stored as Vercel environment variables (never in code)
- CORS restricted to your Shopify domain
- Rate limiting recommended for production

## Support

For issues, contact: finlay@garbstore.com
