// src/routes/auth.js
// POST /auth/send-otp   — send SMS OTP via Africa's Talking
// POST /auth/verify-otp — verify code, return user + session
// GET  /auth/me         — get current user profile

import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { sendOTP, verifyOTP, normalisePhone } from '../services/otp.service.js';
import { sb } from '../lib/supabase.js';
import { requireAuth } from '../middleware/auth.js';
import { validate, schemas } from '../middleware/validate.js';
import { logger } from '../lib/logger.js';

const router = Router();

// Strict rate limit on OTP send — max 5 per phone per 15 min
const otpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: parseInt(process.env.OTP_RATE_LIMIT_MAX || '5', 10),
  keyGenerator: (req) => normalisePhone(req.body?.phone || req.ip),
  message: { error: 'Too many OTP requests. Please wait 15 minutes.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// ── POST /auth/send-otp ───────────────────────────────────────

router.post('/send-otp', otpLimiter, validate(schemas.sendOTP), async (req, res) => {
  try {
    const { phone } = req.body;
    const result = await sendOTP(phone);
    logger.info('OTP sent', { phone: result.phone });
    res.json({
      success: true,
      phone: result.phone,
      expiresAt: result.expiresAt,
      message: 'OTP sent successfully',
    });
  } catch (err) {
    logger.error('Send OTP error', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

// ── POST /auth/verify-otp ─────────────────────────────────────

router.post('/verify-otp', validate(schemas.verifyOTP), async (req, res) => {
  try {
    const { phone, code, name, role } = req.body;

    // Verify the code
    const result = await verifyOTP(phone, code);
    if (!result.valid) {
      return res.status(400).json({ error: result.reason });
    }

    const normPhone = result.phone;

    // Check if user already exists
    let { data: existing } = await sb.from('users')
      .select('*')
      .eq('phone', normPhone)
      .maybeSingle();

    let user = existing;

    if (!existing) {
      // New user — role is required for signup
      if (!role) {
        return res.status(400).json({ error: 'role is required for new users (customer or vendor)' });
      }

      // Create user record
      const { data: newUser, error: createErr } = await sb.from('users').insert({
        phone:     normPhone,
        full_name: name || '',
        role,
      }).select().single();

      if (createErr) {
        logger.error('User create error', { error: createErr.message });
        return res.status(500).json({ error: 'Could not create account' });
      }

      user = newUser;
      logger.info('New user created', { id: user.id, role });
    }

    // If vendor, check if they have a vendor profile
    let vendorProfile = null;
    if (user.role === 'vendor') {
      const { data: vp } = await sb.from('vendors')
        .select('id, business_name, is_available')
        .eq('user_id', user.id)
        .maybeSingle();
      vendorProfile = vp;
    }

    logger.info('User verified', { id: user.id, role: user.role, isNew: !existing });

    res.json({
      success: true,
      isNewUser: !existing,
      user: {
        id:        user.id,
        phone:     user.phone,
        full_name: user.full_name,
        role:      user.role,
        avatar_url:user.avatar_url,
      },
      vendorProfile,
    });

  } catch (err) {
    logger.error('Verify OTP error', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

// ── GET /auth/me ──────────────────────────────────────────────

router.get('/me', requireAuth, async (req, res) => {
  try {
    const { data: user, error } = await sb.from('users')
      .select('id, phone, full_name, role, avatar_url, created_at')
      .eq('id', req.user.id)
      .single();

    if (error || !user) return res.status(404).json({ error: 'User not found' });

    let vendorProfile = null;
    if (user.role === 'vendor') {
      const { data: vp } = await sb.from('vendors')
        .select('id, business_name, is_available, logo_url, food_types, city, area')
        .eq('user_id', user.id)
        .maybeSingle();
      vendorProfile = vp;
    }

    res.json({ user, vendorProfile });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── PATCH /auth/me — update profile ───────────────────────────

router.patch('/me', requireAuth, async (req, res) => {
  const allowed = ['full_name', 'avatar_url'];
  const updates = {};
  allowed.forEach(k => { if (req.body[k] !== undefined) updates[k] = req.body[k]; });

  if (!Object.keys(updates).length) {
    return res.status(400).json({ error: 'No valid fields to update' });
  }

  const { data, error } = await sb.from('users')
    .update(updates)
    .eq('id', req.user.id)
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.json({ user: data });
});

export default router;
