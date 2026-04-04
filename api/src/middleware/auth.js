// src/middleware/auth.js
// Verifies the Supabase JWT sent in Authorization: Bearer <token>
// Attaches req.user = { id, phone, role } if valid

import { sb } from '../lib/supabase.js';
import { logger } from '../lib/logger.js';

export async function requireAuth(req, res, next) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing authorization token' });
  }

  const token = header.slice(7);

  try {
    const { data: { user }, error } = await sb.auth.getUser(token);
    if (error || !user) {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }

    // Fetch full user profile
    const { data: profile } = await sb.from('users')
      .select('id, phone, role, full_name')
      .eq('id', user.id)
      .maybeSingle();

    req.user = profile || { id: user.id };
    next();
  } catch (err) {
    logger.error('Auth middleware error', { error: err.message });
    res.status(500).json({ error: 'Authentication error' });
  }
}

export function requireRole(role) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
    if (req.user.role !== role) {
      return res.status(403).json({ error: `Access denied — ${role} role required` });
    }
    next();
  };
}

// Optional auth — attaches user if token present, but doesn't block
export async function optionalAuth(req, res, next) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return next();
  try {
    const token = header.slice(7);
    const { data: { user } } = await sb.auth.getUser(token);
    if (user) {
      const { data: profile } = await sb.from('users')
        .select('id, phone, role, full_name')
        .eq('id', user.id)
        .maybeSingle();
      req.user = profile || { id: user.id };
    }
  } catch (_) { /* ignore */ }
  next();
}
