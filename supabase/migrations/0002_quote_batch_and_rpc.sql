-- Monthly schedule generator and query helpers.

create or replace function public.generate_monthly_quote_schedule(p_month date default (timezone('Asia/Tokyo', now()))::date)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  month_start date := date_trunc('month', p_month)::date;
  month_end date := (date_trunc('month', p_month) + interval '1 month - 1 day')::date;
  active_quote_ids bigint[];
  active_count integer;
  prev_quote_id bigint;
  prev_pos integer;
  start_pos integer := 1;
  d date;
  i integer := 0;
  target_pos integer;
  target_quote_id bigint;
begin
  select array_agg(q.id order by q.display_order asc, q.id asc)
    into active_quote_ids
  from public.quotes q
  where q.is_active = true;

  active_count := coalesce(array_length(active_quote_ids, 1), 0);
  if active_count = 0 then
    raise exception 'No active quotes found.';
  end if;

  select s.quote_id
    into prev_quote_id
  from public.daily_quote_schedule s
  where s.date < month_start
  order by s.date desc
  limit 1;

  if prev_quote_id is not null then
    prev_pos := array_position(active_quote_ids, prev_quote_id);
    if prev_pos is not null then
      start_pos := (prev_pos % active_count) + 1;
    end if;
  end if;

  d := month_start;
  while d <= month_end loop
    target_pos := ((start_pos - 1 + i) % active_count) + 1;
    target_quote_id := active_quote_ids[target_pos];

    insert into public.daily_quote_schedule (date, quote_id)
    values (d, target_quote_id)
    on conflict (date) do nothing;

    d := d + 1;
    i := i + 1;
  end loop;
end;
$$;

create or replace function public.run_monthly_quote_batch()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if extract(day from timezone('Asia/Tokyo', now())) = 1 then
    perform public.generate_monthly_quote_schedule((timezone('Asia/Tokyo', now()))::date);
  end if;
end;
$$;

create or replace function public.get_quote_for_date(p_date date)
returns table (
  date date,
  quote_id bigint,
  ja_translation text,
  en_translation text,
  original_text text,
  speaker_name text,
  birth_year integer,
  death_year integer,
  source text
)
language sql
stable
set search_path = public
as $$
  select
    s.date,
    q.id as quote_id,
    q.ja_translation,
    q.en_translation,
    q.original_text,
    q.speaker_name,
    q.birth_year,
    q.death_year,
    q.source
  from public.daily_quote_schedule s
  join public.quotes q on q.id = s.quote_id
  where s.date = p_date
    and q.is_active = true
  limit 1;
$$;

create or replace function public.get_today_quote(p_now timestamptz default now())
returns table (
  date date,
  quote_id bigint,
  ja_translation text,
  en_translation text,
  original_text text,
  speaker_name text,
  birth_year integer,
  death_year integer,
  source text
)
language sql
stable
set search_path = public
as $$
  select *
  from public.get_quote_for_date((timezone('Asia/Tokyo', p_now))::date);
$$;

grant execute on function public.get_quote_for_date(date) to anon, authenticated;
grant execute on function public.get_today_quote(timestamptz) to anon, authenticated;
