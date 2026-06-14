/**
 * Telegram Delivery Module
 * Sends the daily brief and handles thumbs up/down feedback callbacks
 */

import type { IdeaResult } from "./prompt";

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN!;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID!;
const BASE_URL = `https://api.telegram.org/bot${BOT_TOKEN}`;

// ─── Format message ───────────────────────────────────────────────────────────

export function formatDailyBrief(result: IdeaResult, ideaId: string): string {
  // Group by model so the brief is readable
  const geminiIdeas = result.ideas.filter(i => i.model?.includes("Gemini"));
  const llamaIdeas  = result.ideas.filter(i => i.model?.includes("Llama"));
  const otherIdeas  = result.ideas.filter(i => !i.model?.includes("Gemini") && !i.model?.includes("Llama"));
  const allGrouped  = [...geminiIdeas, ...llamaIdeas, ...otherIdeas];

  const ideasText = allGrouped
    .map(
      (idea, i) =>
        `${i + 1}. *${idea.name}* — ${idea.description} [${idea.weekendBuild ? "🟢 weekend" : "🔴 bigger lift"}]`
    )
    .join("\n");

  const modelLine = `🤖 _Gemini 2.5 Flash (1-${geminiIdeas.length}) · Llama 4 Maverick (${geminiIdeas.length + 1}-${geminiIdeas.length + llamaIdeas.length})_`;

  return [
    `🔥 *TREND:* ${result.trend}`,
    ``,
    `🧠 *PATTERN:* ${result.mechanic}`,
    ``,
    `💡 *IDEAS FOR TODAY:*`,
    modelLine,
    ``,
    ideasText,
    ``,
    `⚡ *TOP PICK:* ${result.topPick}`,
  ].join("\n");
}

// ─── Send message ─────────────────────────────────────────────────────────────

export async function sendDailyBrief(
  result: IdeaResult,
  ideaId: string
): Promise<number> {
  const text = formatDailyBrief(result, ideaId);

  // Inline keyboard: thumbs up/down, keyed by the Supabase row ID
  const reply_markup = {
    inline_keyboard: [
      [
        { text: "✅ Liked today's batch", callback_data: `like:${ideaId}` },
        { text: "❌ Wasn't feeling it", callback_data: `skip:${ideaId}` },
      ],
    ],
  };

  const res = await fetch(`${BASE_URL}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: CHAT_ID,
      text,
      parse_mode: "Markdown",
      reply_markup,
    }),
  });

  const data = await res.json();
  if (!data.ok) throw new Error(`Telegram sendMessage failed: ${JSON.stringify(data)}`);

  const messageId: number = data.result.message_id;
  console.log(`[telegram] Message sent: ${messageId}`);
  return messageId;
}

// ─── Callback webhook handler ─────────────────────────────────────────────────
// Wire this up as an HTTP handler in Trigger.dev or a standalone Express route
// Telegram will POST to your webhook URL when the user taps a button

export interface TelegramCallbackQuery {
  id: string;
  data: string; // "like:<uuid>" or "skip:<uuid>"
  message: { message_id: number };
}

export function parseCallback(query: TelegramCallbackQuery): {
  ideaId: string;
  liked: boolean;
} {
  const [action, ideaId] = query.data.split(":");
  return { ideaId, liked: action === "like" };
}

export async function answerCallback(callbackQueryId: string, text: string): Promise<void> {
  await fetch(`${BASE_URL}/answerCallbackQuery`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ callback_query_id: callbackQueryId, text }),
  });
}

// ─── Register webhook ─────────────────────────────────────────────────────────
// Run this ONCE to point Telegram at your webhook URL

export async function registerWebhook(webhookUrl: string): Promise<void> {
  const res = await fetch(`${BASE_URL}/setWebhook`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url: webhookUrl }),
  });
  const data = await res.json();
  console.log("[telegram] Webhook registration:", data);
}
