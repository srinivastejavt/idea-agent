/**
 * Telegram Delivery Module
 * Sends the daily brief and handles per-idea feedback callbacks
 */

import type { IdeaResult, Idea, MediaRec, IdeaEval } from "./prompt";
import type { TrendingPost } from "./scraper";

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN!;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID!;
const BASE_URL = `https://api.telegram.org/bot${BOT_TOKEN}`;

// ─── Format message ───────────────────────────────────────────────────────────

export function formatDailyBrief(result: IdeaResult): string {
  const date = new Date().toLocaleDateString("en-US", {
    weekday: "short", month: "short", day: "numeric",
  });

  const lines: string[] = [`📅 *${date} — Idea Brief*`];

  const categories: Array<{ key: "ai" | "crypto" | "security" | "other"; emoji: string; label: string }> = [
    { key: "ai",       emoji: "🤖", label: "AI"       },
    { key: "crypto",   emoji: "₿",  label: "CRYPTO"   },
    { key: "security", emoji: "🔐", label: "SECURITY" },
    { key: "other",    emoji: "🌐", label: "OTHER"    },
  ];

  // Number ideas globally so buttons match
  let globalIdx = 1;

  for (const { key, emoji, label } of categories) {
    const catIdeas = result.ideas.filter(i => (i.category ?? "other") === key);
    if (catIdeas.length === 0) continue;

    const headlines = result.trendsByCategory[key];

    lines.push("", `━━━ ${emoji} *${label}* ━━━`);
    // One headline for context, then straight into ideas (no model sub-headers)
    if (headlines[0]) lines.push(`_${headlines[0]}_`);
    lines.push("");

    for (const idea of catIdeas) {
      lines.push(`${globalIdx++}\\. *${idea.name}* ${idea.weekendBuild ? "🟢" : "🔴"} — ${idea.description}`);
    }
  }

  lines.push("", "─────────────────");
  lines.push(`⚡ *TOP PICK:* ${result.topPick}`);

  if (result.sources?.length) {
    lines.push("", "📰 *Sources*");
    for (const s of result.sources) {
      lines.push(`• [${s.title.slice(0, 55)}](${s.url})`);
    }
  }

  return lines.join("\n");
}

// ─── Format + send tweet angles as standalone message ─────────────────────────

export function formatTweetAngles(tweetIdeas: IdeaResult["tweetIdeas"]): string {
  if (!tweetIdeas?.length) return "";

  const CAT_EMOJI: Record<string, string> = {
    ai: "🤖", crypto: "₿", security: "🔐", other: "🌐",
  };

  const lines = [
    "🐦 *TWEET ANGLES*",
    "_Pick one → open Claude chat → make it yours_",
  ];

  for (const { trend, angles, category, sourceUrl, sourceTitle } of tweetIdeas) {
    const catLabel = category ? `${CAT_EMOJI[category] ?? "🌐"} *${category.toUpperCase()}*` : "";
    const trendLine = sourceUrl
      ? `📌 [${trend}](${sourceUrl})`
      : `📌 _${trend}_`;

    lines.push("");
    if (catLabel) lines.push(catLabel);
    lines.push(trendLine);

    // Show source article title as a "why you're seeing this" link
    if (sourceTitle && sourceUrl) {
      const shortTitle = sourceTitle.length > 70 ? sourceTitle.slice(0, 70) + "…" : sourceTitle;
      lines.push(`_📰 [${shortTitle}](${sourceUrl})_`);
    }

    for (const angle of angles) {
      lines.push(`• ${angle}`);
    }
  }
  return lines.join("\n");
}

export async function sendTweetAngles(tweetIdeas: IdeaResult["tweetIdeas"]): Promise<void> {
  if (!tweetIdeas?.length) return;
  const text = formatTweetAngles(tweetIdeas);
  if (!text) return;
  const chunks = chunkText(text);
  for (const chunk of chunks) await sendMessage(chunk);
  console.log(`[telegram] Tweet angles sent: ${tweetIdeas.length} trends (${chunks.length} chunk(s))`);
}

// ─── Format trending X section ───────────────────────────────────────────────

export function formatTrendingOnX(
  trending: { ai?: TrendingPost; crypto?: TrendingPost; security?: TrendingPost }
): string {
  const entries: { emoji: string; label: string; post: TrendingPost }[] = [];
  if (trending.ai)       entries.push({ emoji: "🤖", label: "AI",       post: trending.ai });
  if (trending.crypto)   entries.push({ emoji: "₿",  label: "CRYPTO",   post: trending.crypto });
  if (trending.security) entries.push({ emoji: "🔐", label: "SECURITY", post: trending.security });
  if (!entries.length) return "";

  const lines = ["🔥 *WHAT'S HOT RIGHT NOW*", ""];
  for (const { emoji, label, post } of entries) {
    const isTwitter = post.source === "twitter";
    const engagement = post.views
      ? `${(post.views / 1000).toFixed(0)}K views`
      : post.likes > 0
        ? `${(post.likes / 1000).toFixed(1)}K likes`
        : `${post.points} pts`;
    const snippet = post.title.length > 120
      ? post.title.slice(0, 120).trimEnd() + "…"
      : post.title;
    const sourceLabel = isTwitter ? `@${post.author}` : post.source;
    lines.push(`${emoji} *${label}* · ${sourceLabel} · _${engagement}_`);
    lines.push(`"${snippet}"`);
    lines.push(`[→ open](${post.url})`);
    lines.push("");
  }
  return lines.join("\n").trim();
}

// ─── Build per-idea feedback keyboard ────────────────────────────────────────

function buildIdeaButtons(totalIdeas: number, ideaId: string) {
  const rows: { text: string; callback_data: string }[][] = [];
  const ROW_SIZE = 6;

  for (let i = 0; i < totalIdeas; i += ROW_SIZE) {
    rows.push(
      Array.from({ length: Math.min(ROW_SIZE, totalIdeas - i) }, (_, j) => ({
        text: String(i + j + 1),
        callback_data: `like_idea:${ideaId}:${i + j}`,
      }))
    );
  }
  rows.push([{ text: "❌ None of these", callback_data: `skip:${ideaId}` }]);

  return { inline_keyboard: rows };
}

// ─── Send message ─────────────────────────────────────────────────────────────

const MAX_TG_LENGTH = 4096;

function chunkText(text: string): string[] {
  if (text.length <= MAX_TG_LENGTH) return [text];
  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > 0) {
    if (remaining.length <= MAX_TG_LENGTH) { chunks.push(remaining); break; }
    let splitAt = remaining.lastIndexOf("\n", MAX_TG_LENGTH);
    if (splitAt === -1) splitAt = MAX_TG_LENGTH;
    chunks.push(remaining.slice(0, splitAt));
    remaining = remaining.slice(splitAt).trimStart();
  }
  return chunks;
}

async function sendMessage(
  text: string,
  options: Record<string, unknown> = {}
): Promise<number> {
  const res = await fetch(`${BASE_URL}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: CHAT_ID, text, parse_mode: "Markdown", ...options }),
  });
  const data = await res.json();
  if (!data.ok) throw new Error(`Telegram sendMessage failed: ${JSON.stringify(data)}`);
  return data.result.message_id;
}

// HTML mode — avoids Markdown breaking on underscores in podcast titles
export function formatMediaRecs(recs: MediaRec[]): string {
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const lines: string[] = ["🎧 <b>WATCH / LISTEN TONIGHT</b>", "<i>Picked based on today's trends</i>", ""];
  for (const rec of recs) {
    const icon = rec.type === "youtube" ? "▶️" : "🎙";
    lines.push(`${icon} <b>${esc(rec.show)}</b>`);
    lines.push(`<a href="${rec.url}">${esc(rec.title.slice(0, 80))}</a>`);
    lines.push(`<i>${esc(rec.reason)}</i>`);
    lines.push("");
  }
  return lines.join("\n").trim();
}

function buildMediaButtons(recs: MediaRec[], ideaId: string) {
  const ROW_SIZE = 3;
  const rows: { text: string; callback_data: string }[][] = [];
  for (let i = 0; i < recs.length; i += ROW_SIZE) {
    rows.push(
      recs.slice(i, i + ROW_SIZE).map((rec, j) => ({
        text: `❤️ ${rec.show}`,
        callback_data: `like_media:${ideaId}:${i + j}`,
      }))
    );
  }
  return { inline_keyboard: rows };
}

// ─── Send trending X as a standalone message (called independently) ───────────

export async function sendTrendingOnX(
  trending: { ai?: TrendingPost; crypto?: TrendingPost; security?: TrendingPost }
): Promise<void> {
  if (!trending.ai && !trending.crypto && !trending.security) return;
  const text = formatTrendingOnX(trending);
  if (!text) return;
  await sendMessage(text);
  console.log("[telegram] Trending on X sent as standalone message");
}

// ─── Hamming filter — which ideas are actually worth building? ────────────────

export function formatIdeaEval(ideaEval: IdeaEval[]): string {
  if (!ideaEval?.length) return "";
  const lines = [
    "🔬 *HAMMING FILTER*",
    "_What's the important problem — and why aren't you working on it?_",
  ];
  for (const pick of ideaEval) {
    lines.push(`\n💡 *${pick.name}*`);
    lines.push(`❓ *Why:* ${pick.why}`);
    lines.push(`✅ *Must believe:* ${pick.belief}`);
    lines.push(`☠️ *Kill if:* ${pick.killCondition}`);
  }
  return lines.join("\n");
}

export async function sendIdeaEval(ideaEval: IdeaEval[]): Promise<void> {
  if (!ideaEval?.length) return;
  const text = formatIdeaEval(ideaEval);
  if (!text) return;
  await sendMessage(text);
  console.log(`[telegram] Hamming filter sent: ${ideaEval.length} picks`);
}

export async function sendDailyBrief(
  result: IdeaResult,
  ideaId: string,
  mediaRecs?: MediaRec[]
): Promise<number> {
  const text = formatDailyBrief(result);
  const chunks = chunkText(text);

  let lastMessageId = 0;
  for (let i = 0; i < chunks.length; i++) {
    lastMessageId = await sendMessage(chunks[i]);
    console.log(`[telegram] Message chunk ${i + 1}/${chunks.length} sent: ${lastMessageId}`);
  }

  // Send separate per-idea feedback message
  const feedbackMsg = await sendMessage(
    `💬 *Which ideas resonated?*\nTap the numbers to save them:`,
    { reply_markup: buildIdeaButtons(result.ideas.length, ideaId) }
  );
  console.log(`[telegram] Feedback buttons sent: ${feedbackMsg}`);

  // Send media recs as a separate message with like buttons (evening run only)
  if (mediaRecs?.length) {
    await sendMessage(formatMediaRecs(mediaRecs), {
      parse_mode: "HTML",
      reply_markup: buildMediaButtons(mediaRecs, ideaId),
    });
    console.log(`[telegram] Media recs sent: ${mediaRecs.length} picks`);
  }

  return lastMessageId;
}

// ─── Weekly quality digest ────────────────────────────────────────────────────

export async function sendWeeklyDigest(stats: import("./supabase").WeeklyStats): Promise<void> {
  const pct = (stats.likeRate * 100).toFixed(0);
  const prevPct = stats.prevWeekRate !== null ? (stats.prevWeekRate * 100).toFixed(0) : null;
  const trend = prevPct === null
    ? ""
    : stats.likeRate > stats.prevWeekRate!
      ? ` ↑ up from ${prevPct}% last week`
      : stats.likeRate < stats.prevWeekRate!
        ? ` ↓ down from ${prevPct}% last week`
        : " → same as last week";

  const topCat = Object.entries(stats.byCategory)
    .sort((a, b) => b[1] - a[1])[0];

  const lines = [
    "📊 *WEEKLY BRIEF QUALITY REPORT*",
    "",
    `📅 Last 7 days: *${stats.totalRuns} briefs*, ${stats.totalIdeas} ideas generated`,
    `❤️ Ideas you liked: *${stats.totalLiked}* (${pct}% like rate${trend})`,
    "",
  ];

  if (topCat) {
    const catEmoji: Record<string, string> = { ai: "🤖", crypto: "₿", other: "🌐" };
    lines.push(`🏆 Most liked category: *${topCat[0].toUpperCase()}* ${catEmoji[topCat[0]] ?? ""} (${topCat[1]} ideas)`);
  }

  if (stats.byCategory.ai || stats.byCategory.crypto || stats.byCategory.other) {
    const breakdown = ["ai","crypto","other"]
      .filter(c => stats.byCategory[c])
      .map(c => `${c}: ${stats.byCategory[c]}`)
      .join(" · ");
    lines.push(`📈 Breakdown: ${breakdown}`);
  }

  if (stats.topKeywords.length) {
    lines.push("", `🔑 *Top keywords in ideas you liked:*`);
    lines.push(stats.topKeywords.map(k => `\`${k}\``).join(" · "));
  }

  // Model comparison
  const modelEntries = Object.entries(stats.byModel)
    .filter(([, v]) => v.total >= 3) // only show models with enough data
    .sort((a, b) => b[1].rate - a[1].rate);

  if (modelEntries.length > 1) {
    lines.push("", "🤖 *Model performance this week:*");
    for (const [model, { liked, total, rate }] of modelEntries) {
      const shortName = model.split("/").pop() ?? model;
      const bar = "█".repeat(Math.round(rate * 10)) + "░".repeat(10 - Math.round(rate * 10));
      lines.push(`\`${shortName}\` ${bar} ${(rate * 100).toFixed(0)}% (${liked}/${total})`);
    }
    const best = modelEntries[0];
    const worst = modelEntries[modelEntries.length - 1];
    if (best[1].rate > worst[1].rate + 0.1) {
      lines.push(`_→ ${best[0].split("/").pop()} is winning — consider swapping out ${worst[0].split("/").pop()}_`);
    }
  }

  lines.push("", "_Keep tapping ideas you like — it trains the next brief_");

  await sendMessage(lines.join("\n"));
  console.log("[telegram] Weekly digest sent");
}

// ─── Callback webhook handler ─────────────────────────────────────────────────

export interface TelegramCallbackQuery {
  id: string;
  data: string;
  message: { message_id: number };
}

export type ParsedCallback =
  | { type: "like_idea";  ideaId: string; ideaIndex: number }
  | { type: "like_media"; ideaId: string; mediaIndex: number }
  | { type: "skip";       ideaId: string };

export function parseCallback(query: TelegramCallbackQuery): ParsedCallback {
  const parts = query.data.split(":");
  if (parts[0] === "like_idea")  return { type: "like_idea",  ideaId: parts[1], ideaIndex:  parseInt(parts[2], 10) };
  if (parts[0] === "like_media") return { type: "like_media", ideaId: parts[1], mediaIndex: parseInt(parts[2], 10) };
  return { type: "skip", ideaId: parts[1] };
}

export async function answerCallback(callbackQueryId: string, text: string): Promise<void> {
  await fetch(`${BASE_URL}/answerCallbackQuery`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ callback_query_id: callbackQueryId, text }),
  });
}

// ─── Register webhook ─────────────────────────────────────────────────────────

export async function registerWebhook(webhookUrl: string): Promise<void> {
  const res = await fetch(`${BASE_URL}/setWebhook`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url: webhookUrl }),
  });
  const data = await res.json();
  console.log("[telegram] Webhook registration:", data);
}
