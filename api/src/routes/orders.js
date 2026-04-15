// src/routes/orders.js
// POST   /orders            — place a new order (customer)
// GET    /orders/mine       — customer: get their orders
// GET    /orders/vendor     — vendor: get their incoming orders
// PATCH  /orders/:id/status — vendor: accept / reject / ready

import { Router } from 'express';
import { sb } from '../lib/supabase.js';
import { requireAuth, requireRole, optionalAuth } from '../middleware/auth.js';
import { validate, schemas } from '../middleware/validate.js';
import { notifyVendorNewOrder, notifyCustomerOrderUpdate } from '../services/notification.service.js';
import { logger } from '../lib/logger.js';

const router = Router();

// ── POST /orders — place order ────────────────────────────────

router.post('/', optionalAuth, validate(schemas.placeOrder), async (req, res) => {
  try {
    const body = req.body;

    // Validate vendor exists and is available
    const { data: vendor, error: vErr } = await sb.from('vendors')
      .select('id, business_name, is_available, user_id')
      .eq('id', body.vendor_id)
      .single();

    if (vErr || !vendor) {
      return res.status(404).json({ error: 'Vendor not found' });
    }
    if (!vendor.is_available) {
      return res.status(400).json({ error: 'This vendor is currently unavailable' });
    }

    // Validate plates availability for each item
    const itemNames = body.items.map(i => i.name);
    const { data: menuItems } = await sb.from('menu_items')
      .select('id, name, plates_available, is_available')
      .eq('vendor_id', body.vendor_id)
      .in('name', itemNames);

    for (const ordered of body.items) {
      const mi = menuItems?.find(m => m.name === ordered.name);
      if (mi) {
        if (!mi.is_available) {
          return res.status(400).json({ error: `"${ordered.name}" is no longer available` });
        }
        if (mi.plates_available !== null && mi.plates_available < ordered.qty) {
          return res.status(400).json({
            error: `Only ${mi.plates_available} plate(s) of "${ordered.name}" remaining`,
          });
        }
      }
    }

    // Insert order
    const { data: order, error: oErr } = await sb.from('orders').insert({
      vendor_id:      body.vendor_id,
      customer_id:    req.user?.id || null,
      customer_name:  body.customer_name,
      customer_phone: body.customer_phone,
      items:          body.items,
      total_amount:   body.total_amount,
      delivery_type:  body.delivery_type,
      note:           body.note || null,
      status:         'pending',
    }).select().single();

    if (oErr) {
      logger.error('Order insert error', { error: oErr.message });
      return res.status(500).json({ error: 'Could not place order' });
    }

    logger.info('Order placed', { orderId: order.id, vendorId: body.vendor_id });

    // Notify vendor (fire and forget)
    notifyVendorNewOrder(vendor.user_id, {
      ...order,
      vendor_name: vendor.business_name,
    }).catch(err => logger.warn('Vendor notify failed', { error: err.message }));

    res.status(201).json({ success: true, order });

  } catch (err) {
    logger.error('Place order error', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

// ── GET /orders/mine — customer orders ────────────────────────

router.get('/mine', requireAuth, async (req, res) => {
  try {
    const { data: orders, error } = await sb.from('orders')
      .select(`
        id, status, total_amount, delivery_type, note,
        items, created_at, updated_at,
        vendor:vendors(id, business_name, logo_url, emoji)
      `)
      .eq('customer_id', req.user.id)
      .order('created_at', { ascending: false })
      .limit(50);

    if (error) return res.status(500).json({ error: error.message });
    res.json({ orders });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /orders/vendor — vendor's incoming orders ─────────────

router.get('/vendor', requireAuth, requireRole('vendor'), async (req, res) => {
  try {
    // Get vendor profile
    const { data: vendor } = await sb.from('vendors')
      .select('id')
      .eq('user_id', req.user.id)
      .single();

    if (!vendor) return res.status(404).json({ error: 'Vendor profile not found' });

    const { data: orders, error } = await sb.from('orders')
      .select('*')
      .eq('vendor_id', vendor.id)
      .order('created_at', { ascending: false })
      .limit(100);

    if (error) return res.status(500).json({ error: error.message });
    res.json({ orders });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── PATCH /orders/:id/status — vendor updates order ───────────

router.patch('/:id/status', requireAuth, requireRole('vendor'), validate(schemas.updateOrderStatus), async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    // Verify vendor owns this order
    const { data: vendor } = await sb.from('vendors')
      .select('id, business_name')
      .eq('user_id', req.user.id)
      .single();

    if (!vendor) return res.status(403).json({ error: 'Vendor profile not found' });

    const { data: order, error: fetchErr } = await sb.from('orders')
      .select('*')
      .eq('id', id)
      .eq('vendor_id', vendor.id)
      .single();

    if (fetchErr || !order) {
      return res.status(404).json({ error: 'Order not found or access denied' });
    }

    // Update status
    const { data: updated, error: updateErr } = await sb.from('orders')
      .update({ status })
      .eq('id', id)
      .select()
      .single();

    if (updateErr) return res.status(500).json({ error: updateErr.message });

    logger.info('Order status updated', { orderId: id, status, vendorId: vendor.id });

    // Deduct plates if accepted
    if (status === 'accepted') {
      for (const item of order.items) {
        await sb.from('menu_items')
          .update({ plates_available: sb.rpc('decrement_plates', { item_name: item.name, vendor: vendor.id, qty: item.qty }) })
          .eq('vendor_id', vendor.id)
          .eq('name', item.name)
          .not('plates_available', 'is', null);
      }
    }

    // Notify customer
    const notifType = {
      accepted:         'order_accepted',
      rejected:         'order_rejected',
      ready:            'order_ready',
      out_for_delivery: 'order_out_for_delivery',
      delivered:        'order_delivered',
    }[status];
    if (notifType && order.customer_id) {
      notifyCustomerOrderUpdate(order.customer_id, notifType, {
        ...order,
        vendor_name: vendor.business_name,
      }).catch(err => logger.warn('Customer notify failed', { error: err.message }));
    }

    res.json({ success: true, order: updated });
  } catch (err) {
    logger.error('Update order status error', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

export default router;
