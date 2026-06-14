/**
 * Media Recommendations
 * Fetches recent podcast episodes + YouTube videos via RSS — no extra packages.
 * AI picks 2-3 most relevant to today's trends, shown in the night brief only.
 */

export interface MediaItem {
  title:       string;
  url:         string;
  show:        string;
  type:        "podcast" | "youtube";
  publishedAt: string;
}

// ─── Feed sources ─────────────────────────────────────────────────────────────

const FEEDS: { name: string; url: string; type: "podcast" | "youtube" }[] = [
  // ── AI Podcasts ───────────────────────────────────────────────────────────
  { name: "Lex Fridman",      url: "https://lexfridman.com/feed/podcast/",                                          type: "podcast" },
  { name: "No Priors",        url: "https://feeds.simplecast.com/no-priors",                                        type: "podcast" },
  { name: "Latent Space",     url: "https://feeds.transistor.fm/latent-space-the-ai-engineer-podcast",              type: "podcast" },
  { name: "Lenny's Podcast",  url: "https://feeds.transistor.fm/lenny-s-podcast",                                   type: "podcast" },
  // ── Crypto Podcasts ───────────────────────────────────────────────────────
  { name: "Bankless",         url: "https://feeds.megaphone.fm/bankless",                                           type: "podcast" },
  { name: "Unchained",        url: "https://unchained.libsyn.com/rss",                                              type: "podcast" },
  { name: "The Pomp Podcast", url: "https://feeds.simplecast.com/V5yrCBwn",                                         type: "podcast" },
  // ── Startup Podcasts ──────────────────────────────────────────────────────
  { name: "All-In",           url: "https://feeds.megaphone.fm/all-in",                                             type: "podcast" },
  { name: "My First Million", url: "https://mfmpod.libsyn.com/rss",                                                 type: "podcast" },
  { name: "Acquired",         url: "https://feeds.simplecast.com/4T39_jAj",                                         type: "podcast" },
  { name: "20VC",             url: "https://thetwentyminutevc.libsyn.com/rss",                                      type: "podcast" },
  // ── YouTube (channel RSS — free, no API key needed) ───────────────────────
  { name: "Y Combinator",     url: "https://www.youtube.com/feeds/videos.xml?channel_id=UCcefcZRL2oaA_uBNeo5UNqg", type: "youtube" },
  { name: "Fireship",         url: "https://www.youtube.com/feeds/videos.xml?channel_id=UCsBjURrPoezykLs9EqgamOA", type: "youtube" },
  { name: "Andrej Karpathy",  url: "https://www.youtube.com/feeds/videos.xml?channel_id=UCXUPKJO5MZQN11PqgIvyuvQ", type: "youtube" },
  { name: "Greg Isenberg",    url: "https://www.youtube.com/feeds/videos.xml?channel_id=UCPjNBjflYl0-HQtUvOx0Ibw", type: "youtube" },
  { name: "a16z",             url: "https://www.youtube.com/feeds/videos.xml?channel_id=UC9cn0TuPq4dnbTY-CBsm8XA", type: "youtube" },
];

// ─── RSS parser (handles both RSS 2.0 and Atom/YouTube format) ───────────────

function extractTag(xml: string, tag: string): string {
  // Handles <tag>value</tag> and <tag attr="...">value</tag>
  const m = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return m ? m[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").trim() : "";
}

function extractAttr(xml: string, tag: string, attr: string): string {
  const m = xml.match(new RegExp(`<${tag}[^>]*\\s${attr}=["']([^"']+)["'][^>]*>`, "i"));
  return m ? m[1].trim() : "";
}

function parseRSS(xml: string, show: string, type: "podcast" | "youtube"): MediaItem[] {
  const items: MediaItem[] = [];
  const isAtom = xml.includes("<feed");

  // Split into individual items/entries
  const itemTag  = isAtom ? "entry" : "item";
  const segments = xml.split(new RegExp(`<${itemTag}[\\s>]`)).slice(1);

  for (const seg of segments.slice(0, 5)) { // max 5 per feed
    const title = extractTag(seg, "title");
    const url   = isAtom
      ? extractAttr(seg, "link", "href")
      : extractTag(seg, "link") || extractTag(seg, "guid");
    const date  = isAtom
      ? extractTag(seg, "published") || extractTag(seg, "updated")
      : extractTag(seg, "pubDate");

    if (!title || !url) continue;
    items.push({ title, url, show, type, publishedAt: date });
  }

  return items;
}

// ─── Main export ──────────────────────────────────────────────────────────────

export async function fetchRecentMedia(): Promise<MediaItem[]> {
  const results = await Promise.allSettled(
    FEEDS.map(async ({ name, url, type }) => {
      try {
        const res = await fetch(url, {
          headers: { "User-Agent": "IdeaAgent/1.0 (RSS reader)" },
          signal: AbortSignal.timeout(8000),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const xml = await res.text();
        const items = parseRSS(xml, name, type);
        console.log(`[media] ${name}: ${items.length} items`);
        return items;
      } catch (err) {
        console.warn(`[media] ${name}: failed — ${(err as Error).message}`);
        return [] as MediaItem[];
      }
    })
  );

  const all = results.flatMap(r => r.status === "fulfilled" ? r.value : []);

  // Filter to last 7 days
  const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const recent = all.filter(item => {
    const d = new Date(item.publishedAt).getTime();
    return !isNaN(d) ? d > cutoff : true; // keep if date unparseable
  });

  console.log(`[media] ${recent.length} items from last 7 days across ${FEEDS.length} feeds`);
  return recent;
}
