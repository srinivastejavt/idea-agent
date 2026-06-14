/**
 * Supabase Storage Module
 * Persist ideas and track feedback (liked/skipped)
 */

import { createClient } from "@supabase/supabase-js";
import ws from "ws";
import type { IdeaResult } from "./prompt";
import type { TrendPost } from "./scraper";

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!,
  {
    auth: { persistSession: false },
    realtime: { transport: ws },
  }
);

export interface StoredIdea {
  id: string;
  date: string;
  trend_source: string;
  trend_title: string;
  mechanic: string;
  ideas_json: IdeaResult["ideas"];
  top_pick: string;
  liked: boolean | null;
  liked_ideas: number[] | null;
  telegram_message_id: number | null;
  media_recs_json: { show: string; title: string; url: string; type: string }[] | null;
  liked_media: number[] | null;
}

// ─── Save today's ideas ───────────────────────────────────────────────────────

export async function saveIdeas(
  result: IdeaResult,
  rawTrends: TrendPost[],
  telegramMessageId?: number
): Promise<StoredIdea> {
  const { data, error } = await supabase
    .from("ideas")
    .insert({
      trend_source: result.trendSource,
      trend_title: result.trend,
      mechanic: result.mechanic,
      ideas_json: result.ideas,
      top_pick: result.topPick,
      raw_trends: rawTrends,
      telegram_message_id: telegramMessageId ?? null,
      liked: null,
    })
    .select()
    .single();

  if (error) throw new Error(`Supabase insert failed: ${error.message}`);
  return data;
}

// ─── Update feedback ──────────────────────────────────────────────────────────

export async function updateFeedback(id: string, liked: boolean): Promise<void> {
  const { error } = await supabase
    .from("ideas")
    .update({ liked })
    .eq("id", id);

  if (error) throw new Error(`Supabase update failed: ${error.message}`);
  console.log(`[supabase] Feedback saved: ${id} → liked=${liked}`);
}

// ─── Fetch recent ideas (for learning / context) ──────────────────────────────

export async function getRecentLikedIdeas(limit = 10): Promise<StoredIdea[]> {
  // Query rows where the user tapped specific ideas (liked_ideas array is non-empty)
  const { data, error } = await supabase
    .from("ideas")
    .select("*")
    .not("liked_ideas", "is", null)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) throw new Error(`Supabase query failed: ${error.message}`);
  return (data ?? []).filter(r => Array.isArray(r.liked_ideas) && r.liked_ideas.length > 0);
}

// ─── Get today's previous runs (trends + ideas) for deduplication ────────────

export interface PreviousRun {
  trend: string;
  mechanic: string;
  ideas: { name: string; description: string }[];
}

export async function getTodaysRuns(): Promise<PreviousRun[]> {
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const { data, error } = await supabase
    .from("ideas")
    .select("trend_title, mechanic, ideas_json")
    .gte("created_at", todayStart.toISOString())
    .order("created_at", { ascending: true });

  if (error || !data) return [];

  return data.map(row => ({
    trend: row.trend_title,
    mechanic: row.mechanic,
    ideas: (row.ideas_json ?? []).map((idea: { name: string; description: string }) => ({
      name: idea.name,
      description: idea.description,
    })),
  }));
}

// ─── Save per-idea feedback ───────────────────────────────────────────────────

export async function saveLikedIdea(id: string, ideaIndex: number): Promise<void> {
  // Fetch current liked_ideas array, then append if not already present
  const { data } = await supabase
    .from("ideas")
    .select("liked_ideas")
    .eq("id", id)
    .single();

  const current: number[] = data?.liked_ideas ?? [];
  if (current.includes(ideaIndex)) return; // already saved

  const { error } = await supabase
    .from("ideas")
    .update({ liked_ideas: [...current, ideaIndex] })
    .eq("id", id);

  if (error) throw new Error(`Supabase saveLikedIdea failed: ${error.message}`);
  console.log(`[supabase] Saved liked idea index ${ideaIndex} for ${id}`);
}

// ─── Save media recs for the run ─────────────────────────────────────────────

export async function saveMediaRecs(
  id: string,
  recs: { show: string; title: string; url: string; type: string }[]
): Promise<void> {
  const { error } = await supabase
    .from("ideas")
    .update({ media_recs_json: recs })
    .eq("id", id);
  if (error) throw new Error(`Supabase saveMediaRecs failed: ${error.message}`);
}

// ─── Save liked media index ───────────────────────────────────────────────────

export async function saveLikedMedia(id: string, mediaIndex: number): Promise<void> {
  const { data } = await supabase
    .from("ideas")
    .select("liked_media")
    .eq("id", id)
    .single();

  const current: number[] = data?.liked_media ?? [];
  if (current.includes(mediaIndex)) return;

  const { error } = await supabase
    .from("ideas")
    .update({ liked_media: [...current, mediaIndex] })
    .eq("id", id);

  if (error) throw new Error(`Supabase saveLikedMedia failed: ${error.message}`);
  console.log(`[supabase] Saved liked media index ${mediaIndex} for ${id}`);
}

// ─── Get recent liked media (for future rec bias) ────────────────────────────

export async function getRecentLikedMedia(limit = 10): Promise<{ show: string; title: string }[]> {
  const { data, error } = await supabase
    .from("ideas")
    .select("media_recs_json, liked_media")
    .not("liked_media", "is", null)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) return [];

  return (data ?? []).flatMap(r => {
    const indices: number[] = r.liked_media ?? [];
    const recs: { show: string; title: string }[] = r.media_recs_json ?? [];
    return indices
      .filter(i => i >= 0 && i < recs.length)
      .map(i => ({ show: recs[i].show, title: recs[i].title }));
  });
}

// ─── Update Telegram message ID ──────────────────────────────────────────────

export async function updateTelegramMessageId(id: string, messageId: number): Promise<void> {
  const { error } = await supabase
    .from("ideas")
    .update({ telegram_message_id: messageId })
    .eq("id", id);
  if (error) throw new Error(`Supabase update telegram_message_id failed: ${error.message}`);
}

// ─── Weekly quality stats ─────────────────────────────────────────────────────

export interface WeeklyStats {
  totalRuns:       number;
  totalIdeas:      number;
  totalLiked:      number;
  likeRate:        number;           // 0-1
  byCategory:      Record<string, number>; // category → liked count
  topKeywords:     string[];         // most common words in liked idea names
  prevWeekRate:    number | null;    // like rate from prior week for comparison
}

export async function computeWeeklyStats(): Promise<WeeklyStats> {
  const now = new Date();
  const weekAgo  = new Date(now.getTime() - 7  * 24 * 60 * 60 * 1000);
  const twoWeeksAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);

  // This week
  const { data: thisWeek } = await supabase
    .from("ideas")
    .select("ideas_json, liked_ideas")
    .gte("created_at", weekAgo.toISOString())
    .order("created_at", { ascending: false });

  // Previous week (for trend comparison)
  const { data: lastWeek } = await supabase
    .from("ideas")
    .select("ideas_json, liked_ideas")
    .gte("created_at", twoWeeksAgo.toISOString())
    .lt("created_at", weekAgo.toISOString());

  const rows = thisWeek ?? [];
  const totalRuns  = rows.length;
  const totalIdeas = rows.reduce((sum, r) => sum + (r.ideas_json?.length ?? 0), 0);

  // Collect liked ideas
  const likedIdeas: { name: string; category?: string }[] = [];
  for (const row of rows) {
    const indices: number[] = row.liked_ideas ?? [];
    const ideas: { name: string; category?: string }[] = row.ideas_json ?? [];
    for (const idx of indices) {
      if (ideas[idx]) likedIdeas.push(ideas[idx]);
    }
  }

  // By category
  const byCategory: Record<string, number> = {};
  for (const idea of likedIdeas) {
    const cat = idea.category ?? "other";
    byCategory[cat] = (byCategory[cat] ?? 0) + 1;
  }

  // Top keywords from liked idea names
  const stopwords = new Set(["a","an","the","and","or","for","to","of","in","on","with","that","this","is","are","it","as","by","at","from","your","you","how","what","build","tool","app","platform"]);
  const wordFreq: Record<string, number> = {};
  for (const idea of likedIdeas) {
    for (const word of idea.name.toLowerCase().split(/\W+/)) {
      if (word.length > 3 && !stopwords.has(word)) {
        wordFreq[word] = (wordFreq[word] ?? 0) + 1;
      }
    }
  }
  const topKeywords = Object.entries(wordFreq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([w]) => w);

  // Prev week like rate
  const prevRows = lastWeek ?? [];
  const prevTotal = prevRows.reduce((sum, r) => sum + (r.ideas_json?.length ?? 0), 0);
  const prevLiked = prevRows.reduce((sum, r) => sum + (r.liked_ideas?.length ?? 0), 0);
  const prevWeekRate = prevTotal > 0 ? prevLiked / prevTotal : null;

  return {
    totalRuns,
    totalIdeas,
    totalLiked: likedIdeas.length,
    likeRate: totalIdeas > 0 ? likedIdeas.length / totalIdeas : 0,
    byCategory,
    topKeywords,
    prevWeekRate,
  };
}

// ─── Get by Telegram message ID (for callback routing) ───────────────────────

export async function getByTelegramMessageId(
  messageId: number
): Promise<StoredIdea | null> {
  const { data, error } = await supabase
    .from("ideas")
    .select("*")
    .eq("telegram_message_id", messageId)
    .single();

  if (error) return null;
  return data;
}
