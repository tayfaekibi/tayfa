import { createClient } from './vendor/supabase.js';
import { SUPABASE_URL, SUPABASE_KEY, VAPID_PUBLIC_KEY, APP_VERSION } from './config.js';
import * as Anilar from './anilar.js';
import * as Sohbet from './sohbet.js';
import * as Oyunlar from './oyunlar.js';
import { ensureDevice } from './e2e.js';

export const sb = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
});

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

// Bildirime dokununca gidilecek yer (servis çalışanı kaydeder)
async function checkPendingRoute() {
  try {
    const c = await caches.open('tayfa-yonlendirme');
    const r = await c.match('pending');
    if (!r) return;
    const target = await r.text();
    await c.delete('pending');
    route(new URL(target).hash);
  } catch (_) { /* */ }
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
    sb.from('members').select('user_id, display_name, role, status, created_at, chat_notify').eq('group_id', S.ctx.group_id),
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
function render() {
  if (!S.session) return renderAuth();
  if (!S.ctx.status) return renderNoGroup();
  if (S.ctx.status === 'pending') return renderPending();
  if (S.view === 'admin' && isAdmin()) return renderAdmin();
  if (S.view === 'album') return Anilar.renderAlbum();
  if (S.view === 'game') return Oyunlar.renderGame();
  renderMain();
}

// Bildirim bağlantıları ve adres çubuğu: #yonetim, #anilar, #album/<id>, #sohbet, #oyun/<id>
export function route(hash) {
  if (!S.session || S.ctx.status !== 'active') return;
  const [k, id] = String(hash || '').replace(/^#/, '').split('/');
  if (k === 'yonetim' && isAdmin()) { S.view = 'admin'; }
  else if (k === 'album' && id) { S.view = 'album'; S.albumId = id; }
  else if (k === 'oyun' && id) { S.view = 'game'; S.gameId = id; }
  else if (k === 'sohbet') { S.view = 'main'; S.tab = 'chat'; }
  else if (k === 'anilar') { S.view = 'main'; S.tab = 'memory'; }
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
      return;
    }
  }
  else return;
  closeSheet();
  render();
}
export function goMain(tab) {
  S.view = 'main'; if (tab) S.tab = tab;
  if (location.hash) history.replaceState(null, '', location.pathname);
  render();
}

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
  $app.innerHTML = `<div class="screen">
    <main class="content ${S.tab === 'chat' ? 'chat-content' : ''}">${body}</main>
    ${S.tab === 'home' ? `<button class="fab" id="fab">${svg('plus')}${isAdmin() ? 'Plan aç' : 'Plan öner'}</button>` : ''}
    <nav class="tabbar" aria-label="Ana menü">${tabs.map(([k, l, i]) => `<button class="tab ${S.tab === k ? 'on' : ''}" data-tab="${k}">${svg(i)}<span>${l}</span><i class="tab-dot hidden" data-dot="${k}"></i></button>`).join('')}</nav>
  </div>`;
  $app.querySelectorAll('[data-tab]').forEach((b) => b.onclick = () => { S.tab = b.dataset.tab; renderMain(); window.scrollTo(0, 0); });
  document.getElementById('fab')?.addEventListener('click', showEventSheet);
  bindHome();
  if (S.tab === 'memory') Anilar.mount();
  else if (S.tab === 'chat') Sohbet.mount();
  else if (S.tab === 'game') Oyunlar.mount();
  updateTabDots();
}
export function updateTabDots() {
  const d = $app.querySelector('[data-dot="chat"]');
  if (d) d.classList.toggle('hidden', !(S.unreadChat && S.tab !== 'chat'));
  const g = $app.querySelector('[data-dot="game"]');
  if (g) g.classList.toggle('hidden', !(S.myTurnGames > 0 && S.tab !== 'game'));
}

function header(title, subtitle) {
  const ps = pushState();
  const bellDot = ps !== 'granted' ? '<span class="dot"></span>' : '';
  const adminDot = pendingMembers().length + pendingEvents().length > 0 ? '<span class="dot"></span>' : '';
  return `<header class="topbar"><div><h1>${title}</h1>${subtitle ? `<p class="sub" style="margin-top:2px">${subtitle}</p>` : ''}</div>
    <div class="topbar-actions">
      <button class="icon-btn" id="h-bell" aria-label="Bildirimler">${svg('bell')}${bellDot}</button>
      ${isAdmin() ? `<button class="icon-btn" id="h-admin" aria-label="Yönetim">${svg('shield')}${adminDot}</button>` : ''}
      <button class="icon-btn" id="h-me" aria-label="Profil">${svg('user')}</button>
    </div></header>`;
}
function bindHeader() {
  document.getElementById('h-bell')?.addEventListener('click', showNotifySheet);
  document.getElementById('h-admin')?.addEventListener('click', () => { S.view = 'admin'; location.hash = 'yonetim'; render(); window.scrollTo(0, 0); });
  document.getElementById('h-me')?.addEventListener('click', showProfileSheet);
}

function homeView() {
  const first = (S.ctx.display_name || '').split(' ')[0];
  const upcoming = S.events.filter((e) => e.status === 'approved');
  const myPending = S.events.filter((e) => e.status === 'pending' && e.created_by === me());
  const waitCount = pendingMembers().length + pendingEvents().length;
  let h = header(`Merhaba ${esc(first)}`, upcoming.length ? `Yaklaşan ${upcoming.length} plan var` : esc(S.ctx.group_name));
  if (isAdmin() && waitCount) {
    const parts = [];
    if (pendingEvents().length) parts.push(`${pendingEvents().length} plan`);
    if (pendingMembers().length) parts.push(`${pendingMembers().length} üye`);
    h += `<button class="banner" id="go-admin"><span class="pip"></span><span class="grow">${parts.join(' ve ')} onayını bekliyor</span><span>İncele</span></button>`;
  }
  if (pushState() !== 'granted') {
    h += `<button class="banner" id="go-push" style="background:var(--accent-soft);border-color:#F3D9CC;color:var(--accent-ink)"><span class="pip" style="background:var(--accent)"></span><span class="grow">${pushState() === 'needs-install' ? 'Bildirim almak için Tayfa\'yı ana ekrana ekle' : 'Yeni planlardan haberdar olmak için bildirimleri aç'}</span><span>Aç</span></button>`;
  }
  if (myPending.length) {
    h += `<p class="section-title">Onayını bekleyen önerilerin</p>`;
    h += myPending.map((e) => `<section class="card"><div class="ev-head">${dateBox(e)}<div style="flex:1;min-width:0"><h2>${esc(e.title)}</h2>
      <div class="ev-meta"><span>${esc(fmt.short(new Date(e.starts_at)))}</span>${e.place ? `<span>${esc(e.place)}</span>` : ''}</div></div>
      <span class="pill" style="background:var(--warn-bg);color:var(--warn-ink)">Onay bekliyor</span></div>
      <button class="btn small danger" data-withdraw="${e.id}" style="align-self:flex-start">Öneriyi geri çek</button></section>`).join('');
  }
  h += `<p class="section-title">Yaklaşan planlar</p>`;
  if (!upcoming.length) {
    h += `<div class="card"><div class="empty">${svg('cal')}<b style="color:var(--ink)">Henüz plan yok</b><span>${isAdmin() ? 'İlk planı sen aç.' : 'Bir plan öner, yönetici onaylayınca herkese duyurulsun.'}</span></div></div>`;
  } else h += upcoming.map(eventCard).join('');
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
      <div class="ev-meta"><span>${svgInline('clock')}${esc(fmt.time(d))}</span>${e.place ? `<span>${svgInline('pin')}${esc(e.place)}</span>` : ''}</div></div></div>
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
      ${isAdmin() ? `<button class="btn small danger" data-del="${e.id}">Planı sil</button>` : ''}
    </div>
  </section>`;
}
const svgInline = (n) => `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;margin-right:4px" aria-hidden="true">${ICON[n]}</svg>`;

function bindHome() {
  bindHeader();
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
    if (!confirm('Bu plan herkes için silinecek. Emin misin?')) return;
    try { await rpc('delete_event', { p_event: b.dataset.del }); await loadData(); render(); toast('Plan silindi'); }
    catch (e) { toast(errText(e)); }
  });
  $app.querySelectorAll('[data-who]').forEach((b) => b.onclick = () => showWhoSheet(b.dataset.who));
  $app.querySelectorAll('[data-com]').forEach((b) => b.onclick = () => {
    const e = S.events.find((x) => x.id === b.dataset.com);
    Anilar.showComments('event', b.dataset.com, e?.title || 'Plan', async () => { await loadData(); if (S.view === 'main' && S.tab === 'home') render(); });
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

    <section class="card"><div style="display:flex;justify-content:space-between;align-items:center"><h2>Onay bekleyen planlar</h2>${pe.length ? `<span class="pill" style="background:var(--accent);color:#fff">${pe.length}</span>` : ''}</div>
      ${pe.length ? pe.map((e) => `<div style="display:flex;flex-direction:column;gap:10px;padding-top:4px">
        <div class="list-row">${avatar(nameOf(e.created_by), e.created_by, 'lg')}<div class="grow"><div class="name">${esc(e.title)}</div>
        <div class="small">${esc(nameOf(e.created_by))} önerdi · ${esc(fmt.short(new Date(e.starts_at)))}${e.place ? ' · ' + esc(e.place) : ''}</div></div></div>
        ${e.note ? `<p class="ev-note small" style="color:var(--ink)">${esc(e.note)}</p>` : ''}
        <div class="row2"><button class="btn primary" data-ev-ok="${e.id}">Onayla ve duyur</button><button class="btn" data-ev-no="${e.id}">Reddet</button></div></div>`).join('<hr style="border:none;border-top:1px solid var(--line);margin:4px 0">')
      : '<p class="small">Onay bekleyen plan yok.</p>'}
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
  act2('[data-ev-ok]', (b) => rpc('decide_event', { p_event: b.dataset.evOk, p_ok: true }), 'Plan onaylandı, herkese duyuruldu');
  act2('[data-ev-no]', (b) => rpc('decide_event', { p_event: b.dataset.evNo, p_ok: false }), 'Plan reddedildi', 'Bu planı reddetmek istiyor musun?');
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
const sheetHead = (t) => `<div class="sheet-head"><h2 style="font-size:20px">${t}</h2><button class="icon-btn" data-close aria-label="Kapat" style="width:38px;height:38px;border:none;background:#EFE9E4">${svg('x')}</button></div>`;

function showEventSheet() {
  const d = new Date(Date.now() + 24 * 3600 * 1000); d.setMinutes(0, 0, 0); d.setHours(20);
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  openSheet(`${sheetHead(isAdmin() ? 'Plan aç' : 'Plan öner')}
    ${isAdmin() ? '' : '<p class="info">Önerin yöneticinin onayından sonra herkese duyurulur.</p>'}
    <form id="ev-form" style="display:flex;flex-direction:column;gap:14px" novalidate>
      ${field('ev-title', 'Ne yapıyoruz?', 'text', 'Halı saha, kahvaltı, mangal…', 'maxlength="80"')}
      <div class="field"><label for="f-ev-when">Ne zaman?</label><input class="input" id="f-ev-when" type="datetime-local" value="${local}"></div>
      ${field('ev-place', 'Nerede? (isteğe bağlı)', 'text', 'Mekân ya da adres', 'maxlength="80"')}
      <div class="field"><label for="f-ev-note">Not (isteğe bağlı)</label><textarea class="input" id="f-ev-note" maxlength="500" placeholder="Topu getiren, saat değişikliği…"></textarea></div>
      <p class="err" id="ev-err"></p>
      <button class="btn primary block" style="height:52px" type="submit" id="ev-btn">${isAdmin() ? 'Planı aç ve duyur' : 'Öneriyi gönder'}</button>
    </form>`, () => {
    document.getElementById('ev-form').onsubmit = async (ev) => {
      ev.preventDefault();
      const err = document.getElementById('ev-err'); const btn = document.getElementById('ev-btn');
      const title = val('ev-title'); const when = document.getElementById('f-ev-when').value;
      if (!title) return (err.textContent = 'Planın adını yaz.');
      if (!when) return (err.textContent = 'Tarih ve saat seç.');
      btn.disabled = true;
      try {
        await rpc('propose_event', { p_title: title, p_place: val('ev-place'), p_note: document.getElementById('f-ev-note').value.trim(), p_starts_at: new Date(when).toISOString() });
        closeSheet(); await loadData(); render();
        toast(isAdmin() ? 'Plan açıldı, herkese duyuruldu' : 'Önerin yöneticiye gönderildi');
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
    granted: 'Bildirimler bu cihazda açık. Yeni planlar ve onaylar sana bildirim olarak gelir.',
    default: 'Bildirimleri açarsan yeni planlar, onaylar ve hatırlatmalar telefonuna gelir.',
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
    <p class="small">Planlar, onaylar ve oyun sırası bildirimleri bu ayardan etkilenmez.</p>`, () => {
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
    <button class="btn block danger" id="p-out">Çıkış yap</button>
    <p class="small" style="text-align:center">Tayfa · Sürüm ${APP_VERSION}</p>`, () => {
    document.getElementById('p-notify').onclick = () => { closeSheet(); showNotifySheet(); };
    document.getElementById('p-out').onclick = () => { closeSheet(); logout(); };
  });
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
  checkPendingRoute();
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
  if (S.session) { checkPendingRoute(); refreshAll(); }
});
window.addEventListener('hashchange', () => route(location.hash));
navigator.serviceWorker?.addEventListener('message', (e) => {
  if (e.data?.type === 'open' && e.data.url) {
    caches.open('tayfa-yonlendirme').then((c) => c.delete('pending')).catch(() => {});
    try { route(new URL(e.data.url).hash); } catch (_) { /* */ }
  }
  if (S.session) refreshAll();
});

export {
  S, esc, svg, ICON, avatar, toast, errText, rpc, fmt, openSheet, closeSheet, sheetHead, field, val,
  isAdmin, me, nameOf, activeMembers, render, header, bindHeader, svgInline, copyText, loadData,
};

registerSW();
