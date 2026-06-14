/**
 * Telegram Webhook Handler — Trigger.dev HTTP Endpoint
 *
 * Telegram sends ✅/❌ callback_query events here when user taps buttons.
 * This task receives the payload and saves feedback to Supabase.
 *
 * Endpoint URL (after deploy):
 *   https://api.trigger.dev/api/v1/http/<project-ref>/telegram-webhook
 *
 * Register with Telegram:
 *   npm run setup:webhook
 */

import { task } from "@trigger.dev/sdk";
import { updateFeedback } from "../supabase";
import { parseCallback, answerCallback } from "../telegram";

export interface TelegramWebhookPayload {
  body: Record<string, unknown>;
}

export const telegramWebhookTask = task({
  id: "telegram-webhook",
  run: async (payload: TelegramWebhookPayload) => {
    const query = payload.body?.callback_query as Record<string, unknown> | undefined;

    if (!query) {
      console.log("[webhook] No callback_query — ignoring");
      return { ok: true, skipped: true };
    }

    try {
      const { ideaId, liked } = parseCallback(query as Parameters<typeof parseCallback>[0]);
      await updateFeedback(ideaId, liked);
      await answerCallback(query.id as string, liked ? "Noted 🙌" : "Fair enough 👍");
      console.log(`[webhook] Feedback saved: ${ideaId} → liked=${liked}`);
      return { ok: true, ideaId, liked };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[webhook] Failed:", msg);
      // Still answer the callback so Telegram doesn't retry indefinitely
      if (query.id) await answerCallback(query.id as string, "Got it").catch(() => {});
      throw err;
    }
  },
});
