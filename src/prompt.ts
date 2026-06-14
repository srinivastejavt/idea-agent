/**
 * Prompt Engine — Dual model
 * 1. Extract trend with Gemini 3 Flash Preview (near-Pro reasoning, best analysis)
 * 2. Generate 9 ideas each with Gemini 2.5 Flash + DeepSeek V4 Flash in parallel → 18 total
 * Combined cost: ~$0.007/run (~$0.63/month)
 */

import "dotenv/config";
import OpenAI from "openai";
import type { TrendPost } from "./scraper";

const TREND_MODEL = "google/gemini-3-flash-preview"; // near-Pro reasoning for trend analysis
const IDEA_MODELS = [
  { id: "google/gemini-2.5-flash",        label: "Gemini 2.5 Flash" },
  { id: "deepseek/deepseek-v4-flash",     label: "DeepSeek V4 Flash" },
];

const client = new OpenAI({
  baseURL: "https://openrouter.ai/api/v1",
  apiKey: process.env.OPENROUTER_API_KEY!,
  defaultHeaders: {
    "HTTP-Referer": "https://github.com/idea-agent",
    "X-Title": "Idea Agent",
  },
});

export interface Idea {
  name: string;
  description: string;
  weekendBuild: boolean;
  model?: string;
  category?: "ai" | "crypto" | "other";
}

export interface IdeaResult {
  trend: string;
  mechanic: string;
  trendSource: string;
  ideas: Idea[];
  topPick: string;
  sources: { title: string; url: string }[];
  trendsByCategory: {
    ai: string[];
    crypto: string[];
    other: string[];
  };
}

// ─── Voice reference ──────────────────────────────────────────────────────────

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

// ─── Step 1: Extract trend ────────────────────────────────────────────────────

interface TrendSignal {
  trend: string;
  mechanic: string;
  rawMechanic: "leaderboard" | "roast" | "weird_data_combo" | "relatable_truth" | "other";
  trendSource: string;
  category: "ai" | "crypto" | "other";
  sourceUrl?: string;
  sourceTitle?: string;
}

async function extractTrends(posts: TrendPost[]): Promise<TrendSignal[]> {
  const postsText = posts
    .map((p, i) =>
      `${i + 1}. [${p.source}${p.subreddit ? `/r/${p.subreddit}` : ""}] "${p.title}" — ${p.points} pts, ${p.comments} comments`
    )
    .join("\n");

  const response = await client.chat.completions.create({
    model: TREND_MODEL,
    max_tokens: 2000,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: `You are a trend analyst who understands virality mechanics in tech/startup/crypto Twitter and Reddit.

Your job: identify the TOP 3 distinct trends driving engagement today. Each must be a genuinely different story or theme — not variations of the same topic.

Virality mechanics:
- leaderboard: ranks people, companies, or things against each other
- roast: calls out embarrassing data or behavior with receipts
- weird_data_combo: two unrelated data sources combined in a surprising way
- relatable_truth: data that confirms something everyone secretly knows but doesn't say

Respond ONLY with valid JSON. No markdown, no explanation.`,
      },
      {
        role: "user",
        content: `Today's top trending posts:\n\n${postsText}\n\nReturn JSON:\n{"trends": [{"trend": "one sentence: what blew up and why", "mechanic": "one sentence: the pattern", "rawMechanic": "leaderboard|roast|weird_data_combo|relatable_truth|other", "trendSource": "hackernews|reddit|twitter|producthunt", "category": "ai if about AI/ML/LLMs, crypto if about blockchain/crypto/DeFi/web3, other for everything else", "postIndex": <1-based index of the post that best represents this trend>}, ...3 items total]}`,
      },
    ],
  });

  const text = stripFences(response.choices[0].message.content ?? "{}");
  const { trends } = JSON.parse(text);
  const signals = (trends ?? []).slice(0, 3) as (TrendSignal & { postIndex?: number })[];

  // Attach the source URL + title from the original posts array
  return signals.map(t => {
    const idx = (t.postIndex ?? 1) - 1;
    const post = posts[idx];
    return {
      ...t,
      sourceUrl: post?.url,
      sourceTitle: post?.title,
    };
  });
}

// ─── Step 2: Generate ideas from one model ────────────────────────────────────

async function generateIdeasFromModel(
  modelId: string,
  modelLabel: string,
  trends: TrendSignal[],
  previousRuns: PreviousRun[] = [],
  likedIdeas: { name: string; description: string }[] = []
): Promise<Idea[]> {
  // Fix 3: inject liked ideas as style/quality reference
  const likedBlock = likedIdeas.length > 0
    ? `\nIDEAS SRINI LIKED BEFORE — match this quality and style:\n${likedIdeas.map((i, n) => `${n + 1}. ${i.name} — ${i.description}`).join("\n")}\n`
    : "";

  const previousBlock = previousRuns.length === 0 ? "" : `
PREVIOUS RUNS TODAY — do not repeat these angles:
${previousRuns.map((run, ri) => `
Run ${ri + 1} covered: "${run.trend}"
Already sent:
${run.ideas.map((i, n) => `  ${n + 1}. ${i.name} — ${i.description}`).join("\n")}`).join("\n")}

- Same story still trending → generate a BETTER, more specific evolved version
- New story → generate completely fresh ideas
- Never repeat the same name or core concept
`;

  const response = await client.chat.completions.create({
    model: modelId,
    max_tokens: 4000,  // Gemini 2.5 Flash needs headroom for thinking tokens
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: IDEAS_SYSTEM },
      {
        role: "user",
        content: `Today's top 3 trends (freshly scraped):
${trends.map((t, i) => `${i + 1}. [${(t.category ?? "other").toUpperCase()}] ${t.trend} [mechanic: ${t.rawMechanic}]`).join("\n")}
${likedBlock}${previousBlock}
Generate 9 tool ideas — 3 per trend above. Each idea must inherit the category of its trend (ai/crypto/other). Return JSON:
{
  "ideas": [
    {"name": "tool name (2-4 words)", "description": "one punchy sentence, max 80 chars", "weekendBuild": true/false, "category": "ai|crypto|other"},
    ...9 items total
  ]
}`,
      },
    ],
  });

  const text = stripFences(response.choices[0].message.content ?? "{}");
  const { ideas } = JSON.parse(text);
  return (ideas ?? []).map((idea: Idea) => ({ ...idea, model: modelLabel }));
}

// ─── Main export ──────────────────────────────────────────────────────────────

export interface PreviousRun {
  trend: string;
  mechanic: string;
  ideas: { name: string; description: string }[];
}

export async function generateDailyIdeas(
  posts: TrendPost[],
  previousRuns: PreviousRun[] = [],
  likedIdeas: { name: string; description: string }[] = []
): Promise<IdeaResult> {
  // Fix 2: Extract top 3 trends
  console.log("[prompt] Extracting top 3 trends from fresh scrape...");
  const trends = await extractTrends(posts);
  trends.forEach((t, i) => console.log(`[prompt] Trend ${i + 1}: ${t.trend}`));

  if (previousRuns.length > 0) {
    console.log(`[prompt] ${previousRuns.length} previous run(s) today — passing as context`);
  }
  if (likedIdeas.length > 0) {
    console.log(`[prompt] ${likedIdeas.length} liked ideas from history — using as style guide`);
  }

  // Generate ~3-4 ideas per trend per model, all in parallel
  // Each model handles all 3 trends in one call to save API round trips
  console.log(`[prompt] Generating ideas from ${IDEA_MODELS.length} models in parallel...`);
  const results = await Promise.allSettled(
    IDEA_MODELS.map(m =>
      generateIdeasFromModel(m.id, m.label, trends, previousRuns, likedIdeas)
    )
  );

  const allIdeas: Idea[] = [];
  for (const [i, result] of results.entries()) {
    if (result.status === "fulfilled") {
      console.log(`[prompt] ${IDEA_MODELS[i].label}: ${result.value.length} ideas`);
      allIdeas.push(...result.value);
    } else {
      console.warn(`[prompt] ${IDEA_MODELS[i].label} failed:`, result.reason?.message);
    }
  }

  const topPick = allIdeas[0]
    ? `${allIdeas[0].name} — top pick from ${allIdeas[0].model}`
    : "N/A";

  // Return primary trend for storage
  const primary = trends[0] ?? { trend: "", mechanic: "", trendSource: "", rawMechanic: "other", category: "other" as const };
  const trendsByCategory = {
    ai:     trends.filter(t => t.category === "ai").map(t => t.trend),
    crypto: trends.filter(t => t.category === "crypto").map(t => t.trend),
    other:  trends.filter(t => !t.category || t.category === "other").map(t => t.trend),
  };
  return {
    trend: trends.map(t => t.trend).join(" | "),
    mechanic: primary.mechanic,
    trendSource: primary.trendSource,
    ideas: allIdeas,
    topPick,
    sources: trends
      .filter(t => t.sourceUrl && t.sourceTitle)
      .map(t => ({ title: t.sourceTitle!, url: t.sourceUrl! })),
    trendsByCategory,
  };
}

// ─── Run directly for testing ─────────────────────────────────────────────────

const isMain = process.argv[1]?.endsWith("prompt.ts");
if (isMain) {
  (async () => {
    const { fetchTrends } = await import("./scraper");
    console.log("[test] Scraping trends...");
    const { top } = await fetchTrends();
    console.log(`[test] Got ${top.length} posts, generating ideas...`);
    const result = await generateDailyIdeas(top);
    console.log("\n=== RESULT ===");
    console.log("TREND:", result.trend);
    console.log("MECHANIC:", result.mechanic);
    console.log("\nIDEAS:");
    result.ideas.forEach((idea, i) => {
      console.log(`${i + 1}. [${idea.model}] ${idea.name} — ${idea.description} [weekend: ${idea.weekendBuild}]`);
    });
    console.log("\nTOP PICK:", result.topPick);
  })();
}
