// All admin API calls go through here (rules.md section 5). The JWT lives in
// sessionStorage (cleared when the tab closes); the API base URL is remembered
// in localStorage so it survives reloads.
const Api = (() => {
  const BASE_KEY = 'gz_api_base';
  const TOKEN_KEY = 'gz_admin_token';

  function base() {
    return (localStorage.getItem(BASE_KEY) || 'http://localhost:3000/api/v1').replace(/\/$/, '');
  }
  function setBase(url) {
    localStorage.setItem(BASE_KEY, String(url).replace(/\/$/, ''));
  }
  function token() {
    return sessionStorage.getItem(TOKEN_KEY);
  }
  function isLoggedIn() {
    return !!token();
  }
  function logout() {
    sessionStorage.removeItem(TOKEN_KEY);
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
      res = await fetch(base() + path, init);
    } catch (err) {
      throw new Error('Could not reach the backend at ' + base() + '. Is it running?');
    }
    if (res.status === 401) {
      logout();
      throw new Error('Session expired. Please log in again.');
    }
    let json = null;
    try {
      json = await res.json();
    } catch (err) {
      throw new Error('Backend returned an invalid response.');
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
  function del(path) {
    return request(path, { method: 'DELETE' });
  }

  async function login(email, password) {
    const data = await post('/auth/login', { email, password });
    sessionStorage.setItem(TOKEN_KEY, data.token);
    return data;
  }

  return { base, setBase, token, isLoggedIn, logout, requireAuth, get, post, del, login };
})();
