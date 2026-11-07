// Tavla kuralları — hem uygulama (tarayıcı) hem sunucu (Edge Function) aynı dosyayı kullanır.
// Taş dizisi: board[0..23]. Beyaz (oyuncu 0) pozitif sayı, siyah (oyuncu 1) negatif sayı.
// Beyaz 23 → 0 yönünde ilerler (evi 0..5), siyah 0 → 23 yönünde ilerler (evi 18..23).

export const CHECKERS = 15;

export function newBoard() {
  const b = new Array(24).fill(0);
  b[23] = 2; b[12] = 5; b[7] = 3; b[5] = 5;        // beyaz
  b[0] = -2; b[11] = -5; b[16] = -3; b[18] = -5;   // siyah
  return { board: b, bar: [0, 0], off: [0, 0] };
}

const sign = (p) => (p === 0 ? 1 : -1);
const own = (pos, p, s) => s.board[pos] * sign(p) > 0;
const count = (pos, p, s) => Math.max(0, s.board[pos] * sign(p));
const oppCount = (pos, p, s) => Math.max(0, -s.board[pos] * sign(p));
const isHome = (pos, p) => (p === 0 ? pos >= 0 && pos <= 5 : pos >= 18 && pos <= 23);

export function cloneBoard(s) {
  return { board: s.board.slice(), bar: s.bar.slice(), off: s.off.slice() };
}

export function allHome(s, p) {
  if (s.bar[p] > 0) return false;
  for (let i = 0; i < 24; i++) if (own(i, p, s) && !isHome(i, p)) return false;
  return true;
}

// Tek zarla yapılabilecek hamleler: {from, to, die} — from: 'bar' ya da 0..23, to: 0..23 ya da 'off'
export function singleMoves(s, p, die) {
  const out = [];
  if (s.bar[p] > 0) {
    const to = p === 0 ? 24 - die : die - 1;
    if (oppCount(to, p, s) < 2) out.push({ from: 'bar', to, die });
    return out;
  }
  const home = allHome(s, p);
  for (let from = 0; from < 24; from++) {
    if (!own(from, p, s)) continue;
    const to = p === 0 ? from - die : from + die;
    if (to >= 0 && to <= 23) {
      if (oppCount(to, p, s) < 2) out.push({ from, to, die });
    } else if (home) {
      const exact = p === 0 ? to === -1 : to === 24;
      if (exact) out.push({ from, to: 'off', die });
      else {
        // Fazla gelen zarla toplama: daha geride taş yoksa
        let farther = false;
        if (p === 0) { for (let i = from + 1; i <= 5; i++) if (own(i, p, s)) { farther = true; break; } }
        else { for (let i = 18; i < from; i++) if (own(i, p, s)) { farther = true; break; } }
        if (!farther) out.push({ from, to: 'off', die });
      }
    }
  }
  return out;
}

export function applyMove(s, p, m) {
  const n = cloneBoard(s);
  const sg = sign(p);
  if (m.from === 'bar') n.bar[p]--; else n.board[m.from] -= sg;
  if (m.to === 'off') n.off[p]++;
  else {
    if (oppCount(m.to, p, n) === 1) { n.board[m.to] = 0; n.bar[1 - p]++; }
    n.board[m.to] += sg;
  }
  return n;
}

const moveKey = (m) => `${m.from}>${m.to}:${m.die}`;
const seqKey = (seq) => seq.map(moveKey).join(',');

// Zarların tamamı (ya da mümkün olan en fazlası) kullanılarak yapılabilecek bütün hamle dizileri
export function legalSequences(s, p, dice) {
  const all = [];
  let maxLen = 0;
  const seen = new Set();
  (function walk(state, remaining, seq) {
    let moved = false;
    const tried = new Set();
    for (let i = 0; i < remaining.length; i++) {
      const d = remaining[i];
      if (tried.has(d)) continue;
      tried.add(d);
      const rest = remaining.slice(0, i).concat(remaining.slice(i + 1));
      for (const m of singleMoves(state, p, d)) {
        moved = true;
        walk(applyMove(state, p, m), rest, seq.concat([m]));
      }
    }
    if (!moved) {
      const k = seqKey(seq);
      if (!seen.has(k)) { seen.add(k); all.push(seq); if (seq.length > maxLen) maxLen = seq.length; }
    }
  })(s, dice.slice(), []);
  let res = all.filter((q) => q.length === maxLen);
  // Sadece bir zar oynanabiliyorsa ve zarlar farklıysa büyük zar oynanmalı
  if (maxLen === 1 && dice.length === 2 && dice[0] !== dice[1]) {
    const big = Math.max(dice[0], dice[1]);
    if (res.some((q) => q[0].die === big)) res = res.filter((q) => q[0].die === big);
  }
  return { sequences: res, maxLen };
}

// İstemci için: şu ana kadar yapılan adımlarla uyumlu sonraki adımlar
export function nextSteps(legal, done) {
  const prefix = seqKey(done);
  const out = new Map();
  for (const q of legal.sequences) {
    if (q.length <= done.length) continue;
    if (seqKey(q.slice(0, done.length)) !== prefix) continue;
    const m = q[done.length];
    out.set(moveKey(m), m);
  }
  return [...out.values()];
}

export function isLegalSequence(legal, seq) {
  const k = seqKey(seq);
  return legal.sequences.some((q) => seqKey(q) === k);
}

export function applySequence(s, p, seq) {
  return seq.reduce((st, m) => applyMove(st, p, m), s);
}

// El bitti mi? Kazanılan puan: 1, rakip hiç taş toplamamışsa mars = 2
export function handResult(s, p) {
  if (s.off[p] < CHECKERS) return null;
  return { winner: p, points: s.off[1 - p] === 0 ? 2 : 1 };
}

export function rollToDice(a, b) {
  return a === b ? [a, a, a, a] : [a, b];
}

export function pipCount(s, p) {
  let n = s.bar[p] * 25;
  for (let i = 0; i < 24; i++) {
    const c = count(i, p, s);
    if (c) n += c * (p === 0 ? i + 1 : 24 - i);
  }
  return n;
}
