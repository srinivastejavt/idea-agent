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
  category?: "ai" | "crypto" | "security" | "other";
}

export interface TweetIdea {
  trend: string;                                      // the headline trend
  angles: string[];                                   // 3-6 angles/hooks to post about
  category?: "ai" | "crypto" | "security" | "other"; // which vertical
  sourceUrl?: string;                                 // link to source article
  sourceTitle?: string;                               // title of the source article
}

export interface MediaRec {
  show:   string;
  title:  string;
  url:    string;
  type:   "podcast" | "youtube";
  reason: string; // one sentence: why relevant to today's trends
}

export interface IdeaEval {
  name: string;          // idea name
  why: string;           // Hamming: why this problem matters & why others aren't building it
  belief: string;        // what must be true for this to matter in 2 years
  killCondition: string; // what would make you drop it immediately
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
    security: string[];
    other: string[];
  };
  tweetIdeas: TweetIdea[];
  ideaEval: IdeaEval[];
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
  category: "ai" | "crypto" | "security" | "other";
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

Your job: identify the TOP 3 distinct trends driving engagement today.

STEP 1 — MERGE DUPLICATES FIRST: Before picking trends, group all posts about the same underlying story together. If 5 posts all discuss "OpenAI's new model", that's ONE trend, not five. Use the most signal-rich version to represent the group.

STEP 2 — PICK 3 DISTINCT TRENDS: Each must be a genuinely different story or news event — not variations of the same topic. Prefer trends with the most cross-source confirmation (same story on Twitter + HN + Reddit = stronger signal).

Virality mechanics:
- leaderboard: ranks people, companies, or things against each other
- roast: calls out embarrassing data or behavior with receipts
- weird_data_combo: two unrelated data sources combined in a surprising way
- relatable_truth: data that confirms something everyone secretly knows but doesn't say

Respond ONLY with valid JSON. No markdown, no explanation.`,
      },
      {
        role: "user",
        content: `Today's top trending posts:\n\n${postsText}\n\nReturn JSON:\n{"trends": [{"trend": "one sentence: what blew up and why", "mechanic": "one sentence: the pattern", "rawMechanic": "leaderboard|roast|weird_data_combo|relatable_truth|other", "trendSource": "hackernews|reddit|twitter|producthunt|coindesk|cointelegraph|dlnews|wublockchain|coingeckonews|rwaxyz|blockworks|theblock|decrypt", "category": "ai if about AI/ML/LLMs, crypto if about blockchain/crypto/DeFi/web3/RWA/stablecoins, security if about cybersecurity/hacking/data breaches/vulnerabilities/infosec, other for everything else", "postIndex": <1-based index of the post that best represents this trend>}, ...3 items total]}\n\nIMPORTANT: If any posts come from crypto sources (coindesk, cointelegraph, decrypt, theblock, blockworks, dlnews, wublockchain, coingeckonews, rwaxyz, beincrypto, bankless, cryptonews), you MUST include at least 1 crypto trend. Crypto RSS feeds show 0 points/comments by design — low scores do NOT mean low importance for that community.`,
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
Generate 9 tool ideas — 3 per trend above. Each idea must inherit the category of its trend (ai/crypto/security/other). Return JSON:
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

// ─── Post-process: keyword-based category correction ─────────────────────────
// LLMs sometimes mislabel trend categories (e.g. "Amazon AI regulation" → "other"
// instead of "ai"). This corrects individual ideas using keyword matching on their
// name + description — same logic as sheets.ts, no extra LLM call needed.

const AI_KW = /\b(AI|LLM|GPT|Claude|OpenAI|Anthropic|Gemini|machine learning|neural|transformer|diffusion|agent|model|inference|RAG|fine.?tun|embedding|hallucin|regul.*AI|AI.*regul)\b/i;
const CRYPTO_KW = /\b(crypto|bitcoin|ethereum|blockchain|DeFi|NFT|token|web3|wallet|on.?chain|solana|altcoin|stablecoin|RWA|DAO|L2|layer 2|memecoin|BTC|ETH|IPO.*coin|coin.*IPO|SpaceX.*BTC|BTC.*SpaceX)\b/i;
const SECURITY_KW = /\b(cybersecurity|infosec|breach|hack|ransomware|malware|phishing|vulnerability|CVE|exploit|zero.?day|CISA|firewall|endpoint|threat|SIEM|SOC|pentest|penetration|encryption|password|credential|leak|spyware|botnet|DDoS)\b/i;

function recategorize(ideas: Idea[], trends: TrendSignal[]): Idea[] {
  // Only promote ideas the LLM tagged "other" into ai/crypto/security if keywords match.
  // Never override ideas already tagged — that was pulling other ideas into wrong categories.
  return ideas.map(idea => {
    if (idea.category !== "other") return idea; // trust LLM-assigned categories
    const text = `${idea.name} ${idea.description}`;
    if (SECURITY_KW.test(text)) return { ...idea, category: "security" as const };
    if (CRYPTO_KW.test(text))   return { ...idea, category: "crypto" as const };
    if (AI_KW.test(text))       return { ...idea, category: "ai" as const };
    return idea;
  });
}

// ─── Step 3: Generate tweet angles per trend ─────────────────────────────────
// Not full drafts — just 3 distinct angles/hooks per trend that the user can
// take to Claude chat and turn into their own tweet in their own voice.

const TWEET_ANGLE_SYSTEM = `You help a solo tech founder find non-obvious angles on tech/crypto/startup/security news to tweet about.

For each trend, give 6 angles with DISTINCT lenses:
1. INCENTIVE lens — who specifically benefits, who's being misled, what's the real motive ("The quiet reason [Company] is doing [X] is [Y]")
2. CONTRARIAN lens — the "actually..." take, what everyone is getting wrong about this
3. BUILDER lens — what this means specifically for solo founders to DO this week, not just to think about
4. STORY lens — a micro-story hook with a specific outcome ("I did X because of this. Here's what happened: [number/result]")
5. PREDICTION lens — where this leads in 6-12 months that nobody is talking about yet
6. HOT TAKE lens — one punchy, polarizing opinion that makes people pick a side (agree or rage-reply)

Rules:
- Each angle = one punchy sentence, max 120 chars
- Name specific entities (companies, people, products) where possible
- Hook should make someone stop scrolling
- NOT a draft tweet — just the angle/hook to develop

Respond ONLY with valid JSON. No markdown.`;

function tweetAnglesUserPrompt(trends: TrendSignal[]): string {
  return `Today's trends:
${trends.map((t, i) => `${i + 1}. [${(t.category ?? "other").toUpperCase()}] ${t.trend}`).join("\n")}

For each trend, give 6 distinct tweet angles (one per lens). Return JSON:
{
  "tweetIdeas": [
    {"trend": "one-line summary of trend 1", "angles": ["incentive angle", "contrarian angle", "builder angle", "story angle", "prediction angle", "hot take angle"]},
    {"trend": "one-line summary of trend 2", "angles": ["..."]},
    {"trend": "one-line summary of trend 3", "angles": ["..."]}
  ]
}`;
}

function parseTweetAngles(raw: string): TweetIdea[] {
  const parsed = JSON.parse(stripFences(raw));
  return (
    parsed.tweetIdeas ?? parsed.tweet_ideas ?? parsed.ideas ?? parsed.trends ??
    (Array.isArray(parsed) ? parsed : Object.values(parsed).find(Array.isArray))
    ?? []
  ) as TweetIdea[];
}

async function generateTweetIdeas(trends: TrendSignal[]): Promise<TweetIdea[]> {
  const messages: { role: "system" | "user"; content: string }[] = [
    { role: "system", content: TWEET_ANGLE_SYSTEM },
    { role: "user",   content: tweetAnglesUserPrompt(trends) },
  ];

  // Run both models in parallel — same pattern as idea generation
  const [geminiRes, deepseekRes] = await Promise.allSettled([
    client.chat.completions.create({
      model: "google/gemini-2.5-flash",
      max_tokens: 2000,
      response_format: { type: "json_object" },
      messages,
    }),
    client.chat.completions.create({
      model: "deepseek/deepseek-v4-flash",
      max_tokens: 2000,
      response_format: { type: "json_object" },
      messages,
    }),
  ]);

  const geminiIdeas   = geminiRes.status   === "fulfilled" ? parseTweetAngles(geminiRes.value.choices[0].message.content   ?? "{}") : [];
  const deepseekIdeas = deepseekRes.status === "fulfilled" ? parseTweetAngles(deepseekRes.value.choices[0].message.content ?? "{}") : [];

  console.log(`[prompt] Tweet angles — Gemini: ${geminiIdeas.length} trends, DeepSeek: ${deepseekIdeas.length} trends`);

  // Merge by position: both models receive the same ordered trends list,
  // so index i from each model corresponds to the same trend.
  // Use Gemini's trend label; combine angles from both, deduplicate.
  const count = Math.max(geminiIdeas.length, deepseekIdeas.length);
  const merged: TweetIdea[] = [];
  for (let i = 0; i < count; i++) {
    const g = geminiIdeas[i];
    const d = deepseekIdeas[i];
    const base = g ?? d;
    const combinedAngles = [
      ...(g?.angles ?? []),
      ...(d?.angles ?? []).filter(a => !(g?.angles ?? []).some(ga => ga.toLowerCase() === a.toLowerCase())),
    ];
    merged.push({ ...base, angles: combinedAngles });
  }

  // Attach source metadata from the corresponding trend
  return merged.map((idea, i) => ({
    ...idea,
    category:    trends[i]?.category,
    sourceUrl:   trends[i]?.sourceUrl,
    sourceTitle: trends[i]?.sourceTitle,
  }));
}

// ─── Step 4: Hamming filter — which ideas are actually worth building? ────────
// Applies Richard Hamming's question ("what's the important problem and why
// aren't you working on it?") + Schulman's backwards reasoning to cut through
// the absorbed-from-trending noise and surface the 2-3 genuinely worth pursuing.

async function evaluateIdeas(ideas: Idea[], trends: TrendSignal[]): Promise<IdeaEval[]> {
  const ideasText = ideas
    .map((idea, i) => `${i + 1}. [${idea.category ?? "other"}] ${idea.name} — ${idea.description}`)
    .join("\n");

  const trendsText = trends.map(t => t.trend).join("\n");

  const response = await client.chat.completions.create({
    model: "deepseek/deepseek-v4-flash",
    max_tokens: 1000,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: `You are a brutal research advisor applying Richard Hamming's question to startup ideas.

Hamming's question: "What are the important problems in your field, and why aren't you working on them?"

Most ideas are absorbed from what's trending — they're reactions, not choices. Your job is to find the 2-3 ideas that are genuinely important, not just topical.

For each pick, answer:
1. WHY this problem matters beyond this week's trend — and why others aren't building it (is it contrarian? technically hard? unglamorous?)
2. WHAT must be true in 2 years for this to matter — the key assumption that needs to hold
3. KILL CONDITION — one sentence that would make you drop it immediately ("if X turns out to be true, this is dead")

Be brutal. Most ideas are noise. Only surface ones that would survive Hamming asking "why aren't a thousand people already building this?"

Respond ONLY with valid JSON. No markdown.`,
      },
      {
        role: "user",
        content: `Today's trends:\n${trendsText}\n\nToday's ideas:\n${ideasText}\n\nPick the top 2-3 worth actually building. Return JSON:\n{"eval": [{"name": "idea name", "why": "one sentence", "belief": "one sentence", "killCondition": "one sentence"}, ...]}`,
      },
    ],
  });

  const text = stripFences(response.choices[0].message.content ?? "{}");
  const { eval: picks } = JSON.parse(text);
  return (picks ?? []) as IdeaEval[];
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

  // Generate ideas + tweet angles in parallel
  console.log(`[prompt] Generating ideas from ${IDEA_MODELS.length} models + tweet angles in parallel...`);
  const [results, tweetIdeas] = await Promise.all([
    Promise.allSettled(
      IDEA_MODELS.map(m =>
        generateIdeasFromModel(m.id, m.label, trends, previousRuns, likedIdeas)
      )
    ),
    generateTweetIdeas(trends).catch(err => {
      console.warn("[prompt] Tweet ideas failed:", err?.message);
      return [] as TweetIdea[];
    }),
  ]);

  // Keyword-correct any ideas the LLM miscategorized (needed before eval)
  // Note: we do this early so evaluateIdeas sees the corrected list

  const allIdeas: Idea[] = [];
  for (const [i, result] of results.entries()) {
    if (result.status === "fulfilled") {
      console.log(`[prompt] ${IDEA_MODELS[i].label}: ${result.value.length} ideas`);
      allIdeas.push(...result.value);
    } else {
      console.warn(`[prompt] ${IDEA_MODELS[i].label} failed:`, result.reason?.message);
    }
  }

  // Keyword-correct any ideas the LLM miscategorized
  // Note: we do this early so evaluateIdeas sees the corrected list (comment already above)
  const correctedIdeas = recategorize(allIdeas, trends);

  const topPick = correctedIdeas[0]
    ? `${correctedIdeas[0].name} — top pick from ${correctedIdeas[0].model}`
    : "N/A";

  // Return primary trend for storage
  const primary = trends[0] ?? { trend: "", mechanic: "", trendSource: "", rawMechanic: "other", category: "other" as const };
  const trendsByCategory = {
    ai:       trends.filter(t => t.category === "ai").map(t => t.trend),
    crypto:   trends.filter(t => t.category === "crypto").map(t => t.trend),
    security: trends.filter(t => t.category === "security").map(t => t.trend),
    other:    trends.filter(t => !t.category || t.category === "other").map(t => t.trend),
  };
  console.log(`[prompt] Tweet angles: ${tweetIdeas.length} trends covered`);

  // Run Hamming filter on corrected ideas
  const ideaEval = await evaluateIdeas(correctedIdeas, trends).catch(err => {
    console.warn("[prompt] Idea eval failed (non-fatal):", err?.message);
    return [] as IdeaEval[];
  });
  console.log(`[prompt] Hamming filter: ${ideaEval.length} ideas surfaced`);

  return {
    trend: trends.map(t => t.trend).join(" | "),
    mechanic: primary.mechanic,
    trendSource: primary.trendSource,
    ideas: correctedIdeas,
    topPick,
    sources: trends
      .filter(t => t.sourceUrl && t.sourceTitle)
      .map(t => ({ title: t.sourceTitle!, url: t.sourceUrl! })),
    trendsByCategory,
    tweetIdeas,
    ideaEval,
  };
}

// ─── Media recommendations ────────────────────────────────────────────────────

export async function pickMediaRecs(
  trendSummary: string,
  media: import("./media").MediaItem[],
  likedShows: string[] = []
): Promise<MediaRec[]> {
  if (!media.length) return [];

  const catalogue = media
    .slice(0, 60)
    .map((m, i) => `${i + 1}. [${m.type === "youtube" ? "YT" : "POD"}] ${m.show} — "${m.title}"`)
    .join("\n");

  const likedBlock = likedShows.length
    ? `\nShows Srini has liked before (prioritise these if relevant): ${[...new Set(likedShows)].join(", ")}\n`
    : "";

  const prompt = `Today's trending topics in AI/crypto/startups:
${trendSummary}
${likedBlock}
Recent episodes/videos available:
${catalogue}

Pick the 3-5 most relevant episodes. Quality over quantity — only include ones directly connected to today's topics. Mix podcasts + YouTube where possible.

Reply with JSON only — an array of objects:
[{ "index": <1-based number>, "reason": "<one sentence: why this is relevant to today>" }]`;

  const res = await client.chat.completions.create({
    model: "deepseek/deepseek-v4-flash",
    messages: [{ role: "user", content: prompt }],
    response_format: { type: "json_object" },
    temperature: 0.3,
  });

  try {
    const raw = res.choices[0]?.message?.content ?? "{}";
    console.log(`[prompt] pickMediaRecs raw: ${raw.slice(0, 200)}`);
    const parsed = JSON.parse(raw);
    // Tolerate: bare array, wrapped array, or single object (when model picks exactly 1)
    const rawPicks = Array.isArray(parsed)
      ? parsed
      : parsed.picks ?? parsed.recommendations ?? parsed.results ?? parsed.episodes ?? Object.values(parsed).find(Array.isArray) ?? parsed;
    const picks: { index: number; reason: string }[] = Array.isArray(rawPicks)
      ? rawPicks
      : typeof rawPicks === "object" && rawPicks !== null && "index" in rawPicks
        ? [rawPicks]   // single pick returned as bare object
        : [];

    const capped = picks.slice(0, 5); // hard cap — Telegram message has a 4096 char limit
    console.log(`[prompt] pickMediaRecs: ${capped.length} picks from ${media.length} items`);
    return capped.map(p => {
      const item = media[p.index - 1];
      if (!item) return null;
      return { show: item.show, title: item.title, url: item.url, type: item.type, reason: p.reason };
    }).filter(Boolean) as MediaRec[];
  } catch (err) {
    console.warn("[prompt] pickMediaRecs: failed to parse response:", (err as Error).message);
    return [];
  }
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
