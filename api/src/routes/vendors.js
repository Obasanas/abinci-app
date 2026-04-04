// src/routes/vendors.js
// GET   /vendors          — list all vendors (with optional filters)
// GET   /vendors/:id      — vendor detail with menu + reviews
// PATCH /vendors/:id      — vendor updates their own profile
// PATCH /vendors/:id/availability — toggle open/closed

import { Router } from 'express';
import { sb } from '../lib/supabase.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { validate, schemas } from '../middleware/validate.js';
import { logger } from '../lib/logger.js';

const router = Router();

// ── GET /vendors ──────────────────────────────────────────────

router.get('/', async (req, res) => {
  try {
    const { city, category, available } = req.query;

    let q = sb.from('vendors').select(
      'id, business_name, bio, area, city, logo_url, emoji, food_types, ' +
      'delivery_option, is_available, rating, review_count, open_time, close_time'
    );

    if (city)      q = q.ilike('city', `%${city}%`);
    if (category)  q = q.contains('food_types', [category]);
    if (available === 'true') q = q.eq('is_available', true);

    const { data: vendors, error } = await q
      .order('rating', { ascending: false, nullsFirst: false })
      .limit(100);

    if (error) return res.status(500).json({ error: error.message });
    res.json({ vendors });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /vendors/:id ──────────────────────────────────────────

router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const [{ data: vendor, error: vErr }, { data: menu }, { data: reviews }] = await Promise.all([
      sb.from('vendors').select('*').eq('id', id).single(),
      sb.from('menu_items').select('*').eq('vendor_id', id).eq('is_available', true).order('name'),
      sb.from('reviews').select('id, customer_name, rating, review_text, created_at')
        .eq('vendor_id', id).order('created_at', { ascending: false }).limit(20),
    ]);

    if (vErr || !vendor) return res.status(404).json({ error: 'Vendor not found' });

    res.json({ vendor, menu, reviews });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── PATCH /vendors/:id — update profile ───────────────────────

router.patch('/:id', requireAuth, requireRole('vendor'), validate(schemas.updateVendor), async (req, res) => {
  try {
    const { id } = req.params;

    // Confirm requester owns this vendor
    const { data: vendor } = await sb.from('vendors')
      .select('id, user_id')
      .eq('id', id)
      .single();

    if (!vendor || vendor.user_id !== req.user.id) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const { data: updated, error } = await sb.from('vendors')
      .update(req.body)
      .eq('id', id)
      .select()
      .single();

    if (error) return res.status(500).json({ error: error.message });

    logger.info('Vendor updated', { vendorId: id });
    res.json({ vendor: updated });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── PATCH /vendors/:id/availability ───────────────────────────

router.patch('/:id/availability', requireAuth, requireRole('vendor'), async (req, res) => {
  try {
    const { id } = req.params;
    const { is_available } = req.body;

    if (typeof is_available !== 'boolean') {
      return res.status(400).json({ error: 'is_available must be a boolean' });
    }

    const { data: vendor } = await sb.from('vendors')
      .select('user_id')
      .eq('id', id)
      .single();

    if (!vendor || vendor.user_id !== req.user.id) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const { data: updated, error } = await sb.from('vendors')
      .update({ is_available })
      .eq('id', id)
      .select('id, is_available')
      .single();

    if (error) return res.status(500).json({ error: error.message });
    res.json({ vendor: updated });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /vendors/:id/menu ─────────────────────────────────────

router.get('/:id/menu', async (req, res) => {
  try {
    const { data: menu, error } = await sb.from('menu_items')
      .select('*')
      .eq('vendor_id', req.params.id)
      .eq('is_available', true)
      .order('name');

    if (error) return res.status(500).json({ error: error.message });
    res.json({ menu });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /vendors/:id/menu ────────────────────────────────────

router.post('/:id/menu', requireAuth, requireRole('vendor'), async (req, res) => {
  try {
    const { id } = req.params;

    // Confirm ownership
    const { data: vendor } = await sb.from('vendors').select('user_id').eq('id', id).single();
    if (!vendor || vendor.user_id !== req.user.id) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const { name, price, description, emoji, image_url, plates_available } = req.body;
    if (!name || price === undefined) {
      return res.status(400).json({ error: 'name and price are required' });
    }

    const { data: item, error } = await sb.from('menu_items').insert({
      vendor_id: id,
      name,
      price: parseFloat(price),
      description: description || '',
      emoji: emoji || '🍽️',
      image_url: image_url || null,
      plates_available: plates_available ?? null,
      is_available: true,
    }).select().single();

    if (error) return res.status(500).json({ error: error.message });
    res.status(201).json({ item });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── PATCH /vendors/:id/menu/:itemId ──────────────────────────

router.patch('/:id/menu/:itemId', requireAuth, requireRole('vendor'), async (req, res) => {
  try {
    const { id, itemId } = req.params;
    const { data: vendor } = await sb.from('vendors').select('user_id').eq('id', id).single();
    if (!vendor || vendor.user_id !== req.user.id) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const allowed = ['name', 'price', 'description', 'emoji', 'image_url', 'plates_available', 'is_available'];
    const updates = {};
    allowed.forEach(k => { if (req.body[k] !== undefined) updates[k] = req.body[k]; });

    const { data: item, error } = await sb.from('menu_items')
      .update(updates).eq('id', itemId).eq('vendor_id', id).select().single();

    if (error) return res.status(500).json({ error: error.message });
    res.json({ item });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── DELETE /vendors/:id/menu/:itemId ─────────────────────────

router.delete('/:id/menu/:itemId', requireAuth, requireRole('vendor'), async (req, res) => {
  try {
    const { id, itemId } = req.params;
    const { data: vendor } = await sb.from('vendors').select('user_id').eq('id', id).single();
    if (!vendor || vendor.user_id !== req.user.id) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const { error } = await sb.from('menu_items').delete().eq('id', itemId).eq('vendor_id', id);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
