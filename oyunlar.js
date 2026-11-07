// Oyunlar sekmesi ve tavla masası
import {
  sb, S, esc, svg, avatar, toast, errText, rpc, openSheet, closeSheet, sheetHead,
  me, nameOf, activeMembers, header, bindHeader, goMain, updateTabDots, route,
} from './app.js';
import * as T from './supabase/functions/_shared/tavla.js';
import * as Sohbet from './sohbet.js';

const G = { games: [], game: null, channel: null, done: [], sel: null, busy: false };

export async function loadMyTurns() {
  if (S.ctx.status !== 'active') return;
  const { data } = await sb.from('games').select('id, players, state, match_to').eq('group_id', S.ctx.group_id).eq('status', 'active').eq('turn', me())
    .order('updated_at', { ascending: false });
  S.myTurnGames = data?.length || 0;
  S.myTurnList = data || [];
}

// ------------------------------------------------------------------ sekme
export function tabView() {
  return `${header('Oyunlar', 'Tayfanla karşılıklı oyna')}<div id="games-body"><p class="sub">Yükleniyor…</p></div>`;
}

export async function mount() {
  bindHeader();
  try {
    const { data, error } = await sb.from('games').select('*').eq('group_id', S.ctx.group_id)
      .order('updated_at', { ascending: false }).limit(60);
    if (error) throw error;
    G.games = data || [];
  } catch (e) { toast(errText(e)); }
  S.myTurnList = G.games.filter((g) => g.status === 'active' && g.turn === me());
  S.myTurnGames = S.myTurnList.length;
  updateTabDots();
  drawTab();
}

function drawTab() {
  const box = document.getElementById('games-body'); if (!box) return;
  const mineActive = G.games.filter((g) => g.status === 'active' && g.players.includes(me()));
  const othersActive = G.games.filter((g) => g.status === 'active' && !g.players.includes(me()));
  const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);
  const wins = {};
  G.games.filter((g) => g.status === 'finished' && g.winner && new Date(g.finished_at) >= monthStart)
    .forEach((g) => { wins[g.winner] = (wins[g.winner] || 0) + 1; });
  const board = Object.entries(wins).sort((a, b) => b[1] - a[1]);
  const row = (g) => {
    const opp = g.players.find((p) => p !== me()) || g.players[1];
    const st = g.state;
    const pi = g.players.indexOf(me());
    const sc = pi >= 0 ? `${st.score[pi]} – ${st.score[1 - pi]}` : `${st.score[0]} – ${st.score[1]}`;
    const myTurn = g.turn === me();
    const label = g.players.includes(me()) ? `Tavla · ${esc(nameOf(opp))} ile` : `Tavla · ${esc(nameOf(g.players[0]))} – ${esc(nameOf(g.players[1]))}`;
    return `<button class="game-row" data-game="${g.id}"><span class="game-ic tavla">${svg('tavla')}</span>
      <div class="grow"><div class="name">${label}</div><div class="small">Skor ${sc} · ${g.match_to} sayılık maç</div></div>
      ${g.players.includes(me()) ? `<span class="pill" style="${myTurn ? 'background:var(--accent);color:#fff' : ''}">${myTurn ? 'Sıra sende' : 'Sıra onda'}</span>` : `<span class="pill">İzle</span>`}</button>`;
  };
  box.innerHTML = `
    ${mineActive.length ? `<section class="card"><h2>Maçların</h2>${mineActive.map(row).join('')}</section>` : ''}
    <section class="card"><h2>Yeni oyun</h2>
      <div class="list-row"><span class="game-ic tavla">${svg('tavla')}</span><div class="grow"><div class="name">Tavla</div><div class="small">2 kişi · sırayla · zarlar sunucuda atılır</div></div>
        <button class="btn small primary" id="new-tavla">Masa aç</button></div>
      ${[['Batak', 'batak', 'spade'], ['King', 'king', 'crown'], ['Okey', 'okey', 'tile']].map(([n, c, i]) => `<div class="list-row"><span class="game-ic ${c}">${svg(i)}</span><div class="grow"><div class="name">${n}</div><div class="small">4 kişi</div></div><span class="pill" style="background:var(--line);color:var(--sub)">Yakında</span></div>`).join('')}
    </section>
    ${othersActive.length ? `<section class="card"><h2>Gruptaki diğer maçlar</h2>${othersActive.map(row).join('')}</section>` : ''}
    <section class="card"><h2>Bu ayın tavla tablosu</h2>
      ${board.length ? board.map(([u, n], i) => `<div class="list-row"><b style="width:22px">${i + 1}.</b>${avatar(nameOf(u), u)}<div class="grow name">${esc(nameOf(u))}</div><span class="small">${n} galibiyet</span></div>`).join('')
        : '<p class="small">Bu ay henüz biten maç yok.</p>'}
    </section>`;
  box.querySelectorAll('[data-game]').forEach((b) => b.onclick = () => openGame(b.dataset.game));
  document.getElementById('new-tavla').onclick = pickOpponent;
}

function pickOpponent() {
  const list = activeMembers().filter((m) => m.user_id !== me());
  openSheet(`${sheetHead('Kimle oynayacaksın?')}
    ${list.length ? list.map((m) => `<button class="game-row" data-opp="${m.user_id}">${avatar(m.display_name, m.user_id, 'lg')}<div class="grow name">${esc(m.display_name)}</div>${svg('chev')}</button>`).join('')
      : '<p class="sub">Grupta henüz başka üye yok.</p>'}
    <div class="field"><label for="match-to">Kaç sayılık maç?</label>
      <select class="input" id="match-to"><option value="1">1 el</option><option value="3">3 sayı</option><option value="5" selected>5 sayı</option><option value="7">7 sayı</option></select></div>`, () => {
    document.querySelectorAll('[data-opp]').forEach((b) => b.onclick = async () => {
      try {
        const id = await rpc('create_game', { p_opponent: b.dataset.opp, p_kind: 'tavla', p_match_to: +document.getElementById('match-to').value });
        closeSheet(); openGame(id);
      } catch (e) { toast(errText(e)); }
    });
  });
}

function openGame(id) {
  history.replaceState(null, '', '#oyun/' + id);
  route('#oyun/' + id);
}

// ------------------------------------------------------------------ tavla masası
export async function renderGame() {
  const $app = document.getElementById('app');
  $app.innerHTML = `<div class="screen enter"><main class="content no-tabs game-screen">
    <div class="g-top">
      <button class="icon-btn" id="g-back" aria-label="Oyunlara dön">${svg('back')}</button>
      <div class="grow" id="g-title"><h1>Tavla</h1></div>
      <button class="icon-btn chat-n-btn" id="g-gen" aria-label="Genel sohbet">${svg('chat')}</button>
      <button class="icon-btn" id="g-menu" aria-label="Oyun seçenekleri">${svg('dots')}</button>
    </div>
    <div id="g-body" style="display:flex;flex-direction:column;gap:12px"><p class="sub">Masa hazırlanıyor…</p></div></main></div>`;
  document.getElementById('g-back').onclick = () => goMain('game');
  document.getElementById('g-gen').onclick = () => route('#sohbet');
  document.getElementById('g-menu').onclick = gameMenu;
  drawChatCount();
  startPresence(S.gameId);
  await reloadGame();
  if (G.game) Sohbet.gameChatLoad(G.game, () => drawChatBar()).then(drawChatBar).catch((e) => console.warn(e));
  if (G.channel) sb.removeChannel(G.channel);
  G.channel = sb.channel('oyun-' + S.gameId)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `game_id=eq.${S.gameId}` }, ({ new: m }) => Sohbet.gameChatIncoming(m))
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'games', filter: `id=eq.${S.gameId}` }, ({ new: g }) => {
      const turnChanged = G.game?.turn !== g.turn || JSON.stringify(G.game?.state?.dice) !== JSON.stringify(g.state?.dice);
      G.game = g;
      if (turnChanged) { G.done = []; G.sel = null; }
      drawGame();
    }).subscribe();
}
export function closeGame() {
  if (G.channel) { sb.removeChannel(G.channel); G.channel = null; }
  stopPresence();
}
// Oyun ekranındayken genel sohbete gelen mesaj sayısı (bildirim yerine)
export function drawChatCount() {
  const b = document.getElementById('g-gen'); if (!b) return;
  const n = S.unreadCount || 0;
  b.querySelector('.n')?.remove();
  if (n) b.insertAdjacentHTML('beforeend', `<span class="n">${n > 99 ? '99+' : n}</span>`);
  b.setAttribute('aria-label', n ? `Genel sohbet, ${n} yeni mesaj` : 'Genel sohbet');
}

// Oyun ekranı açıkken sunucuya "buradayım" de: bu oyunla ilgili bildirim gelmesin
let presT = null;
function startPresence(id) {
  stopPresence(true);
  const beat = () => { if (document.visibilityState === 'visible' && S.view === 'game' && S.gameId === id) rpc('set_presence', { p_game: id }).catch(() => {}); };
  beat();
  presT = setInterval(() => { if (S.view !== 'game' || S.gameId !== id) return stopPresence(); beat(); }, 20000);
}
function stopPresence(silent) {
  if (presT) { clearInterval(presT); presT = null; }
  if (!silent) rpc('set_presence', { p_game: null }).catch(() => {});
}
document.addEventListener('visibilitychange', () => {
  if (S.view !== 'game') return;
  if (document.visibilityState === 'visible') startPresence(S.gameId);
  else stopPresence();
});

async function reloadGame() {
  const { data, error } = await sb.from('games').select('*').eq('id', S.gameId).maybeSingle();
  if (error || !data) { document.getElementById('g-body').innerHTML = '<p class="sub">Oyun bulunamadı.</p>'; return; }
  G.game = data; G.done = []; G.sel = null;
  drawGame();
}

async function call(action, extra = {}) {
  if (G.busy) return;
  G.busy = true; drawGame();
  try {
    const { data, error } = await sb.functions.invoke('tavla', { body: { action, game_id: G.game.id, ...extra } });
    if (error) {
      let msg = error.message;
      try { const j = await error.context?.json?.(); if (j?.hata) msg = j.hata; } catch (_) { /* */ }
      throw new Error(msg);
    }
    if (data?.hata) throw new Error(data.hata);
    G.busy = false;
    await reloadGame();
    loadMyTurns().then(updateTabDots).catch(() => {});
  } catch (e) { G.busy = false; toast(errText(e)); drawGame(); }
}

function gameMenu() {
  const g = G.game; if (!g) return;
  const playing = g.players.includes(me()) && g.status === 'active';
  openSheet(`${sheetHead('Tavla')}
    <p class="sub" style="line-height:1.5">Zarlar sunucuda atılır, hamleler kurallara göre kontrol edilir. Mars 2 sayı. Eli kaybeden yeni ele başlar.</p>
    ${playing ? `<button class="btn block danger" id="g-resign">Pes et</button>` : ''}
    <button class="btn block" data-close>Kapat</button>`, () => {
    document.getElementById('g-resign')?.addEventListener('click', () => {
      if (!confirm('Pes edersen maçı rakibin kazanır. Emin misin?')) return;
      closeSheet(); call('resign');
    });
  });
}

// beyazın bakışıyla: üst sıra soldan sağa 12..23, alt sıra soldan sağa 11..0
const TOP = [12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23];
const BOTTOM = [11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0];

function drawChatBar() {
  const box = document.getElementById('g-chatbar'); if (!box || !G.game) return;
  const { last, unread } = Sohbet.gameChatSummary();
  box.innerHTML = `<button class="gc-bar" id="g-chat">${svg('chat')}<span class="grow">${last ? esc(last) : 'Rakibinle sohbet et'}</span>${unread ? `<b class="gc-n">${unread}</b>` : ''}</button>`;
  document.getElementById('g-chat').onclick = () => Sohbet.openGameChat(G.game);
}

// Seçili taşın iki zarın toplamıyla (çiftte en uzağa) gidebileceği yerler. Ara nokta açık değilse gösterilmez.
function sumTargets(legal, done, sel) {
  const out = new Map(); // to → hamle dizisi
  const walk = (path, from) => {
    for (const m of T.nextSteps(legal, done.concat(path)).filter((x) => String(x.from) === String(from))) {
      const p2 = path.concat([m]);
      if (p2.length >= 2) {
        const k = String(m.to);
        if (!out.has(k) || out.get(k).length < p2.length) out.set(k, p2);
      }
      if (m.to !== 'off') walk(p2, m.to);
    }
  };
  walk([], sel);
  const res = [...out.entries()].map(([to, seq]) => ({ to, seq }));
  if (!res.length) return [];
  // çift zarda sadece en uzak noktayı göster (kafa karıştırmasın)
  const isDouble = G.game.state.dice.length === 4;
  if (isDouble) { const max = Math.max(...res.map((r) => r.seq.length)); return res.filter((r) => r.seq.length === max); }
  return res;
}

function drawGame() {
  const box = document.getElementById('g-body'); const g = G.game;
  if (!box || !g) return;
  const st = g.state;
  const p = g.players.indexOf(me());            // -1: izleyici
  const view = p === -1 ? 0 : p;               // izleyici beyaz tarafından bakar
  const opp = g.players[view === 0 ? 1 : 0];
  const myTurn = g.status === 'active' && p >= 0 && st.turn === p;
  const rolled = myTurn && st.dice?.length > 0;
  const tt = document.getElementById('g-title');
  if (tt) tt.innerHTML = `<h1>${p >= 0 ? `${esc(nameOf(opp))} ile tavla` : `${esc(nameOf(g.players[0]))} – ${esc(nameOf(g.players[1]))}`}</h1><p class="small">${g.match_to} sayılık maç · ${st.hand || 1}. el</p>`;

  let base = { board: st.board, bar: st.bar, off: st.off };
  let legal = null, next = [];
  if (rolled) {
    legal = T.legalSequences(base, p, st.dice);
    base = T.applySequence(base, p, G.done);
    next = T.nextSteps(legal, G.done);
  }
  const usedDice = G.done.map((m) => m.die);
  const fromSet = new Set(next.map((m) => String(m.from)));
  const targets = G.sel != null ? next.filter((m) => String(m.from) === String(G.sel)) : [];
  const targetSet = new Set(targets.map((m) => String(m.to)));
  const sums = G.sel != null && rolled ? sumTargets(legal, G.done, G.sel).filter((r) => !targetSet.has(r.to)) : [];
  const sumMap = new Map(sums.map((r) => [r.to, r]));
  const dieOf = (k) => { const m = targets.filter((x) => String(x.to) === k).sort((a, b) => a.die - b.die)[0]; return m ? m.die : ''; };
  const sumOf = (k) => sumMap.get(k)?.seq.reduce((n, m) => n + m.die, 0) || '';
  const lastTo = new Set((st.last?.moves || []).map((m) => String(m.to)));
  const complete = rolled && legal && G.done.length === legal.maxLen;

  const vi = (i) => (view === 0 ? i : 23 - i);   // ekrandaki konum → gerçek nokta
  const point = (pos, top) => {
    const i = vi(pos);
    const v = base.board[i];
    const n = Math.abs(v);
    const color = v > 0 ? 0 : 1;
    const isFrom = myTurn && fromSet.has(String(i));
    const isTarget = targetSet.has(String(i));
    const isSum = sumMap.has(String(i));
    const sel = String(G.sel) === String(i);
    let checkers = '';
    for (let k = 0; k < Math.min(n, 5); k++) checkers += `<span class="ck c${color} ${sel && k === Math.min(n, 5) - 1 ? 'sel' : ''}"></span>`;
    if (n > 5) checkers += `<span class="ck-n">${n}</span>`;
    if (isTarget) checkers += `<span class="mk g">${dieOf(String(i))}</span>`;
    else if (isSum) checkers += `<span class="mk r">${sumOf(String(i))}</span>`;
    return `<button class="pt ${top ? 'top' : 'bot'} ${(pos % 2) ? 'odd' : 'even'} ${isFrom ? 'can' : ''} ${isTarget ? 'tgt' : ''} ${isSum ? 'tgt2' : ''} ${lastTo.has(String(i)) && !rolled ? 'last' : ''}" data-pt="${i}" aria-label="Nokta ${i + 1}${isTarget ? ', tek zarla gidilebilir' : isSum ? ', iki zar toplamıyla gidilebilir' : ''}">
      <span class="tri"></span><span class="stack">${checkers}</span></button>`;
  };
  const half = (arr, top) => `<div class="half">${arr.map((x) => point(x, top)).join('')}</div>`;
  const barStack = (who) => {
    const n = base.bar[who]; let h = '';
    for (let k = 0; k < Math.min(n, 4); k++) h += `<span class="ck c${who}"></span>`;
    if (n > 4) h += `<span class="ck-n">${n}</span>`;
    return h;
  };
  const meIdx = view, oppIdx = 1 - view;
  const barCan = myTurn && fromSet.has('bar');
  const offTgt = targetSet.has('off');
  const offSum = sumMap.has('off');
  const die = (n, used) => `<span class="die ${used ? 'used' : ''}">${'⚀⚁⚂⚃⚄⚅'[n - 1]}</span>`;
  const lastInfo = st.last ? (st.last.resign ? `${esc(nameOf(g.players[st.last.by]))} pes etti`
    : `${esc(nameOf(g.players[st.last.by]))} ${st.last.roll ? st.last.roll.join('-') + ' attı' : ''}${st.last.pass ? ', oynayamadı' : ''}`) : '';

  let status = '';
  if (g.status === 'finished') {
    const won = g.winner === me();
    const mine = p >= 0 ? st.score[p] : st.score[0], theirs = p >= 0 ? st.score[1 - p] : st.score[1];
    status = `<div class="g-end"><span class="cup">${svg('trophy')}</span>
      <h2>${p === -1 ? `${esc(nameOf(g.winner))} kazandı` : won ? 'Kazandın!' : `${esc(nameOf(g.winner))} kazandı`}</h2>
      <p>${p >= 0 ? `Skor ${mine}–${theirs}` : `Skor ${st.score[0]}–${st.score[1]}`} · ${st.hand || 1} el oynandı</p>
      ${p >= 0 ? `<button class="btn primary" id="g-again">${svg('again')}Rövanş</button>` : ''}
      <button class="btn" id="g-home">Oyunlara dön</button>
      ${p >= 0 ? '<p style="font-size:12px">Rövanşa basınca rakibine davet gider</p>' : ''}</div>`;
  }
  else if (p === -1) status = `<div class="g-status">Sıra ${esc(nameOf(g.players[st.turn]))}'de</div>`;
  else if (!myTurn) status = `<div class="g-status">Sıra ${esc(nameOf(opp))}'de · hamlesini yapınca haber gelecek</div>`;
  else if (!rolled) status = `<button class="btn primary block big" id="g-roll" ${G.busy ? 'disabled' : ''}>${svg('dice')}Zar at</button>`;
  else status = `<div class="g-actions">
      <div class="dice">${(() => { const u = usedDice.slice(); return st.dice.map((d) => { const i = u.indexOf(d); if (i >= 0) { u.splice(i, 1); return die(d, true); } return die(d, false); }).join(''); })()}</div>
      <button class="btn small" id="g-undo" ${G.done.length ? '' : 'disabled'}>Geri al</button>
      <button class="btn small primary" id="g-send" ${complete && !G.busy ? '' : 'disabled'}>${complete ? 'Hamleyi gönder' : `${legal.maxLen - G.done.length} hamle kaldı`}</button>
    </div>`;

  const turnAv = (idx) => g.status === 'active' && st.turn === idx ? 'turn' : '';
  box.innerHTML = `
    <div class="g-score">
      ${avatar(nameOf(opp), opp).replace('class="av ', `class="av ${turnAv(oppIdx)} `)}<span class="nm">${esc(nameOf(opp))}</span>
      <b>${st.score[oppIdx]} <i>–</i> ${st.score[meIdx]}</b>
      <span class="nm r">${p === -1 ? esc(nameOf(g.players[0])) : 'Sen'}</span>${avatar(nameOf(g.players[meIdx]), g.players[meIdx]).replace('class="av ', `class="av ${turnAv(meIdx)} `)}
    </div>
    ${g.status === 'active' && p >= 0 ? `<span class="g-turn ${myTurn ? '' : 'wait'}">${myTurn ? (rolled ? (G.sel != null ? 'Gideceği yere dokun' : 'Taşını seç') : 'Sıra sende · zar at') : `Sıra ${esc(nameOf(opp))}'de`}</span>` : ''}
    <div class="board ${G.busy ? 'busy' : ''}">
      <div class="row">${half(TOP.slice(0, 6), true)}<div class="bar-col"><div class="bar-slot">${barStack(oppIdx)}</div></div>${half(TOP.slice(6), true)}
        <div class="off-col"><div class="off-slot">${base.off[oppIdx] ? `<span class="off-n c${oppIdx}">${base.off[oppIdx]}</span>` : ''}</div></div></div>
      <div class="mid">${rolled ? '' : (st.last?.roll ? `<span class="mid-dice">${st.last.roll.map((d) => die(d)).join('')}</span>` : '')}</div>
      <div class="row">${half(BOTTOM.slice(0, 6), false)}<button class="bar-col ${barCan ? 'can' : ''} ${String(G.sel) === 'bar' ? 'selbar' : ''}" data-pt="bar" aria-label="Kırık taşlar"><div class="bar-slot">${barStack(meIdx)}</div></button>${half(BOTTOM.slice(6), false)}
        <button class="off-col ${offTgt ? 'tgt' : offSum ? 'tgt2' : ''}" data-pt="off" aria-label="Taş topla"><div class="off-slot">${base.off[meIdx] ? `<span class="off-n c${meIdx}">${base.off[meIdx]}</span>` : ''}</div></button></div>
    </div>
    ${rolled && G.sel != null ? '<div class="g-legend"><span><i class="g"></i>Yeşil: tek zar</span><span><i class="r"></i>Kırmızı: iki zar toplamı</span></div>' : ''}
    ${lastInfo && !rolled && g.status === 'active' ? `<p class="small" style="text-align:center">${lastInfo}</p>` : ''}
    ${status}
    ${myTurn && rolled && legal.maxLen === 0 ? '<p class="small" style="text-align:center">Oynanacak hamle yok.</p>' : ''}
    ${p >= 0 ? '<div id="g-chatbar"></div>' : ''}`;
  drawChatBar();

  document.getElementById('g-roll')?.addEventListener('click', () => call('roll'));
  document.getElementById('g-undo')?.addEventListener('click', () => { G.done.pop(); G.sel = null; drawGame(); });
  document.getElementById('g-send')?.addEventListener('click', () => call('move', { moves: G.done }));
  document.getElementById('g-home')?.addEventListener('click', () => goMain('game'));
  document.getElementById('g-again')?.addEventListener('click', rematch);
  if (!rolled) return;
  box.querySelectorAll('[data-pt]').forEach((el) => el.onclick = () => {
    const k = el.dataset.pt;
    if (G.sel != null && targetSet.has(k)) {
      const mv = targets.filter((m) => String(m.to) === k).sort((a, b) => a.die - b.die)[0];
      G.done.push(mv); G.sel = null;
      drawGame(); return;
    }
    if (G.sel != null && sumMap.has(k)) { // iki zarı birden oyna
      G.done.push(...sumMap.get(k).seq); G.sel = null;
      drawGame(); return;
    }
    if (fromSet.has(k)) { G.sel = String(G.sel) === k ? null : (k === 'bar' ? 'bar' : +k); drawGame(); return; }
    if (G.sel != null) { G.sel = null; drawGame(); }
  });
}

// Rövanş: aynı rakiple, aynı uzunlukta yeni maç
async function rematch() {
  const g = G.game; if (!g) return;
  const opp = g.players.find((u) => u !== me());
  const btn = document.getElementById('g-again'); if (btn) btn.disabled = true;
  try {
    const id = await rpc('create_game', { p_opponent: opp, p_kind: 'tavla', p_match_to: g.match_to });
    openGame(id);
    toast('Rövanş başladı, rakibine haber gitti');
  } catch (e) {
    const { data } = await sb.from('games').select('id').eq('status', 'active').contains('players', [me(), opp]).limit(1);
    if (data?.[0]) { openGame(data[0].id); return; }
    toast(errText(e)); if (btn) btn.disabled = false;
  }
}
