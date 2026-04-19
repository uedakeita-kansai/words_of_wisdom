-- Core schema for daily quotes.
create table if not exists public.quotes (
  id bigint generated always as identity primary key,
  display_order integer not null unique,
  ja_translation text not null,
  en_translation text not null,
  original_text text not null,
  speaker_name text not null,
  birth_year integer,
  death_year integer,
  source text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint quotes_birth_death_check
    check (birth_year is null or death_year is null or birth_year <= death_year)
);

create table if not exists public.daily_quote_schedule (
  date date primary key,
  quote_id bigint not null references public.quotes(id),
  month_key date generated always as (
    make_date(
      extract(year from date)::integer,
      extract(month from date)::integer,
      1
    )
  ) stored,
  created_at timestamptz not null default now()
);

create index if not exists daily_quote_schedule_quote_id_idx
  on public.daily_quote_schedule (quote_id);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_quotes_updated_at on public.quotes;
create trigger set_quotes_updated_at
before update on public.quotes
for each row
execute function public.set_updated_at();

alter table public.quotes enable row level security;
alter table public.daily_quote_schedule enable row level security;

drop policy if exists "quotes_readable" on public.quotes;
create policy "quotes_readable"
on public.quotes
for select
to anon, authenticated
using (true);

drop policy if exists "daily_quote_schedule_readable" on public.daily_quote_schedule;
create policy "daily_quote_schedule_readable"
on public.daily_quote_schedule
for select
to anon, authenticated
using (true);

grant select on public.quotes to anon, authenticated;
grant select on public.daily_quote_schedule to anon, authenticated;
