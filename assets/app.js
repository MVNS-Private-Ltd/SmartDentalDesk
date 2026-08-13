
// SmartDentalDesk API Client
window.api = (function() {
  const BASE_URL       = 'http://localhost:3001/api';
  const SUPABASE_URL   = 'https://qxioydfqnuuphgisbqxx.supabase.co';
  const SUPABASE_ANON  = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InF4aW95ZGZxbnV1cGhnaXNicXh4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODYxODc1NjMsImV4cCI6MjEwMTc2MzU2M30.LZAeQdUADzSRyL2ydBs3mdOAm681PHFUmKkCXtZErec';

  function getToken()        { return localStorage.getItem('sdd_token'); }
  function getRefreshToken() { return localStorage.getItem('sdd_refresh_token'); }

  // Silently refresh the Supabase access token using the stored refresh_token
  async function refreshAccessToken() {
    const refreshToken = getRefreshToken();
    if (!refreshToken) throw new Error('No refresh token available.');

    const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_ANON,
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
      if (response.status === 401 && !isRetry) {
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
        throw new Error(data.error || 'API Request Failed');
      }

      return data;
    } catch (err) {
      console.error(`API Error (${endpoint}):`, err.message);
      throw err;
    }
  }

  return {
    login: (email, password) => request('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }),
    register: (payload) => request('/auth/register', { method: 'POST', body: JSON.stringify(payload) }),
    getDashboardStats: () => request('/dashboard/stats'),

    // Endpoints
    getPatients: (type = 'all') => request(`/patients?type=${type}`),
    getAppointments: () => request('/appointments'),
    getSettings: () => request('/clinics/settings'),
    updateSettings: (payload) => request('/clinics/settings', { method: 'PUT', body: JSON.stringify(payload) }),
    sendChatMessage: (message, mode = 'thinking', context = '', session_id = null) =>
      request('/ai/chat', { method: 'POST', body: JSON.stringify({ message, mode, context, session_id }) }),
    getChatHistory: (session_id = null) => request(`/ai/history${session_id ? '?session_id=' + session_id : ''}`),
    getChatSessions: () => request('/ai/sessions'),
    deleteChatSession: (session_id) => request(`/ai/sessions/${session_id}`, { method: 'DELETE' }),
    renameChatSession: (session_id, name) => request(`/ai/sessions/${session_id}/rename`, { method: 'PUT', body: JSON.stringify({ name }) }),

    logout: () => {
      localStorage.removeItem('sdd_token');
      localStorage.removeItem('sdd_refresh_token');
      localStorage.removeItem('sdd_user');
      localStorage.removeItem('sdd_clinic');
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
