-- 018: Tavla sunucusu sürpriz tablolarını okuyabilsin (eksik izin) + Musa'ya yeniden haber
grant all on public.tavla_boost, public.tavla_secret to service_role;

insert into public.notify_queue (user_ids, title, body, url, tag, inbox)
  select array[b.user_id], 'Sürpriz 🎁', 'Sürprizin bir aksilik yüzünden çalışmadı 😅 Göregen''e yeniden tavla teklifi gönder, bu sefer gerçekten anın tadını çıkar.', './#oyunlar', 'surpriz2-' || b.user_id, false
    from public.tavla_boost b where not b.used and b.game_id is null;
