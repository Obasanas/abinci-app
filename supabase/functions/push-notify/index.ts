// supabase/functions/push-notify/index.ts
//
// Handles TWO webhook events:
//   INSERT on orders → notify vendor of new order
//   UPDATE on orders → notify customer of status change
//
// Deploy:  supabase functions deploy push-notify
// Secrets: supabase secrets set VAPID_PUBLIC_KEY=... VAPID_PRIVATE_KEY=... VAPID_EMAIL=mailto:admin@abinci.food
//
// Database Webhooks (Supabase Dashboard → Database → Webhooks):
//   1. Name: order-new-vendor   Table: public.orders  Event: INSERT
//      URL: https://<ref>.supabase.co/functions/v1/push-notify
//      Header: Authorization: Bearer <SERVICE_ROLE_KEY>
//
//   2. Name: order-status-push  Table: public.orders  Event: UPDATE
//      URL: https://<ref>.supabase.co/functions/v1/push-notify
//      Header: Authorization: Bearer <SERVICE_ROLE_KEY>

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
// @deno-types="https://esm.sh/web-push@3/src/index.d.ts"
import webpush from 'https://esm.sh/web-push@3';

const SUPABASE_URL      = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_KEY      = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const VAPID_PUBLIC_KEY  = Deno.env.get('VAPID_PUBLIC_KEY')!;
const VAPID_PRIVATE_KEY = Deno.env.get('VAPID_PRIVATE_KEY')!;
const VAPID_EMAIL       = Deno.env.get('VAPID_EMAIL') ?? 'mailto:admin@abinci.food';

// ── Notification copy ─────────────────────────────────────────

const CUSTOMER_MESSAGES: Record<string, { title: string; body: (v: string) => string }> = {
  accepted:         { title: '✓ Order Accepted',      body: (v) => `${v} accepted your order and is preparing it now!` },
  rejected:         { title: '✕ Order Not Accepted',  body: (v) => `${v} couldn't accept your order. Please try another vendor.` },
  ready:            { title: '📦 Order Ready!',        body: (v) => `Your order from ${v} is ready — a rider will pick it up shortly.` },
  out_for_delivery: { title: '🛵 On the Way!',         body: (v) => `Your order from ${v} is out for delivery!` },
  delivered:        { title: '✅ Order Delivered!',    body: (v) => `Your order from ${v} has been delivered. Enjoy your meal!` },
};

// ── Helpers ───────────────────────────────────────────────────

async function sendWebPush(
  sb: ReturnType<typeof createClient>,
  userId: string,
  payload: object,
) {
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) return { sent: 0, total: 0 };

  webpush.setVapidDetails(VAPID_EMAIL, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

  const { data: tokens } = await sb
    .from('push_tokens')
    .select('endpoint, p256dh, auth')
    .eq('user_id', userId);

  if (!tokens?.length) return { sent: 0, total: 0 };

  const payloadStr = JSON.stringify(payload);
  const results = await Promise.allSettled(
    tokens.map(async (token) => {
      try {
        await webpush.sendNotification(
          { endpoint: token.endpoint, keys: { p256dh: token.p256dh, auth: token.auth } },
          payloadStr,
        );
      } catch (err: unknown) {
        if ((err as { statusCode?: number }).statusCode === 410) {
          // Expired subscription — clean it up
          await sb.from('push_tokens').delete().eq('endpoint', token.endpoint);
        } else {
          throw err;
        }
      }
    }),
  );

  return {
    sent: results.filter((r) => r.status === 'fulfilled').length,
    total: tokens.length,
  };
}

async function saveNotification(
  sb: ReturnType<typeof createClient>,
  userId: string,
  type: string,
  title: string,
  body: string,
  data: object,
) {
  await sb.from('notifications').insert({ user_id: userId, type, title, body, data, is_read: false });
}

// ── Main handler ──────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  let payload: { type?: string; record: Record<string, unknown>; old_record?: Record<string, unknown> };
  try { payload = await req.json(); } catch { return new Response('Bad JSON', { status: 400 }); }

  const eventType = payload.type || (payload.old_record ? 'UPDATE' : 'INSERT');
  const order     = payload.record;
  if (!order) return new Response('No record', { status: 400 });

  const sb = createClient(SUPABASE_URL, SUPABASE_KEY);

  // ── INSERT: new order → notify vendor ────────────────────────
  if (eventType === 'INSERT') {
    const vendorId = order.vendor_id as string | null;
    if (!vendorId) return new Response('No vendor_id', { status: 200 });

    const { data: vendor } = await sb
      .from('vendors')
      .select('business_name, user_id')
      .eq('id', vendorId)
      .maybeSingle();

    if (!vendor?.user_id) return new Response('Vendor user_id not found', { status: 200 });

    const itemCount  = (order.items as unknown[])?.length ?? 0;
    const amount     = Number(order.total_amount ?? 0).toLocaleString('en-NG');
    const title      = '🛒 New Order!';
    const body       = `${order.customer_name ?? 'A customer'} ordered ${itemCount} item${itemCount !== 1 ? 's' : ''} — ₦${amount}`;

    await saveNotification(sb, vendor.user_id, 'new_order', title, body, {
      order_id: order.id,
      status: 'pending',
    });

    const { sent, total } = await sendWebPush(sb, vendor.user_id, {
      title, body,
      icon:  '/icon-192.png',
      badge: '/icon-192.png',
      tag:   `order-${order.id}`,
      data:  { orderId: order.id, status: 'pending' },
    });

    console.log(`[INSERT] Vendor notified. Push ${sent}/${total} for order ${order.id}`);
    return new Response(JSON.stringify({ ok: true, event: 'new_order', sent, total }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    });
  }

  // ── UPDATE: status change → notify customer ───────────────────
  if (eventType === 'UPDATE') {
    const oldOrder = payload.old_record;
    if (!order || order.status === oldOrder?.status) {
      return new Response('No status change', { status: 200 });
    }

    const status   = order.status as string;
    const template = CUSTOMER_MESSAGES[status];
    if (!template) return new Response('No template for status', { status: 200 });

    const customerId = order.customer_id as string | null;
    if (!customerId) return new Response('No customer_id', { status: 200 });

    let vendorName = 'your vendor';
    if (order.vendor_id) {
      const { data: vendor } = await sb
        .from('vendors').select('business_name').eq('id', order.vendor_id).maybeSingle();
      if (vendor?.business_name) vendorName = vendor.business_name;
    }

    const title = template.title;
    const body  = template.body(vendorName);

    await saveNotification(sb, customerId, `order_${status}`, title, body, {
      order_id: order.id, status,
    });

    const { sent, total } = await sendWebPush(sb, customerId, {
      title, body,
      icon:  '/icon-192.png',
      badge: '/icon-192.png',
      tag:   `order-${order.id}`,
      data:  { orderId: order.id, status },
    });

    console.log(`[UPDATE] Customer notified (${status}). Push ${sent}/${total} for order ${order.id}`);
    return new Response(JSON.stringify({ ok: true, event: 'status_change', status, sent, total }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    });
  }

  return new Response('Unknown event type', { status: 200 });
});
