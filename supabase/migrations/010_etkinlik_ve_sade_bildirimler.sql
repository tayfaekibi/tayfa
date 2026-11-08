-- =====================================================================
-- TAYFA · 3.3
-- - "Plan" yerine "Etkinlik"
-- - Bildirim kutusu sade: etkinlikler, oyun davetleri, senden bahsedilenler/yanıtlar, yeni fotoğraflar, üyelik
--   (her hamledeki "sıra sende", oyun bitti ve yorumlar kutuya yazılmaz; telefona yine gelir). 1 gün saklanır.
-- - Yeni fotoğraf bildirimi ve sohbet kartı doğrudan yeni fotoğrafları açar
-- =====================================================================
create or replace function public.notify_queue_to_inbox() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.inbox and (
       new.tag is null
       or new.tag like 'plan-%' or new.tag like 'onay-%' or new.tag like 'bahis-%'
       or new.tag like 'album-%' or new.tag like 'tek-%'
       or new.title like '%daveti%') then
    insert into public.inbox (user_id, title, body, url, tag)
      select distinct u, new.title, new.body, coalesce(new.url, './'), new.tag from unnest(new.user_ids) u;
  end if;
  return null;
end $$;

create or replace function public.propose_event(p_title text, p_place text, p_note text, p_starts_at timestamptz)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  gid uuid := public.my_group();
  adm boolean;
  eid uuid;
  who text;
begin
  if gid is null then raise exception 'TAYFA: Üyeliğiniz etkin değil'; end if;
  if p_starts_at is null or p_starts_at < now() - interval '1 hour' then
    raise exception 'TAYFA: Geçmiş bir tarih seçilemez';
  end if;
  adm := public.is_admin(gid);
  who := public.member_name(gid, auth.uid());
  insert into public.events (group_id, created_by, title, place, note, starts_at, status, decided_at)
    values (gid, auth.uid(), trim(p_title), nullif(trim(p_place), ''), nullif(trim(p_note), ''),
            p_starts_at, case when adm then 'approved' else 'pending' end,
            case when adm then now() end)
    returning id into eid;
  if adm then
    perform public.queue_notify(public.group_users(gid, auth.uid()),
      'Yeni etkinlik: ' || trim(p_title), public.tr_date(p_starts_at) || coalesce(' · ' || nullif(trim(p_place), ''), ''),
      './#plan/' || eid, 'plan-' || eid);
  else
    perform public.queue_notify(public.group_admins(gid),
      'Onay bekleyen etkinlik', who || ' önerdi: ' || trim(p_title), './#yonetim', 'onay-' || eid);
  end if;
  return eid;
end $$;

create or replace function public.decide_event(p_event uuid, p_ok boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare e public.events;
begin
  select * into e from public.events where id = p_event for update;
  if not found or not public.is_admin(e.group_id) then raise exception 'TAYFA: Yetki yok'; end if;
  if e.status <> 'pending' then return; end if;
  update public.events set status = case when p_ok then 'approved' else 'rejected' end, decided_at = now()
    where id = p_event;
  if p_ok then
    perform public.queue_notify(public.group_users(e.group_id, auth.uid()),
      'Yeni etkinlik: ' || e.title, public.tr_date(e.starts_at) || coalesce(' · ' || e.place, ''),
      './#plan/' || e.id, 'plan-' || e.id);
  elsif e.created_by is not null and e.created_by <> auth.uid() then
    perform public.queue_notify(array[e.created_by], 'Etkinlik onaylanmadı', e.title, './', 'plan-' || e.id);
  end if;
end $$;

create or replace function public.run_reminders() returns void
language plpgsql security definer set search_path = '' as $$
declare e record; yes uuid[];
begin
  for e in
    update public.events set reminder_sent = true
    where status = 'pending' and reminder_sent = false and created_at <= now() - interval '5 minutes'
    returning id, group_id, created_by, title
  loop
    perform public.queue_notify(public.group_admins(e.group_id),
      'Hatırlatma: onay bekleyen etkinlik',
      public.member_name(e.group_id, e.created_by) || ' önerdi: ' || e.title, './#yonetim', 'onay-' || e.id);
  end loop;

  -- Plandan yaklaşık 1 saat önce "geliyorum" diyenlere tek hatırlatma
  for e in
    update public.events set soon_sent = true
    where status = 'approved' and soon_sent = false
      and starts_at > now() and starts_at <= now() + interval '60 minutes'
    returning id, group_id, title, place, starts_at
  loop
    select coalesce(array_agg(user_id), '{}') into yes from public.rsvps where event_id = e.id and answer = 'yes';
    perform public.queue_notify(yes, 'Birazdan: ' || e.title,
      to_char(e.starts_at at time zone 'Europe/Istanbul', 'HH24:MI') || coalesce(' · ' || e.place, ''),
      './#plan/' || e.id, 'plan-' || e.id);
  end loop;

  if exists (select 1 from public.notify_queue
             where sent_at is null
               and created_at < now() - interval '1 minute'
               and created_at > now() - interval '1 hour') then
    perform public.ping_push();
  end if;

  delete from public.notify_queue where created_at < now() - interval '30 days';
  delete from public.inbox where created_at < now() - interval '1 day';
end $$;

-- Yükleme bitince: bildirim ve sohbet kartı yeni fotoğrafları doğrudan açsın
create or replace function public.finish_album_upload(p_album uuid, p_added int) returns void
language plpgsql security definer set search_path = '' as $$
declare a public.albums; who text; ids uuid[]; thumbs text[]; ts bigint := extract(epoch from now())::bigint; u text;
begin
  select * into a from public.albums where id = p_album;
  if not found or not public.is_admin(a.group_id) then raise exception 'TAYFA: Yetki yok'; end if;
  if coalesce(p_added, 0) <= 0 then return; end if;
  who := public.member_name(a.group_id, auth.uid());
  select coalesce(array_agg(id order by created_at), '{}'), coalesce(array_agg(thumb_path order by created_at), '{}')
    into ids, thumbs
    from (select id, thumb_path, created_at from public.photos where album_id = a.id order by created_at desc limit p_added) x;
  u := './#yeni/' || a.id || '/' || p_added || '/' || ts;
  if a.is_loose then
    perform public.queue_notify(public.group_users(a.group_id, auth.uid()),
      'Yeni anılar 📍', who || ' ' || p_added || ' yeni fotoğraf ekledi', u, 'tek-' || a.group_id);
  else
    perform public.queue_notify(public.group_users(a.group_id, auth.uid()),
      'Yeni anılar 📍', who || ', ' || a.title || ' albümüne ' || p_added || ' fotoğraf ekledi', u, 'album-' || a.id);
  end if;
  perform public.post_system(a.group_id, jsonb_build_object(
    'type', 'album', 'album_id', a.id, 'title', a.title, 'count', p_added, 'loose', a.is_loose,
    'ts', ts, 'photos', to_jsonb(ids[1:24]), 'thumbs', to_jsonb(thumbs[1:4])));
end $$;

-- Eski bildirimleri temizle (artık 1 gün)
delete from public.inbox where created_at < now() - interval '1 day';
delete from public.inbox where tag like 'tavla-%' and title not like '%daveti%';
delete from public.inbox where tag like 'king-%' and title not like '%daveti%';
delete from public.inbox where tag like 'yorum-%';
