import {
  answerCallback,
  parseCallback,
  updateFeedback
} from "../../../../../chunk-XFTICFDC.mjs";
import "../../../../../chunk-QTTBNJ6W.mjs";
import {
  task
} from "../../../../../chunk-UZHNW3LS.mjs";
import "../../../../../chunk-HPZM6FUT.mjs";
import {
  __name,
  init_esm
} from "../../../../../chunk-23OQHB7B.mjs";

// src/jobs/telegram-webhook.ts
init_esm();
var telegramWebhookTask = task({
  id: "telegram-webhook",
  run: /* @__PURE__ */ __name(async (payload) => {
    const query = payload.body?.callback_query;
    if (!query) {
      console.log("[webhook] No callback_query — ignoring");
      return { ok: true, skipped: true };
    }
    try {
      const { ideaId, liked } = parseCallback(query);
      await updateFeedback(ideaId, liked);
      await answerCallback(query.id, liked ? "Noted 🙌" : "Fair enough 👍");
      console.log(`[webhook] Feedback saved: ${ideaId} → liked=${liked}`);
      return { ok: true, ideaId, liked };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[webhook] Failed:", msg);
      if (query.id) await answerCallback(query.id, "Got it").catch(() => {
      });
      throw err;
    }
  }, "run")
});
export {
  telegramWebhookTask
};
//# sourceMappingURL=telegram-webhook.mjs.map
