-- =====================================================================
-- TAYFA · 2.4: Oyun içi sohbet (sadece o maçın oyuncuları görür)
-- =====================================================================
alter table public.messages add column if not exists game_id uuid references public.games(id) on delete cascade;
create index if not exists messages_game_idx on public.messages (game_id, created_at) where game_id is not null;

create or replace function public.is_player(gid uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.games g where g.id = gid and auth.uid() = any(g.players));
$$;
grant execute on function public.is_player(uuid) to authenticated;

drop policy if exists "uye mesajlari gorur" on public.messages;
create policy "uye mesajlari gorur" on public.messages for select to authenticated
  using (public.is_member(group_id) and (game_id is null or public.is_player(game_id)));

drop policy if exists "uye mesaj gonderir" on public.messages;
create policy "uye mesaj gonderir" on public.messages for insert to authenticated
  with check (sender = auth.uid() and public.is_member(group_id) and kind in ('text','voice') and payload is null
              and (game_id is null or (public.is_player(game_id)
                   and exists (select 1 from public.games g where g.id = game_id and g.group_id = messages.group_id))));

create or replace function public.messages_after_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
declare who text; targets uuid[];
begin
  if new.kind = 'system' then return null; end if;
  who := public.member_name(new.group_id, new.sender);

  if new.game_id is not null then
    select coalesce(array_agg(u), '{}') into targets
      from public.games g, unnest(g.players) u
     where g.id = new.game_id and u <> new.sender;
    perform public.queue_notify(targets, 'Tavla · ' || who,
      case when new.kind = 'voice' then 'Sesli mesaj gönderdi' else 'Mesaj gönderdi' end,
      './#oyun/' || new.game_id, 'oyun-sohbet-' || new.game_id);
    return null;
  end if;

  select coalesce(array_agg(user_id), '{}') into targets from public.members
   where group_id = new.group_id and status = 'active' and user_id <> new.sender
     and (chat_notify = 'all' or (chat_notify = 'mentions' and user_id = any(new.mentions)));
  perform public.queue_notify(targets, 'Sohbet',
    case when new.kind = 'voice' then who || ' sesli mesaj gönderdi'
         when cardinality(new.mentions) > 0 then who || ' senden bahsetti'
         else who || ' yeni mesaj gönderdi' end,
    './#sohbet', 'sohbet-' || new.group_id);
  return null;
end $$;
