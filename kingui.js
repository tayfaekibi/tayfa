// King masası (4 kişi). Kurallar: supabase/functions/_shared/king.js — sunucu da aynısını kullanır.
import { sb, S, esc, svg, avatar, toast, errText, openSheet, closeSheet, sheetHead, me, nameOf } from './app.js';
import * as K from './supabase/functions/_shared/king.js';
import * as Voice from './voice.js';

const KU = { hand: [], gameId: null, sel: null, busy: false, pickType: null, pending: null };

export async function loadHand(game) {
  if (!game.players.includes(me())) { KU.hand = []; return; }
  const seat = game.players.indexOf(me());
  const { data } = await sb.from('king_hands').select('cards').eq('game_id', game.id).eq('seat', seat).maybeSingle();
  KU.hand = K.sortHand(data?.cards || []);
  KU.gameId = game.id;
}

const cardHtml = (c, cls = '', attr = '') => {
  const s = K.suitOf(c), red = s === 'H' || s === 'D';
  const r = K.RANK_TXT[K.rankOf(c)] || K.rankOf(c);
  return `<span class="kc ${red ? 'red' : ''} ${cls}" ${attr} aria-label="${esc(K.label(c))}"><b class="r">${r}</b><i class="s">${K.SUIT_SYM[s]}</i><i class="b">${K.SUIT_SYM[s]}</i></span>`;
};
const ctName = (c) => c ? (c.type === 'koz' ? `Koz · ${K.SUIT_NAME[c.trump]} ${K.SUIT_SYM[c.trump]}` : K.CONTRACTS[c.type].name) : '';

// Koltuklar: sen altta, senden sonra oynayan sağda, karşın üstte, solundaki solda (sıra sağdan döner)
const posOf = (seat, mine) => ['bot', 'right', 'top', 'left'][(seat - mine + 4) % 4];

// Elimdeki kart sayısı masadakiyle uyuşmuyorsa (yeni el dağıtılırken arada kalındıysa) eli yeniden al
let healT = null, healTries = 0;
function healHand(game, box, call) {
  if (healT) return;
  const wait = [300, 900, 2000, 4000][Math.min(healTries, 3)];
  healT = setTimeout(async () => {
    healT = null; healTries += 1;
    if (KU.busy || !box.isConnected) return;
    await loadHand(game);
    draw(game, box, call);
  }, wait);
}

export function draw(game, box, call) {
  // Oynadığım kart sunucudan onay gelene kadar masada görünsün
  if (KU.pending && KU.pending.game === game.id && game.state.phase === 'play'
      && !game.state.trick.some((t) => t.card === KU.pending.card)
      && !(game.state.lastTrick?.cards || []).some((t) => t.card === KU.pending.card)) {
    const s0 = game.state; const counts = [...s0.counts]; counts[KU.pending.seat] = Math.max(0, counts[KU.pending.seat] - 1);
    game = { ...game, state: { ...s0, trick: [...s0.trick, { seat: KU.pending.seat, card: KU.pending.card }], counts, turn: (KU.pending.seat + 1) % 4 } };
  }
  if (KU.pending && (game.state.trick.some((t) => t.card === KU.pending.card) || (game.state.lastTrick?.cards || []).some((t) => t.card === KU.pending.card))) KU.pending = null;
  const st = game.state;
  const mine = Math.max(0, game.players.indexOf(me()));
  const playing = game.players.includes(me());
  if (playing && game.status === 'active' && !KU.busy) {
    if (st.counts[mine] !== KU.hand.length) healHand(game, box, call); else healTries = 0;
  }
  const myTurn = playing && game.status === 'active' && st.turn === mine;
  if (KU.gameId !== game.id) KU.sel = null;
  const synced = !playing || st.counts[mine] === KU.hand.length;
  const legal = myTurn && st.phase === 'play' && synced ? K.legalCards(st, KU.hand) : [];
  if (KU.sel && !legal.includes(KU.sel)) KU.sel = null;

  const seatBox = (i) => {
    const u = game.players[i];
    const turn = game.status === 'active' && st.turn === i;
    const isCh = st.phase === 'choose' && st.chooser === i;
    const tb = st.tricksBy?.[i] || 0, hp = st.handPts?.[i] || 0;
    const marks = st.phase === 'play' ? penaltyMarks(st.contract?.type, hp) : '';
    return `<div class="k-seat ${posOf(i, mine)} ${turn ? 'turn' : ''}" data-vu="${u}" data-seat="${i}">${avatar(nameOf(u), u)}<i class="k-vb" aria-hidden="true">${svg('headset')}</i>${marks}
      <b>${esc(nameOf(u).split(' ')[0])}</b><span>Toplam ${st.score[i]}${isCh ? ' · seçiyor' : ''}</span>
      ${st.phase === 'play' ? `<em class="k-hp ${hp < 0 ? 'neg' : hp > 0 ? 'pos' : ''}">${tb} el${hp ? ` · ${hp > 0 ? '+' : ''}${hp}` : ''}</em>` : ''}</div>`;
  };
  // Ortadaki kartlar: oynanan el, el bittiyse bir önceki el (kim aldı)
  let center = '';
  const showLast = !st.trick.length && st.lastTrick && st.phase === 'play' && st.tricksDone > 0;
  const tr = st.trick.length ? st.trick : (showLast ? st.lastTrick.cards : []);
  center = tr.map((t) => cardHtml(t.card, `at-${posOf(t.seat, mine)} ${showLast ? 'old' : ''}`)).join('');
  if (showLast) center += `<span class="k-took">${esc(nameOf(game.players[st.lastTrick.winner]).split(' ')[0])} aldı</span>`;

  let status = '';
  if (game.status === 'finished') {
    const order = [0, 1, 2, 3].sort((a, b) => st.score[b] - st.score[a]);
    status = `<div class="g-end"><span class="cup">${svg('crown')}</span><h2>${game.winner === me() ? 'Kazandın!' : `${esc(nameOf(game.winner))} kazandı`}</h2>
      <p>${order.map((i) => `${esc(nameOf(game.players[i]).split(' ')[0])} ${st.score[i]}`).join(' · ')}</p>
      <button class="btn" id="k-table">Puan tablosu</button></div>`;
  } else if (game.status === 'abandoned') {
    status = '<div class="g-status">Masa kapatıldı</div>';
  } else if (st.phase === 'choose') {
    if (myTurn) {
      const ch = K.choicesFor(st, mine);
      const p = st.picks[mine];
      status = `<div class="k-pick"><b>${st.hand}. eli sen seçiyorsun</b>
        <span class="small">Kalan hakların: ${K.CEZA_PER_PLAYER - p.ceza} ceza, ${K.KOZ_PER_PLAYER - p.koz} koz</span>
        <div class="k-opts">${ch.filter((t) => t !== 'koz').map((t) => `<button class="k-opt ${KU.pickType === t ? 'on' : ''}" data-ct="${t}"><b>${K.CONTRACTS[t].name}</b><span>${K.CONTRACTS[t].short}${st.used[t] ? ` · ${K.CEZA_TIMES - st.used[t]} kaldı` : ''}</span></button>`).join('')}</div>
        ${ch.includes('koz') ? `<p class="small" style="margin-top:4px">Koz seç (her el +50):</p><div class="k-suits">${K.SUITS.map((s) => `<button class="k-suit ${s === 'H' || s === 'D' ? 'red' : ''}" data-koz="${s}" aria-label="Koz ${K.SUIT_NAME[s]}">${K.SUIT_SYM[s]}<span>${K.SUIT_NAME[s]}</span></button>`).join('')}</div>` : ''}
      </div>`;
    } else status = `<div class="g-status">${esc(nameOf(game.players[st.chooser]))} ${st.hand}. eli seçiyor…</div>`;
  } else if (!playing) status = `<div class="g-status">Sıra ${esc(nameOf(game.players[st.turn]))}'de</div>`;

  const turnTxt = game.status !== 'active' ? '' : st.phase === 'choose' ? '' : myTurn
    ? (st.trick.length ? `Sıra sende · ${K.SUIT_NAME[K.suitOf(st.trick[0].card)].toLocaleLowerCase('tr-TR')} istendi` : 'Sıra sende · elini aç')
    : `Sıra ${esc(nameOf(game.players[st.turn]).split(' ')[0])}'de`;

  const banner = st.contract ? `<div class="k-ct ${st.contract.type === 'koz' ? 'koz' : ''}"><span class="ic">${st.contract.type === 'koz' ? K.SUIT_SYM[st.contract.trump] : svg('crown')}</span>
      <span class="grow"><b>${ctName(st.contract)}</b><span>${st.contract.type === 'koz' ? 'Her el +50' : K.CONTRACTS[st.contract.type].short} · ${esc(nameOf(game.players[st.chooser]).split(' ')[0])} seçti</span></span>
      <span class="k-tr">${st.tricksDone}/13</span></div>` : '';

  box.innerHTML = `
    ${playing && game.status === 'active' ? '<div id="k-voice"></div>' : ''}
    ${banner}
    <div class="k-table">
      ${[0, 1, 2, 3].filter((i) => i !== mine || !playing).map(seatBox).join('')}
      <div class="k-center">${center}</div>
      ${turnTxt ? `<span class="k-turn ${myTurn ? 'me' : ''}">${turnTxt}</span>` : ''}
    </div>
    ${status}
    ${playing && KU.hand.length ? `<div class="k-hand ${KU.busy ? 'busy' : ''}">${KU.hand.map((c) => {
      const ok = legal.includes(c);
      return cardHtml(c, `${myTurn && st.phase === 'play' && !ok ? 'dim' : ''} ${KU.sel === c ? 'sel' : ''}`, `data-kc="${c}" role="button" tabindex="0"`);
    }).join('')}</div>` : ''}
    ${playing && game.status === 'active' ? `<div class="k-me">${avatar(nameOf(me()), me())}<div class="grow"><b>Sen · ${st.score[mine]}</b>
      <span class="small">${st.phase === 'play' ? `Bu el: ${st.tricksBy?.[mine] || 0} el · ${st.handPts[mine] > 0 ? '+' : ''}${st.handPts[mine]}` : `${st.hand}. el / 20`}</span></div>
      <button class="btn small" id="k-table">Puanlar</button>
      </div>` : ''}
    ${game.status === 'active' && !playing ? '<button class="btn block" id="k-table">Puan tablosu</button>' : ''}
    ${playing ? '<div id="g-chatbar"></div>' : ''}`;

  const doPlay = async (c) => {
    if (KU.busy) return;
    KU.busy = true; KU.sel = null;
    const guard = setTimeout(() => { if (KU.busy) { KU.busy = false; KU.pending = null; loadHand(game).then(() => draw(game, box, call)); } }, 16000);
    const prev = KU.hand; KU.hand = KU.hand.filter((x) => x !== c); // hemen elden çıkar
    // Kartı sunucu cevabını beklemeden masaya koy
    KU.pending = { game: game.id, seat: mine, card: c };
    draw(game, box, call);
    const ok = await call('play', { card: c });
    clearTimeout(guard);
    KU.busy = false;
    if (!ok) { KU.pending = null; KU.hand = prev; draw(game, box, call); }
    else setTimeout(() => { if (KU.pending?.card === c) KU.pending = null; }, 20000); // masa tazelenince kendiliğinden kalkar
  };
  box.querySelectorAll('[data-kc]').forEach((el) => el.onclick = () => {
    const c = el.dataset.kc;
    if (!legal.includes(c)) { if (myTurn && st.phase === 'play') toast('Bu kartı şimdi oynayamazsın'); return; }
    doPlay(c); // tek dokunuşla oyna
  });
  document.getElementById('k-play')?.addEventListener('click', () => KU.sel && doPlay(KU.sel));
  box.querySelectorAll('[data-ct]').forEach((b) => b.onclick = async () => {
    const t = b.dataset.ct;
    if (!confirm(`${st.hand}. el: ${K.CONTRACTS[t].name} seçilsin mi?`)) return;
    await call('choose', { type: t });
  });
  box.querySelectorAll('[data-koz]').forEach((b) => b.onclick = async () => {
    const s = b.dataset.koz;
    if (!confirm(`${st.hand}. el: Koz ${K.SUIT_NAME[s]} seçilsin mi?`)) return;
    await call('choose', { type: 'koz', trump: s });
  });
  box.querySelectorAll('#k-table').forEach((b) => b.onclick = () => scoreSheet(game));
  trickFx(game, mine, playing);
  if (playing && game.status === 'active') {
    Voice.watch(game.id, game.players, drawVoice);
    Voice.setTreatHandler((p) => showTreat(game, p));
    box.querySelectorAll('[data-seat]').forEach((el) => {
      const u = game.players[+el.dataset.seat];
      if (u === me()) return;
      let t = null;
      const start = () => { t = setTimeout(() => { t = null; navigator.vibrate?.(15); treatMenu(u); }, 450); };
      const cancel = () => { if (t) { clearTimeout(t); t = null; } };
      el.addEventListener('touchstart', start, { passive: true });
      el.addEventListener('touchend', cancel); el.addEventListener('touchmove', cancel, { passive: true });
      el.addEventListener('contextmenu', (e) => { e.preventDefault(); cancel(); treatMenu(u); });
    });
  }
  drawVoice();
}

// İkram: oyuncunun üstüne basılı tutunca
const TREATS = { cay: ['☕', 'Çay'], viski: ['🥃', 'Viski'], ayran: ['🥛', 'Ayran'], su: ['🧊', 'Soğuk su'] };
function treatMenu(u) {
  const first = esc(nameOf(u).split(' ')[0]);
  openSheet(`${sheetHead(`${first} için ikram`)}
    <div class="treats">${Object.entries(TREATS).map(([k, [e, n]]) => `<button class="treat" data-tr="${k}"><span>${e}</span>${n}</button>`).join('')}</div>`, () => {
    document.querySelectorAll('[data-tr]').forEach((b) => b.onclick = () => { closeSheet(); Voice.sendTreat(u, b.dataset.tr); });
  });
}
function showTreat(game, p) {
  const tr = TREATS[p.kind]; if (!tr) return;
  const to = document.querySelector(`.k-seat[data-vu="${p.to}"]`) || (p.to === me() ? document.querySelector('.k-me') : null);
  const from = document.querySelector(`.k-seat[data-vu="${p.from}"]`) || (p.from === me() ? document.querySelector('.k-me') : null);
  const fromName = nameOf(p.from).split(' ')[0], toName = nameOf(p.to).split(' ')[0];
  if (p.to === me() && p.from !== me()) toast(`${fromName} sana ${tr[1].toLocaleLowerCase('tr-TR')} ısmarladı ${tr[0]}`, 3500);
  if (!to) return;
  const b = to.getBoundingClientRect();
  const a = from ? from.getBoundingClientRect() : { left: window.innerWidth / 2, top: window.innerHeight - 120, width: 0, height: 0 };
  const el = document.createElement('span');
  el.className = 'treat-fly'; el.textContent = tr[0];
  const ax = a.left + a.width / 2, ay = a.top + a.height / 2, bx = b.left + b.width / 2, by = b.top + 10;
  Object.assign(el.style, { left: `${ax - 18}px`, top: `${ay - 18}px` });
  document.body.appendChild(el);
  el.animate([{ transform: 'translate(0,0) scale(.6)', opacity: 0.4 }, { transform: `translate(${(bx - ax) / 2}px, ${(by - ay) / 2 - 60}px) scale(1.4)`, opacity: 1, offset: 0.5 },
    { transform: `translate(${bx - ax}px, ${by - ay}px) scale(1)`, opacity: 1 }], { duration: 900, easing: 'ease-in-out', fill: 'forwards' })
    .finished.then(() => {
      el.remove();
      const tag = document.createElement('span');
      tag.className = 'treat-tag'; tag.innerHTML = `<b>${tr[0]}</b>${esc(fromName)}`;
      to.appendChild(tag);
      setTimeout(() => tag.remove(), 8000);
    }).catch(() => el.remove());
  if (p.from === me()) toast(`${toName} için ${tr[1].toLocaleLowerCase('tr-TR')} gönderildi ${tr[0]}`, 2000);
}

// Canlı ses: tek düğmeyle katıl, seste olanlar koltuklarda kulaklıkla görünür, konuşan parlar
export function drawVoice() {
  const el = document.getElementById('k-voice');
  const v = Voice.state();
  document.querySelectorAll('[data-vu]').forEach((s) => {
    const u = s.dataset.vu;
    s.classList.toggle('in-voice', v.inVoice.includes(u));
    s.classList.toggle('speaking', v.speaking.has(u));
    s.classList.toggle('v-fail', v.failed.has(u));
  });
  if (!el) return;
  const others = v.inVoice.filter((u) => u !== me());
  if (!v.joined) {
    el.innerHTML = `<button class="k-vjoin" id="kv-join">${svg('headset')}<span><b>Canlı sese katıl</b><small>${others.length ? `${others.map((u) => esc(nameOf(u).split(' ')[0])).join(', ')} seste` : 'Masadakilerle konuş'}</small></span></button>`;
    document.getElementById('kv-join').onclick = () => Voice.join();
  } else {
    el.innerHTML = `<div class="k-von ${v.speaking.has(me()) ? 'speaking' : ''}"><span class="dot"></span><span class="grow"><b>Canlı ses açık</b><small>${others.length ? `${others.map((u) => esc(nameOf(u).split(' ')[0])).join(', ')} ile` : 'Diğerleri bekleniyor…'}</small></span>
      <button class="k-vbtn ${v.muted ? 'off' : ''}" id="kv-mute" aria-label="${v.muted ? 'Mikrofonu aç' : 'Mikrofonu kapat'}">${svg(v.muted ? 'micOff' : 'mic')}</button>
      <button class="k-vbtn leave" id="kv-leave" aria-label="Sesten ayrıl">${svg('phoneOff')}</button></div>`;
    document.getElementById('kv-mute').onclick = () => Voice.toggleMute();
    document.getElementById('kv-leave').onclick = () => Voice.leave();
  }
}
export function stopVoice() { Voice.stopAll(); }

export function scoreSheet(game) {
  const st = game.state;
  const first = (u) => esc(nameOf(u).split(' ')[0]);
  const rows = st.history.map((h) => `<tr><td>${h.hand}</td><td class="l">${h.type === 'koz' ? `Koz ${K.SUIT_SYM[h.trump]}` : K.CONTRACTS[h.type].name}<small>${first(game.players[h.chooser])}</small></td>${h.pts.map((p) => `<td class="${p < 0 ? 'neg' : p > 0 ? 'pos' : ''}">${p || '·'}</td>`).join('')}</tr>`).join('');
  const left = (i) => `${K.CEZA_PER_PLAYER - st.picks[i].ceza}C ${K.KOZ_PER_PLAYER - st.picks[i].koz}K`;
  openSheet(`${sheetHead('Puan tablosu')}
    <div class="k-score"><table><thead><tr><th>El</th><th class="l">Oyun</th>${game.players.map((u) => `<th>${first(u)}</th>`).join('')}</tr></thead>
      <tbody>${rows || `<tr><td colspan="6" class="l" style="padding:14px 6px;color:var(--sub)">Henüz biten el yok</td></tr>`}</tbody>
      <tfoot><tr><td></td><td class="l">Toplam</td>${st.score.map((s) => `<td><b>${s}</b></td>`).join('')}</tr>
      <tr><td></td><td class="l"><small>Kalan seçim</small></td>${[0, 1, 2, 3].map((i) => `<td><small>${left(i)}</small></td>`).join('')}</tr></tfoot></table></div>
    <p class="small">C: ceza, K: koz. Her ceza oyunda en fazla 2 kez oynanır.</p>
    <button class="btn block" id="k-rules">Kurallar</button>`, () => {
    document.getElementById('k-rules').onclick = rulesSheet;
  });
}

export function rulesSheet() {
  openSheet(`${sheetHead('King kuralları')}
    <div class="sub" style="line-height:1.55;display:flex;flex-direction:column;gap:8px">
      <p>4 kişi, 20 el. Her elde sırası gelen oyuncu oyunu seçer ve ilk kartı o açar. Her oyuncu 5 kez seçer: 3 ceza, 2 koz. Her ceza oyunda en fazla 2 kez oynanır.</p>
      <p><b>Cezalar:</b> El almaz (her el −50), Kupa almaz (her kupa −30), Erkek almaz (her papaz ve vale −60), Kız almaz (her kız −100), Rıfkı (kupa papazı −320), Son iki (son iki el, her biri −180).</p>
      <p><b>Koz:</b> Seçen koz rengini belirler, alınan her el +50.</p>
      <p><b>Oynama:</b> İstenen rengi atmak zorunlu. Kozda renk yoksa koz atmak, mümkünse yükseltmek zorunlu. Cezalarda renk yoksa cezalı kartı (kupa, kız, erkek, kupa papazı) atmak zorunlu. Kupa almaz ve rıfkıda kupa, kozda koz, ilk kez atılana kadar açılamaz (elde sadece o yoksa).</p>
      <p>Bütün cezalı kartlar çıkınca el erken biter. 20 el sonunda en yüksek puan kazanır.</p>
    </div><button class="btn block" data-close>Kapat</button>`);
}

export function resetSel() { KU.sel = null; KU.pickType = null; }

// ================================================================== komik efektler
// Ceza yiyenin üstünde el boyunca kalan işaretler (puandan çıkarılır, herkes aynı şeyi görür)
function penaltyMarks(type, hp) {
  if (!type || hp >= 0) return '';
  const pos = ['m1', 'm2', 'm3', 'm4'];
  if (type === 'kiz') { const n = Math.min(4, Math.round(-hp / 100)); return pos.slice(0, n).map((p) => `<i class="k-mark ${p}">💋</i>`).join(''); }
  if (type === 'erkek') return '<i class="k-mark face">🥸</i>';
  if (type === 'kupa') { const n = Math.min(3, Math.ceil(-hp / 90)); return pos.slice(0, n).map((p) => `<i class="k-mark ${p}">💔</i>`).join(''); }
  if (type === 'rifki') return '<i class="k-mark hat">🤴</i>';
  if (type === 'el') return '<i class="k-mark face">🫠</i>';
  if (type === 'soniki') return '<i class="k-mark face">😵</i>';
  return '';
}
const BRAG = ['Topla bakalım! 😎', 'Bu el benim! 😏', 'Ustaya saygı 🫡', 'Kolay oldu 😌', 'Sıradaki? 🤷'];
const GRUMPY = ['😤', '🙄', '😒', '🤨'];
const LAUGH = ['😂', '🤭', '😆', '🤣'];
const pick = (a) => a[Math.floor(Math.random() * a.length)];
function seatEl(uid) {
  return uid === me() ? document.querySelector('.k-me') : document.querySelector(`.k-seat[data-vu="${uid}"]`);
}
function avatarEl(uid) { const s = seatEl(uid); return s?.querySelector('.av') || s; }
function floatAt(el, html, cls, ms = 2600) {
  if (!el) return;
  const r = el.getBoundingClientRect();
  const d = document.createElement('div');
  d.className = 'k-fx ' + cls; d.innerHTML = html;
  d.style.left = `${r.left + r.width / 2}px`; d.style.top = `${r.top}px`;
  document.body.appendChild(d);
  setTimeout(() => { d.classList.add('out'); setTimeout(() => d.remove(), 300); }, ms);
}
function confetti(el) {
  if (!el) return;
  const r = el.getBoundingClientRect();
  const cols = ['#FF7A59', '#FFD27A', '#7BE08A', '#9CC3EA', '#FF7A9C'];
  for (let i = 0; i < 18; i++) {
    const c = document.createElement('i');
    c.className = 'k-conf'; c.style.background = cols[i % cols.length];
    c.style.left = `${r.left + r.width / 2}px`; c.style.top = `${r.top + r.height / 2}px`;
    document.body.appendChild(c);
    const a = Math.random() * Math.PI * 2, dist = 50 + Math.random() * 70;
    c.animate([{ transform: 'translate(0,0) rotate(0)', opacity: 1 },
      { transform: `translate(${Math.cos(a) * dist}px, ${Math.sin(a) * dist - 30}px) rotate(${Math.random() * 540}deg)`, opacity: 0 }],
    { duration: 1100 + Math.random() * 500, easing: 'cubic-bezier(.2,.7,.4,1)' }).finished.then(() => c.remove()).catch(() => c.remove());
  }
}
function trickFx(game, mine, playing) {
  const st = game.state;
  const key = `${game.id}|${st.history?.length || 0}|${st.tricksDone}|${JSON.stringify(st.lastTrick?.cards || null)}`;
  if (KU.fxGame !== game.id) { KU.fxGame = game.id; KU.fxKey = key; return; } // ekran ilk açılınca oynatma
  if (KU.fxKey === key) return;
  KU.fxKey = key;
  const lt = st.lastTrick; if (!lt?.cards?.length) return;
  // El yeni bittiyse sözleşme history'de, değilse şu anki
  const handJustEnded = st.phase === 'choose' || (st.tricksDone === 0 && st.history?.length);
  const type = handJustEnded ? st.history[st.history.length - 1]?.type : st.contract?.type;
  const winner = game.players[lt.winner];
  const cards = lt.cards.map((t) => t.card);
  const wName = esc(nameOf(winner).split(' ')[0]);
  const others = game.players.filter((u) => u !== winner);
  setTimeout(() => {
    if (type === 'koz') {
      floatAt(avatarEl(winner), '👑', 'crown', 2600);
      confetti(avatarEl(winner));
      floatAt(seatEl(winner), esc(pick(BRAG)), 'brag', 2600);
      others.forEach((u) => floatAt(avatarEl(u), pick(GRUMPY), 'react', 2200));
      return;
    }
    let gag = null;
    if (type === 'kiz') { const n = cards.filter((c) => K.rankOf(c) === 12).length; if (n) gag = ['💋', `${wName} kızı kaptı! −${100 * n}`]; }
    else if (type === 'erkek') { const n = cards.filter((c) => [11, 13].includes(K.rankOf(c))).length; if (n) gag = ['🥸', `${wName} erkek aldı! −${60 * n}`]; }
    else if (type === 'kupa') { const n = cards.filter((c) => K.suitOf(c) === 'H').length; if (n) gag = ['💔', `${wName} ${n} kupa yedi! −${30 * n}`]; }
    else if (type === 'rifki') { if (cards.includes('H13')) gag = ['🤴', `${wName} rıfkıyı yedi! −320`]; }
    else if (type === 'el') gag = ['🫠', `${wName} el aldı −50`];
    else if (type === 'soniki' && (st.tricksDone >= 12 || handJustEnded)) gag = ['😵', `${wName} son eli aldı! −180`];
    if (!gag) return;
    floatAt(avatarEl(winner), gag[0], 'gag', 2600);
    floatAt(seatEl(winner), esc(gag[1]), 'shame', 2800);
    others.forEach((u) => floatAt(avatarEl(u), pick(LAUGH), 'react', 2200));
    if (winner === me()) navigator.vibrate?.([30, 40, 30]);
  }, 350);
}
