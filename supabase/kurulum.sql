-- =====================================================================
-- TAYFA · Sürüm 1 veritabanı kurulumu
-- Supabase > SQL Editor'e tamamını yapıştırıp "Run" deyin.
-- Birden fazla kez çalıştırılabilir; var olan verilere dokunmaz.
-- =====================================================================

create extension if not exists pgcrypto with schema extensions;
create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron with schema pg_catalog;

-- ---------------------------------------------------------------------
-- Tablolar
-- ---------------------------------------------------------------------
create table if not exists public.groups (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(name) between 1 and 60),
  created_at  timestamptz not null default now()
);

create table if not exists public.members (
  group_id      uuid not null references public.groups(id) on delete cascade,
  user_id       uuid not null references auth.users(id) on delete cascade,
  display_name  text not null check (char_length(display_name) between 1 and 40),
  role          text not null default 'member' check (role in ('admin','member')),
  status        text not null default 'pending' check (status in ('pending','active','removed')),
  created_at    timestamptz not null default now(),
  approved_at   timestamptz,
  primary key (group_id, user_id)
);

create table if not exists public.invites (
  code        text primary key,
  group_id    uuid not null references public.groups(id) on delete cascade,
  email       text not null,
  created_by  uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null default now() + interval '48 hours',
  used_at     timestamptz,
  used_by     uuid references auth.users(id) on delete set null
);

create table if not exists public.consents (
  id             bigint generated always as identity primary key,
  user_id        uuid not null references auth.users(id) on delete cascade,
  version        text not null,
  aydinlatma     boolean not null,
  riza_foto      boolean not null,
  riza_yurtdisi  boolean not null,
  created_at     timestamptz not null default now()
);

create table if not exists public.events (
  id             uuid primary key default gen_random_uuid(),
  group_id       uuid not null references public.groups(id) on delete cascade,
  created_by     uuid references auth.users(id) on delete set null,
  title          text not null check (char_length(title) between 1 and 80),
  place          text check (char_length(place) <= 80),
  note           text check (char_length(note) <= 500),
  starts_at      timestamptz not null,
  status         text not null default 'pending' check (status in ('pending','approved','rejected')),
  created_at     timestamptz not null default now(),
  decided_at     timestamptz,
  reminder_sent  boolean not null default false
);
create index if not exists events_group_idx on public.events (group_id, starts_at);

create table if not exists public.rsvps (
  event_id    uuid not null references public.events(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  answer      text not null check (answer in ('yes','no')),
  updated_at  timestamptz not null default now(),
  primary key (event_id, user_id)
);

create table if not exists public.push_subscriptions (
  endpoint    text primary key,
  user_id     uuid not null references auth.users(id) on delete cascade,
  p256dh      text not null,
  auth        text not null,
  created_at  timestamptz not null default now()
);

-- Bildirim kuyruğu: veritabanı buraya yazar, "push" fonksiyonu gönderir.
create table if not exists public.notify_queue (
  id          bigint generated always as identity primary key,
  user_ids    uuid[] not null,
  title       text not null,
  body        text not null,
  url         text,
  created_at  timestamptz not null default now(),
  sent_at     timestamptz
);

alter table public.groups             enable row level security;
alter table public.members            enable row level security;
alter table public.invites            enable row level security;
alter table public.consents           enable row level security;
alter table public.events             enable row level security;
alter table public.rsvps              enable row level security;
alter table public.push_subscriptions enable row level security;
alter table public.notify_queue       enable row level security;

-- ---------------------------------------------------------------------
-- Yardımcı fonksiyonlar
-- ---------------------------------------------------------------------
create or replace function public.is_member(gid uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.members
                 where group_id = gid and user_id = auth.uid() and status = 'active');
$$;

create or replace function public.is_admin(gid uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.members
                 where group_id = gid and user_id = auth.uid() and status = 'active' and role = 'admin');
$$;

-- Kullanıcının etkin grubu (şimdilik ilk grubu)
create or replace function public.my_group() returns uuid
language sql stable security definer set search_path = '' as $$
  select group_id from public.members
  where user_id = auth.uid() and status = 'active'
  order by created_at limit 1;
$$;

create or replace function public.member_name(gid uuid, uid uuid) returns text
language sql stable security definer set search_path = '' as $$
  select coalesce((select display_name from public.members where group_id = gid and user_id = uid), 'Bir üye');
$$;

create or replace function public.group_admins(gid uuid) returns uuid[]
language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(user_id), '{}') from public.members
  where group_id = gid and status = 'active' and role = 'admin';
$$;

create or replace function public.group_users(gid uuid, except_uid uuid default null) returns uuid[]
language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(user_id), '{}') from public.members
  where group_id = gid and status = 'active' and user_id is distinct from except_uid;
$$;

create or replace function public.queue_notify(uids uuid[], p_title text, p_body text, p_url text default './')
returns void language plpgsql security definer set search_path = '' as $$
begin
  if uids is null or cardinality(uids) = 0 then return; end if;
  insert into public.notify_queue (user_ids, title, body, url) values (uids, p_title, p_body, p_url);
end $$;

create or replace function public.tr_date(ts timestamptz) returns text
language sql immutable set search_path = '' as $$
  select to_char(ts at time zone 'Europe/Istanbul', 'DD.MM.YYYY HH24:MI');
$$;

-- ---------------------------------------------------------------------
-- Kayıt: davet kodu kontrolü (kayıttan önce uygulama sorar)
-- ---------------------------------------------------------------------
create or replace function public.setup_needed() returns boolean
language sql stable security definer set search_path = '' as $$
  select not exists (select 1 from public.groups);
$$;

create or replace function public.check_invite(p_code text, p_email text) returns text
language plpgsql stable security definer set search_path = '' as $$
declare inv public.invites;
begin
  select * into inv from public.invites where code = upper(trim(p_code));
  if not found then return 'gecersiz'; end if;
  if inv.used_at is not null then return 'kullanilmis'; end if;
  if inv.expires_at < now() then return 'suresi_dolmus'; end if;
  if lower(inv.email) <> lower(trim(p_email)) then return 'eposta'; end if;
  return 'ok';
end $$;

-- Yeni hesap açıldığında: davet kodunu doğrula, üyeliği "onay bekliyor" olarak aç.
-- İlk kurulumda (hiç grup yoksa) kayıt olan kişi grubu kurar ve yönetici olur.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  meta     jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  v_name   text  := left(trim(coalesce(meta->>'display_name', '')), 40);
  v_code   text  := upper(trim(coalesce(meta->>'invite_code', '')));
  v_group  text  := left(trim(coalesce(meta->>'group_name', '')), 60);
  v_ayd    boolean := coalesce((meta->>'aydinlatma')::boolean, false);
  v_foto   boolean := coalesce((meta->>'riza_foto')::boolean, false);
  v_yd     boolean := coalesce((meta->>'riza_yurtdisi')::boolean, false);
  inv      public.invites;
  gid      uuid;
begin
  if v_name = '' then raise exception 'TAYFA: Ad gerekli'; end if;
  if not v_ayd then raise exception 'TAYFA: Aydınlatma metni onayı gerekli'; end if;

  if v_code <> '' then
    select * into inv from public.invites where code = v_code for update;
    if not found then raise exception 'TAYFA: Davet kodu geçersiz'; end if;
    if inv.used_at is not null then raise exception 'TAYFA: Davet kodu kullanılmış'; end if;
    if inv.expires_at < now() then raise exception 'TAYFA: Davet kodunun süresi dolmuş'; end if;
    if lower(inv.email) <> lower(new.email) then raise exception 'TAYFA: Davet kodu bu e-posta için değil'; end if;

    update public.invites set used_at = now(), used_by = new.id where code = v_code;
    insert into public.members (group_id, user_id, display_name, role, status)
      values (inv.group_id, new.id, v_name, 'member', 'pending');
    perform public.queue_notify(public.group_admins(inv.group_id),
      'Yeni üye onay bekliyor', v_name || ' gruba katılmak istiyor.', './#yonetim');

  elsif v_group <> '' and not exists (select 1 from public.groups) then
    insert into public.groups (name) values (v_group) returning id into gid;
    insert into public.members (group_id, user_id, display_name, role, status, approved_at)
      values (gid, new.id, v_name, 'admin', 'active', now());
  else
    raise exception 'TAYFA: Davet kodu gerekli';
  end if;

  insert into public.consents (user_id, version, aydinlatma, riza_foto, riza_yurtdisi)
    values (new.id, 'v1', v_ayd, v_foto, v_yd);
  return new;
end $$;

drop trigger if exists tayfa_on_auth_user_created on auth.users;
create trigger tayfa_on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------
-- Uygulamanın kullandığı işlemler
-- ---------------------------------------------------------------------

-- Giriş yapan kişinin durumu (onay bekleyen kişi de görebilir)
create or replace function public.my_context() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce((
    select jsonb_build_object(
      'group_id', m.group_id, 'group_name', g.name, 'role', m.role,
      'status', m.status, 'display_name', m.display_name)
    from public.members m join public.groups g on g.id = m.group_id
    where m.user_id = auth.uid() and m.status <> 'removed'
    order by (m.status = 'active') desc, m.created_at
    limit 1), '{}'::jsonb);
$$;

create or replace function public.create_invite(p_email text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  gid uuid := public.my_group();
  alphabet text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  b bytea; c text; i int;
  inv public.invites;
begin
  if gid is null or not public.is_admin(gid) then raise exception 'TAYFA: Yetki yok'; end if;
  if p_email is null or position('@' in p_email) < 2 then raise exception 'TAYFA: Geçerli bir e-posta yazın'; end if;
  loop
    b := extensions.gen_random_bytes(8);
    c := '';
    for i in 0..7 loop
      c := c || substr(alphabet, (get_byte(b, i) % length(alphabet)) + 1, 1);
    end loop;
    c := 'TAYFA-' || left(c, 4) || '-' || right(c, 4);
    exit when not exists (select 1 from public.invites where code = c);
  end loop;
  insert into public.invites (code, group_id, email, created_by)
    values (c, gid, lower(trim(p_email)), auth.uid()) returning * into inv;
  return jsonb_build_object('code', inv.code, 'email', inv.email, 'expires_at', inv.expires_at);
end $$;

create or replace function public.list_invites() returns setof jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('code', code, 'email', email, 'expires_at', expires_at, 'used_at', used_at)
  from public.invites
  where group_id = public.my_group() and public.is_admin(group_id)
    and (used_at is null and expires_at > now())
  order by created_at desc;
$$;

create or replace function public.cancel_invite(p_code text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  delete from public.invites
  where code = p_code and used_at is null and public.is_admin(group_id);
end $$;

create or replace function public.decide_member(p_user uuid, p_ok boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare gid uuid := public.my_group();
begin
  if gid is null or not public.is_admin(gid) then raise exception 'TAYFA: Yetki yok'; end if;
  if p_ok then
    update public.members set status = 'active', approved_at = now()
      where group_id = gid and user_id = p_user and status = 'pending';
    if found then
      perform public.queue_notify(array[p_user], 'Tayfaya hoş geldin', 'Üyeliğin onaylandı, uygulamayı açabilirsin.', './');
    end if;
  else
    update public.members set status = 'removed'
      where group_id = gid and user_id = p_user and status = 'pending';
  end if;
end $$;

create or replace function public.remove_member(p_user uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare gid uuid := public.my_group();
begin
  if gid is null or not public.is_admin(gid) then raise exception 'TAYFA: Yetki yok'; end if;
  if p_user = auth.uid() then raise exception 'TAYFA: Kendinizi çıkaramazsınız'; end if;
  update public.members set status = 'removed' where group_id = gid and user_id = p_user;
  delete from public.push_subscriptions where user_id = p_user;
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
      'Yeni plan: ' || trim(p_title), public.tr_date(p_starts_at) || coalesce(' · ' || nullif(trim(p_place), ''), ''), './');
  else
    perform public.queue_notify(public.group_admins(gid),
      'Onay bekleyen plan', who || ' önerdi: ' || trim(p_title), './#yonetim');
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
      'Yeni plan: ' || e.title, public.tr_date(e.starts_at) || coalesce(' · ' || e.place, ''), './');
  elsif e.created_by is not null and e.created_by <> auth.uid() then
    perform public.queue_notify(array[e.created_by], 'Plan onaylanmadı', e.title, './');
  end if;
end $$;

create or replace function public.delete_event(p_event uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  delete from public.events
  where id = p_event and (public.is_admin(group_id) or (created_by = auth.uid() and status = 'pending'));
end $$;

create or replace function public.set_rsvp(p_event uuid, p_answer text) returns void
language plpgsql security definer set search_path = '' as $$
declare e public.events;
begin
  select * into e from public.events where id = p_event;
  if not found or e.status <> 'approved' or not public.is_member(e.group_id) then
    raise exception 'TAYFA: Bu plana yanıt verilemez';
  end if;
  if p_answer not in ('yes','no') then raise exception 'TAYFA: Geçersiz yanıt'; end if;
  insert into public.rsvps (event_id, user_id, answer, updated_at)
    values (p_event, auth.uid(), p_answer, now())
  on conflict (event_id, user_id) do update set answer = excluded.answer, updated_at = now();
end $$;

create or replace function public.save_push_subscription(p_endpoint text, p_p256dh text, p_auth text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'TAYFA: Giriş gerekli'; end if;
  insert into public.push_subscriptions (endpoint, user_id, p256dh, auth)
    values (p_endpoint, auth.uid(), p_p256dh, p_auth)
  on conflict (endpoint) do update set user_id = auth.uid(), p256dh = excluded.p256dh, auth = excluded.auth;
end $$;

create or replace function public.delete_push_subscription(p_endpoint text) returns void
language sql security definer set search_path = '' as $$
  delete from public.push_subscriptions where endpoint = p_endpoint and user_id = auth.uid();
$$;

-- ---------------------------------------------------------------------
-- Okuma izinleri (RLS)
-- ---------------------------------------------------------------------
drop policy if exists "uye grubu gorur" on public.groups;
create policy "uye grubu gorur" on public.groups for select to authenticated
  using (public.is_member(id));

drop policy if exists "uye uyeleri gorur" on public.members;
create policy "uye uyeleri gorur" on public.members for select to authenticated
  using (user_id = auth.uid() or public.is_member(group_id));

drop policy if exists "uye planlari gorur" on public.events;
create policy "uye planlari gorur" on public.events for select to authenticated
  using (public.is_member(group_id)
         and (status = 'approved' or created_by = auth.uid() or public.is_admin(group_id)));

drop policy if exists "uye yanitlari gorur" on public.rsvps;
create policy "uye yanitlari gorur" on public.rsvps for select to authenticated
  using (exists (select 1 from public.events e where e.id = event_id and public.is_member(e.group_id)));

drop policy if exists "kendi onaylarini gorur" on public.consents;
create policy "kendi onaylarini gorur" on public.consents for select to authenticated
  using (user_id = auth.uid());

-- Yetkiler: anonim kullanıcı tablolara hiç erişemez, yazma işlemleri yalnızca fonksiyonlarla.
revoke all on all tables in schema public from anon, authenticated;
grant select on public.groups, public.members, public.events, public.rsvps, public.consents to authenticated;
grant all on all tables in schema public to service_role;

revoke execute on all functions in schema public from public, anon;
grant execute on function
  public.my_context(), public.create_invite(text), public.list_invites(), public.cancel_invite(text),
  public.decide_member(uuid, boolean), public.remove_member(uuid),
  public.propose_event(text, text, text, timestamptz), public.decide_event(uuid, boolean),
  public.delete_event(uuid), public.set_rsvp(uuid, text),
  public.save_push_subscription(text, text, text), public.delete_push_subscription(text),
  public.is_member(uuid), public.is_admin(uuid), public.my_group()
  to authenticated;
grant execute on function public.setup_needed(), public.check_invite(text, text) to anon, authenticated;

-- Canlı güncellemeler
do $$
begin
  begin alter publication supabase_realtime add table public.events;  exception when others then null; end;
  begin alter publication supabase_realtime add table public.rsvps;   exception when others then null; end;
  begin alter publication supabase_realtime add table public.members; exception when others then null; end;
end $$;

-- ---------------------------------------------------------------------
-- Bildirim gönderimi: kuyruğa kayıt düşünce "push" fonksiyonunu dürt
-- ---------------------------------------------------------------------
create or replace function public.ping_push() returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform net.http_post(
    url := 'https://uleeogbmotjabbfcktcw.supabase.co/functions/v1/push',
    body := '{}'::jsonb,
    headers := '{"Content-Type":"application/json"}'::jsonb,
    timeout_milliseconds := 10000);
exception when others then
  null; -- bildirim gönderilemese de asıl işlem bozulmasın
end $$;

create or replace function public.notify_queue_after_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform public.ping_push();
  return null;
end $$;

drop trigger if exists tayfa_notify_queue_ping on public.notify_queue;
create trigger tayfa_notify_queue_ping
  after insert on public.notify_queue
  for each statement execute function public.notify_queue_after_insert();

-- Her dakika: 5 dakikadır onay bekleyen planlar için yöneticiye BİR kez daha hatırlat;
-- gönderilememiş bildirimleri bir saat boyunca tekrar dene.
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
      public.member_name(e.group_id, e.created_by) || ' önerdi: ' || e.title, './#yonetim');
  end loop;

  if exists (select 1 from public.notify_queue
             where sent_at is null
               and created_at < now() - interval '1 minute'
               and created_at > now() - interval '1 hour') then
    perform public.ping_push();
  end if;

  delete from public.notify_queue where created_at < now() - interval '30 days';
end $$;

do $$
begin
  perform cron.unschedule(jobid) from cron.job where jobname = 'tayfa-hatirlatma';
  perform cron.schedule('tayfa-hatirlatma', '* * * * *', 'select public.run_reminders();');
end $$;

select 'Tayfa kurulumu tamamlandı' as sonuc;
