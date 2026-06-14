/**
 * Supabase Storage Module
 * Persist ideas and track feedback (liked/skipped)
 */

import { createClient } from "@supabase/supabase-js";
import type { IdeaResult } from "./prompt";
import type { TrendPost } from "./scraper";

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
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
  telegram_message_id: number | null;
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

export async function getRecentLikedIdeas(limit = 5): Promise<StoredIdea[]> {
  const { data, error } = await supabase
    .from("ideas")
    .select("*")
    .eq("liked", true)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) throw new Error(`Supabase query failed: ${error.message}`);
  return data ?? [];
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
