// Bota karşı antrenman: oyun tamamen telefonda oynanır (sunucu, bildirim, sohbet, istatistik yok).
// Kurallar gerçek oyunla aynı modüllerden gelir (_shared/tavla.js, _shared/king.js).
import * as T from './supabase/functions/_shared/tavla.js';
import * as K from './supabase/functions/_shared/king.js';

export const BOT_NAMES = { 'bot-kaptan': 'Kaptan', 'bot-lodos': 'Lodos', 'bot-poyraz': 'Poyraz' };
export const isBot = (id) => typeof id === 'string' && id.startsWith('bot-');
export const isLocalGame = (id) => typeof id === 'string' && id.startsWith('bot-');
const KEY = (kind) => 'tayfa-bot-' + kind;
const rnd = (n) => Math.floor(Math.random() * n);
const die = () => 1 + rnd(6);
let tick = 0;
const stamp = () => new Date(Date.now() + (tick++ % 1000)).toISOString();

// ------------------------------------------------------------------ kayıt
export function load(kind, me) {
  try {
    const g = JSON.parse(localStorage.getItem(KEY(kind)) || 'null');
    if (g && g.players?.[0] === me) return fix(g);
  } catch (_) { /* */ }
  return null;
}
export function save(g) { try { localStorage.setItem(KEY(g.kind), JSON.stringify(g)); } catch (_) { /* */ } }
export function hasSaved(kind, me) { const g = load(kind, me); return !!g && g.status === 'active'; }

export function newGame(kind, me) {
  const g = fix(kind === 'king' ? newKing(me) : newTavla(me));
  save(g);
  return g;
}
function newTavla(me) {
  const b = T.newBoard();
  const starter = rnd(2);
  return {
    id: 'bot-tavla', kind: 'tavla', local: true, players: [me, 'bot-kaptan'], status: 'active', winner: null,
    match_to: 5, created_by: me, updated_at: stamp(),
    state: { board: b.board, bar: b.bar, off: b.off, turn: starter, dice: [], score: [0, 0], hand: 1 },
  };
}
function newKing(me) {
  const starter = rnd(4);
  return {
    id: 'bot-king', kind: 'king', local: true, players: [me, 'bot-kaptan', 'bot-lodos', 'bot-poyraz'], status: 'active', winner: null,
    match_to: 20, created_by: me, updated_at: stamp(), state: K.newState(starter), hands: K.deal(rnd),
  };
}
// JSON'dan gelen oyunlarda "turn" alanını yeniden hesapla
export function fix(g) {
  if (!g) return g;
  Object.defineProperty(g, 'turn', { configurable: true, enumerable: false, get() { return this.status === 'active' ? this.players[this.state.turn] : null; } });
  return g;
}

// ------------------------------------------------------------------ hamleler (sunucudaki kurallarla aynı)
export function act(g, uid, action, body = {}) {
  const r = g.kind === 'king' ? actKing(g, uid, action, body) : actTavla(g, uid, action, body);
  g.updated_at = stamp();
  save(g);
  return r;
}

function actTavla(g, uid, action, body) {
  const st = g.state;
  const p = g.players.indexOf(uid);
  if (p < 0) throw new Error('Bu oyunda değilsin');
  if (g.status !== 'active') throw new Error('Oyun bitti');
  const finishHand = (w, points, how) => {
    st.score[w] += points;
    st.resignOffer = null; st.resignRejected = null; st.dice = []; st.autoPass = null;
    if (st.score[w] >= g.match_to) { g.status = 'finished'; g.winner = g.players[w]; }
    else {
      const fresh = T.newBoard();
      st.board = fresh.board; st.bar = fresh.bar; st.off = fresh.off;
      st.hand = (st.hand ?? 1) + 1; st.turn = 1 - w; st.lastHand = { winner: w, points, how };
    }
  };
  if (action === 'offer_resign') {
    const pts = Number(body.points) === 2 ? 2 : 1;
    // Bot hemen karar verir
    if (botAcceptsResign(st, 1 - p, pts)) { st.last = { by: p, handResign: true, points: pts }; finishHand(1 - p, pts, 'pes'); }
    else { st.resignOffer = null; st.resignRejected = { by: p, points: pts }; }
  } else if (action === 'cancel_resign') {
    st.resignOffer = null;
  } else if (action === 'resign') {
    g.status = 'finished'; g.winner = g.players[1 - p]; st.last = { by: p, resign: true };
  } else {
    if (st.turn !== p) throw new Error('Sıra sende değil');
    if (action === 'roll') {
      if (st.dice?.length) throw new Error('Zar zaten atıldı');
      st.resignRejected = null;
      if (st.autoPass?.by === p) st.autoPass = null;
      const a = die(), b = die();
      st.roll = [a, b]; st.dice = T.rollToDice(a, b);
      if (T.legalSequences(st, p, st.dice).maxLen === 0) {
        st.last = { by: p, roll: [a, b], moves: [], pass: true }; st.dice = []; st.turn = 1 - p;
      }
    } else if (action === 'move') {
      if (!st.dice?.length) throw new Error('Önce zar at');
      const seq = body.moves ?? [];
      const legal = T.legalSequences(st, p, st.dice);
      if (!T.isLegalSequence(legal, seq)) throw new Error('Bu hamle kurallara uygun değil');
      const next = T.applySequence(st, p, seq);
      st.board = next.board; st.bar = next.bar; st.off = next.off;
      st.last = { by: p, roll: st.roll, moves: seq }; st.dice = [];
      const res = T.handResult(st, p);
      if (res) finishHand(p, res.points, 'oyun'); else st.turn = 1 - p;
    } else throw new Error('Bilinmeyen işlem');
  }
  // Kapalı eve giremeyecek oyuncuya boşuna zar attırma
  if (g.status === 'active' && !st.dice?.length) {
    const t = st.turn;
    if (T.entryBlocked(st, t) && !T.entryBlocked(st, 1 - t)) { st.autoPass = { by: t }; st.turn = 1 - t; }
  }
  return true;
}

function actKing(g, uid, action, body) {
  const st = g.state;
  const seat = g.players.indexOf(uid);
  if (seat < 0) throw new Error('Bu oyunda değilsin');
  if (g.status !== 'active') throw new Error('Oyun bitti');
  if (action === 'close') { g.status = 'abandoned'; return true; }
  if (action === 'choose') { K.applyChoice(st, seat, body.type, body.trump); return true; }
  if (action === 'play') {
    if (st.phase !== 'play') throw new Error('Önce el seçilmeli');
    if (st.turn !== seat) throw new Error('Sıra sende değil');
    const hand = g.hands[seat];
    const card = String(body.card || '');
    if (!hand.includes(card)) throw new Error('Bu kart elinde yok');
    if (!K.legalCards(st, hand).includes(card)) throw new Error('Bu kartı şimdi oynayamazsın');
    g.hands[seat] = hand.filter((c) => c !== card);
    const r = K.applyPlay(st, seat, card);
    if (r.gameDone) {
      g.status = 'finished';
      const best = Math.max(...st.score); g.winner = g.players[st.score.indexOf(best)];
    } else if (r.handDone) g.hands = K.deal(rnd);
    return r;
  }
  throw new Error('Bilinmeyen işlem');
}

// ------------------------------------------------------------------ botun sırası: bir adım oyna
// Döner: null (botun işi yok) ya da { prev } (önceki durum, animasyon için)
export function botStep(g) {
  if (!g || g.status !== 'active') return null;
  const prev = JSON.parse(JSON.stringify(g.state));
  if (g.kind === 'tavla') {
    const st = g.state, t = st.turn, uid = g.players[t];
    if (!isBot(uid)) return null;
    if (!st.dice?.length) { act(g, uid, 'roll'); return { prev, kind: 'roll' }; }
    const seq = bestTavlaSequence(st, t, st.dice);
    act(g, uid, 'move', { moves: seq });
    return { prev, kind: 'move' };
  }
  const st = g.state;
  if (st.phase === 'choose') {
    const uid = g.players[st.chooser];
    if (!isBot(uid)) return null;
    const c = chooseContract(st, st.chooser, g.hands[st.chooser]);
    act(g, uid, 'choose', c);
    return { prev, kind: 'choose' };
  }
  if (st.phase === 'play') {
    const uid = g.players[st.turn];
    if (!isBot(uid)) return null;
    const card = chooseCard(g, st.turn);
    const r = act(g, uid, 'play', { card });
    return { prev, kind: 'play', r };
  }
  return null;
}

// ================================================================== TAVLA YAPAY ZEKÂSI
// Konumları oyuncunun gözünden "kalan mesafe"ye çevir: 0 = toplamaya en yakın hane, 23 = en uzak
const rel = (i, p) => (p === 0 ? i : 23 - i);
const mine = (s, i, p) => (p === 0 ? Math.max(0, s.board[i]) : Math.max(0, -s.board[i]));
const pip = (s, p) => { let n = s.bar[p] * 25; for (let i = 0; i < 24; i++) n += mine(s, i, p) * (rel(i, p) + 1); return n; };
const ALL_ROLLS = []; for (let a = 1; a <= 6; a++) for (let b = 1; b <= 6; b++) ALL_ROLLS.push([a, b]);

// Rakip (q) bir sonraki zarında p'nin açık taşlarından birini vurabilir mi? Beklenen kayıp (pip) döner.
function hitRisk(s, p) {
  const q = 1 - p;
  const blots = [];
  for (let i = 0; i < 24; i++) if (mine(s, i, p) === 1) blots.push(i);
  if (!blots.length) return 0;
  // q'nun taşlarının bulunduğu yerler (bar dahil). q=1 yukarı (i artar), q=0 aşağı ilerler.
  const src = [];
  if (s.bar[q]) src.push(q === 1 ? -1 : 24);
  for (let i = 0; i < 24; i++) if (mine(s, i, q) > 0) src.push(i);
  const blocked = (i) => mine(s, i, p) >= 2;
  const dirOK = (from, to) => (q === 1 ? to > from : to < from);
  let total = 0;
  for (const [a, b] of ALL_ROLLS) {
    const steps = a === b ? [a, a, a, a] : null;
    let worst = 0;
    for (const bl of blots) {
      for (const f of src) {
        if (!dirOK(f, bl)) continue;
        const d = Math.abs(bl - f);
        let ok = false;
        const step = q === 1 ? 1 : -1;
        if (steps) {
          for (let k = 1; k <= 4 && !ok; k++) {
            if (a * k !== d) continue;
            let clear = true;
            for (let j = 1; j < k; j++) if (blocked(f + step * a * j)) { clear = false; break; }
            ok = clear;
          }
        } else if (d === a || d === b) ok = true;
        else if (d === a + b) ok = !blocked(f + step * a) || !blocked(f + step * b);
        if (ok) { worst = Math.max(worst, 6 + (24 - rel(bl, p))); break; }
      }
    }
    total += worst;
  }
  return total / 36;
}

function contact(s, p) {
  // p'nin en geri taşı, rakibin en ilerideki taşını (p'nin gözünden) henüz geçmediyse temas var
  const q = 1 - p;
  if (s.bar[p] || s.bar[q]) return true;
  let pBack = -1, qMin = 99;
  for (let i = 0; i < 24; i++) {
    if (mine(s, i, p)) pBack = Math.max(pBack, rel(i, p));
    if (mine(s, i, q)) qMin = Math.min(qMin, rel(i, p));
  }
  return pBack > qMin;
}

function evalTavla(s, p) {
  const q = 1 - p;
  const pipDiff = pip(s, q) - pip(s, p);
  if (!contact(s, p)) {
    // Yarış: önde olmak ve toplamak; evde boşluk bırakmamak
    let gaps = 0; for (let r = 0; r < 6; r++) { const i = p === 0 ? r : 23 - r; if (!mine(s, i, p)) gaps++; }
    return pipDiff * 2 + (s.off[p] - s.off[q]) * 4 - gaps * 0.5;
  }
  let v = pipDiff;
  // Kapılar, evdeki kapılar ve art arda kapılar (blokaj)
  let chain = 0, best = 0, homePts = 0;
  for (let r = 0; r < 24; r++) {
    const i = p === 0 ? r : 23 - r;
    const n = mine(s, i, p);
    if (n >= 2) {
      v += 2;
      if (r < 6) { v += 3; homePts++; if (r >= 3) v += 1; }
      if (r >= 18) v += (r >= 18 && r <= 22 ? 2.5 : 1); // rakibin evinde çapa
      chain++; best = Math.max(best, chain);
      if (n > 3) v -= (n - 3) * 0.8;
    } else chain = 0;
  }
  v += best >= 2 ? best * best * 1.2 : 0;
  // Kırık taşlar
  v += s.bar[q] * (8 + homePts * 3);
  v -= s.bar[p] * 10;
  // Vurulma riski
  v -= hitRisk(s, p) * 1.1;
  v += (s.off[p] - s.off[q]) * 2;
  return v;
}

export function bestTavlaSequence(s, p, dice) {
  const legal = T.legalSequences(s, p, dice);
  const seqs = legal.sequences.filter((q) => q.length === legal.maxLen);
  if (!seqs.length) return [];
  let best = null, bestV = -Infinity;
  const seen = new Set();
  for (const seq of seqs) {
    const n = T.applySequence(s, p, seq);
    const key = n.board.join(',') + '|' + n.bar.join(',') + '|' + n.off.join(',');
    if (seen.has(key)) continue; seen.add(key);
    const v = evalTavla(n, p) + Math.random() * 0.01;
    if (v > bestV) { bestV = v; best = seq; }
  }
  return best;
}

function botAcceptsResign(st, botIdx, pts) {
  if (pts === 2) return true;
  // Bot mars yapabileceğini düşünüyorsa 1 puanı reddeder: rakip hiç toplamamış ve yarışta çok gerideyse
  const human = 1 - botIdx;
  const lead = pip(st, human) - pip(st, botIdx);
  return !(st.off[human] === 0 && (lead > 45 || st.bar[human] >= 2) && st.off[botIdx] > 0);
}

// ================================================================== KING YAPAY ZEKÂSI
const S4 = K.SUITS;
const R = K.rankOf, SU = K.suitOf;
function playedCards(g) {
  // Bu elde oynanmış kartlar: elden çıkanlar = desteden ellerde ve masada olmayanlar
  const st = g.state;
  const inHands = new Set(g.hands.flat());
  const onTable = new Set(st.trick.map((t) => t.card));
  return new Set(K.fullDeck().filter((c) => !inHands.has(c) && !onTable.has(c)));
}
// Bu renkte, benim elim dışında, henüz oynanmamış en yüksek kart
function higherOutside(g, seat, card) {
  const gone = playedCards(g);
  const mineSet = new Set(g.hands[seat]);
  const onTable = new Set(g.state.trick.map((t) => t.card));
  for (let r = R(card) + 1; r <= 14; r++) {
    const c = SU(card) + r;
    if (!gone.has(c) && !mineSet.has(c) && !onTable.has(c)) return true;
  }
  return false;
}

function chooseCard(g, seat) {
  const st = g.state, hand = g.hands[seat];
  const legal = K.legalCards(st, hand);
  if (legal.length === 1) return legal[0];
  const c = st.contract, koz = c.type === 'koz', trump = koz ? c.trump : null;
  const trick = st.trick;
  const pen = (x) => K.isPenaltyCard(c.type, x);
  const byRank = (a, b) => R(a) - R(b);
  const lastToPlay = trick.length === 3;

  if (!trick.length) {
    if (koz) {
      // Kozum çoksa kozları çek; sonra sağlam (en yüksek) kartları al; yoksa en kısa rengin küçüğünü aç
      const trumps = legal.filter((x) => SU(x) === trump).sort(byRank);
      const masters = legal.filter((x) => !higherOutside(g, seat, x)).sort((a, b) => R(b) - R(a));
      if (trumps.length >= 4 && masters.some((x) => SU(x) === trump)) return masters.find((x) => SU(x) === trump);
      const sideMaster = masters.find((x) => SU(x) !== trump);
      if (sideMaster) return sideMaster;
      const counts = Object.fromEntries(S4.map((s) => [s, hand.filter((x) => SU(x) === s).length]));
      return legal.filter((x) => SU(x) !== trump || legal.every((y) => SU(y) === trump))
        .sort((a, b) => counts[SU(a)] - counts[SU(b)] || R(a) - R(b))[0] || legal.sort(byRank)[0];
    }
    // Ceza: cezalı olmayan, alçak ve kimsenin altına giremeyeceği kart aç; tehlikeli renkten kaçın
    const safe = legal.filter((x) => !pen(x));
    const pool = safe.length ? safe : legal;
    const score = (x) => {
      const gone = playedCards(g);
      let lower = 0; // dışarıda bundan küçük kaç kart var (başkası altıma girebilir mi?)
      for (let r = 2; r < R(x); r++) { const cc = SU(x) + r; if (!gone.has(cc) && !hand.includes(cc)) lower++; }
      let v = R(x) * 2 - lower * 1.5;
      if (c.type === 'rifki' && SU(x) === 'H') v += 6;
      if (c.type === 'kiz' && R(x) >= 12) v += 8;
      if (c.type === 'erkek' && (R(x) >= 11)) v += 6;
      return v;
    };
    return pool.slice().sort((a, b) => score(a) - score(b))[0];
  }

  const led = SU(trick[0].card);
  const curWinSeat = K.trickWinner(trick, trump);
  const curWin = trick.find((t) => t.seat === curWinSeat) || trick[0];
  const wins = (x) => K.trickWinner([...trick, { seat, card: x }], trump) === seat;
  const winners = legal.filter(wins).sort(byRank);
  const losers = legal.filter((x) => !wins(x)).sort(byRank);

  if (koz) {
    if (winners.length) {
      if (lastToPlay) return winners[0];
      const master = winners.filter((x) => !higherOutside(g, seat, x) || (SU(x) === trump && SU(curWin.card) !== trump && SU(x) !== led));
      return master.length ? master[0] : winners[winners.length - 1];
    }
    // Kaybedeceksem en değersizini at (koz harcama)
    return losers.slice().sort((a, b) => (SU(a) === trump) - (SU(b) === trump) || R(a) - R(b))[0];
  }

  // Ceza oyunları
  if (SU(legal[0]) === led && legal.every((x) => SU(x) === led)) {
    // Renk takip ediyorum: altına girebiliyorsam en büyük kaybedeni at
    if (losers.length) return losers[losers.length - 1];
    // Mecburen alıyorum: son ben oynuyorsam en büyüğü at (kurtul); değilsem en küçüğünü (başkası geçsin)
    const nonPen = winners.filter((x) => !pen(x));
    const pool = nonPen.length ? nonPen : winners;
    return lastToPlay ? pool[pool.length - 1] : pool[0];
  }
  // Renk yok: cezalıyı at (kuralı zaten zorlar), yoksa en tehlikeli yüksek kartı at
  const pens = legal.filter(pen).sort((a, b) => R(b) - R(a));
  if (pens.length && !wins(pens[0])) return pens[0];
  const danger = (x) => R(x) * 2 + (c.type === 'rifki' && SU(x) === 'H' ? 8 : 0) + (c.type === 'kupa' && SU(x) === 'H' ? 6 : 0)
    + (hand.filter((y) => SU(y) === SU(x)).length <= 2 ? 3 : 0);
  const notWin = legal.filter((x) => !wins(x));
  return (notWin.length ? notWin : legal).slice().sort((a, b) => danger(b) - danger(a))[0];
}

function chooseContract(st, seat, hand) {
  const opts = K.choicesFor(st, seat);
  const cnt = (s) => hand.filter((x) => SU(x) === s).length;
  const high = (s, min) => hand.filter((x) => SU(x) === s && R(x) >= min).length;
  const lowCount = (s) => hand.filter((x) => SU(x) === s && R(x) <= 7).length;
  // Her cezada tahmini kayıp (puan, eksi değil): ne kadar küçükse o kadar iyi
  const est = {
    el: hand.filter((x) => R(x) >= 11).length * 35 - hand.filter((x) => R(x) <= 6).length * 8 + 120,
    kupa: hand.filter((x) => SU(x) === 'H' && R(x) >= 9).length * 45 - lowCount('H') * 10 + 60,
    erkek: hand.filter((x) => R(x) === 11 || R(x) === 13).length * 50 - S4.reduce((n, s) => n + Math.min(lowCount(s), 3), 0) * 6 + 90,
    kiz: hand.filter((x) => R(x) === 12).reduce((n, x) => n + (lowCount(SU(x)) >= 3 ? 25 : 90), 0) + (hand.filter((x) => R(x) === 14 || R(x) === 13).length * 12),
    rifki: hand.includes('H13') ? (lowCount('H') >= 3 ? 90 : 260) : (hand.includes('H14') && cnt('H') <= 2 ? 120 : 50),
    soniki: hand.filter((x) => R(x) >= 12).length * 30 + 70,
  };
  let best = null, bestV = -Infinity;
  for (const t of opts) {
    if (t === 'koz') {
      for (const s of S4) {
        const tricks = high(s, 12) * 0.9 + Math.max(0, cnt(s) - 3) * 0.8 + S4.filter((x) => x !== s).reduce((n, x) => n + high(x, 14) * 0.9 + (high(x, 13) && cnt(x) >= 2 ? 0.5 : 0), 0);
        const v = tricks * 50 - 160; // ortalama 3,25 el beklenir
        if (v > bestV) { bestV = v; best = { type: 'koz', trump: s }; }
      }
    } else {
      const v = -est[t];
      if (v > bestV) { bestV = v; best = { type: t }; }
    }
  }
  return best || { type: opts[0], trump: 'S' };
}
