import { createClient } from './vendor/supabase.js';
import { SUPABASE_URL, SUPABASE_KEY, VAPID_PUBLIC_KEY, APP_VERSION } from './config.js';
import * as Anilar from './anilar.js';
import * as Sohbet from './sohbet.js';
import * as Oyunlar from './oyunlar.js';
import { ensureDevice } from './e2e.js';

// İstekler asılı kalmasın: iPhone ağ değiştirince (Wi-Fi ↔ mobil) bazen cevap hiç gelmiyor, uygulama donuyordu.
// Her istek en fazla 15 sn bekler (dosya yüklemeleri 120 sn).
function fetchWithTimeout(input, init = {}) {
  const url = typeof input === 'string' ? input : input?.url || '';
  const ms = /\/storage\/v1\/object\/(?!sign)/.test(url) && (init.method || 'GET') !== 'GET' ? 120000 : 15000;
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  if (init.signal) { if (init.signal.aborted) ctl.abort(); else init.signal.addEventListener('abort', () => ctl.abort(), { once: true }); }
  return fetch(input, { ...init, signal: ctl.signal }).finally(() => clearTimeout(t));
}
export const sb = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
  global: { fetch: fetchWithTimeout },
});

// ------------------------------------------------------------------ tema (açık / koyu)
const THEME_KEY = 'tayfa-tema';
function applyTheme(t) {
  const dark = t === 'koyu';
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#0F1A24' : '#F4F1EC');
}
const getTheme = () => { try { return localStorage.getItem(THEME_KEY) || 'acik'; } catch (_) { return 'acik'; } };
applyTheme(getTheme());

// ------------------------------------------------------------------ yardımcılar
const $app = document.getElementById('app');
const $sheet = document.getElementById('sheet-root');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;

const ICON = {
  home: '<path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10"/><path d="M10 20v-6h4v6"/>',
  memory: '<path d="M12 21s-7-6.5-7-12a7 7 0 0 1 14 0c0 5.5-7 12-7 12z"/><circle cx="12" cy="9" r="2.5"/>',
  chat: '<path d="M4 5h16v11H9l-5 4z"/>',
  game: '<rect x="4" y="4" width="16" height="16" rx="3"/><circle cx="9" cy="9" r="1"/><circle cx="15" cy="9" r="1"/><circle cx="9" cy="15" r="1"/><circle cx="15" cy="15" r="1"/>',
  bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10 21h4"/>',
  shield: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  pin: '<path d="M12 21s-7-6.5-7-12a7 7 0 0 1 14 0c0 5.5-7 12-7 12z"/><circle cx="12" cy="9" r="2.5"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  back: '<path d="M15 18l-6-6 6-6"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/>',
  share: '<path d="M12 3v13M7 8l5-5 5 5"/><path d="M5 13v6a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-6"/>',
  cal: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  lock: '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>',
  send: '<path d="M4 12l16-8-6 16-3-7z"/>',
  play: '<path d="M7 5l12 7-12 7z"/>',
  pause: '<path d="M8 5v14M16 5v14"/>',
  img: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 16l5-5 4 4 3-3 6 6"/><circle cx="15.5" cy="8.5" r="1.5"/>',
  upload: '<path d="M12 16V4M7 9l5-5 5 5"/><path d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3"/>',
  heart: '<path d="M12 20s-7-4.5-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.5-7 10-7 10z"/>',
  comment: '<path d="M4 5h16v11H9l-5 4z"/><path d="M8 9h8M8 12h5"/>',
  map: '<path d="M9 4l-6 2v14l6-2 6 2 6-2V4l-6 2z"/><path d="M9 4v14M15 6v14"/>',
  grid: '<rect x="4" y="4" width="7" height="7" rx="1"/><rect x="13" y="4" width="7" height="7" rx="1"/><rect x="4" y="13" width="7" height="7" rx="1"/><rect x="13" y="13" width="7" height="7" rx="1"/>',
  dots: '<circle cx="5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="19" cy="12" r="1.3"/>',
  reply: '<path d="M9 14L4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 6 6v3"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  chev: '<path d="M9 6l6 6-6 6"/>',
  trophy: '<path d="M8 4h8v5a4 4 0 0 1-8 0z"/><path d="M8 6H5a3 3 0 0 0 3 4M16 6h3a3 3 0 0 1-3 4M12 13v4M8 20h8"/>',
  check: '<path d="M5 12l5 5L20 7"/>',
  headset: '<path d="M4 14v-2a8 8 0 0 1 16 0v2"/><rect x="3" y="14" width="4" height="6" rx="1.5"/><rect x="17" y="14" width="4" height="6" rx="1.5"/>',
  micOff: '<path d="M9 9v2a3 3 0 0 0 5.1 2.1M15 9.3V6a3 3 0 0 0-5.9-.7"/><path d="M5 11a7 7 0 0 0 11.3 5.5M19 11a7 7 0 0 1-.6 2.8M12 18v3M3 3l18 18"/>',
  phoneOff: '<path d="M3 15.5c5-4 13-4 18 0l-2 3-3.5-1.2v-2.6a10 10 0 0 0-7 0v2.6L5 18.5z"/>',
  pinIt: '<path d="M9 4h6l-1 6 3 3H7l3-3z"/><path d="M12 13v7"/>',
  again: '<path d="M4 12a8 8 0 0 1 14-5.3L20 9"/><path d="M20 4v5h-5"/><path d="M20 12a8 8 0 0 1-14 5.3L4 15"/><path d="M4 20v-5h5"/>',
  dice: '<rect x="4" y="4" width="16" height="16" rx="4"/><circle cx="9" cy="9" r="1.2" fill="currentColor"/><circle cx="15" cy="15" r="1.2" fill="currentColor"/><circle cx="12" cy="12" r="1.2" fill="currentColor"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  cloud: '<path d="M7 18h10a4 4 0 0 0 0-8 5.5 5.5 0 0 0-10.6 1.7A3.2 3.2 0 0 0 7 18z"/>',
  cloudSun: '<circle cx="8" cy="8" r="3"/><path d="M8 2v1.5M2 8h1.5M3.8 3.8l1 1M12.2 3.8l-1 1"/><path d="M9 20h8a4 4 0 0 0 0-8 5 5 0 0 0-9.6 1.6A3.2 3.2 0 0 0 9 20z"/>',
  rain: '<path d="M7 15h10a4 4 0 0 0 0-8 5.5 5.5 0 0 0-10.6 1.7A3.2 3.2 0 0 0 7 15z"/><path d="M9 18l-1 2M13 18l-1 2M17 18l-1 2"/>',
  snow: '<path d="M7 15h10a4 4 0 0 0 0-8 5.5 5.5 0 0 0-10.6 1.7A3.2 3.2 0 0 0 7 15z"/><path d="M9 19h.01M13 19h.01M17 19h.01M11 21h.01M15 21h.01"/>',
  storm: '<path d="M7 15h10a4 4 0 0 0 0-8 5.5 5.5 0 0 0-10.6 1.7A3.2 3.2 0 0 0 7 15z"/><path d="M12 15l-2 4h3l-2 3"/>',
  fog: '<path d="M4 10h16M6 14h12M8 18h8"/>',
  muted: '<path d="M11 5L6 9H3v6h3l5 4z"/><path d="M22 9l-6 6M16 9l6 6"/>',
  sound: '<path d="M11 5L6 9H3v6h3l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13"/>',
  tavla: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M6 4l1.5 6L9 4M10.5 4l1.5 6 1.5-6M15 4l1.5 6L18 4M6 20l1.5-6L9 20M10.5 20l1.5-6 1.5 6M15 20l1.5-6 1.5 6"/>',
  spade: '<path d="M12 3c3 4 7 6.5 7 10a4 4 0 0 1-6.3 3.3L14 21h-4l1.3-4.7A4 4 0 0 1 5 13c0-3.5 4-6 7-10z"/>',
  crown: '<path d="M3 8l4.5 4L12 5l4.5 7L21 8l-2 10H5z"/><path d="M5 21h14"/>',
  tile: '<rect x="6" y="3" width="12" height="18" rx="2.5"/><path d="M10.5 9.5c0-1 .7-1.7 1.6-1.7s1.6.7 1.6 1.6c0 1.6-3.2 2.4-3.2 4.6h3.3"/><circle cx="12" cy="17.5" r="1" fill="currentColor"/>',
};
const svg = (n, extra = '') => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" ${extra}>${ICON[n]}</svg>`;

const AV_COLORS = [['#F3D9CC', '#7A2E14'], ['#D9E7F5', '#1D4E7A'], ['#DDEFD9', '#2E5E1F'], ['#EDE1F5', '#5A2E7A'], ['#F5EBCF', '#6B4A00'], ['#D7EEEC', '#155E58']];
function avatar(name, id = '', cls = '') {
  let h = 0; for (const ch of String(id || name)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const [bg, fg] = AV_COLORS[h % AV_COLORS.length];
  const ini = String(name || '?').trim().charAt(0).toLocaleUpperCase('tr-TR');
  return `<span class="av ${cls}" style="background:${bg};color:${fg}" title="${esc(name)}">${esc(ini)}</span>`;
}

function toast(msg, ms = 2600) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.classList.add('show');
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('show'), ms);
}
function errText(e) {
  const m = String(e?.message || e || 'Bir hata oluştu');
  const i = m.indexOf('TAYFA: ');
  if (i >= 0) return m.slice(i + 7);
  if (/Invalid login credentials/i.test(m)) return 'E-posta ya da şifre hatalı.';
  if (/already registered|already exists/i.test(m)) return 'Bu e-posta ile zaten bir hesap var.';
  if (/Password should be at least/i.test(m)) return 'Şifre en az 8 karakter olmalı.';
  if (/Email not confirmed/i.test(m)) return 'E-posta adresi henüz onaylanmamış.';
  if (/Failed to fetch|NetworkError|Load failed/i.test(m)) return 'İnternet bağlantısı yok gibi görünüyor.';
  return m;
}
async function rpc(name, args) {
  const { data, error } = await sb.rpc(name, args);
  if (error) throw error;
  return data;
}

const TZ = 'Europe/Istanbul';
const fmt = {
  day: (d) => new Intl.DateTimeFormat('tr-TR', { day: '2-digit', timeZone: TZ }).format(d),
  wd: (d) => new Intl.DateTimeFormat('tr-TR', { weekday: 'short', timeZone: TZ }).format(d).toLocaleUpperCase('tr-TR').replace('.', ''),
  time: (d) => new Intl.DateTimeFormat('tr-TR', { hour: '2-digit', minute: '2-digit', timeZone: TZ }).format(d),
  long: (d) => new Intl.DateTimeFormat('tr-TR', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', timeZone: TZ }).format(d),
  short: (d) => new Intl.DateTimeFormat('tr-TR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: TZ }).format(d),
};

// ------------------------------------------------------------------ durum
const S = {
  session: null,
  ctx: {},            // my_context
  tab: 'home',
  view: 'main',       // main | admin
  events: [],
  rsvps: [],
  members: [],
  invites: [],
  authMode: 'login',
  setupNeeded: false,
  lastInvite: null,
};
let channel = null;

// ------------------------------------------------------------------ servis çalışanı ve bildirimler
let swReg = null;
async function registerSW() {
  if (!('serviceWorker' in navigator)) return;
  try { swReg = await navigator.serviceWorker.register('sw.js'); } catch (e) { console.warn(e); }
}

// Yeni sürüm gelince uygulamayı yenile (yazı yazılırken ya da oyun oynanırken değil, uygun anda)
let hadController = !!navigator.serviceWorker?.controller;
let pendingReload = false;
const safeToReload = () => {
  const a = document.activeElement;
  const typing = a && (a.tagName === 'TEXTAREA' || a.tagName === 'INPUT') && a.value;
  return !typing && !document.getElementById('sb') && S.view !== 'game';
};
navigator.serviceWorker?.addEventListener('controllerchange', () => {
  if (!hadController) { hadController = true; return; }
  if (safeToReload()) location.reload(); else pendingReload = true;
});

// Bildirime dokununca gidilecek yer (servis çalışanı kaydeder). iPhone'da mesaj bazen geç gelir;
// uygulama uyanınca birkaç kez bakılır, yönlendirme başarılı olunca kayıt silinir.
async function readNote(key) {
  try {
    const c = await caches.open('tayfa-yonlendirme');
    const r = await c.match(key);
    if (!r) return null;
    const t = await r.text();
    try { return JSON.parse(t); } catch (_) { return { url: t, at: Date.now() }; }
  } catch (_) { return null; }
}
async function checkPendingRoute() {
  const p = await readNote('pending');
  if (!p?.url) return;
  if (Date.now() - (p.at || 0) > 3 * 60 * 1000) { caches.open('tayfa-yonlendirme').then((c) => c.delete('pending')).catch(() => {}); return; }
  try {
    if (route(new URL(p.url).hash || '#ana') !== false) await (await caches.open('tayfa-yonlendirme')).delete('pending');
  } catch (_) { /* */ }
}
function checkPendingSoon() {
  [0, 600, 1500, 3000].forEach((ms) => setTimeout(checkPendingRoute, ms));
}

// ------------------------------------------------------------------ bildirim kutusu
async function loadInbox() {
  if (S.ctx.status !== 'active') return;
  const { data, error } = await sb.from('inbox').select('*').eq('user_id', me()).order('created_at', { ascending: false }).limit(80);
  if (error) throw error;
  const dayAgo = Date.now() - 864e5;
  S.inbox = (data || []).filter((i) => new Date(i.created_at).getTime() > dayAgo);
  S.inboxUnread = S.inbox.filter((i) => !i.read_at).length;
  updateBell();
}
function updateBell() {
  const b = document.getElementById('h-bell'); if (!b) return;
  const n = S.inboxUnread || 0;
  b.querySelector('.n')?.remove();
  b.querySelector('.dot')?.remove();
  if (n) b.insertAdjacentHTML('beforeend', `<span class="n">${n > 9 ? '9+' : n}</span>`);
  else if (pushState() !== 'granted') b.insertAdjacentHTML('beforeend', '<span class="dot"></span>');
  b.setAttribute('aria-label', n ? `Bildirimler, ${n} okunmamış` : 'Bildirimler');
}
const kindOf = (i) => {
  const t = i.tag || '', u = i.url || '';
  if (/^king-/.test(t)) return ['game', 'crown'];
  if (/^(tavla|oyun-sohbet)-/.test(t) || u.includes('#oyun')) return ['game', 'dice'];
  if (/^(bahis|sohbet)-/.test(t) || u.includes('#sohbet')) return ['chat', 'chat'];
  if (/^(plan|onay|yorum)-/.test(t) || u.includes('#plan') || u.includes('#yonetim')) return ['plan', 'cal'];
  if (/^(album|tek)-/.test(t) || u.includes('#album') || u.includes('#anilar') || u.includes('#yeni')) return ['photo', 'img'];
  return ['other', 'bell'];
};
async function openInboxItem(i) {
  if (!i.read_at) {
    i.read_at = new Date().toISOString();
    S.inboxUnread = Math.max(0, (S.inboxUnread || 1) - 1);
    rpc('mark_inbox_read', { p_id: i.id }).catch(() => {});
  }
  let h = ''; try { h = new URL(i.url || './', location.href).hash; } catch (_) { /* */ }
  if (!h || route(h) === false) goMain('home');
}
function inboxDay(d) {
  const k = (x) => new Intl.DateTimeFormat('tr-TR', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: TZ }).format(x);
  const now = new Date();
  if (k(d) === k(now)) return 'BUGÜN';
  if (k(d) === k(new Date(now.getTime() - 864e5))) return 'DÜN';
  return new Intl.DateTimeFormat('tr-TR', { day: 'numeric', month: 'long', timeZone: TZ }).format(d).toLocaleUpperCase('tr-TR');
}
function ago(d) {
  const s = (Date.now() - d.getTime()) / 1000;
  if (s < 60) return 'şimdi';
  if (s < 3600) return Math.floor(s / 60) + ' dk';
  if (s < 86400) return Math.floor(s / 3600) + ' sa';
  return fmt.time(d);
}
function renderInbox() {
  const dayAgo = Date.now() - 864e5; // bildirimler 1 gün saklanır
  const list = (S.inbox || []).filter((i) => new Date(i.created_at).getTime() > dayAgo);
  let body = ''; let day = '';
  let group = [];
  const flush = () => { if (group.length) body += `<div class="inbox">${group.join('')}</div>`; group = []; };
  list.forEach((i, idx) => {
    const d = new Date(i.created_at); const dk = inboxDay(d);
    if (dk !== day) { flush(); body += `<p class="inbox-day">${dk}</p>`; day = dk; }
    const [cls, ic] = kindOf(i);
    group.push(`<button class="ib ${i.read_at ? '' : 'new'}" data-ib="${idx}"><span class="ic ${cls}">${svg(ic)}</span>
      <span class="grow"><b>${esc(i.title)}</b><span>${esc(i.body)}</span></span>
      <span class="side">${esc(ago(d))}${i.read_at ? '' : '<i></i>'}</span></button>`);
  });
  flush();
  $app.innerHTML = `<div class="screen enter"><main class="content no-tabs">
    <div class="g-top"><button class="icon-btn" id="ib-back" aria-label="Geri">${svg('back')}</button>
      <div class="grow"><h1 style="font-size:22px">Bildirimler</h1></div>
      ${S.inboxUnread ? '<button class="btn small" id="ib-all" style="border:none;background:none;color:var(--accent)">Tümü okundu</button>' : ''}</div>
    ${list.length ? body : `<div class="card"><div class="empty">${svg('bell')}<b style="color:var(--ink)">Bildirim yok</b><span>Yeni etkinlikler, oyun davetleri ve sana gelen yanıtlar burada görünür. Bildirimler 1 gün saklanır.</span></div></div>`}
    <p class="small" style="text-align:center">Son 30 günün bildirimleri burada durur</p>
  </main></div>`;
  document.getElementById('ib-back').onclick = () => goBack();
  document.getElementById('ib-all')?.addEventListener('click', async () => {
    try { await rpc('mark_inbox_read', { p_id: null }); } catch (e) { toast(errText(e)); }
    (S.inbox || []).forEach((i) => { i.read_at = i.read_at || new Date().toISOString(); });
    S.inboxUnread = 0; renderInbox();
  });
  $app.querySelectorAll('[data-ib]').forEach((b) => b.onclick = () => openInboxItem(list[+b.dataset.ib]));
}

// Uygulama açıkken gelen bildirim: üstte şerit
function atTarget(url) {
  let h = ''; try { h = new URL(url || './', location.href).hash; } catch (_) { /* */ }
  const [k, id] = h.replace(/^#/, '').split('/');
  if (k === 'oyun') return S.view === 'game' && S.gameId === id;
  if (k === 'sohbet') return S.view === 'main' && S.tab === 'chat';
  if (k === 'yonetim') return S.view === 'admin';
  return false;
}
function showInApp(i) {
  if (document.visibilityState !== 'visible' || atTarget(i.url)) return;
  if (pushState() === 'granted') return; // telefon bildirimi zaten geliyor, ikinci kez gösterme
  document.querySelector('.inapp')?.remove();
  const [, ic] = kindOf(i);
  const el = document.createElement('button');
  el.className = 'inapp';
  el.innerHTML = `<span class="ic">${svg(ic)}</span><span class="grow"><b>${esc(i.title)}</b><span>${esc(i.body)}</span></span><span class="go">Git</span>`;
  el.onclick = () => { el.remove(); openInboxItem(i); };
  document.body.appendChild(el);
  let y0 = null;
  el.addEventListener('touchstart', (e) => { y0 = e.touches[0].clientY; }, { passive: true });
  el.addEventListener('touchmove', (e) => { if (y0 != null && y0 - e.touches[0].clientY > 25) { y0 = null; el.classList.add('out'); setTimeout(() => el.remove(), 200); } }, { passive: true });
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 220); }, 6000);
}

// Hızlı açılış: son görülen veriyi telefonda sakla, açılışta önce onu göster
const snapKey = () => 'tayfa-snap-' + me();
function saveSnapshot() {
  try {
    localStorage.setItem(snapKey(), JSON.stringify({ ctx: S.ctx, members: S.members, events: S.events, rsvps: S.rsvps, commentCounts: S.commentCounts || {} }));
  } catch (_) { /* */ }
}
function loadSnapshot() {
  try {
    const o = JSON.parse(localStorage.getItem(snapKey()) || 'null');
    if (!o || o.ctx?.status !== 'active') return false;
    Object.assign(S, { ctx: o.ctx, members: o.members || [], events: o.events || [], rsvps: o.rsvps || [], commentCounts: o.commentCounts || {} });
    return true;
  } catch (_) { return false; }
}
const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
function pushState() {
  if (!pushSupported()) return isIOS && !isStandalone ? 'needs-install' : 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  if (Notification.permission === 'granted') return 'granted';
  return 'default';
}
function b64ToBytes(b64) {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}
async function enablePush({ silent = false } = {}) {
  const st = pushState();
  if (st === 'needs-install') { if (!silent) showInstallSheet(); return false; }
  if (st === 'unsupported') { if (!silent) toast('Bu tarayıcı bildirimleri desteklemiyor.'); return false; }
  if (st === 'denied') { if (!silent) toast('Bildirimler telefon ayarlarından kapalı.'); return false; }
  try {
    if (st === 'default') {
      if (silent) return false;
      const p = await Notification.requestPermission();
      if (p !== 'granted') { toast('Bildirim izni verilmedi.'); return false; }
    }
    const reg = swReg || (await navigator.serviceWorker.ready);
    let sub = await reg.pushManager.getSubscription();
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(VAPID_PUBLIC_KEY) });
    const j = sub.toJSON();
    await rpc('save_push_subscription', { p_endpoint: j.endpoint, p_p256dh: j.keys.p256dh, p_auth: j.keys.auth });
    if (!silent) toast('Bildirimler açık');
    return true;
  } catch (e) {
    if (!silent) toast('Bildirim açılamadı: ' + errText(e));
    return false;
  }
}
async function disablePushForThisDevice() {
  try {
    const reg = swReg || (await navigator.serviceWorker?.ready);
    const sub = await reg?.pushManager?.getSubscription();
    if (sub) { await rpc('delete_push_subscription', { p_endpoint: sub.endpoint }).catch(() => {}); await sub.unsubscribe(); }
  } catch (_) { /* yoksay */ }
}

// ------------------------------------------------------------------ veri
async function loadContext() {
  S.ctx = (await rpc('my_context')) || {};
}
async function loadData() {
  if (S.ctx.status !== 'active') return;
  const since = new Date(Date.now() - 6 * 3600 * 1000).toISOString();
  const [ev, mem] = await Promise.all([
    sb.from('events').select('*').eq('group_id', S.ctx.group_id).gte('starts_at', since).order('starts_at'),
    sb.from('members').select('*').eq('group_id', S.ctx.group_id),
  ]);
  if (ev.error) throw ev.error;
  if (mem.error) throw mem.error;
  S.events = ev.data || [];
  S.members = mem.data || [];
  const ids = S.events.map((e) => e.id);
  if (ids.length) {
    const r = await sb.from('rsvps').select('*').in('event_id', ids);
    if (r.error) throw r.error;
    S.rsvps = r.data || [];
  } else S.rsvps = [];
  if (ids.length) {
    const c = await sb.from('comments').select('target_id').eq('target_type', 'event').in('target_id', ids);
    S.commentCounts = {};
    for (const r of c.data || []) S.commentCounts[r.target_id] = (S.commentCounts[r.target_id] || 0) + 1;
  }
  if (isAdmin()) S.invites = (await rpc('list_invites')) || [];
  saveSnapshot();
  Sohbet.loadUnread().catch(() => {});
  loadInbox().catch(() => {});
  loadOnThisDay().catch(() => {});
}

// "Geçen yıl bugün": günde bir kez sorulur
async function loadOnThisDay() {
  const today = new Intl.DateTimeFormat('tr-TR', { timeZone: TZ }).format(new Date());
  if (S.otdDay === today) return;
  const list = (await rpc('on_this_day')) || [];
  S.otdDay = today;
  S.otd = list;
  S.otdUrls = list.length ? await Anilar.thumbUrls(list.slice(0, 3).map((p) => p.thumb_path)) : null;
  if (S.view === 'main' && S.tab === 'home' && list.length && !document.getElementById('sb')) render();
}

// Hava durumu (Open-Meteo, ücretsiz, anahtarsız): plan konumu varsa onu, yoksa yer adını arar
const WX = new Map();
const WX_TEXT = [[0, 'Açık', 'sun'], [2, 'Parçalı bulutlu', 'cloudSun'], [3, 'Bulutlu', 'cloud'], [48, 'Sisli', 'fog'], [57, 'Çisenti', 'rain'],
  [67, 'Yağmurlu', 'rain'], [77, 'Karlı', 'snow'], [82, 'Sağanak', 'rain'], [86, 'Kar sağanağı', 'snow'], [99, 'Fırtınalı', 'storm']];
const WXP = new Map();
function weatherFor(e) {
  if (!WXP.has(e.id)) WXP.set(e.id, fetchWeather(e));
  return WXP.get(e.id);
}
async function fetchWeather(e) {
  const start = new Date(e.starts_at);
  const days = (start - Date.now()) / 864e5;
  if (days > 15 || days < -0.3) return null;
  try {
    let lat = e.lat, lng = e.lng;
    if (lat == null && e.place) {
      const g = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(e.place)}&count=1&language=tr&countryCode=TR`).then((r) => r.json());
      const r = g?.results?.[0];
      if (r) { lat = r.latitude; lng = r.longitude; }
    }
    if (lat == null) return null;
    const day = new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(start);
    const f = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&hourly=temperature_2m,weather_code&timezone=Europe%2FIstanbul&start_date=${day}&end_date=${day}`).then((r) => r.json());
    const hour = +new Intl.DateTimeFormat('en-GB', { hour: '2-digit', hourCycle: 'h23', timeZone: TZ }).format(start);
    const t = f?.hourly?.temperature_2m?.[hour]; const c = f?.hourly?.weather_code?.[hour];
    if (t == null || c == null) return null;
    const [, text, icon] = WX_TEXT.find(([max]) => c <= max) || WX_TEXT[WX_TEXT.length - 1];
    const w = { t: Math.round(t), text, icon };
    WX.set(e.id, w);
    return w;
  } catch (_) { return null; }
}
const wxChip = (w, short) => w ? `<span class="wx" title="${esc(w.text)}">${svg(w.icon)}${w.t}°${short ? '' : ' · ' + esc(w.text)}</span>` : '';
function fillWeather() {
  document.querySelectorAll('[data-wx]').forEach(async (el) => {
    const e = S.events.find((x) => x.id === el.dataset.wx); if (!e) return;
    const w = await weatherFor(e);
    if (w && el.isConnected) el.innerHTML = wxChip(w, !!el.dataset.short);
  });
}
const isAdmin = () => S.ctx.role === 'admin' && S.ctx.status === 'active';
const me = () => S.session?.user?.id;
const nameOf = (uid) => S.members.find((m) => m.user_id === uid)?.display_name || 'Bir üye';
const activeMembers = () => S.members.filter((m) => m.status === 'active');
const pendingMembers = () => S.members.filter((m) => m.status === 'pending');
const pendingEvents = () => S.events.filter((e) => e.status === 'pending');

function subscribeRealtime() {
  if (channel) { sb.removeChannel(channel); channel = null; }
  if (S.ctx.status !== 'active') return;
  let t;
  const refresh = () => { clearTimeout(t); t = setTimeout(() => refreshAll(), 400); };
  channel = sb.channel('tayfa-' + S.ctx.group_id)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'events' }, refresh)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'rsvps' }, refresh)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'members' }, refresh)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `group_id=eq.${S.ctx.group_id}` }, ({ new: m }) => {
      if (!m || m.game_id || m.kind === 'system' || m.sender === me()) return;
      if (S.view === 'main' && S.tab === 'chat' && document.visibilityState === 'visible') return; // sohbet açık: okunuyor
      S.unreadCount = (S.unreadCount || 0) + 1; S.unreadChat = true;
      updateTabDots();
    })
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'inbox', filter: `user_id=eq.${me()}` }, ({ new: i }) => {
      if (!i || (S.inbox || []).some((x) => x.id === i.id)) return;
      S.inbox = [i, ...(S.inbox || [])];
      if (atTarget(i.url) && document.visibilityState === 'visible') { // zaten o ekrandayız: okundu say
        i.read_at = new Date().toISOString(); rpc('mark_inbox_read', { p_id: i.id }).catch(() => {});
        if (S.view === 'inbox') renderInbox();
        return;
      }
      S.inboxUnread = (S.inboxUnread || 0) + 1;
      updateBell();
      if (S.view === 'inbox') renderInbox();
      showInApp(i);
    })
    .subscribe();
}
async function refreshAll() {
  try {
    const before = S.ctx.status;
    await loadContext();
    if (S.ctx.status !== before) subscribeRealtime();
    await loadData();
  } catch (e) { console.warn(e); }
  if (S.ctx.status !== 'active' || S.view === 'admin' || (S.view === 'main' && S.tab === 'home')) render();
  else if (S.view === 'main') updateTabDots();
}

// ------------------------------------------------------------------ çizim
let lastView = null, lastGame = null;
function render() {
  // Oyun ekranından herhangi bir yolla çıkılınca (bildirim, geri, kaydırma) kanalı hemen kapat, sunucuya bildir
  if (lastView === 'game' && (S.view !== 'game' || S.gameId !== lastGame)) Oyunlar.closeGame();
  lastView = S.view; lastGame = S.gameId;
  if (S.view !== 'main' || S.tab !== 'chat') Sohbet.unmount();
  if (!S.session) return renderAuth();
  if (!S.ctx.status) return renderNoGroup();
  if (S.ctx.status === 'pending') return renderPending();
  if (S.view === 'admin' && isAdmin()) return renderAdmin();
  if (S.view === 'album') return Anilar.renderAlbum();
  if (S.view === 'game') return Oyunlar.renderGame();
  if (S.view === 'inbox') return renderInbox();
  renderMain();
}

// Bildirim bağlantıları ve adres çubuğu: #yonetim, #anilar, #album/<id>, #sohbet, #oyun/<id>, #plan/<id>, #bildirimler
// Gidilebildiyse true döner.
export function route(hash) {
  if (!S.session || S.ctx.status !== 'active') return false;
  const [k, id] = String(hash || '').replace(/^#/, '').split('/');
  if (k === 'yonetim' && isAdmin()) { S.view = 'admin'; }
  else if (k === 'album' && id) { S.view = 'album'; S.albumId = id; }
  else if (k === 'oyun' && id) { S.view = 'game'; S.gameId = id; }
  else if (k === 'sohbet') { S.view = 'main'; S.tab = 'chat'; }
  else if (k === 'anilar') { S.view = 'main'; S.tab = 'memory'; }
  else if (k === 'oyunlar') { S.view = 'main'; S.tab = 'game'; }
  else if (k === 'bildirimler') { S.view = 'inbox'; }
  else if (k === 'yeni' && id) { // yeni fotoğraflar: ana sayfanın üstünde tam ekran
    const [, , count, ts] = String(hash).replace(/^#/, '').split('/');
    if (S.view !== 'main' && S.view !== 'album') { S.view = 'main'; S.tab = 'home'; }
    closeSheet(); render();
    if (location.hash) history.replaceState(null, '', location.pathname);
    Anilar.openNew({ album: id, count, ts });
    return true;
  }
  else if (k === 'ana' || k === '') { S.view = 'main'; S.tab = 'home'; }
  else if (k === 'plan' && id) {
    const e = S.events.find((x) => x.id === id);
    if (e && e.status === 'pending' && isAdmin()) { S.view = 'admin'; }
    else {
      S.view = 'main'; S.tab = 'home';
      closeSheet(); render();
      setTimeout(() => {
        const el = document.getElementById('ev-' + id);
        if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); el.classList.add('flash'); setTimeout(() => el.classList.remove('flash'), 1800); }
      }, 60);
      return true;
    }
  }
  else return false;
  closeSheet();
  document.querySelector('.inapp')?.remove();
  render();
  window.scrollTo(0, 0);
  return true;
}
export function goMain(tab) {
  S.view = 'main'; if (tab) S.tab = tab;
  if (location.hash) history.replaceState(null, '', location.pathname);
  render();
}

// Geri: açık pencere varsa onu kapat, değilse bir üst ekrana dön
function goBack() {
  const viewer = document.getElementById('viewer');
  if (viewer) { document.getElementById('v-close')?.click(); return true; }
  if (document.getElementById('sb')) { closeSheet(); return true; }
  if (S.view === 'album') { goMain('memory'); return true; }
  if (S.view === 'game') { goMain('game'); return true; }
  if (S.view === 'admin' || S.view === 'inbox') { goMain('home'); return true; }
  if (S.view === 'main' && S.tab !== 'home') { goMain('home'); return true; }
  return false;
}

// Ekranın sol kenarından sağa kaydırınca geri git (telefon uygulamalarındaki gibi)
(function edgeSwipe() {
  let x0 = null, y0 = 0, active = false, ind = null;
  const EDGE = 24, NEED = 70;
  document.addEventListener('touchstart', (e) => {
    const t = e.touches[0];
    if (e.touches.length !== 1 || t.clientX > EDGE || !S.session) { x0 = null; return; }
    x0 = t.clientX; y0 = t.clientY; active = false;
  }, { passive: true });
  document.addEventListener('touchmove', (e) => {
    if (x0 == null) return;
    const t = e.touches[0]; const dx = t.clientX - x0, dy = Math.abs(t.clientY - y0);
    if (!active) {
      if (dy > 24 && dy > dx) { x0 = null; return; }
      if (dx > 12) {
        active = true;
        ind = document.createElement('div'); ind.className = 'edge-back'; ind.innerHTML = svg('back');
        document.body.appendChild(ind);
      }
    }
    if (active && ind) {
      const p = Math.min(1, dx / NEED);
      ind.style.opacity = String(p);
      ind.style.transform = `translateX(${-44 + p * 60}px) scale(${0.7 + p * 0.3})`;
    }
  }, { passive: true });
  const end = (e) => {
    if (x0 == null) return;
    const dx = (e.changedTouches?.[0]?.clientX ?? x0) - x0;
    x0 = null;
    if (ind) { ind.remove(); ind = null; }
    if (active && dx >= NEED) goBack();
    active = false;
  };
  document.addEventListener('touchend', end);
  document.addEventListener('touchcancel', () => { x0 = null; active = false; ind?.remove(); ind = null; });
})();

// ---- giriş / kayıt
function renderAuth() {
  const setup = S.setupNeeded;
  const mode = setup ? 'setup' : S.authMode;
  const installHint = isIOS && !isStandalone
    ? `<button class="banner" id="install-hint"><span class="pip"></span><span class="grow">Bildirimler için Tayfa'yı ana ekrana ekle</span><span>Nasıl?</span></button>` : '';
  $app.innerHTML = `
  <div class="auth">
    <div class="auth-head">
      <div class="logo-big"></div>
      <h1>${setup ? 'Tayfa kurulumu' : mode === 'login' ? 'Tayfa' : 'Tayfaya katıl'}</h1>
      <p class="sub">${setup ? 'İlk hesabı sen açıyorsun, grubun yöneticisi olacaksın.' : mode === 'login' ? 'Arkadaş grubunun buluşma yeri' : 'Davet kodun sadece senin e-postanla çalışır'}</p>
    </div>
    ${installHint}
    ${setup ? '' : `<div class="seg" role="tablist">
      <button class="${mode === 'login' ? 'on' : ''}" data-mode="login">Giriş yap</button>
      <button class="${mode === 'signup' ? 'on' : ''}" data-mode="signup">Kayıt ol</button></div>`}
    <form id="auth-form" class="auth" style="padding:0;gap:14px" novalidate>
      ${mode === 'signup' ? field('kod', 'Davet kodu', 'text', 'TAYFA-XXXX-XXXX', 'autocapitalize="characters" autocomplete="off"') : ''}
      ${mode === 'setup' ? field('grup', 'Grubun adı', 'text', 'Tayfa', 'autocomplete="off" maxlength="60"', 'Tayfa') : ''}
      ${mode !== 'login' ? field('ad', 'Adın', 'text', 'Grupta görünecek adın', 'autocomplete="given-name" maxlength="40"') : ''}
      ${field('eposta', 'E-posta', 'email', 'ornek@mail.com', 'autocomplete="email" autocapitalize="off"')}
      ${field('sifre', 'Şifre', 'password', mode === 'login' ? 'Şifren' : 'En az 8 karakter', mode === 'login' ? 'autocomplete="current-password"' : 'autocomplete="new-password" minlength="8"')}
      ${mode !== 'login' ? `
      <div class="kvkk">
        <span class="kvkk-title">${svg('shield')}KVKK</span>
        ${check('c1', `<a href="aydinlatma.html" target="_blank">Aydınlatma Metni</a>'ni okudum, bilgilendirildim. <b>(zorunlu)</b>`)}
        ${check('c2', 'Grupta paylaşılan fotoğraflarda görünmeme ve konumlarının haritada gösterilmesine açık rıza veriyorum.')}
        ${check('c3', 'Verilerimin yurt dışındaki sunucuda (Frankfurt, Almanya) saklanmasına açık rıza veriyorum.')}
      </div>` : ''}
      <p class="err" id="auth-err"></p>
      <button class="btn primary block" style="height:52px" type="submit" id="auth-btn">${mode === 'login' ? 'Giriş yap' : mode === 'setup' ? 'Grubu kur' : 'Kayıt ol'}</button>
      ${mode === 'signup' ? '<p class="small" style="text-align:center">Kayıttan sonra yönetici onayı beklenir.</p>' : ''}
      ${mode === 'login' ? '<p class="small" style="text-align:center">Şifreni unuttuysan grup yöneticisine yaz.</p>' : ''}
    </form>
    <p class="small" style="text-align:center;margin-top:8px">Sürüm ${APP_VERSION}</p>
  </div>`;
  $app.querySelectorAll('[data-mode]').forEach((b) => b.onclick = () => { S.authMode = b.dataset.mode; renderAuth(); });
  document.getElementById('install-hint')?.addEventListener('click', showInstallSheet);
  document.getElementById('auth-form').onsubmit = (ev) => { ev.preventDefault(); submitAuth(mode); };
}
function field(id, label, type, ph, attrs = '', value = '') {
  return `<div class="field"><label for="f-${id}">${label}</label><input class="input" id="f-${id}" type="${type}" placeholder="${esc(ph)}" value="${esc(value)}" ${attrs}></div>`;
}
function check(id, html) {
  return `<div class="check"><input type="checkbox" id="${id}"><label for="${id}">${html}</label></div>`;
}
const val = (id) => (document.getElementById('f-' + id)?.value || '').trim();

async function submitAuth(mode) {
  const err = document.getElementById('auth-err');
  const btn = document.getElementById('auth-btn');
  err.textContent = '';
  const email = val('eposta').toLowerCase();
  const password = document.getElementById('f-sifre').value;
  if (!email.includes('@')) return (err.textContent = 'Geçerli bir e-posta yaz.');
  if (password.length < (mode === 'login' ? 1 : 8)) return (err.textContent = mode === 'login' ? 'Şifreni yaz.' : 'Şifre en az 8 karakter olmalı.');
  btn.disabled = true;
  try {
    if (mode === 'login') {
      const { error } = await sb.auth.signInWithPassword({ email, password });
      if (error) throw error;
      return; // onAuthStateChange devam ettirir
    }
    const name = val('ad');
    if (!name) throw new Error('TAYFA: Adını yaz.');
    if (!document.getElementById('c1').checked) throw new Error('TAYFA: Aydınlatma metnini onaylaman gerekiyor.');
    const meta = {
      display_name: name,
      aydinlatma: true,
      riza_foto: document.getElementById('c2').checked,
      riza_yurtdisi: document.getElementById('c3').checked,
    };
    if (mode === 'setup') {
      meta.group_name = val('grup') || 'Tayfa';
    } else {
      const code = val('kod').toUpperCase();
      if (!code) throw new Error('TAYFA: Davet kodunu yaz.');
      const st = await rpc('check_invite', { p_code: code, p_email: email });
      const msg = { gecersiz: 'Davet kodu geçersiz.', kullanilmis: 'Bu davet kodu daha önce kullanılmış.', suresi_dolmus: 'Davet kodunun süresi dolmuş, yöneticiden yenisini iste.', eposta: 'Bu davet kodu başka bir e-posta adresi için üretilmiş.' }[st];
      if (msg) throw new Error('TAYFA: ' + msg);
      meta.invite_code = code;
    }
    const { data, error } = await sb.auth.signUp({ email, password, options: { data: meta } });
    if (error) throw error;
    if (!data.session) {
      err.textContent = 'Hesap açıldı ama e-posta onayı bekleniyor. Yöneticiye haber ver (Supabase\'de "Confirm email" kapalı olmalı).';
      btn.disabled = false;
    }
  } catch (e) {
    let m = errText(e);
    if (/Database error saving new user/i.test(m)) m = 'Kayıt tamamlanamadı. Davet kodunu ve e-postayı kontrol et.';
    err.textContent = m;
    btn.disabled = false;
  }
}

function renderNoGroup() {
  $app.innerHTML = `<div class="screen"><div class="content no-tabs">
    <div class="soon"><div class="big">${svg('user')}</div><h2>Bir gruba üye değilsin</h2>
    <p class="sub">Üyeliğin kaldırılmış ya da reddedilmiş olabilir. Grup yöneticisiyle konuş.</p>
    <button class="btn" id="logout">Çıkış yap</button></div></div></div>`;
  document.getElementById('logout').onclick = logout;
}

function renderPending() {
  const ps = pushState();
  $app.innerHTML = `<div class="screen"><div class="content no-tabs">
    <div class="soon">
      <div class="big">${svg('clock')}</div>
      <h1 style="font-size:24px">Onay bekleniyor</h1>
      <p class="sub">Merhaba ${esc(S.ctx.display_name)}. <b>${esc(S.ctx.group_name)}</b> yöneticisi kaydını onayladığında uygulama açılacak.</p>
      ${ps === 'granted' ? '<p class="small">Onaylanınca bildirim gelecek.</p>'
        : `<button class="btn primary" id="push">${svg('bell')}Onaylanınca bildirim al</button>`}
      <button class="btn" id="check">Tekrar kontrol et</button>
      <button class="btn danger small" id="logout" style="margin-top:12px">Çıkış yap</button>
    </div></div></div>`;
  document.getElementById('push')?.addEventListener('click', async () => { await enablePush(); renderPending(); });
  document.getElementById('check').onclick = refreshAll;
  document.getElementById('logout').onclick = logout;
}

// ---- ana ekran
function renderMain() {
  const tabs = [['home', 'Ana sayfa', 'home'], ['memory', 'Anılar', 'memory'], ['chat', 'Sohbet', 'chat'], ['game', 'Oyunlar', 'game']];
  let body = '';
  if (S.tab !== 'chat') Sohbet.unmount();
  if (S.tab === 'home') body = homeView();
  else if (S.tab === 'memory') body = Anilar.tabView();
  else if (S.tab === 'chat') body = Sohbet.tabView();
  else body = Oyunlar.tabView();
  const prevTab = renderMain.lastTab; renderMain.lastTab = S.tab;
  $app.innerHTML = `<div class="screen ${prevTab && prevTab !== S.tab ? 'enter' : ''}">
    <main class="content ${S.tab === 'chat' ? 'chat-content' : ''}">${body}</main>
    ${S.tab === 'home' ? `<button class="fab" id="fab">${svg('plus')}${isAdmin() ? 'Etkinlik' : 'Etkinlik öner'}</button>` : ''}
    <nav class="tabbar" aria-label="Ana menü">${tabs.map(([k, l, i]) => `<button class="tab ${S.tab === k ? 'on' : ''}" data-tab="${k}" aria-label="${l}">${svg(i)}<span>${l}</span><i class="tab-dot hidden" data-dot="${k}"></i><i class="tab-n hidden" data-n="${k}"></i></button>`).join('')}</nav>
  </div>`;
  $app.querySelectorAll('[data-tab]').forEach((b) => b.onclick = () => { S.tab = b.dataset.tab; render(); window.scrollTo(0, 0); });
  document.getElementById('fab')?.addEventListener('click', () => showEventSheet());
  bindHome();
  if (S.tab === 'memory') Anilar.mount();
  else if (S.tab === 'chat') Sohbet.mount();
  else if (S.tab === 'game') Oyunlar.mount();
  updateTabDots();
}
export function updateTabDots() {
  const n = $app.querySelector('[data-n="chat"]');
  const cnt = S.tab === 'chat' && S.view === 'main' ? 0 : (S.unreadCount || 0);
  if (n) { n.classList.toggle('hidden', !cnt); n.textContent = cnt > 99 ? '99+' : String(cnt); }
  const g = $app.querySelector('[data-dot="game"]');
  if (g) g.classList.toggle('hidden', !(S.myTurnGames > 0 && S.tab !== 'game'));
  Oyunlar.drawChatCount?.();
}

const initialOf = (s) => String(s || '?').trim().charAt(0).toLocaleUpperCase('tr-TR');
function header(title, subtitle, opts = {}) {
  const adminDot = pendingMembers().length + pendingEvents().length > 0 ? '<span class="dot"></span>' : '';
  const left = opts.brand
    ? `<div class="brand"><img src="icons/icon-192.png" alt=""><b>Tayfa</b></div>`
    : `<div style="flex:1;min-width:0"><h1>${title}</h1>${subtitle ? `<p class="sub" style="margin-top:2px">${subtitle}</p>` : ''}</div>`;
  return `<header class="topbar">${left}
    <div class="topbar-actions">${opts.extra || ''}
      <button class="icon-btn" id="h-bell" aria-label="Bildirimler">${svg('bell')}</button>
      ${isAdmin() ? `<button class="icon-btn" id="h-admin" aria-label="Yönetim">${svg('shield')}${adminDot}</button>` : ''}
      <button class="me-btn" id="h-me" aria-label="Profil">${esc(initialOf(S.ctx.display_name))}</button>
    </div></header>`;
}
function bindHeader() {
  document.getElementById('h-bell')?.addEventListener('click', () => { S.view = 'inbox'; render(); window.scrollTo(0, 0); });
  document.getElementById('h-admin')?.addEventListener('click', () => { S.view = 'admin'; location.hash = 'yonetim'; render(); window.scrollTo(0, 0); });
  document.getElementById('h-me')?.addEventListener('click', showProfileSheet);
  updateBell();
}

function greeting() {
  const h = +new Intl.DateTimeFormat('en-GB', { hour: '2-digit', hourCycle: 'h23', timeZone: TZ }).format(new Date());
  return h < 5 ? 'İyi geceler' : h < 11 ? 'Günaydın' : h < 18 ? 'İyi günler' : 'İyi akşamlar';
}

function heroCard(e) {
  const d = new Date(e.starts_at);
  const rs = S.rsvps.filter((r) => r.event_id === e.id);
  const yes = rs.filter((r) => r.answer === 'yes');
  const mine = rs.find((r) => r.user_id === me())?.answer;
  const waiting = Math.max(0, activeMembers().length - rs.length);
  const days = Math.round((new Date(new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(d)) - new Date(new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date()))) / 864e5);
  const when = days <= 0 ? 'BUGÜN' : days === 1 ? 'YARIN' : `${days} GÜN SONRA`;
  const parts = [];
  if (yes.length) parts.push(`${yes.length} kişi geliyor`);
  if (waiting) parts.push(`${waiting} kişi bekleniyor`);
  return `<section class="next" id="ev-${e.id}">
    <div class="next-k"><span>SIRADAKİ ETKİNLİK · ${when}</span><span data-wx="${e.id}" data-short="1">${wxChip(WX.get(e.id), true)}</span></div>
    <div class="ev-head">${dateBox(e)}<div style="flex:1;min-width:0"><h2>${esc(e.title)}</h2>
      <div class="ev-meta"><span>${svgInline('clock')}${esc(fmt.time(d))}</span>${e.place ? `<span>${svgInline('pin')}${esc(e.place)}</span>` : ''}</div></div></div>
    ${e.note ? `<p class="ev-note">${esc(e.note)}</p>` : ''}
    <button class="people" data-who="${e.id}" style="border:none;background:none;padding:0;text-align:left">
      <span class="avatars">${yes.slice(0, 6).map((r) => avatar(nameOf(r.user_id), r.user_id)).join('')}</span>
      <span>${parts.join(' · ') || 'Henüz cevap yok'}</span></button>
    <div class="row2">
      <button class="btn ${mine === 'yes' ? 'ok-on' : 'primary'}" data-rsvp="${e.id}" data-a="yes">${mine === 'yes' ? '✓ Geliyorum' : 'Geliyorum'}</button>
      <button class="btn ${mine === 'no' ? 'no-on' : ''}" data-rsvp="${e.id}" data-a="no">${mine === 'no' ? '✓ Gelemem' : 'Gelemem'}</button>
    </div>
    <div class="links">
      <button class="btn small" data-com="${e.id}">${svg('comment')}Yorumlar${S.commentCounts?.[e.id] ? ' · ' + S.commentCounts[e.id] : ''}</button>
      ${isAdmin() ? `<button class="btn small" data-del="${e.id}">Etkinliği sil</button>` : ''}
    </div>
  </section>`;
}
const SAIL = '<svg class="logo" viewBox="0 0 120 120" aria-hidden="true"><rect width="120" height="120" rx="27" fill="#FFFFFF" fill-opacity="0.1"/><path d="M60 22 L60 78 L30 78 Z" fill="#FFFFFF"/><path d="M66 30 L66 78 L90 78 Z" fill="#FF7A59"/><path d="M26 86 H94 L86 96 H34 Z" fill="#FFFFFF"/></svg>';
function topBlock() {
  const first = (S.ctx.display_name || '').split(' ')[0];
  const today = new Intl.DateTimeFormat('tr-TR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: TZ }).format(new Date());
  const act = activeMembers();
  const others = act.filter((m) => m.user_id !== me());
  const adminDot = pendingMembers().length + pendingEvents().length > 0 ? '<span class="dot"></span>' : '';
  return `<section class="home-top">
    <header class="top-bar">${SAIL}<b>Tayfa</b>
      <button class="icon-btn" id="h-bell" aria-label="Bildirimler">${svg('bell')}</button>
      ${isAdmin() ? `<button class="icon-btn" id="h-admin" aria-label="Yönetim">${svg('shield')}${adminDot}</button>` : ''}
      <button class="me-btn" id="h-me" aria-label="Profil">${esc(initialOf(S.ctx.display_name))}</button>
    </header>
    <div><p class="top-date">${esc(today.charAt(0).toLocaleUpperCase('tr-TR') + today.slice(1))}</p>
      <h1 class="top-hi">${greeting()}, ${esc(first)}</h1></div>
    ${others.length ? `<div class="top-people"><span class="avatars">${others.slice(0, 6).map((m) => avatar(m.display_name, m.user_id)).join('')}</span>
      <span>${esc(S.ctx.group_name || 'Tayfa')} · ${act.length} kişi</span></div>` : ''}
  </section>`;
}

function turnStrip() {
  const list = S.myTurnList || [];
  if (!list.length) return '';
  const g = list[0];
  if (g.state?.kind === 'king') {
    return `<button class="strip" data-go-game="${g.id}"><span class="ic">${svg('crown')}</span>
    <span class="grow"><b>Sıra sende${list.length > 1 ? ` · ${list.length} oyun` : ''}</b><span>King · ${g.state.phase === 'choose' ? `${g.state.hand}. eli sen seçeceksin` : `${g.state.hand}. el`}</span></span>
    <span class="go">Oyna</span></button>`;
  }
  const opp = g.players.find((p) => p !== me());
  const pi = g.players.indexOf(me());
  const sc = g.state?.score ? `${g.state.score[pi]}–${g.state.score[1 - pi]}` : '';
  return `<button class="strip" data-go-game="${g.id}"><span class="ic">${svg('dice')}</span>
    <span class="grow"><b>Sıra sende${list.length > 1 ? ` · ${list.length} maç` : ''}</b><span>${esc(nameOf(opp))} ile tavla${sc ? ' · ' + sc : ''}</span></span>
    <span class="go">Oyna</span></button>`;
}
function otdCard() {
  const list = S.otd || [];
  if (!list.length) return '';
  const p = list[0];
  const years = new Date().getFullYear() - new Date(p.taken_at).getFullYear();
  const shown = list.slice(0, 3);
  const url = S.otdUrls || (() => '');
  const title = p.is_loose ? (p.place || 'Anılar') : p.album;
  return `<button class="otd nosave" data-otd="${p.album_id}" data-loose="${p.is_loose ? 1 : 0}">
    <span class="otd-grid ${shown.length === 1 ? 'one' : shown.length === 2 ? 'two' : ''}">${shown.map((x) => `<i style="background-image:url('${url(x.thumb_path)}')"></i>`).join('')}</span>
    <span class="otd-cap"><span><small>${years <= 1 ? 'GEÇEN YIL BUGÜN' : `${years} YIL ÖNCE BUGÜN`}</small><b>${esc(title)}</b></span><span>${list.length} fotoğraf</span></span>
  </button>`;
}

function homeView() {
  const upcoming = S.events.filter((e) => e.status === 'approved');
  const myPending = S.events.filter((e) => e.status === 'pending' && e.created_by === me());
  const waitCount = pendingMembers().length + pendingEvents().length;
  let h = topBlock();
  let o = '';
  if (!upcoming.length) {
    o += `<div class="next"><div class="empty">${svg('cal')}<b style="color:var(--ink)">Henüz etkinlik yok</b><span>${isAdmin() ? 'İlk etkinliği sen ekle.' : 'Bir etkinlik öner, yönetici onaylayınca herkese duyurulsun.'}</span></div></div>`;
  } else o += heroCard(upcoming[0]);
  if (isAdmin() && waitCount) {
    const parts = [];
    if (pendingEvents().length) parts.push(`${pendingEvents().length} etkinlik`);
    if (pendingMembers().length) parts.push(`${pendingMembers().length} üye`);
    o += `<button class="banner" id="go-admin"><span class="pip"></span><span class="grow">${parts.join(' ve ')} onayını bekliyor</span><span>İncele</span></button>`;
  }
  if (pushState() !== 'granted') {
    o += `<button class="banner" id="go-push" style="background:var(--accent-soft);border-color:transparent;color:var(--accent-ink)"><span class="pip" style="background:var(--accent)"></span><span class="grow">${pushState() === 'needs-install' ? 'Bildirim almak için Tayfa\'yı ana ekrana ekle' : 'Yeni etkinliklerden haberdar olmak için bildirimleri aç'}</span><span>Aç</span></button>`;
  }
  o += turnStrip();
  o += otdCard();
  h += `<div class="over">${o}</div>`;
  if (myPending.length) {
    h += `<p class="section-title">Onayını bekleyen önerilerin</p>`;
    h += myPending.map((e) => `<section class="card"><div class="ev-head">${dateBox(e)}<div style="flex:1;min-width:0"><h2>${esc(e.title)}</h2>
      <div class="ev-meta"><span>${esc(fmt.short(new Date(e.starts_at)))}</span>${e.place ? `<span>${esc(e.place)}</span>` : ''}</div></div>
      <span class="pill" style="background:var(--warn-bg);color:var(--warn-ink)">Onay bekliyor</span></div>
      <button class="btn small danger" data-withdraw="${e.id}" style="align-self:flex-start">Öneriyi geri çek</button></section>`).join('');
  }
  if (upcoming.length > 1) {
    h += `<p class="section-title">Diğer etkinlikler</p>`;
    h += upcoming.slice(1).map(eventCard).join('');
  }
  return h;
}
function dateBox(e) {
  const d = new Date(e.starts_at);
  return `<div class="datebox"><span>${esc(fmt.wd(d))}</span><b>${esc(fmt.day(d))}</b></div>`;
}
function eventCard(e) {
  const d = new Date(e.starts_at);
  const rs = S.rsvps.filter((r) => r.event_id === e.id);
  const yes = rs.filter((r) => r.answer === 'yes');
  const no = rs.filter((r) => r.answer === 'no');
  const mine = rs.find((r) => r.user_id === me())?.answer;
  const waiting = Math.max(0, activeMembers().length - rs.length);
  const parts = [];
  if (yes.length) parts.push(`${yes.length} kişi geliyor`);
  if (no.length) parts.push(`${no.length} gelemiyor`);
  if (waiting) parts.push(`${waiting} cevap bekleniyor`);
  return `<section class="card" id="ev-${e.id}">
    <div class="ev-head">${dateBox(e)}<div style="flex:1;min-width:0"><h2>${esc(e.title)}</h2>
      <div class="ev-meta"><span>${svgInline('clock')}${esc(fmt.time(d))}</span>${e.place ? `<span>${svgInline('pin')}${esc(e.place)}</span>` : ''}</div></div>
      <span data-wx="${e.id}">${wxChip(WX.get(e.id))}</span></div>
    ${e.note ? `<p class="ev-note">${esc(e.note)}</p>` : ''}
    <button class="people" data-who="${e.id}" style="border:none;background:none;padding:0;text-align:left">
      <span class="avatars">${yes.slice(0, 6).map((r) => avatar(nameOf(r.user_id), r.user_id)).join('')}</span>
      <span>${parts.join(' · ') || 'Henüz cevap yok'}</span></button>
    <div class="row2">
      <button class="btn ${mine === 'yes' ? 'ok-on' : mine ? '' : 'primary'}" data-rsvp="${e.id}" data-a="yes">${mine === 'yes' ? '✓ Geliyorum' : 'Geliyorum'}</button>
      <button class="btn ${mine === 'no' ? 'no-on' : ''}" data-rsvp="${e.id}" data-a="no">Gelemem</button>
    </div>
    <div style="display:flex;justify-content:space-between;align-items:center">
      <button class="btn small" data-com="${e.id}">${svg('comment')}Yorumlar${S.commentCounts?.[e.id] ? ' · ' + S.commentCounts[e.id] : ''}</button>
      ${isAdmin() ? `<button class="btn small danger" data-del="${e.id}">Etkinliği sil</button>` : ''}
    </div>
  </section>`;
}
const svgInline = (n) => `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;margin-right:4px" aria-hidden="true">${ICON[n]}</svg>`;

function bindHome() {
  bindHeader();
  if (S.tab === 'home' && S.view === 'main') fillWeather();
  $app.querySelectorAll('[data-go-game]').forEach((b) => b.onclick = () => route('#oyun/' + b.dataset.goGame));
  $app.querySelectorAll('[data-otd]').forEach((b) => b.onclick = () => route(b.dataset.loose === '1' ? '#anilar' : '#album/' + b.dataset.otd));
  document.getElementById('go-admin')?.addEventListener('click', () => { S.view = 'admin'; location.hash = 'yonetim'; render(); });
  document.getElementById('go-push')?.addEventListener('click', async () => { await enablePush(); render(); });
  $app.querySelectorAll('[data-rsvp]').forEach((b) => b.onclick = async () => {
    b.disabled = true;
    try { await rpc('set_rsvp', { p_event: b.dataset.rsvp, p_answer: b.dataset.a }); await loadData(); render(); }
    catch (e) { toast(errText(e)); b.disabled = false; }
  });
  $app.querySelectorAll('[data-withdraw]').forEach((b) => b.onclick = async () => {
    if (!confirm('Öneriyi geri çekmek istiyor musun?')) return;
    try { await rpc('delete_event', { p_event: b.dataset.withdraw }); await loadData(); render(); toast('Öneri geri çekildi'); }
    catch (e) { toast(errText(e)); }
  });
  $app.querySelectorAll('[data-del]').forEach((b) => b.onclick = async () => {
    if (!confirm('Bu etkinlik herkes için silinecek. Emin misin?')) return;
    try { await rpc('delete_event', { p_event: b.dataset.del }); await loadData(); render(); toast('Etkinlik silindi'); }
    catch (e) { toast(errText(e)); }
  });
  $app.querySelectorAll('[data-who]').forEach((b) => b.onclick = () => showWhoSheet(b.dataset.who));
  $app.querySelectorAll('[data-com]').forEach((b) => b.onclick = () => {
    const e = S.events.find((x) => x.id === b.dataset.com);
    Anilar.showComments('event', b.dataset.com, e?.title || 'Etkinlik', async () => { await loadData(); if (S.view === 'main' && S.tab === 'home') render(); });
  });
}

function soonView(tab) {
  const info = {
    memory: ['memory', 'Anılar', 'Fotoğraflar ve harita bir sonraki sürümde geliyor.'],
    chat: ['chat', 'Sohbet', 'Uçtan uca şifreli grup sohbeti ve sesli mesajlar yakında burada.'],
    game: ['game', 'Oyunlar', 'Tavla, Batak, King ve Okey sırayla geliyor.'],
  }[tab];
  return `${header(info[1])}<div class="soon"><div class="big">${svg(info[0])}</div><h2>Yakında</h2><p class="sub">${info[2]}</p></div>`;
}

// ---- yönetim
function renderAdmin() {
  const pm = pendingMembers();
  const pe = pendingEvents();
  const act = activeMembers().sort((a, b) => (a.role === 'admin' ? -1 : 1) - (b.role === 'admin' ? -1 : 1) || a.display_name.localeCompare(b.display_name, 'tr'));
  $app.innerHTML = `<div class="screen"><main class="content no-tabs">
    <button class="back" id="back">${svg('back')}Geri</button>
    <header><h1>Yönetim</h1><p class="sub" style="margin-top:2px">Bu ekranı sadece sen görüyorsun</p></header>

    <section class="card"><div style="display:flex;justify-content:space-between;align-items:center"><h2>Onay bekleyen etkinlikler</h2>${pe.length ? `<span class="pill" style="background:var(--accent);color:#fff">${pe.length}</span>` : ''}</div>
      ${pe.length ? pe.map((e) => `<div style="display:flex;flex-direction:column;gap:10px;padding-top:4px">
        <div class="list-row">${avatar(nameOf(e.created_by), e.created_by, 'lg')}<div class="grow"><div class="name">${esc(e.title)}</div>
        <div class="small">${esc(nameOf(e.created_by))} önerdi · ${esc(fmt.short(new Date(e.starts_at)))}${e.place ? ' · ' + esc(e.place) : ''}</div></div></div>
        ${e.note ? `<p class="ev-note small" style="color:var(--ink)">${esc(e.note)}</p>` : ''}
        <div class="row2"><button class="btn primary" data-ev-ok="${e.id}">Onayla ve duyur</button><button class="btn" data-ev-no="${e.id}">Reddet</button></div></div>`).join('<hr style="border:none;border-top:1px solid var(--line);margin:4px 0">')
      : '<p class="small">Onay bekleyen etkinlik yok.</p>'}
    </section>

    <section class="card"><div style="display:flex;justify-content:space-between;align-items:center"><h2>Onay bekleyen üyeler</h2>${pm.length ? `<span class="pill" style="background:var(--accent);color:#fff">${pm.length}</span>` : ''}</div>
      ${pm.length ? pm.map((m) => `<div style="display:flex;flex-direction:column;gap:10px">
        <div class="list-row">${avatar(m.display_name, m.user_id, 'lg')}<div class="grow"><div class="name">${esc(m.display_name)}</div><div class="small">${esc(fmt.short(new Date(m.created_at)))} kayıt oldu</div></div></div>
        <div class="row2"><button class="btn primary" data-m-ok="${m.user_id}">Onayla</button><button class="btn" data-m-no="${m.user_id}">Reddet</button></div></div>`).join('')
      : '<p class="small">Onay bekleyen üye yok.</p>'}
    </section>

    <section class="card"><h2>Davet oluştur</h2>
      <p class="small">Arkadaşının e-postasını yaz. Kod tek kullanımlık, 48 saat geçerli ve sadece o e-postayla çalışır.</p>
      <form id="inv-form" style="display:flex;gap:8px"><label for="inv-mail" class="hidden">E-posta</label>
        <input class="input" id="inv-mail" type="email" placeholder="arkadas@mail.com" autocapitalize="off" style="flex:1;min-width:0">
        <button class="btn primary" type="submit">Kod üret</button></form>
      ${S.lastInvite ? inviteBox(S.lastInvite) : ''}
      ${S.invites.filter((i) => i.code !== S.lastInvite?.code).length ? `<p class="section-title" style="margin-top:6px">Açık davetler</p>` + S.invites.filter((i) => i.code !== S.lastInvite?.code).map((i) => `
        <div class="list-row"><div class="grow"><div class="name" style="font-size:14px">${esc(i.code)}</div><div class="small">${esc(i.email)} · ${esc(fmt.short(new Date(i.expires_at)))}'e kadar</div></div>
        <button class="btn small" data-inv-share="${esc(i.code)}">Paylaş</button><button class="btn small danger" data-inv-del="${esc(i.code)}">İptal</button></div>`).join('') : ''}
    </section>

    <section class="card"><h2>Üyeler · ${act.length}</h2>
      ${act.map((m) => `<div class="list-row">${avatar(m.display_name, m.user_id, 'lg')}<div class="grow"><div class="name">${esc(m.display_name)}${m.user_id === me() ? ' (sen)' : ''}</div><div class="small">${m.role === 'admin' ? 'Yönetici' : 'Üye'}</div></div>
        ${m.user_id !== me() ? `<button class="btn small danger" data-rm="${m.user_id}">Çıkar</button>` : ''}</div>`).join('')}
    </section>
  </main></div>`;

  document.getElementById('back').onclick = () => { S.view = 'main'; history.replaceState(null, '', location.pathname); render(); };
  document.getElementById('inv-form').onsubmit = async (ev) => {
    ev.preventDefault();
    const mail = document.getElementById('inv-mail').value.trim();
    try { S.lastInvite = await rpc('create_invite', { p_email: mail }); S.invites = (await rpc('list_invites')) || []; renderAdmin(); }
    catch (e) { toast(errText(e)); }
  };
  const act2 = async (sel, fn, msg, ask) => $app.querySelectorAll(sel).forEach((b) => b.onclick = async () => {
    if (ask && !confirm(ask)) return;
    b.disabled = true;
    try { await fn(b); await loadData(); renderAdmin(); if (msg) toast(msg); }
    catch (e) { toast(errText(e)); b.disabled = false; }
  });
  act2('[data-ev-ok]', (b) => rpc('decide_event', { p_event: b.dataset.evOk, p_ok: true }), 'Etkinlik onaylandı, herkese duyuruldu');
  act2('[data-ev-no]', (b) => rpc('decide_event', { p_event: b.dataset.evNo, p_ok: false }), 'Etkinlik reddedildi', 'Bu etkinliği reddetmek istiyor musun?');
  act2('[data-m-ok]', (b) => rpc('decide_member', { p_user: b.dataset.mOk, p_ok: true }), 'Üye onaylandı');
  act2('[data-m-no]', (b) => rpc('decide_member', { p_user: b.dataset.mNo, p_ok: false }), 'Kayıt reddedildi', 'Bu kaydı reddetmek istiyor musun?');
  act2('[data-rm]', (b) => rpc('remove_member', { p_user: b.dataset.rm }), 'Üye çıkarıldı', 'Bu kişiyi gruptan çıkarmak istiyor musun? Erişimi hemen kesilir.');
  act2('[data-inv-del]', (b) => rpc('cancel_invite', { p_code: b.dataset.invDel }).then(() => { if (S.lastInvite?.code === b.dataset.invDel) S.lastInvite = null; }), 'Davet iptal edildi');
  $app.querySelectorAll('[data-inv-share]').forEach((b) => b.onclick = () => shareInvite(S.invites.find((i) => i.code === b.dataset.invShare) || { code: b.dataset.invShare }));
  document.getElementById('inv-copy')?.addEventListener('click', () => copyText(S.lastInvite.code));
  document.getElementById('inv-share')?.addEventListener('click', () => shareInvite(S.lastInvite));
}
function inviteBox(inv) {
  return `<div class="code-box"><div><div class="code">${esc(inv.code)}</div><div class="small" style="color:var(--accent-ink)">${esc(inv.email)} · 48 saat geçerli</div></div>
    <button class="icon-btn" id="inv-copy" aria-label="Kodu kopyala" style="border:none">${svg('copy')}</button></div>
    <button class="btn block" id="inv-share">${svg('share')}Daveti paylaş</button>`;
}
function appUrl() { return location.origin + location.pathname.replace(/index\.html$/, ''); }
async function shareInvite(inv) {
  const text = `Tayfa'ya davetlisin!\n\n1) Bu linki Safari (iPhone) ya da Chrome (Android) ile aç: ${appUrl()}\n2) Ana ekrana ekle\n3) "Kayıt ol" de ve şu kodu gir: ${inv.code}\n\nKod sadece ${inv.email || 'davet edilen'} e-postasıyla, 48 saat çalışır.`;
  if (navigator.share) { try { await navigator.share({ text }); return; } catch (e) { if (e?.name === 'AbortError') return; } }
  copyText(text, 'Davet metni kopyalandı');
}
async function copyText(t, msg = 'Kopyalandı') {
  try { await navigator.clipboard.writeText(t); toast(msg); } catch (_) { prompt('Kopyala:', t); }
}

// ------------------------------------------------------------------ alt sayfalar (sheet)
function openSheet(html, onMount) {
  $sheet.innerHTML = `<div class="sheet-backdrop" id="sb"><div class="sheet" role="dialog" aria-modal="true"><div class="grab"></div>${html}</div></div>`;
  const bd = document.getElementById('sb');
  bd.addEventListener('click', (e) => { if (e.target === bd) closeSheet(); });
  $sheet.querySelectorAll('[data-close]').forEach((b) => b.onclick = closeSheet);
  onMount?.($sheet.querySelector('.sheet'));
}
function closeSheet() { $sheet.innerHTML = ''; }
const sheetHead = (t) => `<div class="sheet-head"><h2 style="font-size:20px">${t}</h2><button class="icon-btn x-btn" data-close aria-label="Kapat">${svg('x')}</button></div>`;

function showEventSheet(pre = {}) {
  const d = new Date(Date.now() + 24 * 3600 * 1000); d.setMinutes(0, 0, 0); d.setHours(20);
  const local = pre.when || new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  openSheet(`${sheetHead(isAdmin() ? 'Etkinlik' : 'Etkinlik öner')}
    ${isAdmin() ? '' : '<p class="info">Önerin yöneticinin onayından sonra herkese duyurulur.</p>'}
    <form id="ev-form" style="display:flex;flex-direction:column;gap:14px" novalidate>
      ${field('ev-title', 'Ne yapıyoruz?', 'text', 'Halı saha, kahvaltı, mangal…', 'maxlength="80"', pre.title || '')}
      <div class="field"><label for="f-ev-when">Ne zaman?</label><input class="input" id="f-ev-when" type="datetime-local" value="${esc(local)}"></div>
      ${field('ev-place', 'Nerede? (isteğe bağlı)', 'text', 'Mekân ya da adres', 'maxlength="80"', pre.place || '')}
      <button type="button" class="btn block" id="ev-loc">${svg('pin')}${pre.lat != null ? 'Konum seçildi · değiştir' : 'Haritada konum seç (hava durumu için)'}</button>
      <div class="field"><label for="f-ev-note">Not (isteğe bağlı)</label><textarea class="input" id="f-ev-note" maxlength="500" placeholder="Topu getiren, saat değişikliği…">${esc(pre.note || '')}</textarea></div>
      <p class="err" id="ev-err"></p>
      <button class="btn primary block" style="height:52px" type="submit" id="ev-btn">${isAdmin() ? 'Ekle ve duyur' : 'Öneriyi gönder'}</button>
    </form>`, () => {
    const grab = () => ({ ...pre, title: val('ev-title'), when: document.getElementById('f-ev-when').value, place: val('ev-place'), note: document.getElementById('f-ev-note').value });
    document.getElementById('ev-loc').onclick = () => {
      const keep = grab();
      Anilar.pickLocation({ lat: keep.lat ?? null, lng: keep.lng ?? null }, async (ll) => {
        keep.lat = ll.lat; keep.lng = ll.lng;
        setTimeout(() => showEventSheet(keep), 0);
      });
    };
    document.getElementById('ev-form').onsubmit = async (ev) => {
      ev.preventDefault();
      const err = document.getElementById('ev-err'); const btn = document.getElementById('ev-btn');
      const title = val('ev-title'); const when = document.getElementById('f-ev-when').value;
      if (!title) return (err.textContent = 'Etkinliğin adını yaz.');
      if (!when) return (err.textContent = 'Tarih ve saat seç.');
      btn.disabled = true;
      try {
        const args = { p_title: title, p_place: val('ev-place'), p_note: document.getElementById('f-ev-note').value.trim(), p_starts_at: new Date(when).toISOString() };
        if (pre.lat != null) Object.assign(args, { p_lat: pre.lat, p_lng: pre.lng });
        await rpc('propose_event', args);
        closeSheet(); await loadData(); render();
        toast(isAdmin() ? 'Etkinlik eklendi, herkese duyuruldu' : 'Önerin yöneticiye gönderildi');
      } catch (e) { err.textContent = errText(e); btn.disabled = false; }
    };
  });
}

function showWhoSheet(eid) {
  const e = S.events.find((x) => x.id === eid); if (!e) return;
  const rs = S.rsvps.filter((r) => r.event_id === eid);
  const by = (a) => rs.filter((r) => r.answer === a).map((r) => r.user_id);
  const answered = new Set(rs.map((r) => r.user_id));
  const silent = activeMembers().filter((m) => !answered.has(m.user_id)).map((m) => m.user_id);
  const block = (t, ids) => ids.length ? `<p class="section-title">${t} · ${ids.length}</p>` + ids.map((u) => `<div class="list-row">${avatar(nameOf(u), u, 'lg')}<div class="grow name">${esc(nameOf(u))}</div></div>`).join('') : '';
  openSheet(`${sheetHead(esc(e.title))}<p class="sub">${esc(fmt.long(new Date(e.starts_at)))}${e.place ? ' · ' + esc(e.place) : ''}</p>
    ${block('Geliyor', by('yes'))}${block('Gelemiyor', by('no'))}${block('Cevap vermedi', silent)}`);
}

function showNotifySheet() {
  const st = pushState();
  const text = {
    granted: 'Bildirimler bu cihazda açık. Yeni etkinlikler ve onaylar sana bildirim olarak gelir.',
    default: 'Bildirimleri açarsan yeni etkinlikler, onaylar ve hatırlatmalar telefonuna gelir.',
    denied: 'Bildirimler telefon ayarlarından kapatılmış. Ayarlar > Bildirimler > Tayfa bölümünden açabilirsin.',
    'needs-install': 'iPhone\'da bildirim alabilmek için Tayfa\'yı önce ana ekrana eklemelisin.',
    unsupported: 'Bu tarayıcı bildirimleri desteklemiyor. iPhone\'da Safari, Android\'de Chrome kullan.',
  }[st];
  openSheet(`${sheetHead('Bildirimler')}<p class="sub" style="line-height:1.5">${text}</p>
    ${st === 'default' ? `<button class="btn primary block" id="n-on">${svg('bell')}Bildirimleri aç</button>` : ''}
    ${st === 'needs-install' ? `<button class="btn primary block" id="n-inst">Nasıl eklenir?</button>` : ''}
    ${st === 'granted' ? `<button class="btn block" id="n-test">Bu cihazı yeniden kaydet</button>` : ''}
    <p class="section-title">Sohbet bildirimleri</p>
    <div class="seg3">${[['all', 'Tümü'], ['mentions', 'Bahsedilince'], ['off', 'Kapalı']].map(([k, l]) =>
      `<button data-cn="${k}" class="${(S.members.find((m) => m.user_id === me())?.chat_notify || 'all') === k ? 'on' : ''}">${l}</button>`).join('')}</div>
    <p class="small">Etkinlikler, onaylar ve oyun sırası bildirimleri bu ayardan etkilenmez.</p>`, () => {
    document.querySelectorAll('[data-cn]').forEach((b) => b.onclick = async () => {
      try {
        await rpc('set_chat_notify', { p_mode: b.dataset.cn });
        const m = S.members.find((x) => x.user_id === me()); if (m) m.chat_notify = b.dataset.cn;
        document.querySelectorAll('[data-cn]').forEach((x) => x.classList.toggle('on', x === b));
        toast('Kaydedildi');
      } catch (e) { toast(errText(e)); }
    });
    document.getElementById('n-on')?.addEventListener('click', async () => { await enablePush(); closeSheet(); render(); });
    document.getElementById('n-inst')?.addEventListener('click', showInstallSheet);
    document.getElementById('n-test')?.addEventListener('click', async () => { await enablePush(); closeSheet(); });
  });
}

function showInstallSheet() {
  const android = /android/i.test(navigator.userAgent);
  openSheet(`${sheetHead('Ana ekrana ekle')}
    ${android ? `<ol class="sub" style="line-height:1.7;padding-left:20px;margin:0">
      <li>Chrome'da sağ üstteki <b>⋮</b> menüsüne dokun.</li>
      <li><b>Uygulamayı yükle</b> ya da <b>Ana ekrana ekle</b>'yi seç.</li>
      <li>Tayfa'yı ana ekrandaki simgesinden aç.</li></ol>`
    : `<ol class="sub" style="line-height:1.7;padding-left:20px;margin:0">
      <li>Bu sayfayı <b>Safari</b>'de aç.</li>
      <li>Alttaki <b>Paylaş</b> düğmesine (kare ve yukarı ok) dokun.</li>
      <li>Listeyi kaydırıp <b>Ana Ekrana Ekle</b>'yi seç, sonra <b>Ekle</b> de.</li>
      <li>Tayfa'yı ana ekrandaki simgesinden aç ve bildirimleri aç.</li></ol>`}
    <button class="btn block" data-close>Tamam</button>`);
}

function showProfileSheet() {
  openSheet(`${sheetHead('Profil')}
    <div class="list-row">${avatar(S.ctx.display_name, me(), 'lg')}<div class="grow"><div class="name">${esc(S.ctx.display_name)}</div>
      <div class="small">${esc(S.session.user.email)} · ${isAdmin() ? 'Yönetici' : 'Üye'} · ${esc(S.ctx.group_name)}</div></div></div>
    <a class="btn block" href="aydinlatma.html" target="_blank" style="text-decoration:none">${svg('shield')}Aydınlatma metni</a>
    <button class="btn block" id="p-notify">${svg('bell')}Bildirim ayarı</button>
    <label class="sw-row" for="p-dark"><span class="grow"><b>Koyu tema</b><span>Gece gözü yormayan koyu renkler</span></span>
      <span class="switch"><input type="checkbox" id="p-dark" ${getTheme() === 'koyu' ? 'checked' : ''}><i></i></span></label>
    <button class="btn block danger" id="p-out">Çıkış yap</button>
    <p class="diag" id="p-diag">Son bildirim bilgisi okunuyor…</p>
    <p class="small" style="text-align:center">Tayfa · Sürüm ${APP_VERSION}</p>`, () => {
    diagLine().then((t) => { const el = document.getElementById('p-diag'); if (el) el.innerHTML = t; });
    document.getElementById('p-notify').onclick = () => { closeSheet(); showNotifySheet(); };
    document.getElementById('p-dark').onchange = (e) => {
      const t = e.target.checked ? 'koyu' : 'acik';
      try { localStorage.setItem(THEME_KEY, t); } catch (_) { /* */ }
      applyTheme(t);
    };
    document.getElementById('p-out').onclick = () => { closeSheet(); logout(); };
  });
}

// Bildirim tanılama: telefona en son ne zaman bildirim geldi, dokununca uygulamaya haber ulaştı mı
async function diagLine() {
  const push = await readNote('last-push'); const click = await readNote('last-click');
  const t = (x) => x ? new Intl.DateTimeFormat('tr-TR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: TZ }).format(new Date(x.at)) : '—';
  let tap = 'henüz dokunulmadı';
  if (click) tap = `dokunma algılandı (${t(click)})`;
  if (push && (!click || click.at < push.at)) tap += ' · son bildirime dokunma algılanmadı';
  const appMsg = S.lastOpenMsg ? ` · uygulamaya ulaştı (${t({ at: S.lastOpenMsg })})` : '';
  return `<b>Son bildirim:</b> ${push ? `${esc(push.title)} · ${t(push)}` : 'bu cihazda kayıt yok'}<br><b>Dokunma:</b> ${tap}${appMsg}<br><b>İzin:</b> ${esc({ granted: 'açık', default: 'sorulmadı', denied: 'kapalı', 'needs-install': 'ana ekrana eklenmeli', unsupported: 'desteklenmiyor' }[pushState()])}`;
}

async function logout() {
  if (!confirm('Çıkış yapmak istiyor musun? Bu cihaza bildirim gelmeyi bırakır.')) return;
  await disablePushForThisDevice();
  await sb.auth.signOut();
}

// ------------------------------------------------------------------ başlangıç
async function onSession(session) {
  S.session = session;
  if (!session) {
    if (channel) { sb.removeChannel(channel); channel = null; }
    S.ctx = {}; S.events = []; S.members = []; S.view = 'main';
    try { S.setupNeeded = await rpc('setup_needed'); } catch (_) { S.setupNeeded = false; }
    return render();
  }
  const fast = loadSnapshot();
  if (fast) { render(); if (location.hash) route(location.hash); }
  try {
    await loadContext();
    await loadData();
    subscribeRealtime();
    enablePush({ silent: true }); // izin önceden verildiyse aboneliği tazele
    if (S.ctx.status === 'active') {
      ensureDevice(me(), rpc).catch((e) => console.warn('cihaz anahtarı', e)); // şifreli sohbet için
      Oyunlar.loadMyTurns().then(updateTabDots).catch(() => {});
      Anilar.warmUp();
    }
  } catch (e) { if (!fast) toast(errText(e)); }
  if (!fast || S.view === 'main' && S.tab === 'home' || S.ctx.status !== 'active') render();
  else updateTabDots();
  if (location.hash && !fast) route(location.hash);
  checkPendingSoon();
}

let lastUid;
sb.auth.onAuthStateChange((event, session) => {
  const uid = session?.user?.id;
  if (event === 'TOKEN_REFRESHED' && uid === lastUid) { S.session = session; return; }
  lastUid = uid;
  setTimeout(() => onSession(session)); // supabase kilidinin dışında çalıştır
});

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  if (pendingReload && safeToReload()) { location.reload(); return; }
  swReg?.update?.().catch(() => {});
  if (S.session) { checkPendingSoon(); refreshAll(); }
});
window.addEventListener('hashchange', () => route(location.hash));
navigator.serviceWorker?.addEventListener('message', (e) => {
  if (e.data?.type === 'open' && e.data.url) {
    S.lastOpenMsg = Date.now();
    let ok = false;
    try { ok = route(new URL(e.data.url).hash || '#ana'); } catch (_) { /* */ }
    if (ok) caches.open('tayfa-yonlendirme').then((c) => c.delete('pending')).catch(() => {});
  }
  if (S.session) refreshAll();
});

try { navigator.serviceWorker?.startMessages?.(); } catch (_) { /* */ }

export {
  S, esc, svg, ICON, avatar, toast, errText, rpc, fmt, openSheet, closeSheet, sheetHead, field, val,
  isAdmin, me, nameOf, activeMembers, render, header, bindHeader, svgInline, copyText, loadData, goBack,
};

registerSW();
