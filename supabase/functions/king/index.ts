// King sunucusu: kartları dağıtır, seçimi ve oynanan kartı kurallara göre doğrular, puanı yazar.
import { createClient } from "npm:@supabase/supabase-js@2";
import * as K from "../_shared/king.js";

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
// Eşit olasılıklı rastgele sayı (0..n-1)
function rnd(n: number): number {
  const b = new Uint32Array(1);
  const lim = Math.floor(0x100000000 / n) * n;
  do { crypto.getRandomValues(b); } while (b[0] >= lim);
  return b[0] % n;
}
const contractText = (c: any) => c.type === "koz" ? `Koz ${K.SUIT_NAME[c.trump as "S"]}` : K.CONTRACTS[c.type as "el"].name;

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
    if (g.kind !== "king") return fail("Bu oyun King değil");
    if (g.status !== "active") return fail("Oyun bitti");

    const { data: mem } = await db.from("members").select("user_id, display_name, status, role")
      .eq("group_id", g.group_id).in("user_id", g.players);
    const me = (mem ?? []).find((m) => m.user_id === uid && m.status === "active");
    if (!me) return fail("Bu oyunda değilsin", 403);
    const nameOf = (id: string) => mem?.find((m) => m.user_id === id)?.display_name ?? "Oyuncu";
    const seat = g.players.indexOf(uid);
    const st = g.state as any;
    const notes: { to: string[]; title: string; body: string }[] = [];
    let system: string | null = null;
    let newHands: string[][] | null = null;
    let myHand: string[] | null = null;

    if (action === "close") {
      // Masayı kapat: açan kişi ya da yönetici
      if (g.created_by !== uid && me.role !== "admin") return fail("Masayı sadece açan kişi kapatabilir");
      g.status = "abandoned";
      system = `${nameOf(uid)} King masasını kapattı`;
    } else if (action === "choose") {
      try { K.applyChoice(st, seat, body.type, body.trump); } catch (e) { return fail(String((e as Error).message)); }
      const others = g.players.filter((p: string) => p !== uid);
      notes.push({ to: others, title: "King · " + contractText(st.contract), body: `${nameOf(uid)} seçti, ${st.hand}. el başlıyor` });
    } else if (action === "play") {
      if (st.phase !== "play") return fail("Önce el seçilmeli");
      if (st.turn !== seat) return fail("Sıra sende değil");
      const { data: h } = await db.from("king_hands").select("cards").eq("game_id", g.id).eq("seat", seat).single();
      const hand: string[] = h?.cards ?? [];
      const card = String(body.card || "");
      if (!hand.includes(card)) return fail("Bu kart elinde yok");
      if (!K.legalCards(st, hand).includes(card)) return fail("Bu kartı şimdi oynayamazsın");
      myHand = hand.filter((c) => c !== card);
      const r = K.applyPlay(st, seat, card);
      if (r.gameDone) {
        g.status = "finished";
        const best = Math.max(...st.score);
        const wi = st.score.indexOf(best);
        g.winner = g.players[wi];
        const table = g.players.map((p: string, i: number) => `${nameOf(p)} ${st.score[i]}`).join(", ");
        system = `King bitti: ${nameOf(g.winner)} kazandı (${table})`;
        notes.push({ to: g.players.filter((p: string) => p !== uid), title: "King bitti", body: `${nameOf(g.winner)} kazandı` });
      } else if (r.handDone) {
        newHands = K.deal(rnd);
        const last = st.history[st.history.length - 1];
        notes.push({ to: [g.players[st.chooser]], title: "King · seçim sende", body: `${st.hand}. el için seçimini yap` });
        notes.push({ to: g.players.filter((p: string, i: number) => i !== st.chooser && p !== uid), title: "King · yeni el",
          body: `${K.CONTRACTS[last.type as "el"].name} bitti, ${st.hand}. eli ${nameOf(g.players[st.chooser])} seçecek` });
      } else if (g.players[st.turn] !== uid) {
        notes.push({ to: [g.players[st.turn]], title: "King · sıra sende", body: `${contractText(st.contract)} · ${st.hand}. el` });
      }
    } else return fail("Bilinmeyen işlem");

    const now = new Date().toISOString();
    const { data: upd, error: we } = await db.from("games")
      .update({
        state: st, status: g.status, winner: g.winner ?? null,
        turn: g.status === "active" ? g.players[st.turn] : null,
        updated_at: now, finished_at: g.status !== "active" ? now : null,
      })
      .eq("id", g.id).eq("updated_at", g.updated_at).select("id");
    if (we) return fail(we.message, 500);
    if (!upd?.length) return fail("Oyun bu arada değişti, yeniden dene", 409);

    if (newHands) {
      for (let i = 0; i < 4; i++) {
        await db.from("king_hands").upsert({ game_id: g.id, seat: i, user_id: g.players[i], cards: newHands[i] });
      }
    } else if (myHand) {
      await db.from("king_hands").update({ cards: myHand }).eq("game_id", g.id).eq("seat", seat);
    }
    for (const n of notes) {
      if (!n.to.length) continue;
      await db.from("notify_queue").insert({ user_ids: n.to, title: n.title, body: n.body, url: `./#oyun/${g.id}`, tag: `king-${g.id}` });
    }
    if (system) {
      await db.from("messages").insert({ group_id: g.group_id, kind: "system", payload: { type: "game", text: system, game_id: g.id } });
    }
    return json({ ok: true });
  } catch (e) {
    return fail(String(e), 500);
  }
});
