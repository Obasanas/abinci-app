// src/routes/location.js
// POST /location/update          — driver updates their live coordinates
// GET  /location/vendors         — get nearby approved vendors (customer)
// GET  /location/drivers/online  — get online drivers near a point (admin/internal)

import { Router } from 'express';
import { sb } from '../lib/supabase.js';
import { requireAuth, optionalAuth } from '../middleware/auth.js';

const router = Router();

// ── Haversine distance (km) ───────────────────────────────────
function haversine(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLng/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

// ── POST /location/update — driver sends current position ─────
router.post('/update', requireAuth, async (req, res) => {
  try {
    const { lat, lng } = req.body;
    if (typeof lat !== 'number' || typeof lng !== 'number') {
      return res.status(400).json({ error: 'lat and lng must be numbers' });
    }
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      return res.status(400).json({ error: 'Invalid coordinates' });
    }

    const { error } = await sb.from('riders')
      .update({ current_lat: lat, current_lng: lng, location_updated_at: new Date().toISOString() })
      .eq('user_id', req.user.id);

    if (error) return res.status(500).json({ error: error.message });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /location/vendors — nearest approved vendors ──────────
router.get('/vendors', optionalAuth, async (req, res) => {
  try {
    const { lat, lng, radius = 15, limit = 20 } = req.query;

    const { data: vendors, error } = await sb.from('vendors')
      .select('id, business_name, bio, food_types, area, city, logo_url, emoji, is_available, rating, review_count, latitude, longitude, delivery_option, open_time, close_time')
      .eq('is_approved', true)
      .limit(100); // fetch more, then filter/sort by distance

    if (error) return res.status(500).json({ error: error.message });

    let result = vendors || [];

    if (lat && lng) {
      const userLat = parseFloat(lat);
      const userLng = parseFloat(lng);
      const maxRadius = parseFloat(radius);

      result = result
        .map(v => ({
          ...v,
          distance: (v.latitude && v.longitude)
            ? haversine(userLat, userLng, v.latitude, v.longitude)
            : null,
        }))
        .filter(v => v.distance === null || v.distance <= maxRadius)
        .sort((a, b) => {
          // Sort: open first, then by distance, then by rating
          if (a.is_available !== b.is_available) return b.is_available - a.is_available;
          if (a.distance !== null && b.distance !== null) return a.distance - b.distance;
          return (b.rating || 0) - (a.rating || 0);
        })
        .slice(0, parseInt(limit));
    }

    res.json({ vendors: result, count: result.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /location/drivers/online — online drivers near point ──
router.get('/drivers/online', requireAuth, async (req, res) => {
  try {
    // Only vendors and admins can see driver locations
    if (!['vendor', 'admin'].includes(req.user.role)) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const { lat, lng, radius = 10 } = req.query;

    const { data: drivers, error } = await sb.from('riders')
      .select('id, current_lat, current_lng, location_updated_at, vehicle_type, rating')
      .eq('is_approved', true)
      .eq('is_online', true)
      .not('current_lat', 'is', null);

    if (error) return res.status(500).json({ error: error.message });

    let result = drivers || [];

    if (lat && lng) {
      const userLat = parseFloat(lat);
      const userLng = parseFloat(lng);
      const maxRadius = parseFloat(radius);

      result = result
        .map(d => ({
          ...d,
          distance: haversine(userLat, userLng, d.current_lat, d.current_lng),
        }))
        .filter(d => d.distance <= maxRadius)
        .sort((a, b) => a.distance - b.distance);
    }

    res.json({ drivers: result, count: result.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
