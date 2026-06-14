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

const MAX_TG_LENGTH = 4096;

function chunkText(text: string): string[] {
  if (text.length <= MAX_TG_LENGTH) return [text];
  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > 0) {
    if (remaining.length <= MAX_TG_LENGTH) {
      chunks.push(remaining);
      break;
    }
    let splitAt = remaining.lastIndexOf("\n", MAX_TG_LENGTH);
    if (splitAt === -1) splitAt = MAX_TG_LENGTH;
    chunks.push(remaining.slice(0, splitAt));
    remaining = remaining.slice(splitAt).trimStart();
  }
  return chunks;
}

export async function sendDailyBrief(
  result: IdeaResult,
  ideaId: string
): Promise<number> {
  const text = formatDailyBrief(result, ideaId);
  const chunks = chunkText(text);

  const reply_markup = {
    inline_keyboard: [
      [
        { text: "✅ Liked today's batch", callback_data: `like:${ideaId}` },
        { text: "❌ Wasn't feeling it", callback_data: `skip:${ideaId}` },
      ],
    ],
  };

  let lastMessageId = 0;
  for (let i = 0; i < chunks.length; i++) {
    const isLast = i === chunks.length - 1;
    const body: Record<string, unknown> = {
      chat_id: CHAT_ID,
      text: chunks[i],
      parse_mode: "Markdown",
    };
    if (isLast) body.reply_markup = reply_markup;

    const res = await fetch(`${BASE_URL}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    const data = await res.json();
    if (!data.ok) throw new Error(`Telegram sendMessage failed: ${JSON.stringify(data)}`);

    lastMessageId = data.result.message_id;
    console.log(`[telegram] Message chunk ${i + 1}/${chunks.length} sent: ${lastMessageId}`);
  }

  return lastMessageId;
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
