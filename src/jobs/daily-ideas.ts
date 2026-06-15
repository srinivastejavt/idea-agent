/**
 * Trigger.dev Cron Job — Daily Idea Generator
 * Runs 3x/day to cover all major timezones:
 *   9:00am IST  = 3:30am  UTC  (US overnight + previous evening)
 *   3:00pm IST  = 9:30am  UTC  (US morning surge + EU peak)
 *   9:00pm IST  = 3:30pm  UTC  (US afternoon + Asian evening)
 *
 * Each run fetches today's already-sent ideas from Supabase
 * and tells the LLM to skip or improve on them — no duplicates.
 */

import { schedules } from "@trigger.dev/sdk";
import { fetchTrends } from "../scraper";
import { generateDailyIdeas, pickMediaRecs } from "../prompt";
import { saveIdeas, updateFeedback, saveLikedIdea, saveLikedMedia, saveMediaRecs, getTodaysRuns, getRecentLikedIdeas, getRecentLikedMedia, computeWeeklyStats } from "../supabase";
import { sendDailyBrief, sendWeeklyDigest, parseCallback, answerCallback } from "../telegram";
import { appendTrendsToSheet, cleanupOldTabs } from "../sheets";
import { fetchRecentMedia } from "../media";

// ─── Shared run logic (used by all 3 cron tasks) ─────────────────────────────

async function runIdeaGeneration(runLabel: string, includeMedia = false, includeTrending = false) {
  console.log(`[daily-ideas] ${runLabel} run starting...`);

  // 1. Scrape trends (+ trending X category search on morning run only — saves ~$1/month)
  const { all: allTrends, top: topTrends, trendingByCategory } = await fetchTrends(includeTrending);
  if (allTrends.length === 0) {
    console.error("[daily-ideas] No trends found — aborting");
    return { success: false, reason: "no trends" };
  }

  // 2. Write all scraped posts to Google Sheets (fire-and-forget)
  appendTrendsToSheet(allTrends).catch((err) =>
    console.error("[daily-ideas] Sheets write failed (non-fatal):", err.message)
  );

  // 3. Fetch today's previous runs + liked history for context
  const [previousRuns, recentLiked] = await Promise.all([
    getTodaysRuns(),
    getRecentLikedIdeas(5),
  ]);
  // Extract only the specifically liked ideas using liked_ideas indices
  const likedIdeas = recentLiked.flatMap(r => {
    const indices: number[] = r.liked_ideas ?? [];
    const allIdeas: { name: string; description: string }[] = r.ideas_json ?? [];
    return indices
      .filter(idx => idx >= 0 && idx < allIdeas.length)
      .map(idx => ({ name: allIdeas[idx].name, description: allIdeas[idx].description }));
  }).slice(0, 8);

  console.log(`[daily-ideas] ${previousRuns.length} previous run(s) today, ${likedIdeas.length} liked ideas as style guide`);

  // 4. Generate ideas: 3 trends × 3 ideas × 2 models = 18 ideas per brief
  const result = await generateDailyIdeas(topTrends, previousRuns, likedIdeas);

  // 5. Save to Supabase
  const stored = await saveIdeas(result, topTrends);

  // 6. Fetch media recs if this is the evening run
  const mediaRecs = includeMedia
    ? await Promise.all([fetchRecentMedia(), getRecentLikedMedia()])
        .then(([items, liked]) => pickMediaRecs(result.trend, items, liked.map(l => l.show)))
        .catch(err => { console.error("[daily-ideas] media recs failed (non-fatal):", err.message); return []; })
    : [];

  // 7. Send to Telegram (trending X section included on all runs)
  const messageId = await sendDailyBrief(result, stored.id, mediaRecs, trendingByCategory);

  // 8. Update Supabase with Telegram message ID + save media recs
  const { updateTelegramMessageId } = await import("../supabase");
  await updateTelegramMessageId(stored.id, messageId);
  if (mediaRecs.length) {
    await saveMediaRecs(stored.id, mediaRecs).catch(err =>
      console.error("[daily-ideas] saveMediaRecs failed (non-fatal):", err.message)
    );
  }

  console.log(`[daily-ideas] Done. Saved ${stored.id}, Telegram msg ${messageId}`);
  return { success: true, ideaId: stored.id, messageId };
}

// ─── Run 1: 9:00am IST (3:30am UTC) ──────────────────────────────────────────

export const morningRun = schedules.task({
  id: "idea-generator-morning",
  cron: "30 2 * * *",   // 8:00am IST — HN overnight + EU early morning
  run: async () => {
    // Clean up Sheets tabs older than 7 days (morning only)
    await cleanupOldTabs().catch(err =>
      console.error("[daily-ideas] Tab cleanup failed (non-fatal):", err.message)
    );
    // includeTrending=true: category X search runs once/day here (saves ~$1.08/month vs 3×/day)
    return runIdeaGeneration("Morning (8am IST)", false, true);
  },
});

// ─── Run 2: 6:00pm IST (12:30pm UTC) ─────────────────────────────────────────

export const eveningRun = schedules.task({
  id: "idea-generator-evening",
  cron: "30 12 * * *",  // 6:00pm IST — EU full day + US pre-market buzz
  run: () => runIdeaGeneration("Evening (6pm IST)", true, true), // media recs + trending X
});

// ─── Run 3: 11:00pm IST (5:30pm UTC) ─────────────────────────────────────────

export const nightRun = schedules.task({
  id: "idea-generator-night",
  cron: "30 17 * * *",  // 11:00pm IST — US morning/afternoon peak (best run)
  run: () => runIdeaGeneration("Night (11pm IST)", false, false),
});

// ─── Weekly quality digest — every Monday 8am IST (2:30am UTC) ───────────────

export const weeklyDigestRun = schedules.task({
  id: "idea-generator-weekly-digest",
  cron: "30 2 * * 1", // Monday 8am IST
  run: async () => {
    console.log("[weekly-digest] Computing stats...");
    const stats = await computeWeeklyStats();
    await sendWeeklyDigest(stats);
    console.log("[weekly-digest] Done");
    return { success: true, totalLiked: stats.totalLiked, likeRate: stats.likeRate };
  },
});

// ─── Telegram webhook handler ─────────────────────────────────────────────────

export async function handleTelegramWebhook(body: any): Promise<void> {
  const query = body?.callback_query;
  if (!query) return;

  try {
    const parsed = parseCallback(query);

    if (parsed.type === "like_idea") {
      await saveLikedIdea(parsed.ideaId, parsed.ideaIndex);
      await answerCallback(query.id, `⭐ Saved idea #${parsed.ideaIndex + 1}`);
      console.log(`[webhook] Liked idea ${parsed.ideaIndex + 1} for ${parsed.ideaId}`);
    } else if (parsed.type === "like_media") {
      await saveLikedMedia(parsed.ideaId, parsed.mediaIndex);
      await answerCallback(query.id, "❤️ Saved — will recommend this show more");
      console.log(`[webhook] Liked media ${parsed.mediaIndex} for ${parsed.ideaId}`);
    } else {
      await updateFeedback(parsed.ideaId, false);
      await answerCallback(query.id, "Fair enough 👍");
      console.log(`[webhook] Skipped batch: ${parsed.ideaId}`);
    }
  } catch (err) {
    console.error("[webhook] Failed to process callback:", err);
    await answerCallback(query.id, "Something went wrong");
  }
}
