// Günün sorusu: tarih/coğrafya, günde 1 soru, 30 saniye, bir kere
import { S, esc, svg, avatar, toast, errText, rpc, nameOf, me, render } from './app.js';

const SECS = 30;
const Q = { data: null, day: null, busy: false };

export async function loadQuiz(force) {
  try {
    const d = await rpc('quiz_today');
    Q.data = d; Q.day = d?.day || null;
    if (force !== false && S.view === 'main' && S.tab === 'home' && !document.getElementById('sb') && !document.getElementById('quiz')) render();
  } catch (_) { /* soru yoksa kart görünmez */ }
}

export function quizCard() {
  const d = Q.data;
  if (!d) return '';
  const done = d.answered;
  const sub = !done ? `${esc(d.cat)} · 4 şık · ${SECS} saniye`
    : d.correct ? 'Doğru bildin ✓ · Sonuçları gör' : d.choice == null ? 'Süre doldu · Sonuçları gör' : 'Yanlış · Doğrusunu ve sonuçları gör';
  return `<button class="quiz-card ${done ? (d.correct ? 'ok' : 'bad') : ''}" id="quiz-open">
    <span class="qz-ic">${svg(done ? (d.correct ? 'check' : 'x') : 'bulb')}</span>
    <span class="grow"><small>GÜNÜN SORUSU</small><b>${done ? 'Bugünkü soruyu cevapladın' : 'Bugünün sorusu seni bekliyor'}</b><span>${sub}</span></span>
    <span class="go">${done ? 'Gör' : 'Başla'}</span></button>`;
}

export function bindQuizCard(root) {
  root.querySelector('#quiz-open')?.addEventListener('click', () => openQuiz());
}

// Tam ekran: arkası kapanana kadar kullanılamaz
export async function openQuiz() {
  if (document.getElementById('quiz')) return;
  const ov = document.createElement('div');
  ov.id = 'quiz'; ov.className = 'quiz-ov';
  ov.innerHTML = '<div class="quiz-box"><p class="qz-load">Soru yükleniyor…</p></div>';
  document.body.appendChild(ov);
  document.body.classList.add('quiz-open');
  const close = () => { clearInterval(Q.timer); ov.remove(); document.body.classList.remove('quiz-open'); render(); };
  ov.addEventListener('click', (e) => { if (e.target === ov) e.stopPropagation(); });
  try {
    await loadQuiz(false);
    const d = Q.data;
    if (!d) { ov.querySelector('.quiz-box').innerHTML = `<p class="qz-load">Bugün soru yok.</p><button class="btn block" id="qz-close">Kapat</button>`; ov.querySelector('#qz-close').onclick = close; return; }
    if (d.answered) { drawResult(ov, d, close); return; }
    // Başlamadan önce uyar: açınca süre başlar
    if (!d.opened_at) {
      ov.querySelector('.quiz-box').innerHTML = `${head(d, close)}
        <div class="qz-start"><div class="qz-big">${svg('bulb')}</div>
        <b>${esc(d.cat)} sorusu</b><p>Başla'ya basınca soru açılır ve <b>${SECS} saniye</b> içinde cevaplaman gerekir. Tek hakkın var.</p>
        <button class="btn primary block" id="qz-go">Başla</button></div>`;
      bindHead(ov, close);
      ov.querySelector('#qz-go').onclick = async (e) => {
        e.target.disabled = true;
        try { d.opened_at = await rpc('quiz_open'); d.now = new Date().toISOString(); drawQuestion(ov, d, close); }
        catch (er) { toast(errText(er)); e.target.disabled = false; }
      };
      return;
    }
    drawQuestion(ov, d, close);
  } catch (e) { toast(errText(e)); close(); }
}

function head(d, close) {
  return `<div class="qz-head"><span><small>GÜNÜN SORUSU</small><b>${esc(new Intl.DateTimeFormat('tr-TR', { day: 'numeric', month: 'long' }).format(new Date(d.day + 'T12:00:00')))}</b></span>
    <button class="icon-btn" id="qz-x" aria-label="Kapat">${svg('x')}</button></div>`;
}
function bindHead(ov, close) { ov.querySelector('#qz-x').onclick = close; }

function drawQuestion(ov, d, close) {
  // Sunucu saatine göre kalan süre (telefon saati yanlış olsa da)
  const skew = Date.now() - new Date(d.now || Date.now()).getTime();
  const end = new Date(d.opened_at).getTime() + SECS * 1000 + skew;
  ov.querySelector('.quiz-box').innerHTML = `${head(d, close)}
    <div class="qz-timer"><i id="qz-bar"></i><span id="qz-left">${SECS}</span></div>
    <span class="qz-cat">${esc(d.cat)}</span>
    <h2 class="qz-q">${esc(d.q)}</h2>
    <div class="qz-opts">${d.opts.map((o, i) => `<button class="qz-opt" data-i="${i}"><i>${'ABCD'[i]}</i><span>${esc(o)}</span></button>`).join('')}</div>`;
  bindHead(ov, close);
  const bar = ov.querySelector('#qz-bar'), left = ov.querySelector('#qz-left');
  const tick = () => {
    const ms = Math.max(0, end - Date.now());
    bar.style.transform = `scaleX(${ms / (SECS * 1000)})`;
    left.textContent = Math.ceil(ms / 1000);
    bar.classList.toggle('low', ms < 10000);
    if (ms <= 0) { clearInterval(Q.timer); send(null); }
  };
  const send = async (i) => {
    if (Q.busy) return; Q.busy = true;
    clearInterval(Q.timer);
    ov.querySelectorAll('.qz-opt').forEach((b) => { b.disabled = true; if (+b.dataset.i === i) b.classList.add('picked'); });
    try {
      const r = await rpc('quiz_answer', { p_choice: i });
      Object.assign(d, { answered: true, choice: r.choice, correct: r.correct, ans: r.ans, info: r.info });
      Q.data = d;
      navigator.vibrate?.(r.correct ? 30 : [40, 60, 40]);
      drawResult(ov, d, close, true);
    } catch (e) { toast(errText(e)); close(); }
    Q.busy = false;
  };
  ov.querySelectorAll('.qz-opt').forEach((b) => b.onclick = () => send(+b.dataset.i));
  tick(); Q.timer = setInterval(tick, 200);
}

async function drawResult(ov, d, close, fresh) {
  const verdict = d.correct ? '<b class="qz-v ok">Doğru! 🎉</b>' : d.choice == null ? '<b class="qz-v bad">Süre doldu ⏱️</b>' : '<b class="qz-v bad">Yanlış 😕</b>';
  ov.querySelector('.quiz-box').innerHTML = `${head(d, close)}
    <span class="qz-cat">${esc(d.cat)}</span>
    <h2 class="qz-q">${esc(d.q)}</h2>
    <div class="qz-opts">${d.opts.map((o, i) => `<div class="qz-opt ${i === d.ans ? 'right' : i === d.choice ? 'wrong' : 'dim'}"><i>${'ABCD'[i]}</i><span>${esc(o)}</span></div>`).join('')}</div>
    <div class="qz-res ${fresh ? 'pop' : ''}">${verdict}${d.info ? `<p>${esc(d.info)}</p>` : ''}</div>
    <div class="qz-who" id="qz-who"><p class="small">Sonuçlar yükleniyor…</p></div>
    <button class="btn block" id="qz-done">Kapat</button>`;
  bindHead(ov, close);
  ov.querySelector('#qz-done').onclick = close;
  try {
    const rows = (await rpc('quiz_results')) || [];
    const pick = (r) => r.choice == null ? 'boş' : 'ABCD'[r.choice];
    const order = (r) => (r.answered ? (r.correct ? 0 : 1) : 2);
    rows.sort((a, b) => order(a) - order(b));
    const ok = rows.filter((r) => r.correct).length, ans = rows.filter((r) => r.answered).length;
    ov.querySelector('#qz-who').innerHTML = `<p class="qz-sum">${ans} kişi cevapladı · ${ok} doğru</p>
      ${rows.map((r) => `<div class="qz-p">${avatar(nameOf(r.user_id), r.user_id)}<b>${esc(nameOf(r.user_id).split(' ')[0])}${r.user_id === me() ? ' (sen)' : ''}</b>
        <span class="${r.answered ? (r.correct ? 'ok' : 'bad') : 'wait'}">${r.answered ? (r.correct ? `✓ Doğru` : `✗ ${pick(r)}`) : 'Henüz cevaplamadı'}</span></div>`).join('')}`;
  } catch (_) { ov.querySelector('#qz-who').innerHTML = ''; }
}
