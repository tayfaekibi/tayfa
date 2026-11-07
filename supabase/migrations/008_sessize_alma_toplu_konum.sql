-- =====================================================================
-- TAYFA · 3.1
-- - Sohbeti sessize al (aç/kapa) + sessizdeyken bahsedilince/yanıt verilince bildir seçeneği
-- - Seçilen fotoğraflara tek seferde konum; albüm konumunu konumsuz fotoğraflara ver
-- =====================================================================
alter table public.members add column if not exists chat_muted boolean not null default false;
alter table public.members add column if not exists chat_mute_mentions boolean not null default true;

create or replace function public.set_chat_mute(p_muted boolean, p_mentions boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.members set chat_muted = coalesce(p_muted, false), chat_mute_mentions = coalesce(p_mentions, true)
   where user_id = auth.uid() and status = 'active';
end $$;
grant execute on function public.set_chat_mute(boolean, boolean) to authenticated;

create or replace function public.messages_after_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
declare who text; targets uuid[]; direct uuid[]; replied uuid;
begin
  if new.kind = 'system' then return null; end if;
  who := public.member_name(new.group_id, new.sender);

  if new.game_id is not null then
    select coalesce(array_agg(u), '{}') into targets
      from public.games g, unnest(g.players) u
     where g.id = new.game_id and u <> new.sender;
    insert into public.notify_queue (user_ids, title, body, url, tag, inbox)
      values (targets, 'Tavla · ' || who,
              case when new.kind = 'voice' then 'Sesli mesaj gönderdi' else 'Mesaj gönderdi' end,
              './#oyun/' || new.game_id, 'oyun-sohbet-' || new.game_id, false);
    return null;
  end if;

  if new.reply_to is not null then
    select sender into replied from public.messages where id = new.reply_to;
  end if;

  -- yanıt verilen ve bahsedilen kişiler (sessizdeyse ancak "bahsedilince bildir" açıksa)
  select coalesce(array_agg(user_id), '{}') into direct from public.members
   where group_id = new.group_id and status = 'active' and user_id <> new.sender
     and chat_notify <> 'off'
     and (not chat_muted or chat_mute_mentions)
     and (user_id = any(new.mentions) or user_id = replied);
  if replied is not null and replied = any(direct) then
    insert into public.notify_queue (user_ids, title, body, url, tag, inbox)
      values (array[replied], 'Sohbet', who || ' sana yanıt verdi', './#sohbet', 'bahis-' || new.id, true);
  end if;
  if cardinality(array_remove(direct, replied)) > 0 then
    insert into public.notify_queue (user_ids, title, body, url, tag, inbox)
      values (array_remove(direct, replied), 'Sohbet', who || ' senden bahsetti', './#sohbet', 'bahis-' || new.id, true);
  end if;

  -- diğerleri: "Tümü" seçmiş ve sohbeti sessize almamış olanlar
  select coalesce(array_agg(user_id), '{}') into targets from public.members
   where group_id = new.group_id and status = 'active' and user_id <> new.sender
     and chat_notify = 'all' and not chat_muted
     and not (user_id = any(new.mentions)) and user_id is distinct from replied;
  if cardinality(targets) > 0 then
    insert into public.notify_queue (user_ids, title, body, url, tag, inbox)
      values (targets, 'Sohbet',
              case when new.kind = 'voice' then who || ' sesli mesaj gönderdi' else who || ' yeni mesaj gönderdi' end,
              './#sohbet', 'sohbet-' || new.group_id, false);
  end if;
  return null;
end $$;

-- ---------------------------------------------------------------- toplu konum
create or replace function public.set_photos_location(p_photos uuid[], p_lat double precision, p_lng double precision) returns int
language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  update public.photos set lat = p_lat, lng = p_lng
   where id = any(p_photos) and public.is_admin(group_id);
  get diagnostics n = row_count;
  if n = 0 then raise exception 'TAYFA: Yetki yok'; end if;
  return n;
end $$;
grant execute on function public.set_photos_location(uuid[], double precision, double precision) to authenticated;

-- Albümün konumunu, konumu OLMAYAN fotoğraflarına ver (konumu olanlara dokunmaz)
create or replace function public.album_location_to_photos(p_album uuid) returns int
language plpgsql security definer set search_path = '' as $$
declare a public.albums; n int;
begin
  select * into a from public.albums where id = p_album;
  if not found or not public.is_admin(a.group_id) then raise exception 'TAYFA: Yetki yok'; end if;
  if a.lat is null then raise exception 'TAYFA: Önce albüme konum ver'; end if;
  update public.photos set lat = a.lat, lng = a.lng where album_id = a.id and lat is null;
  get diagnostics n = row_count;
  return n;
end $$;
grant execute on function public.album_location_to_photos(uuid) to authenticated;
