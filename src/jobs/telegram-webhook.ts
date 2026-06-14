/**
 * Telegram Webhook Handler — Trigger.dev Background Task
 *
 * Receives callback_query payloads forwarded from the Vercel proxy at:
 *   https://<your-vercel-project>.vercel.app/api/telegram
 *
 * Delegates to handleTelegramWebhook() which handles both:
 *   like_idea:id:index  →  saveLikedIdea + answerCallback
 *   skip:id             →  updateFeedback + answerCallback
 */

import { task } from "@trigger.dev/sdk";
import { handleTelegramWebhook } from "./daily-ideas";

export const telegramWebhookTask = task({
  id: "telegram-webhook",
  run: async (payload: { body: Record<string, unknown> }) => {
    await handleTelegramWebhook(payload.body);
    return { ok: true };
  },
});
