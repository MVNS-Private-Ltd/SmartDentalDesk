// SmartDentalDesk API Client
window.api = (function() {
  const BASE_URL       = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' 
    ? 'http://localhost:3001/api' 
    : 'https://smartdentaldesk.onrender.com/api';
  // Removed hardcoded SUPABASE_URL and SUPABASE_ANON for security.
  // OAuth URL is now fetched securely from the backend.

  let activeChatController = null;

  // Check localStorage first (Remember Me), fall back to sessionStorage (session-only)
  function getToken()        { return localStorage.getItem('sdd_token')         || sessionStorage.getItem('sdd_token'); }
  function getRefreshToken() { return localStorage.getItem('sdd_refresh_token') || sessionStorage.getItem('sdd_refresh_token'); }

  // Silently refresh the Supabase access token using the stored refresh_token
  async function refreshAccessToken() {
    const refreshToken = getRefreshToken();
    if (!refreshToken) throw new Error('No refresh token available.');

    const res = await fetch(`${BASE_URL}/auth/refresh`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ refresh_token: refreshToken }),
    });

    if (!res.ok) throw new Error('Token refresh failed.');

    const data = await res.json();
    localStorage.setItem('sdd_token',         data.access_token);
    localStorage.setItem('sdd_refresh_token', data.refresh_token);
    console.log('[Auth] Token refreshed successfully.');
    return data.access_token;
  }

  async function request(endpoint, options = {}, isRetry = false) {
    const url = `${BASE_URL}${endpoint}`;
    const headers = {
      'Content-Type': 'application/json',
      ...options.headers
    };

    const token = getToken();
    if (token) headers['Authorization'] = `Bearer ${token}`;

    try {
      const response = await fetch(url, { ...options, headers });
      const data = await response.json();

      // If 401 and not already a retry, attempt a silent token refresh then retry once
      // Skip this for auth endpoints — a 401 there means bad credentials, not an expired token
      const isAuthEndpoint = endpoint.startsWith('/auth/');
      if (response.status === 401 && !isRetry && !isAuthEndpoint) {
        try {
          await refreshAccessToken();
          return request(endpoint, options, true); // retry with new token
        } catch {
          // Refresh also failed — sign the user out
          localStorage.removeItem('sdd_token');
          localStorage.removeItem('sdd_refresh_token');
          localStorage.removeItem('sdd_user');
          localStorage.removeItem('sdd_clinic');
          window.location.href = './login.html';
          return;
        }
      }

      if (!response.ok) {
        if (data.redirect) {
          window.location.href = data.redirect;
          // prevent further execution
          await new Promise(() => {});
        }
        throw new Error(data.error || 'API Request Failed');
      }

      return data;
    } catch (err) {
      console.error(`API Error (${endpoint}):`, err.message);
      throw err;
    }
  }

  // ── Google OAuth ────────────────────────────────────────────────────────────

  async function loginWithGoogle() {
    try {
      const res = await fetch(`${BASE_URL}/auth/google-url`);
      const data = await res.json();
      if (data.url) {
        window.location.href = data.url;
      } else {
        alert('Could not initiate Google login');
      }
    } catch (err) {
      console.error('Google login error:', err);
      alert('Could not initiate Google login');
    }
  }

  // Step 2: Called on login.html load — checks if Google just redirected back with a token
  // Returns true if a callback was handled (page will redirect to dashboard), false otherwise
  async function handleOAuthCallback() {
    const hash = window.location.hash;
    if (!hash || !hash.includes('access_token')) return false;

    // Parse the fragment (Supabase puts tokens in the hash after OAuth)
    const params = new URLSearchParams(hash.slice(1)); // remove leading '#'
    const accessToken  = params.get('access_token');
    const refreshToken = params.get('refresh_token');

    if (!accessToken) return false;

    // Clear the hash from the URL so it doesn't persist
    history.replaceState(null, '', window.location.pathname);

    // Call backend to verify token + fetch/create clinic
    const res = await fetch(`${BASE_URL}/auth/oauth-session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ access_token: accessToken, refresh_token: refreshToken })
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Google sign-in failed. Please try again.');
    }

    const data = await res.json();
    localStorage.setItem('sdd_token',         data.access_token);
    localStorage.setItem('sdd_refresh_token', data.refresh_token);
    localStorage.setItem('sdd_user',   JSON.stringify(data.user));
    localStorage.setItem('sdd_role',   data.role || 'admin');
    if (data.clinic) localStorage.setItem('sdd_clinic', JSON.stringify(data.clinic));

    return true; // caller should redirect to dashboard
  }

  return {
    BASE_URL,
    login: (email, password) => request('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }),
    register: (payload) => request('/auth/register', { method: 'POST', body: JSON.stringify(payload) }),
    forgotPassword: (email) => request('/auth/forgot-password', { method: 'POST', body: JSON.stringify({ email }) }),
    resetPassword: (access_token, password) => request('/auth/reset-password', { method: 'POST', body: JSON.stringify({ access_token, password }) }),
    loginWithGoogle,
    handleOAuthCallback,
    getDashboardStats: () => request('/dashboard/stats'),
    
    // Credits & Billing
    getCreditsBalance: () => request('/credits/balance'),
    getCreditsHistory: () => request('/credits/history'),
    createTopupOrder: (pack_id) => request('/credits/topup/create-order', { method: 'POST', body: JSON.stringify({ pack_id }) }),
    verifyTopup: (payload) => request('/credits/topup/verify', { method: 'POST', body: JSON.stringify(payload) }),
    getPlans: () => request('/billing/plans'),
    getBillingStatus: () => request('/billing/status'),
    createTrial: (plan) => request('/billing/create-trial', { method: 'POST', body: JSON.stringify({ plan }) }),
    verifyTrial: (payload) => request('/billing/verify-trial', { method: 'POST', body: JSON.stringify(payload) }),
    // Generic POST helper — strips /api prefix if full path is passed
    post: (path, body) => {
      const endpoint = path.startsWith('/api/') ? path.slice(4) : path;
      return request(endpoint, { method: 'POST', body: JSON.stringify(body) });
    },
    
    // Marketplace & Clinic Directory Endpoints
    getPublicClinics: (params = {}) => {
      const qs = new URLSearchParams();
      Object.keys(params).forEach(k => {
        if (params[k] !== undefined && params[k] !== null && params[k] !== '' && params[k] !== 'all') {
          qs.set(k, params[k]);
        }
      });
      const str = qs.toString();
      return request(`/public/clinics${str ? '?' + str : ''}`);
    },
    getPublicClinic: (slugOrId) => request(`/public/clinics/${encodeURIComponent(slugOrId)}`),
    getMarketplaceMeta: () => request('/public/marketplace/meta'),

    getPatients: (type = 'all') => request(`/patients?type=${type}`),
    togglePatientStar: (id, is_starred) => request(`/patients/${id}/star`, { method: 'PATCH', body: JSON.stringify({ is_starred }) }),
    deletePatient: (id) => request(`/patients/${id}`, { method: 'DELETE' }),
    bulkDeletePatients: (ids) => request(`/patients`, { method: 'DELETE', body: JSON.stringify({ ids }) }),
    getAppointments: (status = 'all') => request(status && status !== 'all' ? `/appointments?status=${encodeURIComponent(status)}` : '/appointments'),
    approveAppointment: (id) => request(`/appointments/${id}/approve`, { method: 'POST' }),
    rejectAppointment: (id, reason = '') => request(`/appointments/${id}/reject`, { method: 'POST', body: JSON.stringify({ reason }) }),
    updateAppointmentStatus: (id, status, reason = '') => request(`/appointments/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status, reason }) }),
    completeAppointmentCheckout: (id, payload) => request(`/appointments/${id}/checkout`, { method: 'POST', body: JSON.stringify(payload) }),
    getSettings: () => request('/clinics/settings'),
    updateSettings: (payload) => request('/clinics/settings', { method: 'PUT', body: JSON.stringify(payload) }),
    sendChatMessage: async (message, mode = 'thinking', context = '', session_id = null) => {
      const payload = { message, mode, context };
      if (session_id) payload.session_id = session_id;
      const res = await request('/ai/chat', { method: 'POST', body: JSON.stringify(payload) });
      window.dispatchEvent(new Event('credits-updated'));
      return res;
    },
    streamChatMessage: async (message, mode = 'thinking', context = '', session_id = null, { onDelta, onMeta, onDone, onError } = {}) => {
      const payload = { message, mode, context };
      if (session_id) payload.session_id = session_id;
      const token = getToken();

      if (activeChatController) activeChatController.abort();
      const controller = new AbortController();
      activeChatController = controller;

      // Wait up to 90s for first response (Render free tier can cold-start in 50-60s)
      const timeout = setTimeout(() => controller.abort(), 90000);

      const res = await fetch(`${BASE_URL}/ai/chat/stream`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      clearTimeout(timeout);
      if (!res.ok) {
        let errMessage = `Stream error: ${res.status}`;
        try { const errData = await res.json(); errMessage = errData.error || errMessage; } catch {}
        throw new Error(errMessage);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      // Reset timeout for each chunk — abort if 90s of silence mid-stream
      let chunkTimeout = setTimeout(() => controller.abort(), 90000);

      while (true) {
        const { done, value } = await reader.read();
        clearTimeout(chunkTimeout);
        if (done) break;
        chunkTimeout = setTimeout(() => controller.abort(), 90000);
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop();
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('data:')) continue;
          const raw = trimmed.slice(5).trim();
          try {
            const evt = JSON.parse(raw);
            if (evt.type === 'meta'  && onMeta)  onMeta(evt);
            if (evt.type === 'delta' && onDelta)  onDelta(evt.content);
            if (evt.type === 'done') {
              if (onDone) onDone(evt);
              window.dispatchEvent(new Event('credits-updated'));
            }
            if (evt.type === 'error' && onError)  onError(new Error(evt.message));
          } catch { /* skip */ }
        }
      }
      clearTimeout(chunkTimeout);
      if (activeChatController === controller) activeChatController = null;
    },
    getChatHistory: (session_id = null) => request(`/ai/history${session_id ? '?session_id=' + session_id : ''}`),
    getChatSessions: () => request('/ai/sessions'),
    deleteChatSession: (session_id) => request(`/ai/sessions/${session_id}`, { method: 'DELETE' }),
    renameChatSession: (session_id, name) => request(`/ai/sessions/${session_id}/rename`, { method: 'PUT', body: JSON.stringify({ name }) }),
    sendPatientEmail: (patient_name, subject, body) => request('/email/send-patient', { method: 'POST', body: JSON.stringify({ patient_name, subject, body }) }),
    importPatients: async (file) => {
      const formData = new FormData();
      formData.append('file', file);
      const token = getToken();
      const res = await fetch(`${BASE_URL}/patients/import`, {
        method: 'POST',
        headers: token ? { 'Authorization': `Bearer ${token}` } : {},
        body: formData,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Import failed');
      return data;
    },
    downloadImportTemplate: () => {
      const token = getToken();
      const a = document.createElement('a');
      a.href = `${BASE_URL}/patients/import/template`;
      // Trigger a fetch with auth header and download the blob
      fetch(`${BASE_URL}/patients/import/template`, { headers: token ? { 'Authorization': `Bearer ${token}` } : {} })
        .then(r => r.blob())
        .then(blob => {
          const url = URL.createObjectURL(blob);
          a.href = url;
          a.download = 'smartdentaldesk_patients_template.csv';
          a.click();
          URL.revokeObjectURL(url);
        });
    },

    // ── Staff & Team Management ──────────────────────────────────────────────
    getStaff: () => request('/staff'),
    getStaffMember: (id) => request(`/staff/${id}`),
    createStaff: (data) => request('/staff', { method: 'POST', body: JSON.stringify(data) }),
    updateStaff: (id, data) => request(`/staff/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    deleteStaff: (id) => request(`/staff/${id}`, { method: 'DELETE' }),

    // ── Super Admin / Platform Owner Methods ──────────────────────────────
    getSuperAdminOverview: () => request('/super-admin/overview'),
    getSuperAdminClinics: (params = {}) => {
      const qs = new URLSearchParams();
      if (params.q) qs.set('q', params.q);
      if (params.plan && params.plan !== 'all') qs.set('plan', params.plan);
      if (params.page) qs.set('page', params.page);
      if (params.limit) qs.set('limit', params.limit);
      const str = qs.toString();
      return request(`/super-admin/clinics${str ? '?' + str : ''}`);
    },
    getSuperAdminClinic: (id) => request(`/super-admin/clinics/${id}`),
    updateClinicPlan: (id, plan) => request(`/super-admin/clinics/${id}/plan`, { method: 'PATCH', body: JSON.stringify({ plan }) }),
    updateClinicStatus: (id, is_active) => request(`/super-admin/clinics/${id}/status`, { method: 'PATCH', body: JSON.stringify({ is_active }) }),
    impersonateClinic: (id) => request(`/super-admin/clinics/${id}/impersonate`, { method: 'POST' }),
    deleteClinic: (id) => request(`/super-admin/clinics/${id}`, { method: 'DELETE' }),
    getGlobalStaff: (params = {}) => {
      const qs = new URLSearchParams();
      if (params.q) qs.set('q', params.q);
      if (params.role && params.role !== 'all') qs.set('role', params.role);
      if (params.clinic_id) qs.set('clinic_id', params.clinic_id);
      const str = qs.toString();
      return request(`/super-admin/staff${str ? '?' + str : ''}`);
    },
    toggleStaffActive: (id, is_active) => request(`/super-admin/staff/${id}/toggle-active`, { method: 'PATCH', body: JSON.stringify({ is_active }) }),
    getSuperAdminAIAnalytics: () => request('/super-admin/ai-analytics'),
    sendSuperAdminChatMessage: (message, mode = 'strategy', session_id = null) => {
      const payload = { message, mode };
      if (session_id) payload.session_id = session_id;
      return request('/super-admin/ai/chat', { method: 'POST', body: JSON.stringify(payload) });
    },
    getSuperAdminChatHistory: (session_id = null) => request(`/super-admin/ai/history${session_id ? '?session_id=' + session_id : ''}`),
    deleteSuperAdminChatSession: (session_id) => request(`/super-admin/ai/sessions/${session_id}`, { method: 'DELETE' }),
    getSuperAdminFinancials: (params = {}) => {
      const qs = new URLSearchParams();
      if (params.status && params.status !== 'all') qs.set('status', params.status);
      if (params.q) qs.set('q', params.q);
      if (params.page) qs.set('page', params.page);
      if (params.limit) qs.set('limit', params.limit);
      const str = qs.toString();
      return request(`/super-admin/financials${str ? '?' + str : ''}`);
    },
    exportSuperAdminCSV: async (type) => {
      const token = getToken();
      const filename = `smartdentaldesk_${type}_${new Date().toISOString().slice(0,10)}.csv`;
      const res = await fetch(`${BASE_URL}/super-admin/export/${type}`, {
        headers: token ? { 'Authorization': `Bearer ${token}` } : {}
      });
      if (!res.ok) throw new Error('CSV export failed');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    },
    getSystemHealth: () => request('/super-admin/system-health'),
    getBroadcast: () => request('/super-admin/broadcast'),
    publishBroadcast: (payload) => request('/super-admin/broadcast', { method: 'POST', body: JSON.stringify(payload) }),

    logout: () => {
      // Clear both storages so session-only and remember-me tokens are both removed
      ['sdd_token','sdd_refresh_token','sdd_user','sdd_role','sdd_clinic','sdd_impersonation'].forEach(k => {
        localStorage.removeItem(k);
        sessionStorage.removeItem(k);
      });
      window.location.href = './login.html';
    },
    isAuthenticated: () => !!getToken()
  };
})();

// Mobile nav toggle
document.addEventListener('DOMContentLoaded', function(){
  const toggle = document.getElementById('navToggle');
  const links = document.getElementById('navLinks');
  if(toggle && links){
    toggle.addEventListener('click', function(){
      const open = links.classList.toggle('open');
      toggle.setAttribute('aria-expanded', open ? 'true':'false');
    });
  }
});


// ================= THEME TOGGLE =================
(function(){
  var root = document.documentElement;
  var stored = null; // no storage APIs allowed in sandboxed iframes
  var prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  var theme = prefersDark ? 'dark' : 'light';
  root.setAttribute('data-theme', theme);

  document.addEventListener('DOMContentLoaded', function(){
    var btn = document.getElementById('themeToggle');
    if(!btn) return;
    function setIcon(){
      btn.innerHTML = theme === 'dark'
        ? '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>'
        : '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>';
      btn.setAttribute('aria-label', 'Switch to ' + (theme === 'dark' ? 'light' : 'dark') + ' mode');
    }
    setIcon();
    btn.addEventListener('click', function(){
      theme = theme === 'dark' ? 'light' : 'dark';
      root.setAttribute('data-theme', theme);
      setIcon();
    });
  });
})();

// ================= SCROLL REVEAL =================
document.addEventListener('DOMContentLoaded', function(){
  var targets = document.querySelectorAll('.reveal');
  if('IntersectionObserver' in window && targets.length){
    var obs = new IntersectionObserver(function(entries){
      entries.forEach(function(entry){
        if(entry.isIntersecting){
          entry.target.classList.add('is-visible');
        } else {
          entry.target.classList.remove('is-visible');
        }
      });
    }, {
      threshold: 0.25,
      rootMargin: "0px 0px -10% 0px"
    });
    targets.forEach(function(t){ obs.observe(t); });
  } else {
    targets.forEach(function(t){ t.classList.add('is-visible'); });
  }
});

// ================= HEADER SCROLL STATE =================
document.addEventListener('DOMContentLoaded', function(){
  var header = document.querySelector('.site-header');
  if(!header) return;
  window.addEventListener('scroll', function(){
    header.classList.toggle('scrolled', window.scrollY > 8);
  }, {passive:true});
});

// ================= ANIMATED COUNTERS =================
document.addEventListener('DOMContentLoaded', function(){
  var counters = document.querySelectorAll('[data-count]');
  counters.forEach(function(el){
    var raw = el.getAttribute('data-count');
    var match = raw.match(/([\d.]+)/);
    if(!match) return;
    var target = parseFloat(match[1]);
    var prefix = raw.split(match[1])[0] || '';
    var suffix = raw.split(match[1])[1] || '';
    var current = 0;
    var steps = 30;
    var inc = target / steps;
    var count = 0;
    var timer = setInterval(function(){
      count++;
      current += inc;
      if(count >= steps){ current = target; clearInterval(timer); }
      el.textContent = prefix + (target % 1 === 0 ? Math.round(current) : current.toFixed(1)) + suffix;
    }, 30);
  });
});
