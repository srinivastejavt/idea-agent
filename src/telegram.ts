/**
 * Telegram Delivery Module
 * Sends the daily brief and handles per-idea feedback callbacks
 */

import type { IdeaResult, Idea } from "./prompt";

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN!;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID!;
const BASE_URL = `https://api.telegram.org/bot${BOT_TOKEN}`;

// ─── Format message ───────────────────────────────────────────────────────────

export function formatDailyBrief(result: IdeaResult): string {
  const date = new Date().toLocaleDateString("en-US", {
    weekday: "short", month: "short", day: "numeric",
  });

  const lines: string[] = [`📅 *${date} — Idea Brief*`];

  const categories: Array<{ key: "ai" | "crypto" | "other"; emoji: string; label: string }> = [
    { key: "ai",     emoji: "🤖", label: "AI"     },
    { key: "crypto", emoji: "₿",  label: "CRYPTO"  },
    { key: "other",  emoji: "🌐", label: "OTHER"   },
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

export async function sendDailyBrief(
  result: IdeaResult,
  ideaId: string
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

  return lastMessageId;
}

// ─── Callback webhook handler ─────────────────────────────────────────────────

export interface TelegramCallbackQuery {
  id: string;
  data: string;
  message: { message_id: number };
}

export type ParsedCallback =
  | { type: "like_idea"; ideaId: string; ideaIndex: number }
  | { type: "skip"; ideaId: string };

export function parseCallback(query: TelegramCallbackQuery): ParsedCallback {
  const parts = query.data.split(":");
  if (parts[0] === "like_idea") {
    return { type: "like_idea", ideaId: parts[1], ideaIndex: parseInt(parts[2], 10) };
  }
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
