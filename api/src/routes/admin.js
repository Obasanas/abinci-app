// src/routes/admin.js
// All routes require role = 'admin'
// GET  /admin/stats
// GET  /admin/vendors/pending
// PATCH /admin/vendors/:id/approve
// PATCH /admin/vendors/:id/reject
// GET  /admin/drivers/pending
// PATCH /admin/drivers/:id/approve
// PATCH /admin/drivers/:id/reject

import { Router } from 'express';
import { sb } from '../lib/supabase.js';
import { requireAuth } from '../middleware/auth.js';
import { logger } from '../lib/logger.js';

const router = Router();

// All admin routes require admin role
router.use(requireAuth, (req, res, next) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });
  next();
});

// ── GET /admin/stats ──────────────────────────────────────────
router.get('/stats', async (req, res) => {
  try {
    const today = new Date(); today.setHours(0,0,0,0);
    const [
      { count: vendors },
      { count: vendorsPending },
      { count: customers },
      { count: drivers },
      { count: driversOnline },
      { data: todayOrders },
    ] = await Promise.all([
      sb.from('vendors').select('id', { count: 'exact', head: true }),
      sb.from('vendors').select('id', { count: 'exact', head: true }).eq('is_approved', false),
      sb.from('users').select('id', { count: 'exact', head: true }).eq('role', 'customer'),
      sb.from('riders').select('id', { count: 'exact', head: true }),
      sb.from('riders').select('id', { count: 'exact', head: true }).eq('is_online', true),
      sb.from('orders').select('total_amount, status').gte('created_at', today.toISOString()),
    ]);

    const gmv = (todayOrders || []).reduce((s, o) => s + (o.total_amount || 0), 0);
    const commission = Math.round(gmv * 0.12);
    const ordersToday = (todayOrders || []).length;

    res.json({
      vendors: vendors || 0,
      vendorsPending: vendorsPending || 0,
      customers: customers || 0,
      drivers: drivers || 0,
      driversOnline: driversOnline || 0,
      ordersToday,
      gmvToday: gmv,
      commissionToday: commission,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /admin/vendors/pending ────────────────────────────────
router.get('/vendors/pending', async (req, res) => {
  try {
    const { data, error } = await sb.from('vendors')
      .select('*, users(full_name, phone, created_at)')
      .eq('is_approved', false)
      .order('created_at', { ascending: false });
    if (error) return res.status(500).json({ error: error.message });
    res.json({ vendors: data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── PATCH /admin/vendors/:id/approve ─────────────────────────
router.patch('/vendors/:id/approve', async (req, res) => {
  try {
    const { data, error } = await sb.from('vendors')
      .update({ is_approved: true })
      .eq('id', req.params.id)
      .select().single();
    if (error) return res.status(500).json({ error: error.message });
    logger.info('Admin approved vendor', { vendorId: req.params.id });
    res.json({ success: true, vendor: data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── PATCH /admin/vendors/:id/reject ──────────────────────────
router.patch('/vendors/:id/reject', async (req, res) => {
  try {
    const { reason } = req.body;
    const { data, error } = await sb.from('vendors')
      .update({ is_approved: false, rejection_reason: reason || null })
      .eq('id', req.params.id)
      .select().single();
    if (error) return res.status(500).json({ error: error.message });
    res.json({ success: true, vendor: data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /admin/drivers/pending ────────────────────────────────
router.get('/drivers/pending', async (req, res) => {
  try {
    const { data, error } = await sb.from('riders')
      .select('*, users(full_name, phone, created_at)')
      .eq('is_approved', false)
      .not('kyc_submitted_at', 'is', null)
      .order('kyc_submitted_at', { ascending: false });
    if (error) return res.status(500).json({ error: error.message });
    res.json({ drivers: data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── PATCH /admin/drivers/:id/approve ─────────────────────────
router.patch('/drivers/:id/approve', async (req, res) => {
  try {
    const { data, error } = await sb.from('riders')
      .update({ is_approved: true })
      .eq('id', req.params.id)
      .select().single();
    if (error) return res.status(500).json({ error: error.message });
    logger.info('Admin approved driver', { driverId: req.params.id });
    res.json({ success: true, driver: data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── PATCH /admin/drivers/:id/reject ──────────────────────────
router.patch('/drivers/:id/reject', async (req, res) => {
  try {
    const { reason } = req.body;
    const { data, error } = await sb.from('riders')
      .update({ is_approved: false, rejection_reason: reason || null })
      .eq('id', req.params.id)
      .select().single();
    if (error) return res.status(500).json({ error: error.message });
    res.json({ success: true, driver: data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
