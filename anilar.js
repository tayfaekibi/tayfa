// Anılar: harita, albümler, fotoğraf yükleme (sadece yönetici) ve görüntüleyici
import {
  sb, S, esc, svg, avatar, toast, errText, rpc, fmt, openSheet, closeSheet, sheetHead, field, val,
  isAdmin, me, nameOf, render, header, bindHeader, goMain,
} from './app.js';

const ROAD_STYLE = 'https://tiles.openfreemap.org/styles/liberty';
const ESRI = 'https://server.arcgisonline.com/ArcGIS/rest/services/';
const SAT_STYLE = {
  version: 8,
  sources: {
    sat: { type: 'raster', tileSize: 256, maxzoom: 19, tiles: [ESRI + 'World_Imagery/MapServer/tile/{z}/{y}/{x}'],
      attribution: 'Uydu: Esri, Maxar, Earthstar Geographics ve GIS kullanıcı topluluğu' },
    roads: { type: 'raster', tileSize: 256, maxzoom: 19, tiles: [ESRI + 'Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}'] },
    places: { type: 'raster', tileSize: 256, maxzoom: 19, tiles: [ESRI + 'Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}'] },
  },
  layers: [{ id: 'sat', type: 'raster', source: 'sat' }, { id: 'roads', type: 'raster', source: 'roads' }, { id: 'places', type: 'raster', source: 'places' }],
};
function mapKind() { try { return localStorage.getItem('tayfa-harita') === 'yol' ? 'yol' : 'uydu'; } catch (_) { return 'uydu'; } } // varsayılan: uydu
function setMapKind(k) { try { localStorage.setItem('tayfa-harita', k); } catch (_) { /* */ } }
const styleFor = (k) => (k === 'uydu' ? SAT_STYLE : ROAD_STYLE);
function addKindToggle(wrap, m) {
  const b = document.createElement('button');
  b.className = 'map-kind';
  const label = () => { b.innerHTML = mapKind() === 'uydu' ? '🗺️ Yol' : '🛰️ Uydu'; };
  label();
  b.onclick = (e) => { e.stopPropagation(); const k = mapKind() === 'uydu' ? 'yol' : 'uydu'; setMapKind(k); m.setStyle(styleFor(k)); label(); };
  wrap.appendChild(b);
}
const MAPLIBRE = 'vendor/maplibre-gl';
const TR_CENTER = [35.2, 39.0];

const A = { albums: [], mode: 'map', photos: [], likes: [], loose: [], selecting: false, selected: new Set() };
const isLoose = (a) => !!a?.is_loose;
let map = null;

// ------------------------------------------------------------------ imzalı (süreli) bağlantılar
// Bağlantılar 24 saat geçerli ve telefonda saklanır: aynı fotoğraf için tekrar sunucuya sorulmaz
const URL_KEY = 'tayfa-foto-url';
const URL_TTL = 24 * 3600;
const urlCache = (() => {
  try { return new Map(Object.entries(JSON.parse(localStorage.getItem(URL_KEY) || '{}'))); } catch (_) { return new Map(); }
})();
function saveUrls() {
  try {
    const now = Date.now();
    for (const [k, v] of urlCache) if (!(v.exp > now)) urlCache.delete(k);
    localStorage.setItem(URL_KEY, JSON.stringify(Object.fromEntries(urlCache)));
  } catch (_) { /* */ }
}
async function signed(paths) {
  const now = Date.now();
  const need = [...new Set(paths.filter((p) => p && !(urlCache.get(p)?.exp > now + 600000)))];
  for (let i = 0; i < need.length; i += 100) {
    const chunk = need.slice(i, i + 100);
    const { data, error } = await sb.storage.from('photos').createSignedUrls(chunk, URL_TTL);
    if (error) throw error;
    for (const r of data || []) if (r.signedUrl) urlCache.set(r.path, { url: r.signedUrl, exp: now + URL_TTL * 1000 });
  }
  if (need.length) saveUrls();
  return (p) => urlCache.get(p)?.url || '';
}
// Haritayı önceden yükle (Anılar'a girmeden, boşta)
export function warmUp() {
  if (window.maplibregl) return;
  const go = () => loadMapLibre().catch(() => {});
  (window.requestIdleCallback || ((f) => setTimeout(f, 2500)))(go);
}

async function loadAlbums() {
  const { data, error } = await sb.from('albums').select('*').eq('group_id', S.ctx.group_id)
    .order('taken_on', { ascending: false }).order('created_at', { ascending: false });
  if (error) throw error;
  A.albums = data || [];
}

const dateTr = (d) => d ? new Intl.DateTimeFormat('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(d + 'T12:00:00')) : '';

// ------------------------------------------------------------------ sekme
export function tabView() {
  return `${header('Anılar', '<span id="al-sub">Yükleniyor…</span>')}
    <div style="display:flex;gap:8px;align-items:center">
      <div class="seg" style="flex:1">
        <button data-am="map" class="${A.mode === 'map' ? 'on' : ''}">Harita</button>
        <button data-am="list" class="${A.mode === 'list' ? 'on' : ''}">Albümler</button>
      </div>
      ${isAdmin() ? `<button class="btn primary" id="al-new" style="height:46px">${svg('upload')}Yükle</button>` : ''}
    </div>
    <div id="al-body"></div>`;
}

export async function mount() {
  bindHeader();
  document.querySelectorAll('[data-am]').forEach((b) => b.onclick = () => { A.mode = b.dataset.am; render(); });
  document.getElementById('al-new')?.addEventListener('click', uploadChooser);
  try { await loadAlbums(); } catch (e) { toast(errText(e)); }
  const sub = document.getElementById('al-sub');
  if (!sub) return;
  const total = A.albums.reduce((n, a) => n + a.photo_count, 0);
  const named = A.albums.filter((a) => !isLoose(a)).length;
  sub.textContent = total || named ? `${total} fotoğraf · ${named} albüm` : 'Henüz anı yok';
  if (A.mode === 'map') await drawMap(); else await drawList();
}

async function drawList() {
  const box = document.getElementById('al-body');
  const list = A.albums.filter((a) => !isLoose(a) || a.photo_count > 0).sort((x, y) => isLoose(y) - isLoose(x));
  if (!list.length) { box.innerHTML = emptyState(); bindEmpty(); return; }
  const url = await signed(list.map((a) => a.cover_thumb));
  box.innerHTML = `<div class="album-grid">${list.map((a) => `
    <button class="album-card" data-album="${a.id}">
      <div class="album-cover nosave" style="${a.cover_thumb ? `background-image:url('${url(a.cover_thumb)}')` : ''}">${a.cover_thumb ? '' : svg('img')}</div>
      <div class="album-meta"><b>${esc(a.title)}</b><span>${isLoose(a) ? 'Albümsüz' : esc(dateTr(a.taken_on))} · ${a.photo_count} fotoğraf</span></div>
    </button>`).join('')}</div>`;
  box.querySelectorAll('[data-album]').forEach((b) => b.onclick = () => openAlbum(b.dataset.album));
}

function emptyState() {
  return `<div class="card"><div class="empty">${svg('map')}<b style="color:var(--ink)">Henüz anı yok</b>
    <span>${isAdmin() ? 'İlk albümü "Yükle" ile oluştur. Fotoğraflar çekildikleri yerde haritada görünür.' : 'Yönetici fotoğraf yükleyince burada ve haritada görünecek.'}</span></div></div>`;
}
function bindEmpty() {}

// ------------------------------------------------------------------ harita
let mlPromise = null;
function loadMapLibre() {
  if (window.maplibregl) return Promise.resolve(window.maplibregl);
  if (!mlPromise) {
    mlPromise = new Promise((res, rej) => {
      const css = document.createElement('link'); css.rel = 'stylesheet'; css.href = MAPLIBRE + '.css'; document.head.appendChild(css);
      const js = document.createElement('script'); js.src = MAPLIBRE + '.js';
      js.onload = () => res(window.maplibregl); js.onerror = () => { mlPromise = null; rej(new Error('Harita yüklenemedi')); };
      document.head.appendChild(js);
    });
  }
  return mlPromise;
}

async function drawMap() {
  const box = document.getElementById('al-body');
  box.innerHTML = `<div class="map-wrap"><div id="map" class="map"></div></div><div id="map-card"></div>`;
  let ml;
  try { ml = await loadMapLibre(); } catch (e) { box.innerHTML = `<div class="card"><p class="sub">${esc(e.message)}. İnternet bağlantını kontrol et.</p></div>`; return; }
  if (!document.getElementById('map')) return;
  if (map) { try { map.remove(); } catch (_) { /* */ } }
  map = new ml.Map({ container: 'map', style: styleFor(mapKind()), center: TR_CENTER, zoom: 4.6, attributionControl: { compact: true } });
  addKindToggle(box.querySelector('.map-wrap'), map);
  map.touchPitch?.disable?.(); map.dragRotate.disable(); map.touchZoomRotate.disableRotation();
  map.on('load', () => map.resize());
  setTimeout(() => map && map.resize(), 300);
  const pts = A.albums.filter((a) => !isLoose(a) && a.lat != null && a.lng != null);
  const la = A.albums.find(isLoose);
  A.loose = [];
  if (la?.photo_count) {
    const r = await sb.from('photos').select('*').eq('album_id', la.id).not('lat', 'is', null).order('taken_at', { ascending: true, nullsFirst: false });
    A.loose = r.data || [];
  }
  const url = await signed(pts.map((a) => a.cover_thumb).concat(A.loose.map((p) => p.thumb_path)));
  for (const g of groupNearby(A.loose)) {
    const el = document.createElement('button');
    el.className = 'map-pin single';
    el.setAttribute('aria-label', `${g.photos.length} fotoğraf`);
    el.innerHTML = `<span class="map-pin-img nosave" style="background-image:url('${url(g.photos[0].thumb_path)}')"></span>${g.photos.length > 1 ? `<span class="map-pin-n">${g.photos.length}</span>` : ''}`;
    el.onclick = (ev) => { ev.stopPropagation(); map.easeTo({ center: [g.lng, g.lat], duration: 400 }); placeSheet({ loose: la, photos: g.photos }); };
    new ml.Marker({ element: el, anchor: 'bottom' }).setLngLat([g.lng, g.lat]).addTo(map);
  }
  for (const a of pts) {
    const el = document.createElement('button');
    el.className = 'map-pin';
    el.setAttribute('aria-label', a.title);
    el.innerHTML = `<span class="map-pin-img nosave" style="${a.cover_thumb ? `background-image:url('${url(a.cover_thumb)}')` : ''}"></span><span class="map-pin-n">${a.photo_count}</span>`;
    el.onclick = (ev) => { ev.stopPropagation(); map.easeTo({ center: [a.lng, a.lat], duration: 400 }); placeSheet({ album: a }); };
    new ml.Marker({ element: el, anchor: 'bottom' }).setLngLat([a.lng, a.lat]).addTo(map);
  }
  const all = pts.map((a) => [a.lng, a.lat]).concat(A.loose.map((p) => [p.lng, p.lat]));
  if (all.length === 1) map.jumpTo({ center: all[0], zoom: 10 });
  else if (all.length > 1) {
    const b = new ml.LngLatBounds();
    all.forEach((c) => b.extend(c));
    map.fitBounds(b, { padding: 60, maxZoom: 11, duration: 0 });
  }
  const noLoc = A.albums.filter((a) => !isLoose(a) && a.lat == null).length;
  const card = document.getElementById('map-card');
  if (!A.albums.some((a) => a.photo_count > 0 || !isLoose(a))) card.innerHTML = emptyState();
  else if (noLoc) card.innerHTML = `<p class="small" style="text-align:center">${noLoc} albümün konumu yok; "Albümler" sekmesinden görebilirsin.</p>`;
  map.on('click', () => { if (A.albums.length) card.innerHTML = ''; });
}

// ~200 m içindeki fotoğrafları tek iğnede topla
function groupNearby(list) {
  const groups = [];
  for (const p of list) {
    const g = groups.find((x) => Math.abs(x.lat - p.lat) < 0.002 && Math.abs(x.lng - p.lng) < 0.002);
    if (g) g.photos.push(p); else groups.push({ lat: p.lat, lng: p.lng, photos: [p] });
  }
  return groups;
}

// Haritada bir yere dokununca: o yerdeki fotoğraflar küçük küçük açılır, istenen seçilir
async function placeSheet(place) {
  let photos = place.photos;
  const title = place.album ? place.album.title : (photos.length > 1 ? `${photos.length} fotoğraf` : 'Fotoğraf');
  const sub = place.album ? `${dateTr(place.album.taken_on)} · ${place.album.photo_count} fotoğraf` : 'Bu konumdaki tek fotoğraflar';
  openSheet(`${sheetHead(esc(title))}<p class="sub">${esc(sub)}</p><div id="ps-grid"><p class="small">Yükleniyor…</p></div>
    ${place.album ? `<button class="btn block" id="ps-open">${svg('grid')}Albümü aç</button>` : ''}`, async () => {
    document.getElementById('ps-open')?.addEventListener('click', () => { closeSheet(); openAlbum(place.album.id); });
    try {
      if (!photos) {
        const r = await sb.from('photos').select('*').eq('album_id', place.album.id).order('taken_at', { ascending: true, nullsFirst: false }).order('created_at');
        photos = r.data || []; place.photos = photos;
      }
      const url = await signed(photos.map((p) => p.thumb_path));
      const grid = document.getElementById('ps-grid'); if (!grid) return;
      grid.innerHTML = photos.length ? `<div class="photo-grid">${photos.map((p, i) => `<button class="photo-tile nosave" data-pi="${i}" style="background-image:url('${url(p.thumb_path)}')" aria-label="Fotoğraf ${i + 1}"></button>`).join('')}</div>`
        : '<p class="small">Bu albümde henüz fotoğraf yok.</p>';
      grid.querySelectorAll('[data-pi]').forEach((b) => b.onclick = async () => {
        A.photos = photos; A.album = place.album || place.loose;
        const l = await sb.from('photo_likes').select('*').in('photo_id', photos.map((p) => p.id)); A.likes = l.data || [];
        closeSheet();
        openViewer(+b.dataset.pi, () => placeSheet(place));
      });
      // büyük hallerini arka planda hazırla: dokununca hemen açılsın
      signed(photos.slice(0, 12).map((p) => p.path)).catch(() => {});
    } catch (e) { toast(errText(e)); }
  });
}

function showMapCard(a, url) {
  const box = document.getElementById('map-card');
  if (!box) return;
  box.innerHTML = `<section class="card" style="flex-direction:row;align-items:center;gap:12px">
    <div class="album-cover small nosave" style="${a.cover_thumb ? `background-image:url('${url(a.cover_thumb)}')` : ''}"></div>
    <div style="flex:1;min-width:0"><h2>${esc(a.title)}</h2><p class="small">${esc(dateTr(a.taken_on))} · ${a.photo_count} fotoğraf${a.place ? ' · ' + esc(a.place) : ''}</p></div>
    <button class="btn small primary" id="mc-open">Aç</button></section>`;
  document.getElementById('mc-open').onclick = () => openAlbum(a.id);
}

function openAlbum(id) {
  S.view = 'album'; S.albumId = id;
  history.replaceState(null, '', '#album/' + id);
  render(); window.scrollTo(0, 0);
}

// ------------------------------------------------------------------ albüm sayfası
export async function renderAlbum() {
  const $app = document.getElementById('app');
  $app.innerHTML = `<div class="screen"><main class="content no-tabs"><button class="back" id="al-back">${svg('back')}Anılar</button><div id="album-body"><p class="sub">Yükleniyor…</p></div></main></div>`;
  document.getElementById('al-back').onclick = () => goMain('memory');
  try {
    const id = S.albumId;
    const [al, ph] = await Promise.all([
      sb.from('albums').select('*').eq('id', id).maybeSingle(),
      sb.from('photos').select('*').eq('album_id', id).order('taken_at', { ascending: true, nullsFirst: false }).order('created_at'),
    ]);
    if (al.error) throw al.error;
    if (!al.data) { document.getElementById('album-body').innerHTML = '<p class="sub">Albüm bulunamadı ya da silinmiş.</p>'; return; }
    A.album = al.data; A.photos = ph.data || []; A.selecting = false; A.selected = new Set();
    const ids = A.photos.map((p) => p.id);
    A.likes = [];
    if (ids.length) { const l = await sb.from('photo_likes').select('*').in('photo_id', ids); A.likes = l.data || []; }
    await drawAlbum();
  } catch (e) { toast(errText(e)); }
}

async function drawAlbum() {
  const a = A.album;
  const url = await signed(A.photos.map((p) => p.thumb_path));
  const box = document.getElementById('album-body');
  if (!box) return;
  box.innerHTML = `
    <header style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px">
      <div><h1 style="font-size:26px">${esc(a.title)}</h1>
      <p class="sub" style="margin-top:2px">${isLoose(a) ? 'Albüme konmamış fotoğraflar' : esc(dateTr(a.taken_on)) + (a.place ? ' · ' + esc(a.place) : '')} · ${A.photos.length} fotoğraf</p></div>
      ${isAdmin() && !isLoose(a) ? `<button class="icon-btn" id="al-menu" aria-label="Albüm seçenekleri">${svg('dots')}</button>` : ''}
    </header>
    ${isAdmin() ? (A.selecting
      ? `<div class="row2"><button class="btn primary" id="al-move" ${A.selected.size ? '' : 'disabled'}>Albüme taşı (${A.selected.size})</button><button class="btn" id="al-selx">Vazgeç</button></div>`
      : `<div class="row2"><button class="btn primary" id="al-add">${svg('upload')}Fotoğraf ekle</button>${A.photos.length ? `<button class="btn" id="al-sel">Seç ve taşı</button>` : '<span></span>'}</div>`) : ''}
    ${a.lat == null && isAdmin() && !isLoose(a) ? `<button class="banner" id="al-loc"><span class="pip"></span><span class="grow">Albümün konumu yok, haritada görünmüyor</span><span>Konum seç</span></button>` : ''}
    ${A.photos.length ? `<div class="photo-grid">${A.photos.map((p, i) => `
      <button class="photo-tile nosave ${A.selected.has(p.id) ? 'picked' : ''} ${A.selecting ? 'picking' : ''}" data-ph="${i}" style="background-image:url('${url(p.thumb_path)}')" aria-label="Fotoğraf ${i + 1}">
        ${likesOf(p.id).length ? `<span class="tile-like">${svg('heart')}${likesOf(p.id).length}</span>` : ''}</button>`).join('')}</div>`
      : `<div class="card"><div class="empty">${svg('img')}<span>Bu albümde henüz fotoğraf yok.</span></div></div>`}
`;
  box.querySelectorAll('[data-ph]').forEach((b) => b.onclick = () => {
    if (!A.selecting) return openViewer(+b.dataset.ph);
    const id = A.photos[+b.dataset.ph].id;
    if (A.selected.has(id)) A.selected.delete(id); else A.selected.add(id);
    drawAlbum();
  });
  document.getElementById('al-add')?.addEventListener('click', () => pickAndUpload(a));
  document.getElementById('al-sel')?.addEventListener('click', () => { A.selecting = true; A.selected = new Set(); drawAlbum(); });
  document.getElementById('al-selx')?.addEventListener('click', () => { A.selecting = false; A.selected = new Set(); drawAlbum(); });
  document.getElementById('al-move')?.addEventListener('click', () => moveSheet([...A.selected], () => { A.selecting = false; renderAlbum(); }));
  document.getElementById('al-loc')?.addEventListener('click', () => pickLocation(a, async (ll) => {
    await rpc('update_album', { p_album: a.id, p_title: a.title, p_place: a.place || '', p_lat: ll.lat, p_lng: ll.lng, p_taken_on: a.taken_on });
    toast('Konum kaydedildi'); renderAlbum();
  }));
  document.getElementById('al-menu')?.addEventListener('click', albumMenu);
}
const likesOf = (pid) => A.likes.filter((l) => l.photo_id === pid);

function albumMenu() {
  const a = A.album;
  openSheet(`${sheetHead(esc(a.title))}
    <button class="btn block" id="am-edit">Albümü düzenle</button>
    <button class="btn block" id="am-loc">${svg('map')}Konumu değiştir</button>
    <button class="btn block danger" id="am-del">${svg('trash')}Albümü sil</button>`, () => {
    document.getElementById('am-edit').onclick = () => { closeSheet(); showAlbumForm(a); };
    document.getElementById('am-loc').onclick = () => { closeSheet(); pickLocation(a, async (ll) => {
      await rpc('update_album', { p_album: a.id, p_title: a.title, p_place: a.place || '', p_lat: ll.lat, p_lng: ll.lng, p_taken_on: a.taken_on });
      toast('Konum kaydedildi'); renderAlbum();
    }); };
    document.getElementById('am-del').onclick = async () => {
      if (!confirm(`"${a.title}" albümü ve içindeki ${A.photos.length} fotoğraf herkes için silinecek. Emin misin?`)) return;
      try {
        const paths = await rpc('delete_album', { p_album: a.id });
        if (paths?.length) await sb.storage.from('photos').remove(paths);
        closeSheet(); toast('Albüm silindi'); goMain('memory');
      } catch (e) { toast(errText(e)); }
    };
  });
}

// ------------------------------------------------------------------ fotoğraf görüntüleyici (indirme yok)
function openViewer(start, onClose) {
  let i = start;
  const root = document.getElementById('sheet-root');
  const draw = async () => {
    const p = A.photos[i];
    const near = [i - 1, i + 1].filter((k) => k >= 0 && k < A.photos.length).map((k) => A.photos[k].path);
    const url = await signed([p.path, ...near]);
    near.forEach((k) => { const im = new Image(); im.src = url(k); }); // yandakileri önceden indir
    const liked = likesOf(p.id).some((l) => l.user_id === me());
    const n = likesOf(p.id).length;
    root.innerHTML = `<div class="viewer" id="viewer">
      <div class="viewer-top"><button class="icon-btn dark" id="v-close" aria-label="Kapat">${svg('x')}</button>
        <span>${i + 1} / ${A.photos.length}</span>
        ${isAdmin() ? `<button class="icon-btn dark" id="v-more" aria-label="Fotoğraf seçenekleri">${svg('dots')}</button>` : '<span style="width:44px"></span>'}</div>
      <div class="viewer-stage" id="v-stage"><div class="viewer-img nosave" style="background-image:url('${url(p.path)}')"></div><div class="viewer-shield"></div></div>
      <div class="viewer-bottom">
        <button class="like-btn ${liked ? 'on' : ''}" id="v-like">${svg('heart')}<span>${n || ''}</span></button>
        <span class="small" style="color:#CFC6BF">${p.taken_at ? esc(fmt.short(new Date(p.taken_at))) : ''}</span>
      </div></div>`;
    const close = () => { root.innerHTML = ''; if (onClose) onClose(); else drawAlbum(); };
    document.getElementById('v-close').onclick = close;
    document.getElementById('v-more')?.addEventListener('click', () => photoMenu(p, close, () => draw()));
    document.getElementById('v-like').onclick = async () => {
      try {
        const on = await rpc('toggle_like', { p_photo: p.id });
        A.likes = A.likes.filter((l) => !(l.photo_id === p.id && l.user_id === me()));
        if (on) A.likes.push({ photo_id: p.id, user_id: me() });
        draw();
      } catch (e) { toast(errText(e)); }
    };
    A._removeCurrent = () => {
      A.photos.splice(i, 1);
      if (!A.photos.length) { close(); return; }
      i = Math.min(i, A.photos.length - 1); draw();
    };
    const stage = document.getElementById('v-stage');
    let x0 = null;
    stage.addEventListener('touchstart', (e) => { x0 = e.touches[0].clientX; }, { passive: true });
    stage.addEventListener('touchend', (e) => {
      if (x0 == null) return;
      const dx = e.changedTouches[0].clientX - x0; x0 = null;
      if (dx < -50 && i < A.photos.length - 1) { i++; draw(); }
      else if (dx > 50 && i > 0) { i--; draw(); }
    });
    stage.addEventListener('click', (e) => {
      const w = stage.clientWidth;
      if (e.clientX > w * 0.66 && i < A.photos.length - 1) { i++; draw(); }
      else if (e.clientX < w * 0.33 && i > 0) { i--; draw(); }
    });
  };
  draw();
}

// Görüntüleyicideki "…" menüsü (yönetici): albüme taşı, konum ver, sil
function photoMenu(p, closeViewer, redraw) {
  const root = document.getElementById('sheet-root');
  const box = document.createElement('div');
  box.className = 'sheet-backdrop'; box.style.zIndex = 70;
  box.innerHTML = `<div class="sheet"><div class="grab"></div>${sheetHead('Fotoğraf')}
    <button class="btn block" id="pm-move">Albüme taşı</button>
    <button class="btn block" id="pm-loc">${svg('map')}${p.lat != null ? 'Konumu değiştir' : 'Konum ver'}</button>
    <button class="btn block danger" id="pm-del">${svg('trash')}Fotoğrafı sil</button></div>`;
  root.appendChild(box);
  const shut = () => box.remove();
  box.addEventListener('click', (e) => { if (e.target === box) shut(); });
  box.querySelector('[data-close]').onclick = shut;
  box.querySelector('#pm-move').onclick = () => { shut(); closeViewer(); moveSheet([p.id], () => (S.view === 'album' ? renderAlbum() : render())); };
  box.querySelector('#pm-loc').onclick = () => { shut(); closeViewer(); pickLocation(p, async (ll) => {
    await rpc('set_photo_location', { p_photo: p.id, p_lat: ll.lat, p_lng: ll.lng });
    toast('Konum kaydedildi');
  }); };
  box.querySelector('#pm-del').onclick = async () => {
    if (!confirm('Bu fotoğraf herkes için silinecek. Emin misin?')) return;
    shut();
    try {
      const paths = await rpc('delete_photo', { p_photo: p.id });
      if (paths?.length) await sb.storage.from('photos').remove(paths);
      A._removeCurrent?.();
      toast('Fotoğraf silindi');
    } catch (e) { toast(errText(e)); }
  };
}

// Seçilen fotoğrafları bir albüme taşı (ya da yeni albüm aç)
async function moveSheet(ids, done) {
  if (!ids.length) return;
  try { await loadAlbums(); } catch (_) { /* */ }
  const targets = A.albums.filter((a) => !isLoose(a) && a.id !== A.album?.id);
  openSheet(`${sheetHead(`${ids.length} fotoğrafı taşı`)}
    <button class="btn primary block" id="mv-new">${svg('plus')}Yeni albüm oluştur</button>
    ${targets.length ? '<p class="section-title">Mevcut albümler</p>' + targets.map((a) => `
      <button class="game-row" data-mv="${a.id}"><div class="grow"><div class="name">${esc(a.title)}</div><div class="small">${esc(dateTr(a.taken_on))} · ${a.photo_count} fotoğraf</div></div>${svg('chev')}</button>`).join('') : ''}`, () => {
    const go = async (aid) => {
      try { const n = await rpc('move_photos', { p_photos: ids, p_album: aid }); closeSheet(); toast(`${n} fotoğraf taşındı`); done?.(); }
      catch (e) { toast(errText(e)); }
    };
    document.querySelectorAll('[data-mv]').forEach((b) => b.onclick = () => go(b.dataset.mv));
    document.getElementById('mv-new').onclick = () => {
      const t = prompt('Yeni albümün adı:');
      if (!t || !t.trim()) return;
      rpc('create_album', { p_title: t.trim(), p_place: '', p_lat: null, p_lng: null, p_taken_on: null }).then(go).catch((e) => toast(errText(e)));
    };
  });
}

// ------------------------------------------------------------------ yorumlar (albüm ve planlar)
async function fetchComments(type, id) {
  const { data, error } = await sb.from('comments').select('*').eq('target_type', type).eq('target_id', id).order('created_at');
  if (error) throw error;
  return data || [];
}
function commentRows(list) {
  if (!list.length) return '<p class="small">Henüz yorum yok. İlk yorumu sen yaz.</p>';
  return list.map((c) => `<div class="list-row" style="align-items:flex-start">${avatar(nameOf(c.user_id), c.user_id, 'lg')}
    <div class="grow"><div class="small"><b style="color:var(--ink)">${esc(nameOf(c.user_id))}</b> · ${esc(fmt.short(new Date(c.created_at)))}</div>
    <div style="font-size:15px;white-space:pre-line;word-break:break-word">${esc(c.body)}</div></div>
    ${c.user_id === me() || isAdmin() ? `<button class="icon-btn" style="width:36px;height:36px;border:none;background:none" data-cdel="${c.id}" aria-label="Yorumu sil">${svg('trash')}</button>` : ''}</div>`).join('');
}
function commentForm() {
  return `<form class="comment-form" style="display:flex;gap:8px"><label class="hidden" for="c-in">Yorum</label>
    <input class="input" id="c-in" maxlength="1000" placeholder="Yorum yaz…" style="flex:1;min-width:0"><button class="btn primary" type="submit">Gönder</button></form>`;
}
async function bindComments(root, type, id, redraw) {
  root.querySelector('form').onsubmit = async (ev) => {
    ev.preventDefault();
    const inp = root.querySelector('#c-in'); const body = inp.value.trim(); if (!body) return;
    try { await rpc('add_comment', { p_type: type, p_target: id, p_body: body }); inp.value = ''; redraw(); }
    catch (e) { toast(errText(e)); }
  };
  root.querySelectorAll('[data-cdel]').forEach((b) => b.onclick = async () => {
    if (!confirm('Yorum silinsin mi?')) return;
    try { await rpc('delete_comment', { p_comment: b.dataset.cdel }); redraw(); } catch (e) { toast(errText(e)); }
  });
}
async function inlineComments(type, id, root) {
  const redraw = async () => {
    try {
      const list = await fetchComments(type, id);
      root.innerHTML = `<section class="card">${commentRows(list)}${commentForm()}</section>`;
      bindComments(root, type, id, redraw);
    } catch (e) { root.innerHTML = `<p class="small">${esc(errText(e))}</p>`; }
  };
  redraw();
}
export function showComments(type, id, title, onChange) {
  openSheet(`${sheetHead(esc(title))}<div id="cm-body"><p class="sub">Yükleniyor…</p></div>`, () => {
    const root = document.getElementById('cm-body');
    const redraw = async () => {
      try {
        const list = await fetchComments(type, id);
        root.innerHTML = `<div style="display:flex;flex-direction:column;gap:10px">${commentRows(list)}</div>${commentForm()}`;
        bindComments(root, type, id, () => { redraw(); onChange?.(); });
      } catch (e) { root.innerHTML = `<p class="small">${esc(errText(e))}</p>`; }
    };
    redraw();
  });
}

function uploadChooser() {
  openSheet(`${sheetHead('Fotoğraf yükle')}
    <button class="choice" id="up-quick"><b>${svg('img')}Hızlı yükle</b><span>Albüm sormadan yükle. Her fotoğraf çekildiği yerde haritada görünür; sonra istediğin albüme taşıyabilirsin.</span></button>
    <button class="choice" id="up-album"><b>${svg('grid')}Yeni albüm</b><span>Bir gezi ya da buluşma için albüm aç, fotoğrafları içine yükle.</span></button>`, () => {
    document.getElementById('up-quick').onclick = async () => {
      closeSheet();
      try {
        const id = await rpc('loose_album');
        pickAndUpload({ id, title: 'Tek fotoğraflar', is_loose: true, lat: null });
      } catch (e) { toast(errText(e)); }
    };
    document.getElementById('up-album').onclick = () => { closeSheet(); showAlbumForm(); };
  });
}

// ------------------------------------------------------------------ albüm oluştur / düzenle (yönetici)
function showAlbumForm(edit) {
  const today = new Date().toISOString().slice(0, 10);
  openSheet(`${sheetHead(edit ? 'Albümü düzenle' : 'Yeni albüm')}
    <form id="af" style="display:flex;flex-direction:column;gap:14px" novalidate>
      ${field('a-title', 'Albüm adı', 'text', 'Abant gezisi', 'maxlength="80"', edit?.title || '')}
      <div class="field"><label for="f-a-date">Tarih</label><input class="input" id="f-a-date" type="date" value="${edit?.taken_on || today}"></div>
      ${field('a-place', 'Yer (isteğe bağlı)', 'text', 'Bolu', 'maxlength="80"', edit?.place || '')}
      ${edit ? '' : '<p class="small">Sonraki adımda fotoğrafları seçeceksin. Konum fotoğraflardan alınır; yoksa haritadan seçebilirsin.</p>'}
      <p class="err" id="af-err"></p>
      <button class="btn primary block" style="height:52px" type="submit">${edit ? 'Kaydet' : 'Devam: fotoğrafları seç'}</button>
    </form>`, () => {
    document.getElementById('af').onsubmit = async (ev) => {
      ev.preventDefault();
      const title = val('a-title'); if (!title) return (document.getElementById('af-err').textContent = 'Albüme bir ad ver.');
      const date = document.getElementById('f-a-date').value || null;
      try {
        if (edit) {
          await rpc('update_album', { p_album: edit.id, p_title: title, p_place: val('a-place'), p_lat: edit.lat, p_lng: edit.lng, p_taken_on: date });
          closeSheet(); toast('Albüm güncellendi'); renderAlbum();
        } else {
          const id = await rpc('create_album', { p_title: title, p_place: val('a-place'), p_lat: null, p_lng: null, p_taken_on: date });
          closeSheet();
          S.view = 'album'; S.albumId = id; history.replaceState(null, '', '#album/' + id);
          await renderAlbum();
          pickAndUpload(A.album);
        }
      } catch (e) { document.getElementById('af-err').textContent = errText(e); }
    };
  });
}

// ------------------------------------------------------------------ yükleme: küçült, konumu oku, dosya bilgilerini temizle
function pickAndUpload(album) {
  const inp = document.createElement('input');
  inp.type = 'file'; inp.accept = 'image/*'; inp.multiple = true;
  inp.onchange = () => { if (inp.files?.length) uploadFiles(album, [...inp.files]); };
  inp.click();
}

async function uploadFiles(album, files) {
  let done = 0, ok = 0, gotLoc = album.lat != null, missingLoc = 0;
  openSheet(`${sheetHead('Yükleniyor')}<p class="sub" id="up-txt">0 / ${files.length}</p>
    <div class="progress"><i id="up-bar" style="width:0%"></i></div>
    <p class="small">Fotoğraflar telefonunda küçültülüyor ve içlerindeki cihaz bilgisi temizleniyor. Bu ekranı kapatma.</p>`);
  const bd = document.getElementById('sb'); if (bd) bd.onclick = null;
  for (const f of files) {
    try {
      const meta = await readExif(f).catch(() => ({}));
      const big = await resize(f, 2560, 0.82);
      const small = await resize(f, 480, 0.75);
      const pid = crypto.randomUUID();
      const base = `${S.ctx.group_id}/${album.id}/${pid}`;
      const p1 = `${base}.${big.ext}`, p2 = `${base}_t.${small.ext}`;
      let r = await sb.storage.from('photos').upload(p1, big.blob, { contentType: big.blob.type, cacheControl: '31536000' });
      if (r.error) throw r.error;
      r = await sb.storage.from('photos').upload(p2, small.blob, { contentType: small.blob.type, cacheControl: '31536000' });
      if (r.error) throw r.error;
      await rpc('add_photo', { p_album: album.id, p_path: p1, p_thumb: p2, p_w: big.w, p_h: big.h,
        p_lat: meta.lat ?? null, p_lng: meta.lng ?? null, p_taken_at: meta.date ?? null });
      if (meta.lat != null) gotLoc = true; else missingLoc++;
      ok++;
    } catch (e) { console.warn(e); toast('Bir fotoğraf yüklenemedi: ' + errText(e)); }
    done++;
    const t = document.getElementById('up-txt'); if (t) t.textContent = `${done} / ${files.length}`;
    const b = document.getElementById('up-bar'); if (b) b.style.width = `${Math.round((done / files.length) * 100)}%`;
  }
  try { await rpc('finish_album_upload', { p_album: album.id, p_added: ok }); } catch (_) { /* */ }
  closeSheet();
  toast(`${ok} fotoğraf yüklendi${ok ? ', gruba haber verildi' : ''}`);
  if (isLoose(album)) {
    if (ok && missingLoc) setTimeout(() => toast(`${missingLoc} fotoğrafta konum yoktu; "Tek fotoğraflar" albümünden konum verebilirsin`, 5000), 2700);
    if (S.view === 'album') await renderAlbum(); else render();
    return;
  }
  await renderAlbum();
  if (ok && !gotLoc) {
    toast('Fotoğraflarda konum bilgisi yoktu, haritadan seçebilirsin', 4000);
  }
}

async function resize(file, maxSide, quality) {
  let src;
  try { src = await createImageBitmap(file, { imageOrientation: 'from-image' }); }
  catch (_) {
    src = await new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => rej(new Error('Fotoğraf okunamadı')); im.src = URL.createObjectURL(file); });
  }
  const w0 = src.width, h0 = src.height;
  const k = Math.min(1, maxSide / Math.max(w0, h0));
  const w = Math.round(w0 * k), h = Math.round(h0 * k);
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const ctx = c.getContext('2d'); ctx.imageSmoothingQuality = 'high'; ctx.drawImage(src, 0, 0, w, h);
  src.close?.();
  const toBlob = (type, q) => new Promise((res) => c.toBlob(res, type, q));
  let blob = await toBlob('image/webp', quality);
  let ext = 'webp';
  if (!blob || blob.type !== 'image/webp') { blob = await toBlob('image/jpeg', quality + 0.03); ext = 'jpg'; }
  return { blob, ext, w, h };
}

// JPEG içindeki konum (GPS) ve çekim tarihini oku. Yeni dosyaya bu bilgiler yazılmaz.
async function readExif(file) {
  const buf = new DataView(await file.slice(0, 256 * 1024).arrayBuffer());
  if (buf.getUint16(0) !== 0xFFD8) return {};
  let off = 2;
  while (off + 4 < buf.byteLength) {
    const marker = buf.getUint16(off); const len = buf.getUint16(off + 2);
    if (marker === 0xFFE1 && buf.getUint32(off + 4) === 0x45786966) return parseTiff(buf, off + 10);
    if ((marker & 0xFF00) !== 0xFF00) break;
    off += 2 + len;
  }
  return {};
}
function parseTiff(v, t) {
  const le = v.getUint16(t) === 0x4949;
  const u16 = (o) => v.getUint16(o, le), u32 = (o) => v.getUint32(o, le);
  const ifd = (o) => { const n = u16(o); const tags = {}; for (let i = 0; i < n; i++) { const e = o + 2 + i * 12; tags[u16(e)] = e; } return tags; };
  const rational = (o) => u32(o) / (u32(o + 4) || 1);
  const out = {};
  const ifd0 = ifd(t + u32(t + 4));
  if (ifd0[0x8769]) {
    const ex = ifd(t + u32(ifd0[0x8769] + 8));
    if (ex[0x9003]) {
      let s = ''; const o = t + u32(ex[0x9003] + 8);
      for (let i = 0; i < 19; i++) s += String.fromCharCode(v.getUint8(o + i));
      const m = s.match(/(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})/);
      if (m) out.date = new Date(+m[1], m[2] - 1, +m[3], +m[4], +m[5], +m[6]).toISOString();
    }
  }
  if (ifd0[0x8825]) {
    const g = ifd(t + u32(ifd0[0x8825] + 8));
    const coord = (tag) => { if (!g[tag]) return null; const o = t + u32(g[tag] + 8); return rational(o) + rational(o + 8) / 60 + rational(o + 16) / 3600; };
    const ref = (tag) => (g[tag] ? String.fromCharCode(v.getUint8(g[tag] + 8)) : '');
    let lat = coord(2), lng = coord(4);
    if (lat != null && lng != null && (lat || lng)) {
      if (ref(1) === 'S') lat = -lat;
      if (ref(3) === 'W') lng = -lng;
      out.lat = Math.round(lat * 1e6) / 1e6; out.lng = Math.round(lng * 1e6) / 1e6;
    }
  }
  return out;
}

// ------------------------------------------------------------------ haritadan konum seç
// Daha önce kullanılmış yerler: konumu olan albümler + tek fotoğrafların konumları (yakın olanlar birleştirilir)
async function knownPlaces() {
  const places = [];
  const near = (a, b) => Math.abs(a.lat - b.lat) < 0.002 && Math.abs(a.lng - b.lng) < 0.002; // ~200 m
  try {
    const { data: al } = await sb.from('albums').select('id, title, place, lat, lng, photo_count, is_loose')
      .eq('group_id', S.ctx.group_id).not('lat', 'is', null);
    for (const a of al || []) {
      if (a.is_loose) continue;
      places.push({ name: a.title, sub: a.place || `${a.photo_count} fotoğraf`, lat: a.lat, lng: a.lng });
    }
    const { data: lq } = await sb.from('albums').select('id').eq('group_id', S.ctx.group_id).eq('is_loose', true).limit(1);
    const la = lq?.[0];
    if (la) {
      const { data: ph } = await sb.from('photos').select('lat, lng').eq('album_id', la.id).not('lat', 'is', null);
      for (const p of ph || []) {
        const hit = places.find((x) => near(x, p));
        if (hit) { if (hit.loose) hit.count++; continue; }
        places.push({ name: 'Fotoğraf konumu', lat: p.lat, lng: p.lng, loose: true, count: 1 });
      }
    }
  } catch (e) { console.warn(e); }
  places.forEach((x) => { if (x.loose) x.sub = `${x.count} tek fotoğraf`; });
  return places;
}

async function pickLocation(album, onPick) {
  // album: konumu seçilecek albüm ya da fotoğraf (lat/lng alanları olan herhangi bir kayıt)
  openSheet(`${sheetHead('Konum seç')}
    <div id="pick-known"></div>
    <p class="sub" id="pick-hint">Haritada yerine dokun ya da daha önce kullanılan bir yeri seç.</p>
    <div class="map-wrap" style="height:46vh"><div id="pick-map" class="map"></div></div>
    <button class="btn primary block" id="pick-ok" disabled>Bu konumu kullan</button>`, async () => {
    let ml; try { ml = await loadMapLibre(); } catch (e) { toast(errText(e)); return; }
    const center = album.lat != null ? [album.lng, album.lat] : TR_CENTER;
    const m = new ml.Map({ container: 'pick-map', style: styleFor(mapKind()), center, zoom: album.lat != null ? 10 : 4.6, attributionControl: { compact: true } });
    addKindToggle(document.getElementById('pick-map').parentElement, m);
    m.dragRotate.disable(); m.touchZoomRotate.disableRotation();
    m.on('load', () => m.resize()); setTimeout(() => m.resize(), 300);
    let mk = null, ll = null;
    const choose = (lngLat, label, fly) => {
      ll = { lng: lngLat.lng, lat: lngLat.lat };
      if (!mk) mk = new ml.Marker({ color: '#B8431D' }).setLngLat(ll).addTo(m); else mk.setLngLat(ll);
      document.getElementById('pick-ok').disabled = false;
      const h = document.getElementById('pick-hint');
      if (h) h.textContent = label ? `Seçilen yer: ${label}` : 'Haritada seçtiğin nokta kullanılacak.';
      if (fly) m.flyTo({ center: [ll.lng, ll.lat], zoom: Math.max(m.getZoom(), 13), duration: 600 });
    };
    m.on('click', (e) => {
      choose(e.lngLat, null, false);
      document.querySelectorAll('[data-kp]').forEach((x) => x.classList.remove('on'));
    });

    // Kayıtlı yerler: üstte liste + haritada küçük noktalar
    const places = await knownPlaces();
    const box = document.getElementById('pick-known');
    if (box && places.length) {
      box.innerHTML = `<p class="section-title" style="margin:0 0 6px">Daha önce kullanılan yerler</p>
        <div class="known-row">${places.map((x, i) => `<button class="known" data-kp="${i}"><b>${esc(x.name)}</b><span>${esc(x.sub)}</span></button>`).join('')}</div>`;
      box.querySelectorAll('[data-kp]').forEach((b) => b.onclick = () => {
        const x = places[+b.dataset.kp];
        box.querySelectorAll('[data-kp]').forEach((y) => y.classList.toggle('on', y === b));
        choose({ lng: x.lng, lat: x.lat }, x.name, true);
      });
      for (const [i, x] of places.entries()) {
        const el = document.createElement('button');
        el.className = 'known-dot'; el.setAttribute('aria-label', x.name);
        el.onclick = (ev) => { ev.stopPropagation(); box.querySelector(`[data-kp="${i}"]`)?.click(); };
        new ml.Marker({ element: el }).setLngLat([x.lng, x.lat]).addTo(m);
      }
      if (album.lat == null && places.length) {
        const b = new ml.LngLatBounds(); places.forEach((x) => b.extend([x.lng, x.lat]));
        m.fitBounds(b, { padding: 50, maxZoom: 11, duration: 0 });
      }
    }
    document.getElementById('pick-ok').onclick = async () => {
      if (!ll) return;
      try { await onPick({ lat: Math.round(ll.lat * 1e6) / 1e6, lng: Math.round(ll.lng * 1e6) / 1e6 }); closeSheet(); }
      catch (e) { toast(errText(e)); }
    };
  });
}
