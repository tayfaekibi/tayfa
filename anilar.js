// Anılar: harita, albümler, fotoğraf yükleme (sadece yönetici) ve görüntüleyici
import {
  sb, S, esc, svg, avatar, toast, errText, rpc, fmt, openSheet, closeSheet, sheetHead, field, val,
  isAdmin, me, nameOf, render, header, bindHeader, goMain,
} from './app.js';

const MAP_STYLE = 'https://tiles.openfreemap.org/styles/positron';
const MAPLIBRE = 'https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl';
const TR_CENTER = [35.2, 39.0];

const A = { albums: [], mode: 'map', photos: [], likes: [], loadedFor: null };
let map = null;

// ------------------------------------------------------------------ imzalı (süreli) bağlantılar
const urlCache = new Map();
async function signed(paths) {
  const now = Date.now();
  const need = [...new Set(paths.filter((p) => p && !(urlCache.get(p)?.exp > now + 60000)))];
  for (let i = 0; i < need.length; i += 100) {
    const chunk = need.slice(i, i + 100);
    const { data, error } = await sb.storage.from('photos').createSignedUrls(chunk, 3600);
    if (error) throw error;
    for (const r of data || []) if (r.signedUrl) urlCache.set(r.path, { url: r.signedUrl, exp: now + 3600 * 1000 });
  }
  return (p) => urlCache.get(p)?.url || '';
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
  document.getElementById('al-new')?.addEventListener('click', () => showAlbumForm());
  try { await loadAlbums(); } catch (e) { toast(errText(e)); }
  const sub = document.getElementById('al-sub');
  if (!sub) return;
  const total = A.albums.reduce((n, a) => n + a.photo_count, 0);
  sub.textContent = A.albums.length ? `${total} fotoğraf · ${A.albums.length} albüm` : 'Henüz anı yok';
  if (A.mode === 'map') await drawMap(); else await drawList();
}

async function drawList() {
  const box = document.getElementById('al-body');
  if (!A.albums.length) { box.innerHTML = emptyState(); bindEmpty(); return; }
  const url = await signed(A.albums.map((a) => a.cover_thumb));
  box.innerHTML = `<div class="album-grid">${A.albums.map((a) => `
    <button class="album-card" data-album="${a.id}">
      <div class="album-cover nosave" style="${a.cover_thumb ? `background-image:url('${url(a.cover_thumb)}')` : ''}">${a.cover_thumb ? '' : svg('img')}</div>
      <div class="album-meta"><b>${esc(a.title)}</b><span>${esc(dateTr(a.taken_on))} · ${a.photo_count} fotoğraf</span></div>
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
  map = new ml.Map({ container: 'map', style: MAP_STYLE, center: TR_CENTER, zoom: 4.6, attributionControl: { compact: true } });
  map.touchPitch?.disable?.(); map.dragRotate.disable(); map.touchZoomRotate.disableRotation();
  const pts = A.albums.filter((a) => a.lat != null && a.lng != null);
  const url = await signed(pts.map((a) => a.cover_thumb));
  for (const a of pts) {
    const el = document.createElement('button');
    el.className = 'map-pin';
    el.setAttribute('aria-label', a.title);
    el.innerHTML = `<span class="map-pin-img nosave" style="${a.cover_thumb ? `background-image:url('${url(a.cover_thumb)}')` : ''}"></span><span class="map-pin-n">${a.photo_count}</span>`;
    el.onclick = (ev) => { ev.stopPropagation(); showMapCard(a, url); map.easeTo({ center: [a.lng, a.lat], duration: 400 }); };
    new ml.Marker({ element: el, anchor: 'bottom' }).setLngLat([a.lng, a.lat]).addTo(map);
  }
  if (pts.length === 1) map.jumpTo({ center: [pts[0].lng, pts[0].lat], zoom: 10 });
  else if (pts.length > 1) {
    const b = new ml.LngLatBounds();
    pts.forEach((a) => b.extend([a.lng, a.lat]));
    map.fitBounds(b, { padding: 60, maxZoom: 11, duration: 0 });
  }
  const noLoc = A.albums.length - pts.length;
  const card = document.getElementById('map-card');
  if (!A.albums.length) card.innerHTML = emptyState();
  else if (noLoc) card.innerHTML = `<p class="small" style="text-align:center">${noLoc} albümün konumu yok; "Albümler" sekmesinden görebilirsin.</p>`;
  map.on('click', () => { if (A.albums.length) card.innerHTML = ''; });
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
    A.album = al.data; A.photos = ph.data || [];
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
      <p class="sub" style="margin-top:2px">${esc(dateTr(a.taken_on))}${a.place ? ' · ' + esc(a.place) : ''} · ${A.photos.length} fotoğraf</p></div>
      ${isAdmin() ? `<button class="icon-btn" id="al-menu" aria-label="Albüm seçenekleri">${svg('dots')}</button>` : ''}
    </header>
    ${isAdmin() ? `<button class="btn primary block" id="al-add">${svg('upload')}Fotoğraf ekle</button>` : ''}
    ${a.lat == null && isAdmin() ? `<button class="banner" id="al-loc"><span class="pip"></span><span class="grow">Albümün konumu yok, haritada görünmüyor</span><span>Konum seç</span></button>` : ''}
    ${A.photos.length ? `<div class="photo-grid">${A.photos.map((p, i) => `
      <button class="photo-tile nosave" data-ph="${i}" style="background-image:url('${url(p.thumb_path)}')" aria-label="Fotoğraf ${i + 1}">
        ${likesOf(p.id).length ? `<span class="tile-like">${svg('heart')}${likesOf(p.id).length}</span>` : ''}</button>`).join('')}</div>`
      : `<div class="card"><div class="empty">${svg('img')}<span>Bu albümde henüz fotoğraf yok.</span></div></div>`}
    <p class="section-title">Yorumlar</p>
    <div id="al-comments"></div>`;
  box.querySelectorAll('[data-ph]').forEach((b) => b.onclick = () => openViewer(+b.dataset.ph));
  document.getElementById('al-add')?.addEventListener('click', () => pickAndUpload(a));
  document.getElementById('al-loc')?.addEventListener('click', () => pickLocation(a, async (ll) => {
    await rpc('update_album', { p_album: a.id, p_title: a.title, p_place: a.place || '', p_lat: ll.lat, p_lng: ll.lng, p_taken_on: a.taken_on });
    toast('Konum kaydedildi'); renderAlbum();
  }));
  document.getElementById('al-menu')?.addEventListener('click', albumMenu);
  inlineComments('album', a.id, document.getElementById('al-comments'));
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
function openViewer(start) {
  let i = start;
  const root = document.getElementById('sheet-root');
  const draw = async () => {
    const p = A.photos[i];
    const url = await signed([p.path]);
    const liked = likesOf(p.id).some((l) => l.user_id === me());
    const n = likesOf(p.id).length;
    root.innerHTML = `<div class="viewer" id="viewer">
      <div class="viewer-top"><button class="icon-btn dark" id="v-close" aria-label="Kapat">${svg('x')}</button>
        <span>${i + 1} / ${A.photos.length}</span>
        ${isAdmin() ? `<button class="icon-btn dark" id="v-del" aria-label="Fotoğrafı sil">${svg('trash')}</button>` : '<span style="width:44px"></span>'}</div>
      <div class="viewer-stage" id="v-stage"><div class="viewer-img nosave" style="background-image:url('${url(p.path)}')"></div><div class="viewer-shield"></div></div>
      <div class="viewer-bottom">
        <button class="like-btn ${liked ? 'on' : ''}" id="v-like">${svg('heart')}<span>${n || ''}</span></button>
        <span class="small" style="color:#CFC6BF">${p.taken_at ? esc(fmt.short(new Date(p.taken_at))) : ''}</span>
      </div></div>`;
    document.getElementById('v-close').onclick = () => { root.innerHTML = ''; drawAlbum(); };
    document.getElementById('v-like').onclick = async () => {
      try {
        const on = await rpc('toggle_like', { p_photo: p.id });
        A.likes = A.likes.filter((l) => !(l.photo_id === p.id && l.user_id === me()));
        if (on) A.likes.push({ photo_id: p.id, user_id: me() });
        draw();
      } catch (e) { toast(errText(e)); }
    };
    document.getElementById('v-del')?.addEventListener('click', async () => {
      if (!confirm('Bu fotoğraf herkes için silinecek. Emin misin?')) return;
      try {
        const paths = await rpc('delete_photo', { p_photo: p.id });
        if (paths?.length) await sb.storage.from('photos').remove(paths);
        A.photos.splice(i, 1);
        if (!A.photos.length) { root.innerHTML = ''; return renderAlbum(); }
        i = Math.min(i, A.photos.length - 1); draw();
      } catch (e) { toast(errText(e)); }
    });
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
  let done = 0, ok = 0, gotLoc = album.lat != null;
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
      if (meta.lat != null) gotLoc = true;
      ok++;
    } catch (e) { console.warn(e); toast('Bir fotoğraf yüklenemedi: ' + errText(e)); }
    done++;
    const t = document.getElementById('up-txt'); if (t) t.textContent = `${done} / ${files.length}`;
    const b = document.getElementById('up-bar'); if (b) b.style.width = `${Math.round((done / files.length) * 100)}%`;
  }
  try { await rpc('finish_album_upload', { p_album: album.id, p_added: ok }); } catch (_) { /* */ }
  closeSheet();
  toast(`${ok} fotoğraf yüklendi${ok ? ', gruba haber verildi' : ''}`);
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
async function pickLocation(album, onPick) {
  openSheet(`${sheetHead('Konum seç')}<p class="sub">Haritada albümün yerine dokun.</p>
    <div class="map-wrap" style="height:52vh"><div id="pick-map" class="map"></div></div>
    <button class="btn primary block" id="pick-ok" disabled>Bu konumu kullan</button>`, async () => {
    let ml; try { ml = await loadMapLibre(); } catch (e) { toast(errText(e)); return; }
    const center = album.lat != null ? [album.lng, album.lat] : TR_CENTER;
    const m = new ml.Map({ container: 'pick-map', style: MAP_STYLE, center, zoom: album.lat != null ? 10 : 4.6, attributionControl: { compact: true } });
    m.dragRotate.disable(); m.touchZoomRotate.disableRotation();
    let mk = null, ll = null;
    m.on('click', (e) => {
      ll = e.lngLat;
      if (!mk) mk = new ml.Marker({ color: '#B8431D' }).setLngLat(ll).addTo(m); else mk.setLngLat(ll);
      document.getElementById('pick-ok').disabled = false;
    });
    document.getElementById('pick-ok').onclick = async () => {
      if (!ll) return;
      try { await onPick({ lat: Math.round(ll.lat * 1e6) / 1e6, lng: Math.round(ll.lng * 1e6) / 1e6 }); closeSheet(); }
      catch (e) { toast(errText(e)); }
    };
  });
}
