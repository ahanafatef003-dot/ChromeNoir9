/* ═══════════════════════════════════════════════════
   CHROME NOIR — BACKENDLESS CONFIG & API LAYER
   App ID:  DA2A1061-FB55-4E0C-BC50-1921539B86F1
   Updated credentials — DO NOT use old credentials
═══════════════════════════════════════════════════ */
const Backendless_CONFIG = {
  APP_ID:   'DA2A1061-FB55-4E0C-BC50-1921539B86F1',
  API_KEY:  'DF48048D-AC9F-4385-9AD9-BF302E0F44FE',
  BASE_URL: 'https://api.backendless.com'
};

/* ── Centralized Social Links — update here only ── */
const SOCIAL_LINKS = {
  instagram: 'https://www.instagram.com/velmora767?igsh=MnBxbG5oYjY2dTVw',
  tiktok:    'https://www.tiktok.com/@velmora767?_r=1&_t=ZS-96p9WnKtUqT',
  facebook:  'https://www.facebook.com/share/1TgUYsL1aE/'
};

/* ── Backendless REST API wrapper ─────────────────── */
const Backendless = {
  _url(table, params = '') {
    return `${Backendless_CONFIG.BASE_URL}/${Backendless_CONFIG.APP_ID}/${Backendless_CONFIG.API_KEY}/data/${table}${params}`;
  },

  _headers() {
    return { 'Content-Type': 'application/json' };
  },

  async _parse(res) {
    let body;
    try { body = await res.json(); } catch { body = {}; }
    if (!res.ok) {
      const msg = body?.message || body?.code || res.statusText || 'API Error';
      throw new Error(msg);
    }
    return body;
  },

  async get(table, params = '') {
    const res = await fetch(this._url(table, params), {
      headers: this._headers()
    });
    return this._parse(res);
  },

  async post(table, data) {
    const res = await fetch(this._url(table), {
      method:  'POST',
      headers: this._headers(),
      body:    JSON.stringify(data)
    });
    return this._parse(res);
  },

  async put(table, objectId, data) {
    const res = await fetch(this._url(table, `/${objectId}`), {
      method:  'PUT',
      headers: this._headers(),
      body:    JSON.stringify(data)
    });
    return this._parse(res);
  },

  async delete(table, objectId) {
    const res = await fetch(this._url(table, `/${objectId}`), {
      method:  'DELETE',
      headers: this._headers()
    });
    return this._parse(res);
  }
};

/* ── XSS sanitizer helper ───────────────────────── */
function sanitize(str) {
  if (typeof str !== 'string') return '';
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
            .replace(/"/g,'&quot;').replace(/'/g,'&#x27;');
}
