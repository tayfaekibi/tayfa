-- =====================================================================
-- TAYFA · 2.1: Albümsüz (tek) fotoğraflar, albüme taşıma, fotoğrafa konum verme
-- =====================================================================
alter table public.albums add column if not exists is_loose boolean not null default false;
create unique index if not exists albums_one_loose on public.albums (group_id) where is_loose;

-- Grubun "Tek fotoğraflar" albümü (yoksa açılır)
create or replace function public.loose_album() returns uuid
language plpgsql security definer set search_path = '' as $$
declare gid uuid := public.my_group(); aid uuid;
begin
  if gid is null or not public.is_admin(gid) then raise exception 'TAYFA: Sadece yönetici fotoğraf yükleyebilir'; end if;
  select id into aid from public.albums where group_id = gid and is_loose;
  if aid is null then
    insert into public.albums (group_id, title, is_loose, taken_on, created_by)
      values (gid, 'Tek fotoğraflar', true, null, auth.uid()) returning id into aid;
  end if;
  return aid;
end $$;

-- Albüm sayısı ve kapak fotoğrafını yeniden hesapla
create or replace function public.refresh_album(aid uuid) returns void
language sql security definer set search_path = '' as $$
  update public.albums a set
    photo_count = (select count(*) from public.photos p where p.album_id = a.id),
    cover_thumb = case
      when exists (select 1 from public.photos p where p.album_id = a.id and p.thumb_path = a.cover_thumb) then a.cover_thumb
      else (select thumb_path from public.photos p where p.album_id = a.id order by taken_at nulls last, created_at limit 1) end
  where a.id = aid;
$$;

create or replace function public.move_photos(p_photos uuid[], p_album uuid) returns int
language plpgsql security definer set search_path = '' as $$
declare t public.albums; src uuid[]; n int;
begin
  select * into t from public.albums where id = p_album;
  if not found or not public.is_admin(t.group_id) then raise exception 'TAYFA: Yetki yok'; end if;
  select coalesce(array_agg(distinct album_id), '{}') into src from public.photos
    where id = any(p_photos) and group_id = t.group_id and album_id <> t.id;
  update public.photos set album_id = t.id
    where id = any(p_photos) and group_id = t.group_id and album_id <> t.id;
  get diagnostics n = row_count;
  -- Hedef albümün konumu yoksa taşınan fotoğraflardan al
  if t.lat is null then
    update public.albums set (lat, lng) = (
      select lat, lng from public.photos where id = any(p_photos) and lat is not null order by taken_at nulls last limit 1)
    where id = t.id and exists (select 1 from public.photos where id = any(p_photos) and lat is not null);
  end if;
  perform public.refresh_album(t.id);
  perform public.refresh_album(x) from unnest(src) x;
  return n;
end $$;

create or replace function public.set_photo_location(p_photo uuid, p_lat double precision, p_lng double precision) returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.photos set lat = p_lat, lng = p_lng where id = p_photo and public.is_admin(group_id);
  if not found then raise exception 'TAYFA: Yetki yok'; end if;
end $$;

-- Yükleme bitince haber ver (tek fotoğraflar için farklı metin)
create or replace function public.finish_album_upload(p_album uuid, p_added int) returns void
language plpgsql security definer set search_path = '' as $$
declare a public.albums; who text;
begin
  select * into a from public.albums where id = p_album;
  if not found or not public.is_admin(a.group_id) then raise exception 'TAYFA: Yetki yok'; end if;
  if coalesce(p_added, 0) <= 0 then return; end if;
  who := public.member_name(a.group_id, auth.uid());
  if a.is_loose then
    perform public.queue_notify(public.group_users(a.group_id, auth.uid()),
      'Yeni anılar 📍', who || ' ' || p_added || ' yeni fotoğraf ekledi', './#anilar', 'tek-' || a.group_id);
  else
    perform public.queue_notify(public.group_users(a.group_id, auth.uid()),
      'Yeni anılar 📍', who || ', ' || a.title || ' albümüne ' || p_added || ' fotoğraf ekledi',
      './#album/' || a.id, 'album-' || a.id);
  end if;
  perform public.post_system(a.group_id, jsonb_build_object(
    'type', 'album', 'album_id', a.id, 'title', a.title, 'count', p_added, 'loose', a.is_loose));
end $$;

grant execute on function public.loose_album(), public.move_photos(uuid[], uuid),
  public.set_photo_location(uuid, double precision, double precision) to authenticated;
revoke execute on function public.refresh_album(uuid) from public, anon, authenticated;
