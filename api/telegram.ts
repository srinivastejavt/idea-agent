/**
 * Vercel Edge Function — Telegram Webhook Proxy
 *
 * Telegram POSTs callback_query events here when a button is tapped.
 * We AWAIT the Trigger.dev call before returning 200 — this keeps the
 * edge function alive long enough to complete it. (The original bug was
 * fire-and-forget: the edge function terminated on response, killing the fetch.)
 *
 * Required env vars (set in Vercel dashboard):
 *   TRIGGER_SECRET_KEY  — Secret key from Trigger.dev → project settings
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

  // AWAIT before returning — keeps edge function alive until fetch completes
  try {
    const res = await fetch("https://api.trigger.dev/api/v1/tasks/telegram-webhook/trigger", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${process.env.TRIGGER_SECRET_KEY}`,
      },
      body: JSON.stringify({ payload: { body } }),
    });
    if (!res.ok) {
      const text = await res.text();
      console.error(`[webhook-proxy] Trigger.dev returned ${res.status}: ${text}`);
    } else {
      console.log("[webhook-proxy] Trigger.dev task queued OK");
    }
  } catch (err) {
    console.error("[webhook-proxy] Trigger.dev call failed:", err);
  }

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}
