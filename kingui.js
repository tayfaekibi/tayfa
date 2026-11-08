// King masası (4 kişi). Kurallar: supabase/functions/_shared/king.js — sunucu da aynısını kullanır.
import { sb, S, esc, svg, avatar, toast, errText, openSheet, closeSheet, sheetHead, me, nameOf } from './app.js';
import * as K from './supabase/functions/_shared/king.js';
import * as Voice from './voice.js';

const KU = { hand: [], gameId: null, sel: null, busy: false, pickType: null };

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
    return `<div class="k-seat ${posOf(i, mine)} ${turn ? 'turn' : ''}" data-vu="${u}">${avatar(nameOf(u), u)}<i class="k-vb" aria-hidden="true">${svg('headset')}</i>
      <b>${esc(nameOf(u).split(' ')[0])}</b><span>${st.score[i]} · ${st.counts[i]} kart${isCh ? ' · seçiyor' : ''}</span></div>`;
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
      <span class="small">${st.phase === 'play' ? `Bu el: ${st.handPts[mine]}` : `${st.hand}. el / 20`}</span></div>
      <button class="btn small" id="k-table">Puanlar</button>
      ${myTurn && st.phase === 'play' ? `<button class="btn primary" id="k-play" ${KU.sel && !KU.busy ? '' : 'disabled'}>Oyna</button>` : ''}</div>` : ''}
    ${game.status === 'active' && !playing ? '<button class="btn block" id="k-table">Puan tablosu</button>' : ''}
    ${playing ? '<div id="g-chatbar"></div>' : ''}`;

  const doPlay = async (c) => {
    if (KU.busy) return;
    KU.busy = true; KU.sel = null;
    const guard = setTimeout(() => { if (KU.busy) { KU.busy = false; loadHand(game).then(() => draw(game, box, call)); } }, 12000);
    const prev = KU.hand; KU.hand = KU.hand.filter((x) => x !== c); // hemen elden çıkar
    draw(game, box, call);
    const ok = await call('play', { card: c });
    clearTimeout(guard);
    KU.busy = false;
    if (!ok) { KU.hand = prev; draw(game, box, call); }
  };
  box.querySelectorAll('[data-kc]').forEach((el) => el.onclick = () => {
    const c = el.dataset.kc;
    if (!legal.includes(c)) { if (myTurn && st.phase === 'play') toast('Bu kartı şimdi oynayamazsın'); return; }
    if (KU.sel === c) return doPlay(c);
    KU.sel = c; draw(game, box, call);
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
  if (playing && game.status === 'active') Voice.watch(game.id, game.players, drawVoice);
  drawVoice();
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
