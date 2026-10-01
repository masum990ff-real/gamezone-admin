// All admin API calls go through here (rules.md section 5). The JWT lives in
// localStorage so the admin session survives tab closes (7-day server expiry).
// The API base is hardcoded so a mistyped URL can never break login.
const Api = (() => {
  const API_BASE = 'https://gamezone-admin-5skm.onrender.com/api/v1';
  const TOKEN_KEY = 'gz_admin_token';

  function token() {
    return localStorage.getItem(TOKEN_KEY);
  }
  function isLoggedIn() {
    return !!token();
  }
  function logout() {
    localStorage.removeItem(TOKEN_KEY);
    window.location.href = 'login.html';
  }
  // Call on every protected page; bounces to login when there is no token.
  function requireAuth() {
    if (!isLoggedIn()) window.location.href = 'login.html';
  }

  async function request(path, options) {
    const init = {
      method: (options && options.method) || 'GET',
      headers: { 'Content-Type': 'application/json' },
    };
    if (token()) init.headers.Authorization = 'Bearer ' + token();
    if (options && options.body !== undefined) init.body = JSON.stringify(options.body);
    let res;
    try {
      res = await fetch(API_BASE + path, init);
    } catch (err) {
      throw new Error('Could not reach the backend. Check your internet connection and try again.');
    }
    if (res.status === 401 && path !== '/auth/login') {
      logout();
      throw new Error('Session expired. Please log in again.');
    }
    let json = null;
    try {
      json = await res.json();
    } catch (err) {
      throw new Error('Backend error (HTTP ' + res.status + '). Please try again.');
    }
    if (!json.success) throw new Error(json.message || 'Request failed.');
    return json.data;
  }

  function get(path) {
    return request(path);
  }
  function post(path, body) {
    return request(path, { method: 'POST', body: body || {} });
  }
  function put(path, body) {
    return request(path, { method: 'PUT', body: body || {} });
  }
  function del(path) {
    return request(path, { method: 'DELETE' });
  }

  async function login(email, password) {
    const data = await post('/auth/login', { email, password });
    localStorage.setItem(TOKEN_KEY, data.token);
    return data;
  }

  return { token, isLoggedIn, logout, requireAuth, get, post, put, del, login };
})();
