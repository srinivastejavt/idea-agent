import {
  __name,
  init_esm
} from "./chunk-23OQHB7B.mjs";

// src/scraper.ts
init_esm();
async function safeFetch(url, opts) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(1e4), ...opts });
    if (!res.ok) return null;
    return res;
  } catch {
    return null;
  }
}
__name(safeFetch, "safeFetch");
function parseRssItems(xml) {
  const items = [];
  const itemRegex = /<item[\s\S]*?<\/item>/g;
  let match;
  while ((match = itemRegex.exec(xml)) !== null) {
    const block = match[0];
    const title = (/<title[^>]*><!\[CDATA\[([\s\S]*?)\]\]><\/title>/.exec(block) || /<title[^>]*>([\s\S]*?)<\/title>/.exec(block))?.[1]?.trim() ?? "";
    const link = (/<link>([\s\S]*?)<\/link>/.exec(block) || /<link[^>]+href="([^"]+)"/.exec(block))?.[1]?.trim() ?? "";
    const pubDate = /<pubDate>([\s\S]*?)<\/pubDate>/.exec(block)?.[1]?.trim() ?? (/* @__PURE__ */ new Date()).toISOString();
    const description = (/<description[^>]*><!\[CDATA\[([\s\S]*?)\]\]><\/description>/.exec(block) || /<description[^>]*>([\s\S]*?)<\/description>/.exec(block))?.[1]?.replace(/<[^>]+>/g, "").trim();
    if (title && link) items.push({ title, link, pubDate, description });
  }
  return items;
}
__name(parseRssItems, "parseRssItems");
async function scrapeHNTopStories() {
  const idsRes = await safeFetch("https://hacker-news.firebaseio.com/v0/topstories.json");
  if (!idsRes) return [];
  const ids = await idsRes.json();
  const results = await Promise.allSettled(
    ids.slice(0, 30).map(async (id) => {
      const r = await safeFetch(`https://hacker-news.firebaseio.com/v0/item/${id}.json`);
      if (!r) return null;
      const item = await r.json();
      if (!item || item.type !== "story" || !item.title) return null;
      return {
        title: item.title,
        url: item.url ?? `https://news.ycombinator.com/item?id=${id}`,
        points: item.score ?? 0,
        comments: item.descendants ?? 0,
        source: "hackernews",
        createdAt: new Date((item.time ?? 0) * 1e3).toISOString()
      };
    })
  );
  return results.filter(
    (r) => r.status === "fulfilled" && r.value !== null
  ).map((r) => r.value);
}
__name(scrapeHNTopStories, "scrapeHNTopStories");
async function scrapeHNAlgolia(tag) {
  const since = Math.floor((Date.now() - 864e5) / 1e3);
  const url = `https://hn.algolia.com/api/v1/search_by_date?tags=${tag}&hitsPerPage=50&numericFilters=created_at_i>${since}`;
  const res = await safeFetch(url);
  if (!res) return [];
  const data = await res.json();
  return (data.hits ?? []).map((h) => ({
    title: h.title,
    url: h.url ?? `https://news.ycombinator.com/item?id=${h.objectID}`,
    points: h.points ?? 0,
    comments: h.num_comments ?? 0,
    source: "hackernews",
    createdAt: h.created_at
  }));
}
__name(scrapeHNAlgolia, "scrapeHNAlgolia");
async function scrapeHNKeywords() {
  const keywords = ["built a tool", "i made", "weekend project", "side project", "open source"];
  const since = Math.floor((Date.now() - 864e5) / 1e3);
  const results = [];
  for (const kw of keywords) {
    const url = `https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(kw)}&tags=story&hitsPerPage=20&numericFilters=created_at_i>${since}`;
    const res = await safeFetch(url);
    if (!res) continue;
    const data = await res.json();
    for (const h of data.hits ?? []) {
      if (h.title) {
        results.push({
          title: h.title,
          url: h.url ?? `https://news.ycombinator.com/item?id=${h.objectID}`,
          points: h.points ?? 0,
          comments: h.num_comments ?? 0,
          source: "hackernews",
          createdAt: h.created_at
        });
      }
    }
  }
  return results;
}
__name(scrapeHNKeywords, "scrapeHNKeywords");
async function scrapeHackerNews() {
  const [top, showHN, askHN, keywords] = await Promise.allSettled([
    scrapeHNTopStories(),
    scrapeHNAlgolia("show_hn"),
    scrapeHNAlgolia("ask_hn"),
    scrapeHNKeywords()
  ]);
  return [
    ...top.status === "fulfilled" ? top.value : [],
    ...showHN.status === "fulfilled" ? showHN.value : [],
    ...askHN.status === "fulfilled" ? askHN.value : [],
    ...keywords.status === "fulfilled" ? keywords.value : []
  ];
}
__name(scrapeHackerNews, "scrapeHackerNews");
var SUBREDDITS = [
  "entrepreneur",
  "SideProject",
  "indiehackers",
  "buildinpublic",
  "programming",
  "webdev",
  "MachineLearning",
  "artificial",
  "wallstreetbets",
  "CryptoCurrency",
  "InternetIsBeautiful",
  "hailcorporate"
];
async function scrapeSubreddit(sub) {
  const url = `https://www.reddit.com/r/${sub}/top/.rss?t=day&limit=25`;
  const res = await safeFetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      "Accept": "application/rss+xml, application/xml, text/xml"
    }
  });
  if (!res) return [];
  const xml = await res.text();
  return parseRssItems(xml).map((item) => ({
    title: item.title,
    url: item.link,
    points: 0,
    comments: 0,
    source: "reddit",
    subreddit: sub,
    description: item.description,
    createdAt: new Date(item.pubDate).toISOString()
  }));
}
__name(scrapeSubreddit, "scrapeSubreddit");
async function scrapeReddit() {
  const results = await Promise.allSettled(SUBREDDITS.map(scrapeSubreddit));
  return results.flatMap((r) => r.status === "fulfilled" ? r.value : []);
}
__name(scrapeReddit, "scrapeReddit");
async function scrapeYCLaunches() {
  const res = await safeFetch("https://www.ycombinator.com/launches", {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; idea-agent/1.0)" }
  });
  if (!res) return [];
  const html = await res.text();
  const posts = [];
  const linkRegex = /href="(\/launches\/[^"]+)"/g;
  const titleRegex = /<h[23][^>]*>([\s\S]*?)<\/h[23]>/g;
  const links = [];
  let m;
  while ((m = linkRegex.exec(html)) !== null) {
    const href = m[1];
    if (!links.includes(href)) links.push(href);
  }
  const cardRegex = /<a[^>]+href="(\/launches\/[^"]+)"[^>]*>[\s\S]*?<[^>]+>([^<]{5,80})<\/[^>]+>[\s\S]*?<[^>]+>([^<]{10,200})<\/[^>]+>/g;
  while ((m = cardRegex.exec(html)) !== null) {
    const path = m[1];
    const name = m[2].trim();
    const tagline = m[3].trim();
    if (name && tagline && !name.includes("YC") && tagline.length > 15) {
      posts.push({
        title: `${name} — ${tagline}`,
        url: `https://www.ycombinator.com${path}`,
        points: 0,
        comments: 0,
        source: "ycombinator",
        description: tagline,
        createdAt: (/* @__PURE__ */ new Date()).toISOString()
      });
    }
    if (posts.length >= 20) break;
  }
  if (posts.length < 5) {
    for (const path of links.slice(0, 20)) {
      const slug = path.replace("/launches/", "").replace(/-/g, " ");
      posts.push({
        title: slug,
        url: `https://www.ycombinator.com${path}`,
        points: 0,
        comments: 0,
        source: "ycombinator",
        createdAt: (/* @__PURE__ */ new Date()).toISOString()
      });
    }
  }
  return posts;
}
__name(scrapeYCLaunches, "scrapeYCLaunches");
async function scrapeProductHunt() {
  const res = await safeFetch("https://www.producthunt.com/feed", {
    headers: {
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      "Accept": "application/rss+xml, application/xml, text/xml, */*"
    }
  });
  if (!res) return [];
  const xml = await res.text();
  return parseRssItems(xml).slice(0, 30).map((item) => ({
    title: item.title,
    url: item.link,
    points: 0,
    comments: 0,
    source: "producthunt",
    description: item.description,
    createdAt: new Date(item.pubDate).toISOString()
  }));
}
__name(scrapeProductHunt, "scrapeProductHunt");
async function scrapeTechCrunch() {
  const feeds = [
    "https://techcrunch.com/feed/",
    // general
    "https://techcrunch.com/startups/feed/"
    // funding + launches
  ];
  const results = await Promise.allSettled(feeds.map(async (feedUrl) => {
    const res = await safeFetch(feedUrl);
    if (!res) return [];
    const xml = await res.text();
    return parseRssItems(xml).slice(0, 20).map((item) => ({
      title: item.title,
      url: item.link,
      points: 0,
      comments: 0,
      source: "techcrunch",
      description: item.description,
      createdAt: new Date(item.pubDate).toISOString()
    }));
  }));
  return results.flatMap((r) => r.status === "fulfilled" ? r.value : []);
}
__name(scrapeTechCrunch, "scrapeTechCrunch");
async function scrapeLobsters() {
  const res = await safeFetch("https://lobste.rs/rss");
  if (!res) return [];
  const xml = await res.text();
  return parseRssItems(xml).slice(0, 25).map((item) => ({
    title: item.title,
    url: item.link,
    points: 0,
    comments: 0,
    source: "lobsters",
    description: item.description,
    createdAt: new Date(item.pubDate).toISOString()
  }));
}
__name(scrapeLobsters, "scrapeLobsters");
async function scrapeHuggingFacePapers() {
  const res = await safeFetch("https://huggingface.co/api/daily_papers");
  if (!res) return [];
  const papers = await res.json();
  return (papers ?? []).slice(0, 20).map((p) => ({
    title: p.paper?.title ?? p.title ?? "Untitled paper",
    url: `https://huggingface.co/papers/${p.paper?.id ?? p.id}`,
    points: p.upvotes ?? 0,
    comments: p.numComments ?? 0,
    source: "huggingface",
    description: p.paper?.summary?.slice(0, 200),
    createdAt: p.publishedAt ?? (/* @__PURE__ */ new Date()).toISOString()
  }));
}
__name(scrapeHuggingFacePapers, "scrapeHuggingFacePapers");
async function scrapeDevTo() {
  const res = await safeFetch("https://dev.to/api/articles?top=1&per_page=30");
  if (!res) return [];
  const articles = await res.json();
  return (articles ?? []).map((a) => ({
    title: a.title,
    url: a.url,
    points: a.positive_reactions_count ?? 0,
    comments: a.comments_count ?? 0,
    source: "devto",
    description: a.description,
    createdAt: a.published_at ?? (/* @__PURE__ */ new Date()).toISOString()
  }));
}
__name(scrapeDevTo, "scrapeDevTo");
async function scrapeGitHubTrending() {
  const res = await safeFetch(
    "https://github.com/trending?since=daily&spoken_language_code=en"
  );
  if (!res) return [];
  const html = await res.text();
  const posts = [];
  const SKIP_PREFIXES = ["sponsors/", "orgs/", "marketplace", "topics/", "trending/"];
  const articleRegex = /<article[\s\S]*?<\/article>/g;
  let match;
  while ((match = articleRegex.exec(html)) !== null) {
    const block = match[0];
    const nameMatch = /href="\/([^/"]+\/[^/"]+)"/.exec(block);
    if (!nameMatch) continue;
    const repoPath = nameMatch[1].trim();
    if (SKIP_PREFIXES.some((p) => repoPath.startsWith(p))) continue;
    const descMatch = /<p[^>]*class="[^"]*col-9[^"]*"[^>]*>([\s\S]*?)<\/p>/.exec(block);
    const description = descMatch?.[1]?.replace(/<[^>]+>/g, "").trim() ?? "";
    const starsMatch = /[\d,]+ stars today/.exec(block);
    const starsToday = starsMatch ? parseInt(starsMatch[0].replace(/[^0-9]/g, ""), 10) : 0;
    posts.push({
      title: repoPath.replace("/", " / "),
      url: `https://github.com/${repoPath}`,
      points: starsToday,
      comments: 0,
      source: "github",
      description,
      createdAt: (/* @__PURE__ */ new Date()).toISOString()
    });
  }
  return posts;
}
__name(scrapeGitHubTrending, "scrapeGitHubTrending");
async function scrapeIndieHackers() {
  const res = await safeFetch("https://www.indiehackers.com/feed.xml", {
    headers: {
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    }
  });
  if (!res) return [];
  const xml = await res.text();
  return parseRssItems(xml).slice(0, 20).map((item) => ({
    title: item.title,
    url: item.link,
    points: 0,
    comments: 0,
    source: "indiehackers",
    description: item.description,
    createdAt: new Date(item.pubDate).toISOString()
  }));
}
__name(scrapeIndieHackers, "scrapeIndieHackers");
async function scrapeBluesky() {
  const queries = ["buildinpublic", "launched today", "built a tool", "side project"];
  const posts = [];
  for (const q of queries) {
    const url = `https://public.api.bsky.app/xrpc/app.bsky.feed.searchPosts?q=${encodeURIComponent(q)}&limit=25&sort=top`;
    const res = await safeFetch(url);
    if (!res) continue;
    const data = await res.json();
    for (const item of data.posts ?? []) {
      const text = item.record?.text ?? "";
      if (text.length < 30) continue;
      posts.push({
        title: text.slice(0, 120).replace(/\n/g, " "),
        url: `https://bsky.app/profile/${item.author?.handle}/post/${item.uri?.split("/").pop()}`,
        points: (item.likeCount ?? 0) + (item.repostCount ?? 0),
        comments: item.replyCount ?? 0,
        source: "bluesky",
        createdAt: item.indexedAt ?? (/* @__PURE__ */ new Date()).toISOString()
      });
    }
  }
  return posts;
}
__name(scrapeBluesky, "scrapeBluesky");
async function scrapeTwitter() {
  console.log("[scraper] Twitter/X: Phase 2 — set APIFY_API_TOKEN to enable");
  return [];
}
__name(scrapeTwitter, "scrapeTwitter");
function deduplicateByTitle(posts) {
  const seen = /* @__PURE__ */ new Set();
  return posts.filter((p) => {
    const key = p.title.toLowerCase().replace(/[^a-z0-9 ]/g, "").slice(0, 60).trim();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
__name(deduplicateByTitle, "deduplicateByTitle");
function scorePost(post) {
  const ageMs = Date.now() - new Date(post.createdAt).getTime();
  const ageHours = Math.max(ageMs / (1e3 * 60 * 60), 0.1);
  const velocity = (post.points + post.comments * 1.5) / ageHours;
  const commentRatio = post.points > 0 ? post.comments / post.points : 0;
  const recencyBoost = ageHours < 6 ? 1.6 : ageHours < 12 ? 1.3 : 1;
  const sourceWeight = {
    hackernews: 1.5,
    // front page = proven signal
    ycombinator: 1.6,
    // vetted founders, real launches
    lobsters: 1.4,
    // curated, low noise
    github: 1.3,
    // stars today = real momentum
    twitter: 1.4,
    // fastest signal (Phase 2)
    bluesky: 1.2,
    // growing, less noise than Twitter
    producthunt: 1.2,
    // curated launches
    techcrunch: 1.1,
    // lagging indicator but broad reach
    huggingface: 1.2,
    // pre-trend signal for AI
    indiehackers: 1,
    reddit: 1,
    devto: 0.9
  };
  const effectiveAgeHours = post.source === "github" ? Math.max(ageHours, 12) : ageHours;
  const effectiveVelocity = (post.points + post.comments * 1.5) / effectiveAgeHours;
  const base = effectiveVelocity + commentRatio * 10 + post.points * 0.1;
  return base * recencyBoost * (sourceWeight[post.source] ?? 1);
}
__name(scorePost, "scorePost");
async function fetchTrends() {
  console.log("[scraper] Fetching trends from all sources...");
  const [hn, reddit, yc, ph, tc, lobsters, hf, devto, github, ih, bsky, twitter] = await Promise.allSettled([
    scrapeHackerNews(),
    scrapeReddit(),
    scrapeYCLaunches(),
    scrapeProductHunt(),
    scrapeTechCrunch(),
    scrapeLobsters(),
    scrapeHuggingFacePapers(),
    scrapeDevTo(),
    scrapeGitHubTrending(),
    scrapeIndieHackers(),
    scrapeBluesky(),
    scrapeTwitter()
  ]);
  const raw = [
    ...hn.status === "fulfilled" ? hn.value : [],
    ...reddit.status === "fulfilled" ? reddit.value : [],
    ...yc.status === "fulfilled" ? yc.value : [],
    ...ph.status === "fulfilled" ? ph.value : [],
    ...tc.status === "fulfilled" ? tc.value : [],
    ...lobsters.status === "fulfilled" ? lobsters.value : [],
    ...hf.status === "fulfilled" ? hf.value : [],
    ...devto.status === "fulfilled" ? devto.value : [],
    ...github.status === "fulfilled" ? github.value : [],
    ...ih.status === "fulfilled" ? ih.value : [],
    ...bsky.status === "fulfilled" ? bsky.value : [],
    ...twitter.status === "fulfilled" ? twitter.value : []
  ];
  const sourceCounts = raw.reduce(
    (acc, p) => ({ ...acc, [p.source]: (acc[p.source] ?? 0) + 1 }),
    {}
  );
  console.log("[scraper] Raw counts by source:", sourceCounts);
  const all = deduplicateByTitle(raw);
  const SOURCE_CAPS = {
    hackernews: 20,
    devto: 8,
    github: 8,
    techcrunch: 8,
    lobsters: 8,
    huggingface: 8,
    reddit: 8,
    bluesky: 6,
    producthunt: 6,
    ycombinator: 6,
    indiehackers: 5,
    twitter: 10
  };
  const scored = [...all].sort((a, b) => scorePost(b) - scorePost(a));
  const sourceSeen = {};
  const top = [];
  for (const post of scored) {
    const cap = SOURCE_CAPS[post.source] ?? 10;
    const seen = sourceSeen[post.source] ?? 0;
    if (seen >= cap) continue;
    sourceSeen[post.source] = seen + 1;
    top.push(post);
    if (top.length >= 50) break;
  }
  const topSourceCounts = top.reduce(
    (acc, p) => ({ ...acc, [p.source]: (acc[p.source] ?? 0) + 1 }),
    {}
  );
  console.log("[scraper] Top 50 source breakdown:", topSourceCounts);
  console.log(
    `[scraper] ${raw.length} raw → ${all.length} deduped (→ Sheets) → top ${top.length} (→ LLM)`
  );
  return { all, top };
}
__name(fetchTrends, "fetchTrends");
var isMain = process.argv[1]?.endsWith("scraper.ts");
if (isMain) {
  fetchTrends().then(({ all, top }) => {
    console.log("\n=== TOP 10 POSTS ===");
    top.slice(0, 10).forEach((p, i) => {
      console.log(`${i + 1}. [${p.source}] ${p.title}`);
      console.log(`   ${p.url}`);
      console.log(`   pts:${p.points} comments:${p.comments}`);
    });
    console.log(`
Total scraped: ${all.length}`);
  });
}

export {
  fetchTrends
};
//# sourceMappingURL=chunk-RBCBVPIP.mjs.map
