// src/routes/reviews.js
// POST /reviews — submit a review for a vendor

import { Router } from 'express';
import { sb } from '../lib/supabase.js';
import { optionalAuth } from '../middleware/auth.js';
import { logger } from '../lib/logger.js';

const router = Router();

router.post('/', optionalAuth, async (req, res) => {
  try {
    const { vendor_id, customer_name, rating, review_text } = req.body;

    if (!vendor_id || !rating || !review_text) {
      return res.status(400).json({ error: 'vendor_id, rating, and review_text are required' });
    }
    if (rating < 1 || rating > 5) {
      return res.status(400).json({ error: 'rating must be between 1 and 5' });
    }

    // Confirm vendor exists
    const { data: vendor } = await sb.from('vendors').select('id').eq('id', vendor_id).single();
    if (!vendor) return res.status(404).json({ error: 'Vendor not found' });

    const { data: review, error } = await sb.from('reviews').insert({
      vendor_id,
      customer_id:   req.user?.id || null,
      customer_name: customer_name || 'Anonymous',
      rating:        parseInt(rating),
      review_text,
    }).select().single();

    if (error) {
      logger.error('Review insert error', { error: error.message });
      return res.status(500).json({ error: error.message });
    }

    // Fetch updated vendor stats (trigger already updated them)
    const { data: updated } = await sb.from('vendors')
      .select('rating, review_count')
      .eq('id', vendor_id)
      .single();

    res.status(201).json({ review, vendorStats: updated });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
