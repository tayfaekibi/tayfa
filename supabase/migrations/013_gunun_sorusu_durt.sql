-- 013: Günün sorusu (tarih/coğrafya, günde 1 soru, 30 sn) + oyunda dürtme

create table if not exists public.quiz_questions (
  id    int primary key,
  cat   text not null,
  q     text not null,
  opts  jsonb not null,
  ans   smallint not null check (ans between 0 and 3),
  info  text
);
alter table public.quiz_questions enable row level security; -- doğrudan okunamaz (cevaplar gizli)

create table if not exists public.quiz_answers (
  group_id    uuid not null references public.groups(id) on delete cascade,
  day         date not null,
  user_id     uuid not null references auth.users(id) on delete cascade,
  q_id        int not null,
  opened_at   timestamptz not null default now(),
  answered_at timestamptz,
  choice      smallint,
  correct     boolean,
  primary key (group_id, day, user_id)
);
alter table public.quiz_answers enable row level security;
drop policy if exists "kendi cevabini gorur" on public.quiz_answers;
create policy "kendi cevabini gorur" on public.quiz_answers for select to authenticated using (user_id = auth.uid());
grant select on public.quiz_answers to authenticated;

create or replace function public.quiz_day() returns date
language sql stable as $$ select (now() at time zone 'Europe/Istanbul')::date $$;

-- O günün sorusu: herkese aynı, havuzda sırayla karışık dolaşır
create or replace function public.quiz_qid(p_day date) returns int
language plpgsql stable security definer set search_path = '' as $$
declare n int; k int;
begin
  select count(*) into n from public.quiz_questions;
  if n = 0 then return null; end if;
  k := ((((p_day - date '2026-11-13') * 97) % n) + n) % n;
  return (select q.id from public.quiz_questions q order by q.id offset k limit 1);
end $$;

-- Süresi geçmiş (açılıp cevaplanmamış) soruyu boş say
create or replace function public.quiz_expire(p_group uuid, p_user uuid) returns void
language sql security definer set search_path = '' as $$
  update public.quiz_answers set answered_at = opened_at + interval '30 seconds', choice = null, correct = false
   where group_id = p_group and user_id = p_user and day = public.quiz_day()
     and answered_at is null and opened_at < now() - interval '35 seconds'
$$;

-- Bugünün sorusu (cevap ve bilgi sadece cevapladıktan sonra)
create or replace function public.quiz_today() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare g uuid; d date := public.quiz_day(); qid int; q public.quiz_questions; a public.quiz_answers;
begin
  select group_id into g from public.members where user_id = auth.uid() and status = 'active' limit 1;
  if g is null then raise exception 'TAYFA: Yetki yok'; end if;
  qid := public.quiz_qid(d);
  if qid is null then return null; end if;
  perform public.quiz_expire(g, auth.uid());
  select * into q from public.quiz_questions where id = qid;
  select * into a from public.quiz_answers where group_id = g and day = d and user_id = auth.uid();
  return jsonb_build_object('day', d, 'cat', q.cat, 'q', q.q, 'opts', q.opts,
    'opened_at', a.opened_at, 'answered', a.answered_at is not null, 'choice', a.choice, 'correct', a.correct,
    'ans', case when a.answered_at is not null then q.ans end,
    'info', case when a.answered_at is not null then q.info end,
    'now', now());
end $$;

-- Soruyu aç (süre başlar). Daha önce açıldıysa ilk açılış zamanı geçerli.
create or replace function public.quiz_open() returns timestamptz
language plpgsql security definer set search_path = '' as $$
declare g uuid; d date := public.quiz_day(); t timestamptz;
begin
  select group_id into g from public.members where user_id = auth.uid() and status = 'active' limit 1;
  if g is null then raise exception 'TAYFA: Yetki yok'; end if;
  insert into public.quiz_answers (group_id, day, user_id, q_id) values (g, d, auth.uid(), public.quiz_qid(d))
  on conflict do nothing;
  select opened_at into t from public.quiz_answers where group_id = g and day = d and user_id = auth.uid();
  return t;
end $$;

-- Cevapla (null = süre doldu). Bir kere.
create or replace function public.quiz_answer(p_choice smallint) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare g uuid; d date := public.quiz_day(); a public.quiz_answers; q public.quiz_questions; ok boolean;
begin
  select group_id into g from public.members where user_id = auth.uid() and status = 'active' limit 1;
  if g is null then raise exception 'TAYFA: Yetki yok'; end if;
  select * into a from public.quiz_answers where group_id = g and day = d and user_id = auth.uid() for update;
  if not found then raise exception 'TAYFA: Önce soruyu aç'; end if;
  select * into q from public.quiz_questions where id = a.q_id;
  if a.answered_at is null then
    if now() > a.opened_at + interval '33 seconds' then p_choice := null; end if; -- ağ gecikmesi payı
    ok := p_choice is not null and p_choice = q.ans;
    update public.quiz_answers set answered_at = now(), choice = p_choice, correct = ok
     where group_id = g and day = d and user_id = auth.uid();
  else
    p_choice := a.choice; ok := a.correct;
  end if;
  return jsonb_build_object('choice', p_choice, 'correct', ok, 'ans', q.ans, 'info', q.info);
end $$;

-- Kim ne bildi: sadece kendi cevabını verdikten sonra
create or replace function public.quiz_results() returns table (user_id uuid, answered boolean, correct boolean, choice smallint)
language plpgsql security definer set search_path = '' as $$
declare g uuid; d date := public.quiz_day();
begin
  select m.group_id into g from public.members m where m.user_id = auth.uid() and m.status = 'active' limit 1;
  if g is null then raise exception 'TAYFA: Yetki yok'; end if;
  if not exists (select 1 from public.quiz_answers x where x.group_id = g and x.day = d and x.user_id = auth.uid() and x.answered_at is not null) then
    raise exception 'TAYFA: Önce sen cevapla';
  end if;
  update public.quiz_answers x set answered_at = x.opened_at + interval '30 seconds', choice = null, correct = false
   where x.group_id = g and x.day = d and x.answered_at is null and x.opened_at < now() - interval '35 seconds';
  return query
    select m.user_id, (x.answered_at is not null), coalesce(x.correct, false), x.choice
      from public.members m
      left join public.quiz_answers x on x.group_id = g and x.day = d and x.user_id = m.user_id
     where m.group_id = g and m.status = 'active';
end $$;

grant execute on function public.quiz_today(), public.quiz_open(), public.quiz_answer(smallint), public.quiz_results() to authenticated;
revoke execute on function public.quiz_qid(date), public.quiz_expire(uuid, uuid) from public, anon, authenticated;

-- Her gün 10:00 (İstanbul) bildirim
create or replace function public.quiz_notify() returns void
language plpgsql security definer set search_path = '' as $$
declare g record; d date := public.quiz_day(); qq public.quiz_questions;
begin
  select * into qq from public.quiz_questions where id = public.quiz_qid(d);
  if qq.id is null then return; end if;
  for g in select group_id, array_agg(user_id) as uids from public.members where status = 'active' group by group_id loop
    insert into public.notify_queue (user_ids, title, body, url, tag, inbox)
      values (g.uids, 'Günün sorusu 🧠', qq.cat || ' sorusu hazır · 30 saniyen var', './#soru', 'soru-' || d, false);
  end loop;
end $$;

do $$
begin
  perform cron.unschedule(jobid) from cron.job where jobname = 'tayfa-gunun-sorusu';
  perform cron.schedule('tayfa-gunun-sorusu', '0 7 * * *', 'select public.quiz_notify();'); -- 07:00 UTC = 10:00 TR
end $$;

-- ================================================================== oyunda dürtme
create table if not exists public.game_nudges (
  game_id uuid primary key references public.games(id) on delete cascade,
  at      timestamptz not null default now()
);
alter table public.game_nudges enable row level security;

create or replace function public.nudge_turn(p_game uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare g public.games; last timestamptz; who text; nm text;
begin
  select * into g from public.games where id = p_game;
  if not found or not (auth.uid() = any(g.players)) then raise exception 'TAYFA: Yetki yok'; end if;
  if g.status <> 'active' or g.turn is null then raise exception 'TAYFA: Oyun sürmüyor'; end if;
  if g.turn = auth.uid() then raise exception 'TAYFA: Sıra sende'; end if;
  if g.updated_at > now() - interval '2 minutes' then raise exception 'TAYFA: Biraz bekle, sıra yeni geçti'; end if;
  select at into last from public.game_nudges where game_id = p_game;
  if last is not null and last > now() - interval '10 minutes' then raise exception 'TAYFA: Az önce dürtüldü, 10 dakika bekle'; end if;
  insert into public.game_nudges (game_id, at) values (p_game, now())
    on conflict (game_id) do update set at = now();
  who := public.member_name(g.group_id, auth.uid());
  nm := case when g.kind = 'king' then 'King' else 'Tavla' end;
  insert into public.notify_queue (user_ids, title, body, url, tag, inbox)
    values (array[g.turn], nm || ' · Sıra sende 👉', who || ' seni dürttü, hadi oyna!', './#oyun/' || p_game, 'durt-' || p_game, false);
end $$;
grant execute on function public.nudge_turn(uuid) to authenticated;
