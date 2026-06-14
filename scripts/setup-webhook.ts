/**
 * Run once to register the Telegram webhook with your Trigger.dev HTTP endpoint.
 *
 * After deploying to Trigger.dev, the webhook URL is:
 *   https://api.trigger.dev/api/v1/http/<PROJECT_REF>/telegram-webhook
 *
 * Usage:
 *   TRIGGER_PROJECT_REF=proj_abc123 npx tsx scripts/setup-webhook.ts
 *
 * Or set WEBHOOK_URL directly:
 *   WEBHOOK_URL=https://api.trigger.dev/api/v1/http/proj_abc123/telegram-webhook npx tsx scripts/setup-webhook.ts
 */

import "dotenv/config";
import { registerWebhook } from "../src/telegram";

const projectRef = process.env.TRIGGER_PROJECT_REF;
const explicitUrl = process.env.WEBHOOK_URL;

const webhookUrl =
  explicitUrl ??
  (projectRef
    ? `https://api.trigger.dev/api/v1/http/${projectRef}/telegram-webhook`
    : null);

if (!webhookUrl) {
  console.error("Set TRIGGER_PROJECT_REF or WEBHOOK_URL before running this script.");
  process.exit(1);
}

registerWebhook(webhookUrl).then(() => {
  console.log("✅ Telegram webhook registered at:", webhookUrl);
});
