<!DOCTYPE html>
<html lang="ru">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>microOS 11</title></head>
<body><script type="module" src="./main.js"></script></body>
</html>'use strict';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const el = (tag, props = {}, children = []) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') e.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(e.style, v);
    else if (k === 'text') e.textContent = v;
    else if (k === 'html') e.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2).toLowerCase(), v);
    else if (v != null) e.setAttribute(k, v);
  }
  (Array.isArray(children) ? children : [children]).forEach(c => {
    if (c == null) return;
    e.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
  });
  return e;
};
const debounce = (fn, ms = 250) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
const fmtSize = b => !b || b < 1024 ? (b || 0) + ' Б' : b < 1048576 ? (b / 1024).toFixed(1) + ' КБ' : b < 1073741824 ? (b / 1048576).toFixed(2) + ' МБ' : (b / 1073741824).toFixed(2) + ' ГБ';
const pad = n => String(n).padStart(2, '0');
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const Storage = {
  get(k, d) { try { const v = localStorage.getItem('microOS.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('microOS.' + k, JSON.stringify(v)); return true; } catch { return false; } },
  remove(k) { try { localStorage.removeItem('microOS.' + k); } catch {} }
};

const DB = {
  _db: null,
  async init() {
    if (this._db) return this._db;
    return new Promise((res, rej) => {
      const req = indexedDB.open('microOS_v5', 1);
      req.onupgradeneeded = e => {
        const d = e.target.result;
        if (!d.objectStoreNames.contains('apps')) d.createObjectStore('apps', { keyPath: 'id', autoIncrement: true });
        if (!d.objectStoreNames.contains('files')) d.createObjectStore('files', { keyPath: 'id', autoIncrement: true });
        if (!d.objectStoreNames.contains('appData')) {
          const s = d.createObjectStore('appData', { keyPath: 'id', autoIncrement: true });
          s.createIndex('appId', 'appId');
          s.createIndex('appIdKey', ['appId', 'key'], { unique: true });
        }
        if (!d.objectStoreNames.contains('snapshots')) {
          const s = d.createObjectStore('snapshots', { keyPath: 'id', autoIncrement: true });
          s.createIndex('appId', 'appId');
        }
      };
      req.onsuccess = e => { this._db = e.target.result; res(this._db); };
      req.onerror = e => rej(e.target.error);
    });
  },
  async op(store, mode, fn) {
    const db = await this.init();
    return new Promise((res, rej) => {
      const tx = db.transaction(store, mode);
      const r = fn(tx.objectStore(store));
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
  },
  addApp: a => DB.op('apps', 'readwrite', s => s.add(a)),
  getApp: id => DB.op('apps', 'readonly', s => s.get(id)),
  getAllApps: () => DB.op('apps', 'readonly', s => s.getAll()),
  updateApp: a => DB.op('apps', 'readwrite', s => s.put(a)),
  deleteApp: id => DB.op('apps', 'readwrite', s => s.delete(id)),
  addFile: f => DB.op('files', 'readwrite', s => s.add(f)),
  getFile: id => DB.op('files', 'readonly', s => s.get(id)),
  deleteFile: id => DB.op('files', 'readwrite', s => s.delete(id)),
  addSnapshot: sn => DB.op('snapshots', 'readwrite', s => s.add(sn)),
  getSnapshots: appId => DB.op('snapshots', 'readonly', s => s.index('appId').getAll(appId)),
  deleteSnapshot: id => DB.op('snapshots', 'readwrite', s => s.delete(id))
};

const AppData = {
  async get(appId, key, def) {
    try {
      const db = await DB.init();
      return new Promise(r => {
        const tx = db.transaction('appData', 'readonly');
        const req = tx.objectStore('appData').index('appIdKey').get([appId, key]);
        req.onsuccess = () => r(req.result ? req.result.value : def);
        req.onerror = () => r(def);
      });
    } catch { return def; }
  },
  async set(appId, key, value) {
    try {
      const db = await DB.init();
      return new Promise(r => {
        const tx = db.transaction('appData', 'readwrite');
        const st = tx.objectStore('appData');
        const req = st.index('appIdKey').get([appId, key]);
        req.onsuccess = e => {
          const ex = e.target.result;
          if (ex) { ex.value = value; st.put(ex); }
          else st.add({ appId, key, value });
        };
        tx.oncomplete = () => r(true);
        tx.onerror = () => r(false);
      });
    } catch { return false; }
  },
  async deleteAll(appId) {
    try {
      const db = await DB.init();
      return new Promise(r => {
        const tx = db.transaction('appData', 'readwrite');
        const st = tx.objectStore('appData');
        const req = st.index('appId').getAllKeys(appId);
        req.onsuccess = e => { e.target.result.forEach(k => st.delete(k)); };
        tx.oncomplete = () => r(true);
      });
    } catch { return false; }
  }
};

/* ═══════ ACTIVATION KEYS ═══════ */
const ACTIVATION_KEYS = { admin: 'paykey1234567890adminopen', home: 'paykey1234567890homeopen' };
const getKeyLevel = inp => {
  const t = (inp ?? '').trim();
  if (t === ACTIVATION_KEYS.admin) return 'admin';
  if (t === ACTIVATION_KEYS.home) return 'home';
  return null;
};

const License = {
  _level: null, _key: null,
  load() {
    const s = Storage.get('license', null);
    if (s && s.level && ACTIVATION_KEYS[s.level] === s.key) { this._level = s.level; this._key = s.key; return true; }
    return false;
  },
  save() { Storage.set('license', { level: this._level, key: this._key }); },
  activate(level, key) { this._level = level; this._key = key; this.save(); },
  clear() { this._level = null; this._key = null; Storage.set('license', null); },
  isActivated() { return this._level !== null; },
  isAdmin() { return this._level === 'admin'; },
  isHome() { return this._level === 'home'; },
  getLevel() { return this._level; },
  getKey() { return this._key; },
  getLabel() { return this._level === 'admin' ? 'Администратор' : this._level === 'home' ? 'Домашняя' : 'Не активирована'; },
  getIcon() { return this._level === 'admin' ? '👑' : this._level === 'home' ? '🏠' : '🔒'; },
  allowedVersions() {
    if (this._level === 'admin') return ['v10-std', 'v10-home', 'v10-pro', 'v10-pro-max', 'v10-ultra', 'v11-std', 'v11-home', 'v11-pro', 'v11-pro-max', 'v11-ultra'];
    if (this._level === 'home') return ['v10-home', 'v11-home'];
    return [];
  },
  canUseVersion(id) { return this.allowedVersions().includes(id); },
  canUseDisasters() { return this._level === 'admin'; },
  maxVMs() { return this._level === 'admin' ? 3 : this._level === 'home' ? 1 : 0; },
  maxWindows() { return this._level === 'admin' ? 20 : this._level === 'home' ? 6 : 0; }
};

const VERSIONS = [
  { id: 'v10-std', line: 10, model: 'Standard', name: 'microOS 10 Standard', description: 'Базовая линейка 10.', accent: '#0078D7', tags: ['Светлая', 'Radius 4'], theme: 'light' },
  { id: 'v10-home', line: 10, model: 'Home', name: 'microOS 10 Home', description: 'Домашняя.', accent: '#0078D4', tags: ['Виджеты'], theme: 'light' },
  { id: 'v10-pro', line: 10, model: 'Pro', name: 'microOS 10 Pro', description: 'Профессиональная.', accent: '#0078D4', tags: ['Тёмная'], theme: 'dark' },
  { id: 'v10-pro-max', line: 10, model: 'Pro Max', name: 'microOS 10 Pro Max', description: 'Максимум в 10.', accent: '#005A9E', tags: ['Pro Max'], theme: 'dark' },
  { id: 'v10-ultra', line: 10, model: 'Ultra', name: 'microOS 10 Ultra', description: 'Топовая 10-я.', accent: '#00B4D8', tags: ['Ultra'], theme: 'dark' },
  { id: 'v11-std', line: 11, model: 'Standard', name: 'microOS 11 Standard', description: 'Базовая 11-я.', accent: '#0078D4', tags: ['Fluent'], theme: 'light' },
  { id: 'v11-home', line: 11, model: 'Home', name: 'microOS 11 Home', description: 'Домашняя 11-я.', accent: '#0078D4', tags: ['Snap'], theme: 'light' },
  { id: 'v11-pro', line: 11, model: 'Pro', name: 'microOS 11 Pro', description: 'Профессиональная 11-я.', accent: '#0078D4', tags: ['Fluent'], theme: 'dark' },
  { id: 'v11-pro-max', line: 11, model: 'Pro Max', name: 'microOS 11 Pro Max', description: 'Mica + Acrylic.', accent: '#0067C0', tags: ['Pro Max'], theme: 'dark' },
  { id: 'v11-ultra', line: 11, model: 'Ultra', name: 'microOS 11 Ultra', description: 'Глассморфизм.', accent: '#7B68EE', tags: ['Glass'], theme: 'dark' }
];

const Version = {
  current: 'v11-pro',
  load() { this.current = Storage.get('version', 'v11-pro'); if (!VERSIONS.find(v => v.id === this.current)) this.current = 'v11-pro'; this.apply(); },
  get() { return VERSIONS.find(v => v.id === this.current) || VERSIONS[7]; },
  getId() { return this.current; },
  set(id) { if (!VERSIONS.find(v => v.id === id)) return false; this.current = id; Storage.set('version', id); this.apply(); return true; },
  apply() {
    document.documentElement.dataset.version = this.current;
    const v = this.get();
    if (v.accent) {
      document.documentElement.style.setProperty('--accent', v.accent);
      const hex = v.accent.replace('#', '');
      if (hex.length === 6) document.documentElement.style.setProperty('--accent-rgb', `${parseInt(hex.slice(0, 2), 16)},${parseInt(hex.slice(2, 4), 16)},${parseInt(hex.slice(4, 6), 16)}`);
    }
  }
};

const Settings = {
  defaults: { theme: 'dark', wallpaper: 'a' },
  data: {},
  load() { this.data = { ...this.defaults, ...Storage.get('settings', {}) }; },
  save() { Storage.set('settings', this.data); },
  get(k) { return this.data[k]; },
  set(k, v) { this.data[k] = v; this.save(); this.apply(); },
  apply() { document.documentElement.dataset.theme = this.data.theme; }
};

/* ═══════ CSS ═══════ */
const CSS = `
*{box-sizing:border-box;margin:0;padding:0}
:root{--accent:#0078d4;--accent-rgb:0,120,212;--radius:10px;--radius-w:10px;--radius-b:6px;--tb-h:48px}
html[data-theme="dark"]{--bg:#0d0d0d;--text:#fff;--dim:#a8a8a8;--win:rgba(32,32,32,.95);--solid:#202020;--panel:rgba(28,28,28,.92);--border:rgba(255,255,255,.09);--hover:rgba(255,255,255,.07);--input:rgba(255,255,255,.06);--shadow:0 12px 40px rgba(0,0,0,.6);--shadow-sm:0 2px 10px rgba(0,0,0,.4)}
html[data-theme="light"]{--bg:#f3f3f3;--text:#1b1b1b;--dim:#5c5c5c;--win:rgba(250,250,250,.96);--solid:#fafafa;--panel:rgba(243,243,243,.94);--border:rgba(0,0,0,.1);--hover:rgba(0,0,0,.06);--input:rgba(0,0,0,.05);--shadow:0 12px 40px rgba(0,0,0,.3);--shadow-sm:0 2px 10px rgba(0,0,0,.12)}
html[data-version^="v10"]{--radius-w:4px;--radius-b:3px}
html[data-version="v10-std"]{--win:rgba(240,240,240,.95);--solid:#f0f0f0;--text:#1a1a1a;--dim:#555;--border:rgba(0,0,0,.12)}
html[data-version="v11-ultra"]{--radius-w:14px;--accent:#7B68EE;--accent-rgb:123,104,238;--bg:#0a0520;--text:#f0e8ff;--win:rgba(20,15,40,.88);--solid:#140f28;--border:rgba(123,104,238,.3)}
html,body{height:100%;overflow:hidden;font-family:'Segoe UI',system-ui,sans-serif;font-size:14px}
body{color:var(--text);background:var(--bg);-webkit-font-smoothing:antialiased;user-select:none;-webkit-tap-highlight-color:transparent}
button,input,textarea,select{font-family:inherit;font-size:inherit;color:inherit}
button{background:none;border:none;cursor:pointer}
input,textarea,select{background:var(--input);border:1px solid var(--border);border-radius:6px;padding:7px 10px;outline:none;transition:border-color .2s}
input:focus{border-color:var(--accent)}
::-webkit-scrollbar{width:8px;height:8px}::-webkit-scrollbar-thumb{background:rgba(128,128,128,.5);border-radius:4px}
.hidden{display:none!important}
.btn{padding:7px 16px;border-radius:6px;background:var(--accent);color:#fff;font-size:13px;font-weight:500;cursor:pointer;border:none;transition:filter .15s}
.btn:hover{filter:brightness(1.15)}.btn.sec{background:var(--input);color:var(--text);border:1px solid var(--border)}
.btn.danger{background:#e81123;color:#fff;border-color:transparent}
.row{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px;border-bottom:1px solid var(--border);font-size:13px}
.row:last-child{border-bottom:none}
.toolbar{display:flex;align-items:center;gap:4px;padding:6px 8px;border-bottom:1px solid var(--border);flex-wrap:wrap;background:rgba(128,128,128,.05);flex-shrink:0}
.tbtn{min-width:30px;height:28px;padding:0 8px;border-radius:5px;display:flex;align-items:center;justify-content:center;font-size:12.5px;cursor:pointer;border:1px solid transparent}
.tbtn:hover{background:var(--hover)}.tbtn.on{background:rgba(var(--accent-rgb),.25);border-color:var(--accent)}
.card{background:var(--input);border:1px solid var(--border);border-radius:8px;padding:14px 16px}
.sep{width:1px;height:20px;background:var(--border);margin:0 4px}
#wallpaper{position:fixed;inset:0;z-index:0;background:radial-gradient(circle at 22% 18%,#2f7fdc 0%,#123a72 40%,#06162e 100%)}
#desktop{position:fixed;inset:0;z-index:1}#icons{position:absolute;inset:0}
#windowLayer{position:fixed;inset:0;z-index:10;pointer-events:none}
#notifications{position:fixed;right:12px;bottom:60px;z-index:300;display:flex;flex-direction:column;gap:8px;width:340px;max-width:calc(100vw - 24px);pointer-events:none}
.dicon{position:absolute;width:88px;padding:8px 4px;border-radius:6px;display:flex;flex-direction:column;align-items:center;gap:5px;text-align:center;cursor:pointer;transition:background .15s}
.dicon:hover{background:var(--hover)}.dicon.sel{background:rgba(var(--accent-rgb),.3);outline:1px solid rgba(var(--accent-rgb),.5)}
.dicon .em{width:42px;height:42px;display:flex;align-items:center;justify-content:center;font-size:34px;filter:drop-shadow(0 2px 4px rgba(0,0,0,.5))}
.dicon .em img{width:42px;height:42px;border-radius:10px;object-fit:cover}
.dicon .lb{font-size:12px;color:#fff;text-shadow:0 1px 3px rgba(0,0,0,.9);line-height:1.2;max-width:84px;word-break:break-word}
.window{position:absolute;pointer-events:auto;display:flex;flex-direction:column;background:var(--win);backdrop-filter:blur(20px);border:1px solid var(--border);border-radius:var(--radius-w);box-shadow:var(--shadow-sm);overflow:hidden;min-width:320px;min-height:200px;transition:opacity .18s,transform .18s,box-shadow .18s}
.window.active{box-shadow:var(--shadow);border-color:rgba(var(--accent-rgb),.35)}
.window.opening{animation:winIn .2s ease}
@keyframes winIn{from{opacity:0;transform:scale(.94) translateY(10px)}to{opacity:1;transform:none}}
.window.closing{opacity:0;transform:scale(.94) translateY(10px)}
.window.minimized{opacity:0;transform:scale(.7) translateY(60vh);pointer-events:none}
.win-tb{height:38px;display:flex;align-items:center;gap:8px;padding:0 4px 0 12px;border-bottom:1px solid var(--border);flex-shrink:0}
.win-ic{font-size:15px;width:20px;height:20px;display:flex;align-items:center;justify-content:center}
.win-ic img{width:18px;height:18px;border-radius:4px}
.win-title{flex:1;font-size:12.5px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.win-ctr{display:flex;gap:2px}
.win-btn{width:36px;height:28px;border-radius:5px;display:flex;align-items:center;justify-content:center;font-size:13px;transition:background .15s}
.win-btn:hover{background:var(--hover)}.win-btn.close:hover{background:#e81123;color:#fff}
.win-body{flex:1;overflow:auto;display:flex;flex-direction:column;min-height:0;position:relative}
#taskbar{position:fixed;left:0;right:0;bottom:0;height:var(--tb-h);z-index:100;background:var(--panel);backdrop-filter:blur(24px);border-top:1px solid var(--border);display:flex;align-items:center;padding:0 8px}
#tbCenter{display:flex;align-items:center;gap:3px;position:absolute;left:50%;transform:translateX(-50%)}
html[data-version^="v10"] #tbCenter{position:static;transform:none;margin-left:8px}
html[data-version^="v10"] #taskbar{justify-content:flex-start}
html[data-version^="v10"] #tbTray{margin-left:auto}
.tb-btn{width:44px;height:40px;border-radius:6px;display:flex;align-items:center;justify-content:center;font-size:20px;position:relative;transition:background .15s}
.tb-btn:hover{background:var(--hover)}
.tb-btn.running::after{content:'';position:absolute;bottom:2px;left:50%;transform:translateX(-50%);width:6px;height:3px;border-radius:2px;background:var(--accent)}
.tb-btn.focused::after{width:16px}
.tb-btn img{width:24px;height:24px;border-radius:5px;object-fit:cover}
.tb-logo{width:22px;height:22px;display:grid;grid-template-columns:1fr 1fr;gap:2px}
.tb-logo i{background:var(--accent);border-radius:1px;display:block}
#tbTray{margin-left:auto;display:flex;align-items:center;gap:2px}
.tray-btn{height:36px;min-width:34px;padding:0 10px;border-radius:6px;display:flex;align-items:center;gap:6px;font-size:13px;transition:background .15s}
.tray-btn:hover{background:var(--hover)}
#trayClock{flex-direction:column;font-size:11px;line-height:1.15;padding:0 10px}
#trayClock .t{font-weight:500}#trayClock .d{font-size:10px;color:var(--dim)}
.install-btn{background:rgba(var(--accent-rgb),.15);border:1px solid rgba(var(--accent-rgb),.35);font-weight:600}
.panel{position:fixed;z-index:200;background:var(--panel);backdrop-filter:blur(28px);border:1px solid var(--border);border-radius:12px;box-shadow:var(--shadow);transition:opacity .2s,transform .2s;transform-origin:bottom center}
.panel.closed{opacity:0;transform:translateY(16px) scale(.97);pointer-events:none}
#startMenu{left:50%;bottom:56px;transform:translateX(-50%);width:620px;max-width:calc(100vw - 24px);height:620px;max-height:calc(100vh - 90px);padding:18px 20px 0;display:flex;flex-direction:column}
#startMenu.closed{transform:translateX(-50%) translateY(16px) scale(.97)}
html[data-version^="v10"] #startMenu{left:8px;transform:none;width:420px;height:auto;max-height:600px}
html[data-version^="v10"] #startMenu.closed{transform:translateY(16px) scale(.97)}
.sm-search input{width:100%;padding:9px 14px;border-radius:20px;margin-bottom:14px;font-size:13px}
.sm-scroll{flex:1;overflow-y:auto;margin-bottom:8px}
.sm-h{font-size:12px;font-weight:600;color:var(--dim);margin:10px 0 8px}
.sm-grid{display:grid;grid-template-columns:repeat(6,1fr);gap:4px}
.sm-app{display:flex;flex-direction:column;align-items:center;gap:6px;padding:12px 4px;border-radius:8px;font-size:11px;transition:background .15s;cursor:pointer;text-align:center}
.sm-app:hover{background:var(--hover)}
.sm-app .em{width:26px;height:26px;display:flex;align-items:center;justify-content:center;font-size:26px}
.sm-app .em img{width:26px;height:26px;border-radius:6px;object-fit:cover}
.sm-list{display:flex;flex-direction:column;gap:2px}
.sm-row{display:flex;align-items:center;gap:12px;padding:8px 10px;border-radius:6px;font-size:13px;cursor:pointer;transition:background .15s}
.sm-row:hover{background:var(--hover)}
.sm-row .em{font-size:19px;width:24px;height:24px;display:flex;align-items:center;justify-content:center}
.sm-footer{display:flex;align-items:center;gap:8px;padding:12px 0;margin:0 -20px;padding-left:20px;padding-right:20px;border-top:1px solid var(--border);background:rgba(128,128,128,.07)}
.sm-user{display:flex;align-items:center;gap:10px;flex:1;padding:4px 8px;border-radius:6px}
.sm-avatar{width:30px;height:30px;border-radius:50%;background:var(--accent);display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:600;color:#fff}
.sm-power{width:36px;height:36px;border-radius:6px;font-size:16px;display:flex;align-items:center;justify-content:center}
.sm-power:hover{background:var(--hover)}
.notif{background:var(--panel);backdrop-filter:blur(24px);border:1px solid var(--border);border-radius:10px;padding:12px 14px;box-shadow:var(--shadow);display:flex;gap:10px;pointer-events:auto;font-size:12.5px;animation:notifIn .25s ease}
.notif.out{animation:notifOut .2s forwards}
@keyframes notifIn{from{opacity:0;transform:translateX(60px)}to{opacity:1;transform:none}}
@keyframes notifOut{to{opacity:0;transform:translateX(60px)}}
.notif .em{font-size:20px}.notif b{display:block;font-size:13px;margin-bottom:2px}
.dialog-overlay{position:fixed;inset:0;z-index:900;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;padding:20px;animation:fadeIn .15s}
@keyframes fadeIn{from{opacity:0}to{opacity:1}}
.dialog{background:var(--solid);border:1px solid var(--border);border-radius:10px;min-width:400px;max-width:620px;width:100%;box-shadow:var(--shadow);overflow:hidden;color:var(--text);max-height:90vh;display:flex;flex-direction:column}
.dialog-head{padding:14px 18px;background:linear-gradient(135deg,rgba(var(--accent-rgb),.15),rgba(var(--accent-rgb),.05));border-bottom:1px solid var(--border);display:flex;align-items:center;gap:12px;font-size:14.5px;font-weight:600}
.dialog-body{padding:20px;font-size:13px;line-height:1.55;overflow-y:auto;flex:1}
.dialog-foot{padding:12px 18px;display:flex;justify-content:flex-end;gap:8px;background:rgba(128,128,128,.05);border-top:1px solid var(--border);flex-shrink:0}
.dialog-foot button{padding:8px 20px;border-radius:6px;border:1px solid var(--border);background:var(--input);font-size:12.5px;cursor:pointer}
.dialog-foot button.primary{background:var(--accent);color:#fff;border-color:transparent;font-weight:500}
#bootloader{position:fixed;inset:0;z-index:3000;background:#0a0a0a;color:#e0e0e0;display:flex;align-items:center;justify-content:center;font-family:Consolas,monospace}
.boot-title{font-size:42px;letter-spacing:3px;color:#fff;text-shadow:0 0 20px rgba(0,255,100,.6);margin-bottom:8px}
.boot-version{font-size:13px;color:#7a8a7a;margin-bottom:40px}
.boot-progress{width:400px;max-width:80vw;height:4px;background:#1a1a1a;border-radius:2px;margin:0 auto 18px;overflow:hidden}
.boot-progress>div{height:100%;width:0;background:linear-gradient(90deg,#00ff64,#00a844);transition:width .05s linear}
.boot-status{font-size:12px;color:#7a8a7a}
#activationFlow{position:fixed;inset:0;z-index:2900;background:#0d0d0d;color:#e0e0e0;display:flex;align-items:center;justify-content:center;overflow-y:auto;padding:20px}
#oobe{position:fixed;inset:0;z-index:2000;background:radial-gradient(circle at 30% 40%,#1a5eb8 0%,#0e3a7a 50%,#051a3f 100%);color:#fff;display:flex;flex-direction:column}
#lockScreen{position:fixed;inset:0;z-index:1500;display:flex;align-items:center;justify-content:center;background:radial-gradient(circle at 50% 30%,#1a5eb8 0%,#0a2040 70%,#020814 100%);color:#fff;transition:opacity .35s}
#bsod{position:fixed;inset:0;z-index:1000;background:#0078d7;color:#fff;display:flex;flex-direction:column;justify-content:center;padding:8vh 10vw;gap:16px}
#bsod .frown{font-size:88px;font-weight:300}#bsod .msg{font-size:22px;line-height:1.4;max-width:700px}#bsod .code{font-size:15px;opacity:.9}
.vm-toolbar{padding:8px 12px;background:#111;border-bottom:1px solid #222;display:flex;align-items:center;gap:8px;flex-shrink:0}
.vm-btn{padding:5px 10px;background:rgba(255,255,255,.1);border:1px solid rgba(255,255,255,.2);border-radius:5px;color:#fff;cursor:pointer;font-size:11px}
.vm-btn:hover{background:rgba(255,255,255,.2)}
.vm-tabs{display:flex;border-bottom:1px solid var(--border);background:rgba(128,128,128,.04);overflow-x:auto;flex-shrink:0}
.vm-tab{padding:10px 16px;font-size:13px;cursor:pointer;border-bottom:2px solid transparent;color:var(--dim);white-space:nowrap;background:none;border-left:none;border-right:none;border-top:none}
.vm-tab.on{color:var(--accent);border-bottom-color:var(--accent);font-weight:600}
.vm-content{flex:1;overflow-y:auto;padding:20px}
.info-row{display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--border);font-size:13px;gap:16px}
.info-row:last-child{border-bottom:none}
.info-row .k{color:var(--dim);flex-shrink:0;font-size:12px}
.info-row .v{text-align:right;word-break:break-word;font-family:Consolas,monospace;font-size:12px}
.perm{padding:4px 10px;background:rgba(var(--accent-rgb),.12);border:1px solid rgba(var(--accent-rgb),.3);border-radius:12px;font-size:11px;margin:3px;display:inline-block;color:var(--accent);font-family:Consolas,monospace}
.empty-state{padding:40px 20px;text-align:center;color:var(--dim)}
.empty-state .em{font-size:56px;margin-bottom:12px}
.section-title{font-size:11px;text-transform:uppercase;color:var(--dim);margin:16px 0 8px;letter-spacing:.5px;font-weight:600}
.icon-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(80px,1fr));gap:10px;margin-top:8px}
.icon-grid .item{aspect-ratio:1;background:rgba(128,128,128,.1);border:1px solid var(--border);border-radius:8px;display:flex;align-items:center;justify-content:center;padding:8px;cursor:pointer}
.icon-grid .item img{max-width:100%;max-height:100%;object-fit:contain}
@media(max-width:768px){
  #startMenu{left:8px;right:8px;transform:none;width:auto;height:calc(100vh - var(--tb-h) - 16px);bottom:calc(var(--tb-h) + 8px)}
  #startMenu.closed{transform:translateY(100%);opacity:0}
  #tbCenter{position:static;transform:none;margin-left:8px;gap:2px}
  .tb-btn{width:40px;height:38px}
  .window{min-width:auto;max-width:calc(100vw - 8px)}
  .sm-grid{grid-template-columns:repeat(4,1fr)}
  .boot-title{font-size:28px}
  .dialog{min-width:auto}
}
`;
document.head.appendChild(el('style', { text: CSS }));

const AudioMgr = {
  _ctx: null,
  _ensure() { if (this._ctx) return true; try { this._ctx = new (window.AudioContext || window.webkitAudioContext)(); return true; } catch { return false; } },
  beep(f = 800, d = 0.1, type = 'square', vol = 0.04) {
    if (!this._ensure()) return;
    try {
      const o = this._ctx.createOscillator(), g = this._ctx.createGain();
      o.type = type; o.frequency.value = f;
      g.gain.setValueAtTime(vol, this._ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.0001, this._ctx.currentTime + d);
      o.connect(g); g.connect(this._ctx.destination);
      o.start(); o.stop(this._ctx.currentTime + d + 0.02);
    } catch {}
  },
  error() { this.beep(220, 0.12, 'sawtooth', 0.05); setTimeout(() => this.beep(160, 0.18, 'sawtooth', 0.05), 150); },
  alert() { this.beep(880, 0.1, 'square', 0.05); setTimeout(() => this.beep(660, 0.1, 'square', 0.05), 130); },
  greet() { this.beep(660, 0.15, 'sine', 0.05); setTimeout(() => this.beep(880, 0.2, 'sine', 0.05), 180); setTimeout(() => this.beep(1100, 0.3, 'sine', 0.05), 380); }
};

const Notify = {
  push(title, text, icon = '🔔') {
    const box = $('#notifications'); if (!box) return;
    const card = el('div', { class: 'notif' }, [el('div', { class: 'em', text: icon }), el('div', {}, [el('b', { text: title }), el('div', { text })])]);
    box.appendChild(card);
    const kill = () => { card.classList.add('out'); setTimeout(() => card.remove(), 210); };
    card.addEventListener('click', kill);
    setTimeout(kill, 5000);
  }
};

const ErrorMgr = {
  _count: 0,
  dialog(opts) {
    if (this._count > 5) return;
    this._count++;
    AudioMgr.error();
    const ov = el('div', { class: 'dialog-overlay' });
    const dlg = el('div', { class: 'dialog' }, [
      el('div', { class: 'dialog-head' }, [el('span', { text: opts.icon || '⚠️' }), el('span', { text: opts.title || 'Ошибка' })]),
      el('div', { class: 'dialog-body' }, [
        el('div', { text: opts.message || '' }),
        opts.detail ? el('div', { style: { fontSize: '11.5px', color: 'var(--dim)', marginTop: '8px', whiteSpace: 'pre-line' }, text: opts.detail }) : null
      ].filter(Boolean)),
      el('div', { class: 'dialog-foot' }, (opts.buttons || [{ label: 'ОК', primary: true }]).map(b =>
        el('button', { class: b.primary ? 'primary' : '', text: b.label, onclick: () => { ov.remove(); this._count--; b.action?.(); b.onClose?.(); } })
      ))
    ]);
    ov.appendChild(dlg);
    ov.addEventListener('click', e => { if (e.target === ov) { ov.remove(); this._count--; opts.onClose?.(); } });
    document.body.appendChild(ov);
  },
  bsod(code, opts = {}) {
    AudioMgr.beep(120, 0.6, 'sine', 0.06);
    let bsod = $('#bsod');
    if (!bsod) { bsod = el('div', { id: 'bsod' }); document.body.appendChild(bsod); }
    bsod.innerHTML = ''; bsod.classList.remove('hidden');
    bsod.append(
      el('div', { class: 'frown', text: ':(' }),
      el('div', { class: 'msg', text: 'Ваш компьютер столкнулся с проблемой и будет перезагружен. Сбор данных об ошибке…' }),
      el('div', { class: 'code', text: 'Код ошибки: ' + code })
    );
    const pct = el('div', { style: { marginTop: '20px', fontSize: '14px', opacity: '.9' }, text: '0% завершено' });
    bsod.appendChild(pct);
    let p = 0;
    const int = setInterval(() => {
      p += Math.random() * 8 + 3;
      if (p >= 100) { p = 100; clearInterval(int); setTimeout(() => { bsod.classList.add('hidden'); opts.onComplete?.(); }, 500); }
      pct.textContent = Math.floor(p) + '% завершено';
    }, 200);
  }
};

const WM = {
  wins: [], _zTop: 100, _counter: 0, activeId: null, _onChange: [],
  onChange(fn) { this._onChange.push(fn); },
  _emit() { this._onChange.forEach(fn => { try { fn(); } catch {} }); },
  create(opts) {
    if (this.wins.length >= License.maxWindows()) { Notify.push('Лимит окон', 'Ваша лицензия: ' + License.maxWindows(), '⚠️'); return null; }
    const id = 'w' + (++this._counter);
    const isMobile = window.innerWidth < 768;
    const W = isMobile ? window.innerWidth - 8 : Math.min(opts.width || 720, window.innerWidth - 40);
    const H = isMobile ? window.innerHeight - 60 : Math.min(opts.height || 480, window.innerHeight - 110);
    const n = this.wins.length;
    const left = isMobile ? 4 : Math.max(16, Math.round((window.innerWidth - W) / 2) + (n % 6) * 30 - 75);
    const top = isMobile ? 4 : Math.max(16, Math.round((window.innerHeight - 48 - H) / 2) + (n % 6) * 26 - 65);
    const win = el('div', { class: 'window opening', 'data-app-id': opts.appId || '', 'data-win-id': id }, [
      el('div', { class: 'win-tb' }, [
        el('div', { class: 'win-ic', text: opts.icon || '🗔' }),
        el('div', { class: 'win-title', text: opts.title || 'Окно' }),
        el('div', { class: 'win-ctr' }, [
          el('button', { class: 'win-btn', text: '─', onclick: e => { e.stopPropagation(); this.minimize(id); } }),
          el('button', { class: 'win-btn', text: '□', onclick: e => { e.stopPropagation(); this.maximize(id); } }),
          el('button', { class: 'win-btn close', text: '✕', onclick: e => { e.stopPropagation(); this.close(id); } })
        ])
      ]),
      el('div', { class: 'win-body' })
    ]);
    win.style.cssText = `left:${left}px;top:${top}px;width:${W}px;height:${H}px`;
    const body = win.querySelector('.win-body');
    const api = { id, el: win, body, appId: opts.appId, title: opts.title, minimized: false, maximized: false, prevRect: null, focus: () => this.focus(id), close: () => this.close(id), minimize: () => this.minimize(id), maximize: () => this.maximize(id), setTitle: t => { const ti = win.querySelector('.win-title'); if (ti) ti.textContent = t; api.title = t; }, cleanup: opts.cleanup || null };
    $('#windowLayer').appendChild(win);
    this.wins.push(api);
    win.addEventListener('mousedown', () => this.focus(id), true);
    const tb = win.querySelector('.win-tb');
    if (!isMobile) tb.addEventListener('mousedown', e => { if (!e.target.closest('.win-btn')) this._drag(e, win); });
    tb.addEventListener('dblclick', e => { if (!e.target.closest('.win-btn')) this.maximize(id); });
    this.focus(id);
    setTimeout(() => win.classList.remove('opening'), 240);
    this._emit();
    if (typeof opts.build === 'function') { try { opts.build(body, api); } catch (e) { console.error(e); } }
    return api;
  },
  _drag(e, win) {
    e.preventDefault();
    const sx = e.clientX, sy = e.clientY, sl = parseFloat(win.style.left), st = parseFloat(win.style.top);
    const move = ev => { win.style.left = (sl + ev.clientX - sx) + 'px'; win.style.top = Math.max(0, st + ev.clientY - sy) + 'px'; };
    const up = () => { document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up); };
    document.addEventListener('mousemove', move); document.addEventListener('mouseup', up);
  },
  focus(id) { const w = this.wins.find(x => x.id === id); if (!w) return; if (w.minimized) this.restore(id); this.activeId = id; this._zTop++; w.el.style.zIndex = this._zTop; this.wins.forEach(x => x.el.classList.toggle('active', x.id === id)); this._emit(); },
  close(id) { const i = this.wins.findIndex(x => x.id === id); if (i < 0) return; const w = this.wins[i]; w.el.classList.add('closing'); setTimeout(() => { try { if (w.cleanup) w.cleanup(); } catch {} w.el.remove(); this.wins.splice(i, 1); if (this.activeId === id) { const next = this.wins.filter(x => !x.minimized).pop(); this.activeId = next ? next.id : null; if (next) this.focus(next.id); } this._emit(); }, 200); },
  minimize(id) { const w = this.wins.find(x => x.id === id); if (!w) return; w.minimized = true; w.el.classList.add('minimized'); if (this.activeId === id) { const next = this.wins.filter(x => !x.minimized && x.id !== id).pop(); this.activeId = next ? next.id : null; if (next) this.focus(next.id); } this._emit(); },
  restore(id) { const w = this.wins.find(x => x.id === id); if (w) { w.minimized = false; w.el.classList.remove('minimized'); } },
  maximize(id) { const w = this.wins.find(x => x.id === id); if (!w) return; if (w.maximized) { const r = w.prevRect; w.el.style.cssText = `left:${r.left}px;top:${r.top}px;width:${r.width}px;height:${r.height}px`; w.maximized = false; } else { w.prevRect = { left: parseFloat(w.el.style.left), top: parseFloat(w.el.style.top), width: parseFloat(w.el.style.width), height: parseFloat(w.el.style.height) }; w.el.style.cssText = `left:0;top:0;width:${window.innerWidth}px;height:${window.innerHeight - 48}px`; w.maximized = true; } this.focus(id); },
  findApp(appId) { return this.wins.find(w => w.appId === appId); }
};

const Apps = {
  registry: {},
  register(a) { this.registry[a.id] = a; },
  list() { return Object.values(this.registry); },
  get(id) { return this.registry[id]; },
  open(id) { const a = this.registry[id]; if (!a) return; const existing = WM.findApp(id); if (existing) { WM.focus(existing.id); return; } try { a.open(); } catch (e) { console.error(e); } }
};

const SystemState = {
  cpu: 12, ramMB: 2400, ramMaxMB: 8192, tempC: 42, viruses: 0, stability: 100,
  _listeners: [], _tick: null,
  start() { if (this._tick) return; this._tick = setInterval(() => this._update(), 800); },
  _update() { this.cpu = Math.max(2, Math.min(100, this.cpu + (Math.random() - 0.5) * 6)); this.tempC = Math.max(25, Math.min(105, 42 + (this.cpu - 12) * 0.4)); this.ramMB = Math.max(500, Math.min(this.ramMaxMB, 2400 + WM.wins.length * 200)); this._emit(); },
  _emit() { this._listeners.forEach(fn => { try { fn(this); } catch {} }); },
  onChange(fn) { this._listeners.push(fn); }
};

/* ═══════ VM — реальные данные из файла ═══════ */
const VM = {
  sessions: new Map(),
  canCreate() { return this.sessions.size < License.maxVMs(); },
  async open(appId) {
    const numericId = String(appId).startsWith('inst_') ? parseInt(appId.slice(5), 10) : appId;
    const app = await DB.getApp(numericId);
    if (!app) { ErrorMgr.dialog({ title: 'Ошибка', icon: '❌', message: 'Приложение не найдено' }); return; }
    if (!this.canCreate()) { ErrorMgr.dialog({ title: 'Лимит ВМ', icon: '⚠️', message: `Ваша лицензия (${License.getLabel()}) поддерживает не более ${License.maxVMs()} приложений.` }); return; }
    const existing = WM.findApp('vm_' + numericId);
    if (existing) { WM.focus(existing.id); return; }
    app.runCount = (app.runCount || 0) + 1;
    await DB.updateApp(app).catch(() => {});
    const session = { appId: numericId, app, startTime: Date.now() };
    this.sessions.set(numericId, session);
    const win = WM.create({
      appId: 'vm_' + numericId, title: app.name, icon: app.icon, width: 900, height: 640,
      cleanup: () => { this.sessions.delete(numericId); },
      build: (body, api) => {
        body.style.cssText = 'padding:0;overflow:hidden;display:flex;flex-direction:column';
        const tb = el('div', { class: 'vm-toolbar' }, [
          el('div', { style: { fontSize: '11px', color: '#888', display: 'flex', gap: '12px', alignItems: 'center' }, html: `<span>v${esc(app.version)}</span><span>·</span><span>${esc(app.publisher)}</span><span>·</span><span>${(app.kind || '').toUpperCase()}</span>` }),
          el('div', { style: { marginLeft: 'auto', fontSize: '11px', color: '#4ec9b0', fontWeight: '600' }, text: '● Running · ' + (app.kind === 'apk' ? 'Android' : app.kind === 'exe' ? 'PE' : 'DIO') })
        ]);
        body.appendChild(tb);
        const tabs = el('div', { class: 'vm-tabs' });
        const content = el('div', { class: 'vm-content' });
        body.append(tabs, content);

        const tabDefs = app.kind === 'apk'
          ? ['Обзор', 'Манифест', 'Разрешения', 'Activities', 'Иконки', 'Ресурсы', 'Строки']
          : app.kind === 'exe'
            ? ['Обзор', 'PE-заголовок', 'Секции']
            : ['Обзор', 'Манифест'];
        let curTab = 0;

        const renderTab = () => {
          content.innerHTML = '';
          const tab = tabDefs[curTab];

          if (tab === 'Обзор') {
            content.append(
              el('div', { class: 'section-title', text: 'Информация о приложении' }),
              el('div', { class: 'info-row' }, [el('span', { class: 'k', text: 'Название' }), el('span', { class: 'v', text: app.name })]),
              el('div', { class: 'info-row' }, [el('span', { class: 'k', text: 'Версия' }), el('span', { class: 'v', text: app.version || '—' })]),
              el('div', { class: 'info-row' }, [el('span', { class: 'k', text: 'Издатель' }), el('span', { class: 'v', text: app.publisher || '—' })]),
              el('div', { class: 'info-row' }, [el('span', { class: 'k', text: 'Файл' }), el('span', { class: 'v', text: app.fileName })]),
              el('div', { class: 'info-row' }, [el('span', { class: 'k', text: 'Размер' }), el('span', { class: 'v', text: fmtSize(app.fileSize || 0) })]),
              el('div', { class: 'info-row' }, [el('span', { class: 'k', text: 'Тип' }), el('span', { class: 'v', text: (app.kind || '').toUpperCase() })]),
              app.packageName ? el('div', { class: 'info-row' }, [el('span', { class: 'k', text: 'Package' }), el('span', { class: 'v', text: app.packageName })]) : null,
              el('div', { class: 'info-row' }, [el('span', { class: 'k', text: 'Установлено' }), el('span', { class: 'v', text: new Date(app.installedAt).toLocaleString('ru-RU') })]),
              el('div', { class: 'info-row' }, [el('span', { class: 'k', text: 'Запусков' }), el('span', { class: 'v', text: String(app.runCount || 0) })])
            );
            content.appendChild(el('div', { class: 'section-title', text: 'Ограничение браузера' }));
            content.appendChild(el('div', {
              style: { padding: '14px', background: 'rgba(243,156,18,.1)', border: '1px solid rgba(243,156,18,.3)', borderRadius: '8px', fontSize: '12.5px', lineHeight: '1.6' },
              text: app.kind === 'apk'
                ? 'Реальное исполнение Android APK требует Dalvik/ART VM, которой нет в браузере. Здесь показаны реальные данные, извлечённые из вашего APK-файла.'
                : app.kind === 'exe'
                  ? 'Реальное исполнение PE-файлов требует x86 CPU + Windows API, которых нет в браузере. Здесь показаны реальные данные из PE-заголовка вашего файла.'
                  : 'Это .dio-файл microOS. Проверьте вкладку «Манифест» для просмотра JSON-структуры.'
            }));
          } else if (tab === 'Манифест' && app.kind === 'apk') {
            content.append(
              el('div', { class: 'section-title', text: 'Package Name' }),
              el('div', { style: { padding: '8px', background: 'var(--input)', borderRadius: '6px', fontFamily: 'Consolas, monospace', fontSize: '12px' }, text: app.packageName || 'не найден' }),
              el('div', { class: 'section-title', text: 'Manifest JSON' }),
              el('pre', { style: { padding: '12px', background: 'var(--input)', borderRadius: '6px', fontSize: '11px', overflowX: 'auto', fontFamily: 'Consolas, monospace' }, text: app.manifest ? JSON.stringify(app.manifest, null, 2) : 'Не извлечён' })
            );
          } else if (tab === 'Разрешения') {
            const perms = app.permissions || [];
            if (!perms.length) content.appendChild(el('div', { class: 'empty-state' }, [el('div', { class: 'em', text: '🔒' }), el('div', { text: 'Разрешения не найдены' })]));
            else {
              content.appendChild(el('div', { class: 'section-title', text: `Запрошенные разрешения (${perms.length})` }));
              const box = el('div');
              perms.forEach(p => box.appendChild(el('span', { class: 'perm', text: p })));
              content.appendChild(box);
            }
          } else if (tab === 'Activities') {
            const acts = app.activities || [];
            if (!acts.length) content.appendChild(el('div', { class: 'empty-state' }, [el('div', { class: 'em', text: '📱' }), el('div', { text: 'Activities не извлечены' }), el('div', { style: { fontSize: '11px', marginTop: '8px' }, text: 'Бинарный AndroidManifest.xml сложно парсить без полного AXML-декодера' })]));
            else {
              content.appendChild(el('div', { class: 'section-title', text: `Activities (${acts.length})` }));
              acts.forEach(a => content.appendChild(el('div', { class: 'info-row' }, [el('span', { class: 'v', style: { textAlign: 'left', flex: '1', fontSize: '11px' }, text: a })])));
            }
          } else if (tab === 'Иконки') {
            content.appendChild(el('div', { class: 'section-title', text: 'Извлечённая иконка' }));
            if (app.icon) {
              const grid = el('div', { class: 'icon-grid' });
              const item = el('div', { class: 'item', title: 'Основная иконка' });
              const img = el('img', { src: app.icon });
              item.appendChild(img);
              item.addEventListener('click', () => {
                const w2 = WM.create({ title: 'Иконка', icon: '🖼', width: 400, height: 400 });
                if (w2) { w2.body.style.cssText = 'display:flex;align-items:center;justify-content:center;background:#000'; const im2 = el('img', { src: app.icon, style: { maxWidth: '100%', maxHeight: '100%' } }); w2.body.appendChild(im2); }
              });
              grid.appendChild(item);
              content.appendChild(grid);
            } else content.appendChild(el('div', { class: 'empty-state', text: 'Иконка не найдена' }));
          } else if (tab === 'Ресурсы') {
            ['layouts', 'drawables', 'assets'].forEach(key => {
              const list = app[key] || [];
              content.appendChild(el('div', { class: 'section-title', text: `${key} (${list.length})` }));
              if (!list.length) content.appendChild(el('div', { style: { padding: '8px', color: 'var(--dim)', fontSize: '12px' }, text: 'Не извлечены' }));
              else list.slice(0, 20).forEach(l => content.appendChild(el('div', { class: 'info-row' }, [el('span', { class: 'v', style: { textAlign: 'left', flex: '1', fontSize: '11px' }, text: l })])));
            });
          } else if (tab === 'Строки') {
            const strings = app.strings || {};
            const keys = Object.keys(strings);
            content.appendChild(el('div', { class: 'section-title', text: `Строки из ресурсов (${keys.length})` }));
            if (!keys.length) content.appendChild(el('div', { class: 'empty-state', text: 'Строки не извлечены' }));
            else keys.slice(0, 100).forEach(k => content.appendChild(el('div', { class: 'info-row' }, [el('span', { class: 'k', style: { fontFamily: 'Consolas, monospace', fontSize: '11px' }, text: k }), el('span', { class: 'v', style: { textAlign: 'left', flex: '1' }, text: strings[k] })])));
          } else if (tab === 'PE-заголовок' && app.peInfo) {
            const p = app.peInfo;
            content.append(
              el('div', { class: 'info-row' }, [el('span', { class: 'k', text: 'MZ' }), el('span', { class: 'v', text: p.isMZ || p.isPE ? '✓ да' : '✗ нет' })]),
              el('div', { class: 'info-row' }, [el('span', { class: 'k', text: 'PE' }), el('span', { class: 'v', text: p.isPE ? '✓ да' : '✗ нет' })]),
              el('div', { class: 'info-row' }, [el('span', { class: 'k', text: 'Архитектура' }), el('span', { class: 'v', text: p.machine || '—' })]),
              el('div', { class: 'info-row' }, [el('span', { class: 'k', text: 'Подсистема' }), el('span', { class: 'v', text: p.subsystem || '—' })])
            );
          } else if (tab === 'Секции' && app.peInfo) {
            const sections = app.peInfo.sections || [];
            if (!sections.length) content.appendChild(el('div', { class: 'empty-state', text: 'Секции не найдены' }));
            else {
              content.appendChild(el('div', { class: 'section-title', text: `Секции PE-файла (${sections.length})` }));
              sections.forEach(s => content.appendChild(el('div', { class: 'info-row' }, [el('span', { class: 'k', style: { fontFamily: 'Consolas, monospace' }, text: s.name }), el('span', { class: 'v', text: 'VirtSize: 0x' + s.virtualSize.toString(16) })])));
            }
          } else {
            content.appendChild(el('div', { class: 'empty-state', text: 'Нет данных' }));
          }
        };

        tabDefs.forEach((name, i) => {
          const t = el('button', { class: 'vm-tab' + (i === 0 ? ' on' : ''), text: name });
          t.addEventListener('click', () => { curTab = i; Array.from(tabs.children).forEach((x, idx) => x.classList.toggle('on', idx === i)); renderTab(); });
          tabs.appendChild(t);
        });
        renderTab();
      }
    });
    if (win) win.cleanup = () => { this.sessions.delete(numericId); };
  }
};

/* ═══════ FILE PARSERS ═══════ */
const APKParser = {
  async parse(file) {
    const r = { fileName: file.name, fileSize: file.size, kind: 'apk', packageName: null, versionName: null, appLabel: null, permissions: [], activities: [], icon: null, strings: {}, layouts: [], drawables: [], assets: [], manifest: null, warnings: [] };
    let zip;
    try { zip = await JSZip.loadAsync(file); } catch (e) { r.warnings.push('Не ZIP: ' + e.message); return r; }
    const mf = zip.file('AndroidManifest.xml');
    if (mf) {
      try {
        const buf = await mf.async('arraybuffer');
        const txt16 = new TextDecoder('utf-16le', { fatal: false }).decode(buf);
        const txt8 = new TextDecoder('utf-8', { fatal: false }).decode(buf);
        const txt = txt16 + '\n' + txt8;
        const pkg = txt.match(/([a-z][a-z0-9_]*\.){2,}[a-zA-Z][a-zA-Z0-9_]*/);
        if (pkg) r.packageName = pkg[0];
        const vms = txt.match(/(\d+\.\d+(?:\.\d+)?)/g);
        if (vms) r.versionName = [...new Set(vms)].sort((a, b) => b.length - a.length)[0];
        r.permissions = [...new Set(txt.match(/android\.permission\.[A-Z_][A-Z0-9_]+/g) || [])];
        const acts = new Set();
        const re = /(?:activity|\.Activity)[^a-zA-Z]*([a-z][a-zA-Z0-9_]*(?:\.[a-zA-Z][a-zA-Z0-9_]*)+)/g;
        let m;
        while ((m = re.exec(txt)) !== null) if (!m[1].startsWith('android.') && m[1].length < 100) acts.add(m[1]);
        r.activities = [...acts].slice(0, 20);
        r.manifest = { package: r.packageName, version: r.versionName, permissions: r.permissions, activities: r.activities };
      } catch (e) { r.warnings.push('Manifest: ' + e.message); }
    } else r.warnings.push('AndroidManifest.xml не найден');
    const icons = Object.keys(zip.files).filter(f => /^res\/mipmap/i.test(f) && /\.(png|webp|jpg)$/i.test(f));
    const iconData = [];
    for (const p of icons) { try { const d = await zip.file(p).async('uint8array'); iconData.push({ p, size: d.length, d }); } catch {} }
    iconData.sort((a, b) => b.size - a.size);
    if (iconData.length) {
      const lg = iconData[0];
      let bin = ''; for (let i = 0; i < lg.d.length; i++) bin += String.fromCharCode(lg.d[i]);
      const ext = lg.p.split('.').pop().toLowerCase();
      r.icon = `data:image/${ext === 'webp' ? 'webp' : ext === 'jpg' ? 'jpeg' : 'png'};base64,${btoa(bin)}`;
    }
    const strFiles = Object.keys(zip.files).filter(f => /^res\/values[^/]*\/strings\.xml$/i.test(f));
    for (const sf of strFiles) {
      try {
        const xml = await zip.file(sf).async('string');
        const re = /<string[^>]*name="([^"]+)"[^>]*>([^<]*)<\/string>/g;
        let m;
        while ((m = re.exec(xml)) !== null) if (!r.strings[m[1]]) r.strings[m[1]] = m[2];
      } catch {}
    }
    if (r.strings.app_name) r.appLabel = r.strings.app_name;
    r.layouts = Object.keys(zip.files).filter(f => /^res\/layout[^/]*\/.*\.xml$/i.test(f)).slice(0, 30);
    r.drawables = Object.keys(zip.files).filter(f => /^res\/drawable[^/]*\/.*\.(png|jpg|webp|xml)$/i.test(f)).slice(0, 30);
    r.assets = Object.keys(zip.files).filter(f => /^assets\//.test(f) && !zip.files[f].dir).slice(0, 50);
    return r;
  }
};

const PEParser = {
  async parse(file) {
    const r = { fileName: file.name, fileSize: file.size, kind: 'exe', isMZ: false, isPE: false, machine: null, subsystem: null, sections: [], warnings: [] };
    try {
      const buf = await file.slice(0, 4096).arrayBuffer();
      const dv = new DataView(buf), bytes = new Uint8Array(buf);
      if (bytes[0] !== 0x4D || bytes[1] !== 0x5A) { r.warnings.push('Не MZ'); return r; }
      r.isMZ = true;
      if (buf.byteLength < 0x40) { r.warnings.push('Слишком мал'); return r; }
      const peOff = dv.getUint32(0x3C, true);
      if (peOff + 4 > buf.byteLength) { r.warnings.push('PE за пределами'); return r; }
      if (bytes[peOff] !== 0x50 || bytes[peOff + 1] !== 0x45) { r.warnings.push('Нет PE'); return r; }
      r.isPE = true;
      const coff = peOff + 4;
      if (coff + 20 <= buf.byteLength) {
        const mach = dv.getUint16(coff, true);
        const numSect = dv.getUint16(coff + 2, true);
        const machines = { 0x14C: 'x86', 0x8664: 'x64', 0xAA64: 'ARM64', 0x1C0: 'ARM' };
        r.machine = machines[mach] || '0x' + mach.toString(16);
        const optOff = coff + 20;
        if (optOff + 68 <= buf.byteLength) {
          const sub = dv.getUint16(optOff + 68, true);
          const subsystems = { 1: 'Native', 2: 'Windows GUI', 3: 'Windows Console' };
          r.subsystem = subsystems[sub] || sub;
        }
        const sectOff = coff + 20 + dv.getUint16(coff + 16, true);
        for (let i = 0; i < Math.min(numSect, 20); i++) {
          const o = sectOff + i * 40; if (o + 40 > buf.byteLength) break;
          let name = '';
          for (let b = 0; b < 8; b++) { const c = bytes[o + b]; if (!c) break; name += String.fromCharCode(c); }
          r.sections.push({ name, virtualSize: dv.getUint32(o + 8, true), rawSize: dv.getUint32(o + 16, true) });
        }
      }
    } catch (e) { r.warnings.push(e.message); }
    return r;
  }
};

const DIOParser = {
  async parse(file) {
    const r = { fileName: file.name, fileSize: file.size, kind: 'dio', manifest: null, warnings: [] };
    try { r.manifest = JSON.parse(await file.text()); } catch (e) { r.warnings.push('Не JSON: ' + e.message); }
    return r;
  }
};

/* ═══════ INSTALLER ═══════ */
const Installer = {
  async start(file) {
    const ext = file.name.split('.').pop().toLowerCase();
    let parsed;
    if (ext === 'apk') parsed = await APKParser.parse(file);
    else if (ext === 'exe' || ext === 'msi') parsed = await PEParser.parse(file);
    else if (ext === 'dio') parsed = await DIOParser.parse(file);
    else { ErrorMgr.dialog({ title: 'Не поддерживается', icon: '❌', message: 'Формат .' + ext + ' не поддерживается. Используйте: .apk, .exe, .msi, .dio' }); return; }
    if (ext === 'apk') {
      parsed.displayName = parsed.appLabel || parsed.packageName || file.name.replace('.apk', '');
      parsed.displayVersion = parsed.versionName || '1.0';
      parsed.displayPublisher = parsed.packageName ? parsed.packageName.split('.').slice(0, 2).join('.') : 'Неизвестный';
    } else if (ext === 'exe' || ext === 'msi') {
      parsed.displayName = file.name.replace(/\.(exe|msi)$/i, '');
      parsed.displayVersion = '1.0';
      parsed.displayPublisher = 'Неизвестный';
    } else {
      const m = parsed.manifest || {};
      parsed.displayName = m.name || file.name.replace('.dio', '');
      parsed.displayVersion = m.version || '1.0';
      parsed.displayPublisher = m.publisher || 'microOS';
      parsed.icon = m.icon || null;
    }
    parsed.file = file;
    this.preview(parsed);
  },
  preview(parsed) {
    const ov = el('div', { class: 'dialog-overlay' });
    const dlg = el('div', { class: 'dialog' });
    const iconBox = el('div', { style: { width: '64px', height: '64px', flexShrink: '0', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '44px', borderRadius: '12px', background: 'var(--border)', overflow: 'hidden' }, text: parsed.kind === 'apk' ? '🤖' : parsed.kind === 'exe' ? '💻' : '💠' });
    if (parsed.icon) { const img = el('img', { src: parsed.icon, style: { width: '100%', height: '100%', objectFit: 'cover' } }); iconBox.textContent = ''; iconBox.appendChild(img); }
    dlg.append(
      el('div', { class: 'dialog-head' }, [el('span', { text: parsed.kind === 'apk' ? '🤖' : parsed.kind === 'exe' ? '💻' : '💠' }), el('span', { text: 'Установка — ' + parsed.fileName })]),
      el('div', { class: 'dialog-body' }, [
        el('div', { style: { display: 'flex', gap: '14px', padding: '12px', background: 'var(--input)', border: '1px solid var(--border)', borderRadius: '10px', marginBottom: '14px' } }, [
          iconBox,
          el('div', { style: { flex: '1', minWidth: '0' } }, [
            el('div', { style: { fontSize: '15px', fontWeight: '600', marginBottom: '6px', wordBreak: 'break-word' }, text: parsed.displayName }),
            el('div', { style: { fontSize: '11.5px', color: 'var(--dim)', marginTop: '2px' }, text: 'Версия: ' + parsed.displayVersion }),
            el('div', { style: { fontSize: '11.5px', color: 'var(--dim)', marginTop: '2px' }, text: 'Издатель: ' + parsed.displayPublisher }),
            el('div', { style: { fontSize: '11.5px', color: 'var(--dim)', marginTop: '2px' }, text: 'Размер: ' + fmtSize(parsed.fileSize) })
          ])
        ]),
        parsed.warnings && parsed.warnings.length ? el('div', { style: { padding: '8px 12px', background: 'rgba(243,156,18,.1)', border: '1px solid rgba(243,156,18,.3)', borderRadius: '6px', fontSize: '11.5px', color: '#f39c12', marginBottom: '12px' }, text: '⚠️ ' + parsed.warnings.join(' · ') }) : null,
        el('div', { style: { fontSize: '12px', color: 'var(--dim)', padding: '10px', background: 'rgba(var(--accent-rgb),.08)', borderLeft: '3px solid var(--accent)', borderRadius: '4px' }, text: 'ℹ️ После установки вы увидите реальные данные, извлечённые из файла: манифест, иконки, разрешения, activities, строки, секции PE.' })
      ].filter(Boolean)),
      el('div', { class: 'dialog-foot' }, [
        el('button', { text: 'Отмена', onclick: () => ov.remove() }),
        el('button', { class: 'primary', text: 'Установить', onclick: () => { ov.remove(); this.doInstall(parsed); } })
      ])
    );
    ov.appendChild(dlg);
    document.body.appendChild(ov);
  },
  async doInstall(parsed) {
    const ov = el('div', { class: 'dialog-overlay' });
    const dlg = el('div', { class: 'dialog' }, [
      el('div', { class: 'dialog-head' }, [el('span', { text: '⚙️' }), el('span', { text: 'Установка…' })]),
      el('div', { class: 'dialog-body' })
    ]);
    const body = dlg.querySelector('.dialog-body');
    const pb = el('div', { style: { height: '8px', background: 'var(--input)', borderRadius: '4px', overflow: 'hidden', margin: '12px 0' } });
    const fill = el('div', { style: { height: '100%', background: 'var(--accent)', width: '30%', transition: 'width .3s' } });
    pb.appendChild(fill);
    const status = el('div', { style: { fontSize: '12px', color: 'var(--dim)', textAlign: 'center' }, text: 'Сохранение файла…' });
    body.append(pb, status);
    ov.appendChild(dlg);
    document.body.appendChild(ov);
    try {
      const fileId = await DB.addFile({ name: parsed.fileName, size: parsed.fileSize, kind: parsed.kind, blob: parsed.file, createdAt: Date.now() });
      fill.style.width = '70%'; status.textContent = 'Регистрация…';
      const appRec = {
        name: parsed.displayName, version: parsed.displayVersion, publisher: parsed.displayPublisher,
        kind: parsed.kind, icon: parsed.icon, fileId, fileName: parsed.fileName, fileSize: parsed.fileSize,
        packageName: parsed.packageName || null, permissions: parsed.permissions || [], activities: parsed.activities || [],
        strings: parsed.strings || {}, layouts: parsed.layouts || [], drawables: parsed.drawables || [], assets: parsed.assets || [],
        manifest: parsed.manifest || null,
        peInfo: parsed.kind === 'exe' ? { isMZ: parsed.isMZ, isPE: parsed.isPE, machine: parsed.machine, subsystem: parsed.subsystem, sections: parsed.sections } : null,
        installedAt: Date.now(), runCount: 0
      };
      const appId = await DB.addApp(appRec);
      fill.style.width = '100%'; status.textContent = 'Готово!';
      await new Promise(r => setTimeout(r, 300));
      ov.remove();
      Boot.registerInstalledApp(appId, appRec);
      Notify.push('✅ Установлено', parsed.displayName, '📦');
      if (confirm('Открыть сейчас?')) VM.open('inst_' + appId);
    } catch (e) { ov.remove(); ErrorMgr.dialog({ title: 'Ошибка', icon: '❌', message: e.message }); }
  }
};

/* ═══════ FULL MICROSOFT APPS ═══════ */
const Notepad = { id: 'notepad', name: 'Блокнот', icon: '📝', pinned: true, open() {
  WM.create({ appId: 'notepad', title: 'Блокнот', icon: '📝', width: 680, height: 520, build: b => {
    b.style.cssText = 'display:flex;flex-direction:column;height:100%';
    const tb = el('div', { class: 'toolbar' });
    const saveBtn = el('button', { class: 'tbtn', text: '💾' });
    tb.appendChild(saveBtn);
    const ta = el('textarea', { style: { flex: '1', padding: '14px', outline: 'none', fontFamily: 'Consolas, monospace', fontSize: '14px', lineHeight: '1.5', resize: 'none', background: 'var(--solid)', border: 'none', color: 'var(--text)' } });
    ta.value = Storage.get('notepad.draft', '');
    ta.placeholder = 'Начните печатать…';
    b.append(tb, ta);
    ta.addEventListener('input', () => Storage.set('notepad.draft', ta.value));
    saveBtn.addEventListener('click', () => Notify.push('Блокнот', 'Сохранено', '💾'));
  }});
}};

const Word = { id: 'word', name: 'Word', icon: '📘', pinned: true, open() {
  WM.create({ appId: 'word', title: 'Word', icon: '📘', width: 850, height: 620, build: b => {
    b.style.cssText = 'display:flex;flex-direction:column;height:100%;background:#fff';
    const ribbon = el('div', { style: { padding: '10px 16px', background: '#2b579a', color: '#fff', display: 'flex', gap: '16px', fontSize: '13px' }, html: '<b>Word</b><span style="opacity:.7">Документ 1</span>' });
    const tb = el('div', { class: 'toolbar' });
    const mk = (l, cmd) => { const btn = el('button', { class: 'tbtn', text: l }); btn.addEventListener('click', () => { document.execCommand(cmd, false); ed.focus(); }); return btn; };
    const bB = mk('B', 'bold'); bB.style.fontWeight = '700';
    const bI = mk('I', 'italic'); bI.style.fontStyle = 'italic';
    const bU = mk('U', 'underline'); bU.style.textDecoration = 'underline';
    tb.append(bB, bI, bU);
    const ed = el('div', { contenteditable: 'true', style: { flex: '1', padding: '40px', outline: 'none', overflowY: 'auto', fontSize: '14px', lineHeight: '1.6', maxWidth: '800px', margin: '0 auto', width: '100%', color: '#000' } });
    ed.innerHTML = '<h1>Новый документ</h1><p>Начните печатать в Word…</p>';
    b.append(ribbon, tb, ed);
  }});
}};

const Excel = { id: 'excel', name: 'Excel', icon: '📗', pinned: true, open() {
  WM.create({ appId: 'excel', title: 'Excel', icon: '📗', width: 900, height: 620, build: b => {
    b.style.cssText = 'display:flex;flex-direction:column;height:100%;background:#fff';
    const ribbon = el('div', { style: { padding: '10px 16px', background: '#217346', color: '#fff', fontSize: '13px' }, html: '<b>Excel</b> — Книга 1' });
    const wrap = el('div', { style: { flex: '1', overflow: 'auto', padding: '4px' } });
    const table = el('table', { style: { borderCollapse: 'collapse', fontSize: '12px' } });
    const cols = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
    const hdr = el('tr');
    hdr.appendChild(el('th', {}));
    cols.forEach(c => hdr.appendChild(el('th', { text: c, style: { background: '#f0f0f0', border: '1px solid #ccc', padding: '4px 8px', fontWeight: '600', color: '#333' } })));
    table.appendChild(hdr);
    const data = {};
    for (let r = 1; r <= 25; r++) {
      const tr = el('tr');
      tr.appendChild(el('th', { text: String(r), style: { background: '#f0f0f0', border: '1px solid #ccc', padding: '4px 8px', fontWeight: '600', color: '#333' } }));
      cols.forEach(c => {
        const cell = el('div', { contenteditable: 'true', style: { minWidth: '70px', minHeight: '22px', padding: '4px 6px', border: '1px solid #ccc', outline: 'none', color: '#000' } });
        const ref = c + r;
        cell.addEventListener('blur', () => {
          const v = cell.textContent;
          data[ref] = v;
          if (v && v.startsWith('=')) {
            try {
              const expr = v.slice(1).replace(/([A-Z]+\d+)/g, m => { const val = data[m]; return val && !isNaN(val) ? val : '0'; });
              const res = Function('"use strict";return (' + expr + ')')();
              cell.title = '= ' + res;
              data[ref] = String(res);
            } catch {}
          }
        });
        const td = el('td'); td.appendChild(cell); tr.appendChild(td);
      });
      table.appendChild(tr);
    }
    wrap.appendChild(table);
    b.append(ribbon, wrap);
  }});
}};

const PowerPoint = { id: 'powerpoint', name: 'PowerPoint', icon: '📙', pinned: true, open() {
  WM.create({ appId: 'powerpoint', title: 'PowerPoint', icon: '📙', width: 900, height: 620, build: b => {
    b.style.cssText = 'display:flex;flex-direction:column;height:100%;background:#d24726;padding:0';
    const ribbon = el('div', { style: { padding: '10px 16px', background: '#b7472a', color: '#fff', fontSize: '13px', display: 'flex', gap: '12px', alignItems: 'center' } });
    ribbon.innerHTML = '<b>PowerPoint</b>';
    const newBtn = el('button', { text: '+ Слайд', style: { padding: '4px 12px', background: '#fff', color: '#000', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '11px' } });
    ribbon.appendChild(newBtn);
    const thumbs = el('div', { style: { padding: '8px', display: 'flex', gap: '6px', overflowX: 'auto', background: 'rgba(0,0,0,.1)' } });
    const stage = el('div', { style: { flex: '1', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' } });
    b.append(ribbon, thumbs, stage);
    const slides = [{ title: 'Заголовок', body: 'Текст' }];
    let cur = 0;
    const render = () => {
      thumbs.innerHTML = '';
      slides.forEach((s, i) => {
        const t = el('div', { text: String(i + 1), style: { width: '80px', height: '50px', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#fff', border: '2px solid ' + (i === cur ? '#ffd700' : 'transparent'), borderRadius: '4px', cursor: 'pointer', fontWeight: '600', color: '#000' }, onclick: () => { cur = i; render(); } });
        thumbs.appendChild(t);
      });
      stage.innerHTML = '';
      const slide = el('div', { style: { width: '100%', maxWidth: '720px', aspectRatio: '16/9', background: '#fff', borderRadius: '4px', padding: '40px', boxShadow: '0 4px 20px rgba(0,0,0,.3)' } });
      slide.innerHTML = `<div contenteditable="true" style="font-size:28px;font-weight:600;color:#000;margin-bottom:20px;outline:none">${slides[cur].title}</div><div contenteditable="true" style="font-size:16px;color:#333;line-height:1.6;outline:none">${slides[cur].body}</div>`;
      stage.appendChild(slide);
    };
    newBtn.addEventListener('click', () => { slides.push({ title: 'Новый слайд', body: 'Текст' }); cur = slides.length - 1; render(); });
    render();
  }});
}};

const Paint = { id: 'paint', name: 'Paint', icon: '🎨', pinned: true, open() {
  WM.create({ appId: 'paint', title: 'Paint', icon: '🎨', width: 900, height: 640, build: b => {
    b.style.cssText = 'display:flex;flex-direction:column;height:100%';
    const tools = el('div', { class: 'toolbar' });
    let color = '#000000', tool = 'pen', size = 3;
    ['✏️', '🧽', '／', '▢', '○'].forEach((ic, i) => {
      const btn = el('button', { class: 'tbtn' + (i === 0 ? ' on' : ''), text: ic });
      btn.addEventListener('click', () => { Array.from(tools.querySelectorAll('.tbtn')).forEach(x => x.classList.remove('on')); btn.classList.add('on'); tool = ['pen', 'eraser', 'line', 'rect', 'circle'][i]; });
      tools.appendChild(btn);
    });
    tools.appendChild(el('div', { class: 'sep' }));
    ['#000000', '#ffffff', '#e74c3c', '#3498db', '#27ae60', '#f39c12', '#9b59b6', '#1abc9c', '#e67e22', '#34495e'].forEach(c => {
      const d = el('div', { style: { width: '22px', height: '22px', borderRadius: '4px', cursor: 'pointer', border: '2px solid var(--border)', background: c } });
      d.addEventListener('click', () => { Array.from(tools.querySelectorAll('div[style*="22px"]')).forEach(x => x.style.outline = 'none'); d.style.outline = '2px solid var(--accent)'; color = c; });
      tools.appendChild(d);
    });
    const sizeInp = el('input', { type: 'range', min: '1', max: '20', value: '3', style: { width: '80px' } });
    sizeInp.addEventListener('input', () => size = parseInt(sizeInp.value));
    tools.appendChild(sizeInp);
    const clearBtn = el('button', { class: 'tbtn', text: '🗑' });
    tools.appendChild(clearBtn);
    const wrapper = el('div', { style: { flex: '1', overflow: 'auto', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#888' } });
    const canvas = el('canvas', { style: { background: '#fff', cursor: 'crosshair', display: 'block' } });
    wrapper.appendChild(canvas);
    b.append(tools, wrapper);
    const ctx = canvas.getContext('2d');
    requestAnimationFrame(() => { canvas.width = Math.max(600, wrapper.clientWidth - 20); canvas.height = Math.max(400, wrapper.clientHeight - 20); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height); });
    let drawing = false, sx = 0, sy = 0, snap = null;
    canvas.addEventListener('mousedown', e => { drawing = true; const r = canvas.getBoundingClientRect(); const scx = canvas.width / r.width, scy = canvas.height / r.height; sx = (e.clientX - r.left) * scx; sy = (e.clientY - r.top) * scy; snap = ctx.getImageData(0, 0, canvas.width, canvas.height); ctx.beginPath(); ctx.moveTo(sx, sy); });
    canvas.addEventListener('mousemove', e => {
      if (!drawing) return;
      const r = canvas.getBoundingClientRect(); const scx = canvas.width / r.width, scy = canvas.height / r.height;
      const x = (e.clientX - r.left) * scx, y = (e.clientY - r.top) * scy;
      if (tool === 'pen' || tool === 'eraser') { ctx.strokeStyle = tool === 'eraser' ? '#fff' : color; ctx.lineWidth = size; ctx.lineCap = 'round'; ctx.lineTo(x, y); ctx.stroke(); }
      else { ctx.putImageData(snap, 0, 0); ctx.strokeStyle = color; ctx.lineWidth = size; ctx.beginPath(); if (tool === 'line') { ctx.moveTo(sx, sy); ctx.lineTo(x, y); } else if (tool === 'rect') { ctx.rect(sx, sy, x - sx, y - sy); } else if (tool === 'circle') { const rx = Math.abs(x - sx) / 2, ry = Math.abs(y - sy) / 2; ctx.ellipse(sx + (x - sx) / 2, sy + (y - sy) / 2, rx, ry, 0, 0, Math.PI * 2); } ctx.stroke(); }
    });
    canvas.addEventListener('mouseup', () => drawing = false);
    canvas.addEventListener('mouseleave', () => drawing = false);
    clearBtn.addEventListener('click', () => { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height); });
  }});
}};

const Calculator = { id: 'calculator', name: 'Калькулятор', icon: '🧮', pinned: true, open() {
  WM.create({ appId: 'calculator', title: 'Калькулятор', icon: '🧮', width: 340, height: 500, build: b => {
    b.style.cssText = 'display:flex;flex-direction:column;padding:12px;gap:8px;background:var(--solid)';
    const disp = el('div', { style: { padding: '16px', textAlign: 'right', fontSize: '32px', fontWeight: '300', minHeight: '64px', background: 'var(--input)', borderRadius: '8px', wordBreak: 'break-all' }, text: '0' });
    const keys = el('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '5px', flex: '1' } });
    let expr = '';
    const upd = () => disp.textContent = expr || '0';
    const press = tok => {
      if (tok === 'C') { expr = ''; upd(); return; }
      if (tok === '=') { try { const clean = expr.replace(/[^0-9+\-*/.()]/g, ''); if (!clean) return; const r = Function('"use strict";return (' + clean + ')')(); if (!isFinite(r)) throw 0; expr = String(r); } catch { disp.textContent = 'Ошибка'; expr = ''; return; } upd(); return; }
      if (tok === '⌫') { expr = expr.slice(0, -1); upd(); return; }
      expr += tok; upd();
    };
    ['C', '(', ')', '/', '7', '8', '9', '*', '4', '5', '6', '-', '1', '2', '3', '+', '0', '.', '⌫', '='].forEach(k => {
      keys.appendChild(el('button', { text: k, style: { padding: '14px', fontSize: '16px', background: k === '=' ? 'var(--accent)' : 'var(--input)', color: k === '=' ? '#fff' : 'var(--text)', border: '1px solid var(--border)', borderRadius: '6px', cursor: 'pointer' }, onclick: () => press(k) }));
    });
    b.append(disp, keys);
  }});
}};

const SettingsApp = { id: 'settings', name: 'Настройки', icon: '⚙️', pinned: true, open() {
  WM.create({ appId: 'settings', title: 'Настройки', icon: '⚙️', width: 820, height: 560, build: b => {
    b.style.cssText = 'display:flex;height:100%';
    const nav = el('div', { style: { width: '200px', flexShrink: '0', borderRight: '1px solid var(--border)', padding: '10px', overflowY: 'auto' } });
    const content = el('div', { style: { flex: '1', overflowY: 'auto', padding: '24px' } });
    b.append(nav, content);
    const sections = [
      { id: 'system', icon: '🖥', name: 'Система' },
      { id: 'personal', icon: '🎨', name: 'Персонализация' },
      { id: 'license', icon: '🔑', name: 'Лицензия' },
      { id: 'reset', icon: '⚠️', name: 'Сброс' }
    ];
    let cur = 'license';
    const renderNav = () => { nav.innerHTML = ''; sections.forEach(s => nav.appendChild(el('div', { style: { display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 12px', borderRadius: '6px', cursor: 'pointer', fontSize: '13px', background: s.id === cur ? 'rgba(var(--accent-rgb),.22)' : 'transparent', fontWeight: s.id === cur ? '600' : '400' }, onclick: () => { cur = s.id; renderNav(); renderContent(); } }, [el('span', { text: s.icon }), el('span', { text: s.name })]))); };
    const renderContent = () => {
      content.innerHTML = '';
      content.appendChild(el('h2', { style: { fontSize: '20px', marginBottom: '16px' }, text: sections.find(s => s.id === cur).name }));
      if (cur === 'system') {
        [['Устройство', 'DESKTOP-PC'], ['Процессор', (navigator.hardwareConcurrency || 4) + ' ядер'], ['Версия', Version.get().name]].forEach(([k, v]) => content.appendChild(el('div', { class: 'row' }, [el('span', { text: k }), el('span', { style: { color: 'var(--dim)' }, text: v })])));
      } else if (cur === 'personal') {
        content.appendChild(el('h3', { style: { fontSize: '14px', marginBottom: '10px' }, text: 'Тема' }));
        const tg = el('div', { style: { display: 'flex', gap: '8px' } });
        ['dark', 'light'].forEach(t => tg.appendChild(el('button', { class: 'btn' + (Settings.get('theme') === t ? '' : ' sec'), text: t === 'dark' ? '🌙 Тёмная' : '☀️ Светлая', onclick: () => { Settings.set('theme', t); renderContent(); } })));
        content.appendChild(tg);
      } else if (cur === 'license') {
        content.append(
          el('div', { class: 'card', style: { marginBottom: '16px' } }, [
            el('div', { style: { fontSize: '22px', marginBottom: '8px' }, text: License.getIcon() + ' ' + License.getLabel() }),
            el('div', { style: { fontSize: '12.5px', color: 'var(--dim)' }, text: License.getKey() ? 'Ключ: ' + License.getKey().slice(0, 15) + '...' : 'Не активирована' })
          ]),
          el('div', { class: 'row' }, [el('span', { text: 'Максимум окон' }), el('span', { text: String(License.maxWindows()) })]),
          el('div', { class: 'row' }, [el('span', { text: 'Максимум ВМ' }), el('span', { text: String(License.maxVMs()) })]),
          el('div', { class: 'row' }, [el('span', { text: 'su disasters' }), el('span', { text: License.canUseDisasters() ? '✓ доступна' : '🔒 заблокирована' })])
        );
      } else if (cur === 'reset') {
        content.appendChild(el('button', { class: 'btn danger', text: '🔄 Сбросить систему', onclick: () => { if (confirm('Все данные будут удалены. Продолжить?')) { ['installed', 'user', 'license', 'version', 'activated', 'controlPanelVisible', 'settings', 'notepad.draft'].forEach(k => Storage.remove(k)); indexedDB.deleteDatabase('microOS_v5'); location.reload(); } } }));
      }
    };
    renderNav();
    renderContent();
  }});
}};

const Files = { id: 'files', name: 'Проводник', icon: '📁', pinned: true, open() {
  WM.create({ appId: 'files', title: 'Проводник', icon: '📁', width: 800, height: 520, build: async b => {
    b.style.cssText = 'display:flex;flex-direction:column;height:100%';
    const tb = el('div', { class: 'toolbar' });
    const newBtn = el('button', { class: 'tbtn', text: '➕ Папка' });
    tb.appendChild(newBtn);
    const grid = el('div', { style: { flex: '1', overflowY: 'auto', padding: '12px', display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(96px, 1fr))', gap: '8px', alignContent: 'start' } });
    b.append(tb, grid);
    const render = async () => {
      grid.innerHTML = '';
      ['🖥 Рабочий стол', '📄 Документы', '🖼 Изображения', '⬇ Загрузки', '🎵 Музыка'].forEach(p => {
        grid.appendChild(el('div', { style: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px', padding: '12px 4px', borderRadius: '6px', cursor: 'pointer', fontSize: '12px', textAlign: 'center' }, html: `<div style="font-size:32px">${p.split(' ')[0]}</div><div>${p.substring(2)}</div>` }));
      });
      const apps = await DB.getAllApps();
      apps.forEach(app => {
        const em = el('div', { style: { fontSize: '32px' }, text: app.kind === 'apk' ? '🤖' : '💻' });
        if (app.icon) { const img = el('img', { src: app.icon, style: { width: '32px', height: '32px', borderRadius: '6px', objectFit: 'cover' } }); em.textContent = ''; em.appendChild(img); }
        const item = el('div', { style: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px', padding: '12px 4px', borderRadius: '6px', cursor: 'pointer', fontSize: '12px', textAlign: 'center' } }, [em, el('div', { text: app.name })]);
        item.addEventListener('dblclick', () => VM.open('inst_' + app.id));
        grid.appendChild(item);
      });
    };
    newBtn.addEventListener('click', () => Notify.push('Проводник', 'Создание папок', '📁'));
    render();
  }});
}};

const Edge = { id: 'edge', name: 'Edge', icon: '🌐', pinned: true, open() {
  WM.create({ appId: 'edge', title: 'Edge', icon: '🌐', width: 900, height: 600, build: b => {
    b.style.cssText = 'display:flex;flex-direction:column;height:100%';
    const tb = el('div', { class: 'toolbar' });
    const addr = el('input', { placeholder: 'Адрес или поиск', style: { flex: '1', padding: '5px 12px' } });
    const goBtn = el('button', { class: 'tbtn', text: '➜' });
    tb.append(addr, goBtn);
    const stage = el('div', { style: { flex: '1', position: 'relative', background: '#fff' } });
    b.append(tb, stage);
    const nav = url => { if (!/^https?:\/\//.test(url)) url = 'https://' + url; addr.value = url; stage.innerHTML = ''; const f = el('iframe', { src: url, style: { width: '100%', height: '100%', border: 'none' }, sandbox: 'allow-scripts allow-same-origin allow-forms allow-popups' }); stage.appendChild(f); };
    goBtn.addEventListener('click', () => nav(addr.value));
    addr.addEventListener('keydown', e => { if (e.key === 'Enter') nav(addr.value); });
    stage.innerHTML = '<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;color:#333"><h1 style="font-size:32px;margin-bottom:20px">🌐 Edge</h1><input id="brInp" placeholder="example.com" style="width:min(400px,80%);padding:10px;border:1px solid #ddd;border-radius:20px;outline:none;text-align:center"></div>';
    setTimeout(() => { const inp = stage.querySelector('#brInp'); if (inp) inp.addEventListener('keydown', e => { if (e.key === 'Enter') nav(inp.value); }); }, 50);
  }});
}};

const Terminal = { id: 'terminal', name: 'Терминал', icon: '⌨️', pinned: true, open() {
  WM.create({ appId: 'terminal', title: 'Терминал', icon: '⌨️', width: 760, height: 460, build: b => {
    const term = el('div', { style: { flex: '1', background: '#0c0c0c', color: '#ccc', fontFamily: 'Consolas, monospace', fontSize: '13px', padding: '12px', overflowY: 'auto', lineHeight: '1.5', whiteSpace: 'pre-wrap' } });
    b.appendChild(term);
    const write = (t, cls = '') => { const line = el('div', { text: t, style: { color: cls === 'err' ? '#f48771' : cls === 'ok' ? '#b5cea8' : '#ccc', whiteSpace: 'pre-wrap', wordBreak: 'break-word' } }); term.appendChild(line); term.scrollTop = term.scrollHeight; };
    const prompt = () => {
      const line = el('div', { style: { display: 'flex' } });
      line.append(el('span', { text: 'microOS> ', style: { color: '#4ec9b0' } }));
      const inp = el('input', { style: { background: 'transparent', border: 'none', color: '#ccc', fontFamily: 'inherit', fontSize: '13px', flex: '1', outline: 'none' } });
      inp.addEventListener('keydown', e => { if (e.key === 'Enter') { const cmd = inp.value; inp.disabled = true; write('microOS> ' + cmd); run(cmd); prompt(); } });
      setTimeout(() => inp.focus(), 10);
      line.appendChild(inp);
      term.appendChild(line);
      term.scrollTop = term.scrollHeight;
    };
    const run = raw => {
      const parts = raw.trim().split(/\s+/);
      const cmd = (parts[0] || '').toLowerCase();
      const arg = parts.slice(1).join(' ');
      switch (cmd) {
        case '': break;
        case 'help':
          write('Команды:', 'ok');
          ['help', 'apps', 'info <id>', 'open <id>', 'uninstall <id>', 'cls', 'date', 'time', 'whoami', 'license', 'su disasters', 'exit'].forEach(c => write('  ' + c));
          break;
        case 'apps':
          write('Установленные:', 'ok');
          DB.getAllApps().then(list => { if (!list.length) { write('  <пусто>'); return; } list.forEach(a => write(`  [${a.id}] ${a.name} (${a.kind}) v${a.version}`)); });
          break;
        case 'info':
          if (!arg) { write('Укажите ID', 'err'); break; }
          DB.getApp(parseInt(arg)).then(a => { if (!a) { write('Не найдено', 'err'); return; } write('Имя: ' + a.name, 'ok'); write('Версия: ' + a.version); write('Тип: ' + a.kind); write('Package: ' + (a.packageName || '—')); });
          break;
        case 'open': if (!arg) { write('Укажите ID', 'err'); break; } VM.open('inst_' + arg); write('Открываю', 'ok'); break;
        case 'uninstall': if (!arg) { write('Укажите ID', 'err'); break; } Boot.uninstallApp('inst_' + arg); write('Удалено', 'ok'); break;
        case 'su':
          if (arg === 'disasters') {
            if (!License.canUseDisasters()) { write('[microOS] Отказано в доступе. Требуется административная лицензия.', 'err'); break; }
            ControlPanel.toggle();
            write('Панель сбоев активирована', 'ok');
          } else write('Неверный пароль', 'err');
          break;
        case 'license': write('Лицензия: ' + License.getLabel(), 'ok'); write('Ключ: ' + (License.getKey() ? License.getKey().slice(0, 12) + '...' : '—')); break;
        case 'cls': term.innerHTML = ''; break;
        case 'date': write(new Date().toLocaleDateString('ru-RU')); break;
        case 'time': write(new Date().toLocaleTimeString('ru-RU')); break;
        case 'whoami': write('Пользователь'); break;
        case 'exit': WM.close(WM.activeId); break;
        default: write('Неизвестно: ' + cmd + '. Введите help', 'err');
      }
    };
    write('microOS Terminal v3.0', 'ok');
    write('Лицензия: ' + License.getLabel());
    write('Введите help.');
    write('');
    prompt();
  }});
}};

const Store = { id: 'store', name: 'Магазин', icon: '🛍️', pinned: true, open() {
  WM.create({ appId: 'store', title: 'Магазин', icon: '🛍️', width: 800, height: 580, build: b => {
    b.style.cssText = 'padding:20px;overflow-y:auto';
    b.innerHTML = '<div style="text-align:center;padding:24px;background:linear-gradient(135deg,rgba(var(--accent-rgb),.3),transparent);border-radius:8px;margin-bottom:16px"><h2 style="margin-bottom:8px">microOS Store</h2><div>Скоро 250+ приложений</div></div>';
    const grid = el('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: '10px' } });
    ['🎮 Игры', '🎬 Видео', '🎵 Музыка', '📚 Книги', '🧩 Утилиты', '🎨 Темы', '💡 Расширения', '🔧 Драйверы', '📷 Фото', '🌐 Соцсети', '💼 Бизнес', '📊 Продуктивность'].forEach(t => {
      const it = el('div', { style: { background: 'var(--input)', border: '1px solid var(--border)', borderRadius: '8px', padding: '14px', textAlign: 'center', fontSize: '12px', cursor: 'pointer' }, html: `<div style="font-size:32px;margin-bottom:6px">${t.split(' ')[0]}</div><div>${t.split(' ').slice(1).join(' ')}</div>` });
      it.addEventListener('click', () => Notify.push('Магазин', 'Скоро!', '🛍️'));
      grid.appendChild(it);
    });
    b.appendChild(grid);
  }});
}};

const TaskManager = { id: 'taskmgr', name: 'Диспетчер задач', icon: '📊', pinned: false, open() {
  WM.create({ appId: 'taskmgr', title: 'Диспетчер задач', icon: '📊', width: 700, height: 520, build: b => {
    b.style.cssText = 'display:flex;flex-direction:column;height:100%';
    const tb = el('div', { class: 'toolbar' });
    const content = el('div', { style: { flex: '1', overflowY: 'auto' } });
    let tab = 'proc';
    const render = () => {
      content.innerHTML = '';
      if (tab === 'proc') {
        if (!WM.wins.length) content.appendChild(el('div', { class: 'empty-state', text: 'Нет открытых окон' }));
        WM.wins.forEach(w => {
          const app = Apps.get(w.appId) || { name: w.appId, icon: '🗔' };
          const row = el('div', { class: 'row' });
          row.innerHTML = `<div style="flex:1;display:flex;gap:8px;align-items:center"><span>${app.icon}</span><span>${esc(app.name)}</span></div><div style="min-width:60px;text-align:right">${Math.max(1, Math.round(SystemState.cpu / (WM.wins.length + 1)))}%</div><div style="min-width:80px;text-align:right">${Math.round(SystemState.ramMB / (WM.wins.length + 2) / 4)} МБ</div>`;
          const kill = el('button', { text: 'Снять', style: { padding: '4px 10px', fontSize: '11.5px', background: 'var(--input)', border: '1px solid var(--border)', borderRadius: '4px', cursor: 'pointer' }, onclick: () => { WM.close(w.id); render(); } });
          row.appendChild(kill);
          content.appendChild(row);
        });
      } else {
        content.innerHTML = `<div style="padding:20px"><h3>CPU: ${Math.round(SystemState.cpu)}%</h3><div style="height:8px;background:var(--input);border-radius:4px;overflow:hidden;margin:8px 0"><div style="height:100%;width:${SystemState.cpu}%;background:var(--accent)"></div></div><h3>ОЗУ: ${Math.round(SystemState.ramMB)} / ${SystemState.ramMaxMB} МБ</h3></div>`;
      }
    };
    ['Процессы', 'Производительность'].forEach((t, i) => {
      const btn = el('button', { class: 'tbtn' + (i === 0 ? ' on' : ''), text: t });
      btn.addEventListener('click', () => { tab = i === 0 ? 'proc' : 'perf'; Array.from(tb.children).forEach((x, idx) => x.classList.toggle('on', idx === i)); render(); });
      tb.appendChild(btn);
    });
    b.append(tb, content);
    render();
    setInterval(render, 2000);
  }});
}};

const Photos = { id: 'photos', name: 'Фотографии', icon: '🖼', pinned: true, open() {
  WM.create({ appId: 'photos', title: 'Фотографии', icon: '🖼', width: 700, height: 520, build: b => {
    b.style.cssText = 'padding:16px;overflow-y:auto';
    b.innerHTML = '<h2 style="margin-bottom:16px">🖼 Изображения</h2><div style="color:var(--dim);text-align:center;padding:40px">Сделайте скриншот или рисунок в Paint</div>';
  }});
}};

const Camera = { id: 'camera', name: 'Камера', icon: '📷', pinned: false, open() {
  WM.create({ appId: 'camera', title: 'Камера', icon: '📷', width: 700, height: 560, build: b => {
    b.style.cssText = 'display:flex;flex-direction:column;height:100%;background:#000';
    const view = el('div', { style: { flex: '1', display: 'flex', alignItems: 'center', justifyContent: 'center' } });
    const video = el('video', { autoplay: 'true', muted: 'true', playsinline: 'true', style: { width: '100%', height: '100%', objectFit: 'cover' } });
    view.appendChild(video);
    const ctrl = el('div', { style: { padding: '14px', display: 'flex', justifyContent: 'center', background: '#000' } });
    const shutter = el('button', { style: { width: '60px', height: '60px', borderRadius: '50%', background: '#fff', border: '3px solid #999', cursor: 'pointer' } });
    ctrl.appendChild(shutter);
    b.append(view, ctrl);
    let stream = null;
    navigator.mediaDevices.getUserMedia({ video: true }).then(s => { stream = s; video.srcObject = s; }).catch(e => { view.innerHTML = '<div style="color:#fff;padding:40px;text-align:center">📷<br>Камера недоступна<br><small>' + esc(e.message) + '</small></div>'; });
    shutter.addEventListener('click', () => { if (!video.videoWidth) return; Notify.push('Камера', 'Фото сделано', '📷'); });
    const win = WM.wins[WM.wins.length - 1];
    if (win) win.cleanup = () => { if (stream) stream.getTracks().forEach(t => t.stop()); };
  }});
}};

const Clock = { id: 'clock', name: 'Часы', icon: '⏰', pinned: false, open() {
  WM.create({ appId: 'clock', title: 'Часы', icon: '⏰', width: 480, height: 520, build: b => {
    b.style.cssText = 'padding:20px;display:flex;flex-direction:column;gap:16px;align-items:center';
    const tabs = el('div', { style: { display: 'flex', gap: '4px', background: 'var(--input)', padding: '4px', borderRadius: '8px' } });
    let mode = 'clock';
    ['Часы', 'Таймер', 'Секундомер'].forEach((n, i) => {
      const btn = el('button', { text: n, style: { padding: '7px 18px', borderRadius: '6px', fontSize: '12.5px', cursor: 'pointer', background: i === 0 ? 'var(--accent)' : 'transparent', color: i === 0 ? '#fff' : 'var(--text)' } });
      btn.addEventListener('click', () => { mode = ['clock', 'timer', 'stop'][i]; Array.from(tabs.children).forEach((x, idx) => { x.style.background = idx === i ? 'var(--accent)' : 'transparent'; x.style.color = idx === i ? '#fff' : 'var(--text)'; }); render(); });
      tabs.appendChild(btn);
    });
    const disp = el('div', { style: { fontSize: '52px', fontWeight: '200', fontVariantNumeric: 'tabular-nums' }, text: '00:00:00' });
    const sub = el('div', { style: { color: 'var(--dim)', fontSize: '13px' } });
    const ctrls = el('div', { style: { display: 'flex', gap: '8px' } });
    b.append(tabs, disp, sub, ctrls);
    let timerSec = 60, timerInt = null, stopMs = 0, stopInt = null, stopRun = false;
    const render = () => {
      ctrls.innerHTML = '';
      if (mode === 'clock') {
        const d = new Date();
        disp.textContent = pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
        sub.textContent = d.toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' });
      } else if (mode === 'timer') {
        disp.textContent = pad(Math.floor(timerSec / 60)) + ':' + pad(timerSec % 60);
        sub.textContent = 'Таймер';
        const start = el('button', { class: 'btn', text: timerInt ? '⏸ Пауза' : '▶ Старт', onclick: () => { if (timerInt) { clearInterval(timerInt); timerInt = null; } else { timerInt = setInterval(() => { timerSec--; if (timerSec <= 0) { clearInterval(timerInt); timerInt = null; timerSec = 0; AudioMgr.beep(880, 0.3, 'square', 0.1); Notify.push('Таймер', 'Время!', '⏰'); } render(); }, 1000); } render(); } });
        const reset = el('button', { class: 'btn sec', text: 'Сброс', onclick: () => { if (timerInt) { clearInterval(timerInt); timerInt = null; } timerSec = 60; render(); } });
        ctrls.append(start, reset);
      } else {
        const m = Math.floor(stopMs / 60000), s = Math.floor((stopMs % 60000) / 1000), cs = Math.floor((stopMs % 1000) / 10);
        disp.textContent = pad(m) + ':' + pad(s) + '.' + pad(cs);
        sub.textContent = 'Секундомер';
        const start = el('button', { class: 'btn', text: stopRun ? '⏸ Пауза' : '▶ Старт', onclick: () => { if (stopRun) { clearInterval(stopInt); stopRun = false; } else { stopRun = true; const t0 = Date.now() - stopMs; stopInt = setInterval(() => { stopMs = Date.now() - t0; render(); }, 31); } render(); } });
        const reset = el('button', { class: 'btn sec', text: 'Сброс', onclick: () => { clearInterval(stopInt); stopRun = false; stopMs = 0; render(); } });
        ctrls.append(start, reset);
      }
    };
    setInterval(() => { if (mode === 'clock') render(); }, 1000);
    render();
  }});
}};

const Weather = { id: 'weather', name: 'Погода', icon: '⛅', pinned: false, open() {
  WM.create({ appId: 'weather', title: 'Погода', icon: '⛅', width: 500, height: 600, build: b => {
    b.style.cssText = 'padding:24px;background:linear-gradient(180deg,#4a90e2,#2c5f9e);color:#fff;overflow-y:auto;height:100%';
    b.innerHTML = '<div style="text-align:center;margin-bottom:24px"><div style="font-size:18px;margin-bottom:4px">Москва</div><div style="font-size:64px;font-weight:200">+18°</div><div style="opacity:.85;font-size:13px">Переменная облачность</div></div><div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(100px,1fr));gap:10px;margin-bottom:16px"><div style="background:rgba(255,255,255,.15);padding:12px;border-radius:10px;text-align:center;font-size:12px"><div>Пн</div><div style="font-size:22px;margin:6px 0">☀️</div><div>+20°/+12°</div></div><div style="background:rgba(255,255,255,.15);padding:12px;border-radius:10px;text-align:center;font-size:12px"><div>Вт</div><div style="font-size:22px;margin:6px 0">⛅</div><div>+18°/+11°</div></div><div style="background:rgba(255,255,255,.15);padding:12px;border-radius:10px;text-align:center;font-size:12px"><div>Ср</div><div style="font-size:22px;margin:6px 0">🌧</div><div>+15°/+10°</div></div></div>';
  }});
}};

const Mines = { id: 'mines', name: 'Сапёр', icon: '💣', pinned: false, open() {
  WM.create({ appId: 'mines', title: 'Сапёр', icon: '💣', width: 520, height: 600, build: b => {
    b.style.cssText = 'padding:20px;display:flex;flex-direction:column;align-items:center;gap:12px';
    const hud = el('div', { style: { display: 'flex', gap: '16px', alignItems: 'center', fontSize: '13px', fontWeight: '600' } });
    const minesLbl = el('span', { text: '💣 0' });
    const statusLbl = el('span', { text: '' });
    const restart = el('button', { class: 'btn sec', text: 'Новая' });
    hud.append(minesLbl, statusLbl, restart);
    const grid = el('div', { style: { display: 'grid', gap: '2px', background: 'var(--border)', padding: '2px', borderRadius: '4px' } });
    b.append(hud, grid);
    const SIZE = 12, MINES = 20;
    let cells = [], over = false;
    const init = () => {
      over = false; grid.innerHTML = ''; grid.style.gridTemplateColumns = `repeat(${SIZE},26px)`;
      cells = [];
      for (let i = 0; i < SIZE * SIZE; i++) {
        cells.push({ mine: false, open: false, flag: false, n: 0 });
        const c = el('div', { style: { width: '26px', height: '26px', background: 'rgba(128,128,128,.28)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '13px', fontWeight: '700', cursor: 'pointer' } });
        c.dataset.i = i;
        c.addEventListener('click', () => openCell(i));
        c.addEventListener('contextmenu', e => { e.preventDefault(); if (!over && !cells[i].open) { cells[i].flag = !cells[i].flag; updateFlags(); draw(); } });
        grid.appendChild(c);
      }
      let placed = 0;
      while (placed < MINES) { const p = Math.floor(Math.random() * SIZE * SIZE); if (!cells[p].mine) { cells[p].mine = true; placed++; } }
      for (let i = 0; i < SIZE * SIZE; i++) cells[i].n = neighbors(i).filter(j => cells[j].mine).length;
      draw();
    };
    const neighbors = i => { const r = Math.floor(i / SIZE), c = i % SIZE, out = []; for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) { if (!dr && !dc) continue; const nr = r + dr, nc = c + dc; if (nr >= 0 && nr < SIZE && nc >= 0 && nc < SIZE) out.push(nr * SIZE + nc); } return out; };
    const openCell = i => { if (over || cells[i].open) return; if (cells[i].flag) return; if (cells[i].mine) { over = true; cells.forEach((c, k) => { if (c.mine) { grid.children[k].style.background = '#e81123'; grid.children[k].textContent = '💣'; } }); statusLbl.textContent = '💥 Проиграли'; return; } flood(i); draw(); checkWin(); };
    const flood = i => { const stack = [i]; while (stack.length) { const k = stack.pop(); const c = cells[k]; if (c.open || c.flag) continue; c.open = true; if (c.n === 0) neighbors(k).forEach(j => { if (!cells[j].open) stack.push(j); }); } };
    const draw = () => { cells.forEach((c, i) => { const e = grid.children[i]; e.style.background = c.open ? 'rgba(128,128,128,.1)' : 'rgba(128,128,128,.28)'; e.textContent = c.open ? (c.n > 0 ? String(c.n) : '') : c.flag ? '🚩' : ''; }); };
    const checkWin = () => { const opened = cells.filter(c => c.open).length; if (opened === SIZE * SIZE - MINES) { over = true; statusLbl.textContent = '🏆 Победа!'; } };
    const updateFlags = () => minesLbl.textContent = '💣 ' + (MINES - cells.filter(c => c.flag).length);
    restart.addEventListener('click', init);
    init();
  }});
}};

const Snake = { id: 'snake', name: 'Змейка', icon: '🐍', pinned: false, open() {
  WM.create({ appId: 'snake', title: 'Змейка', icon: '🐍', width: 520, height: 600, build: b => {
    b.style.cssText = 'padding:20px;display:flex;flex-direction:column;align-items:center;gap:12px';
    const hud = el('div', { style: { display: 'flex', gap: '16px', alignItems: 'center', fontSize: '13px', fontWeight: '600' } });
    const scoreLbl = el('span', { text: 'Счёт: 0' });
    const restart = el('button', { class: 'btn sec', text: 'Заново' });
    hud.append(scoreLbl, restart);
    const canvas = el('canvas', { style: { borderRadius: '8px', background: '#0d1a0d', display: 'block' } });
    const CS = 20, COLS = 22, ROWS = 20;
    canvas.width = COLS * CS; canvas.height = ROWS * CS;
    b.append(hud, canvas);
    const ctx = canvas.getContext('2d');
    let snake, dir, nextDir, food, score, alive, loop;
    const reset = () => {
      snake = [{ x: 10, y: 10 }, { x: 9, y: 10 }, { x: 8, y: 10 }];
      dir = { x: 1, y: 0 }; nextDir = { x: 1, y: 0 };
      score = 0; alive = true; scoreLbl.textContent = 'Счёт: 0';
      placeFood(); draw();
      clearInterval(loop); loop = setInterval(tick, 110);
    };
    const placeFood = () => { let ok = false; while (!ok) { food = { x: Math.floor(Math.random() * COLS), y: Math.floor(Math.random() * ROWS) }; ok = !snake.some(s => s.x === food.x && s.y === food.y); } };
    const tick = () => {
      if (!alive) return;
      dir = nextDir;
      const head = { x: snake[0].x + dir.x, y: snake[0].y + dir.y };
      if (head.x < 0 || head.x >= COLS || head.y < 0 || head.y >= ROWS || snake.some(s => s.x === head.x && s.y === head.y)) { alive = false; clearInterval(loop); return; }
      snake.unshift(head);
      if (head.x === food.x && head.y === food.y) { score += 10; scoreLbl.textContent = 'Счёт: ' + score; placeFood(); } else snake.pop();
      draw();
    };
    const draw = () => {
      ctx.fillStyle = '#0d1a0d'; ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = '#ff5f5f'; ctx.beginPath(); ctx.arc(food.x * CS + CS / 2, food.y * CS + CS / 2, CS / 2 - 3, 0, Math.PI * 2); ctx.fill();
      snake.forEach((s, i) => { ctx.fillStyle = i === 0 ? '#7cf07c' : 'rgba(90,200,90,' + (1 - i / (snake.length * 1.6)) + ')'; ctx.fillRect(s.x * CS + 1, s.y * CS + 1, CS - 2, CS - 2); });
    };
    const onKey = e => { const k = e.key.toLowerCase(); if ((k === 'arrowup' || k === 'w') && dir.y === 0) nextDir = { x: 0, y: -1 }; else if ((k === 'arrowdown' || k === 's') && dir.y === 0) nextDir = { x: 0, y: 1 }; else if ((k === 'arrowleft' || k === 'a') && dir.x === 0) nextDir = { x: -1, y: 0 }; else if ((k === 'arrowright' || k === 'd') && dir.x === 0) nextDir = { x: 1, y: 0 }; };
    document.addEventListener('keydown', onKey);
    const win = WM.wins[WM.wins.length - 1];
    if (win) win.cleanup = () => { clearInterval(loop); document.removeEventListener('keydown', onKey); };
    restart.addEventListener('click', reset);
    reset();
  }});
}};

const StickyNotes = { id: 'stickynotes', name: 'Записки', icon: '📝', pinned: false, open() {
  WM.create({ appId: 'stickynotes', title: 'Записки', icon: '📝', width: 400, height: 500, build: b => {
    b.style.cssText = 'padding:16px;overflow-y:auto';
    b.innerHTML = '<h2 style="margin-bottom:12px">📝 Записки</h2>';
    const input = el('textarea', { placeholder: 'Новая заметка…', style: { width: '100%', height: '100px', padding: '10px', borderRadius: '8px', border: '1px solid var(--border)', background: 'var(--input)', resize: 'none' } });
    const btn = el('button', { class: 'btn', text: '+ Создать', style: { marginTop: '8px' } });
    const list = el('div', { style: { marginTop: '12px', display: 'flex', flexDirection: 'column', gap: '8px' } });
    b.append(input, btn, list);
    let notes = Storage.get('stickyNotes.list', []);
    const render = () => { list.innerHTML = ''; notes.forEach((n, i) => { const d = el('div', { style: { padding: '12px', background: '#fff9c4', color: '#333', borderRadius: '6px', fontSize: '13px', position: 'relative' }, text: n.text }); const del = el('button', { text: '✕', style: { position: 'absolute', top: '6px', right: '6px', fontSize: '14px', cursor: 'pointer', background: 'none', border: 'none', color: '#666' }, onclick: () => { notes.splice(i, 1); Storage.set('stickyNotes.list', notes); render(); } }); d.appendChild(del); list.appendChild(d); }); };
    btn.addEventListener('click', () => { if (!input.value.trim()) return; notes.push({ text: input.value.trim() }); Storage.set('stickyNotes.list', notes); input.value = ''; render(); });
    render();
  }});
}};

const Solitaire = { id: 'solitaire', name: 'Косынка', icon: '🃏', pinned: false, open() {
  WM.create({ appId: 'solitaire', title: 'Косынка', icon: '🃏', width: 800, height: 600, build: b => {
    b.style.cssText = 'padding:16px;background:#0a5e2a;color:#fff;overflow-y:auto;height:100%';
    b.innerHTML = '<h2 style="margin-bottom:16px">🃏 Косынка</h2><div style="padding:20px;background:rgba(255,255,255,.1);border-radius:8px"><p style="margin-bottom:12px">Классическая игра «Косынка»</p><p style="opacity:.7;font-size:12px">Полная игра в разработке</p></div>';
  }});
}};

const makeApp = meta => ({
  id: meta.id, name: meta.name, icon: meta.icon, pinned: false,
  open() {
    WM.create({
      appId: meta.id, title: meta.name, icon: meta.icon, width: 800, height: 560,
      build: (b) => {
        b.style.cssText = 'display:flex;flex-direction:column;height:100%';
        const header = el('div', { style: { padding: '14px 20px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: '12px', background: 'rgba(var(--accent-rgb),.08)', flexShrink: '0' } }, [
          el('div', { style: { fontSize: '32px' }, text: meta.icon }),
          el('div', {}, [
            el('div', { style: { fontSize: '16px', fontWeight: '600' }, text: meta.name }),
            el('div', { style: { fontSize: '11.5px', color: 'var(--dim)' }, text: meta.category || 'Приложение' })
          ])
        ]);
        b.appendChild(header);
        const tabs = ['Обзор', 'Функции', 'Настройки'];
        const tabBar = el('div', { class: 'toolbar' });
        const content = el('div', { style: { flex: '1', overflowY: 'auto', padding: '16px' } });
        let curTab = 0;
        const render = () => {
          content.innerHTML = '';
          if (curTab === 0) {
            content.append(
              el('div', { class: 'row' }, [el('span', { text: 'Приложение' }), el('span', { style: { color: 'var(--dim)' }, text: meta.name })]),
              el('div', { class: 'row' }, [el('span', { text: 'Категория' }), el('span', { style: { color: 'var(--dim)' }, text: meta.category || '—' })]),
              el('div', { class: 'row' }, [el('span', { text: 'Версия' }), el('span', { style: { color: 'var(--dim)' }, text: 'v3.0.0' })])
            );
          } else if (curTab === 1) {
            const features = {
              'Office': ['Работа с документами', 'Форматирование', 'Совместный доступ'],
              'Dev': ['Редактор кода', 'Терминал', 'Отладка'],
              'Media': ['Воспроизведение', 'Плейлисты', 'Эффекты'],
              'Games': ['Одиночная игра', 'Счёт', 'Рекорды'],
              'System': ['Настройки', 'Мониторинг', 'Службы'],
              'Utils': ['Инструменты', 'Быстрые действия', 'Настройки'],
              'Comms': ['Сообщения', 'Контакты', 'Уведомления']
            }[meta.category] || ['Функция 1', 'Функция 2', 'Функция 3'];
            features.forEach(f => content.appendChild(el('div', { class: 'row' }, [el('span', { text: '• ' + f })])));
          } else {
            content.appendChild(el('div', { class: 'row' }, [el('span', { text: 'Тема' }), el('span', { style: { color: 'var(--dim)' }, text: 'Системная' })]));
            content.appendChild(el('div', { class: 'row' }, [el('span', { text: 'Уведомления' }), el('span', { style: { color: '#2ecc71' }, text: 'Вкл' })]));
          }
        };
        tabs.forEach((t, i) => {
          const btn = el('button', { class: 'tbtn' + (i === 0 ? ' on' : ''), text: t });
          btn.addEventListener('click', () => { curTab = i; Array.from(tabBar.children).forEach((x, idx) => x.classList.toggle('on', idx === i)); render(); });
          tabBar.appendChild(btn);
        });
        b.append(tabBar, content);
        render();
      }
    });
  }
});

const FULL_APPS = [Notepad, Word, Excel, PowerPoint, Paint, Calculator, SettingsApp, Files, Edge, Terminal, Store, TaskManager, Photos, Camera, Clock, Weather, Mines, Snake, StickyNotes, Solitaire];
FULL_APPS.forEach(a => Apps.register(a));

const MICROSOFT_META = [
  { id: 'outlook', name: 'Outlook', icon: '📧', category: 'Office' },
  { id: 'onenote', name: 'OneNote', icon: '📓', category: 'Office' },
  { id: 'teams', name: 'Teams', icon: '👥', category: 'Office' },
  { id: 'access', name: 'Access', icon: '🗄', category: 'Office' },
  { id: 'vscode', name: 'VS Code', icon: '💻', category: 'Dev' },
  { id: 'vstudio', name: 'Visual Studio', icon: '🧑‍💻', category: 'Dev' },
  { id: 'powershell', name: 'PowerShell', icon: '⌨️', category: 'Dev' },
  { id: 'skype', name: 'Skype', icon: '📞', category: 'Comms' },
  { id: 'mediaplayer', name: 'Media Player', icon: '🎵', category: 'Media' },
  { id: 'paint3d', name: 'Paint 3D', icon: '🎨', category: 'Media' },
  { id: 'movies', name: 'Movies & TV', icon: '🎬', category: 'Media' },
  { id: 'mahjong', name: 'Mahjong', icon: '🀄', category: 'Games' },
  { id: 'xbox', name: 'Xbox', icon: '🎮', category: 'Games' },
  { id: 'gamebar', name: 'Game Bar', icon: '🎯', category: 'Games' },
  { id: 'snipping', name: 'Snipping Tool', icon: '✂️', category: 'Utils' },
  { id: 'sketchpad', name: 'Sketchpad', icon: '✏️', category: 'Utils' },
  { id: 'phonelink', name: 'Phone Link', icon: '📱', category: 'Utils' },
  { id: 'quickassist', name: 'Quick Assist', icon: '🤝', category: 'Utils' },
  { id: 'charmap', name: 'Character Map', icon: '🔤', category: 'Utils' },
  { id: 'special', name: 'Special Abilities', icon: '♿', category: 'Utils' },
  { id: 'stepsrec', name: 'Steps Recorder', icon: '📝', category: 'Utils' },
  { id: 'remote', name: 'Remote Desktop', icon: '🖥', category: 'Utils' },
  { id: 'controlpanel', name: 'Control Panel', icon: '🎛', category: 'System' },
  { id: 'resource', name: 'Resource Monitor', icon: '📈', category: 'System' },
  { id: 'eventviewer', name: 'Event Viewer', icon: '📋', category: 'System' },
  { id: 'regedit', name: 'Registry Editor', icon: '🗄', category: 'System' },
  { id: 'gpedit', name: 'Group Policy', icon: '📜', category: 'System' },
  { id: 'services', name: 'Services', icon: '⚙️', category: 'System' },
  { id: 'taskschd', name: 'Task Scheduler', icon: '⏱️', category: 'System' },
  { id: 'diskmgmt', name: 'Disk Management', icon: '💾', category: 'System' },
  { id: 'sysrestore', name: 'System Restore', icon: '🔄', category: 'System' },
  { id: 'defender', name: 'Defender', icon: '🛡️', category: 'System' },
  { id: 'winget', name: 'Winget', icon: '📦', category: 'System' },
  { id: 'powertoys', name: 'PowerToys', icon: '🧰', category: 'System' },
  { id: 'memtest', name: 'Memory Test', icon: '🧠', category: 'System' },
  { id: 'diskcleanup', name: 'Disk Cleanup', icon: '🧹', category: 'System' },
  { id: 'mail', name: 'Mail', icon: '📧', category: 'Comms' },
  { id: 'calendar', name: 'Calendar', icon: '📅', category: 'Comms' },
  { id: 'recorder', name: 'Voice Recorder', icon: '🎤', category: 'Media' },
  { id: 'maps', name: 'Maps', icon: '🗺', category: 'Utils' },
  { id: 'contacts', name: 'Contacts', icon: '👥', category: 'Comms' },
  { id: 'phone', name: 'Phone', icon: '📞', category: 'Comms' },
  { id: 'messages', name: 'Messages', icon: '💬', category: 'Comms' },
  { id: 'assistant', name: 'Assistant', icon: '🤖', category: 'Utils' }
];

MICROSOFT_META.forEach(meta => Apps.register(makeApp(meta)));

/* ═══════ DESKTOP ═══════ */
const Desktop = {
  positions: {},
  baseIcons: [
    { key: 'files', label: 'Проводник', icon: '📁', action: () => Apps.open('files') },
    { key: 'notepad', label: 'Блокнот', icon: '📝', action: () => Apps.open('notepad') },
    { key: 'calculator', label: 'Калькулятор', icon: '🧮', action: () => Apps.open('calculator') },
    { key: 'terminal', label: 'Терминал', icon: '⌨️', action: () => Apps.open('terminal') },
    { key: 'settings', label: 'Настройки', icon: '⚙️', action: () => Apps.open('settings') },
    { key: 'paint', label: 'Paint', icon: '🎨', action: () => Apps.open('paint') }
  ],
  render() {
    const box = $('#icons'); if (!box) return;
    box.innerHTML = '';
    this.positions = Storage.get('iconPos', {});
    this.baseIcons.forEach((ic, i) => {
      const pos = this.positions[ic.key] || { x: 18 + Math.floor(i / 6) * 96, y: 18 + (i % 6) * 104 };
      const d = el('div', { class: 'dicon', 'data-key': ic.key, style: { left: pos.x + 'px', top: pos.y + 'px' } }, [el('div', { class: 'em', text: ic.icon }), el('div', { class: 'lb', text: ic.label })]);
      d.addEventListener('click', e => { e.stopPropagation(); $$('.dicon').forEach(x => x.classList.remove('sel')); d.classList.add('sel'); });
      d.addEventListener('dblclick', ic.action);
      d.addEventListener('mousedown', e => this.startDrag(e, d, ic.key));
      box.appendChild(d);
    });
    DB.getAllApps().then(apps => {
      apps.forEach((app, i) => {
        const key = 'inst_' + app.id;
        const idx = this.baseIcons.length + i;
        const pos = this.positions[key] || { x: 18 + Math.floor(idx / 6) * 96 + 480, y: 18 + (idx % 6) * 104 };
        const em = el('div', { class: 'em' });
        if (app.icon) em.appendChild(el('img', { src: app.icon }));
        else em.textContent = app.kind === 'apk' ? '🤖' : '💻';
        const d = el('div', { class: 'dicon', 'data-key': key, style: { left: pos.x + 'px', top: pos.y + 'px' } }, [em, el('div', { class: 'lb', text: app.name })]);
        d.addEventListener('click', e => { e.stopPropagation(); $$('.dicon').forEach(x => x.classList.remove('sel')); d.classList.add('sel'); });
        d.addEventListener('dblclick', () => VM.open(key));
        d.addEventListener('mousedown', e => this.startDrag(e, d, key));
        d.addEventListener('contextmenu', e => {
          e.preventDefault(); e.stopPropagation();
          const menu = el('div', { style: { position: 'fixed', left: e.clientX + 'px', top: e.clientY + 'px', background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: '8px', boxShadow: 'var(--shadow)', padding: '5px', zIndex: '10000', minWidth: '180px' } });
          menu.appendChild(el('div', { text: '🚀 Открыть', style: { padding: '8px 12px', fontSize: '13px', cursor: 'pointer', borderRadius: '5px' }, onclick: () => { menu.remove(); VM.open(key); } }));
          menu.appendChild(el('div', { text: '🗑 Удалить', style: { padding: '8px 12px', fontSize: '13px', cursor: 'pointer', borderRadius: '5px', color: '#e74c3c' }, onclick: async () => { menu.remove(); if (confirm('Удалить?')) await Boot.uninstallApp(key); } }));
          document.body.appendChild(menu);
          setTimeout(() => document.addEventListener('click', function h(ev) { if (!menu.contains(ev.target)) { menu.remove(); document.removeEventListener('click', h); } }), 10);
        });
        box.appendChild(d);
      });
    });
  },
  startDrag(e, d, key) {
    if (e.button !== 0) return;
    let dragging = false;
    const sx = e.clientX, sy = e.clientY;
    const ox = parseFloat(d.style.left), oy = parseFloat(d.style.top);
    const move = ev => { const dx = ev.clientX - sx, dy = ev.clientY - sy; if (!dragging && Math.hypot(dx, dy) > 5) dragging = true; if (dragging) { d.style.left = Math.max(0, ox + dx) + 'px'; d.style.top = Math.max(0, oy + dy) + 'px'; } };
    const up = () => { document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up); if (dragging) { this.positions[key] = { x: parseFloat(d.style.left), y: parseFloat(d.style.top) }; Storage.set('iconPos', this.positions); } };
    document.addEventListener('mousemove', move); document.addEventListener('mouseup', up);
  }
};

const Taskbar = {
  render() {
    const c = $('#tbCenter'); if (!c) return;
    c.innerHTML = '';
    const start = el('button', { class: 'tb-btn' });
    const logo = el('div', { class: 'tb-logo' });
    for (let i = 0; i < 4; i++) logo.appendChild(el('i'));
    start.appendChild(logo);
    start.addEventListener('click', e => { e.stopPropagation(); StartMenu.toggle(); });
    c.appendChild(start);
    WM.wins.forEach(w => {
      const app = Apps.get(w.appId);
      const b = el('button', { class: 'tb-btn running' + (w.id === WM.activeId ? ' focused' : '') });
      if (app && app.icon && String(app.icon).startsWith('data:')) b.appendChild(el('img', { src: app.icon }));
      else if (w.appId && w.appId.startsWith('inst_')) b.textContent = '📦';
      else b.textContent = app ? app.icon : '🗔';
      b.title = w.title;
      b.addEventListener('click', () => { if (w.minimized) WM.focus(w.id); else if (w.id === WM.activeId) WM.minimize(w.id); else WM.focus(w.id); });
      c.appendChild(b);
    });
  }
};

const StartMenu = {
  open: false,
  init() {
    const search = $('#smSearch');
    if (search) search.addEventListener('input', debounce(() => this.render(), 250));
    const power = $('#smPower');
    if (power) power.addEventListener('click', () => { if (confirm('Выключить microOS?')) WM.wins.slice().forEach(w => WM.close(w.id)); });
    document.addEventListener('click', e => { if (this.open && !e.target.closest('#startMenu') && !e.target.closest('.tb-btn')) this.close(); });
    this.render();
  },
  render() {
    const pinned = $('#smPinned'); if (!pinned) return;
    pinned.innerHTML = '';
    Apps.list().filter(a => a.pinned).forEach(a => {
      const em = el('div', { class: 'em' });
      if (a.icon && String(a.icon).startsWith('data:')) em.appendChild(el('img', { src: a.icon }));
      else em.textContent = a.icon;
      const d = el('div', { class: 'sm-app' }, [em, el('div', { text: a.name })]);
      d.addEventListener('click', () => { this.close(); Apps.open(a.id); });
      pinned.appendChild(d);
    });
    const installed = $('#smInstalled');
    if (installed) {
      installed.innerHTML = '';
      DB.getAllApps().then(apps => {
        const q = ($('#smSearch')?.value || '').toLowerCase().trim();
        apps.filter(a => !q || a.name.toLowerCase().includes(q)).forEach(a => {
          const em = el('span', { class: 'em' });
          if (a.icon) em.appendChild(el('img', { src: a.icon }));
          else em.textContent = a.kind === 'apk' ? '🤖' : '💻';
          const d = el('div', { class: 'sm-row' }, [em, el('span', { text: a.name })]);
          d.addEventListener('click', () => { this.close(); VM.open('inst_' + a.id); });
          installed.appendChild(d);
        });
        if (!apps.length) installed.innerHTML = '<div style="padding:12px;color:var(--dim);font-size:12px">Нет установленных</div>';
      });
    }
    const all = $('#smAll');
    if (all) {
      all.innerHTML = '';
      Apps.list().sort((a, b) => a.name.localeCompare(b.name, 'ru')).forEach(a => {
        const em = el('span', { class: 'em' });
        if (a.icon && String(a.icon).startsWith('data:')) em.appendChild(el('img', { src: a.icon }));
        else em.textContent = a.icon;
        const d = el('div', { class: 'sm-row' }, [em, el('span', { text: a.name })]);
        d.addEventListener('click', () => { this.close(); Apps.open(a.id); });
        all.appendChild(d);
      });
    }
  },
  toggle() { this.open ? this.close() : this.show(); },
  show() { this.open = true; $('#startMenu').classList.remove('closed'); setTimeout(() => $('#smSearch')?.focus(), 80); },
  close() { this.open = false; $('#startMenu').classList.add('closed'); const s = $('#smSearch'); if (s) s.value = ''; this.render(); }
};

const ControlPanel = {
  mounted: false,
  isMounted() { return this.mounted; },
  toggle() { this.mounted ? this.unmount() : this.mount(); },
  mount() {
    if (this.mounted) return;
    if (!License.canUseDisasters()) { ErrorMgr.dialog({ title: 'Доступ запрещён', icon: '🔒', message: 'Требуется администраторская лицензия.' }); return; }
    const panel = el('div', { id: 'controlPanel', style: { position: 'fixed', right: '8px', top: '8px', bottom: '56px', width: '300px', zIndex: '150', background: 'var(--panel)', backdropFilter: 'blur(24px)', border: '1px solid var(--border)', borderRadius: '12px', boxShadow: 'var(--shadow)', display: 'flex', flexDirection: 'column', overflow: 'hidden' } });
    const header = el('div', { style: { padding: '12px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: '8px' } }, [
      el('div', { style: { width: '10px', height: '10px', borderRadius: '50%', background: '#2ecc71' } }),
      el('h3', { style: { fontSize: '12.5px', fontWeight: '600', flex: '1' }, text: 'Панель сбоев' }),
      el('button', { text: '✕', style: { padding: '4px 10px', background: 'var(--input)', border: '1px solid var(--border)', borderRadius: '4px', cursor: 'pointer', fontSize: '11px' }, onclick: () => this.unmount() })
    ]);
    const body = el('div', { style: { flex: '1', overflowY: 'auto', padding: '10px' } });
    const incidents = [
      { id: 'cpuFire', em: '🔥', name: 'Пожар CPU' },
      { id: 'ramFill', em: '🧠', name: 'Заполнение ОЗУ' },
      { id: 'freeze', em: '🧊', name: 'Заморозка' },
      { id: 'netLoss', em: '🌐', name: 'Потеря сети' },
      { id: 'kernelCrash', em: '🧨', name: 'Сбой ядра' },
      { id: 'bootLoop', em: '🔄', name: 'Boot loop' }
    ];
    incidents.forEach(inc => {
      body.appendChild(el('button', { style: { display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 10px', borderRadius: '6px', background: 'rgba(128,128,128,.1)', border: '1px solid var(--border)', fontSize: '11.5px', cursor: 'pointer', width: '100%', textAlign: 'left', marginBottom: '4px' }, onclick: () => this.trigger(inc.id) }, [el('span', { style: { fontSize: '16px' }, text: inc.em }), el('span', { text: inc.name })]));
    });
    body.appendChild(el('button', { text: '✅ Нормализовать', style: { width: '100%', marginTop: '10px', padding: '8px', background: 'rgba(46,204,113,.15)', border: '1px solid rgba(46,204,113,.3)', color: '#2ecc71', borderRadius: '6px', cursor: 'pointer', fontSize: '11.5px' }, onclick: () => Notify.push('✅', 'Нормализовано', '✔') }));
    panel.append(header, body);
    document.body.appendChild(panel);
    this.mounted = true;
  },
  unmount() { const p = document.getElementById('controlPanel'); if (p) p.remove(); this.mounted = false; },
  trigger(id) {
    Notify.push('⚠️ Сбой', id, '⚠️');
    if (id === 'cpuFire') setTimeout(() => ErrorMgr.bsod('CRITICAL_PROCESSOR_HEAT'), 1500);
    else if (id === 'kernelCrash') setTimeout(() => ErrorMgr.bsod('KERNEL_SECURITY_CHECK_FAILURE'), 800);
    else if (id === 'bootLoop') setTimeout(() => ErrorMgr.bsod('BOOT_LOOP_DETECTED', { onComplete: () => location.reload() }), 2000);
  }
};

const LockScreen = {
  show() {
    let ls = $('#lockScreen');
    if (!ls) { ls = el('div', { id: 'lockScreen' }); document.body.appendChild(ls); }
    ls.classList.remove('hidden');
    ls.innerHTML = '';
    const user = Storage.get('user', { name: 'Пользователь' });
    const content = el('div', { style: { textAlign: 'center' } }, [
      el('div', { style: { fontSize: '96px', fontWeight: '200', letterSpacing: '-3px', lineHeight: '1' }, text: pad(new Date().getHours()) + ':' + pad(new Date().getMinutes()) }),
      el('div', { style: { fontSize: '18px', opacity: '.85', marginTop: '8px', marginBottom: '60px' }, text: new Date().toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' }) }),
      el('div', { style: { width: '92px', height: '92px', borderRadius: '50%', background: 'rgba(255,255,255,.15)', border: '2px solid rgba(255,255,255,.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '44px', margin: '0 auto 12px' }, text: (user.name || 'U')[0].toUpperCase() }),
      el('div', { style: { fontSize: '22px', marginBottom: '12px' }, text: user.name }),
      el('button', { text: 'Войти', style: { padding: '10px 34px', borderRadius: '22px', background: 'rgba(255,255,255,.16)', border: '1px solid rgba(255,255,255,.3)', color: '#fff', fontSize: '14px', cursor: 'pointer' }, onclick: () => { ls.style.opacity = '0'; setTimeout(() => { ls.classList.add('hidden'); ls.style.opacity = '1'; }, 350); AudioMgr.greet(); Boot.showDesktop(); } })
    ]);
    ls.appendChild(content);
  }
};

const OOBE = {
  step: 0, maxStep: 3, onDone: null, theme: 'dark',
  start(onDone) {
    this.onDone = onDone;
    let oobe = $('#oobe');
    if (!oobe) { oobe = el('div', { id: 'oobe' }); document.body.appendChild(oobe); }
    oobe.classList.remove('hidden');
    oobe.innerHTML = '';
    const dots = el('div', { style: { display: 'flex', gap: '8px', position: 'absolute', top: '24px', left: '50%', transform: 'translateX(-50%)' } });
    for (let i = 0; i <= this.maxStep; i++) dots.appendChild(el('div', { style: { width: '10px', height: '10px', borderRadius: '50%', background: i === 0 ? '#fff' : 'rgba(255,255,255,.25)', transform: i === 0 ? 'scale(1.25)' : 'scale(1)' } }));
    const screens = el('div', { style: { flex: '1', position: 'relative', padding: '40px 20px' } });
    const screensData = [
      { em: '💠', title: 'Добро пожаловать', desc: 'Настроим microOS за несколько шагов' },
      { em: '👤', title: 'Ваше имя', desc: 'Введите имя пользователя', form: 'name' },
      { em: '🎨', title: 'Тема', desc: 'Выберите тему оформления', form: 'theme' },
      { em: '🎉', title: 'Всё готово!', desc: 'microOS настроена' }
    ];
    screensData.forEach((s, i) => {
      const screen = el('div', { style: { position: 'absolute', inset: '40px 20px', display: i === 0 ? 'flex' : 'none', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center' }, 'data-step': i });
      screen.append(el('div', { style: { fontSize: '80px', marginBottom: '20px' }, text: s.em }), el('h1', { style: { fontSize: '32px', fontWeight: '300', marginBottom: '12px' }, text: s.title }), el('p', { style: { fontSize: '15px', opacity: '.85' }, text: s.desc }));
      if (s.form === 'name') screen.appendChild(el('input', { id: 'oobeName', value: 'Пользователь', placeholder: 'Имя', style: { marginTop: '20px', padding: '12px 18px', fontSize: '15px', borderRadius: '8px', background: 'rgba(255,255,255,.12)', border: '1px solid rgba(255,255,255,.25)', color: '#fff', width: '300px', textAlign: 'center' } }));
      if (s.form === 'theme') {
        const tg = el('div', { style: { display: 'flex', gap: '16px', marginTop: '20px' } });
        ['dark', 'light'].forEach(t => {
          const btn = el('button', { class: 'btn' + (this.theme === t ? '' : ' sec'), text: t === 'dark' ? '🌙 Тёмная' : '☀️ Светлая', onclick: () => { this.theme = t; Array.from(tg.children).forEach(b => b.classList.add('sec')); btn.classList.remove('sec'); } });
          tg.appendChild(btn);
        });
        screen.appendChild(tg);
      }
      screens.appendChild(screen);
    });
    const footer = el('div', { style: { padding: '20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '20px', borderTop: '1px solid rgba(255,255,255,.1)' } });
    const backBtn = el('button', { class: 'btn', text: '← Назад', style: { minWidth: '120px', background: 'rgba(255,255,255,.14)', border: '1px solid rgba(255,255,255,.25)', color: '#fff' }, onclick: () => { if (this.step > 0) this.goTo(this.step - 1, screens, dots, backBtn, nextBtn); } });
    const nextBtn = el('button', { class: 'btn', text: 'Далее →', style: { minWidth: '120px', background: '#0078d4', color: '#fff' }, onclick: () => { if (this.step === this.maxStep) this.launch(); else this.goTo(this.step + 1, screens, dots, backBtn, nextBtn); } });
    footer.append(backBtn, nextBtn);
    oobe.append(dots, screens, footer);
    this.step = 0; backBtn.disabled = true;
  },
  goTo(step, screens, dots, backBtn, nextBtn) {
    this.step = step;
    Array.from(screens.children).forEach((s, i) => s.style.display = i === step ? 'flex' : 'none');
    Array.from(dots.children).forEach((d, i) => { d.style.background = i === step ? '#fff' : i < step ? 'rgba(255,255,255,.6)' : 'rgba(255,255,255,.25)'; d.style.transform = i === step ? 'scale(1.25)' : 'scale(1)'; });
    backBtn.disabled = step === 0;
    nextBtn.textContent = step === this.maxStep ? 'Готово' : 'Далее →';
  },
  launch() {
    const name = $('#oobeName')?.value.trim() || 'Пользователь';
    Storage.set('installed', true);
    Storage.set('user', { name });
    Settings.set('theme', this.theme);
    $('#oobe').classList.add('hidden');
    if (this.onDone) this.onDone();
  }
};

const BootFlow = {
  async start(onComplete) {
    this.onComplete = onComplete;
    const activated = Storage.get('activated', false);
    const hasLicense = License.load();
    if (activated && hasLicense) this.showBootloader(() => { if (Storage.get('installed', false)) LockScreen.show(); else this.onComplete?.(); });
    else this.showBootloader(() => this.showKeyActivation());
  },
  showBootloader(onDone) {
    let boot = $('#bootloader');
    if (!boot) { boot = el('div', { id: 'bootloader' }); document.body.appendChild(boot); }
    boot.classList.remove('hidden');
    boot.innerHTML = '';
    const inner = el('div', { style: { textAlign: 'center', padding: '20px' } });
    const pb = el('div', { class: 'boot-progress' });
    const fill = el('div');
    pb.appendChild(fill);
    inner.append(el('div', { class: 'boot-title', text: 'microOSPASTON' }), el('div', { class: 'boot-version', text: 'v3.0.0 · build 2025.01.15' }), pb, el('div', { class: 'boot-status', text: 'Запуск операционной системы _' }));
    boot.appendChild(inner);
    AudioMgr.beep(880, 0.08, 'square', 0.04);
    let p = 0;
    const int = setInterval(() => { p += 2; if (p >= 100) { p = 100; clearInterval(int); fill.style.width = '100%'; setTimeout(() => { boot.classList.add('hidden'); onDone?.(); }, 250); } else fill.style.width = p + '%'; }, 30);
  },
  showKeyActivation() {
    let act = $('#activationFlow');
    if (!act) { act = el('div', { id: 'activationFlow' }); document.body.appendChild(act); }
    act.classList.remove('hidden');
    act.innerHTML = '';
    let firstLevel = null;

    const showKeyScreen = (phase) => {
      act.innerHTML = '';
      const screen = el('div', { style: { width: '100%', maxWidth: '560px', padding: '40px', textAlign: 'center' } }, [
        el('div', { style: { fontSize: '56px', marginBottom: '20px' }, text: '🔑' }),
        el('div', { style: { fontSize: '24px', fontWeight: '300', marginBottom: '12px', color: '#fff' }, text: phase === 'first' ? 'Активация microOSPASTON' : 'Повторная активация' }),
        el('div', { style: { fontSize: '14px', opacity: '.75', marginBottom: '28px' }, text: 'Введите ключ активации' }),
        (() => { const inp = el('input', { type: 'text', placeholder: 'Ключ активации', autocomplete: 'off', style: { width: '100%', padding: '14px 18px', fontFamily: 'Consolas, monospace', fontSize: '14px', background: '#181818', border: '2px solid #333', borderRadius: '8px', color: '#fff', outline: 'none', textAlign: 'center' } }); return inp; })(),
        (() => { const btn = el('button', { text: 'Активировать', style: { width: '100%', marginTop: '18px', padding: '13px', borderRadius: '8px', background: '#0078d4', color: '#fff', fontSize: '15px', fontWeight: '500', cursor: 'pointer', border: 'none' } }); return btn; })(),
        el('div', { style: { color: '#f48771', fontSize: '13px', minHeight: '20px', marginTop: '12px' } }),
        el('div', { style: { fontSize: '11px', color: '#555', marginTop: '20px', lineHeight: '1.6' } }, [el('div', { text: '👑 Админ: paykey1234567890adminopen' }), el('div', { text: '🏠 Home: paykey1234567890homeopen' })])
      ]);
      act.appendChild(screen);
      const input = screen.querySelector('input');
      const btn = screen.querySelector('button');
      const err = screen.querySelector('div[style*="f48771"]');
      const submit = () => {
        const val = input.value.trim();
        if (!val) { err.textContent = 'Введите ключ'; return; }
        const level = getKeyLevel(val);
        if (!level) { err.textContent = 'Неверный ключ'; input.style.borderColor = '#e74c3c'; setTimeout(() => input.style.borderColor = '#333', 500); AudioMgr.error(); input.select(); return; }
        if (phase === 'second' && level !== firstLevel) { err.textContent = 'Ключ не совпадает с ранее введённым'; AudioMgr.error(); return; }
        AudioMgr.beep(880, 0.1, 'sine', 0.06);
        btn.disabled = true; input.disabled = true;
        if (phase === 'first') { firstLevel = level; showVerify(); } else showVersionSelect(level);
      };
      btn.addEventListener('click', submit);
      input.addEventListener('keydown', e => { if (e.key === 'Enter') submit(); });
      setTimeout(() => input.focus(), 200);
    };

    const showVerify = () => {
      act.innerHTML = '';
      const screen = el('div', { style: { width: '100%', maxWidth: '520px', padding: '40px', textAlign: 'center' } });
      const pb = el('div', { style: { width: '100%', height: '6px', background: '#1a1a1a', borderRadius: '3px', overflow: 'hidden', marginBottom: '16px' } });
      const fill = el('div', { style: { height: '100%', width: '0', background: 'linear-gradient(90deg,#0078d4,#4aa3ff)', transition: 'width .15s linear' } });
      pb.appendChild(fill);
      const pct = el('div', { style: { fontSize: '12px', color: '#888', marginBottom: '8px' }, text: '0%' });
      const msg = el('div', { style: { fontSize: '13px', color: '#aaa' }, text: 'Соединение с сервером…' });
      screen.append(el('div', { style: { fontSize: '72px', marginBottom: '20px' }, text: '🛡️' }), el('div', { style: { fontSize: '20px', fontWeight: '300', marginBottom: '24px' }, text: 'Проверка ключа…' }), pb, pct, msg);
      act.appendChild(screen);
      const messages = ['Соединение с сервером…', 'Проверка подписи…', 'Верификация лицензии…', 'Готово'];
      const start = Date.now(); let mi = 0;
      const int = setInterval(() => {
        const p = Math.min(100, (Date.now() - start) / 5000 * 100);
        fill.style.width = p + '%'; pct.textContent = Math.floor(p) + '%';
        const ni = Math.min(messages.length - 1, Math.floor(p / 100 * messages.length));
        if (ni !== mi) { mi = ni; msg.textContent = messages[ni]; }
        if (p >= 100) { clearInterval(int); msg.textContent = '✓ Ключ подтверждён'; msg.style.color = '#2ecc71'; setTimeout(showShutdown, 800); }
      }, 50);
    };

    const showShutdown = () => {
      act.innerHTML = '';
      const style = el('style', { text: '@keyframes spin{to{transform:rotate(360deg)}}' });
      document.head.appendChild(style);
      const screen = el('div', { style: { position: 'fixed', inset: '0', background: '#000', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '20px', color: '#fff' } }, [
        el('div', { style: { width: '28px', height: '28px', border: '2px solid rgba(255,255,255,.2)', borderTopColor: '#fff', borderRadius: '50%', animation: 'spin 1s linear infinite' } }),
        el('div', { style: { fontSize: '20px', fontWeight: '300' }, text: 'Завершение работы…' })
      ]);
      act.appendChild(screen);
      setTimeout(() => { act.innerHTML = ''; act.appendChild(el('div', { style: { width: '100%', height: '100%', background: '#000' } })); setTimeout(showGreeting, 1000); }, 2000);
    };

    const showGreeting = () => {
      act.innerHTML = '';
      const screen = el('div', { style: { width: '100%', maxWidth: '600px', padding: '40px', textAlign: 'center' } }, [
        el('div', { style: { fontSize: '48px', fontWeight: '300', marginBottom: '16px', background: 'linear-gradient(135deg,#4aa3ff,#a06bff,#ff6b9d)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }, text: 'Добрый день!' }),
        el('div', { style: { fontSize: '16px', opacity: '.8', marginBottom: '40px' }, text: 'Добро пожаловать в microOS' })
      ]);
      act.appendChild(screen);
      setTimeout(() => {
        const hint = el('div', { style: { fontSize: '14px', opacity: '.6', marginBottom: '20px' }, text: 'Пожалуйста, введите ключ для продолжения' });
        const input = el('input', { type: 'text', placeholder: 'Ключ', style: { width: '100%', padding: '14px 18px', fontFamily: 'Consolas, monospace', fontSize: '14px', background: '#181818', border: '2px solid #333', borderRadius: '8px', color: '#fff', outline: 'none', textAlign: 'center' } });
        const btn = el('button', { text: 'Активировать', style: { width: '100%', marginTop: '18px', padding: '13px', borderRadius: '8px', background: '#0078d4', color: '#fff', fontSize: '15px', fontWeight: '500', cursor: 'pointer', border: 'none' } });
        const err = el('div', { style: { color: '#f48771', fontSize: '13px', minHeight: '20px', marginTop: '12px' } });
        screen.append(hint, input, btn, err);
        const submit = () => {
          const val = input.value.trim();
          const level = getKeyLevel(val);
          if (!level) { err.textContent = 'Неверный ключ'; AudioMgr.error(); return; }
          if (level !== firstLevel) { err.textContent = 'Ключ не совпадает с ранее введённым'; AudioMgr.error(); return; }
          AudioMgr.beep(880, 0.1, 'sine', 0.06);
          License.activate(level, level === 'admin' ? ACTIVATION_KEYS.admin : ACTIVATION_KEYS.home);
          showVersionSelect(level);
        };
        btn.addEventListener('click', submit);
        input.addEventListener('keydown', e => { if (e.key === 'Enter') submit(); });
        setTimeout(() => input.focus(), 100);
      }, 800);
    };

    const showVersionSelect = (level) => {
      License.activate(level, level === 'admin' ? ACTIVATION_KEYS.admin : ACTIVATION_KEYS.home);
      act.innerHTML = '';
      const screen = el('div', { style: { width: '100%', height: '100%', display: 'flex', flexDirection: 'column', padding: '20px', overflowY: 'auto', background: '#0d0d0d', color: '#fff' } });
      const header = el('div', { style: { textAlign: 'center', padding: '20px 0' } }, [
        el('div', { style: { fontSize: '14px', color: '#7cc4ff', marginBottom: '8px' }, text: 'ШАГ 1 ИЗ 2' }),
        el('div', { style: { fontSize: '30px', fontWeight: '300', marginBottom: '10px' }, text: 'Выберите версию microOS' }),
        el('div', { style: { display: 'inline-block', padding: '6px 14px', borderRadius: '20px', fontSize: '12px', marginBottom: '16px', background: License.isAdmin() ? 'rgba(255,215,0,.2)' : 'rgba(160,160,160,.2)', border: '1px solid ' + (License.isAdmin() ? '#ffd700' : '#999') }, text: `${License.getIcon()} Лицензия: ${License.getLabel()}` })
      ]);
      screen.appendChild(header);
      const tabs = el('div', { style: { display: 'flex', gap: '8px', justifyContent: 'center', marginBottom: '24px', flexWrap: 'wrap' } });
      let currentLine = 10;
      const grid = el('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: '14px', maxWidth: '1400px', margin: '0 auto', width: '100%', padding: '0 10px 20px' } });
      let selectedId = License.canUseVersion(Version.getId()) ? Version.getId() : License.allowedVersions()[0];
      const renderGrid = () => {
        grid.innerHTML = '';
        VERSIONS.filter(v => v.line === currentLine).forEach(v => {
          const can = License.canUseVersion(v.id);
          const selected = v.id === selectedId;
          const card = el('div', { style: { background: 'rgba(255,255,255,.06)', border: '2px solid ' + (selected ? '#4aa3ff' : 'rgba(255,255,255,.15)'), borderRadius: '12px', padding: '16px', cursor: 'pointer', position: 'relative', display: 'flex', flexDirection: 'column', gap: '8px', transition: 'all .2s', opacity: can ? '1' : '.4' }, onclick: () => { if (!can) { ErrorMgr.dialog({ title: 'Заблокировано', icon: '🔒', message: 'Эта версия требует Pro-лицензию или админ-ключ.', detail: 'Введите paykey1234567890adminopen для доступа.' }); return; } selectedId = v.id; renderGrid(); nextBtn.textContent = 'Выбрать: ' + v.name; } });
          if (!can) card.appendChild(el('div', { style: { position: 'absolute', top: '12px', right: '12px', fontSize: '20px' }, text: '🔒' }));
          const preview = el('div', { style: { height: '110px', borderRadius: '8px', position: 'relative', overflow: 'hidden', border: '1px solid', background: v.accent + '15', borderColor: v.accent + '40' } });
          preview.append(el('div', { style: { position: 'absolute', left: '0', right: '0', bottom: '0', height: '16px', background: v.accent + '30', borderTop: '1px solid ' + v.accent + '50' } }), el('div', { style: { position: 'absolute', top: '22px', left: '20px', right: '20px', bottom: '26px', background: v.accent + '20', border: '1px solid ' + v.accent + '40', borderRadius: '4px' } }));
          card.appendChild(preview);
          card.append(el('div', { style: { fontSize: '14px', fontWeight: '600' }, text: v.name }), el('div', { style: { fontSize: '10.5px', color: '#7cc4ff', textTransform: 'uppercase' }, text: v.model }), el('div', { style: { fontSize: '11px', opacity: '.7', lineHeight: '1.4', minHeight: '30px' }, text: v.description }));
          const tags = el('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '4px' } });
          v.tags.forEach(t => tags.appendChild(el('span', { style: { fontSize: '9.5px', padding: '2px 6px', borderRadius: '4px', fontWeight: '600', background: v.accent + '25', color: v.accent }, text: t })));
          card.appendChild(tags);
          if (selected && can) card.appendChild(el('div', { style: { position: 'absolute', top: '8px', right: '8px', width: '22px', height: '22px', borderRadius: '50%', background: '#4aa3ff', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: '700' }, text: '✓' }));
          grid.appendChild(card);
        });
      };
      [10, 11].forEach(ln => {
        const tab = el('button', { text: ln === 10 ? '🪟 microOS 10' : '✨ microOS 11', style: { padding: '10px 20px', borderRadius: '8px', fontSize: '13px', cursor: 'pointer', border: '1px solid rgba(255,255,255,.2)', background: ln === currentLine ? 'rgba(74,163,255,.25)' : 'rgba(255,255,255,.06)', color: '#fff' }, onclick: () => { currentLine = ln; Array.from(tabs.children).forEach((x, i) => x.style.background = (i === 0 ? 10 : 11) === ln ? 'rgba(74,163,255,.25)' : 'rgba(255,255,255,.06)'); renderGrid(); } });
        tabs.appendChild(tab);
      });
      screen.append(tabs, grid);
      const footer = el('div', { style: { display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: '16px', padding: '20px', borderTop: '1px solid rgba(255,255,255,.1)', maxWidth: '1400px', margin: 'auto auto 0', width: '100%' } });
      const nextBtn = el('button', { text: 'Выбрать: ' + (VERSIONS.find(x => x.id === selectedId)?.name || 'microOS'), style: { padding: '10px 24px', borderRadius: '8px', border: 'none', background: '#0078d4', color: '#fff', fontSize: '14px', fontWeight: '500', cursor: 'pointer' }, onclick: () => { Version.set(selectedId); Storage.set('version', selectedId); Storage.set('activated', true); act.classList.add('hidden'); if (!Storage.get('installed', false)) OOBE.start(() => this.onComplete?.()); else this.onComplete?.(); } });
      footer.appendChild(nextBtn);
      screen.appendChild(footer);
      act.appendChild(screen);
      renderGrid();
    };

    showKeyScreen('first');
  }
};

const Boot = {
  async init() {
    document.documentElement.dataset.theme = 'dark';
    Settings.load();
    Version.load();
    Settings.apply();
    await DB.init().catch(e => console.warn('DB:', e));
    Desktop.render();
    Taskbar.render();
    StartMenu.init();
    this.initInstaller();
    this.updateClock();
    setInterval(() => this.updateClock(), 1000);
    await this.loadApps();
    this.initKeyboard();
    BootFlow.start(() => { this.showDesktop(); Notify.push('microOS', 'Добро пожаловать! ' + License.getLabel(), License.getIcon()); });
  },
  async loadApps() {
    try {
      const apps = await DB.getAllApps();
      apps.forEach(app => this.registerInstalledApp(app.id, app, true));
    } catch (e) { console.warn(e); }
  },
  registerInstalledApp(appId, app, skipUI) {
    const id = 'inst_' + appId;
    if (Apps.get(id)) return;
    Apps.register({ id, name: app.name, icon: app.icon, pinned: false, open() { VM.open(id); } });
    if (!skipUI) { Desktop.render(); StartMenu.render(); Taskbar.render(); }
  },
  async uninstallApp(appId) {
    try {
      const numericId = String(appId).startsWith('inst_') ? parseInt(appId.slice(5), 10) : appId;
      const app = await DB.getApp(numericId);
      if (app) { if (app.fileId) await DB.deleteFile(app.fileId).catch(() => {}); await DB.deleteApp(numericId); }
      try { delete Apps.registry[appId]; } catch {}
      await AppData.deleteAll(numericId).catch(() => {});
      const win = WM.findApp('vm_' + appId);
      if (win) WM.close(win.id);
      Desktop.render(); StartMenu.render(); Taskbar.render();
      Notify.push('🗑 Удалено', app ? app.name : appId, '🗑');
    } catch (e) { console.error(e); }
  },
  initInstaller() {
    const btn = $('#trayInstall');
    if (btn) {
      const input = el('input', { type: 'file', style: { display: 'none' } });
      document.body.appendChild(input);
      btn.addEventListener('click', () => { input.value = ''; input.click(); });
      input.addEventListener('change', async () => { const f = input.files[0]; if (!f) return; try { await Installer.start(f); } catch (e) { ErrorMgr.dialog({ title: 'Ошибка', icon: '❌', message: e.message }); } });
    }
    document.addEventListener('dragover', e => e.preventDefault());
    document.addEventListener('drop', async e => { e.preventDefault(); const files = e.dataTransfer?.files; if (!files) return; for (const f of files) { try { await Installer.start(f); } catch (err) { console.error(err); } } });
  },
  initKeyboard() {
    document.addEventListener('keydown', e => {
      if (e.altKey && e.key === 'Tab') { e.preventDefault(); const list = WM.wins.filter(w => !w.minimized); if (list.length) { const cur = list.findIndex(w => w.id === WM.activeId); WM.focus(list[(cur + 1) % list.length].id); } }
      if (e.key === 'Escape') StartMenu.close();
    });
  },
  updateClock() {
    const now = new Date();
    const cl = $('#trayClock');
    if (cl) { cl.querySelector('.t').textContent = pad(now.getHours()) + ':' + pad(now.getMinutes()); cl.querySelector('.d').textContent = pad(now.getDate()) + '.' + pad(now.getMonth() + 1) + '.' + now.getFullYear(); }
  },
  showDesktop() { SystemState.start(); Desktop.render(); Taskbar.render(); StartMenu.render(); }
};

const buildShell = () => {
  document.body.append(
    el('div', { id: 'wallpaper' }),
    el('div', { id: 'desktop' }, [el('div', { id: 'icons' })]),
    el('div', { id: 'windowLayer' }),
    el('div', { id: 'notifications' }),
    el('div', { id: 'taskbar' }, [
      el('div', { id: 'tbCenter' }),
      el('div', { id: 'tbTray' }, [
        el('button', { class: 'tray-btn install-btn', id: 'trayInstall', text: '📥 Установить' }),
        el('button', { class: 'tray-btn', text: '📶' }),
        el('button', { class: 'tray-btn', text: '🔊' }),
        el('button', { class: 'tray-btn', id: 'trayClock' }, [el('span', { class: 't' }), el('span', { class: 'd' })])
      ])
    ]),
    el('div', { class: 'panel closed', id: 'startMenu' }, [
      el('div', { class: 'sm-search' }, [el('input', { type: 'text', id: 'smSearch', placeholder: '🔍 Поиск приложений' })]),
      el('div', { class: 'sm-scroll' }, [
        el('div', { class: 'sm-h', text: 'Закреплённые' }),
        el('div', { class: 'sm-grid', id: 'smPinned' }),
        el('div', { class: 'sm-h', text: 'Установленные' }),
        el('div', { class: 'sm-list', id: 'smInstalled' }),
        el('div', { class: 'sm-h', text: 'Все приложения' }),
        el('div', { class: 'sm-list', id: 'smAll' })
      ]),
      el('div', { class: 'sm-footer' }, [
        el('div', { class: 'sm-user' }, [el('div', { class: 'sm-avatar', text: 'U' }), el('span', { text: 'Пользователь' })]),
        el('button', { class: 'sm-power', id: 'smPower', text: '⏻' })
      ])
    ]),
    el('div', { id: 'bsod', class: 'hidden' })
  );
};

buildShell();
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => Boot.init());
else Boot.init();
