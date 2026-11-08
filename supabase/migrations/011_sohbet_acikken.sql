-- =====================================================================
-- TAYFA · 3.3.3: Sohbet ekranı açıkken genel sohbet bildirimi gönderme
-- Uygulama, sohbet açıkken 20 saniyede bir bildirir; gönderici son 45 saniyede sohbette olanı atlar.
-- =====================================================================
alter table public.presence add column if not exists place text;

create or replace function public.set_presence(p_game uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then return; end if;
  insert into public.presence (user_id, game_id, place, seen_at) values (auth.uid(), p_game, null, now())
  on conflict (user_id) do update set game_id = excluded.game_id, place = null, seen_at = now();
end $$;

create or replace function public.set_presence_place(p_place text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then return; end if;
  insert into public.presence (user_id, game_id, place, seen_at) values (auth.uid(), null, p_place, now())
  on conflict (user_id) do update set game_id = null, place = excluded.place, seen_at = now();
end $$;
grant execute on function public.set_presence_place(text) to authenticated;
