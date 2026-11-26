// Tavla sunucusu: zarı sunucu atar, hamleleri kurallara göre doğrular.
import { createClient } from "npm:@supabase/supabase-js@2";
import * as T from "../_shared/tavla.js";
import * as AI from "../_shared/botai.js";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { ...CORS, "Content-Type": "application/json" } });
const fail = (msg: string, status = 400) => json({ hata: msg }, status);

function serviceKey(): string {
  const legacy = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (legacy) return legacy;
  const keys = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (keys) {
    try { const o = JSON.parse(keys); return o.default ?? Object.values(o)[0]; } catch (_) { /* */ }
  }
  throw new Error("Sunucu anahtarı bulunamadı");
}

function rollDie(): number {
  const b = new Uint8Array(1);
  do { crypto.getRandomValues(b); } while (b[0] >= 252); // eşit olasılık
  return (b[0] % 6) + 1;
}


const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const R = { fail: (msg: string, status = 400) => ({ ok: false, hata: msg, status }) as any };

// Bir oyuncunun (insan ya da bot) tek işlemi: kuralları uygula, kaydet, bildirim ve sohbet notunu yaz
async function step(db: any, g: any, uid: string, action: string, body: any): Promise<any> {
  const { data: mem } = await db.from("members").select("user_id, display_name, status")
    .eq("group_id", g.group_id).in("user_id", g.players);
  const nameOf = (id: string) => (AI.BOT_NAMES as any)[id] ?? mem?.find((m: any) => m.user_id === id)?.display_name ?? "Rakip";
  const p = g.players.indexOf(uid);
  const opp = g.players[1 - p];
  const st = g.state as any;
  if (g.status !== "active") return R.fail("Oyun bitti");
  const notes: { to: string[]; title: string; body: string }[] = [];
  let system: string | null = null;

  // Eli bitir (doğal bitiş ya da kabul edilen pes): puanı yaz, maç bittiyse kapat, yoksa yeni el
  const finishHand = (w: number, points: number, how: string) => {
    const wu = g.players[w], lu = g.players[1 - w];
    st.score[w] += points;
    st.resignOffer = null; st.resignRejected = null; st.dice = [];
    const sc = `${st.score[0]}–${st.score[1]}`;
    if (st.score[w] >= g.match_to) {
      g.status = "finished";
      g.winner = wu;
      system = `${nameOf(wu)} tavlada ${nameOf(lu)}'yi ${st.score[w]}–${st.score[1 - w]} yendi`;
      notes.push({ to: [lu === uid ? wu : lu].filter((x) => x !== uid), title: "Tavla bitti", body: `${nameOf(wu)} maçı ${st.score[w]}–${st.score[1 - w]} kazandı` });
    } else {
      const fresh = T.newBoard();
      st.board = fresh.board; st.bar = fresh.bar; st.off = fresh.off;
      st.hand = (st.hand ?? 1) + 1;
      st.turn = 1 - w; // eli kaybeden başlar
      st.lastHand = { winner: w, points, how };
      const other = g.players.find((x: string) => x !== uid)!;
      notes.push({ to: [other], title: "Tavla · yeni el", body: how === "pes"
        ? `${nameOf(lu)} eli bıraktı, ${nameOf(wu)} ${points === 2 ? "mars (2 puan)" : "1 puan"} aldı. Skor ${sc}`
        : `${nameOf(wu)} eli aldı${points === 2 ? " (mars!)" : ""}. Skor ${sc}, sıra sende` });
    }
  };

  if (action === "offer_resign") {
    // Bu el için pes teklifi: 1 puan ya da mars (2 puan). Rakip onaylarsa el biter.
    const pts = Number(body.points) === 2 ? 2 : 1;
    if (st.resignOffer && st.resignOffer.by === p) return R.fail("Teklifin zaten bekliyor");
    st.resignOffer = { by: p, points: pts, at: new Date().toISOString() };
    st.resignRejected = null;
    if (AI.isBot(opp)) {
      if (AI.botAcceptsResign(st, 1 - p, pts)) { st.last = { by: p, handResign: true, points: pts }; finishHand(1 - p, pts, "pes"); }
      else { st.resignOffer = null; st.resignRejected = { by: p, points: pts }; }
    } else notes.push({ to: [opp], title: "Tavla · pes teklifi", body: `${nameOf(uid)} bu eli bırakmak istiyor (${pts === 2 ? "mars, 2 puan" : "1 puan"}). Kabul ediyor musun?` });
  } else if (action === "cancel_resign") {
    if (!st.resignOffer || st.resignOffer.by !== p) return R.fail("Bekleyen teklifin yok");
    st.resignOffer = null;
  } else if (action === "answer_resign") {
    const off = st.resignOffer;
    if (!off || off.by === p) return R.fail("Cevaplanacak teklif yok");
    if (body.accept) {
      st.last = { by: off.by, handResign: true, points: off.points };
      finishHand(p, off.points, "pes");
    } else {
      st.resignOffer = null;
      st.resignRejected = { by: off.by, points: off.points };
      notes.push({ to: [opp], title: "Tavla", body: `${nameOf(uid)} pes teklifini reddetti, oyun sürüyor` });
    }
  } else if (action === "resign") {
    g.status = "finished";
    g.winner = opp;
    st.last = { by: p, resign: true };
    system = `${nameOf(opp)} tavlada kazandı (${nameOf(uid)} pes etti)`;
    notes.push({ to: [opp], title: "Tavla", body: `${nameOf(uid)} pes etti, maçı kazandın` });
  } else {
    if (st.turn !== p) return R.fail("Sıra sende değil");
    if (action === "roll" || action === "pick") {
      if (st.dice?.length) return R.fail("Zar zaten atıldı");
      st.resignRejected = null;
      if (st.autoPass?.by === p) st.autoPass = null;
      // Bir kerelik sürpriz: bu oyuncu bu rakibe karşı iki zar çifti arasından seçer (rakip görmez)
      const { data: boost } = await db.from("tavla_boost").select("*").eq("user_id", uid).eq("used", false).maybeSingle();
      const boosted = boost && boost.opp_id === opp && (!boost.game_id || boost.game_id === g.id);
      let a = 0, b = 0;
      if (boosted) {
        if (!boost.game_id) await db.from("tavla_boost").update({ game_id: g.id }).eq("user_id", uid);
        const { data: sec } = await db.from("tavla_secret").select("opts").eq("game_id", g.id).eq("user_id", uid).maybeSingle();
        if (action === "roll") {
          if (!sec) {
            const opts = [[rollDie(), rollDie()], [rollDie(), rollDie()]];
            await db.from("tavla_secret").insert({ game_id: g.id, user_id: uid, opts });
          }
          return { ok: true, extra: { pick: true } };
        }
        const i = Number(body.i) === 1 ? 1 : 0;
        if (!sec) return R.fail("Önce zar at");
        [a, b] = (sec.opts as number[][])[i];
        await db.from("tavla_secret").delete().eq("game_id", g.id).eq("user_id", uid);
      } else {
        if (action === "pick") return R.fail("Bilinmeyen işlem");
        a = rollDie(); b = rollDie();
      }
      st.roll = [a, b];
      st.dice = T.rollToDice(a, b);
      const legal = T.legalSequences(st, p, st.dice);
      if (legal.maxLen === 0) {
        st.last = { by: p, roll: [a, b], moves: [], pass: true };
        st.dice = [];
        st.turn = 1 - p;
        notes.push({ to: [opp], title: "Tavla · sıra sende", body: `${nameOf(uid)} ${a}-${b} attı, oynayamadı` });
      }
    } else if (action === "move") {
      if (!st.dice?.length) return R.fail("Önce zar at");
      const seq = (body.moves ?? []) as any[];
      const legal = T.legalSequences(st, p, st.dice);
      if (!T.isLegalSequence(legal, seq)) return R.fail("Bu hamle kurallara uygun değil");
      const next = T.applySequence(st, p, seq);
      st.board = next.board; st.bar = next.bar; st.off = next.off;
      st.last = { by: p, roll: st.roll, moves: seq };
      st.dice = [];
      const res = T.handResult(st, p);
      if (res) {
        finishHand(p, res.points, "oyun");
      } else {
        st.turn = 1 - p;
        notes.push({ to: [opp], title: "Tavla · sıra sende", body: `${nameOf(uid)} oynadı` });
      }
    } else return R.fail("Bilinmeyen işlem");
  }

  // Sıra kırık taşı olan ve hiç giremeyecek (ev tamamen kapalı) oyuncuya geçtiyse boşuna zar attırma: sıra geri döner
  if (g.status === "active" && !st.dice?.length) {
    const t = st.turn;
    if (T.entryBlocked(st, t) && !T.entryBlocked(st, 1 - t)) {
      st.autoPass = { by: t, at: new Date().toISOString() };
      st.turn = 1 - t;
      for (let i = notes.length - 1; i >= 0; i--) if (notes[i].to.includes(g.players[t]) && notes[i].title.includes("sıra sende")) notes.splice(i, 1);
      if (g.players[t] !== uid) notes.push({ to: [g.players[t]], title: "Tavla", body: "Kırık taşın var, girecek yer yok · sıra rakibe geçti" });
      if (g.players[1 - t] !== uid) notes.push({ to: [g.players[1 - t]], title: "Tavla · sıra sende", body: `${nameOf(g.players[t])} giremedi, sıra yine sende` });
    }
  }

  // Sürpriz maçı bittiyse kapat; sürprizli oyuncu kazandıysa sözünü söylesin
  if (g.status === "finished") {
    const { data: bst } = await db.from("tavla_boost").select("*").eq("game_id", g.id).eq("used", false).maybeSingle();
    if (bst) {
      await db.from("tavla_boost").update({ used: true }).eq("user_id", bst.user_id);
      await db.from("tavla_secret").delete().eq("game_id", g.id);
      if (g.winner === bst.user_id && bst.quote) {
        st.endQuote = { by: bst.user_id, text: bst.quote };
        system = `${system ? system + " · " : ""}${nameOf(bst.user_id)}: “${bst.quote}”`;
      }
    }
  }

  const now = new Date().toISOString();
  const { data: upd, error: we } = await db.from("games")
    .update({
      state: st, status: g.status, winner: g.winner ?? null,
      turn: g.status === "active" ? g.players[st.turn] : null,
      updated_at: now, finished_at: g.status === "finished" ? now : null,
    })
    .eq("id", g.id).eq("updated_at", g.updated_at).select("id");
  if (we) return R.fail(we.message, 500);
  if (!upd?.length) return R.fail("Oyun bu arada değişti, yeniden dene", 409);
  g.updated_at = now;

  for (const n of notes) {
    n.to = n.to.filter((x: string) => !AI.isBot(x));
    if (!n.to.length) continue;
    await db.from("notify_queue").insert({
      user_ids: n.to, title: n.title, body: n.body, url: `./#oyun/${g.id}`, tag: `tavla-${g.id}`,
    });
  }
  if (system) {
    await db.from("messages").insert({
      group_id: g.group_id, kind: "system", payload: { type: "game", text: system, game_id: g.id },
    });
  }

  return { ok: true, extra: null };
}

// Sıra bottaysa bot oynar (arka planda, düşünüyormuş gibi bekleyerek). Her adım ayrı kaydedilir, ekranlar canlı görür.
async function botLoop(db: any, gameId: string) {
  for (let i = 0; i < 60; i++) {
    const { data: g } = await db.from("games").select("*").eq("id", gameId).single();
    if (!g || g.status !== "active") return;
    const st = g.state as any;
    const t = st.turn, uid = g.players[t];
    if (!AI.isBot(uid)) return;
    const rolled = st.dice?.length > 0;
    await sleep(rolled ? 1200 : 800);
    const r = rolled
      ? await step(db, g, uid, "move", { moves: AI.bestTavlaSequence(st, t, st.dice) })
      : await step(db, g, uid, "roll", {});
    if (!r.ok && r.status !== 409) return;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const db = createClient(Deno.env.get("SUPABASE_URL")!, serviceKey(), {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    const { data: u, error: ue } = await db.auth.getUser(token);
    if (ue || !u?.user) return fail("Giriş gerekli", 401);
    const uid = u.user.id;

    const body = await req.json().catch(() => ({}));
    const { action, game_id } = body as { action: string; game_id: string };
    const { data: g, error: ge } = await db.from("games").select("*").eq("id", game_id).single();
    if (ge || !g) return fail("Oyun bulunamadı", 404);
    if (g.kind !== "tavla") return fail("Bu oyun tavla değil");
    const { data: me } = await db.from("members").select("user_id").eq("group_id", g.group_id).eq("user_id", uid).eq("status", "active").maybeSingle();
    if (!me || !g.players.includes(uid)) return fail("Bu oyunda değilsin", 403);

    let r: any = { ok: true, extra: null };
    if (action !== "bot") r = await step(db, g, uid, action, body);   // "bot": sadece botu dürt
    if (!r.ok) return fail(r.hata, r.status);
    // @ts-ignore: Supabase Edge Runtime
    const bg = botLoop(db, g.id).catch((e) => console.error(e));
    // @ts-ignore
    if (typeof EdgeRuntime !== "undefined" && EdgeRuntime.waitUntil) EdgeRuntime.waitUntil(bg); else await bg;
    return json({ ok: true, ...(r.extra || {}) });
  } catch (e) {
    return fail(String(e), 500);
  }
});
