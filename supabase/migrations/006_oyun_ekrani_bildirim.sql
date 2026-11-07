-- =====================================================================
-- TAYFA · 2.5: Oyun ekranı açıkken o oyunla ilgili bildirim gönderme
-- Uygulama, açık olan oyun ekranını 20 saniyede bir bildirir; bildirim
-- gönderici son 45 saniyede o ekranda olan kişiyi atlar.
-- =====================================================================
create table if not exists public.presence (
  user_id  uuid primary key references auth.users(id) on delete cascade,
  game_id  uuid,
  seen_at  timestamptz not null default now()
);
alter table public.presence enable row level security;
grant all on public.presence to service_role;

create or replace function public.set_presence(p_game uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then return; end if;
  insert into public.presence (user_id, game_id, seen_at) values (auth.uid(), p_game, now())
  on conflict (user_id) do update set game_id = excluded.game_id, seen_at = now();
end $$;
grant execute on function public.set_presence(uuid) to authenticated;
