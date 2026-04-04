// src/routes/notifications.js
// GET  /notifications          — get user's notifications
// POST /notifications/read-all — mark all as read
// PATCH /notifications/:id/read — mark one as read
// POST /notifications/push-token — register web push subscription
// DELETE /notifications/push-token — remove push subscription

import { Router } from 'express';
import { sb } from '../lib/supabase.js';
import { requireAuth } from '../middleware/auth.js';
import { validate, schemas } from '../middleware/validate.js';

const router = Router();

// ── GET /notifications ────────────────────────────────────────

router.get('/', requireAuth, async (req, res) => {
  try {
    const { data: notifications, error } = await sb.from('notifications')
      .select('id, type, title, body, data, is_read, created_at')
      .eq('user_id', req.user.id)
      .order('created_at', { ascending: false })
      .limit(50);

    if (error) return res.status(500).json({ error: error.message });

    const unreadCount = notifications?.filter(n => !n.is_read).length || 0;
    res.json({ notifications, unreadCount });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /notifications/read-all ─────────────────────────────

router.post('/read-all', requireAuth, async (req, res) => {
  try {
    const { error } = await sb.from('notifications')
      .update({ is_read: true })
      .eq('user_id', req.user.id)
      .eq('is_read', false);

    if (error) return res.status(500).json({ error: error.message });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── PATCH /notifications/:id/read ────────────────────────────

router.patch('/:id/read', requireAuth, async (req, res) => {
  try {
    const { error } = await sb.from('notifications')
      .update({ is_read: true })
      .eq('id', req.params.id)
      .eq('user_id', req.user.id);

    if (error) return res.status(500).json({ error: error.message });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /notifications/push-token ───────────────────────────

router.post('/push-token', validate(schemas.registerPush), async (req, res) => {
  try {
    const { endpoint, p256dh, auth, user_id } = req.body;

    // user_id can come from auth header or body (for pre-auth registration)
    const uid = req.user?.id || user_id;
    if (!uid) return res.status(400).json({ error: 'user_id required' });

    const { error } = await sb.from('push_tokens').upsert({
      user_id:  uid,
      endpoint,
      p256dh,
      auth,
    }, { onConflict: 'endpoint' });

    if (error) return res.status(500).json({ error: error.message });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── DELETE /notifications/push-token ─────────────────────────

router.delete('/push-token', requireAuth, async (req, res) => {
  try {
    const { endpoint } = req.body;
    if (!endpoint) return res.status(400).json({ error: 'endpoint required' });

    const { error } = await sb.from('push_tokens')
      .delete()
      .eq('endpoint', endpoint)
      .eq('user_id', req.user.id);

    if (error) return res.status(500).json({ error: error.message });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
