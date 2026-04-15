# push-notify Edge Function

Sends web push notifications to customers when their order status changes.
Triggered by a Supabase Database Webhook — no Node.js server required.

## Deploy

```bash
# 1. Install Supabase CLI if needed
npm install -g supabase

# 2. Link your project
supabase link --project-ref YOUR_PROJECT_REF

# 3. Generate VAPID keys (one-time)
npx web-push generate-vapid-keys

# 4. Set secrets
supabase secrets set \
  VAPID_PUBLIC_KEY="your_public_key_here" \
  VAPID_PRIVATE_KEY="your_private_key_here" \
  VAPID_EMAIL="mailto:admin@abinci.food"

# 5. Deploy the function
supabase functions deploy push-notify
```

## Set up the Database Webhook

In Supabase Dashboard → Database → Webhooks → Create new webhook:

| Field   | Value |
|---------|-------|
| Name    | `order-status-push` |
| Table   | `public.orders` |
| Events  | ✅ UPDATE |
| URL     | `https://YOUR_PROJECT_REF.supabase.co/functions/v1/push-notify` |
| HTTP Method | POST |
| HTTP Headers | `Authorization: Bearer YOUR_SERVICE_ROLE_KEY` |

## Update the customer app VAPID public key

In `customer-app/index.html`, find `subscribeToPush()` and set the `applicationServerKey`:

```javascript
const sub = await reg.pushManager.subscribe({
  userVisibleOnly: true,
  applicationServerKey: urlBase64ToUint8Array('YOUR_VAPID_PUBLIC_KEY_HERE'),
});
```

Replace `YOUR_VAPID_PUBLIC_KEY_HERE` with the public key from step 3.
