-- =====================================================================
-- TAYFA · 3.0
-- - Bildirim kutusu: telefona giden her bildirim (genel sohbet hariç) kişinin
--   kutusuna da yazılır; uygulama içinden açılır, iPhone'un bildirim hatalarından etkilenmez
-- - Sohbet: yanıt verilen kişiye ve @bahsedilene ayrı bildirim; sabitlenmiş mesaj
-- - Plan: konum (hava durumu için), 1 saat önce gelenlere hatırlatma
-- - Anılar: "geçen yıl bugün"
-- =====================================================================

-- ---------------------------------------------------------------- bildirim kutusu
alter table public.notify_queue add column if not exists inbox boolean not null default true;

create table if not exists public.inbox (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references auth.users(id) on delete cascade,
  title       text not null,
  body        text not null,
  url         text,
  tag         text,
  created_at  timestamptz not null default now(),
  read_at     timestamptz
);
create index if not exists inbox_user_idx on public.inbox (user_id, created_at desc);
alter table public.inbox enable row level security;
grant select on public.inbox to authenticated;
grant all on public.inbox to service_role;

drop policy if exists "kendi bildirimlerini gorur" on public.inbox;
create policy "kendi bildirimlerini gorur" on public.inbox for select to authenticated
  using (user_id = auth.uid());

create or replace function public.queue_notify(uids uuid[], p_title text, p_body text, p_url text default './', p_tag text default null)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if uids is null or cardinality(uids) = 0 then return; end if;
  insert into public.notify_queue (user_ids, title, body, url, tag) values (uids, p_title, p_body, p_url, p_tag);
end $$;

-- Kuyruğa düşen her bildirimi (inbox = true ise) kişilerin kutusuna yaz
create or replace function public.notify_queue_to_inbox() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.inbox then
    insert into public.inbox (user_id, title, body, url, tag)
      select distinct u, new.title, new.body, coalesce(new.url, './'), new.tag from unnest(new.user_ids) u;
  end if;
  return null;
end $$;
drop trigger if exists tayfa_notify_queue_inbox on public.notify_queue;
create trigger tayfa_notify_queue_inbox
  after insert on public.notify_queue
  for each row execute function public.notify_queue_to_inbox();

create or replace function public.mark_inbox_read(p_id bigint default null) returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.inbox set read_at = now()
   where user_id = auth.uid() and read_at is null and (p_id is null or id = p_id);
end $$;
grant execute on function public.mark_inbox_read(bigint) to authenticated;

-- ---------------------------------------------------------------- sohbet bildirimleri
-- Genel sohbet: herkese giden bildirim kutuya yazılmaz (sohbet sekmesi zaten sayıyı gösterir).
-- Yanıt verilen ve @bahsedilen kişiye ayrı bildirim gider; bu, oyun oynarken de gelir ve kutuya yazılır.
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

  -- yanıt verilen ve bahsedilen (sohbeti kapatmamış) kişiler
  select coalesce(array_agg(user_id), '{}') into direct from public.members
   where group_id = new.group_id and status = 'active' and user_id <> new.sender
     and chat_notify <> 'off'
     and (user_id = any(new.mentions) or user_id = replied);
  if replied is not null and replied = any(direct) then
    insert into public.notify_queue (user_ids, title, body, url, tag, inbox)
      values (array[replied], 'Sohbet', who || ' sana yanıt verdi', './#sohbet', 'bahis-' || new.id, true);
  end if;
  if cardinality(array_remove(direct, replied)) > 0 then
    insert into public.notify_queue (user_ids, title, body, url, tag, inbox)
      values (array_remove(direct, replied), 'Sohbet', who || ' senden bahsetti', './#sohbet', 'bahis-' || new.id, true);
  end if;

  -- diğerleri: "Tümü" seçenler
  select coalesce(array_agg(user_id), '{}') into targets from public.members
   where group_id = new.group_id and status = 'active' and user_id <> new.sender
     and chat_notify = 'all' and not (user_id = any(direct));
  if cardinality(targets) > 0 then
    insert into public.notify_queue (user_ids, title, body, url, tag, inbox)
      values (targets, 'Sohbet',
              case when new.kind = 'voice' then who || ' sesli mesaj gönderdi' else who || ' yeni mesaj gönderdi' end,
              './#sohbet', 'sohbet-' || new.group_id, false);
  end if;
  return null;
end $$;

-- ---------------------------------------------------------------- sabitlenmiş mesaj
alter table public.groups add column if not exists pinned_message uuid references public.messages(id) on delete set null;
alter table public.groups add column if not exists pinned_by uuid references auth.users(id) on delete set null;

create or replace function public.pin_message(p_message uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare gid uuid := public.my_group();
begin
  if gid is null then raise exception 'TAYFA: Üyeliğiniz etkin değil'; end if;
  if p_message is not null and not exists (
       select 1 from public.messages where id = p_message and group_id = gid and game_id is null and kind in ('text','voice')) then
    raise exception 'TAYFA: Bu mesaj sabitlenemez';
  end if;
  update public.groups set pinned_message = p_message, pinned_by = case when p_message is null then null else auth.uid() end
   where id = gid;
end $$;
grant execute on function public.pin_message(uuid) to authenticated;

create or replace function public.chat_pin() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('message', g.pinned_message, 'by', g.pinned_by)
    from public.groups g where g.id = public.my_group();
$$;
grant execute on function public.chat_pin() to authenticated;

-- ---------------------------------------------------------------- plan konumu ve hatırlatma
alter table public.events add column if not exists lat double precision;
alter table public.events add column if not exists lng double precision;
alter table public.events add column if not exists soon_sent boolean not null default false;

drop function if exists public.propose_event(text, text, text, timestamptz, double precision, double precision);
create or replace function public.propose_event(p_title text, p_place text, p_note text, p_starts_at timestamptz,
                                                p_lat double precision, p_lng double precision)
returns uuid language plpgsql security definer set search_path = '' as $$
declare eid uuid;
begin
  eid := public.propose_event(p_title, p_place, p_note, p_starts_at);
  if p_lat is not null and p_lng is not null then
    update public.events set lat = p_lat, lng = p_lng where id = eid;
  end if;
  return eid;
end $$;
grant execute on function public.propose_event(text, text, text, timestamptz, double precision, double precision) to authenticated;

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
      'Hatırlatma: onay bekleyen plan',
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
  delete from public.inbox where created_at < now() - interval '30 days';
end $$;

-- ---------------------------------------------------------------- geçen yıl bugün
create or replace function public.on_this_day() returns setof jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('id', p.id, 'album_id', p.album_id, 'path', p.path, 'thumb_path', p.thumb_path,
                            'taken_at', p.taken_at, 'album', a.title, 'is_loose', a.is_loose, 'place', a.place)
    from public.photos p join public.albums a on a.id = p.album_id
   where p.group_id = public.my_group()
     and p.taken_at is not null
     and to_char(p.taken_at at time zone 'Europe/Istanbul', 'MM-DD') = to_char(now() at time zone 'Europe/Istanbul', 'MM-DD')
     and extract(year from p.taken_at at time zone 'Europe/Istanbul') < extract(year from now() at time zone 'Europe/Istanbul')
   order by p.taken_at desc
   limit 24;
$$;
grant execute on function public.on_this_day() to authenticated;

-- ---------------------------------------------------------------- canlı güncellemeler
do $$
declare t text;
begin
  foreach t in array array['inbox'] loop
    begin execute format('alter publication supabase_realtime add table public.%I', t); exception when others then null; end;
  end loop;
end $$;
