-- 019: Gerçek maçlarda botlar (tavlada Kaptan; King'de boş koltuklara Kaptan, Lodos, Poyraz)
-- Botlar üye değildir; oyunlarda sabit kimlikleriyle yer alır. Hamlelerini sunucu (Edge Function) yapar.

create or replace function public.is_bot(u uuid) returns boolean
language sql immutable as $$
  select u in ('00000000-0000-4000-8000-00000000b001', '00000000-0000-4000-8000-00000000b002', '00000000-0000-4000-8000-00000000b003')
$$;
grant execute on function public.is_bot(uuid) to authenticated;

-- Botların eli de tutulabilsin (botlar gerçek kullanıcı değil)
alter table public.king_hands drop constraint if exists king_hands_user_id_fkey;

-- Tavla: rakip Kaptan (bot) da olabilir
create or replace function public.create_game(p_opponent uuid, p_kind text default 'tavla', p_match_to int default 5)
returns uuid language plpgsql security definer set search_path = '' as $$
declare gid uuid := public.my_group(); g uuid; starter int; st jsonb; bot boolean := public.is_bot(p_opponent);
begin
  if gid is null then raise exception 'TAYFA: Üyeliğiniz etkin değil'; end if;
  if p_kind <> 'tavla' then raise exception 'TAYFA: Bu oyun henüz hazır değil'; end if;
  if p_opponent = auth.uid() or (not bot and not exists (select 1 from public.members where group_id = gid and user_id = p_opponent and status = 'active')) then
    raise exception 'TAYFA: Rakip bulunamadı';
  end if;
  if exists (select 1 from public.games where group_id = gid and kind = p_kind and status = 'active'
             and players @> array[auth.uid(), p_opponent]) then
    raise exception 'TAYFA: Bu kişiyle zaten devam eden bir tavla maçın var';
  end if;
  starter := floor(random() * 2)::int;
  st := jsonb_build_object(
    'board', jsonb_build_array(-2,0,0,0,0,5, 0,3,0,0,0,-5, 5,0,0,0,-3,0, -5,0,0,0,0,2),
    'bar', jsonb_build_array(0,0), 'off', jsonb_build_array(0,0),
    'turn', starter, 'dice', '[]'::jsonb, 'score', jsonb_build_array(0,0), 'hand', 1);
  insert into public.games (group_id, kind, players, state, turn, match_to, created_by)
    values (gid, p_kind, array[auth.uid(), p_opponent], st,
            case when starter = 0 then auth.uid() else p_opponent end, greatest(1, least(p_match_to, 15)), auth.uid())
    returning id into g;
  if not bot then
    perform public.queue_notify(array[p_opponent], 'Tavla daveti 🎲',
      public.member_name(gid, auth.uid()) || ' seninle tavla maçı başlattı' ||
      case when starter = 1 then ', ilk zar senin' else '' end,
      './#oyun/' || g, 'tavla-' || g);
  end if;
  return g;
end $$;

-- King: 0–3 arkadaş seçilir, boş koltuklara bot oturur
create or replace function public.create_king(p_others uuid[]) returns uuid
language plpgsql security definer set search_path = '' as $$
declare gid uuid := public.my_group(); g uuid; ps uuid[]; humans uuid[]; starter int; st jsonb;
  bots uuid[] := array['00000000-0000-4000-8000-00000000b001', '00000000-0000-4000-8000-00000000b002', '00000000-0000-4000-8000-00000000b003']::uuid[];
begin
  if gid is null then raise exception 'TAYFA: Üyeliğiniz etkin değil'; end if;
  select coalesce(array_agg(distinct u), '{}') into ps from unnest(coalesce(p_others, '{}')) u where u <> auth.uid() and not public.is_bot(u);
  if cardinality(ps) > 3 then raise exception 'TAYFA: En fazla 3 kişi seçebilirsin'; end if;
  if (select count(*) from public.members where group_id = gid and status = 'active' and user_id = any(ps)) <> cardinality(ps) then
    raise exception 'TAYFA: Seçilen kişilerden biri grupta değil';
  end if;
  humans := ps;
  ps := array[auth.uid()] || ps || bots[1 : 3 - cardinality(humans)];
  starter := floor(random() * 4)::int;
  st := jsonb_build_object(
    'kind', 'king', 'hand', 1, 'chooser', starter, 'phase', 'choose', 'contract', null,
    'turn', starter, 'leader', starter, 'trick', '[]'::jsonb, 'tricksDone', 0, 'penTaken', 0, 'broken', false,
    'handPts', jsonb_build_array(0,0,0,0), 'score', jsonb_build_array(0,0,0,0), 'counts', jsonb_build_array(13,13,13,13),
    'tricksBy', jsonb_build_array(0,0,0,0),
    'picks', jsonb_build_array(jsonb_build_object('koz',0,'ceza',0), jsonb_build_object('koz',0,'ceza',0),
                               jsonb_build_object('koz',0,'ceza',0), jsonb_build_object('koz',0,'ceza',0)),
    'used', '{}'::jsonb, 'history', '[]'::jsonb, 'lastTrick', null);
  insert into public.games (group_id, kind, players, state, turn, match_to, created_by)
    values (gid, 'king', ps, st, ps[starter + 1], 20, auth.uid())
    returning id into g;
  perform public.king_deal(g, ps);
  if cardinality(humans) > 0 then
    perform public.queue_notify(humans, 'King daveti 👑',
      public.member_name(gid, auth.uid()) || ' King masası açtı',
      './#oyun/' || g, 'king-' || g);
  end if;
  if ps[starter + 1] <> auth.uid() and not public.is_bot(ps[starter + 1]) then
    perform public.queue_notify(array[ps[starter + 1]], 'King · seçim sende',
      'İlk eli sen seçeceksin', './#oyun/' || g, 'king-' || g);
  end if;
  return g;
end $$;
grant execute on function public.create_king(uuid[]) to authenticated;
grant execute on function public.create_game(uuid, text, int) to authenticated;
