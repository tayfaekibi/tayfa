-- =====================================================================
-- TAYFA · Sürüm 2: Anılar, Sohbet, Tavla
-- GitHub Actions bunu otomatik çalıştırır. Birden fazla kez çalışabilir.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Ortak eklemeler
-- ---------------------------------------------------------------------
alter table public.members add column if not exists chat_notify text not null default 'all';
do $$ begin
  alter table public.members add constraint members_chat_notify_chk check (chat_notify in ('all','mentions','off'));
exception when duplicate_object then null; end $$;

alter table public.notify_queue add column if not exists tag text;

drop function if exists public.queue_notify(uuid[], text, text, text);
create or replace function public.queue_notify(uids uuid[], p_title text, p_body text, p_url text default './', p_tag text default null)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if uids is null or cardinality(uids) = 0 then return; end if;
  insert into public.notify_queue (user_ids, title, body, url, tag) values (uids, p_title, p_body, p_url, p_tag);
end $$;

create or replace function public.try_uuid(t text) returns uuid
language plpgsql immutable set search_path = '' as $$
begin return t::uuid; exception when others then return null; end $$;

-- ---------------------------------------------------------------------
-- Anılar
-- ---------------------------------------------------------------------
create table if not exists public.albums (
  id           uuid primary key default gen_random_uuid(),
  group_id     uuid not null references public.groups(id) on delete cascade,
  title        text not null check (char_length(title) between 1 and 80),
  place        text check (char_length(place) <= 80),
  lat          double precision,
  lng          double precision,
  taken_on     date,
  created_by   uuid references auth.users(id) on delete set null,
  created_at   timestamptz not null default now(),
  photo_count  int not null default 0,
  cover_thumb  text
);
create index if not exists albums_group_idx on public.albums (group_id, taken_on desc);

create table if not exists public.photos (
  id          uuid primary key default gen_random_uuid(),
  group_id    uuid not null references public.groups(id) on delete cascade,
  album_id    uuid not null references public.albums(id) on delete cascade,
  path        text not null,
  thumb_path  text not null,
  width       int,
  height      int,
  lat         double precision,
  lng         double precision,
  taken_at    timestamptz,
  created_by  uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now()
);
create index if not exists photos_album_idx on public.photos (album_id, taken_at, created_at);

create table if not exists public.photo_likes (
  photo_id    uuid not null references public.photos(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (photo_id, user_id)
);

create table if not exists public.comments (
  id           uuid primary key default gen_random_uuid(),
  group_id     uuid not null references public.groups(id) on delete cascade,
  target_type  text not null check (target_type in ('event','album')),
  target_id    uuid not null,
  user_id      uuid references auth.users(id) on delete set null,
  body         text not null check (char_length(body) between 1 and 1000),
  created_at   timestamptz not null default now()
);
create index if not exists comments_target_idx on public.comments (target_type, target_id, created_at);

-- ---------------------------------------------------------------------
-- Sohbet (uçtan uca şifreli: sunucu sadece şifreli veriyi görür)
-- ---------------------------------------------------------------------
create table if not exists public.devices (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  public_key    jsonb not null,
  created_at    timestamptz not null default now(),
  last_seen_at  timestamptz not null default now()
);
create index if not exists devices_user_idx on public.devices (user_id);

create table if not exists public.messages (
  id           uuid primary key default gen_random_uuid(),
  group_id     uuid not null references public.groups(id) on delete cascade,
  sender       uuid references auth.users(id) on delete set null,
  kind         text not null check (kind in ('text','voice','system')),
  iv           text,
  ciphertext   text,
  epk          jsonb,
  keys         jsonb,
  audio_path   text,
  audio_iv     text,
  duration_ms  int,
  payload      jsonb,
  reply_to     uuid,
  mentions     uuid[] not null default '{}',
  created_at   timestamptz not null default now()
);
create index if not exists messages_group_idx on public.messages (group_id, created_at desc);

create table if not exists public.message_reactions (
  message_id  uuid not null references public.messages(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  emoji       text not null check (char_length(emoji) <= 8),
  created_at  timestamptz not null default now(),
  primary key (message_id, user_id)
);

create table if not exists public.chat_reads (
  group_id      uuid not null references public.groups(id) on delete cascade,
  user_id       uuid not null references auth.users(id) on delete cascade,
  last_read_at  timestamptz not null default now(),
  primary key (group_id, user_id)
);

-- ---------------------------------------------------------------------
-- Oyunlar
-- ---------------------------------------------------------------------
create table if not exists public.games (
  id           uuid primary key default gen_random_uuid(),
  group_id     uuid not null references public.groups(id) on delete cascade,
  kind         text not null default 'tavla',
  players      uuid[] not null,
  state        jsonb not null,
  status       text not null default 'active' check (status in ('active','finished','abandoned')),
  turn         uuid,
  match_to     int not null default 5,
  winner       uuid,
  created_by   uuid references auth.users(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  finished_at  timestamptz
);
create index if not exists games_group_idx on public.games (group_id, status, updated_at desc);

alter table public.albums            enable row level security;
alter table public.photos            enable row level security;
alter table public.photo_likes       enable row level security;
alter table public.comments          enable row level security;
alter table public.devices           enable row level security;
alter table public.messages          enable row level security;
alter table public.message_reactions enable row level security;
alter table public.chat_reads        enable row level security;
alter table public.games             enable row level security;

-- ---------------------------------------------------------------------
-- Okuma / yazma kuralları
-- ---------------------------------------------------------------------
create or replace function public.shares_group(uid uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.members a join public.members b on a.group_id = b.group_id
    where a.user_id = auth.uid() and a.status = 'active'
      and b.user_id = uid and b.status = 'active');
$$;

drop policy if exists "uye albumleri gorur" on public.albums;
create policy "uye albumleri gorur" on public.albums for select to authenticated using (public.is_member(group_id));
drop policy if exists "uye fotograflari gorur" on public.photos;
create policy "uye fotograflari gorur" on public.photos for select to authenticated using (public.is_member(group_id));
drop policy if exists "uye begenileri gorur" on public.photo_likes;
create policy "uye begenileri gorur" on public.photo_likes for select to authenticated
  using (exists (select 1 from public.photos p where p.id = photo_id and public.is_member(p.group_id)));
drop policy if exists "uye yorumlari gorur" on public.comments;
create policy "uye yorumlari gorur" on public.comments for select to authenticated using (public.is_member(group_id));

drop policy if exists "grup cihazlari gorur" on public.devices;
create policy "grup cihazlari gorur" on public.devices for select to authenticated
  using (user_id = auth.uid() or public.shares_group(user_id));

drop policy if exists "uye mesajlari gorur" on public.messages;
create policy "uye mesajlari gorur" on public.messages for select to authenticated using (public.is_member(group_id));
drop policy if exists "uye mesaj gonderir" on public.messages;
create policy "uye mesaj gonderir" on public.messages for insert to authenticated
  with check (sender = auth.uid() and public.is_member(group_id) and kind in ('text','voice') and payload is null);

drop policy if exists "uye tepkileri gorur" on public.message_reactions;
create policy "uye tepkileri gorur" on public.message_reactions for select to authenticated
  using (exists (select 1 from public.messages m where m.id = message_id and public.is_member(m.group_id)));
drop policy if exists "uye okunmalari gorur" on public.chat_reads;
create policy "uye okunmalari gorur" on public.chat_reads for select to authenticated using (public.is_member(group_id));
drop policy if exists "uye oyunlari gorur" on public.games;
create policy "uye oyunlari gorur" on public.games for select to authenticated using (public.is_member(group_id));

grant select on public.albums, public.photos, public.photo_likes, public.comments, public.devices,
  public.messages, public.message_reactions, public.chat_reads, public.games to authenticated;
grant insert on public.messages to authenticated;
grant all on all tables in schema public to service_role;

-- ---------------------------------------------------------------------
-- Dosya depolama: fotoğraflar ve sesli mesajlar (ikisi de gizli)
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit)
values ('photos', 'photos', false, 15728640), ('chat', 'chat', false, 8388608)
on conflict (id) do nothing;

drop policy if exists "tayfa foto okuma" on storage.objects;
create policy "tayfa foto okuma" on storage.objects for select to authenticated
  using (bucket_id = 'photos' and public.is_member(public.try_uuid((storage.foldername(name))[1])));
drop policy if exists "tayfa foto yukleme" on storage.objects;
create policy "tayfa foto yukleme" on storage.objects for insert to authenticated
  with check (bucket_id = 'photos' and public.is_admin(public.try_uuid((storage.foldername(name))[1])));
drop policy if exists "tayfa foto silme" on storage.objects;
create policy "tayfa foto silme" on storage.objects for delete to authenticated
  using (bucket_id = 'photos' and public.is_admin(public.try_uuid((storage.foldername(name))[1])));

drop policy if exists "tayfa ses okuma" on storage.objects;
create policy "tayfa ses okuma" on storage.objects for select to authenticated
  using (bucket_id = 'chat' and public.is_member(public.try_uuid((storage.foldername(name))[1])));
drop policy if exists "tayfa ses yukleme" on storage.objects;
create policy "tayfa ses yukleme" on storage.objects for insert to authenticated
  with check (bucket_id = 'chat' and public.is_member(public.try_uuid((storage.foldername(name))[1]))
              and (storage.foldername(name))[2] = auth.uid()::text);
drop policy if exists "tayfa ses silme" on storage.objects;
create policy "tayfa ses silme" on storage.objects for delete to authenticated
  using (bucket_id = 'chat' and ((storage.foldername(name))[2] = auth.uid()::text
         or public.is_admin(public.try_uuid((storage.foldername(name))[1]))));

-- ---------------------------------------------------------------------
-- Sohbete sistem kartı ekleme
-- ---------------------------------------------------------------------
create or replace function public.post_system(gid uuid, p_payload jsonb) returns void
language sql security definer set search_path = '' as $$
  insert into public.messages (group_id, kind, payload) values (gid, 'system', p_payload);
$$;

create or replace function public.events_after_approve() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'approved' and (tg_op = 'INSERT' or old.status is distinct from 'approved') then
    perform public.post_system(new.group_id, jsonb_build_object(
      'type', 'event', 'event_id', new.id, 'title', new.title, 'starts_at', new.starts_at, 'place', new.place));
  end if;
  return null;
end $$;
drop trigger if exists tayfa_events_system on public.events;
create trigger tayfa_events_system after insert or update of status on public.events
  for each row execute function public.events_after_approve();

-- ---------------------------------------------------------------------
-- Anılar işlemleri (yükleme sadece yönetici)
-- ---------------------------------------------------------------------
create or replace function public.create_album(p_title text, p_place text, p_lat double precision, p_lng double precision, p_taken_on date)
returns uuid language plpgsql security definer set search_path = '' as $$
declare gid uuid := public.my_group(); aid uuid;
begin
  if gid is null or not public.is_admin(gid) then raise exception 'TAYFA: Sadece yönetici albüm açabilir'; end if;
  insert into public.albums (group_id, title, place, lat, lng, taken_on, created_by)
    values (gid, trim(p_title), nullif(trim(p_place), ''), p_lat, p_lng, coalesce(p_taken_on, current_date), auth.uid())
    returning id into aid;
  return aid;
end $$;

create or replace function public.update_album(p_album uuid, p_title text, p_place text, p_lat double precision, p_lng double precision, p_taken_on date)
returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.albums set title = trim(p_title), place = nullif(trim(p_place), ''), lat = p_lat, lng = p_lng,
         taken_on = coalesce(p_taken_on, taken_on)
  where id = p_album and public.is_admin(group_id);
  if not found then raise exception 'TAYFA: Yetki yok'; end if;
end $$;

create or replace function public.add_photo(p_album uuid, p_path text, p_thumb text, p_w int, p_h int,
  p_lat double precision, p_lng double precision, p_taken_at timestamptz)
returns uuid language plpgsql security definer set search_path = '' as $$
declare a public.albums; pid uuid;
begin
  select * into a from public.albums where id = p_album for update;
  if not found or not public.is_admin(a.group_id) then raise exception 'TAYFA: Yetki yok'; end if;
  if split_part(p_path, '/', 1) <> a.group_id::text or split_part(p_thumb, '/', 1) <> a.group_id::text then
    raise exception 'TAYFA: Geçersiz dosya yolu';
  end if;
  insert into public.photos (group_id, album_id, path, thumb_path, width, height, lat, lng, taken_at, created_by)
    values (a.group_id, a.id, p_path, p_thumb, p_w, p_h, p_lat, p_lng, p_taken_at, auth.uid())
    returning id into pid;
  update public.albums set photo_count = photo_count + 1,
         cover_thumb = coalesce(cover_thumb, p_thumb),
         lat = coalesce(lat, p_lat), lng = coalesce(lng, p_lng)
  where id = a.id;
  return pid;
end $$;

create or replace function public.finish_album_upload(p_album uuid, p_added int) returns void
language plpgsql security definer set search_path = '' as $$
declare a public.albums;
begin
  select * into a from public.albums where id = p_album;
  if not found or not public.is_admin(a.group_id) then raise exception 'TAYFA: Yetki yok'; end if;
  if coalesce(p_added, 0) <= 0 then return; end if;
  perform public.queue_notify(public.group_users(a.group_id, auth.uid()),
    'Yeni anılar 📍', public.member_name(a.group_id, auth.uid()) || ', ' || a.title || ' albümüne ' || p_added || ' fotoğraf ekledi',
    './#album/' || a.id, 'album-' || a.id);
  perform public.post_system(a.group_id, jsonb_build_object(
    'type', 'album', 'album_id', a.id, 'title', a.title, 'count', p_added, 'cover', a.cover_thumb));
end $$;

create or replace function public.delete_photo(p_photo uuid) returns text[]
language plpgsql security definer set search_path = '' as $$
declare ph public.photos;
begin
  select * into ph from public.photos where id = p_photo;
  if not found or not public.is_admin(ph.group_id) then raise exception 'TAYFA: Yetki yok'; end if;
  delete from public.photos where id = p_photo;
  update public.albums a set photo_count = greatest(0, photo_count - 1),
    cover_thumb = case when a.cover_thumb = ph.thumb_path
      then (select thumb_path from public.photos where album_id = a.id order by taken_at nulls last, created_at limit 1)
      else a.cover_thumb end
  where a.id = ph.album_id;
  return array[ph.path, ph.thumb_path];
end $$;

create or replace function public.delete_album(p_album uuid) returns text[]
language plpgsql security definer set search_path = '' as $$
declare a public.albums; paths text[];
begin
  select * into a from public.albums where id = p_album;
  if not found or not public.is_admin(a.group_id) then raise exception 'TAYFA: Yetki yok'; end if;
  select coalesce(array_agg(x), '{}') into paths
    from (select path as x from public.photos where album_id = a.id
          union all select thumb_path from public.photos where album_id = a.id) s;
  delete from public.comments where target_type = 'album' and target_id = a.id;
  delete from public.albums where id = a.id;
  return paths;
end $$;

create or replace function public.toggle_like(p_photo uuid) returns boolean
language plpgsql security definer set search_path = '' as $$
declare ph public.photos;
begin
  select * into ph from public.photos where id = p_photo;
  if not found or not public.is_member(ph.group_id) then raise exception 'TAYFA: Yetki yok'; end if;
  if exists (select 1 from public.photo_likes where photo_id = p_photo and user_id = auth.uid()) then
    delete from public.photo_likes where photo_id = p_photo and user_id = auth.uid();
    return false;
  end if;
  insert into public.photo_likes (photo_id, user_id) values (p_photo, auth.uid());
  return true;
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
  -- Planın/albümün sahibine ve daha önce yorum yapanlara haber ver
  perform public.queue_notify(
    (select coalesce(array_agg(distinct u), '{}') from (
       select owner as u union select user_id from public.comments
       where target_type = p_type and target_id = p_target) x
     where u is not null and u <> auth.uid()),
    ttl, public.member_name(gid, auth.uid()) || ': ' || left(trim(p_body), 80),
    case when p_type = 'event' then './' else './#album/' || p_target end, 'yorum-' || p_target);
  return cid;
end $$;

create or replace function public.delete_comment(p_comment uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  delete from public.comments where id = p_comment and (user_id = auth.uid() or public.is_admin(group_id));
end $$;

-- ---------------------------------------------------------------------
-- Sohbet işlemleri
-- ---------------------------------------------------------------------
create or replace function public.register_device(p_public_key jsonb, p_device uuid default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare did uuid;
begin
  if auth.uid() is null then raise exception 'TAYFA: Giriş gerekli'; end if;
  if p_device is not null then
    update public.devices set last_seen_at = now() where id = p_device and user_id = auth.uid() returning id into did;
    if did is not null then return did; end if;
  end if;
  insert into public.devices (user_id, public_key) values (auth.uid(), p_public_key) returning id into did;
  return did;
end $$;

create or replace function public.delete_device(p_device uuid) returns void
language sql security definer set search_path = '' as $$
  delete from public.devices where id = p_device and user_id = auth.uid();
$$;

create or replace function public.messages_after_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
declare who text; targets uuid[];
begin
  if new.kind = 'system' then
    -- sistem kartları için ayrıca bildirim yok (asıl olay zaten bildirim gönderiyor)
    return null;
  end if;
  who := public.member_name(new.group_id, new.sender);
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
drop trigger if exists tayfa_messages_notify on public.messages;
create trigger tayfa_messages_notify after insert on public.messages
  for each row execute function public.messages_after_insert();

create or replace function public.react(p_message uuid, p_emoji text) returns void
language plpgsql security definer set search_path = '' as $$
declare m public.messages;
begin
  select * into m from public.messages where id = p_message;
  if not found or not public.is_member(m.group_id) then raise exception 'TAYFA: Yetki yok'; end if;
  if p_emoji is null or p_emoji = '' then
    delete from public.message_reactions where message_id = p_message and user_id = auth.uid();
  else
    insert into public.message_reactions (message_id, user_id, emoji) values (p_message, auth.uid(), left(p_emoji, 8))
    on conflict (message_id, user_id) do update set emoji = excluded.emoji, created_at = now();
  end if;
end $$;

create or replace function public.mark_read() returns void
language plpgsql security definer set search_path = '' as $$
declare gid uuid := public.my_group();
begin
  if gid is null then return; end if;
  insert into public.chat_reads (group_id, user_id, last_read_at) values (gid, auth.uid(), now())
  on conflict (group_id, user_id) do update set last_read_at = now();
end $$;

create or replace function public.delete_message(p_message uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare m public.messages;
begin
  select * into m from public.messages where id = p_message;
  if not found or not (m.sender = auth.uid() or public.is_admin(m.group_id)) then raise exception 'TAYFA: Yetki yok'; end if;
  delete from public.messages where id = p_message;
  return m.audio_path;
end $$;

create or replace function public.set_chat_notify(p_mode text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if p_mode not in ('all','mentions','off') then raise exception 'TAYFA: Geçersiz seçim'; end if;
  update public.members set chat_notify = p_mode where user_id = auth.uid();
end $$;

-- Üye çıkarılınca cihaz anahtarları da silinsin (artık şifreli mesaj alamaz)
create or replace function public.remove_member(p_user uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare gid uuid := public.my_group();
begin
  if gid is null or not public.is_admin(gid) then raise exception 'TAYFA: Yetki yok'; end if;
  if p_user = auth.uid() then raise exception 'TAYFA: Kendinizi çıkaramazsınız'; end if;
  update public.members set status = 'removed' where group_id = gid and user_id = p_user;
  delete from public.push_subscriptions where user_id = p_user;
  delete from public.devices where user_id = p_user;
end $$;

-- ---------------------------------------------------------------------
-- Oyun başlatma (hamleler "tavla" sunucu fonksiyonundan geçer)
-- ---------------------------------------------------------------------
create or replace function public.create_game(p_opponent uuid, p_kind text default 'tavla', p_match_to int default 5)
returns uuid language plpgsql security definer set search_path = '' as $$
declare gid uuid := public.my_group(); g uuid; starter int; st jsonb;
begin
  if gid is null then raise exception 'TAYFA: Üyeliğiniz etkin değil'; end if;
  if p_kind <> 'tavla' then raise exception 'TAYFA: Bu oyun henüz hazır değil'; end if;
  if p_opponent = auth.uid() or not exists (select 1 from public.members where group_id = gid and user_id = p_opponent and status = 'active') then
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
  perform public.queue_notify(array[p_opponent], 'Tavla daveti 🎲',
    public.member_name(gid, auth.uid()) || ' seninle tavla maçı başlattı' ||
    case when starter = 1 then ', ilk zar senin' else '' end,
    './#oyun/' || g, 'tavla-' || g);
  return g;
end $$;

-- ---------------------------------------------------------------------
-- Yetkiler
-- ---------------------------------------------------------------------
revoke execute on all functions in schema public from public, anon;
grant execute on function
  public.my_context(), public.create_invite(text), public.list_invites(), public.cancel_invite(text),
  public.decide_member(uuid, boolean), public.remove_member(uuid),
  public.propose_event(text, text, text, timestamptz), public.decide_event(uuid, boolean),
  public.delete_event(uuid), public.set_rsvp(uuid, text),
  public.save_push_subscription(text, text, text), public.delete_push_subscription(text),
  public.is_member(uuid), public.is_admin(uuid), public.my_group(), public.shares_group(uuid), public.try_uuid(text),
  public.create_album(text, text, double precision, double precision, date),
  public.update_album(uuid, text, text, double precision, double precision, date),
  public.add_photo(uuid, text, text, int, int, double precision, double precision, timestamptz),
  public.finish_album_upload(uuid, int), public.delete_photo(uuid), public.delete_album(uuid),
  public.toggle_like(uuid), public.add_comment(text, uuid, text), public.delete_comment(uuid),
  public.register_device(jsonb, uuid), public.delete_device(uuid), public.react(uuid, text),
  public.mark_read(), public.delete_message(uuid), public.set_chat_notify(text),
  public.create_game(uuid, text, int)
  to authenticated;
grant execute on function public.setup_needed(), public.check_invite(text, text) to anon, authenticated;

-- Canlı güncellemeler
do $$
declare t text;
begin
  foreach t in array array['albums','photos','photo_likes','comments','messages','message_reactions','chat_reads','games'] loop
    begin execute format('alter publication supabase_realtime add table public.%I', t); exception when others then null; end;
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- Günlük temizlik: 30 günden eski yazılı mesajlar silinir, sesliler için fonksiyon çağrılır
-- ---------------------------------------------------------------------
create or replace function public.run_daily_cleanup() returns void
language plpgsql security definer set search_path = '' as $$
begin
  delete from public.messages where created_at < now() - interval '30 days' and audio_path is null;
  if exists (select 1 from public.messages where created_at < now() - interval '30 days') then
    perform net.http_post(
      url := 'https://uleeogbmotjabbfcktcw.supabase.co/functions/v1/push',
      body := '{"temizlik":true}'::jsonb,
      headers := '{"Content-Type":"application/json"}'::jsonb,
      timeout_milliseconds := 20000);
  end if;
  delete from public.devices where last_seen_at < now() - interval '120 days';
end $$;

do $$
begin
  perform cron.unschedule(jobid) from cron.job where jobname = 'tayfa-temizlik';
  perform cron.schedule('tayfa-temizlik', '17 3 * * *', 'select public.run_daily_cleanup();');
end $$;
