#!/usr/bin/env bash
# birdclaw-sync.sh — pull personal Twitter timeline via birdclaw and cache in Supabase
#
# Run on a schedule (e.g. launchd every 3h, or cron):
#   */180 * * * * /path/to/idea_gen/scripts/birdclaw-sync.sh >> /tmp/birdclaw-sync.log 2>&1
#
# Requires:
#   - birdclaw installed and initialized (birdclaw init)
#   - SUPABASE_URL and SUPABASE_SERVICE_KEY in .env or environment

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="$SCRIPT_DIR/../.env"

# Load .env if present
if [[ -f "$ENV_FILE" ]]; then
  set -a
  # shellcheck source=/dev/null
  source "$ENV_FILE"
  set +a
fi

: "${SUPABASE_URL:?SUPABASE_URL not set}"
: "${SUPABASE_SERVICE_KEY:?SUPABASE_SERVICE_KEY not set}"

echo "[birdclaw-sync] $(date -u +%Y-%m-%dT%H:%M:%SZ) — syncing timeline..."

# Pull latest timeline from Twitter via birdclaw
birdclaw sync timeline --limit 200 --refresh --json 2>/dev/null || {
  echo "[birdclaw-sync] birdclaw sync failed — skipping"
  exit 0
}

# Export recent tweets as JSON (last 6 hours)
TWEETS_JSON=$(birdclaw search tweets --since "6 hours ago" --json 2>/dev/null || echo "[]")

TWEET_COUNT=$(echo "$TWEETS_JSON" | python3 -c "import sys,json; print(len(json.load(sys.stdin)))" 2>/dev/null || echo 0)
echo "[birdclaw-sync] ${TWEET_COUNT} tweets from last 6h"

if [[ "$TWEET_COUNT" -eq 0 ]]; then
  echo "[birdclaw-sync] nothing to upsert"
  exit 0
fi

# Transform birdclaw JSON → Supabase row format and upsert
ROWS=$(echo "$TWEETS_JSON" | python3 - <<'PYEOF'
import sys, json

tweets = json.load(sys.stdin)
rows = []
for t in tweets:
    # birdclaw JSON fields (adjust if schema differs across versions)
    tweet_id = str(t.get("id") or t.get("tweetId") or "")
    author   = str(t.get("username") or t.get("author") or "")
    text     = str(t.get("text") or t.get("content") or "")
    url      = f"https://x.com/{author}/status/{tweet_id}" if tweet_id and author else ""
    likes    = int(t.get("likeCount") or t.get("likes") or 0)
    retweets = int(t.get("retweetCount") or t.get("retweets") or 0)
    replies  = int(t.get("replyCount") or t.get("replies") or 0)

    if not (tweet_id and author and text and url):
        continue
    rows.append({
        "tweet_id": tweet_id,
        "author":   author,
        "text":     text[:500],
        "url":      url,
        "likes":    likes,
        "retweets": retweets,
        "replies":  replies,
    })

print(json.dumps(rows))
PYEOF
)

ROW_COUNT=$(echo "$ROWS" | python3 -c "import sys,json; print(len(json.load(sys.stdin)))" 2>/dev/null || echo 0)
echo "[birdclaw-sync] upserting ${ROW_COUNT} rows to Supabase..."

# Delete rows older than 24h first (keep table lean)
curl -s -o /dev/null -X DELETE \
  "${SUPABASE_URL}/rest/v1/twitter_feed_cache?fetched_at=lt.$(date -u -v-24H +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date -u -d '24 hours ago' +%Y-%m-%dT%H:%M:%SZ)" \
  -H "apikey: ${SUPABASE_SERVICE_KEY}" \
  -H "Authorization: Bearer ${SUPABASE_SERVICE_KEY}"

# Upsert new rows
STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X POST \
  "${SUPABASE_URL}/rest/v1/twitter_feed_cache" \
  -H "apikey: ${SUPABASE_SERVICE_KEY}" \
  -H "Authorization: Bearer ${SUPABASE_SERVICE_KEY}" \
  -H "Content-Type: application/json" \
  -H "Prefer: resolution=merge-duplicates" \
  -d "$ROWS")

echo "[birdclaw-sync] Supabase response: $STATUS"
echo "[birdclaw-sync] done"
