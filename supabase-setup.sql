-- supabase-setup.sql — run this ONCE in your Supabase project
-- (Dashboard → SQL Editor → New query → paste → Run).
-- It creates the table that holds everyone's leaderboard scores.

create table if not exists public.range_scores (
  id          bigint generated always as identity primary key,
  created_at  timestamptz not null default now(),
  name        text    not null check (char_length(btrim(name)) between 1 and 16),
  stage       smallint not null check (stage between 0 and 2),
  hit_factor  real    not null check (hit_factor > 0 and hit_factor <= 40),
  score       integer not null check (score between 0 and 200),
  time        real    not null check (time between 0.3 and 60),
  penalties   integer not null check (penalties between 0 and 200)
);

-- Makes "top 10 for stage N" fast.
create index if not exists range_scores_stage_hf on public.range_scores (stage, hit_factor desc);

-- Row Level Security: the public key in game.js can ONLY read and add scores.
-- Nobody can edit or delete scores except you, from the Supabase dashboard.
alter table public.range_scores enable row level security;

drop policy if exists "Anyone can read scores" on public.range_scores;
create policy "Anyone can read scores"
  on public.range_scores for select
  to anon
  using (true);

drop policy if exists "Anyone can add a score" on public.range_scores;
create policy "Anyone can add a score"
  on public.range_scores for insert
  to anon
  with check (true);

-- Belt and braces: the public role gets no update/delete rights at all.
revoke update, delete, truncate on public.range_scores from anon;
