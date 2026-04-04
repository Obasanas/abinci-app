// ============================================================
// abinci.food — Shared Utilities & API Client
// Usage: <script src="../shared/js/utils.js"></script>
// ============================================================

// ── Config ──────────────────────────────────────────────────
const ABINCI_CONFIG = {
  SUPABASE_URL:  'https://kikeyhwbziumyhcnsvhi.supabase.co',
  SUPABASE_ANON: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imtpa2V5aHdieml1bXloY25zdmhpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI4OTk5OTMsImV4cCI6MjA4ODQ3NTk5M30.4R9XP1DOx358SJE0VPm3y8NimoCoVKVcJqPDSvLiHJc',
  API_URL: window.ABINCI_API_URL || 'http://localhost:3000',
};

// ── Toast ────────────────────────────────────────────────────
function showToast(msg, type = 'ok') {
  let t = document.getElementById('app-toast');
  if (!t) {
    t = document.createElement('div');
    t.id = 'app-toast';
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.style.borderColor = type === 'err' ? 'var(--red)' : type === 'info' ? 'var(--border)' : 'var(--green)';
  t.style.opacity = '1';
  clearTimeout(t._t);
  t._t = setTimeout(() => { t.style.opacity = '0'; }, 3000);
}

// ── Navigation ───────────────────────────────────────────────
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id)?.classList.add('active');
  window.scrollTo(0, 0);
  // Manage bottom nav visibility
  const noNav = ['screen-auth','screen-otp','screen-onboard','screen-kyc-step1',
    'screen-kyc-step2','screen-kyc-step3','screen-detail','screen-chat','screen-search'];
  const bn = document.getElementById('bottom-nav');
  if (bn) bn.style.display = noNav.includes(id) ? 'none' : 'flex';
}

// ── Time formatting ──────────────────────────────────────────
function timeAgo(d) {
  const s = Math.floor((Date.now() - new Date(d)) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

function formatCurrency(amount) {
  return '₦' + Number(amount || 0).toLocaleString('en-NG');
}

function formatDate(d) {
  return new Date(d).toLocaleDateString('en-NG', { day:'numeric', month:'short', year:'numeric' });
}

// ── Form helpers ─────────────────────────────────────────────
function fieldVal(id) { return document.getElementById(id)?.value.trim() || ''; }
function fieldHasVal(id) { return !!fieldVal(id); }
function countChars(el, cid, max) {
  const el2 = document.getElementById(cid);
  if (el2) el2.textContent = `${el.value.length} / ${max}`;
}
function closeModal(id) { document.getElementById(id)?.classList.remove('open'); }
function openModal(id) { document.getElementById(id)?.classList.add('open'); }

// ── Image upload (FileReader → base64) ──────────────────────
function handleImgUpload(input, zoneId, previewId) {
  if (!input.files || !input.files[0]) return;
  const r = new FileReader();
  r.onload = e => {
    const zone = document.getElementById(zoneId);
    if (zone) {
      zone.classList.add('has-image');
      zone.innerHTML = `<img src="${e.target.result}" style="width:100%;height:160px;object-fit:cover;display:block;border-radius:14px">
        <div style="position:absolute;bottom:8px;right:8px;background:rgba(15,14,12,.8);border:1px solid var(--border);color:var(--text);border-radius:8px;padding:5px 10px;font-size:11px;font-weight:600">Change Photo</div>
        <input type="file" accept="image/*" style="position:absolute;inset:0;opacity:0;cursor:pointer;width:100%;height:100%" onchange="handleImgUpload(this,'${zoneId}','${previewId}')">`;
    }
    const h = document.getElementById(previewId);
    if (h) h.value = e.target.result;
  };
  r.readAsDataURL(input.files[0]);
}

// ── LocalStorage helpers ─────────────────────────────────────
const Store = {
  get: (key, fallback = null) => {
    try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; }
    catch { return fallback; }
  },
  set: (key, val) => {
    try { localStorage.setItem(key, JSON.stringify(val)); } catch {}
  },
  remove: (key) => { try { localStorage.removeItem(key); } catch {} },
};

// ── Session management ───────────────────────────────────────
const Session = {
  get: () => Store.get('abinci_session'),
  set: (data) => Store.set('abinci_session', data),
  clear: () => Store.remove('abinci_session'),
  getUser: () => Store.get('abinci_session')?.user || null,
  getToken: () => Store.get('abinci_session')?.token || null,
  getRole: () => Store.get('abinci_session')?.user?.role || null,
};

// ── API Client ───────────────────────────────────────────────
const API = {
  _base: ABINCI_CONFIG.API_URL,

  async _request(method, path, body) {
    const headers = { 'Content-Type': 'application/json' };
    const token = Session.getToken();
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const res = await fetch(`${this._base}${path}`, {
      method, headers,
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
  },

  get: (path) => API._request('GET', path),
  post: (path, body) => API._request('POST', path, body),
  patch: (path, body) => API._request('PATCH', path, body),
  delete: (path) => API._request('DELETE', path),

  // Auth
  sendOTP: (phone) => API.post('/auth/send-otp', { phone }),
  verifyOTP: (phone, code, name, role) => API.post('/auth/verify-otp', { phone, code, name, role }),
  getMe: () => API.get('/auth/me'),

  // Vendors
  getVendors: (params = {}) => API.get('/vendors?' + new URLSearchParams(params)),
  getVendor: (id) => API.get(`/vendors/${id}`),
  updateVendor: (id, data) => API.patch(`/vendors/${id}`, data),
  toggleAvailability: (id, is_available) => API.patch(`/vendors/${id}/availability`, { is_available }),
  getVendorMenu: (id) => API.get(`/vendors/${id}/menu`),
  addMenuItem: (vendorId, item) => API.post(`/vendors/${vendorId}/menu`, item),
  updateMenuItem: (vendorId, itemId, data) => API.patch(`/vendors/${vendorId}/menu/${itemId}`, data),
  deleteMenuItem: (vendorId, itemId) => API.delete(`/vendors/${vendorId}/menu/${itemId}`),

  // Orders
  placeOrder: (order) => API.post('/orders', order),
  getMyOrders: () => API.get('/orders/mine'),
  getVendorOrders: () => API.get('/orders/vendor'),
  getDriverOrders: () => API.get('/orders/driver'),
  updateOrderStatus: (id, status) => API.patch(`/orders/${id}/status`, { status }),

  // Drivers
  getDriverProfile: () => API.get('/drivers/me'),
  submitKYC: (data) => API.post('/drivers/kyc', data),
  toggleOnline: (is_online) => API.patch('/drivers/online', { is_online }),
  getAvailableDeliveries: () => API.get('/drivers/available-orders'),
  acceptDelivery: (orderId) => API.post(`/drivers/accept/${orderId}`),

  // Location
  updateLocation: (lat, lng) => API.post('/location/update', { lat, lng }),
  getNearbyVendors: (lat, lng, radius = 10) => API.get(`/location/vendors?lat=${lat}&lng=${lng}&radius=${radius}`),

  // Notifications
  getNotifications: () => API.get('/notifications'),
  markAllRead: () => API.post('/notifications/read-all'),
  registerPush: (sub) => API.post('/notifications/push-token', sub),

  // Reviews
  submitReview: (data) => API.post('/reviews', data),

  // Admin
  getPendingVendors: () => API.get('/admin/vendors/pending'),
  approveVendor: (id) => API.patch(`/admin/vendors/${id}/approve`),
  rejectVendor: (id) => API.patch(`/admin/vendors/${id}/reject`),
  getPendingDrivers: () => API.get('/admin/drivers/pending'),
  approveDriver: (id) => API.patch(`/admin/drivers/${id}/approve`),
  getAdminStats: () => API.get('/admin/stats'),
};

// ── Geolocation ──────────────────────────────────────────────
const Geo = {
  current: null,
  watch: null,

  start(onUpdate) {
    if (!navigator.geolocation) return;
    this.watch = navigator.geolocation.watchPosition(
      pos => {
        this.current = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        onUpdate?.(this.current);
      },
      err => console.warn('Geo error:', err),
      { enableHighAccuracy: true, maximumAge: 10000 }
    );
  },

  stop() {
    if (this.watch) navigator.geolocation.clearWatch(this.watch);
  },

  // Haversine distance in km between two lat/lng points
  distance(lat1, lng1, lat2, lng2) {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180) * Math.cos(lat2*Math.PI/180) * Math.sin(dLng/2)**2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  },

  formatDistance(km) {
    if (km < 1) return `${Math.round(km * 1000)}m away`;
    return `${km.toFixed(1)}km away`;
  },
};

// Expose globally
window.showToast = showToast;
window.showScreen = showScreen;
window.timeAgo = timeAgo;
window.formatCurrency = formatCurrency;
window.formatDate = formatDate;
window.fieldVal = fieldVal;
window.fieldHasVal = fieldHasVal;
window.countChars = countChars;
window.closeModal = closeModal;
window.openModal = openModal;
window.handleImgUpload = handleImgUpload;
window.Store = Store;
window.Session = Session;
window.API = API;
window.Geo = Geo;
window.ABINCI_CONFIG = ABINCI_CONFIG;
