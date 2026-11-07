// Tavla sunucusu: zarı sunucu atar, hamleleri kurallara göre doğrular.
import { createClient } from "npm:@supabase/supabase-js@2";
import * as T from "../_shared/tavla.js";

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

    const { data: mem } = await db.from("members").select("user_id, display_name, status")
      .eq("group_id", g.group_id).in("user_id", g.players);
    const active = (mem ?? []).filter((m) => m.status === "active");
    if (!active.some((m) => m.user_id === uid)) return fail("Bu oyunda değilsin", 403);
    const nameOf = (id: string) => mem?.find((m) => m.user_id === id)?.display_name ?? "Rakip";

    const p = g.players.indexOf(uid);
    const opp = g.players[1 - p];
    const st = g.state as any;
    if (g.status !== "active") return fail("Oyun bitti");

    const notes: { to: string[]; title: string; body: string }[] = [];
    let system: string | null = null;

    if (action === "resign") {
      g.status = "finished";
      g.winner = opp;
      st.last = { by: p, resign: true };
      system = `${nameOf(opp)} tavlada kazandı (${nameOf(uid)} pes etti)`;
      notes.push({ to: [opp], title: "Tavla", body: `${nameOf(uid)} pes etti, maçı kazandın` });
    } else {
      if (st.turn !== p) return fail("Sıra sende değil");
      if (action === "roll") {
        if (st.dice?.length) return fail("Zar zaten atıldı");
        const a = rollDie(), b = rollDie();
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
        if (!st.dice?.length) return fail("Önce zar at");
        const seq = (body.moves ?? []) as any[];
        const legal = T.legalSequences(st, p, st.dice);
        if (!T.isLegalSequence(legal, seq)) return fail("Bu hamle kurallara uygun değil");
        const next = T.applySequence(st, p, seq);
        st.board = next.board; st.bar = next.bar; st.off = next.off;
        st.last = { by: p, roll: st.roll, moves: seq };
        st.dice = [];
        const res = T.handResult(st, p);
        if (res) {
          st.score[p] += res.points;
          const sc = `${st.score[0]}–${st.score[1]}`;
          if (st.score[p] >= g.match_to) {
            g.status = "finished";
            g.winner = uid;
            const mine = st.score[p], theirs = st.score[1 - p];
            system = `${nameOf(uid)} tavlada ${nameOf(opp)}'yi ${mine}–${theirs} yendi`;
            notes.push({ to: [opp], title: "Tavla bitti", body: `${nameOf(uid)} maçı ${mine}–${theirs} kazandı` });
          } else {
            const fresh = T.newBoard();
            st.board = fresh.board; st.bar = fresh.bar; st.off = fresh.off;
            st.hand = (st.hand ?? 1) + 1;
            st.turn = 1 - p; // eli kaybeden başlar
            st.lastHand = { winner: p, points: res.points };
            notes.push({ to: [opp], title: "Tavla · yeni el", body: `${nameOf(uid)} eli aldı${res.points === 2 ? " (mars!)" : ""}. Skor ${sc}, sıra sende` });
          }
        } else {
          st.turn = 1 - p;
          notes.push({ to: [opp], title: "Tavla · sıra sende", body: `${nameOf(uid)} oynadı` });
        }
      } else return fail("Bilinmeyen işlem");
    }

    const now = new Date().toISOString();
    const { data: upd, error: we } = await db.from("games")
      .update({
        state: st, status: g.status, winner: g.winner ?? null,
        turn: g.status === "active" ? g.players[st.turn] : null,
        updated_at: now, finished_at: g.status === "finished" ? now : null,
      })
      .eq("id", g.id).eq("updated_at", g.updated_at).select("id");
    if (we) return fail(we.message, 500);
    if (!upd?.length) return fail("Oyun bu arada değişti, yeniden dene", 409);

    for (const n of notes) {
      await db.from("notify_queue").insert({
        user_ids: n.to, title: n.title, body: n.body, url: `./#oyun/${g.id}`, tag: `tavla-${g.id}`,
      });
    }
    if (system) {
      await db.from("messages").insert({
        group_id: g.group_id, kind: "system", payload: { type: "game", text: system, game_id: g.id },
      });
    }
    return json({ ok: true });
  } catch (e) {
    return fail(String(e), 500);
  }
});
