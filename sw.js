// Tayfa servis çalışanı
// - Uygulama dosyaları telefona kaydedilir ve oradan anında açılır (hızlı açılış).
// - Yeni sürüm yayınlanınca bu dosyadaki CACHE adı değişir; telefon yeni dosyaları arka planda indirir
//   ve uygulama kendini yeniler.
// - Fotoğraflar da telefonda saklanır, ikinci açılışta internetten tekrar indirilmez.
// - Bildirime dokununca ilgili ekran açılır.
const CACHE = 'tayfa-v3.4.4';
const PHOTO_CACHE = 'tayfa-foto-v1';
const ROUTE_CACHE = 'tayfa-yonlendirme';
const MAX_PHOTOS = 600;
const SHELL = [
  './', 'index.html', 'style.css', 'app.js', 'config.js', 'manifest.webmanifest',
  'anilar.js', 'sohbet.js', 'oyunlar.js', 'kingui.js', 'voice.js', 'e2e.js', 'supabase/functions/_shared/tavla.js', 'supabase/functions/_shared/king.js',
  'vendor/supabase.js', 'vendor/maplibre-gl.js', 'vendor/maplibre-gl.css',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png', 'aydinlatma.html',
];

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    // HTTP önbelleğini atla, en yeni dosyaları al
    await c.addAll(SHELL.map((u) => new Request(u, { cache: 'reload' })));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keep = new Set([CACHE, PHOTO_CACHE, ROUTE_CACHE]);
    for (const k of await caches.keys()) if (!keep.has(k)) await caches.delete(k);
    await self.clients.claim();
  })());
});

// Fotoğraf bağlantılarındaki geçici anahtarı at: aynı fotoğraf her zaman aynı kayıtla eşleşsin
function photoKey(url) {
  return url.origin + url.pathname;
}
async function trimPhotos() {
  const c = await caches.open(PHOTO_CACHE);
  const keys = await c.keys();
  for (let i = 0; i < keys.length - MAX_PHOTOS; i++) await c.delete(keys[i]);
}

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);

  // Supabase'teki fotoğraflar (imzalı bağlantılar)
  if (url.hostname.endsWith('.supabase.co') && url.pathname.includes('/storage/v1/object/sign/photos/')) {
    e.respondWith((async () => {
      const c = await caches.open(PHOTO_CACHE);
      const key = photoKey(url);
      const hit = await c.match(key);
      if (hit) return hit;
      const res = await fetch(url.href, { mode: 'cors', credentials: 'omit' });
      if (res.ok) { c.put(key, res.clone()).then(trimPhotos); }
      return res;
    })());
    return;
  }

  if (url.origin !== self.location.origin) return;

  // Uygulama dosyaları: önce telefondaki kopya
  e.respondWith((async () => {
    const c = await caches.open(CACHE);
    const req = e.request.mode === 'navigate' ? 'index.html' : e.request;
    const hit = await c.match(req, { ignoreSearch: true });
    if (hit) return hit;
    try {
      const res = await fetch(e.request);
      if (res.ok && url.pathname.startsWith(new URL(self.registration.scope).pathname)) c.put(e.request, res.clone());
      return res;
    } catch (err) {
      return (await c.match('index.html')) || Response.error();
    }
  })());
});

// Tanılama için son bildirimin ne zaman geldiğini ve dokunulduğunu kaydet (Profil'de görünür)
async function note(key, obj) {
  try { const c = await caches.open(ROUTE_CACHE); await c.put(key, new Response(JSON.stringify({ ...obj, at: Date.now() }))); } catch (_) { /* */ }
}

self.addEventListener('push', (e) => {
  let data = {};
  try { data = e.data ? e.data.json() : {}; } catch (_) { data = { title: 'Tayfa', body: e.data?.text() || '' }; }
  const title = data.title || 'Tayfa';
  e.waitUntil(Promise.all([
    self.registration.showNotification(title, {
      body: data.body || '',
      icon: 'icons/icon-192.png',
      badge: 'icons/icon-192.png',
      tag: data.tag,
      data: { url: data.url || './' },
    }),
    note('last-push', { title, url: data.url || './' }),
  ]));
});

// Bildirime dokununca: önce açık uygulamaya hemen "şuraya git" de, sonra öne getir.
// iPhone'da bazen öne getirme hata verir ya da mesaj kaybolur; bu yüzden gidilecek yer ayrıca kaydedilir
// ve uygulama uyanınca birkaç kez kontrol eder. Hiçbiri olmazsa uygulamadaki bildirim kutusu yine çalışır.
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const target = new URL(e.notification.data?.url || './', self.registration.scope).href;
  e.waitUntil((async () => {
    const saved = note('pending', { url: target });
    const logged = note('last-click', { url: target });
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const client = all.find((c) => c.url.startsWith(self.registration.scope));
    if (client) {
      try { client.postMessage({ type: 'open', url: target }); } catch (_) { /* */ }
      try { await client.focus(); } catch (_) { /* */ }
      try { if (client.url !== target && 'navigate' in client) await client.navigate(target); } catch (_) { /* */ }
    } else {
      try { await self.clients.openWindow(target); } catch (_) { /* */ }
    }
    await Promise.allSettled([saved, logged]);
  })());
});
