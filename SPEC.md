# Daily Trend Idea Generator Agent — Technical Spec

## What It Does

A Trigger.dev cron job that fires daily at 9am IST. It scrapes trending content from HackerNews, Reddit, X, and ProductHunt — extracts the virality mechanic behind each trend — then uses Claude to generate 5 tool ideas in Srini's voice and drops them to Telegram.

---

## Architecture

```
Trigger.dev (cron: 9am IST)
    │
    ├── scraper.ts          ← Pull trending posts from HN, Reddit, X, PH
    │
    ├── prompt.ts           ← Claude: extract patterns → generate 5 ideas
    │
    ├── supabase.ts         ← Store ideas + track feedback (liked: bool)
    │
    └── telegram.ts         ← Format + send daily brief with inline buttons
                                    │
                                    └── Callback handler ← thumbs up/down updates Supabase
```

---

## Data Flow

1. Scraper fetches last 24h of trending posts across sources
2. Posts are ranked/filtered by virality signals (upvotes, comments, recency)
3. Top 20 posts passed to Claude with system prompt + voice reference
4. Claude returns: top trend, pattern mechanic, 5 ideas, top pick
5. Ideas stored to Supabase `ideas` table
6. Telegram message sent with inline ✅/❌ buttons per idea
7. User taps button → webhook updates `liked` field in Supabase

---

## Supabase Schema

```sql
create table ideas (
  id uuid primary key default gen_random_uuid(),
  date date not null default current_date,
  trend_source text,            -- 'hackernews' | 'reddit' | 'twitter' | 'producthunt'
  trend_title text,             -- what blew up
  mechanic text,                -- leaderboard | roast | weird_data_combo | relatable_truth
  ideas_json jsonb not null,    -- array of {name, description, weekend_build}
  top_pick text,                -- which idea to build first
  raw_trends jsonb,             -- raw scraped posts for debugging
  liked boolean,                -- null = no feedback, true = liked, false = disliked
  created_at timestamptz default now()
);

create index on ideas (date desc);
create index on ideas (liked);
```

---

## Stack & Environment Variables

| Variable | Description |
|---|---|
| `ANTHROPIC_API_KEY` | Claude API |
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_SERVICE_KEY` | Supabase service role key |
| `TELEGRAM_BOT_TOKEN` | Telegram bot token |
| `TELEGRAM_CHAT_ID` | Your personal chat ID |
| `APIFY_API_TOKEN` | For X / ProductHunt scraping (Phase 2) |
| `TRIGGER_SECRET_KEY` | Trigger.dev project secret |

---

## Scraping Strategy

### Phase 1 (start here — zero cost, zero rate limits)
- **HackerNews**: Official Algolia API — `https://hn.algolia.com/api/v1/search_by_date?tags=show_hn&hitsPerPage=30`
- **Reddit**: RSS feeds — `https://www.reddit.com/r/{sub}/top/.json?t=day&limit=25`
  - Subreddits: `programming`, `entrepreneur`, `wallstreetbets`, `crypto`

### Phase 2 (add when Phase 1 is working)
- **X / Twitter**: Apify actor `apidojo/tweet-scraper` — search trending keywords
- **ProductHunt**: Apify actor `code-and-chill/producthunt-scraper` or PH GraphQL API

---

## Claude Prompt Design

Two-call approach:
1. **Extraction call**: Given raw posts, return top 5 trends + mechanic classification
2. **Generation call**: Given trends + mechanic + personal data sources + voice examples, return 5 ideas

Voice reference (feed as few-shot examples in system prompt):
> "Built a tool that ranks your group chats by how much they spike your cortisol. Telegram + Whoop. Your crypto group is killing you."
> "What if your calendar could tell you which coworker costs you the most in therapy bills. Built it."

---

## Telegram Output Format

```
🔥 TREND: [what blew up + why — 1 line]

🧠 PATTERN: [mechanic — leaderboard / roast / weird data combo]

💡 IDEAS FOR TODAY:

1. [Tool name] — [one line] [weekend? Y/N]
2. [Tool name] — [one line] [weekend? Y/N]
3. [Tool name] — [one line] [weekend? Y/N]
4. [Tool name] — [one line] [weekend? Y/N]
5. [Tool name] — [one line] [weekend? Y/N]

⚡ TOP PICK: [which one + why]
```

Each idea gets inline keyboard buttons: `✅ Build this` / `❌ Skip`

---

## File Structure

```
idea-agent/
├── src/
│   ├── jobs/
│   │   └── daily-ideas.ts      ← Trigger.dev cron job (orchestrator)
│   ├── scraper.ts              ← HN + Reddit (+ Apify stubs)
│   ├── prompt.ts               ← Claude extraction + generation
│   ├── supabase.ts             ← DB helpers
│   └── telegram.ts             ← Send message + webhook handler
├── supabase/
│   └── schema.sql              ← Run this once to set up the table
├── .env.example
├── package.json
└── trigger.config.ts
```

---

## First Thing to Test

Run `scraper.ts` standalone — confirm HN + Reddit posts are coming through with good signal before touching Claude or Telegram. Cheapest feedback loop.
