// King kuralları: hem uygulama (hangi kart oynanabilir) hem sunucu (doğrulama, puan) bunu kullanır.
// Kart: renk harfi + değer, örn. "S14" = maça as. Renkler: S maça, H kupa, D karo, C sinek. 11 J, 12 Q, 13 K, 14 A.

export const SUITS = ['S', 'H', 'D', 'C'];
export const SUIT_SYM = { S: '♠', H: '♥', D: '♦', C: '♣' };
export const SUIT_NAME = { S: 'Maça', H: 'Kupa', D: 'Karo', C: 'Sinek' };
export const RANK_TXT = { 11: 'J', 12: 'Q', 13: 'K', 14: 'A' };
export const HANDS = 20;

// Her oyuncu oyun boyunca 5 kez seçer: 2 koz + 3 ceza. Her ceza türü oyunda en fazla 2 kez oynanır.
export const CONTRACTS = {
  el:     { name: 'El almaz',    short: 'Her el −50',          per: -50,  koz: false },
  kupa:   { name: 'Kupa almaz',  short: 'Her kupa −30',        per: -30,  koz: false },
  erkek:  { name: 'Erkek almaz', short: 'Her papaz ve vale −60', per: -60, koz: false },
  kiz:    { name: 'Kız almaz',   short: 'Her kız −100',        per: -100, koz: false },
  rifki:  { name: 'Rıfkı',       short: 'Kupa papazı −320',     per: -320, koz: false },
  soniki: { name: 'Son iki',     short: 'Son iki el, her biri −180', per: -180, koz: false },
  koz:    { name: 'Koz',         short: 'Her el +50',          per: 50,   koz: true },
};
export const CEZA = ['el', 'kupa', 'erkek', 'kiz', 'rifki', 'soniki'];
export const KOZ_PER_PLAYER = 2;
export const CEZA_PER_PLAYER = 3;
export const CEZA_TIMES = 2;
export const KOZ_FROM_HAND = 5; // ilk 4 elde koz seçilemez

export const suitOf = (c) => c[0];
export const rankOf = (c) => +c.slice(1);
export const label = (c) => (RANK_TXT[rankOf(c)] || String(rankOf(c))) + SUIT_SYM[suitOf(c)];

export function fullDeck() {
  const d = [];
  for (const s of SUITS) for (let r = 2; r <= 14; r++) d.push(s + r);
  return d;
}
// Eldeki renkleri kırmızı-siyah sırayla diz (aynı renkler mümkün olduğunca yan yana gelmesin), küçükten büyüğe
export function sortHand(h) {
  const has = (s) => h.some((c) => suitOf(c) === s);
  const reds = ['D', 'H'].filter(has), blacks = ['C', 'S'].filter(has);
  const [a, b] = reds.length >= blacks.length ? [reds, blacks] : [blacks, reds];
  const seq = [];
  for (let i = 0; i < a.length; i++) { seq.push(a[i]); if (b[i]) seq.push(b[i]); }
  const order = Object.fromEntries(seq.map((s, i) => [s, i]));
  return [...h].sort((x, y) => order[suitOf(x)] - order[suitOf(y)] || rankOf(x) - rankOf(y));
}
// rnd(n): 0..n-1 arası eşit olasılıklı tamsayı
export function deal(rnd) {
  const d = fullDeck();
  for (let i = d.length - 1; i > 0; i--) { const j = rnd(i + 1); [d[i], d[j]] = [d[j], d[i]]; }
  return [0, 1, 2, 3].map((k) => sortHand(d.slice(k * 13, k * 13 + 13)));
}

// Cezalı kart mı (zorunlu atma ve puan için)
export function isPenaltyCard(type, c) {
  const s = suitOf(c), r = rankOf(c);
  if (type === 'kupa') return s === 'H';
  if (type === 'kiz') return r === 12;
  if (type === 'erkek') return r === 13 || r === 11;
  if (type === 'rifki') return c === 'H13';
  return false;
}
const PENALTY_TOTAL = { kupa: 13, kiz: 4, erkek: 8, rifki: 1 };

// Eldeki kazanan: koz varsa en büyük koz, yoksa açılan rengin en büyüğü
export function trickWinner(trick, trump) {
  const led = suitOf(trick[0].card);
  let best = trick[0];
  for (const t of trick.slice(1)) {
    const s = suitOf(t.card), bs = suitOf(best.card);
    if (trump && s === trump && bs !== trump) best = t;
    else if (s === bs && rankOf(t.card) > rankOf(best.card) && (s === led || s === trump)) best = t;
  }
  return best.seat;
}

// Oynanabilir kartlar
export function legalCards(st, hand) {
  if (!hand?.length) return [];
  const c = st.contract || {};
  const type = c.type, trump = c.trump || null;
  const trick = st.trick || [];
  if (!trick.length) {
    // Açış: kupa almaz ve rıfkıda kupa, kozda koz "kırılmadan" açılamaz (elde sadece o varsa açılır)
    const banned = (type === 'kupa' || type === 'rifki') ? 'H' : (type === 'koz' ? trump : null);
    if (banned && !st.broken) {
      const other = hand.filter((x) => suitOf(x) !== banned);
      if (other.length) return other;
    }
    return hand;
  }
  const led = suitOf(trick[0].card);
  const same = hand.filter((x) => suitOf(x) === led);
  if (same.length) {
    if (type === 'koz') {
      // Kozda yükseltme zorunlu: masada koz yoksa ve geçebiliyorsan büyük atmalısın
      const trumped = led !== trump && trick.some((t) => suitOf(t.card) === trump);
      if (!trumped) {
        const top = Math.max(...trick.filter((t) => suitOf(t.card) === led).map((t) => rankOf(t.card)));
        const higher = same.filter((x) => rankOf(x) > top);
        if (higher.length) return higher;
      }
    }
    if (type === 'rifki' && led === 'H' && same.includes('H13') && trick.some((t) => t.card === 'H14')) return ['H13'];
    return same;
  }
  // Açılan renk yok
  if (type === 'koz') {
    const trumps = hand.filter((x) => suitOf(x) === trump);
    if (trumps.length) {
      const played = trick.filter((t) => suitOf(t.card) === trump).map((t) => rankOf(t.card));
      if (played.length) {
        const higher = trumps.filter((x) => rankOf(x) > Math.max(...played));
        if (higher.length) return higher;
      }
      return trumps;
    }
    return hand;
  }
  // Cezalarda zorunlu atma: cezalı kartın varsa onu atmalısın
  const pen = hand.filter((x) => isPenaltyCard(type, x));
  if (pen.length) return pen;
  return hand;
}

// Bir elin (4 kart) puanı, kazanan oyuncuya yazılır
export function trickPoints(type, cards, trickNo) {
  if (type === 'koz') return 50;
  if (type === 'el') return -50;
  if (type === 'soniki') return trickNo >= 12 ? -180 : 0; // 12. ve 13. el (1'den sayınca)
  const per = CONTRACTS[type].per;
  return cards.filter((c) => isPenaltyCard(type, c)).length * per;
}

// El erken biter mi: bütün cezalı kartlar alındıysa
export function handOver(st) {
  if (st.tricksDone >= 13) return true;
  const total = PENALTY_TOTAL[st.contract?.type];
  return total != null && (st.penTaken || 0) >= total;
}

// Kim ne seçebilir
export function choicesFor(st, seat) {
  const p = st.picks?.[seat] || { koz: 0, ceza: 0 };
  const used = st.used || {};
  const out = [];
  if (p.ceza < CEZA_PER_PLAYER) for (const k of CEZA) if ((used[k] || 0) < CEZA_TIMES) out.push(k);
  if (p.koz < KOZ_PER_PLAYER && st.hand >= KOZ_FROM_HAND) out.push('koz');
  // Kalan seçimler sığmalı: koz hakkı kalan seçim sayısını aşmasın
  return out;
}

export function newState(rndChooser = 0) {
  return {
    kind: 'king', hand: 1, chooser: rndChooser, phase: 'choose', contract: null,
    turn: rndChooser, leader: rndChooser, trick: [], tricksDone: 0, penTaken: 0, broken: false,
    handPts: [0, 0, 0, 0], tricksBy: [0, 0, 0, 0], score: [0, 0, 0, 0], counts: [13, 13, 13, 13],
    picks: [0, 1, 2, 3].map(() => ({ koz: 0, ceza: 0 })), used: {}, history: [], lastTrick: null,
  };
}

// Kart oynandıktan sonra durumu ilerlet. Döner: { trickDone, winner, handDone, gameDone }
export function applyPlay(st, seat, card) {
  st.trick.push({ seat, card });
  st.counts[seat] -= 1;
  const c = st.contract;
  if ((c.type === 'kupa' || c.type === 'rifki') && suitOf(card) === 'H') st.broken = true;
  if (c.type === 'koz' && suitOf(card) === c.trump) st.broken = true;
  if (st.trick.length < 4) { st.turn = (seat + 1) % 4; return { trickDone: false }; }
  const cards = st.trick.map((t) => t.card);
  const winner = trickWinner(st.trick, c.type === 'koz' ? c.trump : null);
  st.tricksDone += 1;
  st.penTaken = (st.penTaken || 0) + cards.filter((x) => isPenaltyCard(c.type, x)).length;
  st.handPts[winner] += trickPoints(c.type, cards, st.tricksDone);
  st.tricksBy = st.tricksBy || [0, 0, 0, 0];
  st.tricksBy[winner] += 1; // bu elde kim kaç el aldı
  st.lastTrick = { cards: st.trick, winner };
  st.trick = [];
  st.leader = winner; st.turn = winner;
  if (!handOver(st)) return { trickDone: true, winner };
  // El bitti
  for (let i = 0; i < 4; i++) st.score[i] += st.handPts[i];
  st.history.push({ hand: st.hand, chooser: st.chooser, type: c.type, trump: c.trump || null, pts: [...st.handPts] });
  if (st.hand >= HANDS) { st.phase = 'done'; return { trickDone: true, winner, handDone: true, gameDone: true }; }
  st.hand += 1;
  st.chooser = (st.chooser + 1) % 4;
  st.phase = 'choose'; st.contract = null; st.turn = st.chooser; st.leader = st.chooser;
  st.tricksDone = 0; st.penTaken = 0; st.broken = false; st.handPts = [0, 0, 0, 0]; st.counts = [13, 13, 13, 13]; st.tricksBy = [0, 0, 0, 0];
  return { trickDone: true, winner, handDone: true };
}

export function applyChoice(st, seat, type, trump) {
  if (st.phase !== 'choose' || st.chooser !== seat) throw new Error('Seçim sırası sende değil');
  if (!choicesFor(st, seat).includes(type)) throw new Error('Bu seçimi yapamazsın');
  if (type === 'koz' && !SUITS.includes(trump)) throw new Error('Koz rengini seç');
  const p = st.picks[seat];
  if (type === 'koz') p.koz += 1; else { p.ceza += 1; st.used[type] = (st.used[type] || 0) + 1; }
  st.contract = { type, trump: type === 'koz' ? trump : null };
  st.phase = 'play'; st.turn = seat; st.leader = seat;
}
