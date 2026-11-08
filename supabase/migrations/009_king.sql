-- =====================================================================
-- TAYFA · 3.2 · King (4 kişi, 20 el)
-- Eller gizli: her oyuncu sadece kendi kartlarını görebilir. Kartları sunucu dağıtır ve doğrular.
-- =====================================================================
create table if not exists public.king_hands (
  game_id  uuid not null references public.games(id) on delete cascade,
  seat     int  not null check (seat between 0 and 3),
  user_id  uuid not null references auth.users(id) on delete cascade,
  cards    text[] not null default '{}',
  primary key (game_id, seat)
);
alter table public.king_hands enable row level security;
grant select on public.king_hands to authenticated;
grant all on public.king_hands to service_role;
drop policy if exists "kendi kartlarini gorur" on public.king_hands;
create policy "kendi kartlarini gorur" on public.king_hands for select to authenticated using (user_id = auth.uid());

-- 52 kartı karıştırıp dört ele böl
create or replace function public.king_deal(p_game uuid, p_players uuid[]) returns void
language plpgsql security definer set search_path = '' as $$
declare deck text[];
begin
  select array_agg(c order by random()) into deck
    from (select s || r as c from unnest(array['S','H','D','C']) s, generate_series(2, 14) r) x;
  delete from public.king_hands where game_id = p_game;
  for i in 0..3 loop
    insert into public.king_hands (game_id, seat, user_id, cards)
      values (p_game, i, p_players[i + 1], deck[i * 13 + 1 : i * 13 + 13]);
  end loop;
end $$;
revoke execute on function public.king_deal(uuid, uuid[]) from public, anon, authenticated;

create or replace function public.create_king(p_others uuid[]) returns uuid
language plpgsql security definer set search_path = '' as $$
declare gid uuid := public.my_group(); g uuid; ps uuid[]; starter int; st jsonb;
begin
  if gid is null then raise exception 'TAYFA: Üyeliğiniz etkin değil'; end if;
  select array_agg(distinct u) into ps from unnest(p_others) u where u <> auth.uid();
  if coalesce(cardinality(ps), 0) <> 3 then raise exception 'TAYFA: King için 3 kişi seç'; end if;
  if (select count(*) from public.members where group_id = gid and status = 'active' and user_id = any(ps)) <> 3 then
    raise exception 'TAYFA: Seçilen kişilerden biri grupta değil';
  end if;
  ps := array[auth.uid()] || ps;
  starter := floor(random() * 4)::int;
  st := jsonb_build_object(
    'kind', 'king', 'hand', 1, 'chooser', starter, 'phase', 'choose', 'contract', null,
    'turn', starter, 'leader', starter, 'trick', '[]'::jsonb, 'tricksDone', 0, 'penTaken', 0, 'broken', false,
    'handPts', jsonb_build_array(0,0,0,0), 'score', jsonb_build_array(0,0,0,0), 'counts', jsonb_build_array(13,13,13,13),
    'picks', jsonb_build_array(jsonb_build_object('koz',0,'ceza',0), jsonb_build_object('koz',0,'ceza',0),
                               jsonb_build_object('koz',0,'ceza',0), jsonb_build_object('koz',0,'ceza',0)),
    'used', '{}'::jsonb, 'history', '[]'::jsonb, 'lastTrick', null);
  insert into public.games (group_id, kind, players, state, turn, match_to, created_by)
    values (gid, 'king', ps, st, ps[starter + 1], 20, auth.uid())
    returning id into g;
  perform public.king_deal(g, ps);
  perform public.queue_notify(array_remove(ps, auth.uid()), 'King daveti 👑',
    public.member_name(gid, auth.uid()) || ' King masası açtı',
    './#oyun/' || g, 'king-' || g);
  if ps[starter + 1] <> auth.uid() then
    perform public.queue_notify(array[ps[starter + 1]], 'King · seçim sende',
      'İlk eli sen seçeceksin', './#oyun/' || g, 'king-' || g);
  end if;
  return g;
end $$;
grant execute on function public.create_king(uuid[]) to authenticated;

do $$ begin
  begin execute 'alter publication supabase_realtime add table public.king_hands'; exception when others then null; end;
end $$;
