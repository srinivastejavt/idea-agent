/**
 * Model comparison: Claude Sonnet (OpenRouter) vs Gemini (Google AI)
 * Usage: npx tsx scripts/compare-models.ts
 */

import "dotenv/config";
import OpenAI from "openai";
import { GoogleGenerativeAI } from "@google/generative-ai";
import type { TrendPost } from "../src/scraper";

const openrouter = new OpenAI({
  baseURL: "https://openrouter.ai/api/v1",
  apiKey: process.env.OPENROUTER_API_KEY!,
  defaultHeaders: { "HTTP-Referer": "https://github.com/idea-agent", "X-Title": "Idea Agent" },
});

const geminiClient = new GoogleGenerativeAI(process.env.GOOGLE_GEMINI_API_KEY!);

// ─── Shared prompts ───────────────────────────────────────────────────────────

const VOICE_EXAMPLES = `
Target voice — irreverent, specific, punchy, founder-brain. Match this energy:

1. "Ranked every founder I follow by how often they post 'building in public' vs. actually shipping. The ratio is criminal."
2. "Built a tool that scores every VC firm by how many of their portfolio companies are still alive 3 years in. Published the list."
3. "Mapped every AI safety researcher's public statements vs. the companies they took money from. Interesting gaps."
4. "Rate every AI lab by a single 'government trust score' — funding, contracts, lawsuits, senate hearings. OpenAI is cooked."
5. "Live tracker: how many YC companies from each batch are still alive vs. acqui-hired vs. dead. The S23 cohort is rough."
`.trim();

const PERSONAL_DATA_SOURCES = `
The builder has access to: Whoop (HRV, sleep, strain), Gmail, Google Calendar, Telegram, Twitter history.
Use these ONLY if they make the idea clearly better and genuinely fit the trend. Most ideas should NOT use them.
`.trim();

const IDEAS_SYSTEM = `You are a viral tool idea generator for a solo tech founder with a large audience on Twitter/X.

${VOICE_EXAMPLES}

${PERSONAL_DATA_SOURCES}

THE PRIMARY DRIVER IS THE TREND. Ideas must come from what's hot today, not from a fixed template.

RULES:
- Each idea must be directly inspired by the trend — don't generate generic tools
- Name specific real entities: companies, models, people, datasets (say "OpenAI, Anthropic, Mistral" not "AI companies")
- Every idea needs a concrete shareable output: a score out of 100, a ranked list of N, a live counter, a chart
- At least 1 idea must reference the specific news story in today's trend
- At least 1 must be a public leaderboard ranking real named entities against each other
- Each of the 5 ideas must use a DIFFERENT mechanic (ranking, roast, tracker, calculator, comparator)
- weekend_build = true if shippable solo in 2 days
- No enterprise SaaS, no B2B

Respond ONLY with valid JSON. No markdown, no explanation.`;

const stripFences = (s: string) =>
  s.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();

// ─── OpenRouter runner ────────────────────────────────────────────────────────

async function runOpenRouter(model: string, label: string, posts: TrendPost[]) {
  const postsText = posts
    .map((p, i) => `${i + 1}. [${p.source}] "${p.title}" — ${p.points} pts, ${p.comments} comments`)
    .join("\n");

  const trendRes = await openrouter.chat.completions.create({
    model,
    max_tokens: 512,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: `You are a trend analyst. Look at today's trending posts and identify the ONE mechanic driving engagement. Pick the BROADEST possible theme — the underlying anxiety or truth that multiple posts are circling. Respond ONLY with valid JSON.`,
      },
      {
        role: "user",
        content: `Today's top trending posts:\n\n${postsText}\n\nReturn JSON:\n{"trend": "one sentence: what blew up and why", "mechanic": "one sentence: the pattern", "rawMechanic": "leaderboard|roast|weird_data_combo|relatable_truth|other"}`,
      },
    ],
  });

  const { trend, mechanic, rawMechanic } = JSON.parse(
    stripFences(trendRes.choices[0].message.content ?? "{}")
  );

  const ideasRes = await openrouter.chat.completions.create({
    model,
    max_tokens: 1024,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: IDEAS_SYSTEM },
      {
        role: "user",
        content: `Today's trend: ${trend}\n\nThe mechanic: ${mechanic} (type: ${rawMechanic})\n\nGenerate 5 tool ideas. Be specific — name actual companies, APIs, and metrics. Return JSON:\n{"ideas": [{"name": "...", "description": "...", "weekendBuild": true}], "topPick": "..."}`,
      },
    ],
  });

  const { ideas, topPick } = JSON.parse(
    stripFences(ideasRes.choices[0].message.content ?? "{}")
  );

  return { label, trend, ideas, topPick };
}

// ─── Gemini runner ────────────────────────────────────────────────────────────

async function runGemini(modelName: string, label: string, posts: TrendPost[]) {
  const model = geminiClient.getGenerativeModel({ model: modelName });

  const postsText = posts
    .map((p, i) => `${i + 1}. [${p.source}] "${p.title}" — ${p.points} pts, ${p.comments} comments`)
    .join("\n");

  const trendPrompt = `You are a trend analyst. Look at today's trending posts and identify the ONE mechanic driving engagement. Pick the BROADEST possible theme — the underlying anxiety or truth that multiple posts are circling.

Today's top trending posts:
${postsText}

Return ONLY valid JSON (no markdown):
{"trend": "one sentence: what blew up and why", "mechanic": "one sentence: the pattern", "rawMechanic": "leaderboard|roast|weird_data_combo|relatable_truth|other"}`;

  const trendResult = await model.generateContent(trendPrompt);
  const { trend, mechanic, rawMechanic } = JSON.parse(
    stripFences(trendResult.response.text())
  );

  const ideasPrompt = `${IDEAS_SYSTEM}

Today's trend: ${trend}

The mechanic: ${mechanic} (type: ${rawMechanic})

Generate 5 tool ideas. Be specific — name actual companies, APIs, and metrics. Return ONLY valid JSON (no markdown):
{"ideas": [{"name": "...", "description": "...", "weekendBuild": true}], "topPick": "..."}`;

  const ideasResult = await model.generateContent(ideasPrompt);
  const { ideas, topPick } = JSON.parse(
    stripFences(ideasResult.response.text())
  );

  return { label, trend, ideas, topPick };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

(async () => {
  const { fetchTrends } = await import("../src/scraper");
  console.log("Fetching trends (shared across all models)...\n");
  const { top } = await fetchTrends();
  console.log(`Got ${top.length} posts. Running models in parallel...\n`);

  const [sonnet, geminiFlash, kimiK2, qwen3, llama4, deepseek] = await Promise.allSettled([
    runOpenRouter("anthropic/claude-sonnet-4-5",   "Claude Sonnet 4.5    $3.00/$15.00 per MTok (~$0.017/run)", top),
    runOpenRouter("google/gemini-2.5-flash",        "Gemini 2.5 Flash     $0.30/$2.50  per MTok (~$0.002/run)", top),
    runOpenRouter("moonshotai/kimi-k2",             "Kimi K2              $0.57/$2.30  per MTok (~$0.005/run)", top),
    runOpenRouter("qwen/qwen3-235b-a22b",           "Qwen3 235B           $0.46/$1.82  per MTok (~$0.004/run)", top),
    runOpenRouter("meta-llama/llama-4-maverick",    "Llama 4 Maverick     $0.15/$0.60  per MTok (~$0.001/run)", top),
    runOpenRouter("deepseek/deepseek-chat",         "DeepSeek V3          $0.27/$1.10  per MTok (~$0.002/run)", top),
  ]);

  const DIVIDER = "═".repeat(62);

  for (const result of [sonnet, geminiFlash, kimiK2, qwen3, llama4, deepseek]) {
    console.log(`\n${DIVIDER}`);
    if (result.status === "rejected") {
      console.log(`  ❌ Error: ${result.reason?.message ?? result.reason}`);
      continue;
    }
    const r = result.value;
    console.log(`  ${r.label}`);
    console.log(DIVIDER);
    console.log(`  TREND: ${r.trend}\n`);
    console.log("  IDEAS:");
    (r.ideas ?? []).forEach((idea: { name: string; description: string; weekendBuild: boolean }, i: number) => {
      console.log(`  ${i + 1}. ${idea.name} — ${idea.description} [weekend: ${idea.weekendBuild}]`);
    });
    console.log(`\n  TOP PICK: ${r.topPick}`);
  }

  console.log(`\n${DIVIDER}`);
  console.log("Done.");
})();
