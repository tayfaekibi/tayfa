-- =====================================================================
-- TAYFA · 2.3: Bildirime dokununca ilgili plana gidilsin
-- =====================================================================
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
      'Yeni plan: ' || trim(p_title), public.tr_date(p_starts_at) || coalesce(' · ' || nullif(trim(p_place), ''), ''),
      './#plan/' || eid, 'plan-' || eid);
  else
    perform public.queue_notify(public.group_admins(gid),
      'Onay bekleyen plan', who || ' önerdi: ' || trim(p_title), './#yonetim', 'onay-' || eid);
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
      'Yeni plan: ' || e.title, public.tr_date(e.starts_at) || coalesce(' · ' || e.place, ''),
      './#plan/' || e.id, 'plan-' || e.id);
  elsif e.created_by is not null and e.created_by <> auth.uid() then
    perform public.queue_notify(array[e.created_by], 'Plan onaylanmadı', e.title, './', 'plan-' || e.id);
  end if;
end $$;

-- Hatırlatma da aynı bildirimin yerine geçsin (aynı etiket)
create or replace function public.run_reminders() returns void
language plpgsql security definer set search_path = '' as $$
declare e record;
begin
  for e in
    update public.events set reminder_sent = true
    where status = 'pending' and reminder_sent = false and created_at <= now() - interval '5 minutes'
    returning id, group_id, created_by, title
  loop
    perform public.queue_notify(public.group_admins(e.group_id),
      'Hatırlatma: onay bekleyen plan',
      public.member_name(e.group_id, e.created_by) || ' önerdi: ' || e.title, './#yonetim', 'onay-' || e.id);
  end loop;

  if exists (select 1 from public.notify_queue
             where sent_at is null
               and created_at < now() - interval '1 minute'
               and created_at > now() - interval '1 hour') then
    perform public.ping_push();
  end if;

  delete from public.notify_queue where created_at < now() - interval '30 days';
end $$;

create or replace function public.add_comment(p_type text, p_target uuid, p_body text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare gid uuid; cid uuid; owner uuid; ttl text;
begin
  if p_type = 'event' then
    select group_id, created_by, title into gid, owner, ttl from public.events where id = p_target and status = 'approved';
  elsif p_type = 'album' then
    select group_id, created_by, title into gid, owner, ttl from public.albums where id = p_target;
  end if;
  if gid is null or not public.is_member(gid) then raise exception 'TAYFA: Yorum yapılamaz'; end if;
  if char_length(trim(coalesce(p_body, ''))) = 0 then raise exception 'TAYFA: Boş yorum gönderilemez'; end if;
  insert into public.comments (group_id, target_type, target_id, user_id, body)
    values (gid, p_type, p_target, auth.uid(), left(trim(p_body), 1000)) returning id into cid;
  perform public.queue_notify(
    (select coalesce(array_agg(distinct u), '{}') from (
       select owner as u union select user_id from public.comments
       where target_type = p_type and target_id = p_target) x
     where u is not null and u <> auth.uid()),
    ttl, public.member_name(gid, auth.uid()) || ': ' || left(trim(p_body), 80),
    case when p_type = 'event' then './#plan/' || p_target else './#album/' || p_target end, 'yorum-' || p_target);
  return cid;
end $$;
