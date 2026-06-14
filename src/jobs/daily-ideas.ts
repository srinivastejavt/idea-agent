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
import { saveIdeas, updateFeedback, saveLikedIdea, getTodaysRuns, getRecentLikedIdeas } from "../supabase";
import { sendDailyBrief, parseCallback, answerCallback } from "../telegram";
import { appendTrendsToSheet, cleanupOldTabs } from "../sheets";
import { fetchRecentMedia } from "../media";

// ─── Shared run logic (used by all 3 cron tasks) ─────────────────────────────

async function runIdeaGeneration(runLabel: string, includeMedia = false) {
  console.log(`[daily-ideas] ${runLabel} run starting...`);

  // 1. Scrape trends
  const { all: allTrends, top: topTrends } = await fetchTrends();
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
  const likedIdeas = recentLiked.flatMap(r =>
    (r.ideas_json ?? []).map((i: { name: string; description: string }) => ({
      name: i.name,
      description: i.description,
    }))
  ).slice(0, 5);

  console.log(`[daily-ideas] ${previousRuns.length} previous run(s) today, ${likedIdeas.length} liked ideas as style guide`);

  // 4. Generate ideas: 3 trends × 3 ideas × 2 models = 18 ideas per brief
  const result = await generateDailyIdeas(topTrends, previousRuns, likedIdeas);

  // 5. Save to Supabase
  const stored = await saveIdeas(result, topTrends);

  // 6. Fetch media recs in parallel if this is the evening run
  const mediaRecs = includeMedia
    ? await fetchRecentMedia()
        .then(items => pickMediaRecs(result.trend, items))
        .catch(err => { console.error("[daily-ideas] media recs failed (non-fatal):", err.message); return []; })
    : [];

  // 7. Send to Telegram
  const messageId = await sendDailyBrief(result, stored.id, mediaRecs);

  // 8. Update Supabase with Telegram message ID (reuse supabase module)
  const { updateTelegramMessageId } = await import("../supabase");
  await updateTelegramMessageId(stored.id, messageId);

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
    return runIdeaGeneration("Morning (8am IST)");
  },
});

// ─── Run 2: 6:00pm IST (12:30pm UTC) ─────────────────────────────────────────

export const eveningRun = schedules.task({
  id: "idea-generator-evening",
  cron: "30 12 * * *",  // 6:00pm IST — EU full day + US pre-market buzz
  run: () => runIdeaGeneration("Evening (6pm IST)", true), // true = include media recs
});

// ─── Run 3: 11:00pm IST (5:30pm UTC) ─────────────────────────────────────────

export const nightRun = schedules.task({
  id: "idea-generator-night",
  cron: "30 17 * * *",  // 11:00pm IST — US morning/afternoon peak (best run)
  run: () => runIdeaGeneration("Night (11pm IST)"),
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
