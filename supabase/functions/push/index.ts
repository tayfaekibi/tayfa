// Tayfa · bildirim gönderici ("push" fonksiyonu)
// Veritabanındaki notify_queue tablosunda bekleyen bildirimleri alır ve
// ilgili kişilerin telefonlarına gönderir. Gizli anahtar kodda değil,
// Supabase > Edge Functions > Secrets içinde VAPID_PRIVATE_KEY olarak durur.
import { createClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

const VAPID_PUBLIC_KEY =
  "BNIF3QM-WLRcWZj5hkZkiZDloJG-3AY2gOp3Z4bYiHHUBmzEKclj0qBhXCqoSPRryCsFNeyRwDCgtCLpDIYcppw";

function serviceKey(): string {
  const legacy = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (legacy) return legacy;
  const keys = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (keys) {
    try {
      const parsed = JSON.parse(keys);
      return parsed.default ?? Object.values(parsed)[0];
    } catch (_) { /* yoksay */ }
  }
  throw new Error("Sunucu anahtarı bulunamadı");
}

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  try {
    const body = await req.json().catch(() => ({}));
    const privateKey = Deno.env.get("VAPID_PRIVATE_KEY");
    if (!privateKey) return json({ hata: "VAPID_PRIVATE_KEY tanımlı değil" }, 500);
    webpush.setVapidDetails("https://tayfaekibi.github.io/tayfa/", VAPID_PUBLIC_KEY, privateKey);

    const db = createClient(Deno.env.get("SUPABASE_URL")!, serviceKey(), {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // Günlük temizlik: 30 günden eski sesli mesajları sil
    if (body?.temizlik) {
      const limit = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();
      const { data: old } = await db.from("messages").select("id, audio_path").lt("created_at", limit).limit(500);
      const paths = (old ?? []).map((m) => m.audio_path).filter(Boolean) as string[];
      if (paths.length) await db.storage.from("chat").remove(paths);
      if (old?.length) await db.from("messages").delete().in("id", old.map((m) => m.id));
      return json({ silinen: old?.length ?? 0 });
    }

    // Bekleyenleri "gönderildi" diye işaretleyerek al (aynı bildirim iki kez gitmesin)
    const hourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { data: items, error } = await db
      .from("notify_queue")
      .update({ sent_at: new Date().toISOString() })
      .is("sent_at", null)
      .gt("created_at", hourAgo)
      .select("id, user_ids, title, body, url, tag");
    if (error) return json({ hata: error.message }, 500);
    if (!items || items.length === 0) return json({ gonderilen: 0 });

    const userIds = [...new Set(items.flatMap((i) => i.user_ids as string[]))];
    const { data: subs, error: subErr } = await db
      .from("push_subscriptions")
      .select("endpoint, user_id, p256dh, auth")
      .in("user_id", userIds);
    if (subErr) return json({ hata: subErr.message }, 500);

    // Oyun ekranı açık olan kişiye o oyunla ilgili bildirim gönderme (son 45 sn içinde ekrandaysa)
    const since = new Date(Date.now() - 45 * 1000).toISOString();
    const { data: pres } = await db.from("presence").select("user_id, game_id").gt("seen_at", since).in("user_id", userIds);
    const viewing = new Map((pres ?? []).filter((r) => r.game_id).map((r) => [r.user_id, r.game_id]));
    const gameOf = (tag: string | null) => tag?.match(/^(?:tavla|king|oyun-sohbet)-(.+)$/)?.[1] ?? null;

    let sent = 0;
    const gone: string[] = [];
    const jobs: Promise<void>[] = [];
    for (const item of items) {
      for (const sub of subs ?? []) {
        if (!(item.user_ids as string[]).includes(sub.user_id)) continue;
        const g = gameOf(item.tag);
        if (g && viewing.get(sub.user_id) === g) continue;
        // Oyun oynarken genel sohbet bildirimi gelmez (uygulamada sayı olarak görünür); @bahis ve yanıtlar gelir
        if (item.tag?.startsWith("sohbet-") && viewing.has(sub.user_id)) continue;
        const payload = JSON.stringify({
          title: item.title,
          body: item.body,
          url: item.url ?? "./",
          tag: item.tag ?? "tayfa-" + item.id,
        });
        jobs.push(
          webpush
            .sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, payload, {
              TTL: 60 * 60 * 24,
              urgency: "high",
            })
            .then(() => { sent++; })
            .catch((e: { statusCode?: number }) => {
              if (e?.statusCode === 404 || e?.statusCode === 410) gone.push(sub.endpoint);
            }),
        );
      }
    }
    await Promise.all(jobs);
    if (gone.length) await db.from("push_subscriptions").delete().in("endpoint", gone);

    return json({ gonderilen: sent, silinen_abonelik: gone.length });
  } catch (e) {
    return json({ hata: String(e) }, 500);
  }
});
