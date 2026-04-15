// src/services/notification.service.js
// Handles in-app notifications (Supabase) + Web Push

import webpush from 'web-push';
import { sb } from '../lib/supabase.js';
import { logger } from '../lib/logger.js';

// Configure VAPID for Web Push (optional — server starts without it)
const vapidReady = process.env.VAPID_PUBLIC_KEY &&
  process.env.VAPID_PRIVATE_KEY &&
  !process.env.VAPID_PUBLIC_KEY.includes('your_vapid');

if (vapidReady) {
  webpush.setVapidDetails(
    process.env.VAPID_EMAIL || 'mailto:admin@abinci.food',
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY,
  );
  logger.info('Web Push (VAPID) configured ✓');
} else {
  logger.warn('VAPID keys not set — web push notifications disabled. See .env.example.');
}

// ── Notification templates ────────────────────────────────────

const TEMPLATES = {
  new_order: (order) => ({
    title: '🛒 New Order!',
    body:  `${order.customer_name} ordered ${order.items.length} item(s) — ₦${order.total_amount?.toLocaleString()}`,
  }),
  order_accepted: (order) => ({
    title: '✓ Order Accepted',
    body:  `Your order from ${order.vendor_name} has been accepted!`,
  }),
  order_rejected: (order) => ({
    title: '✕ Order Rejected',
    body:  `Your order from ${order.vendor_name} was not accepted. Try another vendor.`,
  }),
  order_ready: (order) => ({
    title: '📦 Order Ready!',
    body:  `Your order from ${order.vendor_name} is ready — a rider will pick it up shortly.`,
  }),
  order_out_for_delivery: (order) => ({
    title: '🛵 On the Way!',
    body:  `Your order from ${order.vendor_name} is out for delivery. Should arrive soon!`,
  }),
  order_delivered: (order) => ({
    title: '✅ Order Delivered!',
    body:  `Your order from ${order.vendor_name} has been delivered. Enjoy your meal!`,
  }),
};

// ── Core: save in-app notification ───────────────────────────

export async function saveNotification(userId, type, data = {}) {
  const template = TEMPLATES[type];
  if (!template) {
    logger.warn('Unknown notification type', { type });
    return;
  }

  const { title, body } = template(data);

  const { error } = await sb.from('notifications').insert({
    user_id: userId,
    type,
    title,
    body,
    data,
    is_read: false,
  });

  if (error) {
    logger.error('Failed to save notification', { userId, type, error: error.message });
  }

  return { title, body };
}

// ── Core: send Web Push ───────────────────────────────────────

async function sendPush(userId, payload) {
  // Fetch all push subscriptions for this user
  const { data: tokens, error } = await sb.from('push_tokens')
    .select('endpoint, p256dh, auth')
    .eq('user_id', userId);

  if (error || !tokens?.length) return;

  const payloadStr = JSON.stringify(payload);

  await Promise.allSettled(
    tokens.map(async (token) => {
      try {
        await webpush.sendNotification(
          { endpoint: token.endpoint, keys: { p256dh: token.p256dh, auth: token.auth } },
          payloadStr,
        );
        logger.debug('Push sent', { userId, endpoint: token.endpoint.slice(0, 40) });
      } catch (pushErr) {
        // 410 Gone = subscription expired — clean it up
        if (pushErr.statusCode === 410) {
          await sb.from('push_tokens').delete().eq('endpoint', token.endpoint);
          logger.info('Removed expired push token', { endpoint: token.endpoint.slice(0, 40) });
        } else {
          logger.warn('Push failed', { error: pushErr.message });
        }
      }
    }),
  );
}

// ── Public: notify with both in-app + push ────────────────────

export async function notify(userId, type, data = {}) {
  if (!userId) return;

  const content = await saveNotification(userId, type, data);
  if (content) {
    await sendPush(userId, {
      title: content.title,
      body:  content.body,
      data:  { type, orderId: data.id },
      icon:  '/icon-192.png',
      badge: '/badge-72.png',
    });
  }
}

// ── Convenience wrappers ──────────────────────────────────────

/** Notify the VENDOR when a new order arrives */
export async function notifyVendorNewOrder(vendorUserId, order) {
  await notify(vendorUserId, 'new_order', order);
}

/** Notify the CUSTOMER when their order status changes */
export async function notifyCustomerOrderUpdate(customerUserId, type, order) {
  await notify(customerUserId, type, order);
}
