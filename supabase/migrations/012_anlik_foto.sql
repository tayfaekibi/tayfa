-- 012: Genel sohbette anlık foto
-- Fotoğraf şifreli olarak 'chat' kovasına konur (audio_path / audio_iv alanları kullanılır).
-- Her üye bir kez açar (10 sn). Gönderen dışındaki herkes açınca ya da 24 saat dolunca dosya silinir.

alter table public.messages drop constraint if exists messages_kind_check;
alter table public.messages add constraint messages_kind_check check (kind in ('text','voice','system','snap'));

drop policy if exists "uye mesaj gonderir" on public.messages;
create policy "uye mesaj gonderir" on public.messages for insert to authenticated
  with check (sender = auth.uid() and public.is_member(group_id) and payload is null
              and (kind in ('text','voice') or (kind = 'snap' and game_id is null and audio_path is not null))
              and (game_id is null or (public.is_player(game_id)
                   and exists (select 1 from public.games g where g.id = game_id and g.group_id = messages.group_id))));

create table if not exists public.snap_views (
  message_id uuid not null references public.messages(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  opened_at  timestamptz not null default now(),
  primary key (message_id, user_id)
);
alter table public.snap_views enable row level security;
drop policy if exists "uye anlik gorur" on public.snap_views;
create policy "uye anlik gorur" on public.snap_views for select to authenticated
  using (exists (select 1 from public.messages m where m.id = message_id and public.is_member(m.group_id)));
grant select on public.snap_views to authenticated;

do $$ begin
  begin execute 'alter publication supabase_realtime add table public.snap_views'; exception when others then null; end;
end $$;

-- Herkes açtı mı ya da süresi doldu mu
create or replace function public.snap_done(p_message uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select m.created_at < now() - interval '24 hours'
      or (select count(*) from public.snap_views v where v.message_id = m.id)
         >= (select count(*) from public.members x where x.group_id = m.group_id and x.status = 'active' and x.user_id <> m.sender)
    from public.messages m where m.id = p_message and m.kind = 'snap'
$$;

-- Aç: sadece bir kere. true dönerse fotoğraf gösterilebilir.
create or replace function public.open_snap(p_message uuid) returns boolean
language plpgsql security definer set search_path = '' as $$
declare m public.messages; n int;
begin
  select * into m from public.messages where id = p_message and kind = 'snap';
  if not found or not public.is_member(m.group_id) then raise exception 'TAYFA: Yetki yok'; end if;
  if m.sender = auth.uid() then raise exception 'TAYFA: Kendi anlık fotoğrafını açamazsın'; end if;
  if m.audio_path is null or m.created_at < now() - interval '24 hours' then return false; end if;
  insert into public.snap_views (message_id, user_id) values (p_message, auth.uid()) on conflict do nothing;
  get diagnostics n = row_count;
  return n = 1;
end $$;

-- Bitti ise dosya yolunu bırak (istemci dosyayı siler). Bitmediyse null.
create or replace function public.snap_try_finish(p_message uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare m public.messages;
begin
  select * into m from public.messages where id = p_message and kind = 'snap' for update;
  if not found or not public.is_member(m.group_id) then return null; end if;
  if m.audio_path is null then return m.payload->>'gone'; end if;
  if not public.snap_done(p_message) then return null; end if;
  update public.messages set payload = jsonb_build_object('gone', m.audio_path), audio_path = null where id = p_message;
  return m.audio_path;
end $$;

grant execute on function public.snap_done(uuid), public.open_snap(uuid), public.snap_try_finish(uuid) to authenticated;

-- Biten anlık fotoğrafın dosyasını her üye silebilsin
drop policy if exists "tayfa anlik silme" on storage.objects;
create policy "tayfa anlik silme" on storage.objects for delete to authenticated
  using (bucket_id = 'chat' and exists (
    select 1 from public.messages m
     where m.kind = 'snap' and m.payload->>'gone' = storage.objects.name and public.is_member(m.group_id)));

-- Bildirim metni
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
                   when new.kind = 'snap' then who || ' anlık foto gönderdi 📸'
                   else who || ' yeni mesaj gönderdi' end,
              './#sohbet', 'sohbet-' || new.group_id, false);
  end if;
  return null;
end $$;
