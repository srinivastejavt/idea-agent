/**
 * Vercel Serverless Function — Telegram Webhook Proxy
 *
 * Telegram POSTs callback_query events here when a button is tapped.
 * We immediately return 200 (so Telegram doesn't retry), then forward
 * the payload to the Trigger.dev task for async processing.
 *
 * Required env vars (set in Vercel dashboard):
 *   TRIGGER_SECRET_KEY  — from Trigger.dev → API keys
 */

export const config = { runtime: "edge" };

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return new Response("Bad request", { status: 400 });
  }

  // Fire-and-forget to Trigger.dev — don't await so we return 200 fast
  fetch("https://api.trigger.dev/api/v1/tasks/telegram-webhook/trigger", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${process.env.TRIGGER_SECRET_KEY}`,
    },
    body: JSON.stringify({ payload: { body } }),
  }).catch((err) => console.error("[webhook-proxy] Trigger.dev call failed:", err));

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}
