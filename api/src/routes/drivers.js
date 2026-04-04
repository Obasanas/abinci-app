// src/routes/drivers.js
// GET    /drivers/me               — get own driver profile
// POST   /drivers/kyc              — submit KYC application
// PATCH  /drivers/online           — toggle online/offline
// GET    /drivers/available-orders — list ready orders near driver
// POST   /drivers/accept/:orderId  — accept a delivery
// PATCH  /drivers/:id/approve      — (admin) approve driver
// PATCH  /drivers/:id/reject       — (admin) reject driver

import { Router } from 'express';
import { sb } from '../lib/supabase.js';
import { requireAuth } from '../middleware/auth.js';
import { logger } from '../lib/logger.js';

const router = Router();

// ── GET /drivers/me ──────────────────────────────────────────
router.get('/me', requireAuth, async (req, res) => {
  try {
    const { data, error } = await sb.from('riders')
      .select('*')
      .eq('user_id', req.user.id)
      .maybeSingle();
    if (error) return res.status(500).json({ error: error.message });
    res.json({ driver: data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /drivers/kyc ─────────────────────────────────────────
router.post('/kyc', requireAuth, async (req, res) => {
  try {
    const {
      vehicle_type, vehicle_plate, service_area,
      bank_name, account_number, account_name,
      nin, emergency_contact_name, emergency_contact_phone,
    } = req.body;

    if (!vehicle_type || !service_area) {
      return res.status(400).json({ error: 'vehicle_type and service_area are required' });
    }

    // Check if driver profile already exists
    const { data: existing } = await sb.from('riders')
      .select('id').eq('user_id', req.user.id).maybeSingle();

    const payload = {
      user_id: req.user.id,
      vehicle_type,
      vehicle_plate: vehicle_plate || null,
      service_area,
      bank_name: bank_name || null,
      account_number: account_number || null,
      account_name: account_name || null,
      nin: nin || null,
      emergency_contact_name: emergency_contact_name || null,
      emergency_contact_phone: emergency_contact_phone || null,
      is_approved: false,
      is_online: false,
      kyc_submitted_at: new Date().toISOString(),
    };

    let driver, dbErr;
    if (existing) {
      const r = await sb.from('riders').update(payload).eq('id', existing.id).select().single();
      driver = r.data; dbErr = r.error;
    } else {
      const r = await sb.from('riders').insert(payload).select().single();
      driver = r.data; dbErr = r.error;
    }

    if (dbErr) {
      logger.error('KYC submit error', { error: dbErr.message });
      return res.status(500).json({ error: dbErr.message });
    }

    logger.info('Driver KYC submitted', { userId: req.user.id });
    res.status(201).json({ success: true, driver });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── PATCH /drivers/online ─────────────────────────────────────
router.patch('/online', requireAuth, async (req, res) => {
  try {
    const { is_online } = req.body;
    if (typeof is_online !== 'boolean') {
      return res.status(400).json({ error: 'is_online must be a boolean' });
    }

    const { data, error } = await sb.from('riders')
      .update({ is_online })
      .eq('user_id', req.user.id)
      .select('id, is_online').single();

    if (error) return res.status(500).json({ error: error.message });
    res.json({ driver: data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /drivers/available-orders ─────────────────────────────
// Returns 'ready' orders with no rider assigned, optionally sorted by distance
router.get('/available-orders', requireAuth, async (req, res) => {
  try {
    const { lat, lng, radius = 20 } = req.query;

    let query = sb.from('orders')
      .select('*, vendors(id, business_name, area, city, emoji, latitude, longitude)')
      .eq('status', 'ready')
      .is('rider_id', null)
      .order('created_at', { ascending: false })
      .limit(20);

    const { data: orders, error } = await query;
    if (error) return res.status(500).json({ error: error.message });

    let result = orders || [];

    // If coordinates provided, filter by radius and sort by distance
    if (lat && lng) {
      const userLat = parseFloat(lat);
      const userLng = parseFloat(lng);
      const maxRadius = parseFloat(radius);

      result = result
        .map(o => {
          if (!o.vendors?.latitude || !o.vendors?.longitude) return { ...o, distance: null };
          const distance = haversine(userLat, userLng, o.vendors.latitude, o.vendors.longitude);
          return { ...o, distance };
        })
        .filter(o => o.distance === null || o.distance <= maxRadius)
        .sort((a, b) => {
          if (a.distance === null) return 1;
          if (b.distance === null) return -1;
          return a.distance - b.distance;
        });
    }

    res.json({ orders: result, count: result.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /drivers/accept/:orderId ─────────────────────────────
router.post('/accept/:orderId', requireAuth, async (req, res) => {
  try {
    const { orderId } = req.params;

    // Get driver profile
    const { data: driver } = await sb.from('riders')
      .select('id, is_approved, is_online')
      .eq('user_id', req.user.id)
      .single();

    if (!driver) return res.status(404).json({ error: 'Driver profile not found' });
    if (!driver.is_approved) return res.status(403).json({ error: 'Driver not yet approved' });
    if (!driver.is_online) return res.status(400).json({ error: 'Go online to accept deliveries' });

    // Verify order is still available
    const { data: order } = await sb.from('orders')
      .select('id, status, rider_id')
      .eq('id', orderId)
      .single();

    if (!order) return res.status(404).json({ error: 'Order not found' });
    if (order.status !== 'ready') return res.status(400).json({ error: `Order is ${order.status}, not ready` });
    if (order.rider_id) return res.status(400).json({ error: 'Order already taken by another driver' });

    // Assign driver and update status
    const { data: updated, error } = await sb.from('orders')
      .update({ rider_id: driver.id, status: 'out_for_delivery' })
      .eq('id', orderId)
      .is('rider_id', null) // Atomic — only succeeds if no rider yet
      .select()
      .single();

    if (error || !updated) {
      return res.status(409).json({ error: 'Order was just taken by another driver. Try the next one.' });
    }

    logger.info('Driver accepted order', { driverId: driver.id, orderId });
    res.json({ success: true, order: updated });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── PATCH /drivers/:id/approve — Admin only ───────────────────
router.patch('/:id/approve', requireAuth, async (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
    const { data, error } = await sb.from('riders')
      .update({ is_approved: true }).eq('id', req.params.id).select().single();
    if (error) return res.status(500).json({ error: error.message });
    logger.info('Driver approved', { driverId: req.params.id, adminId: req.user.id });
    res.json({ success: true, driver: data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── PATCH /drivers/:id/reject — Admin only ────────────────────
router.patch('/:id/reject', requireAuth, async (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
    const { data, error } = await sb.from('riders')
      .update({ is_approved: false }).eq('id', req.params.id).select().single();
    if (error) return res.status(500).json({ error: error.message });
    res.json({ success: true, driver: data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /drivers — Admin: list all drivers ────────────────────
router.get('/', requireAuth, async (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
    const { data, error } = await sb.from('riders')
      .select('*, users(full_name, phone, created_at)')
      .order('created_at', { ascending: false });
    if (error) return res.status(500).json({ error: error.message });
    res.json({ drivers: data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /drivers/driver-orders — driver's own delivery history ─
router.get('/my-orders', requireAuth, async (req, res) => {
  try {
    const { data: driver } = await sb.from('riders').select('id').eq('user_id', req.user.id).single();
    if (!driver) return res.status(404).json({ error: 'Driver not found' });
    const { data, error } = await sb.from('orders')
      .select('*, vendors(business_name)')
      .eq('rider_id', driver.id)
      .order('created_at', { ascending: false })
      .limit(50);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ orders: data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Haversine helper ──────────────────────────────────────────
function haversine(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180) * Math.cos(lat2*Math.PI/180) * Math.sin(dLng/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

export default router;
