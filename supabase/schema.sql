-- Daily Idea Agent — Supabase Schema
-- Run this once in your Supabase SQL editor

create table if not exists ideas (
  id uuid primary key default gen_random_uuid(),
  date date not null default current_date,
  trend_source text,
  trend_title text,
  mechanic text,
  ideas_json jsonb not null,
  top_pick text,
  raw_trends jsonb,
  liked boolean,         -- null = no feedback, true = liked, false = skipped
  telegram_message_id bigint,  -- for pinning/editing messages later
  created_at timestamptz default now()
);

create index if not exists ideas_date_idx on ideas (date desc);
create index if not exists ideas_liked_idx on ideas (liked);

-- Example query: what mechanics get the most likes?
-- select mechanic, count(*) filter (where liked = true) as liked, count(*) as total
-- from ideas group by mechanic order by liked desc;
