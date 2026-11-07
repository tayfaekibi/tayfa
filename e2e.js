// Uçtan uca şifreleme. Her cihazın kendi anahtar çifti vardır; gizli anahtar cihazdan hiç çıkmaz.
// Her mesaj rastgele bir anahtarla şifrelenir; bu anahtar, gruptaki her cihaz için ayrı ayrı kilitlenir.
const subtle = crypto.subtle;
const EC = { name: 'ECDH', namedCurve: 'P-256' };

export const b64 = (buf) => {
  const b = new Uint8Array(buf); let s = '';
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000));
  return btoa(s);
};
export const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const rand = (n) => crypto.getRandomValues(new Uint8Array(n));

// ---- cihaz anahtarını tarayıcının kendi veritabanında sakla
function idb() {
  return new Promise((res, rej) => {
    const r = indexedDB.open('tayfa-e2e', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('keys', { keyPath: 'uid' });
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function idbGet(uid) {
  const db = await idb();
  return new Promise((res, rej) => {
    const q = db.transaction('keys').objectStore('keys').get(uid);
    q.onsuccess = () => res(q.result || null); q.onerror = () => rej(q.error);
  });
}
async function idbPut(rec) {
  const db = await idb();
  return new Promise((res, rej) => {
    const t = db.transaction('keys', 'readwrite'); t.objectStore('keys').put(rec);
    t.oncomplete = () => res(); t.onerror = () => rej(t.error);
  });
}

let current = null;
export async function ensureDevice(uid, rpc) {
  if (current && current.uid === uid) return current;
  let rec = await idbGet(uid);
  if (!rec) {
    const kp = await subtle.generateKey(EC, false, ['deriveKey']);
    const pub = await subtle.exportKey('jwk', kp.publicKey);
    const id = await rpc('register_device', { p_public_key: pub, p_device: null });
    rec = { uid, id, priv: kp.privateKey, pub };
    await idbPut(rec);
  } else {
    const id = await rpc('register_device', { p_public_key: rec.pub, p_device: rec.id });
    if (id !== rec.id) { rec.id = id; await idbPut(rec); }
  }
  current = rec;
  return rec;
}

async function kwFor(pubJwk, priv, usage) {
  const pub = await subtle.importKey('jwk', { kty: pubJwk.kty, crv: pubJwk.crv, x: pubJwk.x, y: pubJwk.y }, EC, false, []);
  return subtle.deriveKey({ name: 'ECDH', public: pub }, priv, { name: 'AES-KW', length: 256 }, false, [usage]);
}

// devices: [{id, public_key}] → mesaj alanları + ses için kullanılacak anahtar
export async function seal(plainBytes, devices) {
  const msgKey = await subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
  const iv = rand(12);
  const ct = await subtle.encrypt({ name: 'AES-GCM', iv }, msgKey, plainBytes);
  const eph = await subtle.generateKey(EC, true, ['deriveKey']);
  const keys = {};
  for (const d of devices) {
    try {
      const kw = await kwFor(d.public_key, eph.privateKey, 'wrapKey');
      keys[d.id] = b64(await subtle.wrapKey('raw', msgKey, kw, 'AES-KW'));
    } catch (e) { console.warn('cihaz anahtarı kullanılamadı', d.id, e); }
  }
  const epk = await subtle.exportKey('jwk', eph.publicKey);
  return { iv: b64(iv), ciphertext: b64(ct), epk: { kty: epk.kty, crv: epk.crv, x: epk.x, y: epk.y }, keys, msgKey };
}

export async function openKey(row, dev) {
  const wrapped = row.keys?.[dev.id];
  if (!wrapped || !row.epk) return null;
  const kw = await kwFor(row.epk, dev.priv, 'unwrapKey');
  return subtle.unwrapKey('raw', unb64(wrapped), kw, 'AES-KW', { name: 'AES-GCM' }, false, ['decrypt']);
}

export async function open(row, dev) {
  const key = await openKey(row, dev);
  if (!key) return null;
  const pt = await subtle.decrypt({ name: 'AES-GCM', iv: unb64(row.iv) }, key, unb64(row.ciphertext));
  return { bytes: new Uint8Array(pt), key };
}

export async function encBytes(key, bytes) {
  const iv = rand(12);
  const ct = await subtle.encrypt({ name: 'AES-GCM', iv }, key, bytes);
  return { iv: b64(iv), data: new Uint8Array(ct) };
}
export async function decBytes(key, ivB64, bytes) {
  return new Uint8Array(await subtle.decrypt({ name: 'AES-GCM', iv: unb64(ivB64) }, key, bytes));
}

export const enc = (obj) => new TextEncoder().encode(JSON.stringify(obj));
export const dec = (bytes) => JSON.parse(new TextDecoder().decode(bytes));
