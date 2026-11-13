-- 015: Bildirimde 'Anlık' adı
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

  select coalesce(array_agg(user_id), '{}') into targets from public.members
   where group_id = new.group_id and status = 'active' and user_id <> new.sender
     and chat_notify = 'all' and not chat_muted
     and not (user_id = any(new.mentions)) and user_id is distinct from replied;
  if cardinality(targets) > 0 then
    insert into public.notify_queue (user_ids, title, body, url, tag, inbox)
      values (targets, 'Sohbet',
              case when new.kind = 'voice' then who || ' sesli mesaj gönderdi'
                   when new.kind = 'snap' then who || ' anlık gönderdi 📸'
                   else who || ' yeni mesaj gönderdi' end,
              './#sohbet', 'sohbet-' || new.group_id, false);
  end if;
  return null;
end $$;
