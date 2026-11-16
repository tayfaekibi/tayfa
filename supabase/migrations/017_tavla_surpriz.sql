-- 017: Bir kerelik tavla sürprizi (yönetici şakası): belirlenen oyuncu, belirlenen rakibe karşı ilk maçında
-- her atışta iki zar çifti görür ve birini seçer. Rakip hiçbir şey görmez. Maç bitince kendiliğinden kapanır.

create table if not exists public.tavla_boost (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  opp_id     uuid not null references auth.users(id) on delete cascade,
  game_id    uuid references public.games(id) on delete set null,
  quote      text,
  used       boolean not null default false,
  created_at timestamptz not null default now()
);
alter table public.tavla_boost enable row level security; -- kimse okuyamaz, sadece sunucu

create table if not exists public.tavla_secret (
  game_id uuid not null references public.games(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  opts    jsonb not null,
  primary key (game_id, user_id)
);
alter table public.tavla_secret enable row level security;
drop policy if exists "kendi gizli zarini gorur" on public.tavla_secret;
create policy "kendi gizli zarini gorur" on public.tavla_secret for select to authenticated using (user_id = auth.uid());
grant select on public.tavla_secret to authenticated;

do $$
declare musa uuid; gor uuid; n1 int; n2 int;
begin
  select count(*), min(user_id::text)::uuid into n1, musa from public.members where status = 'active' and display_name ilike 'musa%';
  select count(*), min(user_id::text)::uuid into n2, gor from public.members where status = 'active' and display_name ilike 'g_regen%';
  if n1 = 1 and n2 = 1 then
    insert into public.tavla_boost (user_id, opp_id, quote)
      values (musa, gor, 'Ben imparator Neron''un ruhuyum. Hepiniz bana biat edeceksiniz!')
      on conflict (user_id) do update set opp_id = excluded.opp_id, quote = excluded.quote, game_id = null, used = false;
    insert into public.notify_queue (user_ids, title, body, url, tag, inbox)
      values (array[musa], 'Sürpriz 🎁', 'Gökalp''in sana bir oyunluk bir sürprizi var. Göregen''e tavla teklifi gönder ve anın tadını çıkar 😏', './#oyunlar', 'surpriz-' || musa, false);
  else
    raise exception 'Tavla sürprizi: oyuncular bulunamadı (musa=%, göregen=%)', n1, n2;
  end if;
end $$;
