const express = require('express');
const path = require('path');
const app = express();
const PORT = process.env.PORT || 3003;

const SB_URL = process.env.SUPABASE_URL || 'https://kikeyhwbziumyhcnsvhi.supabase.co';
const SB_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imtpa2V5aHdieml1bXloY25zdmhpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI4OTk5OTMsImV4cCI6MjA4ODQ3NTk5M30.4R9XP1DOx358SJE0VPm3y8NimoCoVKVcJqPDSvLiHJc';
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || SB_ANON;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'abinci2025admin';

app.use(express.json());
app.use(express.static(path.join(__dirname), {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('sw.js')) {
      res.setHeader('Content-Type', 'application/javascript');
      res.setHeader('Service-Worker-Allowed', '/');
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    }
    if (filePath.endsWith('manifest.json')) {
      res.setHeader('Content-Type', 'application/manifest+json');
    }
  }
}));

// ── Helpers ───────────────────────────────────────────────────
function sbHeaders() {
  return {
    'Content-Type': 'application/json',
    'apikey': SB_KEY,
    'Authorization': `Bearer ${SB_KEY}`,
    'Prefer': 'return=representation',
  };
}
async function sbGet(path) {
  const r = await fetch(`${SB_URL}/rest/v1/${path}`, { headers: sbHeaders() });
  return r.json();
}
async function sbPatch(path, body) {
  const r = await fetch(`${SB_URL}/rest/v1/${path}`, {
    method: 'PATCH', headers: sbHeaders(), body: JSON.stringify(body),
  });
  return r.json();
}

// ── Admin key middleware ───────────────────────────────────────
function requireAdmin(req, res, next) {
  const key = req.headers['x-admin-key'] || req.body?.adminKey;
  if (key !== ADMIN_PASSWORD) return res.status(401).json({ error: 'Unauthorized' });
  next();
}

// ── Auth endpoint ─────────────────────────────────────────────
app.post('/api/admin-auth', (req, res) => {
  const { password } = req.body;
  if (password === ADMIN_PASSWORD) {
    res.json({ ok: true });
  } else {
    res.status(401).json({ ok: false, error: 'Invalid password' });
  }
});

// ── Customers endpoints ───────────────────────────────────────
app.get('/api/admin/customers', requireAdmin, async (req, res) => {
  try {
    const data = await sbGet('users?role=eq.customer&order=created_at.desc&limit=100&select=id,full_name,phone,created_at');
    res.json({ customers: Array.isArray(data) ? data : [] });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.patch('/api/admin/customers/:id/suspend', requireAdmin, async (req, res) => {
  try {
    await sbPatch(`users?id=eq.${req.params.id}`, { is_suspended: true });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.patch('/api/admin/customers/:id/activate', requireAdmin, async (req, res) => {
  try {
    await sbPatch(`users?id=eq.${req.params.id}`, { is_suspended: false });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Reports endpoints ─────────────────────────────────────────
app.get('/api/admin/reports', requireAdmin, async (req, res) => {
  try {
    const data = await sbGet('customer_reports?order=created_at.desc&select=id,reason,details,status,created_at,customer_id,order_id,driver:users!customer_reports_driver_id_fkey(full_name)');
    res.json({ reports: Array.isArray(data) ? data : [] });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.patch('/api/admin/reports/:id', requireAdmin, async (req, res) => {
  try {
    const { status } = req.body;
    await sbPatch(`customer_reports?id=eq.${req.params.id}`, { status });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('*', (req, res) => {
  if (req.path.includes('.')) return res.status(404).end();
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, () => console.log(`Admin app running on port ${PORT}`));
