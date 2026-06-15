/**
 * Trend Scraper — Phase 1 (all free, no auth required)
 *
 * Sources:
 *   HackerNews    → Firebase top stories + Algolia (Show HN, Ask HN, keyword search)
 *   Reddit        → 12 subreddits × hot + top (day)
 *   YC Launches   → ycombinator.com/launches HTML scrape
 *   ProductHunt   → Official RSS feed
 *   TechCrunch    → RSS (general + startups feed)
 *   Lobste.rs     → RSS (curated tech, higher signal than HN)
 *   HuggingFace   → Daily papers API (papers about to become products)
 *   Dev.to        → Public articles API (top of day)
 *   GitHub        → Trending page HTML scrape (stars today)
 *   Indie Hackers  → RSS feed
 *   Bluesky        → Public API search (growing tech/founder community)
 *   CoinDesk       → RSS (crypto news of record)
 *   Cointelegraph  → RSS (crypto + web3)
 *   The Block      → RSS (institutional crypto journalism)
 *   Decrypt        → RSS (consumer crypto + web3)
 *   Blockworks     → RSS (DeFi/institutional)
 *   Bitcoin Mag    → RSS (Bitcoin-specific)
 *   Reddit crypto  → r/CryptoCurrency, r/ethereum, r/bitcoin, r/defi, r/web3, r/solana
 *
 * X/Twitter: Apify apidojo/tweet-scraper — set APIFY_API_TOKEN to enable
 */

export interface TrendPost {
  title: string;
  url: string;
  points: number;
  comments: number;
  source:
    | "hackernews"
    | "reddit"
    | "ycombinator"
    | "producthunt"
    | "techcrunch"
    | "lobsters"
    | "huggingface"
    | "devto"
    | "github"
    | "indiehackers"
    | "bluesky"
    | "twitter"
    | "coindesk"
    | "cointelegraph"
    | "decrypt"
    | "theblock"
    | "blockworks"
    | "bitcoinmagazine"
    | "messari"
    | "cryptoslate"
    | "cryptobriefing"
    | "beincrypto"
    | "bankless"
    | "cryptonews"
    | "dlnews"
    | "wublockchain"
    | "coingeckonews"
    | "rwaxyz";
  subreddit?: string;
  description?: string;
  createdAt: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const MAX_RESPONSE_BYTES = 2 * 1024 * 1024; // 2MB cap per source — prevents huge HTML pages blowing memory

async function safeFetch(url: string, opts?: RequestInit): Promise<Response | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000), ...opts });
    if (!res.ok) return null;

    // Check content-length upfront and bail if too large
    const contentLength = res.headers.get("content-length");
    if (contentLength && parseInt(contentLength) > MAX_RESPONSE_BYTES) {
      console.warn(`[scraper] ${url} skipped — content-length ${contentLength} exceeds 2MB cap`);
      return null;
    }

    return res;
  } catch {
    return null;
  }
}

/** Read response body with a hard 2MB cap — prevents large HTML pages (GitHub, YC) from OOMing */
async function safeText(res: Response): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) return res.text();

  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    totalBytes += value.byteLength;
    if (totalBytes > MAX_RESPONSE_BYTES) {
      reader.cancel();
      break;
    }
    chunks.push(value);
  }

  const combined = new Uint8Array(totalBytes > MAX_RESPONSE_BYTES ? MAX_RESPONSE_BYTES : totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(combined);
}

/** Parse RSS/Atom <item> blocks without an external library */
function parseRssItems(
  xml: string
): { title: string; link: string; pubDate: string; description?: string }[] {
  const items: { title: string; link: string; pubDate: string; description?: string }[] = [];
  const itemRegex = /<item[\s\S]*?<\/item>/g;
  let match;
  while ((match = itemRegex.exec(xml)) !== null) {
    const block = match[0];
    const title =
      (/<title[^>]*><!\[CDATA\[([\s\S]*?)\]\]><\/title>/.exec(block) ||
        /<title[^>]*>([\s\S]*?)<\/title>/.exec(block))?.[1]?.trim() ?? "";
    // <link> in Atom can be self-closing or have CDATA; cover both
    const link =
      (/<link>([\s\S]*?)<\/link>/.exec(block) ||
        /<link[^>]+href="([^"]+)"/.exec(block))?.[1]?.trim() ?? "";
    const pubDate =
      (/<pubDate>([\s\S]*?)<\/pubDate>/.exec(block))?.[1]?.trim() ??
      new Date().toISOString();
    const description =
      (/<description[^>]*><!\[CDATA\[([\s\S]*?)\]\]><\/description>/.exec(block) ||
        /<description[^>]*>([\s\S]*?)<\/description>/.exec(block))?.[1]
        ?.replace(/<[^>]+>/g, "")
        .trim();
    if (title && link) items.push({ title, link, pubDate, description });
  }
  return items;
}

// ─── HackerNews ──────────────────────────────────────────────────────────────

async function scrapeHNTopStories(): Promise<TrendPost[]> {
  const idsRes = await safeFetch("https://hacker-news.firebaseio.com/v0/topstories.json");
  if (!idsRes) return [];
  const ids: number[] = await idsRes.json();

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
        source: "hackernews" as const,
        createdAt: new Date((item.time ?? 0) * 1000).toISOString(),
      };
    })
  );
  return results
    .filter(
      (r): r is PromiseFulfilledResult<TrendPost> =>
        r.status === "fulfilled" && r.value !== null
    )
    .map((r) => r.value);
}

async function scrapeHNAlgolia(tag: "show_hn" | "ask_hn"): Promise<TrendPost[]> {
  const since = Math.floor((Date.now() - 86_400_000) / 1000);
  const url = `https://hn.algolia.com/api/v1/search_by_date?tags=${tag}&hitsPerPage=50&numericFilters=created_at_i>${since}`;
  const res = await safeFetch(url);
  if (!res) return [];
  const data = await res.json();
  return (data.hits ?? []).map((h: any) => ({
    title: h.title,
    url: h.url ?? `https://news.ycombinator.com/item?id=${h.objectID}`,
    points: h.points ?? 0,
    comments: h.num_comments ?? 0,
    source: "hackernews" as const,
    createdAt: h.created_at,
  }));
}

async function scrapeHNKeywords(): Promise<TrendPost[]> {
  const keywords = ["built a tool", "i made", "weekend project", "side project", "open source"];
  const since = Math.floor((Date.now() - 86_400_000) / 1000);
  const results: TrendPost[] = [];
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
          source: "hackernews" as const,
          createdAt: h.created_at,
        });
      }
    }
  }
  return results;
}

async function scrapeHackerNews(): Promise<TrendPost[]> {
  const [top, showHN, askHN, keywords] = await Promise.allSettled([
    scrapeHNTopStories(),
    scrapeHNAlgolia("show_hn"),
    scrapeHNAlgolia("ask_hn"),
    scrapeHNKeywords(),
  ]);
  return [
    ...(top.status === "fulfilled" ? top.value : []),
    ...(showHN.status === "fulfilled" ? showHN.value : []),
    ...(askHN.status === "fulfilled" ? askHN.value : []),
    ...(keywords.status === "fulfilled" ? keywords.value : []),
  ];
}

// ─── Reddit ──────────────────────────────────────────────────────────────────

const SUBREDDITS = [
  // Founder / build community
  "entrepreneur", "SideProject", "indiehackers", "buildinpublic",
  // Tech
  "programming", "webdev", "MachineLearning", "artificial",
  // Security / Cybersecurity
  "netsec", "cybersecurity",
  // Crypto / Web3
  "CryptoCurrency", "ethereum", "bitcoin", "defi", "web3", "solana",
  // Other
  "InternetIsBeautiful", "wallstreetbets",
];

async function scrapeSubreddit(sub: string): Promise<TrendPost[]> {
  // Use RSS feeds — these still work publicly without auth
  const url = `https://www.reddit.com/r/${sub}/top/.rss?t=day&limit=25`;
  const res = await safeFetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      "Accept": "application/rss+xml, application/xml, text/xml",
    },
  });
  if (!res) return [];
  const xml = await safeText(res);
  return parseRssItems(xml).map((item) => ({
    title: item.title,
    url: item.link,
    points: 0,
    comments: 0,
    source: "reddit" as const,
    subreddit: sub,
    description: item.description,
    createdAt: new Date(item.pubDate).toISOString(),
  }));
}

async function scrapeReddit(): Promise<TrendPost[]> {
  const results = await Promise.allSettled(SUBREDDITS.map(scrapeSubreddit));
  return results.flatMap((r) => (r.status === "fulfilled" ? r.value : []));
}

// ─── YC Launches ─────────────────────────────────────────────────────────────

async function scrapeYCLaunches(): Promise<TrendPost[]> {
  // Public page — every YC company posts their launch here
  // High signal: these are live products from vetted founders
  const res = await safeFetch("https://www.ycombinator.com/launches", {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; idea-agent/1.0)" },
  });
  if (!res) return [];
  const html = await safeText(res);

  const posts: TrendPost[] = [];

  // Each launch is a card with a link and title
  // Pattern: <a href="/launches/SLUG-company-name">
  const linkRegex = /href="(\/launches\/[^"]+)"/g;
  const titleRegex = /<h[23][^>]*>([\s\S]*?)<\/h[23]>/g;

  const links: string[] = [];
  let m;
  while ((m = linkRegex.exec(html)) !== null) {
    const href = m[1];
    if (!links.includes(href)) links.push(href);
  }

  // Extract company name + one-liner from surrounding context
  // YC launch cards: title is the company name, subtitle is the one-liner
  const cardRegex =
    /<a[^>]+href="(\/launches\/[^"]+)"[^>]*>[\s\S]*?<[^>]+>([^<]{5,80})<\/[^>]+>[\s\S]*?<[^>]+>([^<]{10,200})<\/[^>]+>/g;

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
        source: "ycombinator" as const,
        description: tagline,
        createdAt: new Date().toISOString(),
      });
    }
    if (posts.length >= 20) break;
  }

  // Fallback: if card regex misses, use raw links with slugs as titles
  if (posts.length < 5) {
    for (const path of links.slice(0, 20)) {
      const slug = path.replace("/launches/", "").replace(/-/g, " ");
      posts.push({
        title: slug,
        url: `https://www.ycombinator.com${path}`,
        points: 0,
        comments: 0,
        source: "ycombinator" as const,
        createdAt: new Date().toISOString(),
      });
    }
  }

  return posts;
}

// ─── ProductHunt ─────────────────────────────────────────────────────────────

async function scrapeProductHunt(): Promise<TrendPost[]> {
  const res = await safeFetch("https://www.producthunt.com/feed", {
    headers: {
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      "Accept": "application/rss+xml, application/xml, text/xml, */*",
    },
  });
  if (!res) return [];
  const xml = await safeText(res);
  return parseRssItems(xml)
    .slice(0, 30)
    .map((item) => ({
      title: item.title,
      url: item.link,
      points: 0,
      comments: 0,
      source: "producthunt" as const,
      description: item.description,
      createdAt: new Date(item.pubDate).toISOString(),
    }));
}

// ─── TechCrunch ──────────────────────────────────────────────────────────────

async function scrapeTechCrunch(): Promise<TrendPost[]> {
  const feeds = [
    "https://techcrunch.com/feed/",           // general
    "https://techcrunch.com/startups/feed/",  // funding + launches
  ];
  const results = await Promise.allSettled(feeds.map(async (feedUrl) => {
    const res = await safeFetch(feedUrl);
    if (!res) return [];
    const xml = await safeText(res);
    return parseRssItems(xml).slice(0, 20).map((item) => ({
      title: item.title,
      url: item.link,
      points: 0,
      comments: 0,
      source: "techcrunch" as const,
      description: item.description,
      createdAt: new Date(item.pubDate).toISOString(),
    }));
  }));
  return results.flatMap((r) => (r.status === "fulfilled" ? r.value : []));
}

// ─── Lobste.rs ───────────────────────────────────────────────────────────────

async function scrapeLobsters(): Promise<TrendPost[]> {
  // Invite-only community = higher quality posts than HN
  // Covers: web, systems, security, ML, open source
  const res = await safeFetch("https://lobste.rs/rss");
  if (!res) return [];
  const xml = await safeText(res);
  return parseRssItems(xml)
    .slice(0, 25)
    .map((item) => ({
      title: item.title,
      url: item.link,
      points: 0,
      comments: 0,
      source: "lobsters" as const,
      description: item.description,
      createdAt: new Date(item.pubDate).toISOString(),
    }));
}

// ─── CoinDesk ────────────────────────────────────────────────────────────────

async function scrapeCoinDesk(): Promise<TrendPost[]> {
  const res = await safeFetch("https://www.coindesk.com/arc/outboundfeeds/rss/", {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; idea-agent/1.0)" },
  });
  if (!res) return [];
  const xml = await safeText(res);
  return parseRssItems(xml)
    .slice(0, 20)
    .map((item) => ({
      title: item.title,
      url: item.link,
      points: 0,
      comments: 0,
      source: "coindesk" as const,
      description: item.description,
      createdAt: new Date(item.pubDate).toISOString(),
    }));
}

// ─── Cointelegraph ───────────────────────────────────────────────────────────

async function scrapeCoinTelegraph(): Promise<TrendPost[]> {
  const res = await safeFetch("https://cointelegraph.com/rss", {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; idea-agent/1.0)" },
  });
  if (!res) return [];
  const xml = await safeText(res);
  return parseRssItems(xml)
    .slice(0, 20)
    .map((item) => ({
      title: item.title,
      url: item.link,
      points: 0,
      comments: 0,
      source: "cointelegraph" as const,
      description: item.description,
      createdAt: new Date(item.pubDate).toISOString(),
    }));
}

// ─── Decrypt ─────────────────────────────────────────────────────────────────

async function scrapeDecrypt(): Promise<TrendPost[]> {
  const res = await safeFetch("https://decrypt.co/feed", {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; idea-agent/1.0)" },
  });
  if (!res) return [];
  const xml = await safeText(res);
  return parseRssItems(xml)
    .slice(0, 20)
    .map((item) => ({
      title: item.title,
      url: item.link,
      points: 0,
      comments: 0,
      source: "decrypt" as const,
      description: item.description,
      createdAt: new Date(item.pubDate).toISOString(),
    }));
}

// ─── The Block ────────────────────────────────────────────────────────────────

async function scrapeTheBlock(): Promise<TrendPost[]> {
  const res = await safeFetch("https://www.theblock.co/rss.xml", {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; idea-agent/1.0)" },
  });
  if (!res) return [];
  const xml = await safeText(res);
  return parseRssItems(xml)
    .slice(0, 20)
    .map((item) => ({
      title: item.title,
      url: item.link,
      points: 0,
      comments: 0,
      source: "theblock" as const,
      description: item.description,
      createdAt: new Date(item.pubDate).toISOString(),
    }));
}

// ─── Blockworks ───────────────────────────────────────────────────────────────

async function scrapeBlockworks(): Promise<TrendPost[]> {
  const res = await safeFetch("https://blockworks.co/feed", {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; idea-agent/1.0)" },
  });
  if (!res) return [];
  const xml = await safeText(res);
  return parseRssItems(xml)
    .slice(0, 20)
    .map((item) => ({
      title: item.title,
      url: item.link,
      points: 0,
      comments: 0,
      source: "blockworks" as const,
      description: item.description,
      createdAt: new Date(item.pubDate).toISOString(),
    }));
}

// ─── Bitcoin Magazine ─────────────────────────────────────────────────────────

async function scrapeBitcoinMagazine(): Promise<TrendPost[]> {
  const res = await safeFetch("https://bitcoinmagazine.com/feed", {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; idea-agent/1.0)" },
  });
  if (!res) return [];
  const xml = await safeText(res);
  return parseRssItems(xml)
    .slice(0, 15)
    .map((item) => ({
      title: item.title,
      url: item.link,
      points: 0,
      comments: 0,
      source: "bitcoinmagazine" as const,
      description: item.description,
      createdAt: new Date(item.pubDate).toISOString(),
    }));
}

// ─── Messari ─────────────────────────────────────────────────────────────────

async function scrapeMessari(): Promise<TrendPost[]> {
  // Research-grade crypto intel — protocol analysis, tokenomics, funding rounds
  const res = await safeFetch("https://messari.io/rss", {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; idea-agent/1.0)" },
  });
  if (!res) return [];
  const xml = await safeText(res);
  return parseRssItems(xml)
    .slice(0, 15)
    .map((item) => ({
      title: item.title,
      url: item.link,
      points: 0,
      comments: 0,
      source: "messari" as const,
      description: item.description,
      createdAt: new Date(item.pubDate).toISOString(),
    }));
}

// ─── CryptoSlate ─────────────────────────────────────────────────────────────

async function scrapeCryptoSlate(): Promise<TrendPost[]> {
  const res = await safeFetch("https://cryptoslate.com/feed/", {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; idea-agent/1.0)" },
  });
  if (!res) return [];
  const xml = await safeText(res);
  return parseRssItems(xml)
    .slice(0, 20)
    .map((item) => ({
      title: item.title,
      url: item.link,
      points: 0,
      comments: 0,
      source: "cryptoslate" as const,
      description: item.description,
      createdAt: new Date(item.pubDate).toISOString(),
    }));
}

// ─── Crypto Briefing ─────────────────────────────────────────────────────────

async function scrapeCryptoBriefing(): Promise<TrendPost[]> {
  const res = await safeFetch("https://cryptobriefing.com/feed/", {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; idea-agent/1.0)" },
  });
  if (!res) return [];
  const xml = await safeText(res);
  return parseRssItems(xml)
    .slice(0, 15)
    .map((item) => ({
      title: item.title,
      url: item.link,
      points: 0,
      comments: 0,
      source: "cryptobriefing" as const,
      description: item.description,
      createdAt: new Date(item.pubDate).toISOString(),
    }));
}

// ─── BeInCrypto ──────────────────────────────────────────────────────────────

async function scrapeBeInCrypto(): Promise<TrendPost[]> {
  const res = await safeFetch("https://beincrypto.com/feed/", {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; idea-agent/1.0)" },
  });
  if (!res) return [];
  const xml = await safeText(res);
  return parseRssItems(xml)
    .slice(0, 20)
    .map((item) => ({
      title: item.title,
      url: item.link,
      points: 0,
      comments: 0,
      source: "beincrypto" as const,
      description: item.description,
      createdAt: new Date(item.pubDate).toISOString(),
    }));
}

// ─── Bankless ─────────────────────────────────────────────────────────────────

async function scrapeBankless(): Promise<TrendPost[]> {
  // DeFi/DAO/web3 ecosystem analysis — high signal for on-chain trends
  const res = await safeFetch("https://www.bankless.com/feed", {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; idea-agent/1.0)" },
  });
  if (!res) return [];
  const xml = await safeText(res);
  return parseRssItems(xml)
    .slice(0, 10)
    .map((item) => ({
      title: item.title,
      url: item.link,
      points: 0,
      comments: 0,
      source: "bankless" as const,
      description: item.description,
      createdAt: new Date(item.pubDate).toISOString(),
    }));
}

// ─── Cryptonews ──────────────────────────────────────────────────────────────

async function scrapeCryptonews(): Promise<TrendPost[]> {
  const res = await safeFetch("https://cryptonews.com/news/feed/", {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; idea-agent/1.0)" },
  });
  if (!res) return [];
  const xml = await safeText(res);
  return parseRssItems(xml)
    .slice(0, 15)
    .map((item) => ({
      title: item.title,
      url: item.link,
      points: 0,
      comments: 0,
      source: "cryptonews" as const,
      description: item.description,
      createdAt: new Date(item.pubDate).toISOString(),
    }));
}

// ─── DL News ─────────────────────────────────────────────────────────────────

async function scrapeDLNews(): Promise<TrendPost[]> {
  const res = await safeFetch("https://www.dlnews.com/arc/outboundfeeds/rss/", {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; idea-agent/1.0)" },
  });
  if (!res) return [];
  const xml = await safeText(res);
  return parseRssItems(xml)
    .slice(0, 20)
    .map((item) => ({
      title: item.title,
      url: item.link,
      points: 0,
      comments: 0,
      source: "dlnews" as const,
      description: item.description,
      createdAt: new Date(item.pubDate).toISOString(),
    }));
}

// ─── Wu Blockchain ────────────────────────────────────────────────────────────

async function scrapeWuBlockchain(): Promise<TrendPost[]> {
  // Wu Blockchain publishes on Substack — RSS available without auth
  const res = await safeFetch("https://wublockchain.substack.com/feed", {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; idea-agent/1.0)" },
  });
  if (!res) return [];
  const xml = await safeText(res);
  return parseRssItems(xml)
    .slice(0, 15)
    .map((item) => ({
      title: item.title,
      url: item.link,
      points: 0,
      comments: 0,
      source: "wublockchain" as const,
      description: item.description,
      createdAt: new Date(item.pubDate).toISOString(),
    }));
}

// ─── CoinGecko News ───────────────────────────────────────────────────────────

async function scrapeCoinGeckoNews(): Promise<TrendPost[]> {
  // CoinGecko aggregates crypto news with engagement signals
  const res = await safeFetch("https://www.coingecko.com/news.rss", {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; idea-agent/1.0)" },
  });
  if (!res) return [];
  const xml = await safeText(res);
  return parseRssItems(xml)
    .slice(0, 20)
    .map((item) => ({
      title: item.title,
      url: item.link,
      points: 0,
      comments: 0,
      source: "coingeckonews" as const,
      description: item.description,
      createdAt: new Date(item.pubDate).toISOString(),
    }));
}

// ─── rwa.xyz Newswire ─────────────────────────────────────────────────────────

async function scrapeRwaXyz(): Promise<TrendPost[]> {
  // RWA.xyz covers real-world asset tokenization — fastest growing crypto sector
  const res = await safeFetch("https://rwa.xyz/news/feed", {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; idea-agent/1.0)" },
  });
  if (!res) return [];
  const xml = await safeText(res);
  return parseRssItems(xml)
    .slice(0, 15)
    .map((item) => ({
      title: item.title,
      url: item.link,
      points: 0,
      comments: 0,
      source: "rwaxyz" as const,
      description: item.description,
      createdAt: new Date(item.pubDate).toISOString(),
    }));
}

// ─── HuggingFace Daily Papers ────────────────────────────────────────────────

async function scrapeHuggingFacePapers(): Promise<TrendPost[]> {
  // Papers that trend here become products in 2-4 weeks — early signal
  // Free public API, no auth
  const res = await safeFetch("https://huggingface.co/api/daily_papers");
  if (!res) return [];
  const papers = await res.json();
  return (papers ?? []).slice(0, 20).map((p: any) => ({
    title: p.paper?.title ?? p.title ?? "Untitled paper",
    url: `https://huggingface.co/papers/${p.paper?.id ?? p.id}`,
    points: p.upvotes ?? 0,
    comments: p.numComments ?? 0,
    source: "huggingface" as const,
    description: p.paper?.summary?.slice(0, 200),
    createdAt: p.publishedAt ?? new Date().toISOString(),
  }));
}

// ─── Dev.to ──────────────────────────────────────────────────────────────────

async function scrapeDevTo(): Promise<TrendPost[]> {
  const res = await safeFetch("https://dev.to/api/articles?top=1&per_page=30");
  if (!res) return [];
  const articles = await res.json();
  return (articles ?? []).map((a: any) => ({
    title: a.title,
    url: a.url,
    points: a.positive_reactions_count ?? 0,
    comments: a.comments_count ?? 0,
    source: "devto" as const,
    description: a.description,
    createdAt: a.published_at ?? new Date().toISOString(),
  }));
}

// ─── GitHub Trending ─────────────────────────────────────────────────────────

async function scrapeGitHubTrending(): Promise<TrendPost[]> {
  const res = await safeFetch(
    "https://github.com/trending?since=daily&spoken_language_code=en"
  );
  if (!res) return [];
  const html = await safeText(res);
  const posts: TrendPost[] = [];

  // Non-repo path prefixes to skip
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
    const starsToday = starsMatch
      ? parseInt(starsMatch[0].replace(/[^0-9]/g, ""), 10)
      : 0;

    posts.push({
      title: repoPath.replace("/", " / "),
      url: `https://github.com/${repoPath}`,
      points: starsToday,
      comments: 0,
      source: "github" as const,
      description,
      createdAt: new Date().toISOString(),
    });
  }
  return posts;
}

// ─── Indie Hackers ───────────────────────────────────────────────────────────

async function scrapeIndieHackers(): Promise<TrendPost[]> {
  const res = await safeFetch("https://www.indiehackers.com/feed.xml", {
    headers: {
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    },
  });
  if (!res) return [];
  const xml = await safeText(res);
  return parseRssItems(xml)
    .slice(0, 20)
    .map((item) => ({
      title: item.title,
      url: item.link,
      points: 0,
      comments: 0,
      source: "indiehackers" as const,
      description: item.description,
      createdAt: new Date(item.pubDate).toISOString(),
    }));
}

// ─── Bluesky ─────────────────────────────────────────────────────────────────

async function scrapeBluesky(): Promise<TrendPost[]> {
  // Public AT Protocol API — no auth for search
  // Growing fast in tech/founder/AI circles
  const queries = ["buildinpublic", "launched today", "built a tool", "side project"];
  const posts: TrendPost[] = [];

  for (const q of queries) {
    const url = `https://public.api.bsky.app/xrpc/app.bsky.feed.searchPosts?q=${encodeURIComponent(q)}&limit=25&sort=top`;
    const res = await safeFetch(url);
    if (!res) continue;
    const data = await res.json();

    for (const item of data.posts ?? []) {
      const text: string = item.record?.text ?? "";
      if (text.length < 30) continue;
      posts.push({
        title: text.slice(0, 120).replace(/\n/g, " "),
        url: `https://bsky.app/profile/${item.author?.handle}/post/${item.uri?.split("/").pop()}`,
        points: (item.likeCount ?? 0) + (item.repostCount ?? 0),
        comments: item.replyCount ?? 0,
        source: "bluesky" as const,
        createdAt: item.indexedAt ?? new Date().toISOString(),
      });
    }
  }
  return posts;
}

// ─── X/Twitter via Apify (apidojo/tweet-scraper) ────────────────────────────

/**
 * High-signal thought leaders across AI, crypto, and indie building.
 * These accounts post 6-12h before the same ideas surface on HN/Reddit.
 * Update this list as the space evolves — quality over quantity.
 */
const TWITTER_HANDLES = [
  // ── AI Leaders (4) ───────────────────────────────────────────────────────
  "sama",           // OpenAI CEO — drives the biggest AI discourse
  "DarioAmodei",    // Anthropic CEO — safety + capability framing
  "satyanadella",   // Microsoft CEO — enterprise AI + product direction
  "karpathy",       // ex-OpenAI/Tesla — authoritative technical takes
  // ── AI Practitioners (7) ─────────────────────────────────────────────────
  "emollick",       // Wharton prof — best practical AI research commentary
  "swyx",           // latent space — AI engineer community pulse
  "simonw",         // LLM tools — "here's what this actually does" takes
  "mattshumer_",    // AI product builder — fast takes on new capabilities
  "AravSrinivas",   // Perplexity CEO — AI search + product strategy
  "ClementDelangue",// HuggingFace CEO — open-source model releases
  "alexalbert__",   // Anthropic — Claude updates, model behavior intel
  // ── AI Critics (2) ───────────────────────────────────────────────────────
  "GaryMarcus",     // loudest AI critic — pure contrarian tweet fuel
  "ylecun",         // Meta AI — counternarrative to OpenAI hype
  // ── Crypto News + Signal (7) ─────────────────────────────────────────────
  "WuBlockchain",   // China/Asia crypto intel — earliest on exchange moves
  "lookonchain",    // on-chain whale tracking — earliest signal on big moves
  "laurashin",      // Unchained journalist — breaks scoops
  "MessariCrypto",  // research-grade analysis, not just headlines
  "DLNews_",        // high quality institutional crypto journalism
  "CryptoHayes",    // BitMEX founder — macro/crypto cycles, sharp writing
  "cobie",          // crypto culture — contrarian cycle takes
  // ── Security / Cybersecurity (3) ─────────────────────────────────────────
  "briankrebs",     // KrebsOnSecurity — breaks the biggest breaches
  "troyhunt",       // HaveIBeenPwned — data breach + infosec authority
  "SwiftOnSecurity",// practical security takes — massive following
  // ── Indie Builders (4) ───────────────────────────────────────────────────
  "levelsio",       // ships fast, real revenue numbers, no fluff
  "patio11",        // business of software — pricing, distribution
  "marc_louvion",   // SaaS builder — growth experiments with real numbers
  "natfriedman",    // ex-GitHub CEO — AI coding tools, sharp operator takes
  // ── Podcasters / Idea Generators (4) ─────────────────────────────────────
  "gregisenberg",   // AI product ideas, community-led growth — posts daily
  "ShaanVP",        // My First Million — startup takes, what's blowing up
  "jason",          // All-In / TWIST — startup culture, early stage signal
  "danshipper",     // Every.to — AI x writing/productivity, thoughtful takes
];

async function scrapeTwitter(): Promise<TrendPost[]> {
  const token = process.env.APIFY_API_TOKEN;
  if (!token) {
    console.log("[scraper] Twitter/X: skipping — APIFY_API_TOKEN not set");
    return [];
  }

  try {
    const { ApifyClient } = await import("apify-client");
    const client = new ApifyClient({ token });

    console.log(`[scraper] Twitter/X: scraping ${TWITTER_HANDLES.length} accounts via Apify`);

    // Fetch tweets from the last 24h from curated accounts
    const run = await client.actor("apidojo/tweet-scraper").call({
      twitterHandles: TWITTER_HANDLES,
      maxItems: 100,          // ~3 tweets per account across 31 handles
      minimumFavorites: 50,   // filter out low-engagement noise
      sort: "Latest",
      addUserInfo: false,     // saves cost — we don't need profile data
    });

    const { items } = await client.dataset(run.defaultDatasetId).listItems();
    console.log(`[scraper] Twitter/X: got ${items.length} tweets`);

    const posts: TrendPost[] = [];
    for (const tweet of items as Record<string, unknown>[]) {
      const text = (tweet.text ?? tweet.full_text ?? "") as string;
      if (!text || text.length < 30) continue;

      // Skip pure retweets (RT @...) — only original takes
      if (text.startsWith("RT @")) continue;

      const likes    = (tweet.favoriteCount ?? tweet.like_count ?? 0) as number;
      const retweets = (tweet.retweetCount  ?? tweet.retweet_count ?? 0) as number;
      const replies  = (tweet.replyCount    ?? tweet.reply_count ?? 0) as number;
      const author   = (tweet.author?.userName ?? tweet.user?.screen_name ?? "unknown") as string;
      const tweetId  = (tweet.id ?? tweet.id_str ?? "") as string;
      const createdAt = (tweet.createdAt ?? tweet.created_at ?? new Date().toISOString()) as string;

      posts.push({
        title: text.slice(0, 200).replace(/\n+/g, " "),
        url: `https://x.com/${author}/status/${tweetId}`,
        points: likes + retweets * 2,   // retweets carry more signal than likes
        comments: replies,
        source: "twitter" as const,
        createdAt,
      });
    }

    return posts;
  } catch (err) {
    console.error("[scraper] Twitter/X error:", err);
    return [];
  }
}

// ─── Deduplication ───────────────────────────────────────────────────────────

function deduplicateByTitle(posts: TrendPost[]): TrendPost[] {
  const seen = new Set<string>();
  return posts.filter((p) => {
    const key = p.title
      .toLowerCase()
      .replace(/[^a-z0-9 ]/g, "")
      .slice(0, 60)
      .trim();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ─── Scoring ─────────────────────────────────────────────────────────────────

function scorePost(post: TrendPost): number {
  const ageMs = Date.now() - new Date(post.createdAt).getTime();
  const ageHours = Math.max(ageMs / (1000 * 60 * 60), 0.1);

  // Velocity: points + weighted comments per hour
  const velocity = (post.points + post.comments * 1.5) / ageHours;

  // Discussion signal: high comment ratio = controversy or curiosity
  const commentRatio = post.points > 0 ? post.comments / post.points : 0;

  // Recency boost
  const recencyBoost = ageHours < 6 ? 1.6 : ageHours < 12 ? 1.3 : 1.0;

  // Source weights — reflects signal quality for virality detection
  const sourceWeight: Record<TrendPost["source"], number> = {
    hackernews: 1.5,       // front page = proven signal
    ycombinator: 1.6,      // vetted founders, real launches
    lobsters: 1.4,         // curated, low noise
    github: 1.3,           // stars today = real momentum
    twitter: 1.4,          // fastest signal (Phase 2)
    bluesky: 1.2,          // growing, less noise than Twitter
    producthunt: 1.2,      // curated launches
    techcrunch: 1.1,       // lagging indicator but broad reach
    huggingface: 1.2,      // pre-trend signal for AI
    coindesk: 1.2,         // crypto news of record
    cointelegraph: 1.1,    // crypto + web3 coverage
    theblock: 1.2,         // institutional crypto journalism
    decrypt: 1.1,          // consumer crypto + web3
    blockworks: 1.1,       // DeFi/institutional focus
    bitcoinmagazine: 1.0,  // Bitcoin-specific
    messari: 1.3,          // research-grade — protocol analysis, tokenomics
    cryptoslate: 1.1,      // data-driven news
    cryptobriefing: 1.1,   // analysis-focused
    beincrypto: 1.0,       // broad web3 coverage
    bankless: 1.2,         // DeFi/DAO ecosystem — high signal for on-chain trends
    cryptonews: 0.9,       // general crypto
    dlnews: 1.2,           // high-quality institutional crypto journalism
    wublockchain: 1.3,     // insider China/Asia crypto intel — high signal
    coingeckonews: 1.1,    // aggregated crypto news with market context
    rwaxyz: 1.3,           // RWA tokenization — fastest growing sector
    indiehackers: 1.0,
    reddit: 1.0,
    devto: 0.9,
  };

  // GitHub posts use current time as createdAt — cap their effective age at 12h
  // to prevent near-zero age inflating velocity to infinity
  const effectiveAgeHours = post.source === "github"
    ? Math.max(ageHours, 12)
    : ageHours;
  const effectiveVelocity = (post.points + post.comments * 1.5) / effectiveAgeHours;

  const base = effectiveVelocity + commentRatio * 10 + post.points * 0.1;
  return base * recencyBoost * (sourceWeight[post.source] ?? 1.0);
}

// ─── Main export ─────────────────────────────────────────────────────────────

export interface FetchTrendsResult {
  /** Every scraped post — deduplicated but unfiltered. Write this to Sheets. */
  all: TrendPost[];
  /** Top 50 by virality score — pass this to Claude. */
  top: TrendPost[];
}

export async function fetchTrends(): Promise<FetchTrendsResult> {
  console.log("[scraper] Fetching trends from all sources...");

  const [hn, reddit, yc, ph, tc, lobsters, hf, devto, github, ih, bsky, twitter,
         coindesk, cointelegraph, decrypt, theblock, blockworks, bitcoinmag,
         messari, cryptoslate, cryptobriefing, beincrypto, bankless, cryptonews,
         dlnews, wublockchain, coingeckonews, rwaxyz] =
    await Promise.allSettled([
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
      scrapeTwitter(),
      scrapeCoinDesk(),
      scrapeCoinTelegraph(),
      scrapeDecrypt(),
      scrapeTheBlock(),
      scrapeBlockworks(),
      scrapeBitcoinMagazine(),
      scrapeMessari(),
      scrapeCryptoSlate(),
      scrapeCryptoBriefing(),
      scrapeBeInCrypto(),
      scrapeBankless(),
      scrapeCryptonews(),
      scrapeDLNews(),
      scrapeWuBlockchain(),
      scrapeCoinGeckoNews(),
      scrapeRwaXyz(),
    ]);

  const raw: TrendPost[] = [
    ...(hn.status === "fulfilled" ? hn.value : []),
    ...(reddit.status === "fulfilled" ? reddit.value : []),
    ...(yc.status === "fulfilled" ? yc.value : []),
    ...(ph.status === "fulfilled" ? ph.value : []),
    ...(tc.status === "fulfilled" ? tc.value : []),
    ...(lobsters.status === "fulfilled" ? lobsters.value : []),
    ...(hf.status === "fulfilled" ? hf.value : []),
    ...(devto.status === "fulfilled" ? devto.value : []),
    ...(github.status === "fulfilled" ? github.value : []),
    ...(ih.status === "fulfilled" ? ih.value : []),
    ...(bsky.status === "fulfilled" ? bsky.value : []),
    ...(twitter.status === "fulfilled" ? twitter.value : []),
    ...(coindesk.status === "fulfilled" ? coindesk.value : []),
    ...(cointelegraph.status === "fulfilled" ? cointelegraph.value : []),
    ...(decrypt.status === "fulfilled" ? decrypt.value : []),
    ...(theblock.status === "fulfilled" ? theblock.value : []),
    ...(blockworks.status === "fulfilled" ? blockworks.value : []),
    ...(bitcoinmag.status === "fulfilled" ? bitcoinmag.value : []),
    ...(messari.status === "fulfilled" ? messari.value : []),
    ...(cryptoslate.status === "fulfilled" ? cryptoslate.value : []),
    ...(cryptobriefing.status === "fulfilled" ? cryptobriefing.value : []),
    ...(beincrypto.status === "fulfilled" ? beincrypto.value : []),
    ...(bankless.status === "fulfilled" ? bankless.value : []),
    ...(cryptonews.status === "fulfilled" ? cryptonews.value : []),
    ...(dlnews.status === "fulfilled" ? dlnews.value : []),
    ...(wublockchain.status === "fulfilled" ? wublockchain.value : []),
    ...(coingeckonews.status === "fulfilled" ? coingeckonews.value : []),
    ...(rwaxyz.status === "fulfilled" ? rwaxyz.value : []),
  ];

  const sourceCounts = raw.reduce(
    (acc, p) => ({ ...acc, [p.source]: (acc[p.source] ?? 0) + 1 }),
    {} as Record<string, number>
  );
  console.log("[scraper] Raw counts by source:", sourceCounts);

  const all = deduplicateByTitle(raw);

  // Fix 1: Cap per-source representation so HN doesn't crowd out everything else
  const SOURCE_CAPS: Partial<Record<TrendPost["source"], number>> = {
    hackernews:   20,
    devto:        8,
    github:       8,
    techcrunch:   8,
    lobsters:     8,
    huggingface:  8,
    reddit:       8,
    bluesky:       6,
    producthunt:   6,
    ycombinator:   6,
    indiehackers:  5,
    twitter:       10,
    coindesk:      8,
    cointelegraph: 8,
    theblock:      8,
    decrypt:       8,
    blockworks:    6,
    bitcoinmagazine:  6,
    messari:          6,
    cryptoslate:      6,
    cryptobriefing:   6,
    beincrypto:       6,
    bankless:         5,
    cryptonews:       5,
    dlnews:           8,
    wublockchain:     6,
    coingeckonews:    8,
    rwaxyz:           6,
  };

  const scored = [...all].sort((a, b) => scorePost(b) - scorePost(a));
  const sourceSeen: Partial<Record<TrendPost["source"], number>> = {};
  const top: TrendPost[] = [];

  // Crypto RSS feeds have 0 points/comments so they score near 0 and get crowded out.
  // Guarantee at least 10 crypto posts in the top 50 so the LLM always sees crypto signals.
  const CRYPTO_SOURCES = new Set<TrendPost["source"]>([
    "coindesk", "cointelegraph", "decrypt", "theblock", "blockworks",
    "bitcoinmagazine", "messari", "cryptoslate", "cryptobriefing",
    "beincrypto", "bankless", "cryptonews",
    "dlnews", "wublockchain", "coingeckonews", "rwaxyz",
  ]);
  const cryptoReserved = scored.filter(p => CRYPTO_SOURCES.has(p.source)).slice(0, 10);

  for (const post of scored) {
    const cap = SOURCE_CAPS[post.source] ?? 10;
    const seen = sourceSeen[post.source] ?? 0;
    if (seen >= cap) continue;
    sourceSeen[post.source] = seen + 1;
    top.push(post);
    if (top.length >= 40) break;  // leave 10 slots for crypto
  }

  // Fill remaining slots with reserved crypto posts not already in top
  const topUrls = new Set(top.map(p => p.url));
  for (const post of cryptoReserved) {
    if (!topUrls.has(post.url)) top.push(post);
    if (top.length >= 50) break;
  }

  const topSourceCounts = top.reduce(
    (acc, p) => ({ ...acc, [p.source]: (acc[p.source] ?? 0) + 1 }),
    {} as Record<string, number>
  );
  console.log("[scraper] Top 50 source breakdown:", topSourceCounts);
  console.log(
    `[scraper] ${raw.length} raw → ${all.length} deduped (→ Sheets) → top ${top.length} (→ LLM)`
  );
  return { all, top };
}

// ─── Run directly for testing ─────────────────────────────────────────────────
// npm run test:scraper

const isMain = process.argv[1]?.endsWith("scraper.ts");
if (isMain) {
  fetchTrends().then(({ all, top }) => {
    console.log("\n=== TOP 10 POSTS ===");
    top.slice(0, 10).forEach((p, i) => {
      console.log(`${i + 1}. [${p.source}] ${p.title}`);
      console.log(`   ${p.url}`);
      console.log(`   pts:${p.points} comments:${p.comments}`);
    });
    console.log(`\nTotal scraped: ${all.length}`);
  });
}
