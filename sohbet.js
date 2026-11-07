// Sohbet: uçtan uca şifreli grup sohbeti, sesli mesajlar, tepkiler, yanıtlar
import {
  sb, S, esc, svg, avatar, toast, errText, rpc, fmt, openSheet, closeSheet, sheetHead,
  isAdmin, me, nameOf, activeMembers, header, bindHeader, route, updateTabDots, loadData,
} from './app.js';
import * as E from './e2e.js';

const C = {
  list: [],            // mesaj satırları (eskiden yeniye)
  plain: new Map(),    // id → { t } | { mime, dur } | { err }
  keys: new Map(),     // id → mesaj anahtarı (ses çözmek için)
  reactions: [],
  reads: [],
  replyTo: null,
  devices: null, devicesAt: 0,
  channel: null,
  typing: new Map(),
  mounted: false,
};
let dev = null;

const MAX_VOICE_MS = 120000;
const EMOJIS = ['👍', '😂', '❤️', '😮', '😢', '🎉'];

// ------------------------------------------------------------------ okunmamış nokta
export async function loadUnread() {
  if (S.ctx.status !== 'active') return;
  const [last, mine] = await Promise.all([
    sb.from('messages').select('created_at, sender').eq('group_id', S.ctx.group_id).neq('kind', 'system').order('created_at', { ascending: false }).limit(1),
    sb.from('chat_reads').select('last_read_at').eq('group_id', S.ctx.group_id).eq('user_id', me()).maybeSingle(),
  ]);
  const m = last.data?.[0];
  S.unreadChat = !!(m && m.sender !== me() && (!mine.data || new Date(m.created_at) > new Date(mine.data.last_read_at)));
  updateTabDots();
}

// ------------------------------------------------------------------ ekran
export function tabView() {
  return `<div class="chat-wrap">
    <div class="chat-head">${header('Sohbet', `<span class="e2e-line">${svg('lock')}Uçtan uca şifreli · 30 gün saklanır</span>`)}</div>
    <div class="chat-list" id="chat-list"><p class="sub" style="text-align:center;padding:40px 0">Mesajlar yükleniyor…</p></div>
    <div class="chat-typing" id="chat-typing"></div>
    <div class="composer" id="composer">
      <div id="reply-bar"></div>
      <div id="mention-bar" class="mention-bar"></div>
      <div class="composer-row">
        <label class="hidden" for="msg-in">Mesaj</label>
        <textarea id="msg-in" rows="1" maxlength="2000" placeholder="Mesaj yaz, @ ile birini çağır"></textarea>
        <button class="round-btn" id="send-btn" aria-label="Sesli mesaj için basılı tut">${svg('mic')}</button>
      </div>
      <div class="rec-bar hidden" id="rec-bar"><span class="rec-dot"></span><span id="rec-time">0:00</span><span class="grow small" style="color:var(--sub)">Bırakınca gider · iptal için yukarı kaydır</span></div>
    </div>
  </div>`;
}

export async function mount() {
  C.mounted = true;
  bindHeader();
  bindComposer();
  fitViewport();
  try {
    dev = await E.ensureDevice(me(), rpc);
    await loadMessages();
    subscribe();
    drawList(true);
    markRead();
  } catch (e) {
    const l = document.getElementById('chat-list');
    if (l) l.innerHTML = `<p class="sub" style="text-align:center;padding:40px 16px">${esc(errText(e))}</p>`;
  }
}

export function unmount() {
  if (!C.mounted) return;
  C.mounted = false;
  if (C.channel) { sb.removeChannel(C.channel); C.channel = null; }
  window.visualViewport?.removeEventListener('resize', onVV);
}

// iPhone klavyesi açılınca yazma alanı klavyenin üstünde kalsın
function onVV() {
  const vv = window.visualViewport; if (!vv) return;
  const kb = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
  document.documentElement.style.setProperty('--kb', kb + 'px');
  document.body.classList.toggle('kb-open', kb > 80);
}
function fitViewport() { window.visualViewport?.addEventListener('resize', onVV); onVV(); }

// ------------------------------------------------------------------ veri
async function loadMessages() {
  const { data, error } = await sb.from('messages').select('*').eq('group_id', S.ctx.group_id)
    .order('created_at', { ascending: false }).limit(200);
  if (error) throw error;
  C.list = (data || []).reverse();
  await Promise.all(C.list.map(decrypt));
  const ids = C.list.map((m) => m.id);
  const [r, rd] = await Promise.all([
    ids.length ? sb.from('message_reactions').select('*').in('message_id', ids) : { data: [] },
    sb.from('chat_reads').select('*').eq('group_id', S.ctx.group_id),
  ]);
  C.reactions = r.data || [];
  C.reads = rd.data || [];
}

async function decrypt(m) {
  if (m.kind === 'system' || C.plain.has(m.id)) return;
  try {
    const r = await E.open(m, dev);
    if (!r) { C.plain.set(m.id, { err: 'locked' }); return; }
    C.plain.set(m.id, E.dec(r.bytes));
    C.keys.set(m.id, r.key);
  } catch (e) { C.plain.set(m.id, { err: 'bad' }); }
}

async function groupDevices() {
  if (C.devices && Date.now() - C.devicesAt < 60000) return C.devices;
  const ids = activeMembers().map((m) => m.user_id);
  const { data, error } = await sb.from('devices').select('id, user_id, public_key').in('user_id', ids);
  if (error) throw error;
  C.devices = data || []; C.devicesAt = Date.now();
  if (!C.devices.some((d) => d.id === dev.id)) C.devices.push({ id: dev.id, user_id: me(), public_key: dev.pub });
  return C.devices;
}

function subscribe() {
  if (C.channel) sb.removeChannel(C.channel);
  C.channel = sb.channel('sohbet-' + S.ctx.group_id, { config: { broadcast: { self: false } } })
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `group_id=eq.${S.ctx.group_id}` }, async ({ new: m }) => {
      if (C.list.some((x) => x.id === m.id)) return;
      await decrypt(m);
      C.list.push(m);
      C.typing.delete(m.sender);
      drawList(nearBottom()); drawTyping();
      if (document.visibilityState === 'visible') markRead();
    })
    .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'messages' }, ({ old }) => {
      C.list = C.list.filter((x) => x.id !== old.id); drawList(false);
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'message_reactions' }, async () => {
      const ids = C.list.map((m) => m.id);
      if (!ids.length) return;
      const r = await sb.from('message_reactions').select('*').in('message_id', ids);
      C.reactions = r.data || []; drawList(false);
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'chat_reads' }, async () => {
      const rd = await sb.from('chat_reads').select('*').eq('group_id', S.ctx.group_id);
      C.reads = rd.data || []; drawList(false);
    })
    .on('broadcast', { event: 'typing' }, ({ payload }) => {
      if (!payload?.uid || payload.uid === me()) return;
      C.typing.set(payload.uid, Date.now()); drawTyping();
      setTimeout(drawTyping, 3200);
    })
    .subscribe();
}

let readT;
function markRead() {
  clearTimeout(readT);
  readT = setTimeout(async () => {
    try { await rpc('mark_read'); S.unreadChat = false; updateTabDots(); } catch (_) { /* */ }
  }, 600);
}

// ------------------------------------------------------------------ çizim
const nearBottom = () => { const l = document.getElementById('chat-list'); return !l || l.scrollHeight - l.scrollTop - l.clientHeight < 140; };
const dayKey = (d) => new Intl.DateTimeFormat('tr-TR', { day: 'numeric', month: 'long', weekday: 'long', timeZone: 'Europe/Istanbul' }).format(d);

function drawList(scroll) {
  const l = document.getElementById('chat-list');
  if (!l) return;
  if (!C.list.length) {
    l.innerHTML = `<div class="empty" style="padding:60px 20px">${svg('lock')}<b style="color:var(--ink)">Sohbet şifreli</b>
      <span>Mesajlar telefonlarınızda şifrelenir; sunucuda kimse okuyamaz. İlk mesajı sen yaz.</span></div>`;
    return;
  }
  let html = ''; let lastDay = '';
  const myLast = [...C.list].reverse().find((m) => m.sender === me() && m.kind !== 'system');
  for (const m of C.list) {
    const d = new Date(m.created_at);
    const dk = dayKey(d);
    if (dk !== lastDay) { html += `<div class="day-sep"><span>${esc(dk)}</span></div>`; lastDay = dk; }
    html += m.kind === 'system' ? systemCard(m) : bubble(m, m === myLast);
  }
  l.innerHTML = html;
  bindList(l);
  if (scroll) l.scrollTop = l.scrollHeight;
}

function systemCard(m) {
  const p = m.payload || {};
  if (p.type === 'event') {
    const mine = S.rsvps?.find((r) => r.event_id === p.event_id && r.user_id === me())?.answer;
    return `<div class="sys-card"><span class="sys-k">YENİ PLAN</span>
      <div class="sys-row"><div><b>${esc(p.title)}</b><div class="small">${esc(fmt.short(new Date(p.starts_at)))}${p.place ? ' · ' + esc(p.place) : ''}</div></div>
      ${mine === 'yes' ? '<span class="small" style="color:var(--ok);font-weight:700">✓ Geliyorsun</span>'
        : `<button class="btn small primary" data-sys-rsvp="${p.event_id}">Geliyorum</button>`}</div></div>`;
  }
  if (p.type === 'album') {
    return `<div class="sys-card"><div class="sys-row">${svg('img')}<span style="flex:1"><b>${esc(p.title)}</b> albümüne ${p.count} fotoğraf eklendi</span>
      <button class="btn small" data-sys-album="${p.album_id}">Gör</button></div></div>`;
  }
  if (p.type === 'game') {
    return `<div class="sys-card"><div class="sys-row">${svg('trophy')}<span style="flex:1">${esc(p.text)}</span></div></div>`;
  }
  return '';
}

function bubble(m, isMyLast) {
  const mine = m.sender === me();
  const p = C.plain.get(m.id) || {};
  const time = new Intl.DateTimeFormat('tr-TR', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Istanbul' }).format(new Date(m.created_at));
  let body;
  if (p.err === 'locked') body = `<span class="locked">${svg('lock')}Bu mesaj, bu cihaz kaydedilmeden önce gönderilmiş.</span>`;
  else if (p.err) body = `<span class="locked">${svg('lock')}Mesaj çözülemedi.</span>`;
  else if (m.kind === 'voice') body = `<div class="voice" data-voice="${m.id}"><button class="voice-play" aria-label="Oynat">${svg('play')}</button>
      <div class="voice-bar"><i></i></div><span class="voice-t">${fmtDur(m.duration_ms)}</span><button class="voice-speed" aria-label="Hız">1x</button></div>`;
  else body = `<div class="msg-text">${linkify(esc(p.t || ''))}</div>`;
  let quote = '';
  if (m.reply_to) {
    const q = C.list.find((x) => x.id === m.reply_to);
    const qp = q ? C.plain.get(q.id) : null;
    const qt = !q ? 'Silinmiş mesaj' : q.kind === 'voice' ? '🎤 Sesli mesaj' : qp?.t ? qp.t.slice(0, 90) : '🔒';
    quote = `<div class="quote"><b>${esc(q ? nameOf(q.sender) : '')}</b>${esc(qt)}</div>`;
  }
  const rs = C.reactions.filter((r) => r.message_id === m.id);
  const groups = {};
  rs.forEach((r) => { groups[r.emoji] = (groups[r.emoji] || 0) + 1; });
  const rx = Object.keys(groups).length ? `<div class="rx">${Object.entries(groups).map(([e, n]) => `<span>${e}${n > 1 ? ' ' + n : ''}</span>`).join('')}</div>` : '';
  let seen = '';
  if (mine && isMyLast) {
    const n = C.reads.filter((r) => r.user_id !== me() && new Date(r.last_read_at) >= new Date(m.created_at)).length;
    seen = ` · ${n ? n + ' kişi gördü' : 'gönderildi'}`;
  }
  return `<div class="msg ${mine ? 'mine' : ''}" data-msg="${m.id}">
    ${mine ? '' : avatar(nameOf(m.sender), m.sender)}
    <div class="msg-col">
      ${mine ? '' : `<span class="msg-name">${esc(nameOf(m.sender))}</span>`}
      <div class="bubble">${quote}${body}</div>${rx}
      <span class="msg-time">${time}${seen}</span>
    </div></div>`;
}
const fmtDur = (ms) => { const s = Math.round((ms || 0) / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
const linkify = (h) => h.replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>')
  .replace(/@([\wçğıöşüÇĞİÖŞÜ]+)/g, '<b class="mention">@$1</b>');

function bindList(l) {
  l.querySelectorAll('[data-msg]').forEach((el) => {
    let t = null;
    const start = () => { t = setTimeout(() => { t = null; msgMenu(el.dataset.msg); }, 450); };
    const cancel = () => { if (t) { clearTimeout(t); t = null; } };
    el.addEventListener('touchstart', start, { passive: true });
    el.addEventListener('touchend', cancel); el.addEventListener('touchmove', cancel, { passive: true });
    el.addEventListener('contextmenu', (e) => { e.preventDefault(); msgMenu(el.dataset.msg); });
  });
  l.querySelectorAll('[data-voice]').forEach((el) => bindVoice(el));
  l.querySelectorAll('[data-sys-rsvp]').forEach((b) => b.onclick = async () => {
    try { await rpc('set_rsvp', { p_event: b.dataset.sysRsvp, p_answer: 'yes' }); await loadData(); drawList(false); toast('Katılımın kaydedildi'); }
    catch (e) { toast(errText(e)); }
  });
  l.querySelectorAll('[data-sys-album]').forEach((b) => b.onclick = () => route('#album/' + b.dataset.sysAlbum));
}

function drawTyping() {
  const el = document.getElementById('chat-typing'); if (!el) return;
  const now = Date.now();
  const who = [...C.typing.entries()].filter(([, t]) => now - t < 3000).map(([u]) => nameOf(u));
  el.textContent = who.length ? `${who.join(', ')} yazıyor…` : '';
}

// ------------------------------------------------------------------ mesaj menüsü
function msgMenu(id) {
  const m = C.list.find((x) => x.id === id); if (!m) return;
  const p = C.plain.get(id) || {};
  const myR = C.reactions.find((r) => r.message_id === id && r.user_id === me())?.emoji;
  const who = C.reactions.filter((r) => r.message_id === id).map((r) => `${r.emoji} ${esc(nameOf(r.user_id))}`).join(' · ');
  openSheet(`<div class="emoji-row">${EMOJIS.map((e) => `<button class="${myR === e ? 'on' : ''}" data-emo="${e}">${e}</button>`).join('')}</div>
    ${who ? `<p class="small" style="text-align:center">${who}</p>` : ''}
    <button class="btn block" id="mm-reply">${svg('reply')}Yanıtla</button>
    ${p.t ? `<button class="btn block" id="mm-copy">${svg('copy')}Kopyala</button>` : ''}
    ${m.sender === me() || isAdmin() ? `<button class="btn block danger" id="mm-del">${svg('trash')}Herkesten sil</button>` : ''}`, () => {
    document.querySelectorAll('[data-emo]').forEach((b) => b.onclick = async () => {
      closeSheet();
      try { await rpc('react', { p_message: id, p_emoji: myR === b.dataset.emo ? null : b.dataset.emo }); } catch (e) { toast(errText(e)); }
    });
    document.getElementById('mm-reply').onclick = () => { closeSheet(); C.replyTo = id; drawReply(); document.getElementById('msg-in')?.focus(); };
    document.getElementById('mm-copy')?.addEventListener('click', async () => { closeSheet(); try { await navigator.clipboard.writeText(p.t); toast('Kopyalandı'); } catch (_) { /* */ } });
    document.getElementById('mm-del')?.addEventListener('click', async () => {
      closeSheet();
      try {
        const path = await rpc('delete_message', { p_message: id });
        if (path) await sb.storage.from('chat').remove([path]);
        C.list = C.list.filter((x) => x.id !== id); drawList(false);
      } catch (e) { toast(errText(e)); }
    });
  });
}

function drawReply() {
  const el = document.getElementById('reply-bar'); if (!el) return;
  if (!C.replyTo) { el.innerHTML = ''; return; }
  const q = C.list.find((x) => x.id === C.replyTo); const qp = q && C.plain.get(q.id);
  el.innerHTML = `<div class="reply-bar"><div style="flex:1;min-width:0"><b>${esc(nameOf(q?.sender))}</b>
    <span>${esc(q?.kind === 'voice' ? '🎤 Sesli mesaj' : (qp?.t || '').slice(0, 80))}</span></div>
    <button class="icon-btn" style="width:34px;height:34px;border:none" id="reply-x" aria-label="Yanıtı iptal et">${svg('x')}</button></div>`;
  document.getElementById('reply-x').onclick = () => { C.replyTo = null; drawReply(); };
}

// ------------------------------------------------------------------ yazma ve gönderme
let typingSent = 0;
function bindComposer() {
  const inp = document.getElementById('msg-in');
  const btn = document.getElementById('send-btn');
  if (!inp) return;
  const setBtn = () => {
    const has = inp.value.trim().length > 0;
    btn.innerHTML = svg(has ? 'send' : 'mic');
    btn.setAttribute('aria-label', has ? 'Gönder' : 'Sesli mesaj için basılı tut');
    btn.classList.toggle('send', has);
  };
  inp.addEventListener('input', () => {
    inp.style.height = 'auto'; inp.style.height = Math.min(120, inp.scrollHeight) + 'px';
    setBtn(); drawMentions(inp);
    if (Date.now() - typingSent > 2000 && C.channel) {
      typingSent = Date.now();
      C.channel.send({ type: 'broadcast', event: 'typing', payload: { uid: me() } });
    }
  });
  inp.addEventListener('focus', () => setTimeout(() => { const l = document.getElementById('chat-list'); if (l) l.scrollTop = l.scrollHeight; }, 300));
  btn.addEventListener('click', () => { if (inp.value.trim()) sendText(); });
  bindRecorder(btn, () => !inp.value.trim());
}

function drawMentions(inp) {
  const bar = document.getElementById('mention-bar');
  const m = inp.value.slice(0, inp.selectionStart).match(/@([\wçğıöşüÇĞİÖŞÜ]*)$/);
  if (!m) { bar.innerHTML = ''; return; }
  const q = m[1].toLocaleLowerCase('tr-TR');
  const list = activeMembers().filter((x) => x.user_id !== me() && x.display_name.toLocaleLowerCase('tr-TR').startsWith(q));
  bar.innerHTML = list.map((x) => `<button data-men="${esc(x.display_name)}">${avatar(x.display_name, x.user_id)}${esc(x.display_name)}</button>`).join('');
  bar.querySelectorAll('[data-men]').forEach((b) => b.onclick = () => {
    const pos = inp.selectionStart;
    const before = inp.value.slice(0, pos).replace(/@([\wçğıöşüÇĞİÖŞÜ]*)$/, '@' + b.dataset.men.split(' ')[0] + ' ');
    inp.value = before + inp.value.slice(pos);
    inp.focus(); inp.setSelectionRange(before.length, before.length);
    bar.innerHTML = ''; inp.dispatchEvent(new Event('input'));
  });
}

function mentionsIn(text) {
  return activeMembers().filter((x) => x.user_id !== me() && new RegExp('@' + x.display_name.split(' ')[0] + '(?![\\wçğıöşü])', 'i').test(text)).map((x) => x.user_id);
}

async function sendText() {
  const inp = document.getElementById('msg-in');
  const text = inp.value.trim(); if (!text) return;
  inp.value = ''; inp.dispatchEvent(new Event('input'));
  try {
    const devs = await groupDevices();
    const s = await E.seal(E.enc({ t: text }), devs);
    const row = { group_id: S.ctx.group_id, sender: me(), kind: 'text', iv: s.iv, ciphertext: s.ciphertext, epk: s.epk, keys: s.keys,
      reply_to: C.replyTo, mentions: mentionsIn(text) };
    const { data, error } = await sb.from('messages').insert(row).select().single();
    if (error) throw error;
    C.plain.set(data.id, { t: text }); C.keys.set(data.id, s.msgKey);
    if (!C.list.some((x) => x.id === data.id)) C.list.push(data);
    C.replyTo = null; drawReply(); drawList(true);
  } catch (e) { inp.value = text; inp.dispatchEvent(new Event('input')); toast('Gönderilemedi: ' + errText(e)); }
}

// ------------------------------------------------------------------ sesli mesaj
function bindRecorder(btn, canRecord) {
  let rec = null, chunks = [], t0 = 0, timer = null, y0 = 0, cancelled = false, stream = null, pressed = false;
  const bar = () => document.getElementById('rec-bar');
  const stop = (send) => {
    if (!rec) return;
    cancelled = !send;
    clearInterval(timer);
    try { rec.stop(); } catch (_) { /* */ }
    bar()?.classList.add('hidden');
    btn.classList.remove('rec');
  };
  btn.addEventListener('pointerdown', async (e) => {
    if (!canRecord()) return;
    e.preventDefault();
    pressed = true;
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) { toast('Bu cihazda ses kaydı desteklenmiyor'); return; }
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); }
    catch (_) { pressed = false; toast('Mikrofon izni verilmedi'); return; }
    if (!pressed) { stream.getTracks().forEach((t) => t.stop()); toast('Sesli mesaj için basılı tut'); return; }
    const mime = ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm'].find((x) => MediaRecorder.isTypeSupported?.(x)) || '';
    rec = new MediaRecorder(stream, mime ? { mimeType: mime, audioBitsPerSecond: 32000 } : undefined);
    chunks = []; cancelled = false; t0 = Date.now(); y0 = e.clientY;
    rec.ondataavailable = (ev) => { if (ev.data.size) chunks.push(ev.data); };
    rec.onstop = () => {
      stream.getTracks().forEach((t) => t.stop());
      const dur = Date.now() - t0;
      const type = rec.mimeType || mime || 'audio/mp4';
      rec = null;
      if (cancelled || dur < 700) { if (!cancelled) toast('Kaydetmek için basılı tut'); return; }
      sendVoice(new Blob(chunks, { type }), Math.min(dur, MAX_VOICE_MS));
    };
    rec.start(250);
    btn.classList.add('rec');
    bar()?.classList.remove('hidden');
    timer = setInterval(() => {
      const ms = Date.now() - t0;
      const el = document.getElementById('rec-time'); if (el) el.textContent = fmtDur(ms);
      if (ms >= MAX_VOICE_MS) stop(true);
    }, 200);
    try { btn.setPointerCapture(e.pointerId); } catch (_) { /* */ }
  });
  btn.addEventListener('pointermove', (e) => { if (rec && y0 - e.clientY > 80) { stop(false); toast('Kayıt iptal edildi'); } });
  btn.addEventListener('pointerup', () => { pressed = false; stop(true); });
  btn.addEventListener('pointercancel', () => { pressed = false; stop(false); });
}

async function sendVoice(blob, dur) {
  toast('Sesli mesaj gönderiliyor…', 1500);
  try {
    const devs = await groupDevices();
    const s = await E.seal(E.enc({ mime: blob.type, dur }), devs);
    const audio = await E.encBytes(s.msgKey, new Uint8Array(await blob.arrayBuffer()));
    const path = `${S.ctx.group_id}/${me()}/${crypto.randomUUID()}.bin`;
    const up = await sb.storage.from('chat').upload(path, new Blob([audio.data], { type: 'application/octet-stream' }), { contentType: 'application/octet-stream' });
    if (up.error) throw up.error;
    const row = { group_id: S.ctx.group_id, sender: me(), kind: 'voice', iv: s.iv, ciphertext: s.ciphertext, epk: s.epk, keys: s.keys,
      audio_path: path, audio_iv: audio.iv, duration_ms: dur, reply_to: C.replyTo, mentions: [] };
    const { data, error } = await sb.from('messages').insert(row).select().single();
    if (error) throw error;
    C.plain.set(data.id, { mime: blob.type, dur }); C.keys.set(data.id, s.msgKey);
    voiceCache.set(data.id, URL.createObjectURL(blob));
    if (!C.list.some((x) => x.id === data.id)) C.list.push(data);
    C.replyTo = null; drawReply(); drawList(true);
  } catch (e) { toast('Sesli mesaj gönderilemedi: ' + errText(e)); }
}

const voiceCache = new Map();
let playing = null;
function bindVoice(el) {
  const id = el.dataset.voice;
  const m = C.list.find((x) => x.id === id);
  const playBtn = el.querySelector('.voice-play'), speedBtn = el.querySelector('.voice-speed'), bar = el.querySelector('.voice-bar i');
  speedBtn.onclick = (e) => {
    e.stopPropagation();
    const next = { '1x': '1.5x', '1.5x': '2x', '2x': '1x' }[speedBtn.textContent];
    speedBtn.textContent = next;
    if (playing?.id === id) playing.audio.playbackRate = parseFloat(next);
  };
  playBtn.onclick = async (e) => {
    e.stopPropagation();
    if (playing?.id === id) {
      if (playing.audio.paused) { playing.audio.play(); playBtn.innerHTML = svg('pause'); } else { playing.audio.pause(); playBtn.innerHTML = svg('play'); }
      return;
    }
    if (playing) { playing.audio.pause(); playing = null; drawList(false); }
    try {
      let url = voiceCache.get(id);
      if (!url) {
        playBtn.innerHTML = '…';
        const key = C.keys.get(id); const meta = C.plain.get(id);
        if (!key) throw new Error('Bu sesli mesaj bu cihazda açılamıyor');
        const { data, error } = await sb.storage.from('chat').download(m.audio_path);
        if (error) throw error;
        const bytes = await E.decBytes(key, m.audio_iv, new Uint8Array(await data.arrayBuffer()));
        url = URL.createObjectURL(new Blob([bytes], { type: meta.mime || 'audio/mp4' }));
        voiceCache.set(id, url);
      }
      const audio = new Audio(url);
      audio.playbackRate = parseFloat(speedBtn.textContent);
      playing = { id, audio };
      audio.ontimeupdate = () => { if (audio.duration && isFinite(audio.duration)) bar.style.width = `${(audio.currentTime / audio.duration) * 100}%`; };
      audio.onended = () => { playBtn.innerHTML = svg('play'); bar.style.width = '0%'; playing = null; };
      await audio.play();
      playBtn.innerHTML = svg('pause');
    } catch (err) { playBtn.innerHTML = svg('play'); toast(errText(err)); }
  };
}
