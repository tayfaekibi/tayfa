// Canlı ses (oyun masası): telefondan telefona WebRTC, kendiliğinden şifreli. Kayıt yok.
// Bağlantı kurmak için Supabase'in canlı kanalı (ücretsiz) ve Google'ın herkese açık STUN sunucusu kullanılır.
import { sb, me, nameOf, toast } from './app.js';

const ICE = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }];
const V = {
  room: null, players: [], ch: null, joined: false, muted: false, stream: null,
  pcs: new Map(), audios: new Map(), present: new Map(), speaking: new Set(),
  onChange: null, ctx: null, meters: new Map(), meterT: null, failed: new Set(),
};
const emit = () => { try { V.onChange?.(); } catch (_) { /* */ } };

// İkram: masadakilere çay, viski… (sadece anlık gösterilir, kaydedilmez)
export function setTreatHandler(fn) { V.onTreat = fn; }
export function sendTreat(to, kind) {
  const p = { from: me(), to, kind, at: Date.now() };
  V.ch?.send({ type: 'broadcast', event: 'ikram', payload: p });
  V.onTreat?.(p);
}

export const state = () => ({
  joined: V.joined, muted: V.muted,
  inVoice: [...V.present.keys()],           // seste olanlar (ben dahil)
  speaking: V.speaking, failed: V.failed,
});

// Masa açılınca: sadece kim seste onu dinle (mikrofon açılmaz)
export function watch(room, players, onChange) {
  if (V.room === room && V.ch) { V.onChange = onChange; V.players = players; emit(); return; }
  stopAll();
  V.room = room; V.players = players; V.onChange = onChange;
  V.ch = sb.channel('ses-' + room, { config: { presence: { key: me() }, broadcast: { self: false } } });
  V.ch.on('presence', { event: 'sync' }, () => {
    const st = V.ch.presenceState();
    V.present = new Map();
    for (const [uid, metas] of Object.entries(st)) {
      if (!V.players.includes(uid)) continue;
      const m = metas[metas.length - 1];
      if (m?.inVoice) V.present.set(uid, { muted: !!m.muted });
    }
    if (V.joined) syncPeers();
    emit();
  });
  V.ch.on('broadcast', { event: 'sig' }, ({ payload }) => onSignal(payload));
  V.ch.on('broadcast', { event: 'ikram' }, ({ payload }) => { if (V.players.includes(payload?.from)) V.onTreat?.(payload); });
  V.ch.subscribe();
}

export async function join() {
  if (V.joined || !V.ch) return;
  try {
    V.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
  } catch (_) { toast('Mikrofon izni verilmedi'); return; }
  try { if (navigator.audioSession) navigator.audioSession.type = 'play-and-record'; } catch (_) { /* */ }
  try { V.ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (_) { V.ctx = null; }
  V.joined = true; V.muted = false; V.failed = new Set();
  addMeter(me(), V.stream);
  startMeters();
  await V.ch.track({ inVoice: true, muted: false });
  emit();
}

export async function leave() {
  if (!V.joined) return;
  V.joined = false;
  for (const uid of [...V.pcs.keys()]) closePeer(uid);
  V.stream?.getTracks().forEach((t) => t.stop()); V.stream = null;
  stopMeters();
  try { await V.ch?.untrack(); } catch (_) { /* */ }
  try { V.ctx?.close(); } catch (_) { /* */ } V.ctx = null;
  emit();
}

export async function toggleMute() {
  if (!V.joined || !V.stream) return;
  V.muted = !V.muted;
  V.stream.getAudioTracks().forEach((t) => { t.enabled = !V.muted; });
  try { await V.ch.track({ inVoice: true, muted: V.muted }); } catch (_) { /* */ }
  emit();
}

// Masadan çıkınca her şeyi kapat
export function stopAll() {
  if (V.joined) leave();
  if (V.ch) { try { sb.removeChannel(V.ch); } catch (_) { /* */ } }
  V.ch = null; V.room = null; V.present = new Map(); V.onChange = null;
}

// ---------------------------------------------------------------- eşler
function syncPeers() {
  const others = [...V.present.keys()].filter((u) => u !== me());
  for (const u of others) if (!V.pcs.has(u) && me() < u) makePeer(u, true); // küçük kimlikli olan arar
  for (const u of [...V.pcs.keys()]) if (!V.present.has(u)) closePeer(u);
}

const plainDesc = (d) => ({ type: d.type, sdp: d.sdp });
function send(to, type, data) {
  V.ch?.send({ type: 'broadcast', event: 'sig', payload: { from: me(), to, type, data } });
}

function makePeer(uid, initiator) {
  const pc = new RTCPeerConnection({ iceServers: ICE });
  V.pcs.set(uid, pc);
  V.stream?.getTracks().forEach((t) => pc.addTrack(t, V.stream));
  pc.onicecandidate = (e) => { if (e.candidate) send(uid, 'ice', e.candidate.toJSON()); };
  pc.ontrack = (e) => {
    let a = V.audios.get(uid);
    if (!a) {
      a = document.createElement('audio');
      a.autoplay = true; a.setAttribute('playsinline', ''); a.style.display = 'none';
      document.body.appendChild(a); V.audios.set(uid, a);
    }
    a.srcObject = e.streams[0];
    a.play().catch(() => {});
    addMeter(uid, e.streams[0]);
  };
  let restarted = false;
  pc.oniceconnectionstatechange = async () => {
    const s = pc.iceConnectionState;
    if (s === 'connected' || s === 'completed') { V.failed.delete(uid); emit(); }
    if (s === 'failed') {
      if (initiator && !restarted) { // bir kez yeniden dene
        restarted = true;
        try { const o = await pc.createOffer({ iceRestart: true }); await pc.setLocalDescription(o); send(uid, 'offer', plainDesc(pc.localDescription)); return; } catch (_) { /* */ }
      }
      V.failed.add(uid); emit();
      toast(`${nameOf(uid)} ile ses bağlantısı kurulamadı. Mobil veride olabilir, Wi-Fi'yi dene.`, 4000);
    }
  };
  if (initiator) {
    (async () => {
      try { const o = await pc.createOffer(); await pc.setLocalDescription(o); send(uid, 'offer', plainDesc(pc.localDescription)); } catch (e) { console.warn(e); }
    })();
  }
  return pc;
}

function closePeer(uid) {
  const pc = V.pcs.get(uid);
  try { pc?.close(); } catch (_) { /* */ }
  V.pcs.delete(uid);
  const a = V.audios.get(uid); if (a) { a.srcObject = null; a.remove(); V.audios.delete(uid); }
  V.meters.delete(uid); V.speaking.delete(uid);
}

async function onSignal(p) {
  if (!p || p.to !== me() || !V.joined || !V.players.includes(p.from)) return;
  let pc = V.pcs.get(p.from);
  try {
    if (p.type === 'offer') {
      if (!pc) pc = makePeer(p.from, false);
      await pc.setRemoteDescription(p.data);
      const ans = await pc.createAnswer();
      await pc.setLocalDescription(ans);
      send(p.from, 'answer', plainDesc(pc.localDescription));
    } else if (p.type === 'answer' && pc) {
      await pc.setRemoteDescription(p.data);
    } else if (p.type === 'ice' && pc) {
      await pc.addIceCandidate(p.data).catch(() => {});
    }
  } catch (e) { console.warn('ses', e); }
}

// ---------------------------------------------------------------- konuşan kim
function addMeter(uid, stream) {
  if (!V.ctx || !stream) return;
  try {
    const src = V.ctx.createMediaStreamSource(stream);
    const an = V.ctx.createAnalyser(); an.fftSize = 512;
    src.connect(an);
    V.meters.set(uid, { an, buf: new Uint8Array(an.fftSize) });
  } catch (_) { /* */ }
}
function startMeters() {
  stopMeters();
  V.meterT = setInterval(() => {
    let changed = false;
    for (const [uid, m] of V.meters) {
      m.an.getByteTimeDomainData(m.buf);
      let sum = 0; for (const v of m.buf) { const d = v - 128; sum += d * d; }
      const rms = Math.sqrt(sum / m.buf.length);
      const on = rms > 6 && !(uid === me() && V.muted) && !(uid !== me() && V.present.get(uid)?.muted);
      if (on !== V.speaking.has(uid)) { changed = true; if (on) V.speaking.add(uid); else V.speaking.delete(uid); }
    }
    if (changed) emit();
  }, 200);
}
function stopMeters() { if (V.meterT) { clearInterval(V.meterT); V.meterT = null; } V.meters = new Map(); V.speaking = new Set(); }
