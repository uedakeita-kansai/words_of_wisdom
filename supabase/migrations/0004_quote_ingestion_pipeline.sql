-- Monthly quote ingestion pipeline (staging -> validation -> promotion).
create extension if not exists pgcrypto;

alter table public.quotes
  add column if not exists source_url text;

alter table public.quotes
  add column if not exists quote_fingerprint text generated always as (
    md5(
      lower(trim(coalesce(original_text, ''))) || '|' ||
      lower(trim(coalesce(speaker_name, ''))) || '|' ||
      lower(trim(coalesce(source, '')))
    )
  ) stored;

create unique index if not exists quotes_quote_fingerprint_key
  on public.quotes (quote_fingerprint);

create table if not exists public.quote_ingestion_runs (
  id uuid primary key default gen_random_uuid(),
  source text not null default 'monthly_job',
  status text not null default 'running'
    check (status in ('running', 'completed', 'failed')),
  input_count integer not null default 0 check (input_count >= 0),
  inserted_count integer not null default 0 check (inserted_count >= 0),
  validated_count integer not null default 0 check (validated_count >= 0),
  rejected_count integer not null default 0 check (rejected_count >= 0),
  promoted_count integer not null default 0 check (promoted_count >= 0),
  error_message text,
  started_at timestamptz not null default now(),
  finished_at timestamptz
);

create table if not exists public.quote_candidates (
  id bigint generated always as identity primary key,
  run_id uuid not null references public.quote_ingestion_runs(id) on delete cascade,
  original_text text not null,
  speaker_name text not null,
  source text not null,
  source_url text,
  ja_translation text,
  en_translation text,
  birth_year integer,
  death_year integer,
  status text not null default 'pending'
    check (status in ('pending', 'validated', 'rejected', 'promoted')),
  rejected_reason text,
  metadata jsonb not null default '{}'::jsonb,
  quote_fingerprint text generated always as (
    md5(
      lower(trim(coalesce(original_text, ''))) || '|' ||
      lower(trim(coalesce(speaker_name, ''))) || '|' ||
      lower(trim(coalesce(source, '')))
    )
  ) stored,
  created_at timestamptz not null default now(),
  validated_at timestamptz,
  promoted_at timestamptz,
  constraint quote_candidates_birth_death_check
    check (birth_year is null or death_year is null or birth_year <= death_year)
);

create index if not exists quote_candidates_run_id_idx
  on public.quote_candidates (run_id);

create index if not exists quote_candidates_run_status_idx
  on public.quote_candidates (run_id, status);

create unique index if not exists quote_candidates_run_fingerprint_key
  on public.quote_candidates (run_id, quote_fingerprint);

create or replace function public.create_quote_ingestion_run(
  p_source text default 'monthly_job',
  p_input_count integer default 0
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_run_id uuid;
begin
  insert into public.quote_ingestion_runs (source, status, input_count)
  values (coalesce(nullif(trim(p_source), ''), 'monthly_job'), 'running', greatest(p_input_count, 0))
  returning id into v_run_id;

  return v_run_id;
end;
$$;

create or replace function public.complete_quote_ingestion_run(
  p_run_id uuid,
  p_status text,
  p_inserted_count integer,
  p_validated_count integer,
  p_rejected_count integer,
  p_promoted_count integer,
  p_error_message text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.quote_ingestion_runs
  set
    status = case when p_status in ('running', 'completed', 'failed') then p_status else 'failed' end,
    inserted_count = greatest(coalesce(p_inserted_count, 0), 0),
    validated_count = greatest(coalesce(p_validated_count, 0), 0),
    rejected_count = greatest(coalesce(p_rejected_count, 0), 0),
    promoted_count = greatest(coalesce(p_promoted_count, 0), 0),
    error_message = p_error_message,
    finished_at = now()
  where id = p_run_id;
end;
$$;

create or replace function public.validate_quote_candidates(p_run_id uuid)
returns table (
  validated_count integer,
  rejected_count integer
)
language plpgsql
security definer
set search_path = public
as $$
begin
  -- 1) Reject duplicates inside the same run (keep the first row).
  with ranked as (
    select
      c.id,
      row_number() over (
        partition by c.quote_fingerprint
        order by c.id asc
      ) as rn
    from public.quote_candidates c
    where c.run_id = p_run_id
      and c.status = 'pending'
  )
  update public.quote_candidates c
  set
    status = 'rejected',
    rejected_reason = 'Duplicate quote in the same run',
    validated_at = now()
  from ranked r
  where c.id = r.id
    and r.rn > 1;

  -- 2) Reject rows with missing required fields.
  update public.quote_candidates c
  set
    status = 'rejected',
    rejected_reason = 'Missing required fields',
    validated_at = now()
  where c.run_id = p_run_id
    and c.status = 'pending'
    and (
      nullif(trim(coalesce(c.ja_translation, '')), '') is null or
      nullif(trim(coalesce(c.en_translation, '')), '') is null or
      nullif(trim(coalesce(c.original_text, '')), '') is null or
      nullif(trim(coalesce(c.speaker_name, '')), '') is null or
      nullif(trim(coalesce(c.source, '')), '') is null
    );

  -- 3) Reject invalid year ranges.
  update public.quote_candidates c
  set
    status = 'rejected',
    rejected_reason = 'Invalid birth/death year range',
    validated_at = now()
  where c.run_id = p_run_id
    and c.status = 'pending'
    and c.birth_year is not null
    and c.death_year is not null
    and c.birth_year > c.death_year;

  -- 4) Reject rows already in quotes.
  update public.quote_candidates c
  set
    status = 'rejected',
    rejected_reason = 'Already exists in quotes',
    validated_at = now()
  where c.run_id = p_run_id
    and c.status = 'pending'
    and exists (
      select 1
      from public.quotes q
      where q.quote_fingerprint = c.quote_fingerprint
    );

  -- 5) Validate the remaining rows.
  update public.quote_candidates c
  set
    status = 'validated',
    rejected_reason = null,
    validated_at = now()
  where c.run_id = p_run_id
    and c.status = 'pending';

  return query
  select
    count(*) filter (where c.status = 'validated')::integer as validated_count,
    count(*) filter (where c.status = 'rejected')::integer as rejected_count
  from public.quote_candidates c
  where c.run_id = p_run_id;
end;
$$;

create or replace function public.promote_quote_candidates(p_run_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_current_max integer;
  v_promoted integer := 0;
begin
  select coalesce(max(q.display_order), 0)
    into v_current_max
  from public.quotes q;

  with to_promote as (
    select
      c.id,
      c.quote_fingerprint,
      row_number() over (order by c.id asc) as rn,
      c.ja_translation,
      c.en_translation,
      c.original_text,
      c.speaker_name,
      c.birth_year,
      c.death_year,
      c.source,
      c.source_url
    from public.quote_candidates c
    where c.run_id = p_run_id
      and c.status = 'validated'
  ),
  inserted as (
    insert into public.quotes (
      display_order,
      ja_translation,
      en_translation,
      original_text,
      speaker_name,
      birth_year,
      death_year,
      source,
      source_url,
      is_active
    )
    select
      v_current_max + tp.rn,
      tp.ja_translation,
      tp.en_translation,
      tp.original_text,
      tp.speaker_name,
      tp.birth_year,
      tp.death_year,
      tp.source,
      tp.source_url,
      true
    from to_promote tp
    on conflict (quote_fingerprint) do nothing
    returning quote_fingerprint
  )
  update public.quote_candidates c
  set
    status = 'promoted',
    promoted_at = now()
  where c.run_id = p_run_id
    and c.status = 'validated'
    and c.quote_fingerprint in (select i.quote_fingerprint from inserted i);

  get diagnostics v_promoted = row_count;

  -- Any remaining validated rows were conflicts at insert-time.
  update public.quote_candidates c
  set
    status = 'rejected',
    rejected_reason = 'Conflict at promote time',
    validated_at = now()
  where c.run_id = p_run_id
    and c.status = 'validated';

  return v_promoted;
end;
$$;

revoke execute on function public.create_quote_ingestion_run(text, integer) from public, anon, authenticated;
revoke execute on function public.complete_quote_ingestion_run(uuid, text, integer, integer, integer, integer, text) from public, anon, authenticated;
revoke execute on function public.validate_quote_candidates(uuid) from public, anon, authenticated;
revoke execute on function public.promote_quote_candidates(uuid) from public, anon, authenticated;

grant execute on function public.create_quote_ingestion_run(text, integer) to service_role;
grant execute on function public.complete_quote_ingestion_run(uuid, text, integer, integer, integer, integer, text) to service_role;
grant execute on function public.validate_quote_candidates(uuid) to service_role;
grant execute on function public.promote_quote_candidates(uuid) to service_role;
