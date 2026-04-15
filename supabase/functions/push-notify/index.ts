// supabase/functions/push-notify/index.ts
// Triggered by a Supabase Database Webhook on orders UPDATE.
// Sends a Web Push notification to the customer whenever their order status changes.
//
// Deploy:  supabase functions deploy push-notify
// Secrets: supabase secrets set VAPID_PUBLIC_KEY=... VAPID_PRIVATE_KEY=... VAPID_EMAIL=mailto:admin@abinci.food
//
// Database Webhook (Supabase Dashboard → Database → Webhooks):
//   Name: order-status-push
//   Table: public.orders   Event: UPDATE
//   URL: https://<project-ref>.supabase.co/functions/v1/push-notify
//   HTTP Headers: Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
// @deno-types="https://esm.sh/web-push@3/src/index.d.ts"
import webpush from 'https://esm.sh/web-push@3';

const SUPABASE_URL       = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_KEY       = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const VAPID_PUBLIC_KEY   = Deno.env.get('VAPID_PUBLIC_KEY')!;
const VAPID_PRIVATE_KEY  = Deno.env.get('VAPID_PRIVATE_KEY')!;
const VAPID_EMAIL        = Deno.env.get('VAPID_EMAIL') ?? 'mailto:admin@abinci.food';

// Notification copy per status
const MESSAGES: Record<string, { title: string; body: (vendorName: string) => string }> = {
  accepted: {
    title: '✓ Order Accepted',
    body: (v) => `${v} has accepted your order and is preparing it now!`,
  },
  rejected: {
    title: '✕ Order Not Accepted',
    body: (v) => `${v} couldn't accept your order. Please try another vendor.`,
  },
  ready: {
    title: '📦 Order Ready!',
    body: (v) => `Your order from ${v} is ready — a rider will pick it up shortly.`,
  },
  out_for_delivery: {
    title: '🛵 On the Way!',
    body: (v) => `Your order from ${v} is out for delivery. Should arrive soon!`,
  },
  delivered: {
    title: '✅ Order Delivered!',
    body: (v) => `Your order from ${v} has been delivered. Enjoy your meal!`,
  },
};

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  let payload: { record: Record<string, unknown>; old_record: Record<string, unknown> };
  try {
    payload = await req.json();
  } catch {
    return new Response('Bad JSON', { status: 400 });
  }

  const newOrder = payload.record;
  const oldOrder = payload.old_record;

  // Only act on status changes
  if (!newOrder || newOrder.status === oldOrder?.status) {
    return new Response('No status change', { status: 200 });
  }

  const status    = newOrder.status as string;
  const template  = MESSAGES[status];
  if (!template) return new Response('No template for status', { status: 200 });

  const customerId = newOrder.customer_id as string | null;
  if (!customerId) return new Response('No customer_id', { status: 200 });

  const sb = createClient(SUPABASE_URL, SUPABASE_KEY);

  // Look up vendor name for the message body
  let vendorName = 'your vendor';
  if (newOrder.vendor_id) {
    const { data: vendor } = await sb
      .from('vendors')
      .select('business_name')
      .eq('id', newOrder.vendor_id)
      .maybeSingle();
    if (vendor?.business_name) vendorName = vendor.business_name;
  }

  const title = template.title;
  const body  = template.body(vendorName);

  // Save in-app notification
  await sb.from('notifications').insert({
    user_id:  customerId,
    type:     `order_${status}`,
    title,
    body,
    data:     { order_id: newOrder.id, status },
    is_read:  false,
  });

  // Send Web Push (if VAPID configured)
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
    console.warn('VAPID keys not set — skipping web push');
    return new Response(JSON.stringify({ ok: true, push: false }), { status: 200 });
  }

  webpush.setVapidDetails(VAPID_EMAIL, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

  const { data: tokens } = await sb
    .from('push_tokens')
    .select('endpoint, p256dh, auth')
    .eq('user_id', customerId);

  if (!tokens?.length) {
    return new Response(JSON.stringify({ ok: true, push: false, reason: 'no tokens' }), { status: 200 });
  }

  const pushPayload = JSON.stringify({
    title,
    body,
    icon:  '/icon-192.png',
    badge: '/icon-192.png',
    tag:   `order-${newOrder.id}`,
    data:  { orderId: newOrder.id, status },
  });

  const results = await Promise.allSettled(
    tokens.map(async (token) => {
      try {
        await webpush.sendNotification(
          { endpoint: token.endpoint, keys: { p256dh: token.p256dh, auth: token.auth } },
          pushPayload,
        );
      } catch (err: unknown) {
        // 410 = subscription expired — clean it up
        if ((err as { statusCode?: number }).statusCode === 410) {
          await sb.from('push_tokens').delete().eq('endpoint', token.endpoint);
        } else {
          throw err;
        }
      }
    })
  );

  const sent = results.filter(r => r.status === 'fulfilled').length;
  console.log(`Push sent ${sent}/${tokens.length} for order ${newOrder.id} → ${status}`);

  return new Response(JSON.stringify({ ok: true, push: true, sent, total: tokens.length }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
});
